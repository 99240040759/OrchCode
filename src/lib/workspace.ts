import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getUserPref, setUserPref, errorMessage, newId } from "./api";

type WorkspaceActivatedFn = () => void;
let _onWorkspaceActivated: WorkspaceActivatedFn | null = null;

export function registerWorkspaceActivatedCallback(fn: WorkspaceActivatedFn) {
  _onWorkspaceActivated = fn;
}

function notifyChatStore() {
  _onWorkspaceActivated?.();
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  path: string;
  isQuickProject: boolean;
  createdAt: number;
}

export type WorkspacePickStatus =
  | "idle"
  | "loading"
  | "needs_pick"
  | "ready"
  | "error";

interface WorkspaceState {
  current: WorkspaceMeta | null;
  all: WorkspaceMeta[];
  status: WorkspacePickStatus;
  error: string | null;
}

interface WorkspaceActions {
  initialize: () => Promise<void>;
  pickAndOpen: () => Promise<void>;
  createQuickProject: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  remove: (id: string) => void;
  dismissError: () => void;
  reset: () => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

const PREF_LAST_WORKSPACE = "lastWorkspaceId";
const PREF_ALL_WORKSPACES = "allWorkspaces";

const INITIAL_STATE: WorkspaceState = {
  current: null,
  all: [],
  status: "idle",
  error: null,
};

async function loadAll(): Promise<WorkspaceMeta[]> {
  try {
    const raw = await getUserPref(PREF_ALL_WORKSPACES);
    if (!raw) return [];
    return JSON.parse(raw) as WorkspaceMeta[];
  } catch {
    return [];
  }
}

async function saveAll(list: WorkspaceMeta[]): Promise<void> {
  await setUserPref(PREF_ALL_WORKSPACES, JSON.stringify(list));
}

async function loadLastId(): Promise<string | null> {
  return getUserPref(PREF_LAST_WORKSPACE).catch(() => null);
}

async function saveLastId(id: string): Promise<void> {
  await setUserPref(PREF_LAST_WORKSPACE, id).catch(() => undefined);
}

async function activateWorkspace(meta: WorkspaceMeta): Promise<void> {
  await invoke("set_workspace", { path: meta.path });
}

const ADJECTIVES = [
  "amber", "brave", "calm", "dusk", "epic", "fast", "gold", "hazy",
  "idle", "jade", "keen", "lush", "mist", "neat", "opal", "pure",
  "quiet", "rust", "sage", "teal", "urban", "vast", "warm", "zeal",
];
const NOUNS = [
  "atlas", "bloom", "comet", "delta", "echo", "forge", "grove", "haven",
  "iris", "jumper", "kite", "lance", "maple", "nexus", "orbit", "prism",
  "quill", "river", "spark", "tide", "unity", "vortex", "wave", "zenith",
];

function randomProjectName(existingNames: Set<string>): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const name = `${adj}-${noun}`;
    if (!existingNames.has(name)) return name;
  }
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}-${newId().slice(0, 4)}`;
}

export const useWorkspaceStore = create(
  immer<WorkspaceStore>((set, get) => ({
    ...INITIAL_STATE,

    initialize: async () => {
      set((s) => {
        s.status = "loading";
        s.error = null;
      });

      const [all, lastId] = await Promise.all([loadAll(), loadLastId()]);

      set((s) => {
        s.all = all;
      });

      if (all.length === 0 || !lastId) {
        set((s) => {
          s.status = "needs_pick";
        });
        return;
      }

      const last = all.find((w) => w.id === lastId) ?? all[0];

      try {
        await activateWorkspace(last);
        set((s) => {
          s.current = last;
          s.status = "ready";
        });
      } catch (e) {
        set((s) => {
          s.status = "needs_pick";
          s.error = `Last workspace "${last.name}" could not be opened: ${errorMessage(e)}`;
        });
      }
    },

    pickAndOpen: async () => {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;

      const path = selected;
      const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;

      const existing = get().all.find((w) => w.path === path);
      const meta: WorkspaceMeta = existing ?? {
        id: newId(),
        name,
        path,
        isQuickProject: false,
        createdAt: Date.now(),
      };

      try {
        await activateWorkspace(meta);
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
          s.status = "error";
        });
        return;
      }

      const next = existing ? get().all : [...get().all, meta];
      await saveAll(next);
      await saveLastId(meta.id);

      set((s) => {
        s.all = next;
        s.current = meta;
        s.status = "ready";
        s.error = null;
      });

      void notifyChatStore();
    },

    createQuickProject: async () => {
      const id = newId();
      const existingNames = new Set(get().all.map((w) => w.name));
      const name = randomProjectName(existingNames);

      let path: string;
      try {
        path = await invoke<string>("create_quick_project_dir", { id, name });
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
          s.status = "error";
        });
        return;
      }

      const meta: WorkspaceMeta = {
        id,
        name,
        path,
        isQuickProject: true,
        createdAt: Date.now(),
      };

      try {
        await activateWorkspace(meta);
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
          s.status = "error";
        });
        return;
      }

      const next = [...get().all, meta];
      await saveAll(next);
      await saveLastId(meta.id);

      set((s) => {
        s.all = next;
        s.current = meta;
        s.status = "ready";
        s.error = null;
      });

      void notifyChatStore();
    },

    switchTo: async (id: string) => {
      const meta = get().all.find((w) => w.id === id);
      if (!meta) return;
      try {
        await activateWorkspace(meta);
        await saveLastId(id);
        set((s) => {
          s.current = meta;
          s.status = "ready";
          s.error = null;
        });
        void notifyChatStore();
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
        });
      }
    },

    remove: (id: string) => {
      const target = get().all.find((w) => w.id === id);
      if (!target) return;
      const next = get().all.filter((w) => w.id !== id);
      void saveAll(next);
      void invoke("delete_workspace_data", {
        workspacePath: target.path,
        isQuickProject: target.isQuickProject,
      }).catch(() => undefined);
      set((s) => {
        s.all = next;
        if (s.current?.id === id) {
          s.current = null;
          s.status = "needs_pick";
        }
      });
    },

    dismissError: () => {
      set((s) => {
        s.error = null;
      });
    },

    reset: () => {
      set((s) => {
        Object.assign(s, INITIAL_STATE);
      });
    },
  }))
);
