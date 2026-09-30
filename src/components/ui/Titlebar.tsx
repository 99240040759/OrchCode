import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
  VscLayoutSidebarLeft,
  VscLayoutSidebarLeftOff,
  VscLayoutSidebarRight,
  VscLayoutSidebarRightOff,
  VscRefresh,
} from "react-icons/vsc";
import { useArtifactsStore } from "../../lib/artifacts";
import { useUpdaterStore } from "../../lib/updater";
import { useChatStore } from "../../lib/store";
import { cn } from "../../lib/api";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

function UpdateBadge() {
  const status  = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const percent = useUpdaterStore((s) => s.percent);
  const apply   = useUpdaterStore((s) => s.apply);

  if (status === "downloading") {
    return (
      <Tooltip content={`Downloading update v${version}`} side="bottom">
        <span className="Titlebar-update-badge Titlebar-update-downloading">
          <VscRefresh className="Titlebar-spinner" />
          <span>{percent > 0 && percent < 100 ? `${percent}%` : "Downloading…"}</span>
        </span>
      </Tooltip>
    );
  }

  if (status === "readyToRestart") {
    return (
      <Tooltip content={`v${version} downloaded — restart to apply`} side="bottom">
        <Button
          className="Titlebar-update-badge Titlebar-update-ready"
          onClick={() => void apply()}
        >
          <VscRefresh />
          <span>Restart to update</span>
        </Button>
      </Tooltip>
    );
  }

  if (status === "installing") {
    return (
      <Tooltip content="Applying update" side="bottom">
        <span className="Titlebar-update-badge Titlebar-update-downloading">
          <VscRefresh className="Titlebar-spinner" />
          <span>Restarting…</span>
        </span>
      </Tooltip>
    );
  }

  return null;
}

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void appWindow.isMaximized().then((value) => {
        if (!disposed) setIsMaximized(value);
      });
    };
    sync();
    void appWindow.onResized(sync).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const appWindow = getCurrentWindow();

  return (
    <div className="WinControls">
      <Button className="WinBtn" aria-label="Minimize" onClick={() => void appWindow.minimize()}>
        <VscChromeMinimize />
      </Button>
      <Button
        className="WinBtn"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={() => void appWindow.toggleMaximize()}
      >
        {isMaximized ? <VscChromeRestore /> : <VscChromeMaximize />}
      </Button>
      <Button className="WinBtn WinBtn-close" aria-label="Close" onClick={() => void appWindow.close()}>
        <VscChromeClose />
      </Button>
    </div>
  );
}

interface TitlebarProps {
  title?: string;
  className?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

function SessionTitle({ fallback }: { fallback?: string }) {
  const sessionTitle = useChatStore((s) => {
    const id = s.currentSessionId;
    return s.sessions.find((sess) => sess.id === id)?.title ?? null;
  });
  const text = sessionTitle || fallback;
  if (!text) return null;
  return (
    <span className="Titlebar-title" data-tauri-drag-region>
      {text}
    </span>
  );
}

function ArtifactPanelToggle() {
  const panelOpen    = useArtifactsStore((s) => s.panelOpen);
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen);
  const label = panelOpen ? "Hide artifact panel" : "Show artifact panel";
  return (
    <Tooltip content={label} side="bottom">
      <Button
        className="IconBtn Titlebar-iconBtn"
        aria-label={label}
        data-active={panelOpen}
        onClick={() => setPanelOpen(!panelOpen)}
      >
        {panelOpen ? <VscLayoutSidebarRightOff /> : <VscLayoutSidebarRight />}
      </Button>
    </Tooltip>
  );
}

export function Titlebar({ title, className, sidebarOpen, onToggleSidebar }: TitlebarProps) {
  const inShell = Boolean(onToggleSidebar);

  return (
    <div className={cn("Titlebar", IS_MAC && "Titlebar-mac", className)} data-tauri-drag-region>
      {IS_MAC && <div className="MacTrafficLightSpacer" data-tauri-drag-region />}

      <div className="Titlebar-left">
        {onToggleSidebar && (
          <Tooltip content={sidebarOpen ? "Hide sidebar" : "Show sidebar"} side="bottom">
            <Button
              className="IconBtn Titlebar-iconBtn"
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              data-active={sidebarOpen}
              onClick={onToggleSidebar}
            >
              {sidebarOpen ? <VscLayoutSidebarLeftOff /> : <VscLayoutSidebarLeft />}
            </Button>
          </Tooltip>
        )}
        {inShell ? <SessionTitle fallback={title} /> : title && (
          <span className="Titlebar-title" data-tauri-drag-region>
            {title}
          </span>
        )}
      </div>

      <div className="Titlebar-drag" data-tauri-drag-region />

      <div className="Titlebar-right">
        <UpdateBadge />
        {inShell && <ArtifactPanelToggle />}
        {!IS_MAC && <WindowControls />}
      </div>
    </div>
  );
}
