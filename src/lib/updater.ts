import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import * as api from "./api";
import { IS_MAC } from "./utils";

const LATEST_RELEASE_URL = "https://github.com/sameer786ss/orchcode/releases/latest";
const MANIFEST_URL = `${LATEST_RELEASE_URL}/download/latest.json`;

function isNewer(remote: string, current: string): boolean {
  const remoteParts = remote.replace(/^v/, "").split(".").map((part) => parseInt(part, 10) || 0);
  const currentParts = current.replace(/^v/, "").split(".").map((part) => parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(remoteParts.length, currentParts.length); index += 1) {
    const difference = (remoteParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "none"
  | "downloading"
  | "manualAvailable"
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

type UpdaterStore = UpdaterState & UpdaterActions;

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
    set({ status: "checking", error: null, percent: 0, pendingUpdate: null });

    if (IS_MAC) {
      try {
        const response = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Update manifest request failed (${response.status})`);
        }
        const manifest = (await response.json()) as { version?: unknown };
        if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
          throw new Error("Update manifest did not include a version");
        }

        const currentVersion = await getVersion();
        if (isNewer(manifest.version, currentVersion)) {
          set({
            status: "manualAvailable",
            version: manifest.version,
            percent: 0,
            pendingUpdate: null,
          });
        } else {
          set({ status: "none", version: currentVersion, percent: 0, pendingUpdate: null });
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
            const nextPercent = Math.min(99, Math.round((received / contentLength) * 100));
            if (nextPercent !== get().percent) {
              set({ percent: nextPercent });
            }
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
    if (status === "manualAvailable") {
      try {
        await openUrl(LATEST_RELEASE_URL);
      } catch (e) {
        set({ status: "manualAvailable", error: api.errorMessage(e) });
      }
      return;
    }

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
