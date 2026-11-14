import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { FileEntry } from "../../lib/api";
import { getBasename, getDirname } from "../../lib/utils";
import { FileIcon } from "../common/FileIcon";
import type { CommandItem, Trigger } from "./types";

interface SuggestionsProps {
  anchorRef: RefObject<HTMLDivElement | null>;
  trigger: Trigger;
  query: string;
  fileHits: FileEntry[];
  commandHits: CommandItem[];
  loadingFiles: boolean;
  activeIndex: number;
  onSelectFile: (path: string) => void;
  onSelectCommand: (command: CommandItem) => void;
  onHighlight: (index: number) => void;
}

export function Suggestions({
  anchorRef,
  trigger,
  query,
  fileHits,
  commandHits,
  loadingFiles,
  activeIndex,
  onSelectFile,
  onSelectCommand,
  onHighlight,
}: SuggestionsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!trigger || !anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setStyle({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + 6,
        maxHeight: Math.max(0, Math.min(300, rect.top - 56)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchorRef, trigger]);

  useEffect(() => {
    listRef.current?.querySelector('[data-highlighted]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, trigger]);

  if (!trigger || !style) return null;

  const empty =
    trigger === "@"
      ? loadingFiles
        ? "Searching workspace…"
        : fileHits.length === 0
          ? query
            ? `No files matching "${query}"`
            : "No workspace files found"
          : null
      : commandHits.length === 0
        ? "No matching actions"
        : null;

  const item = (index: number, onSelect: () => void) => ({
    role: "option" as const,
    "aria-selected": index === activeIndex,
    "data-highlighted": index === activeIndex || undefined,
    className: "row",
    onMouseEnter: () => onHighlight(index),
    onMouseDown: (e: MouseEvent) => {
      e.preventDefault();
      onSelect();
    },
  });

  return createPortal(
    <div ref={listRef} className="suggest" role="listbox" aria-label="Suggestions" style={style}>
      {empty ? (
        <div className="empty">{empty}</div>
      ) : trigger === "@" ? (
        fileHits.map((file, index) => {
          const name = getBasename(file.path) || file.name;
          const dir = getDirname(file.path);
          return (
            <div key={file.path} {...item(index, () => onSelectFile(file.path))}>
              <FileIcon name={name} />
              <span className="row-label">{name}</span>
              {dir !== "." && <span className="row-meta">{dir}</span>}
            </div>
          );
        })
      ) : (
        commandHits.map((command, index) => (
          <div key={command.key} {...item(index, () => onSelectCommand(command))}>
            <span className="suggest-key">/{command.key}</span>
            <span className="row-label">{command.label}</span>
            <span className="row-meta">{command.hint}</span>
          </div>
        ))
      )}
    </div>,
    document.body
  );
}
