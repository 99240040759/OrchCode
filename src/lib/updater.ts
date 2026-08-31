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
}

interface UpdaterActions {
  start: () => Promise<void>;
  apply: () => Promise<void>;
}

export type UpdaterStore = UpdaterState & UpdaterActions;

let pendingUpdate: Update | null = null;
let updateStarted = false;

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  status: "idle",
  version: "",
  percent: 0,
  error: null,

  start: async () => {
    if (updateStarted) return;
    updateStarted = true;
    set({ status: "checking", error: null });

    let update: Update | null = null;
    try {
      update = await check();
    } catch (e) {
      updateStarted = false;
      set({ status: "failed", error: api.errorMessage(e) });
      return;
    }

    if (!update?.available) {
      updateStarted = false;
      set({ status: "none" });
      return;
    }

    pendingUpdate = update;
    set({ status: "downloading", version: update.version, percent: 0 });

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
      pendingUpdate = null;
      updateStarted = false;
      set({ status: "failed", error: api.errorMessage(e) });
    }
  },

  apply: async () => {
    if (get().status !== "readyToRestart" || !pendingUpdate) return;
    set({ status: "installing", error: null });
    try {
      await pendingUpdate.install();
      await relaunch();
    } catch (e) {
      set({ status: "readyToRestart", error: api.errorMessage(e) });
    }
  },
}));
