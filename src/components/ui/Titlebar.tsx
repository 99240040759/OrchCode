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
import { cn, IS_MAC } from "../../lib/utils";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import type { AppView } from "../../App";

function UpdateBadge() {
  const status  = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const percent = useUpdaterStore((s) => s.percent);
  const error   = useUpdaterStore((s) => s.error);
  const apply   = useUpdaterStore((s) => s.apply);
  const start   = useUpdaterStore((s) => s.start);

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

  if (status === "manualAvailable") {
    return (
      <Tooltip content={`v${version} available — click to download`} side="bottom">
        <Button
          className="Titlebar-update-badge Titlebar-update-ready"
          onClick={() => void apply()}
        >
          <VscRefresh />
          <span>Update available</span>
        </Button>
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

  if (status === "failed") {
    return (
      <Tooltip content={`Update failed: ${error || "Unknown error"} — click to retry`} side="bottom">
        <Button
          className="Titlebar-update-badge Titlebar-update-failed"
          onClick={() => void start()}
        >
          <VscRefresh />
          <span>Update failed</span>
        </Button>
      </Tooltip>
    );
  }

  return null;
}

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
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
  }, [appWindow]);

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
  view?: AppView;
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

export function Titlebar({ title, className, sidebarOpen, onToggleSidebar, view }: TitlebarProps) {
  const inShell = Boolean(onToggleSidebar);
  const showSidebarSegment = inShell && Boolean(sidebarOpen);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const showArtifactSegment = inShell && panelOpen && (view === undefined || view === "chat");

  return (
    <div
      className={cn(
        "Titlebar",
        IS_MAC && "Titlebar-mac",
        showSidebarSegment && "Titlebar--with-sidebar",
        showArtifactSegment && "Titlebar--with-artifacts",
        className
      )}
      data-tauri-drag-region
    >
      {showSidebarSegment && (
        <div className="Titlebar-sidebar" data-tauri-drag-region>
          {IS_MAC && <div className="MacTrafficLightSpacer" data-tauri-drag-region />}
          <Tooltip content="Hide sidebar" side="bottom">
            <Button
              className="IconBtn Titlebar-iconBtn"
              aria-label="Hide sidebar"
              data-active={true}
              onClick={onToggleSidebar}
            >
              <VscLayoutSidebarLeftOff />
            </Button>
          </Tooltip>
          <div className="Titlebar-drag" data-tauri-drag-region />
        </div>
      )}

      <div className="Titlebar-main" data-tauri-drag-region>
        <div
          className={cn(
            "Titlebar-left",
            !showSidebarSegment && IS_MAC && "Titlebar-left-mac"
          )}
        >
          {!showSidebarSegment && IS_MAC && (
            <div className="MacTrafficLightSpacer" data-tauri-drag-region />
          )}
          {!showSidebarSegment && onToggleSidebar && (
            <Tooltip content="Show sidebar" side="bottom">
              <Button
                className="IconBtn Titlebar-iconBtn"
                aria-label="Show sidebar"
                data-active={false}
                onClick={onToggleSidebar}
              >
                <VscLayoutSidebarLeft />
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
          {!showArtifactSegment && inShell && (view === undefined || view === "chat") && (
            <ArtifactPanelToggle />
          )}
          {!showArtifactSegment && !IS_MAC && <WindowControls />}
        </div>
      </div>

      {showArtifactSegment && (
        <div className="Titlebar-artifact-cap" data-tauri-drag-region>
          <div className="Titlebar-drag" data-tauri-drag-region />
          <ArtifactPanelToggle />
          {!IS_MAC && <WindowControls />}
        </div>
      )}
    </div>
  );
}
