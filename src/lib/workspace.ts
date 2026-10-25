import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { open } from "@tauri-apps/plugin-dialog";
import { uniqueNamesGenerator, adjectives, animals } from "unique-names-generator";
import { clearImageCache } from "./images";
import {
  getUserPref,
  setUserPref,
  errorMessage,
  newId,
  setWorkspace,
  createQuickProjectDir,
  forgetWorkspace,
} from "./api";

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
  busy: boolean;
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
  busy: false,
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
  return scoped !== null ? parseList(scoped) : [];
}

async function saveAll(list: WorkspaceMeta[]): Promise<void> {
  await setUserPref(PREF_ALL_WORKSPACES, JSON.stringify(list), true).catch(() => undefined);
}

async function loadLastId(): Promise<string | null> {
  return (await getUserPref(PREF_LAST_WORKSPACE, true).catch(() => null)) ?? null;
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
  next[index] = { ...next[index], ...meta };
  return next;
}

function failureStatus(current: WorkspaceMeta | null): WorkspacePickStatus {
  return current ? "ready" : "error";
}

function randomProjectName(existingNames: Set<string>): string {
  const name = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: "-",
    length: 2,
    style: "lowerCase",
  });
  return existingNames.has(name) ? `${name}-${newId().slice(0, 4)}` : name;
}

export const useWorkspaceStore = create(
  immer<WorkspaceStore>((set, get) => {
    let inProgress = false;
    let initializeEpoch = 0;

    const exclusive = async (task: () => Promise<void>) => {
      if (inProgress || get().busy) return;
      inProgress = true;
      set((s) => {
        s.busy = true;
      });
      try {
        await task();
      } catch (e) {
        set((s) => {
          s.error = errorMessage(e);
          s.status = failureStatus(s.current);
        });
      } finally {
        inProgress = false;
        set((s) => {
          s.busy = false;
        });
      }
    };

    const commit = async (meta: WorkspaceMeta, list: WorkspaceMeta[]) => {
      await saveAll(list);
      await saveLastId(meta.id);
      set((s) => {
        s.all = list;
        s.current = meta;
        s.status = "ready";
        s.error = null;
      });
      clearImageCache();
    };

    return {
      ...INITIAL_STATE,

      initialize: async () => {
        const epoch = ++initializeEpoch;
        set((s) => {
          s.status = "loading";
          s.error = null;
        });

        let all: WorkspaceMeta[] = [];
        let lastId: string | null = null;
        try {
          [all, lastId] = await Promise.all([loadAll(), loadLastId()]);
        } catch (e) {
          if (epoch !== initializeEpoch) return;
          set((s) => {
            s.status = "needs_pick";
            s.error = `Could not load saved workspaces: ${errorMessage(e)}`;
          });
          return;
        }
        if (epoch !== initializeEpoch) return;

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
          if (epoch !== initializeEpoch) return;
          const next = upsert(all, active);
          if (active !== last) {
            await saveAll(next);
            if (epoch !== initializeEpoch) return;
          }
          set((s) => {
            s.all = next;
            s.current = active;
            s.status = "ready";
          });
          clearImageCache();
        } catch (e) {
          if (epoch !== initializeEpoch) return;
          set((s) => {
            s.status = "needs_pick";
            s.error = `Last workspace "${last.name}" could not be opened: ${errorMessage(e)}`;
          });
        }
      },

      pickAndOpen: () =>
        exclusive(async () => {
          const selected = await open({ directory: true, multiple: false });
          if (typeof selected !== "string") return;

          const name = selected.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? selected;
          const activated = await activateWorkspace({
            id: newId(),
            name,
            path: selected,
            isQuickProject: false,
            createdAt: Date.now(),
          });
          const meta = get().all.find((w) => w.path === activated.path) ?? activated;
          await commit(meta, upsert(get().all, meta));
        }),

      createQuickProject: () =>
        exclusive(async () => {
          const id = newId();
          const name = randomProjectName(new Set(get().all.map((w) => w.name)));
          const path = await createQuickProjectDir(id, name);
          const meta = await activateWorkspace({
            id,
            name,
            path,
            isQuickProject: true,
            createdAt: Date.now(),
          });
          await commit(meta, upsert(get().all, meta));
        }),

      switchTo: (id: string) =>
        exclusive(async () => {
          const meta = get().all.find((w) => w.id === id);
          if (!meta) return;
          const active = await activateWorkspace(meta);
          await commit(active, upsert(get().all, active));
        }),

      remove: (id: string) =>
        exclusive(async () => {
          const target = get().all.find((w) => w.id === id);
          if (!target) return;
          await forgetWorkspace(target.path, target.isQuickProject);
          const next = get().all.filter((w) => w.id !== id);
          await saveAll(next);
          const wasCurrent = get().current?.id === id;
          if (wasCurrent) {
            await setUserPref(PREF_LAST_WORKSPACE, "", true).catch(() => undefined);
          }
          set((s) => {
            s.all = next;
            s.error = null;
            if (wasCurrent) {
              s.current = null;
              s.status = "needs_pick";
            }
          });
          if (wasCurrent) clearImageCache();
        }),

      dismissError: () => {
        set((s) => {
          s.error = null;
        });
      },

      reset: () => {
        initializeEpoch += 1;
        set((s) => {
          Object.assign(s, INITIAL_STATE);
        });
      },
    };
  })
);
