import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getUserPref,
  setUserPref,
  errorMessage,
  newId,
  setWorkspace,
  createQuickProjectDir,
  forgetWorkspace,
} from "./api";

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
  remove: (id: string) => Promise<void>;
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

function parseList(raw: string | null): WorkspaceMeta[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkspaceMeta[]) : [];
  } catch {
    return [];
  }
}

async function loadAll(): Promise<WorkspaceMeta[]> {
  const scoped = await getUserPref(PREF_ALL_WORKSPACES, true);
  if (scoped !== null) return parseList(scoped);
  const legacy = parseList(await getUserPref(PREF_ALL_WORKSPACES));
  if (legacy.length > 0) {
    await setUserPref(PREF_ALL_WORKSPACES, JSON.stringify(legacy), true);
    await setUserPref(PREF_ALL_WORKSPACES, "[]");
  }
  return legacy;
}

async function saveAll(list: WorkspaceMeta[]): Promise<void> {
  await setUserPref(PREF_ALL_WORKSPACES, JSON.stringify(list), true).catch(() => undefined);
}

async function loadLastId(): Promise<string | null> {
  const scoped = await getUserPref(PREF_LAST_WORKSPACE, true).catch(() => null);
  if (scoped) return scoped;
  return getUserPref(PREF_LAST_WORKSPACE).catch(() => null);
}

async function saveLastId(id: string): Promise<void> {
  await setUserPref(PREF_LAST_WORKSPACE, id, true).catch(() => undefined);
}

async function activateWorkspace(meta: WorkspaceMeta): Promise<WorkspaceMeta> {
  const canonical = await setWorkspace(meta.path);
  return canonical === meta.path ? meta : { ...meta, path: canonical };
}

function upsert(list: WorkspaceMeta[], meta: WorkspaceMeta): WorkspaceMeta[] {
  const index = list.findIndex((w) => w.id === meta.id || w.path === meta.path);
  if (index === -1) return [...list, meta];
  const next = [...list];
  next[index] = { ...next[index], path: meta.path };
  return next;
}

function failureStatus(current: WorkspaceMeta | null): WorkspacePickStatus {
  return current ? "ready" : "error";
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

      let all: WorkspaceMeta[] = [];
      let lastId: string | null = null;
      try {
        [all, lastId] = await Promise.all([loadAll(), loadLastId()]);
      } catch (e) {
        set((s) => {
          s.status = "needs_pick";
          s.error = `Could not load saved workspaces: ${errorMessage(e)}`;
        });
        return;
      }

      set((s) => {
        s.all = all;
      });

      if (all.length === 0) {
        set((s) => {
          s.status = "needs_pick";
        });
        return;
      }

      const last = all.find((w) => w.id === lastId) ?? all[0];

      try {
        const active = await activateWorkspace(last);
        const next = upsert(all, active);
        if (active !== last) await saveAll(next);
        set((s) => {
          s.all = next;
          s.current = active;
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

      let meta: WorkspaceMeta = {
        id: newId(),
        name,
        path,
        isQuickProject: false,
        createdAt: Date.now(),
      };

      try {
        meta = await activateWorkspace(meta);
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
          s.status = failureStatus(s.current);
        });
        return;
      }

      const existing = get().all.find((w) => w.path === meta.path);
      if (existing) meta = existing;
      const next = upsert(get().all, meta);
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
        path = await createQuickProjectDir(id, name);
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
          s.status = failureStatus(s.current);
        });
        return;
      }

      let meta: WorkspaceMeta = {
        id,
        name,
        path,
        isQuickProject: true,
        createdAt: Date.now(),
      };

      try {
        meta = await activateWorkspace(meta);
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
          s.status = failureStatus(s.current);
        });
        return;
      }

      const next = upsert(get().all, meta);
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
        const active = await activateWorkspace(meta);
        await saveLastId(id);
        const next = upsert(get().all, active);
        if (active !== meta) await saveAll(next);
        set((s) => {
          s.all = next;
          s.current = active;
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

    remove: async (id: string) => {
      const target = get().all.find((w) => w.id === id);
      if (!target) return;
      const next = get().all.filter((w) => w.id !== id);
      try {
        await forgetWorkspace(target.path, target.isQuickProject);
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
        });
        return;
      }
      await saveAll(next);
      const wasCurrent = get().current?.id === id;
      set((s) => {
        s.all = next;
        if (wasCurrent) {
          s.current = null;
          s.status = "needs_pick";
        }
      });
      if (wasCurrent) notifyChatStore();
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
