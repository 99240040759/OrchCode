import React from "react";
import ExplorerIcon from "./ExplorerIcon";
import { getBasename } from "../lib/utils";
import { useArtifactsStore } from "../lib/artifacts";

export interface FileTagProps {
  path: string;
  name?: string;
  lineRange?: string;
  added?: number;
  removed?: number;
  interactive?: boolean;
  className?: string;
}

export const FileTag: React.FC<FileTagProps> = ({
  path,
  name,
  lineRange,
  added,
  removed,
  interactive = true,
  className = "",
}) => {
  const openFile = useArtifactsStore((s) => s.openFile);
  const filename = name || getBasename(path);
  const clickable = interactive && Boolean(path);

  const activate = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    openFile(path);
  };

  return (
    <span
      className={`FileTag ${clickable ? "FileTag-clickable" : ""} ${className}`}
      title={path || filename}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? activate : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate(event);
              }
            }
          : undefined
      }
    >
      <ExplorerIcon
        type="file"
        name={filename}
        className="FileTag-icon"
        width={14}
        height={14}
      />
      <span className="FileTag-name">{filename}</span>
      {lineRange && <span className="FileTag-lineRange">{lineRange}</span>}
      {typeof added === "number" && added > 0 && <span className="FileTag-added">+{added}</span>}
      {typeof removed === "number" && removed > 0 && (
        <span className="FileTag-removed">-{removed}</span>
      )}
    </span>
  );
};

export default FileTag;
