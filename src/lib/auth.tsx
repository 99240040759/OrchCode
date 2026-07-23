import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
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

let authListenerBound = false;
let signInTimeout: ReturnType<typeof setTimeout> | null = null;

function clearSignInTimeout() {
  if (signInTimeout) {
    clearTimeout(signInTimeout);
    signInTimeout = null;
  }
}

export const useAuthStore = create(
  immer<AuthStore>((set) => ({
    status: "loading",
    user: null,
    signingIn: false,
    error: null,
    justSignedIn: false,

    initialize: async () => {
      try {
        const user = await api.getAuthUser();
        if (user) set({ status: "signedIn", user });
        else set({ status: "signedOut", user: null });
      } catch {
        set({ status: "signedOut", user: null });
      }

      if (api.inTauri() && !authListenerBound) {
        authListenerBound = true;
        import("@tauri-apps/api/event")
          .then(({ listen }) =>
            listen<AuthChangedPayload>("auth-changed", (evt) => {
              clearSignInTimeout();
              const { user, error } = evt.payload;
              if (user) {
                set({ status: "signedIn", user, error: null, justSignedIn: true, signingIn: false });
              } else if (error) {
                set({ error, signingIn: false, status: "signedOut" });
              }
            })
          )
          .catch(() => {
            authListenerBound = false;
          });
      }
    },

    signInWithGoogle: async () => {
      set({ signingIn: true, error: null });
      clearSignInTimeout();
      signInTimeout = setTimeout(() => {
        signInTimeout = null;
        set((s) => { if (s.signingIn) { s.signingIn = false; s.error = "Sign-in timed out — please try again"; } });
      }, 120_000);
      try {
        const url = await api.getOAuthUrl("orchcode://auth-callback");
        if (!url) {
          clearSignInTimeout();
          set({ signingIn: false, error: "Could not obtain OAuth URL" });
          return;
        }
        await openUrl(url);
      } catch (e) {
        clearSignInTimeout();
        set({ signingIn: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    signOut: async () => {
      clearSignInTimeout();
      await api.signOutAuth();
      set({ status: "signedOut", user: null, error: null, justSignedIn: false, signingIn: false });
    },

    dismissGreeting: () => {
      set({ justSignedIn: false });
    },
  }))
);
