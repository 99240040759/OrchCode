import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import type { UserDisplay } from "./api";
import { useArtifactsStore } from "./artifacts";
import { useChatStore } from "./store";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

const REDIRECT_TO = "https://orch.live/auth-callback";
const SIGN_IN_TIMEOUT_MS = 180_000;

interface AuthState {
  status: AuthStatus;
  user: UserDisplay | null;
  signingIn: boolean;
  error: string | null;
  justSignedIn: boolean;
  initialized: boolean;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  dismissGreeting: () => void;
  dismissError: () => void;
}

export type AuthStore = AuthState & AuthActions;

interface AuthChangedPayload {
  user: UserDisplay | null;
  error: string | null;
}

let signInTimeout: ReturnType<typeof setTimeout> | null = null;

function clearSignInTimeout() {
  if (signInTimeout !== null) {
    clearTimeout(signInTimeout);
    signInTimeout = null;
  }
}

function clearWorkspaceState() {
  useChatStore.getState().reset();
  useArtifactsStore.getState().reset();
}

export const useAuthStore = create(
  immer<AuthStore>((set, get) => ({
    status: "loading",
    user: null,
    signingIn: false,
    error: null,
    justSignedIn: false,
    initialized: false,

    initialize: async () => {
      if (get().initialized) return;
      set((s) => {
        s.initialized = true;
      });

      const { listen } = await import("@tauri-apps/api/event");
      await listen<AuthChangedPayload>("auth-changed", (event) => {
        clearSignInTimeout();
        const { user, error } = event.payload;
        if (user) {
          set((s) => {
            s.status = "signedIn";
            s.user = user;
            s.error = null;
            s.justSignedIn = true;
            s.signingIn = false;
          });
          return;
        }
        clearWorkspaceState();
        set((s) => {
          s.status = "signedOut";
          s.user = null;
          s.signingIn = false;
          s.justSignedIn = false;
          s.error = error;
        });
      });

      try {
        const user = await api.getAuthUser();
        set((s) => {
          s.status = user ? "signedIn" : "signedOut";
          s.user = user;
        });
      } catch (e) {
        set((s) => {
          s.status = "signedOut";
          s.user = null;
          s.error = api.errorMessage(e);
        });
      }
    },

    signInWithGoogle: async () => {
      if (get().signingIn) return;
      set((s) => {
        s.signingIn = true;
        s.error = null;
      });

      clearSignInTimeout();
      signInTimeout = setTimeout(() => {
        signInTimeout = null;
        set((s) => {
          if (!s.signingIn) return;
          s.signingIn = false;
          s.error = "Sign-in timed out. Please try again.";
        });
      }, SIGN_IN_TIMEOUT_MS);

      try {
        const url = await api.getOAuthUrl(REDIRECT_TO);
        await openUrl(url);
      } catch (e) {
        clearSignInTimeout();
        set((s) => {
          s.signingIn = false;
          s.error = api.errorMessage(e);
        });
      }
    },

    signOut: async () => {
      clearSignInTimeout();
      try {
        await api.signOutAuth();
      } catch (e) {
        set((s) => {
          s.error = api.errorMessage(e);
        });
        return;
      }
      clearWorkspaceState();
      set((s) => {
        s.status = "signedOut";
        s.user = null;
        s.error = null;
        s.justSignedIn = false;
        s.signingIn = false;
      });
    },

    dismissGreeting: () => {
      set((s) => {
        s.justSignedIn = false;
      });
    },

    dismissError: () => {
      set((s) => {
        s.error = null;
      });
    },
  }))
);
