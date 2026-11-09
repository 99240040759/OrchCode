import React, { useState } from "react";
import { LuChevronDown, LuCloud, LuFolder, LuFolderOpen } from "react-icons/lu";
import { useChatStore } from "../../lib/store";
import { useWorkspaceStore } from "../../lib/workspace";
import { isCloudWorkspace } from "../../lib/utils";
import { CloudRepoForm } from "../CloudRepoForm";
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
  const wsBusy = useWorkspaceStore((s) => s.busy);
  const streaming = useChatStore((s) => s.streaming);
  const wsLocked = streaming || wsBusy;
  const isCurrentCloud = isCloudWorkspace(currentPath);

  const [menuOpen, setMenuOpen] = useState(false);
  const [showCloudForm, setShowCloudForm] = useState(false);

  const changeOpen = (open: boolean) => {
    setMenuOpen(open);
    if (!open) setShowCloudForm(false);
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={changeOpen}>
      <Tooltip
        content={currentPath ? `Workspace: ${currentPath}` : "Switch workspace"}
        side="top"
      >
        <DropdownMenuTrigger asChild>
          <button type="button" className="Composer-repo" aria-label="Switch workspace">
            {isCurrentCloud ? (
              <LuCloud className="Composer-repoIcon" />
            ) : (
              <LuFolder className="Composer-repoIcon" />
            )}
            <span>{currentName ?? "Workspace"}</span>
            <LuChevronDown className="Composer-chevron" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent sideOffset={6} align="start">
        {showCloudForm ? (
          <div onKeyDown={(e) => e.stopPropagation()}>
            <CloudRepoForm disabled={wsLocked} onOpened={() => changeOpen(false)} />
          </div>
        ) : (
          <>
            {allWorkspaces.map((ws) => {
              const cloud = isCloudWorkspace(ws.path);
              return (
                <DropdownMenuItem
                  key={ws.id}
                  disabled={wsLocked}
                  data-selected={ws.id === currentWs?.id || undefined}
                  onSelect={() => {
                    if (ws.id !== currentWs?.id) void switchTo(ws.id);
                  }}
                >
                  {cloud ? <LuCloud /> : <LuFolder />}
                  <span className="ModelItem-name">{ws.name}</span>
                </DropdownMenuItem>
              );
            })}
            {allWorkspaces.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled={wsLocked} onSelect={() => void pickAndOpen()}>
              <LuFolderOpen />
              <span>Open folder…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={wsLocked}
              onSelect={(e) => {
                e.preventDefault();
                setShowCloudForm(true);
              }}
            >
              <LuCloud />
              <span>Open cloud repo…</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
