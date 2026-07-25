import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FiCopy, FiMinus, FiRefreshCw, FiSquare, FiX } from "react-icons/fi";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
} from "react-icons/vsc";
import { useUpdaterStore } from "../../lib/updater";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

export const IS_MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

function UpdateBadge() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const percent = useUpdaterStore((s) => s.percent);
  const apply = useUpdaterStore((s) => s.apply);

  if (status === "downloading") {
    return (
      <span
        className="Titlebar-update-badge Titlebar-update-downloading"
        title={`Downloading update v${version}`}
      >
        <FiRefreshCw className="Titlebar-spinner" />
        <span>{percent > 0 && percent < 100 ? `${percent}%` : "Downloading…"}</span>
      </span>
    );
  }

  if (status === "readyToRestart") {
    return (
      <Button
        className="Titlebar-update-badge Titlebar-update-ready"
        onClick={() => void apply()}
        title={`v${version} downloaded — restart to apply`}
      >
        <FiRefreshCw />
        <span>Restart to update</span>
      </Button>
    );
  }

  if (status === "installing") {
    return (
      <span className="Titlebar-update-badge Titlebar-update-downloading" title="Applying update">
        <FiRefreshCw className="Titlebar-spinner" />
        <span>Restarting…</span>
      </span>
    );
  }

  return null;
}

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    const sync = () => {
      void appWindow.isMaximized().then(setIsMaximized);
    };
    sync();
    void appWindow.onResized(sync).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, []);

  const minimize = () => void getCurrentWindow().minimize();
  const toggleMaximize = () => void getCurrentWindow().toggleMaximize();
  const close = () => void getCurrentWindow().close();

  if (IS_MAC) {
    return (
      <div className="MacControls">
        <Button className="MacBtn MacBtn-close" aria-label="Close" onClick={close}>
          <FiX />
        </Button>
        <Button className="MacBtn" aria-label="Minimize" onClick={minimize}>
          <FiMinus />
        </Button>
        <Button
          className="MacBtn"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={toggleMaximize}
        >
          {isMaximized ? <FiCopy /> : <FiSquare />}
        </Button>
      </div>
    );
  }

  return (
    <div className="WinControls">
      <Button className="WinBtn" aria-label="Minimize" onClick={minimize}>
        <VscChromeMinimize />
      </Button>
      <Button
        className="WinBtn"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={toggleMaximize}
      >
        {isMaximized ? <VscChromeRestore /> : <VscChromeMaximize />}
      </Button>
      <Button className="WinBtn WinBtn-close" aria-label="Close" onClick={close}>
        <VscChromeClose />
      </Button>
    </div>
  );
}

export function Titlebar({ title, className }: { title?: string; className?: string }) {
  return (
    <div className={cn("Titlebar", IS_MAC && "Titlebar-mac", className)} data-tauri-drag-region>
      {IS_MAC ? (
        <>
          <WindowControls />
          {title && (
            <span className="Titlebar-title Titlebar-title-mac" data-tauri-drag-region>
              {title}
            </span>
          )}
          <div className="Titlebar-right">
            <UpdateBadge />
          </div>
        </>
      ) : (
        <>
          {title && (
            <span className="Titlebar-title" data-tauri-drag-region>
              {title}
            </span>
          )}
          <div className="Titlebar-right">
            <UpdateBadge />
            <WindowControls />
          </div>
        </>
      )}
    </div>
  );
}

export default Titlebar;
