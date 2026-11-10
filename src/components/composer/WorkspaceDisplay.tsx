import React, { useState } from "react";
import { LuChevronDown, LuCloud, LuFolder, LuFolderOpen } from "react-icons/lu";
import { useChatStore } from "../../lib/store";
import { useModeWorkspaces, useWorkspaceStore } from "../../lib/workspace";
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
  const allWorkspaces = useModeWorkspaces();
  const cloudMode = useWorkspaceStore((s) => s.mode) === "cloud";
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const wsBusy = useWorkspaceStore((s) => s.busy);
  const streaming = useChatStore((s) => s.streaming);
  const wsLocked = streaming || wsBusy;

  const [menuOpen, setMenuOpen] = useState(false);
  const [showCloudForm, setShowCloudForm] = useState(false);

  const changeOpen = (open: boolean) => {
    setMenuOpen(open);
    setShowCloudForm(open && cloudMode && allWorkspaces.length === 0);
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={changeOpen}>
      <Tooltip
        content={currentPath ? `Workspace: ${currentPath}` : "Switch workspace"}
        side="top"
      >
        <DropdownMenuTrigger asChild>
          <button type="button" className="Composer-repo" aria-label="Switch workspace">
            {cloudMode ? (
              <LuCloud className="Composer-repoIcon" />
            ) : (
              <LuFolder className="Composer-repoIcon" />
            )}
            <span>{currentName ?? (cloudMode ? "Choose repository" : "Open folder")}</span>
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
              return (
                <DropdownMenuItem
                  key={ws.id}
                  disabled={wsLocked}
                  data-selected={ws.id === currentWs?.id || undefined}
                  onSelect={() => {
                    if (ws.id !== currentWs?.id) void switchTo(ws.id);
                  }}
                >
                  {cloudMode ? <LuCloud /> : <LuFolder />}
                  <span className="ModelItem-name">{ws.name}</span>
                </DropdownMenuItem>
              );
            })}
            {allWorkspaces.length > 0 && <DropdownMenuSeparator />}
            {cloudMode ? (
              <DropdownMenuItem
                disabled={wsLocked}
                onSelect={(e) => {
                  e.preventDefault();
                  setShowCloudForm(true);
                }}
              >
                <LuCloud />
                <span>Choose repository…</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={wsLocked} onSelect={() => void pickAndOpen()}>
                <LuFolderOpen />
                <span>Open folder…</span>
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
