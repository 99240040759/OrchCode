import React from "react";
import { VscChevronDown, VscFolder, VscFolderOpened, VscRocket } from "react-icons/vsc";
import { useChatStore } from "../../lib/store";
import { useWorkspaceStore } from "../../lib/workspace";
import { Tooltip } from "../ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";

interface WorkspaceDisplayProps {
  currentName: string | undefined;
  currentPath?: string;
}

export const WorkspaceDisplay = React.memo(function WorkspaceDisplay({
  currentName,
  currentPath,
}: WorkspaceDisplayProps) {
  const currentWs = useWorkspaceStore((s) => s.current);
  const allWorkspaces = useWorkspaceStore((s) => s.all);
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const createQuick = useWorkspaceStore((s) => s.createQuickProject);
  const wsBusy = useWorkspaceStore((s) => s.busy);
  const streaming = useChatStore((s) => s.streaming);
  const wsLocked = streaming || wsBusy;

  return (
    <DropdownMenu>
      <Tooltip
        content={currentPath ? `Workspace: ${currentPath}` : "Switch workspace"}
        side="top"
      >
        <DropdownMenuTrigger asChild>
          <button type="button" className="Composer-repo" aria-label="Switch workspace">
            <VscFolder className="Composer-repoIcon" />
            <span>{currentName ?? "Workspace"}</span>
            <VscChevronDown className="Composer-chevron" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent sideOffset={6} align="start">
        {allWorkspaces.map((ws) => (
          <DropdownMenuItem
            key={ws.id}
            disabled={wsLocked}
            data-selected={ws.id === currentWs?.id || undefined}
            onSelect={() => {
              if (ws.id !== currentWs?.id) void switchTo(ws.id);
            }}
          >
            <VscFolder />
            <span className="ModelItem-name">{ws.name}</span>
          </DropdownMenuItem>
        ))}
        {allWorkspaces.length > 0 && <DropdownMenuSeparator />}
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
  );
});
