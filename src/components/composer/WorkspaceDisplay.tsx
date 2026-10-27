import React from "react";
import { VscFolderOpened } from "react-icons/vsc";
import { Tooltip } from "../ui/Tooltip";

interface WorkspaceDisplayProps {
  currentName: string | undefined;
  currentPath?: string;
}

export const WorkspaceDisplay = React.memo(function WorkspaceDisplay({ currentName, currentPath }: WorkspaceDisplayProps) {
  return (
    <Tooltip
      content={currentPath ? `Workspace: ${currentPath}` : "Current workspace"}
      side="top"
    >
      <div className="Composer-repo">
        <VscFolderOpened />
        <span>{currentName ?? "Workspace"}</span>
      </div>
    </Tooltip>
  );
});
