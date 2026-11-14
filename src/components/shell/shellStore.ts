import { create } from "zustand";

export type AppView = "chat" | "integrations";

interface ShellStore {
  sidebarOpen: boolean;
  view: AppView;
  toggleSidebar: () => void;
  setView: (view: AppView) => void;
}

export const useShell = create<ShellStore>((set) => ({
  sidebarOpen: true,
  view: "chat",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setView: (view) => set({ view }),
}));
