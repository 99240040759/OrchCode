import React, { useState, useEffect, useCallback } from "react";
import {
  VscAdd,
  VscCheck,
  VscClose,
  VscExtensions,
  VscFolder,
  VscFolderOpened,
  VscNewFolder,
  VscRocket,
  VscSignOut,
  VscTrash,
} from "react-icons/vsc";
import { Avatar } from "./ChatPrimitives";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";
import { useAuthStore } from "../lib/auth";
import { useChatStore } from "../lib/store";
import { useWorkspaceStore } from "../lib/workspace";
import { formatRelativeTime } from "../lib/api";
import { formatUsd } from "../lib/utils";
import type { SessionSummary } from "../lib/api";
import type { AppView } from "../App";

const BUDGET_WARN_PCT = 75;
const BUDGET_DANGER_PCT = 90;

function budgetLabel(cost: number, limit: number): string {
  return limit > 0 ? `${formatUsd(cost)} / ${formatUsd(limit)}` : formatUsd(cost);
}

const SessionItem = React.memo(function SessionItem({
  session,
  isActive,
  streaming,
  nowTick,
  onSelect,
  onDelete,
}: {
  session: SessionSummary;
  isActive: boolean;
  streaming: boolean;
  nowTick: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  void nowTick;
  const relativeTime = formatRelativeTime(session.updatedAt);

  return (
    <div
      className="ThreadItem"
      data-active={isActive}
    >
      <Tooltip
        content={streaming && !isActive ? "Stop the agent to switch chats" : undefined}
        side="right"
      >
        <button
          type="button"
          className="ThreadItem-btn"
          aria-current={isActive ? "page" : undefined}
          disabled={streaming && !isActive}
          onClick={() => onSelect(session.id)}
        >
          <span className="ThreadItem-title" title={session.title || "New chat"}>
            {session.title || "New chat"}
          </span>
          {!confirming && <span className="ThreadItem-time">{relativeTime}</span>}
        </button>
      </Tooltip>

      {confirming ? (
        <div className="ThreadItem-confirm">
          <Tooltip content="Confirm delete" side="top">
            <Button
              className="ThreadItem-confirmYes"
              aria-label={`Confirm delete ${session.title || "New chat"}`}
              onClick={() => {
                setConfirming(false);
                onDelete(session.id);
              }}
            >
              <VscCheck />
            </Button>
          </Tooltip>
          <Tooltip content="Cancel" side="top">
            <Button
              className="ThreadItem-confirmNo"
              aria-label="Cancel delete"
              onClick={() => setConfirming(false)}
            >
              <VscClose />
            </Button>
          </Tooltip>
        </div>
      ) : (
        <Tooltip content="Delete" side="right">
          <Button
            className="ThreadItem-del"
            aria-label={`Delete ${session.title || "New chat"}`}
            onClick={() => setConfirming(true)}
          >
            <VscTrash />
          </Button>
        </Tooltip>
      )}
    </div>
  );
});

interface SidebarProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const streaming = useChatStore((s) => s.streaming);
  const newChat = useChatStore((s) => s.newChat);
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const budget = useChatStore((s) => s.budget);

  const currentWs = useWorkspaceStore((s) => s.current);
  const allWorkspaces = useWorkspaceStore((s) => s.all);
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const createQuick = useWorkspaceStore((s) => s.createQuickProject);
  const removeWs = useWorkspaceStore((s) => s.remove);
  const wsBusy = useWorkspaceStore((s) => s.busy);
  const wsError = useWorkspaceStore((s) => s.error);
  const dismissWsError = useWorkspaceStore((s) => s.dismissError);

  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [pendingWsDelete, setPendingWsDelete] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const wsLocked = streaming || wsBusy;

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const onWsMenuOpenChange = (open: boolean) => {
    setWsMenuOpen(open);
    if (!open) setPendingWsDelete(null);
  };

  const handleSelectSession = useCallback(
    (id: string) => {
      void selectSession(id);
      onViewChange("chat");
    },
    [selectSession, onViewChange]
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      void deleteSession(id);
    },
    [deleteSession]
  );

  const usedPct =
    budget && budget.limitUsd > 0
      ? Math.min(100, Math.max(0, (budget.costUsd / budget.limitUsd) * 100))
      : 0;
  const budgetLevel =
    usedPct >= BUDGET_DANGER_PCT ? "danger" : usedPct >= BUDGET_WARN_PCT ? "warn" : "ok";

  const workspacesToDisplay =
    allWorkspaces.length > 0
      ? allWorkspaces
      : currentWs
        ? [currentWs]
        : [];

  return (
    <aside className="Sidebar">
      <div className="Sidebar-header">
        <Button
          className="Sidebar-newchat"
          onClick={() => {
            newChat();
            onViewChange("chat");
          }}
          disabled={streaming}
          aria-label="New Conversation"
        >
          <VscAdd />
          <span>New Conversation</span>
        </Button>
      </div>

      <nav className="Sidebar-viewnav" aria-label="Views">
        <Tooltip content="Integrations" side="right">
          <button
            type="button"
            className="Sidebar-viewbtn"
            data-active={currentView === "connectors"}
            onClick={() => onViewChange(currentView === "connectors" ? "chat" : "connectors")}
            aria-label="Integrations"
          >
            <VscExtensions />
            <span>Integrations</span>
          </button>
        </Tooltip>
      </nav>

      {wsError && (
        <div className="ChatPane-error" role="alert">
          <span>{wsError}</span>
          <button type="button" className="ChatPane-errorClose" aria-label="Dismiss error" onClick={dismissWsError}>
            <VscClose />
          </button>
        </div>
      )}

      <div className="Sidebar-projectsHeader">
        <span className="Sidebar-projectsTitle">Projects</span>
        <div className="Sidebar-projectsActions">
          <DropdownMenu open={wsMenuOpen} onOpenChange={onWsMenuOpenChange}>
            <Tooltip content="Add project" side="right">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="IconBtn Sidebar-projectsActionBtn"
                  aria-label="Add project"
                >
                  <VscNewFolder />
                </button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent sideOffset={4} align="end">
              <DropdownMenuItem disabled={wsLocked} onSelect={() => void pickAndOpen()}>
                <VscFolderOpened />
                <span>Open folder…</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={wsLocked} onSelect={() => void createQuick()}>
                <VscRocket />
                <span>New quick project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <nav className="Sidebar-threads" aria-label="Projects and conversations">
        {workspacesToDisplay.map((ws) => {
          const isCurrentWs = ws.id === currentWs?.id;
          const FolderIconComponent = isCurrentWs ? VscFolderOpened : VscFolder;
          return (
            <div key={ws.id} className="Sidebar-projectGroup">
              <div className="Sidebar-wsRow" data-active={isCurrentWs}>
                <button
                  type="button"
                  className="Sidebar-wsBtn"
                  disabled={wsLocked && !isCurrentWs}
                  onClick={() => {
                    if (!isCurrentWs) void switchTo(ws.id);
                    onViewChange("chat");
                  }}
                >
                  <FolderIconComponent className="Sidebar-wsIcon" />
                  <span className="Sidebar-wsName">{ws.name}</span>
                </button>

                {pendingWsDelete === ws.id ? (
                  <div className="WsMenuItem-confirm">
                    <button
                      type="button"
                      className="WsMenuItem-confirmYes"
                      title={
                        ws.isQuickProject
                          ? "Delete this quick project and its chats"
                          : "Remove from list (files and chats are kept)"
                      }
                      disabled={wsLocked}
                      onClick={() => {
                        setPendingWsDelete(null);
                        void removeWs(ws.id);
                      }}
                    >
                      <VscCheck />
                    </button>
                    <button
                      type="button"
                      className="WsMenuItem-confirmNo"
                      title="Cancel"
                      onClick={() => setPendingWsDelete(null)}
                    >
                      <VscClose />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="WsMenuItem-del"
                    title={ws.isQuickProject ? "Delete quick project" : "Remove from list"}
                    disabled={wsLocked}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingWsDelete(ws.id);
                    }}
                  >
                    <VscTrash />
                  </button>
                )}
              </div>

              {isCurrentWs && (
                <div className="Sidebar-projectSessions">
                  {sessions.length === 0 && (
                    <p className="Sidebar-empty">No conversations yet.</p>
                  )}
                  {sessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isActive={currentView === "chat" && session.id === currentSessionId}
                      streaming={streaming}
                      nowTick={nowTick}
                      onSelect={handleSelectSession}
                      onDelete={handleDeleteSession}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="Sidebar-footer">
        {budget && (
          <Tooltip
            content={`${formatUsd(budget.costUsd)} spent of ${formatUsd(budget.limitUsd)} limit (${Math.round(usedPct)}%)`}
            side="top"
          >
            <div className="BudgetBar" data-level={budgetLevel}>
              <div className="BudgetBar-top">
                <span>Usage this {budget.period}</span>
                <span>{budgetLabel(budget.costUsd, budget.limitUsd)}</span>
              </div>
              <div
                className="BudgetBar-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usedPct)}
              >
                <div className="BudgetBar-fill" style={{ width: `${usedPct}%` }} />
              </div>
              {!budget.allowed && (
                <span className="BudgetBar-blocked">Usage limit reached</span>
              )}
            </div>
          </Tooltip>
        )}

        <div className="Account">
          <Avatar src={user?.avatarUrl} fallback={user?.initial ?? "?"} />
          <span className="Account-info">
            <span className="Account-name">{user?.displayName ?? "You"}</span>
            <span className="Account-plan">{user?.email ?? "Signed in"}</span>
          </span>
          <Tooltip content="Sign out" side="top">
            <Button
              className="IconBtn Account-logout"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <VscSignOut />
            </Button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
