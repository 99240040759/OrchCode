import { create } from 'zustand';
import type { AuthUser, StoredSession } from '../auth';
interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoggedIn: boolean;
  setSession: (s: StoredSession) => void;
  clearSession: () => void;
}
export const useAuthStore = create<AuthState>((set) => ({
  user: null, accessToken: null, isLoggedIn: false,
  setSession: (s) => set({ user: s.user, accessToken: s.accessToken, isLoggedIn: true }),
  clearSession: () => set({ user: null, accessToken: null, isLoggedIn: false }),
}));
