import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  documentArtifactKindForPath,
  newId,
  type DocumentArtifactKind,
} from "./api";
import { useWorkspaceStore } from "./workspace";

export function normalizeWorkspacePath(path: string): string {
  const clean = path.replace(/\\/g, "/");
  const root = useWorkspaceStore.getState().current?.path?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && clean.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return clean.slice(root.length + 1);
  }
  return clean;
}

export type ArtifactKind = "file" | "browser" | "terminal" | DocumentArtifactKind;

export const DEFAULT_BROWSER_URL = "https://www.google.com";

export interface ArtifactTab {
  id: string;
  kind: ArtifactKind;
  path?: string;
  url?: string;
  documentId?: string;
  label?: string;
  preview?: boolean;
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
  openDocument: (path: string, kind: DocumentArtifactKind, label?: string, documentId?: string) => void;
  setTabPath: (id: string, path: string) => void;
  fileWritten: (path: string) => void;
  dropWorkspaceTabs: () => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setPanelOpen: (open: boolean) => void;
  toggleMaximized: () => void;
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

    openFile: (rawPath?: string) => {
      const path = rawPath ? normalizeWorkspacePath(rawPath) : undefined;
      set((s) => {
        const kind: ArtifactKind = path
          ? documentArtifactKindForPath(path) ?? "file"
          : "file";
        const existing = path
          ? s.tabs.find((t) => t.kind === kind && t.path === path)
          : s.tabs.find((t) => t.kind === "file" && !t.path);
        if (existing) {
          existing.preview = false;
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

    openDocument: (rawPath: string, kind: DocumentArtifactKind, label?: string, documentId?: string) => {
      const path = normalizeWorkspacePath(rawPath);
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

    dropWorkspaceTabs: () => {
      set((s) => {
        s.tabs = s.tabs.filter((t) => t.kind === "browser" || t.kind === "terminal" || (t.path ?? "").startsWith("/") || /^[a-zA-Z]:[\\/]/.test(t.path ?? ""));
        if (!s.tabs.some((t) => t.id === s.activeId)) s.activeId = s.tabs[0]?.id ?? null;
        if (s.tabs.length === 0) {
          s.panelOpen = false;
          s.maximized = false;
        }
        s.fileVersions = {};
      });
    },

    fileWritten: (rawPath: string) => {
      const path = normalizeWorkspacePath(rawPath);
      const kind: ArtifactKind = documentArtifactKindForPath(path) ?? "file";
      set((s) => {
        s.fileVersions[path] = (s.fileVersions[path] ?? 0) + 1;
        if (s.tabs.some((t) => t.path === path)) return;
        const active = s.tabs.find((t) => t.id === s.activeId);
        const userBusy = active?.kind === "terminal" || active?.kind === "browser";
        const preview = s.tabs.find((t) => t.preview);
        if (preview) {
          preview.path = path;
          preview.kind = kind;
          if (!userBusy) s.activeId = preview.id;
          return;
        }
        const tab: ArtifactTab = { id: newId(), kind, path, preview: true };
        s.tabs.push(tab);
        if (!userBusy) s.activeId = tab.id;
      });
    },

    setTabPath: (id: string, rawPath: string) => {
      const path = normalizeWorkspacePath(rawPath);
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (tab) {
          const kind = documentArtifactKindForPath(path) ?? "file";
          tab.kind = kind;
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

    reset: () => {
      set((s) => {
        Object.assign(s, INITIAL_STATE);
      });
    },
  }))
);
