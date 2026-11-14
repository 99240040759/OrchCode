import { memo, useEffect, useState } from "react";
import { LuBlocks, LuCheck, LuEllipsis, LuLogOut, LuPanelLeft, LuPlus, LuTrash2, LuX } from "react-icons/lu";
import { formatRelativeTime, type SessionSummary } from "../../lib/api";
import { useAuthStore } from "../../lib/auth";
import { useChatStore } from "../../lib/store";
import { formatUsd } from "../../lib/utils";
import { useWorkspaceStore, type WorkspaceMeta } from "../../lib/workspace";
import { Avatar } from "../common/Avatar";
import { Button, IconButton } from "../ui/Button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/Menu";
import { Tooltip } from "../ui/Tooltip";
import { TrafficSpacer } from "../ui/WindowControls";
import { OpenProjectItems, ProjectIcon } from "../projects/ProjectMenu";
import { useShell } from "./shellStore";

const showChat = () => useShell.getState().setView("chat");

function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
}

const SessionRow = memo(function SessionRow({
  session,
  active,
  locked,
}: {
  session: SessionSummary;
  active: boolean;
  locked: boolean;
}) {
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const [confirming, setConfirming] = useState(false);
  const title = session.title || "New conversation";

  return (
    <Tooltip content={locked ? "Stop the agent to switch conversations" : undefined} side="right">
      <div className="row" data-depth="1" data-active={active} onMouseLeave={() => setConfirming(false)}>
        <button
          type="button"
          className="row-main"
          title={title}
          disabled={locked}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            void selectSession(session.id);
            showChat();
          }}
        >
          <span className="row-label">{title}</span>
        </button>
        <span className="row-meta">{formatRelativeTime(session.updatedAt)}</span>
        <span className="row-actions" data-pinned={confirming || undefined}>
          {confirming ? (
            <>
              <IconButton label="Delete conversation" side="right" size="sm" variant="danger" onClick={() => void deleteSession(session.id)}>
                <LuCheck />
              </IconButton>
              <IconButton label="Cancel" side="right" size="sm" onClick={() => setConfirming(false)}>
                <LuX />
              </IconButton>
            </>
          ) : (
            <IconButton label="Delete" side="right" size="sm" onClick={() => setConfirming(true)}>
              <LuTrash2 />
            </IconButton>
          )}
        </span>
      </div>
    </Tooltip>
  );
});

function ProjectRow({ project, current, locked }: { project: WorkspaceMeta; current: boolean; locked: boolean }) {
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const remove = useWorkspaceStore((s) => s.remove);
  const busy = useWorkspaceStore((s) => s.busy);

  return (
    <div className="row" data-current={current || undefined}>
      <button
        type="button"
        className="row-main"
        title={project.path}
        disabled={locked && !current}
        onClick={() => {
          if (!current) void switchTo(project.id);
          showChat();
        }}
      >
        <ProjectIcon project={project} open={current} />
        <span className="row-label">{project.name}</span>
      </button>
      <span className="row-actions">
        <Menu>
          <MenuTrigger asChild>
            <Button icon size="sm" aria-label={`${project.name} options`} disabled={busy}>
              <LuEllipsis />
            </Button>
          </MenuTrigger>
          <MenuContent align="start" side="right">
            <MenuItem onSelect={() => void remove(project.id)}>
              <LuX />
              <span className="row-label">
                Remove from list
                <span className="menu-hint">Files and conversations are kept</span>
              </span>
            </MenuItem>
          </MenuContent>
        </Menu>
      </span>
    </div>
  );
}

