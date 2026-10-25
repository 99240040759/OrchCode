import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import type { UserDisplay } from "./api";
import { useArtifactsStore } from "./artifacts";
import { useChatStore } from "./store";
import { useConnectorsStore } from "./connectors";
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
  useConnectorsStore.getState().reset();
  useArtifactsStore.getState().reset();
  useWorkspaceStore.getState().reset();
}

function applySignedOut(s: AuthState, error: string | null) {
  s.status = "signedOut";
  s.user = null;
  s.signingIn = false;
  s.justSignedIn = false;
  s.error = error;
}

export const useAuthStore = create(
  immer<AuthStore>((set, get) => {
    let initializing = false;
    let signInTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let unlistenAuthChanged: UnlistenFn | null = null;
    let unlistenAuthError: UnlistenFn | null = null;
    let authChangeVersion = 0;

    const cancelTimeout = () => {
      if (signInTimeoutId !== null) {
        clearTimeout(signInTimeoutId);
        signInTimeoutId = null;
      }
    };

    return {
      status: "loading",
      user: null,
      signingIn: false,
      error: null,
      justSignedIn: false,
      initialized: false,

      initialize: async () => {
        if (initializing || get().initialized) return;
        initializing = true;
        const initialAuthVersion = authChangeVersion;

        try {
          if (unlistenAuthChanged) {
            unlistenAuthChanged();
            unlistenAuthChanged = null;
          }
          if (unlistenAuthError) {
            unlistenAuthError();
            unlistenAuthError = null;
          }

          unlistenAuthChanged = await listen<AuthChangedPayload>("auth-changed", (event) => {
            authChangeVersion += 1;
            cancelTimeout();
            const { user, error } = event.payload;
            if (user) {
              clearWorkspaceState();
              set((s) => {
                s.status = "signedIn";
                s.user = user;
                s.error = null;
                s.justSignedIn = true;
                s.signingIn = false;
              });
              void useWorkspaceStore.getState().initialize();
              return;
            }
            clearWorkspaceState();
            set((s) => applySignedOut(s, error));
          });

          unlistenAuthError = await listen<{ error: string }>("auth-error", (event) => {
            cancelTimeout();
            set((s) => {
              s.signingIn = false;
              s.error = event.payload.error;
            });
          });

          const user = await api.getAuthUser();
          if (initialAuthVersion !== authChangeVersion) {
            set((s) => {
              s.initialized = true;
            });
            return;
          }
          if (user) {
            set((s) => {
              s.status = "signedIn";
              s.user = user;
              s.error = null;
            });
            await useWorkspaceStore.getState().initialize();
          } else {
            clearWorkspaceState();
            set((s) => applySignedOut(s, null));
          }
          set((s) => {
            s.initialized = true;
          });
        } catch (e) {
          unlistenAuthChanged?.();
          unlistenAuthChanged = null;
          unlistenAuthError?.();
          unlistenAuthError = null;
          clearWorkspaceState();
          set((s) => {
            s.initialized = false;
            s.status = "signedOut";
            s.user = null;
            s.error = api.errorMessage(e);
          });
        } finally {
          initializing = false;
        }
      },

      signInWithGoogle: async () => {
        if (get().signingIn) return;
        cancelTimeout();

        signInTimeoutId = setTimeout(() => {
          signInTimeoutId = null;
          set((s) => {
            if (!s.signingIn) return;
            s.signingIn = false;
            s.error = "Sign-in timed out. Please try again.";
          });
        }, SIGN_IN_TIMEOUT_MS);

        set((s) => {
          s.signingIn = true;
          s.error = null;
        });

        try {
          const url = await api.getOAuthUrl();
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
