import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import * as api from "./api";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

const LATEST_RELEASE_URL =
  "https://github.com/sameer786ss/OrchCode/releases/latest";
const MANIFEST_URL =
  "https://github.com/sameer786ss/OrchCode/releases/latest/download/latest.json";

function isNewer(remote: string, current: string): boolean {
  const r = remote.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const c = current.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const diff = (r[i] ?? 0) - (c[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "none"
  | "downloading"
  | "readyToRestart"
  | "installing"
  | "failed";

interface UpdaterState {
  status: UpdateStatus;
  version: string;
  percent: number;
  error: string | null;
  pendingUpdate: Update | null;
}

interface UpdaterActions {
  start: () => Promise<void>;
  apply: () => Promise<void>;
}

export type UpdaterStore = UpdaterState & UpdaterActions;

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  status: "idle",
  version: "",
  percent: 0,
  error: null,
  pendingUpdate: null,

  start: async () => {
    const currentStatus = get().status;
    if (currentStatus === "checking" || currentStatus === "downloading" || currentStatus === "installing") {
      return;
    }
    set({ status: "checking", error: null });

    if (IS_MAC) {
      try {
        const res = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (!res.ok) {
          set({ status: "none", pendingUpdate: null });
          return;
        }
        const data = (await res.json()) as { version?: string };
        const currentVersion = await getVersion();
        if (data.version && isNewer(data.version, currentVersion)) {
          set({ status: "readyToRestart", version: data.version, pendingUpdate: null });
        } else {
          set({ status: "none", pendingUpdate: null });
        }
      } catch (e) {
        set({ status: "failed", error: api.errorMessage(e), pendingUpdate: null });
      }
      return;
    }

    let update: Update | null = null;
    try {
      update = await check();
    } catch (e) {
      set({ status: "failed", error: api.errorMessage(e), pendingUpdate: null });
      return;
    }

    if (!update?.available) {
      set({ status: "none", pendingUpdate: null });
      return;
    }

    set({ status: "downloading", version: update.version, percent: 0, pendingUpdate: update });

    let contentLength = 0;
    let received = 0;
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          received = 0;
          set({ percent: 0 });
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (contentLength > 0) {
            set({ percent: Math.min(99, Math.round((received / contentLength) * 100)) });
          }
        } else if (event.event === "Finished") {
          set({ percent: 100 });
        }
      });
      set({ status: "readyToRestart" });
    } catch (e) {
      set({ status: "failed", error: api.errorMessage(e), pendingUpdate: null });
    }
  },

  apply: async () => {
    if (IS_MAC) {
      await openUrl(LATEST_RELEASE_URL).catch(() => undefined);
      return;
    }

    const { status, pendingUpdate } = get();
    if (status !== "readyToRestart" || !pendingUpdate) return;
    set({ status: "installing", error: null });
    try {
      await pendingUpdate.install();
      await relaunch();
    } catch (e) {
      set({ status: "readyToRestart", error: api.errorMessage(e) });
    }
  },
}));
