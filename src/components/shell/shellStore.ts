import { create } from "zustand";

export type AppView = "chat" | "integrations";

interface ShellStore {
  sidebarOpen: boolean;
  view: AppView;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setView: (view: AppView) => void;
}

export const useShell = create<ShellStore>((set) => ({
  sidebarOpen: true,
  view: "chat",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setView: (view) => set({ view }),
}));
