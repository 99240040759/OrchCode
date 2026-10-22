import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import * as api from "./api";

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
