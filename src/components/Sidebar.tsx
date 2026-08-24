import { useState } from "react";
import {
  VscCheck,
  VscClose,
  VscEditSparkle,
  VscSignOut,
  VscTrash,
  VscLibrary,
  VscExtensions,
} from "react-icons/vsc";
import { Avatar } from "./ChatPrimitives";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { useAuthStore } from "../lib/auth";
import { useChatStore } from "../lib/store";
import { formatRelativeTime, formatUsd } from "../lib/api";
import type { AppView } from "../App";

const BUDGET_WARN_PCT = 75;
const BUDGET_DANGER_PCT = 90;

function budgetLabel(cost: number, limit: number): string {
  return limit > 0 ? `${formatUsd(cost)} / ${formatUsd(limit)}` : formatUsd(cost);
}

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

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const usedPct =
    budget && budget.limitUsd > 0
      ? Math.min(100, Math.max(0, (budget.costUsd / budget.limitUsd) * 100))
      : 0;
  const budgetLevel =
    usedPct >= BUDGET_DANGER_PCT ? "danger" : usedPct >= BUDGET_WARN_PCT ? "warn" : "ok";

  return (
    <aside className="Sidebar">

      <div className="Sidebar-header">
        <Button
          className="Sidebar-newchat"
          onClick={() => { newChat(); onViewChange("chat"); }}
          disabled={streaming}
          aria-label="New chat"
        >
          <VscEditSparkle />
          <span>New chat</span>
        </Button>
      </div>

      <nav className="Sidebar-viewnav" aria-label="Views">
        <Tooltip content="Knowledge Library" side="right">
          <button
            type="button"
            className="Sidebar-viewbtn"
            data-active={currentView === "library"}
            onClick={() => onViewChange("library")}
            aria-label="Knowledge Library"
          >
            <VscLibrary />
            <span>Library</span>
          </button>
        </Tooltip>
        <Tooltip content="Integrations" side="right">
          <button
            type="button"
            className="Sidebar-viewbtn"
            data-active={currentView === "connectors"}
            onClick={() => onViewChange("connectors")}
            aria-label="Integrations"
          >
            <VscExtensions />
            <span>Integrations</span>
          </button>
        </Tooltip>
      </nav>

      <nav className="Sidebar-threads" aria-label="Conversations">
        {sessions.length === 0 && (
          <p className="Sidebar-empty">No conversations yet.</p>
        )}
        {sessions.map((session) => {
          const confirming = pendingDelete === session.id;
          const isActive = session.id === currentSessionId;
          return (
            <div
              key={session.id}
              className="ThreadItem"
              data-active={isActive}
              data-confirming={confirming}
            >
              <button
                type="button"
                className="ThreadItem-btn"
                aria-current={isActive ? "page" : undefined}
                disabled={streaming}
                onClick={() => {
                  void selectSession(session.id);
                  onViewChange("chat");
                }}
              >
                <span className="ThreadItem-title">
                  {session.title || "New chat"}
                </span>
                <span className="ThreadItem-time">
                  {formatRelativeTime(session.updatedAt)}
                </span>
              </button>

              {confirming ? (
                <div className="ThreadItem-confirm">
                  <Tooltip content="Confirm delete" side="top">
                    <Button
                      className="ThreadItem-confirmYes"
                      aria-label={`Confirm delete ${session.title || "New chat"}`}
                      onClick={() => {
                        setPendingDelete(null);
                        void deleteSession(session.id);
                      }}
                    >
                      <VscCheck />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Cancel" side="top">
                    <Button
                      className="ThreadItem-confirmNo"
                      aria-label="Cancel delete"
                      onClick={() => setPendingDelete(null)}
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
                    onClick={() => setPendingDelete(session.id)}
                  >
                    <VscTrash />
                  </Button>
                </Tooltip>
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

export default Sidebar;
