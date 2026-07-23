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
  prefix?: React.ReactNode;
  onClick?: () => void;
  onOpen?: (path: string) => void;
  interactive?: boolean;
  className?: string;
}

export const FileTag: React.FC<FileTagProps> = ({
  path,
  name,
  lineRange,
  added,
  removed,
  prefix,
  onClick,
  onOpen,
  interactive = true,
  className = "",
}) => {
  const filename = name || getBasename(path);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) onClick();
    else if (onOpen && interactive && path) onOpen(path);
    else if (interactive && path) useArtifactsStore.getState().openFile(path);
  };

  const isClickable = (interactive && Boolean(path)) || Boolean(onClick);

  return (
    <span
      className={`FileTag ${isClickable ? "FileTag-clickable" : ""} ${className}`}
      title={path || filename}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick(e as unknown as React.MouseEvent);
              }
            }
          : undefined
      }
    >
      {prefix && <span className="FileTag-prefix">{prefix}</span>}
      <ExplorerIcon type="file" name={filename} className="FileTag-icon" style={{ width: 14, height: 14, flexShrink: 0 }} />
      <span className="FileTag-name">{filename}</span>
      {lineRange && <span className="FileTag-lineRange">{lineRange}</span>}
      {typeof added === "number" && added > 0 && <span className="FileTag-added">+{added}</span>}
      {typeof removed === "number" && removed > 0 && <span className="FileTag-removed">-{removed}</span>}
    </span>
  );
};

export default FileTag;
