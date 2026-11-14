import { memo, type KeyboardEvent, type SyntheticEvent } from "react";
import { getBasename } from "../../lib/utils";
import { openArtifact } from "../panel/actions";
import { FileIcon } from "./FileIcon";

interface FileChipProps {
  path: string;
  name?: string;
  lineRange?: string;
  added?: number;
  removed?: number;
  interactive?: boolean;
}

export const FileChip = memo(function FileChip({
  path,
  name,
  lineRange,
  added,
  removed,
  interactive = true,
}: FileChipProps) {
  const filename = name || getBasename(path) || path;
  const clickable = interactive && Boolean(path);

  const activate = (event: SyntheticEvent) => {
    event.stopPropagation();
    openArtifact(path);
  };

  return (
    <span
      className="chip"
      title={path || filename}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? activate : undefined}
      onKeyDown={
        clickable
          ? (event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              activate(event);
            }
          : undefined
      }
    >
      <FileIcon name={filename} />
      <span className="chip-name">{filename}</span>
      {lineRange && <span className="chip-meta">{lineRange}</span>}
      {Boolean(added) && <span className="chip-add">+{added}</span>}
      {Boolean(removed) && <span className="chip-del">-{removed}</span>}
    </span>
  );
});
