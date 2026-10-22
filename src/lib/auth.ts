import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import type { UserDisplay } from "./api";
import { useArtifactsStore } from "./artifacts";
import { useChatStore } from "./store";
import { useWorkspaceStore } from "./workspace";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

const SIGN_IN_TIMEOUT_MS = 180_000;

interface AuthState {
  status: AuthStatus;
  user: UserDisplay | null;
  signingIn: boolean;
  error: string | null;
  justSignedIn: boolean;
  initialized: boolean;
  signInTimeoutId: ReturnType<typeof setTimeout> | null;
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

function clearWorkspaceState() {
  useChatStore.getState().reset();
  useArtifactsStore.getState().reset();
  useWorkspaceStore.getState().reset();
}

function applySignedOut(
  s: AuthState,
  error: string | null
) {
  if (s.signInTimeoutId !== null) {
    clearTimeout(s.signInTimeoutId);
    s.signInTimeoutId = null;
  }
  s.status = "signedOut";
  s.user = null;
  s.signingIn = false;
  s.justSignedIn = false;
  s.error = error;
}

export const useAuthStore = create(
  immer<AuthStore>((set, get) => {
    const cancelTimeout = () => {
      const current = get().signInTimeoutId;
      if (current !== null) {
        clearTimeout(current);
        set((s) => {
          s.signInTimeoutId = null;
        });
      }
    };

    return {
      status: "loading",
      user: null,
      signingIn: false,
      error: null,
      justSignedIn: false,
      initialized: false,
      signInTimeoutId: null,

      initialize: async () => {
        if (get().initialized) return;
        set((s) => {
          s.initialized = true;
        });

        await listen<AuthChangedPayload>("auth-changed", (event) => {
          cancelTimeout();
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
          set((s) => applySignedOut(s, error));
        });

        await listen<{ error: string }>("auth-error", (event) => {
          cancelTimeout();
          set((s) => {
            s.signingIn = false;
            s.error = event.payload.error;
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
        cancelTimeout();

        const timeoutId = setTimeout(() => {
          set((s) => {
            s.signInTimeoutId = null;
            if (!s.signingIn) return;
            s.signingIn = false;
            s.error = "Sign-in timed out. Please try again.";
          });
        }, SIGN_IN_TIMEOUT_MS);

        set((s) => {
          s.signingIn = true;
          s.error = null;
          s.signInTimeoutId = timeoutId;
        });

        try {
          const url = await api.getOAuthUrl("https://orch.live/auth-callback");
          await openUrl(url);
        } catch (e) {
          cancelTimeout();
          set((s) => {
            s.signingIn = false;
            s.error = api.errorMessage(e);
          });
        }
      },

      signOut: async () => {
        cancelTimeout();
        try {
          await api.signOutAuth();
        } catch (e) {
          set((s) => {
            s.error = api.errorMessage(e);
          });
          return;
        }
        clearWorkspaceState();
        set((s) => applySignedOut(s, null));
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
    };
  })
);
