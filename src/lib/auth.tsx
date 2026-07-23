import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import type { UserDisplay } from "./api";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: AuthStatus;
  user: UserDisplay | null;
  signingIn: boolean;
  error: string | null;
  justSignedIn: boolean;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  dismissGreeting: () => void;
}

export type AuthStore = AuthState & AuthActions;

interface AuthChangedPayload {
  user: UserDisplay | null;
  error: string | null;
}

let authListenerCleanup: UnlistenFn | null = null;

export const useAuthStore = create(
  immer<AuthStore>((set) => ({
    status: "loading",
    user: null,
    signingIn: false,
    error: null,
    justSignedIn: false,

    initialize: async () => {
      if (authListenerCleanup) {
        authListenerCleanup();
        authListenerCleanup = null;
      }

      try {
        const user = await api.getAuthUser();
        if (user) set({ status: "signedIn", user });
        else set({ status: "signedOut", user: null });
      } catch {
        set({ status: "signedOut", user: null });
      }

      if (api.inTauri()) {
        import("@tauri-apps/api/event")
          .then(({ listen }) => {
            return listen<AuthChangedPayload>("auth-changed", (evt) => {
              const { user, error } = evt.payload;
              if (user) {
                set({ status: "signedIn", user, error: null, justSignedIn: true, signingIn: false });
              } else if (error) {
                set({ error, signingIn: false, status: "signedOut" });
              }
            });
          })
          .then((unlisten) => {
            authListenerCleanup = unlisten;
          })
          .catch(() => {});
      }
    },

    signInWithGoogle: async () => {
      set({ signingIn: true, error: null });
      const timeout = setTimeout(() => {
        set((s) => { if (s.signingIn) { s.signingIn = false; s.error = "Sign-in timed out — please try again"; } });
      }, 120_000);
      try {
        const url = await api.getOAuthUrl("orchcode://auth-callback");
        if (!url) {
          clearTimeout(timeout);
          set({ signingIn: false, error: "Could not obtain OAuth URL" });
          return;
        }
        await openUrl(url);
      } catch (e) {
        clearTimeout(timeout);
        set({ signingIn: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    signOut: async () => {
      await api.signOutAuth();
      set({ status: "signedOut", user: null, error: null, justSignedIn: false, signingIn: false });
    },

    dismissGreeting: () => {
      set({ justSignedIn: false });
    },
  }))
);
