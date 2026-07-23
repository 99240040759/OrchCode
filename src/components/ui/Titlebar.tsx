import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FiMinus, FiSquare, FiCopy, FiX, FiRefreshCw, FiDownload } from "react-icons/fi";
import { VscChromeClose, VscChromeMinimize, VscChromeMaximize, VscChromeRestore } from "react-icons/vsc";
import { check } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { inTauri } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

const MAC_RELEASES_URL = "https://github.com/sameer786ss/OrchCode/releases/latest";
type UpdateStatus = "none" | "downloading" | "readyToRestart" | "macAvailable";
let updateCheckStarted = false;

export function WindowControls({ className, isMac }: { className?: string; isMac?: boolean }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("none");
  const [targetVersion, setTargetVersion] = useState<string>("");
  const unlistenRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (!inTauri()) return;
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setIsMaximized).catch(() => { });
    appWindow
      .onResized(() => {
        appWindow.isMaximized().then(setIsMaximized).catch(() => { });
      })
      .then((un) => {
        unlistenRef.current = un;
      })
      .catch(() => { });

    if (!updateCheckStarted) {
      updateCheckStarted = true;
      const mac = isMac ?? (typeof navigator !== "undefined" && navigator.userAgent.includes("Mac"));
      check()
        .then(async (update) => {
          if (update?.available) {
            setTargetVersion(update.version);
            if (mac) {
              setUpdateStatus("macAvailable");
            } else {
              setUpdateStatus("downloading");
              try {
                await update.downloadAndInstall();
                setUpdateStatus("readyToRestart");
              } catch (err) {
                console.error("[updater] download/install failed:", err);
                setUpdateStatus("none");
              }
            }
          }
        })
        .catch((err) => {
          console.error("[updater] check failed:", err);
          setUpdateStatus("none");
        });
    }

    return () => {
      unlistenRef.current?.();
    };
  }, [isMac]);

  const handleUpdateClick = async () => {
    if (updateStatus === "macAvailable") await openUrl(MAC_RELEASES_URL);
    else if (updateStatus === "readyToRestart") await relaunch();
  };

  const handleMinimize = () => {
    if (inTauri()) getCurrentWindow().minimize().catch(() => { });
  };

  const handleToggleMaximize = () => {
    if (inTauri()) getCurrentWindow().toggleMaximize().catch(() => { });
  };

  const handleClose = () => {
    if (inTauri()) getCurrentWindow().close().catch(() => { });
  };

  if (isMac) {
    return (
      <div className={cn("MacControls", className)} data-tauri-drag-region="false">
        <Button type="button" className="MacBtn MacBtn-close" aria-label="Close" onClick={handleClose}>
          <FiX />
        </Button>
        <Button type="button" className="MacBtn" aria-label="Minimize" onClick={handleMinimize}>
          <FiMinus />
        </Button>
        <Button type="button" className="MacBtn" aria-label={isMaximized ? "Restore" : "Maximize"} onClick={handleToggleMaximize}>
          {isMaximized ? <FiCopy /> : <FiSquare />}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("WinControls", className)} data-tauri-drag-region="false">
      {updateStatus === "downloading" && (
        <span className="Titlebar-update-badge Titlebar-update-downloading">
          <FiRefreshCw className="Titlebar-spinner" />
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
      <Button type="button" className="WinBtn" aria-label="Minimize" onClick={handleMinimize}>
        <VscChromeMinimize />
      </Button>
      <Button type="button" className="WinBtn" aria-label={isMaximized ? "Restore" : "Maximize"} onClick={handleToggleMaximize}>
        {isMaximized ? <VscChromeRestore /> : <VscChromeMaximize />}
      </Button>
      <Button type="button" className="WinBtn WinBtn-close" aria-label="Close" onClick={handleClose}>
        <VscChromeClose />
      </Button>
    </div>
  );
}

export function Titlebar({ title, className }: { title?: string; className?: string }) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(typeof navigator !== "undefined" && navigator.userAgent.includes("Mac"));
  }, []);

  return (
    <div className={cn("Titlebar", isMac && "Titlebar-mac", className)} data-tauri-drag-region>
      {isMac ? (
        <>
          <WindowControls isMac={true} />
          {title && <span className="Titlebar-title Titlebar-title-mac" data-tauri-drag-region>{title}</span>}
          <div className="Titlebar-right" />
        </>
      ) : (
        <>
          {title && <span className="Titlebar-title" data-tauri-drag-region>{title}</span>}
          <WindowControls isMac={false} />
        </>
      )}
    </div>
  );
}
