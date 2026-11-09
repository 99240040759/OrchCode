import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { open } from "@tauri-apps/plugin-dialog";
import { getBasename, isCloudWorkspace } from "./utils";
import { clearImageCache } from "./images";
import {
  getUserPref,
  setUserPref,
  errorMessage,
  newId,
  setWorkspace,
  initCloudWorkspace,
  forgetWorkspace,
} from "./api";

export interface WorkspaceMeta {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  repoUrl?: string;
  repoDir?: string;
}

type WorkspacePickStatus =
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
  openCloudRepo: (repoUrl: string, customName?: string) => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  dismissError: () => void;
  reset: () => void;
}

type WorkspaceStore = WorkspaceState & WorkspaceActions;

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
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Record<string, unknown>>)
      .filter((w) => !w.isQuickProject && !(typeof w.path === "string" && w.path.includes("quick-projects")))
      .map((w) => ({
        id: String(w.id),
        name: String(w.name),
        path: String(w.path),
        createdAt: Number(w.createdAt) || 0,
        repoUrl: typeof w.repoUrl === "string" ? w.repoUrl : undefined,
        repoDir: typeof w.repoDir === "string" ? w.repoDir : undefined,
      }));
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

function cloudDisplayName(workspaceUri: string): string {
  const stripped = workspaceUri.replace(/^cloud:\/\/[^/]+\//, "");
  return stripped || getBasename(workspaceUri) || workspaceUri;
}

async function activateWorkspace(meta: WorkspaceMeta): Promise<WorkspaceMeta> {
  if (isCloudWorkspace(meta.path) || Boolean(meta.repoUrl)) {
    const info = await initCloudWorkspace(meta.repoUrl || meta.path);
    return {
      ...meta,
      name: meta.name || cloudDisplayName(info.workspace),
      path: info.workspace,
      repoUrl: info.repoUrl,
      repoDir: info.repoDir,
    };
  }
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

          const name = getBasename(selected) || selected;
          const activated = await activateWorkspace({
            id: newId(),
            name,
            path: selected,
            createdAt: Date.now(),
          });
          const existing = get().all.find((w) => w.path === activated.path);
          const meta = existing ? { ...existing, ...activated, id: existing.id } : activated;
          await commit(meta, upsert(get().all, meta));
        }),

      openCloudRepo: (repoUrl: string, customName?: string) =>
        exclusive(async () => {
          const trimmed = repoUrl.trim();
          if (!trimmed) return;
          const info = await initCloudWorkspace(trimmed);
          const existing = get().all.find((w) => w.path === info.workspace);
          const meta: WorkspaceMeta = {
            id: existing?.id ?? newId(),
            name: customName?.trim() || existing?.name || cloudDisplayName(info.workspace),
            path: info.workspace,
            repoUrl: info.repoUrl,
            repoDir: info.repoDir,
            createdAt: existing?.createdAt ?? Date.now(),
          };
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
          await forgetWorkspace(target.path);
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
