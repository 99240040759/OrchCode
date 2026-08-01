import { useState } from "react";
import { VscCheck, VscClose, VscEdit, VscSignOut, VscTrash } from "react-icons/vsc";
import { Avatar } from "./Avatar";
import { Button } from "./ui/Button";
import { useAuthStore } from "../lib/auth";
import { useChatStore } from "../lib/store";
import { formatRelativeTime, formatUsd } from "../lib/utils";

const BUDGET_WARN_PCT = 75;
const BUDGET_DANGER_PCT = 90;

function budgetLabel(cost: number, limit: number): string {
  return limit > 0 ? `${formatUsd(cost)} / ${formatUsd(limit)}` : formatUsd(cost);
}

export function Sidebar() {
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
      <Button className="Sidebar-newchat" onClick={newChat} disabled={streaming}>
        <VscEdit />
        <span>New chat</span>
      </Button>

      <div className="Sidebar-section">
        <span className="Sidebar-sectiontitle">Chats</span>
      </div>

      <nav className="Sidebar-threads">
        {sessions.length === 0 && (
          <p className="Sidebar-empty">No conversations yet. Start one below.</p>
        )}
        {sessions.map((session) => {
          const confirming = pendingDelete === session.id;
          return (
            <div
              key={session.id}
              className="ThreadItem"
              data-active={session.id === currentSessionId}
              data-confirming={confirming}
            >
              <button
                type="button"
                className="ThreadItem-btn"
                aria-current={session.id === currentSessionId ? "page" : undefined}
                disabled={streaming}
                onClick={() => void selectSession(session.id)}
              >
                <div className="ThreadItem-content">
                  <div className="ThreadItem-topRow">
                    <span className="ThreadItem-title">{session.title || "New chat"}</span>
                    <span className="ThreadItem-time">
                      {formatRelativeTime(session.updatedAt)}
                    </span>
                  </div>
                </div>
              </button>

              {confirming ? (
                <div className="ThreadItem-confirm">
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
                  <Button
                    className="ThreadItem-confirmNo"
                    aria-label="Cancel delete"
                    onClick={() => setPendingDelete(null)}
                  >
                    <VscClose />
                  </Button>
                </div>
              ) : (
                <Button
                  className="ThreadItem-del"
                  aria-label={`Delete chat ${session.title || "New chat"}`}
                  onClick={() => setPendingDelete(session.id)}
                >
                  <VscTrash />
                </Button>
              )}
            </div>
          );
        })}
      </nav>

      <div className="Sidebar-footer">
        <div className="BudgetBar" data-level={budgetLevel}>
          <div className="BudgetBar-top">
            <span>{budget ? `Usage this ${budget.period}` : "Usage"}</span>
            <span>{budget ? budgetLabel(budget.costUsd, budget.limitUsd) : "—"}</span>
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
          {budget && !budget.allowed && (
            <span className="BudgetBar-blocked">Usage limit reached</span>
          )}
        </div>

        <div className="Account">
          <Avatar src={user?.avatarUrl} fallback={user?.initial ?? "?"} />
          <span className="Account-info">
            <span className="Account-name">{user?.displayName ?? "You"}</span>
            <span className="Account-plan">{user?.email ?? "Signed in"}</span>
          </span>
          <Button
            className="IconBtn Account-logout"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut()}
          >
            <VscSignOut />
          </Button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
