import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
  VscClose,
  VscCopy,
  VscDash,
  VscLayoutSidebarLeft,
  VscLayoutSidebarLeftOff,
  VscLayoutSidebarRight,
  VscLayoutSidebarRightOff,
  VscPrimitiveSquare,
  VscRefresh,
} from "react-icons/vsc";
import { useArtifactsStore } from "../../lib/artifacts";
import { useUpdaterStore, useChatStore } from "../../lib/store";
import { cn } from "../../lib/api";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

export const IS_MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

function UpdateBadge() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const percent = useUpdaterStore((s) => s.percent);
  const apply = useUpdaterStore((s) => s.apply);

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
          <VscClose />
        </Button>
        <Button className="MacBtn" aria-label="Minimize" onClick={minimize}>
          <VscDash />
        </Button>
        <Button
          className="MacBtn"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={toggleMaximize}
        >
          {isMaximized ? <VscCopy /> : <VscPrimitiveSquare />}
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

interface TitlebarProps {
  title?: string;
  className?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function Titlebar({ title, className, sidebarOpen, onToggleSidebar }: TitlebarProps) {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sessionTitle = sessions.find((s) => s.id === currentSessionId)?.title;

  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen);

  return (
    <div className={cn("Titlebar", IS_MAC && "Titlebar-mac", className)} data-tauri-drag-region>
      {IS_MAC && <WindowControls />}

      {/* Left controls — sidebar toggle + session title */}
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
        {sessionTitle && (
          <span className="Titlebar-session-title" data-tauri-drag-region>
            {sessionTitle}
          </span>
        )}
        {title && !sessionTitle && (
          <span className={cn("Titlebar-title", IS_MAC && "Titlebar-title-mac")} data-tauri-drag-region>
            {title}
          </span>
        )}
      </div>

      {/* Drag region filler */}
      <div className="Titlebar-drag" data-tauri-drag-region />

      <div className="Titlebar-right">
        <UpdateBadge />
        <Tooltip content={panelOpen ? "Hide artifact panel" : "Show artifact panel"} side="bottom">
          <Button
            className="IconBtn Titlebar-iconBtn"
            aria-label={panelOpen ? "Hide artifact panel" : "Show artifact panel"}
            data-active={panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {panelOpen ? <VscLayoutSidebarRightOff /> : <VscLayoutSidebarRight />}
          </Button>
        </Tooltip>
        {!IS_MAC && <WindowControls />}
      </div>
    </div>
  );
}

export default Titlebar;