function Projects() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const streaming = useChatStore((s) => s.streaming);
  const view = useShell((s) => s.view);
  const current = useWorkspaceStore((s) => s.current);
  const all = useWorkspaceStore((s) => s.all);
  const busy = useWorkspaceStore((s) => s.busy);
  const error = useWorkspaceStore((s) => s.error);
  const dismissError = useWorkspaceStore((s) => s.dismissError);
  const locked = streaming || busy;
  const projects = all.length > 0 ? all : current ? [current] : [];
  useMinuteTick();

  return (
    <>
      <div className="side-section">
        <span>Projects</span>
        <Menu>
          <Tooltip content="Add project" side="right">
            <MenuTrigger asChild>
              <Button icon size="sm" aria-label="Add project" disabled={locked}>
                <LuPlus />
              </Button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent align="start" side="right">
            <OpenProjectItems />
          </MenuContent>
        </Menu>
      </div>
      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <IconButton label="Dismiss" size="sm" onClick={dismissError}>
            <LuX />
          </IconButton>
        </div>
      )}
      <nav className="side-list" aria-label="Projects and conversations">
        {projects.map((project) => {
          const isCurrent = project.id === current?.id;
          return (
            <div key={project.id}>
              <ProjectRow project={project} current={isCurrent} locked={locked} />
              {isCurrent && sessions.length === 0 && <p className="side-empty">No conversations yet</p>}
              {isCurrent &&
                sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={view === "chat" && session.id === currentSessionId}
                    locked={streaming && session.id !== currentSessionId}
                  />
                ))}
            </div>
          );
        })}
      </nav>
    </>
  );
}

function Usage() {
  const budget = useChatStore((s) => s.budget);
  if (!budget) return null;
  const pct = budget.limitUsd > 0 ? Math.min(100, Math.max(0, (budget.costUsd / budget.limitUsd) * 100)) : 0;
  const level = pct >= 90 ? "danger" : pct >= 75 ? "warn" : undefined;
  return (
    <Tooltip
      content={`${formatUsd(budget.costUsd)} spent of ${formatUsd(budget.limitUsd)} (${Math.round(pct)}%)`}
      side="top"
    >
      <div className="usage" data-level={level}>
        <div className="usage-top">
          <span>Usage this {budget.period}</span>
          <span>
            {budget.limitUsd > 0 ? `${formatUsd(budget.costUsd)} / ${formatUsd(budget.limitUsd)}` : formatUsd(budget.costUsd)}
          </span>
        </div>
        <div className="usage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="usage-fill" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        {!budget.allowed && <span className="usage-blocked">Usage limit reached</span>}
      </div>
    </Tooltip>
  );
}

function Account() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  return (
    <div className="account">
      <Avatar src={user?.avatarUrl} fallback={user?.initial ?? "?"} />
      <span className="account-text">
        <span className="account-name truncate">{user?.displayName ?? "You"}</span>
        <span className="account-mail truncate">{user?.email ?? "Signed in"}</span>
      </span>
      <IconButton label="Sign out" side="top" onClick={() => void signOut()}>
        <LuLogOut />
      </IconButton>
    </div>
  );
}

export function Sidebar() {
  const view = useShell((s) => s.view);
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const setView = useShell((s) => s.setView);
  const toggleSidebar = useShell((s) => s.toggleSidebar);
  const streaming = useChatStore((s) => s.streaming);
  const newChat = useChatStore((s) => s.newChat);

  return (
    <aside className="side" inert={!sidebarOpen}>
      <div className="bar" data-tauri-drag-region>
        <TrafficSpacer />
        <IconButton label="Hide sidebar" onClick={toggleSidebar}>
          <LuPanelLeft />
        </IconButton>
        <div className="bar-fill" data-tauri-drag-region />
      </div>
      <div className="side-body">
        <Button
          variant="subtle"
          size="lg"
          block
          disabled={streaming}
          onClick={() => {
            newChat();
            setView("chat");
          }}
        >
          <LuPlus />
          <span>New conversation</span>
        </Button>
        <nav className="side-nav" aria-label="Views">
          <button
            type="button"
            className="row"
            data-active={view === "integrations"}
            onClick={() => setView(view === "integrations" ? "chat" : "integrations")}
          >
            <LuBlocks />
            <span className="row-label">Integrations</span>
          </button>
        </nav>
        <Projects />
        <div className="side-foot">
          <Usage />
          <Account />
        </div>
      </div>
    </aside>
  );
}
