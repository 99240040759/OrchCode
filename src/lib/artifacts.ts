import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { newId, type DocumentArtifactKind } from "./api";
import { useWorkspaceStore } from "./workspace";
import { toRelativeWorkspacePath, getExt } from "./utils";

function normalizeWorkspacePath(path: string): string {
  return toRelativeWorkspacePath(path, useWorkspaceStore.getState().current?.path);
}

export type ArtifactKind = "file" | "browser" | "terminal" | DocumentArtifactKind;

function resolveArtifactKind(path: string): ArtifactKind {
  const ext = getExt(path);
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "xlsx" || ext === "xls" || ext === "ods" || ext === "csv") return "xlsx";
  if (ext === "pptx" || ext === "ppt") return "pptx";
  return "file";
}

export const DEFAULT_BROWSER_URL = "https://www.google.com";

export interface ArtifactTab {
  id: string;
  kind: ArtifactKind;
  path?: string;
  url?: string;
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
  openDocument: (path: string, kind: DocumentArtifactKind, label?: string) => void;
  setTabPath: (id: string, path: string) => void;
  fileWritten: (path: string) => void;
  dropWorkspaceTabs: () => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setPanelOpen: (open: boolean) => void;
  toggleMaximized: () => void;
  reset: () => void;
}

type ArtifactsStore = ArtifactsState & ArtifactsActions;

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
      if (!path) {
        set((s) => {
          const existing = s.tabs.find((t) => t.kind === "file" && !t.path);
          if (existing) {
            existing.preview = false;
            s.activeId = existing.id;
            s.panelOpen = true;
            return;
          }
          const tab: ArtifactTab = { id: newId(), kind: "file" };
          s.tabs.push(tab);
          s.activeId = tab.id;
          s.panelOpen = true;
        });
        return;
      }

      const kind = resolveArtifactKind(path);
      set((s) => {
        const existing = s.tabs.find((t) => t.kind === kind && t.path === path);
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

    openDocument: (rawPath: string, kind: DocumentArtifactKind, label?: string) => {
      const path = normalizeWorkspacePath(rawPath);
      set((s) => {
        const existing = s.tabs.find((t) => t.kind === kind && t.path === path);
        if (existing) {
          existing.preview = false;
          if (label) existing.label = label;
          s.activeId = existing.id;
          s.panelOpen = true;
          return;
        }
        const tab: ArtifactTab = { id: newId(), kind, path, label };
        s.tabs.push(tab);
        s.activeId = tab.id;
        s.panelOpen = true;
      });
    },

    dropWorkspaceTabs: () => {
      set((s) => {
        s.tabs = s.tabs.filter((t) => t.kind === "browser");
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
      const kind = resolveArtifactKind(path);
      set((s) => {
        s.fileVersions[path] = (s.fileVersions[path] ?? 0) + 1;
        if (s.tabs.some((t) => t.path === path)) return;
        const active = s.tabs.find((t) => t.id === s.activeId);
        const userBusy = active?.kind === "terminal" || active?.kind === "browser";
        const preview = s.tabs.find((t) => t.preview);
        if (preview) {
          preview.path = path;
          preview.kind = kind;
          if (!userBusy) {
            s.activeId = preview.id;
            s.panelOpen = true;
          }
          return;
        }
        const tab: ArtifactTab = { id: newId(), kind, path, preview: true };
        s.tabs.push(tab);
        if (!userBusy) {
          s.activeId = tab.id;
          s.panelOpen = true;
        }
      });
    },

    setTabPath: (id: string, rawPath: string) => {
      const path = normalizeWorkspacePath(rawPath);
      const kind = resolveArtifactKind(path);
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (tab) {
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
        const tab = s.tabs.find((t) => t.id === id);
        if (tab) tab.preview = false;
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
