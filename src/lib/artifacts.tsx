import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { newId } from "./api";

export type ArtifactKind = "file" | "browser" | "terminal" | "pdf" | "docx" | "xlsx" | "pptx";

export const DOCUMENT_KINDS: ArtifactKind[] = ["pdf", "docx", "xlsx", "pptx"];

export const DEFAULT_BROWSER_URL = "https://www.google.com";

export interface ArtifactTab {
  id: string;
  kind: ArtifactKind;
  path?: string;
  url?: string;
  documentId?: string;
  label?: string;
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
  openDocument: (path: string, kind: ArtifactKind, label?: string, documentId?: string) => void;
  setTabPath: (id: string, path: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setPanelOpen: (open: boolean) => void;
  toggleMaximized: () => void;
  bumpFile: (path: string) => void;
  reset: () => void;
}

export type ArtifactsStore = ArtifactsState & ArtifactsActions;

const INITIAL_STATE: ArtifactsState = {
  tabs: [],
  activeId: null,
  panelOpen: false,
  maximized: false,
  fileVersions: {},
};

export function activeTabId(state: ArtifactsState): string | null {
  if (state.activeId && state.tabs.some((t) => t.id === state.activeId)) return state.activeId;
  return state.tabs[0]?.id ?? null;
}

export const useArtifactsStore = create(
  immer<ArtifactsStore>((set) => ({
    ...INITIAL_STATE,

    openFile: (path?: string) => {
      set((s) => {
        let kind: ArtifactKind = "file";
        if (path) {
          const ext = path.split(".").pop()?.toLowerCase();
          if (ext === "pdf") kind = "pdf";
          else if (ext === "docx" || ext === "doc") kind = "docx";
          else if (ext === "xlsx" || ext === "xls") kind = "xlsx";
          else if (ext === "pptx" || ext === "ppt") kind = "pptx";
        }
        const existing = path
          ? s.tabs.find((t) => t.kind === kind && t.path === path)
          : s.tabs.find((t) => t.kind === "file" && !t.path);
        if (existing) {
          s.activeId = existing.id;
          s.panelOpen = true;
          return;
        }
        const tab: ArtifactTab = { id: newId(), kind, path };
        s.tabs.push(tab);
        s.activeId = tab.id;
        s.panelOpen = true;
      });
    },

    openBrowser: (url?: string) => {
      set((s) => {
        const existing = s.tabs.find((t) => t.kind === "browser");
        if (existing) {
          if (url) existing.url = url;
          s.activeId = existing.id;
          s.panelOpen = true;
          return;
        }
        const tab: ArtifactTab = {
          id: newId(),
          kind: "browser",
          url: url ?? DEFAULT_BROWSER_URL,
        };
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

    openDocument: (path: string, kind: ArtifactKind, label?: string, documentId?: string) => {
      set((s) => {
        const existing = s.tabs.find((t) => t.kind === kind && t.path === path);
        if (existing) {
          s.activeId = existing.id;
          s.panelOpen = true;
          return;
        }
        const tab: ArtifactTab = { id: newId(), kind, path, label, documentId };
        s.tabs.push(tab);
        s.activeId = tab.id;
        s.panelOpen = true;
      });
    },

    setTabPath: (id: string, path: string) => {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (tab) {
          const ext = path.split(".").pop()?.toLowerCase();
          if (ext === "pdf") tab.kind = "pdf";
          else if (ext === "docx" || ext === "doc") tab.kind = "docx";
          else if (ext === "xlsx" || ext === "xls") tab.kind = "xlsx";
          else if (ext === "pptx" || ext === "ppt") tab.kind = "pptx";
          else tab.kind = "file";
          tab.path = path;
        }
      });
    },

    closeTab: (id: string) => {
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id);
        if (index === -1) return;
        s.tabs.splice(index, 1);
        if (s.activeId === id) {
          s.activeId = s.tabs[Math.max(0, index - 1)]?.id ?? null;
        }
        if (s.tabs.length === 0) {
          s.panelOpen = false;
          s.maximized = false;
        }
      });
    },

    setActive: (id: string) => {
      set((s) => {
        s.activeId = id;
      });
    },

    setPanelOpen: (open: boolean) => {
      set((s) => {
        s.panelOpen = open;
        if (!open) s.maximized = false;
      });
    },

    toggleMaximized: () => {
      set((s) => {
        s.maximized = !s.maximized;
        if (s.maximized) s.panelOpen = true;
      });
    },

    bumpFile: (path: string) => {
      set((s) => {
        s.fileVersions[path] = (s.fileVersions[path] ?? 0) + 1;
      });
    },

    reset: () => {
      set((s) => {
        Object.assign(s, INITIAL_STATE);
        s.tabs = [];
        s.fileVersions = {};
      });
    },
  }))
);
