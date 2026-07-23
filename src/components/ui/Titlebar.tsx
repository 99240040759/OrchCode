import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FiMinus, FiSquare, FiCopy, FiX, FiRefreshCw, FiDownload } from "react-icons/fi";
import { check } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { inTauri } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

const MAC_RELEASES_URL = "https://github.com/sameer786ss/OrchCode/releases/latest";
type UpdateStatus = "none" | "downloading" | "readyToRestart" | "macAvailable";
let updateCheckStarted = false;

export function WindowControls({ className }: { className?: string }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("none");
  const [targetVersion, setTargetVersion] = useState<string>("");
  const unlistenRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (!inTauri()) return;
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    appWindow.onResized(() => { appWindow.isMaximized().then(setIsMaximized).catch(() => {}); }).then((un) => { unlistenRef.current = un; }).catch(() => {});

    if (!updateCheckStarted) {
      updateCheckStarted = true;
      const isMac = navigator.userAgent.includes("Mac");
      check().then(async (update) => {
        if (update?.available) {
          setTargetVersion(update.version);
          if (isMac) { setUpdateStatus("macAvailable"); } else {
            setUpdateStatus("downloading");
            await update.downloadAndInstall();
            setUpdateStatus("readyToRestart");
          }
        }
      }).catch(() => {});
    }

    return () => { unlistenRef.current?.(); };
  }, []);

  const handleUpdateClick = async () => {
    if (updateStatus === "macAvailable") await openUrl(MAC_RELEASES_URL);
    else if (updateStatus === "readyToRestart") await relaunch();
  };

  const act = (fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) => () => {
    if (!inTauri()) return;
    fn(getCurrentWindow()).catch(() => {});
  };

  return (
    <div className={cn("WinControls", className)} data-tauri-drag-region="false">
      {updateStatus === "downloading" && (
        <span className="Titlebar-update-badge Titlebar-update-downloading">
          <FiDownload className="Titlebar-spinner" />
          <span>Updating...</span>
        </span>
      )}
      {updateStatus === "readyToRestart" && (
        <Button type="button" className="Titlebar-update-badge Titlebar-update-ready" onClick={() => void handleUpdateClick()} title="Click to restart and apply update">
          <FiRefreshCw />
          <span>Restart to Update</span>
        </Button>
      )}
      {updateStatus === "macAvailable" && (
        <Button type="button" className="Titlebar-update-badge Titlebar-update-mac" onClick={() => void handleUpdateClick()} title="Click to download macOS release">
          <FiDownload />
          <span>Update v{targetVersion}</span>
        </Button>
      )}
      <Button type="button" className="WinBtn" aria-label="Minimize" onClick={act((w) => w.minimize())}><FiMinus /></Button>
      <Button type="button" className="WinBtn" aria-label={isMaximized ? "Restore" : "Maximize"} onClick={act((w) => w.toggleMaximize())}>{isMaximized ? <FiCopy /> : <FiSquare />}</Button>
      <Button type="button" className="WinBtn WinBtn-close" aria-label="Close" onClick={act((w) => w.close())}><FiX /></Button>
    </div>
  );
}

export function Titlebar({ title, className }: { title?: string; className?: string }) {
  return (
    <div className={cn("Titlebar", className)} data-tauri-drag-region>
      {title && <span className="Titlebar-title" data-tauri-drag-region>{title}</span>}
      <WindowControls />
    </div>
  );
}
