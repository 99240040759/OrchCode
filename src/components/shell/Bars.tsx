import { LuPanelLeft, LuPanelRight } from "react-icons/lu";
import { useChatStore } from "../../lib/store";
import { useWorkspaceStore } from "../../lib/workspace";
import { IconButton } from "../ui/Button";
import { TrafficSpacer, WindowControls } from "../ui/WindowControls";
import { togglePanel } from "../panel/actions";
import { toggleSidebar, useShell } from "./shellStore";
import { UpdateBadge } from "./UpdateBadge";

export function SidebarOpener() {
  const open = useShell((s) => s.sidebarOpen);
  if (open) return null;
  return (
    <>
      <TrafficSpacer />
      <IconButton label="Show sidebar" onClick={toggleSidebar}>
        <LuPanelLeft />
      </IconButton>
    </>
  );
}

function Title() {
  const view = useShell((s) => s.view);
  const project = useWorkspaceStore((s) => s.current?.name);
  const session = useChatStore((s) => s.sessions.find((x) => x.id === s.currentSessionId)?.title);
  const hasMessages = useChatStore((s) => s.messages.length > 0);

  if (view === "integrations") {
    return (
      <div className="bar-title">
        <span>Integrations</span>
      </div>
    );
  }
  return (
    <div className="bar-title">
      {project && <span className="bar-title-dim">{project}</span>}
      {project && <span className="bar-title-dim">/</span>}
      <span>{session || (hasMessages ? "Conversation" : "New conversation")}</span>
    </div>
  );
}

export function MainBar({ panelShown }: { panelShown: boolean }) {
  const view = useShell((s) => s.view);
  return (
    <div className="bar" data-tauri-drag-region>
      <SidebarOpener />
      <Title />
      <div className="bar-fill" data-tauri-drag-region />
      <UpdateBadge />
      {view === "chat" && !panelShown && (
        <IconButton label="Show panel" tip="Files, browser and terminal" onClick={togglePanel}>
          <LuPanelRight />
        </IconButton>
      )}
      {!panelShown && <WindowControls />}
    </div>
  );
}
