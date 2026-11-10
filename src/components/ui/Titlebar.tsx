import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
} from "react-icons/vsc";
import {
  LuCloud,
  LuMonitor,
  LuPanelLeft,
  LuPanelLeftClose,
  LuPanelRight,
  LuPanelRightClose,
  LuRotateCw,
} from "react-icons/lu";
import { useArtifactsStore } from "../../lib/artifacts";
import { useUpdaterStore } from "../../lib/updater";
import { useChatStore } from "../../lib/store";
import { useWorkspaceStore, type WorkspaceMode } from "../../lib/workspace";
import { cn, IS_MAC } from "../../lib/utils";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./DropdownMenu";
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
          <LuRotateCw className="Titlebar-spinner" />
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
          <LuRotateCw />
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
          <LuRotateCw />
          <span>Restart to update</span>
        </Button>
      </Tooltip>
    );
  }

  if (status === "installing") {
    return (
      <Tooltip content="Applying update" side="bottom">
        <span className="Titlebar-update-badge Titlebar-update-downloading">
          <LuRotateCw className="Titlebar-spinner" />
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
          <LuRotateCw />
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

const MODES: { id: WorkspaceMode; label: string; hint: string; Icon: typeof LuCloud }[] = [
  { id: "computer", label: "This computer", hint: "Work on folders on this machine", Icon: LuMonitor },
  { id: "cloud", label: "Cloud", hint: "Work on a GitHub repo in the cloud", Icon: LuCloud },
];

function ModeToggle() {
  const mode = useWorkspaceStore((s) => s.mode);
  const setMode = useWorkspaceStore((s) => s.setMode);
  const busy = useWorkspaceStore((s) => s.busy);
  const streaming = useChatStore((s) => s.streaming);
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <DropdownMenu>
      <Tooltip content={current.label} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button className="IconBtn Titlebar-iconBtn" aria-label="Workspace mode" disabled={busy || streaming}>
            <current.Icon />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={6}>
        {MODES.map(({ id, label, hint, Icon }) => (
          <DropdownMenuItem
            key={id}
            className="ModeItem"
            data-selected={mode === id || undefined}
            onSelect={() => void setMode(id)}
          >
            <Icon />
            <span className="ModeItem-text">
              <span>{label}</span>
              <span className="ModeItem-hint">{hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
        {panelOpen ? <LuPanelRightClose /> : <LuPanelRight />}
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
              <LuPanelLeftClose />
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
                <LuPanelLeft />
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
          {inShell && <ModeToggle />}
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
