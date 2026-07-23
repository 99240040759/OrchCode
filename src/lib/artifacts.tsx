import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { newId } from "./utils";

export type ArtifactKind = "file" | "browser" | "terminal";

export interface ArtifactTab {
  id: string;
  kind: ArtifactKind;
  path?: string;
  url?: string;
}

interface ArtifactsState {
  tabs: ArtifactTab[];
  activeId: string | null;
  panelOpen: boolean;
  maximized: boolean;
  fileVersions: Record<string, number>;
}

interface ArtifactsActions {
  openFile: (path?: string) => void;
  openBrowser: (url?: string) => void;
  openTerminal: () => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setPanelOpen: (open: boolean) => void;
  toggleMaximized: () => void;
  bumpFile: (path: string) => void;
}

export type ArtifactsStore = ArtifactsState & ArtifactsActions;

export const useArtifactsStore = create(
  immer<ArtifactsStore>((set) => ({
    tabs: [],
    activeId: null,
    panelOpen: false,
    maximized: false,
    fileVersions: {},

    openFile: (path?: string) => {
      set((s) => {
        if (path) {
          const existing = s.tabs.find((t) => t.kind === "file" && t.path === path);
          if (existing) {
            s.activeId = existing.id;
            s.panelOpen = true;
            return;
          }
        }
        const tab: ArtifactTab = { id: newId(), kind: "file", path };
        s.tabs.push(tab);
        s.activeId = tab.id;
        s.panelOpen = true;
      });
    },

    openBrowser: (url?: string) => {
      set((s) => {
        const existing = s.tabs.find((t) => t.kind === "browser");
        if (existing) {
          existing.url = url ?? existing.url;
          s.activeId = existing.id;
          s.panelOpen = true;
          return;
        }
        const tab: ArtifactTab = { id: newId(), kind: "browser", url: url ?? "https://www.google.com" };
        s.tabs.push(tab);
        s.activeId = tab.id;
        s.panelOpen = true;
      });
    },

    openTerminal: () => {
      set((s) => {
        const existing = s.tabs.find((t) => t.kind === "terminal");
        if (existing) {
          s.activeId = existing.id;
          s.panelOpen = true;
          return;
        }
        const tab: ArtifactTab = { id: newId(), kind: "terminal" };
        s.tabs.push(tab);
        s.activeId = tab.id;
        s.panelOpen = true;
      });
    },

    closeTab: (id: string) => {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx === -1) return;
        s.tabs.splice(idx, 1);
        if (s.activeId === id) {
          s.activeId = s.tabs[Math.max(0, idx - 1)]?.id ?? null;
        }
        if (s.tabs.length === 0) s.panelOpen = false;
      });
    },

    setActive: (id: string) => { set((s) => { s.activeId = id; }); },
    setPanelOpen: (open: boolean) => { set((s) => { s.panelOpen = open; }); },
    toggleMaximized: () => { set((s) => { s.maximized = !s.maximized; }); },
    bumpFile: (path: string) => { set((s) => { s.fileVersions[path] = (s.fileVersions[path] ?? 0) + 1; }); },
  }))
);
