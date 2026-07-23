import { FiEdit, FiCheckCircle, FiTrash2, FiLogOut } from "react-icons/fi";
import { Avatar } from "./Avatar";
import { Button } from "./ui/Button";
import { useAuthStore } from "../lib/auth";
import { useChatStore } from "../lib/store";
import { formatUsd, formatRelativeTime } from "../lib/utils";

interface SidebarProps {
  onCollapse?: () => void;
}

function budgetLabel(cost: number, limit: number): string {
  const c = formatUsd(cost);
  return limit > 0 ? `${c} / ${formatUsd(limit)}` : c;
}

export function Sidebar({}: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const newChat = useChatStore((s) => s.newChat);
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const budget = useChatStore((s) => s.budget);

  const pct = budget && budget.limitUsd > 0 ? Math.min(100, Math.max(0, (budget.costUsd / budget.limitUsd) * 100)) : 0;

  return (
    <aside className="Sidebar">
      <Button className="Sidebar-newchat" onClick={newChat}>
        <FiEdit />
        <span>New chat</span>
      </Button>

      <div className="Sidebar-section">
        <span className="Sidebar-sectiontitle">Chats</span>
      </div>

      <nav className="Sidebar-threads">
        {sessions.length === 0 && <p className="Sidebar-empty">No conversations yet. Start one below.</p>}
        {sessions.map((s) => (
          <div key={s.id} className="ThreadItem" data-active={s.id === currentSessionId}>
            <button
              className="ThreadItem-btn"
              aria-current={s.id === currentSessionId ? "page" : undefined}
              onClick={() => void selectSession(s.id)}
            >
              <FiCheckCircle className="ThreadItem-checkIcon" aria-hidden="true" />
              <div className="ThreadItem-content">
                <div className="ThreadItem-topRow">
                  <span className="ThreadItem-title">{s.title || "New chat"}</span>
                  <span className="ThreadItem-time">{formatRelativeTime(s.updatedAt)}</span>
                </div>
                <div className="ThreadItem-subRow">
                  <span className="ThreadItem-subText">{s.title ? "Task ready" : "New conversation"}</span>
                </div>
              </div>
            </button>
            <Button className="ThreadItem-del" aria-label={`Delete chat: ${s.title || "New chat"}`} onClick={() => void deleteSession(s.id)}>
              <FiTrash2 />
            </Button>
          </div>
        ))}
      </nav>

      <div className="Sidebar-footer">
        <div className="BudgetBar" title={budget ? `Usage this ${budget.period ?? "period"}` : "Usage"}>
          <div className="BudgetBar-top">
            <span>Usage</span>
            <span>{budget ? budgetLabel(budget.costUsd, budget.limitUsd) : "—"}</span>
          </div>
          <div className="BudgetBar-track">
            <div className="BudgetBar-fill" data-pct={Math.round(pct)} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="Account">
          <Avatar src={user?.avatarUrl} fallback={user?.initial ?? "?"} />
          <span className="Account-info">
            <span className="Account-name">{user?.displayName ?? "You"}</span>
            <span className="Account-plan">{user?.email ?? "Signed in"}</span>
          </span>
          <Button className="IconBtn Account-logout" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
            <FiLogOut />
          </Button>
        </div>
      </div>
    </aside>
  );
}
