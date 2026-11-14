import { create } from "zustand";
import { transition } from "../ui/transition";

export type AppView = "chat" | "integrations";

interface ShellState {
  sidebarOpen: boolean;
  view: AppView;
}

export const useShell = create<ShellState>(() => ({ sidebarOpen: true, view: "chat" }));

export const toggleSidebar = () => transition(() => useShell.setState((s) => ({ sidebarOpen: !s.sidebarOpen })));

export function showView(view: AppView) {
  if (useShell.getState().view === view) return;
  transition(() => useShell.setState({ view }));
}
