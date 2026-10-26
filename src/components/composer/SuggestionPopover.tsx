import { useEffect, useRef } from "react";
import { Command } from "cmdk";
import * as api from "../../lib/api";
import * as utils from "../../lib/utils";
import { ExplorerIcon } from "../ChatPrimitives";
import type { CommandItem, Trigger } from "./types";

interface SuggestionPopoverProps {
  trigger: Trigger;
  query: string;
  fileHits: api.FileEntry[];
  commandHits: CommandItem[];
  loadingFiles: boolean;
  activeIndex: number;
  onSelectFile: (filePath: string) => void;
  onSelectCommand: (command: CommandItem) => void;
  onHighlight: (index: number) => void;
}

export function SuggestionPopover({
  trigger,
  query,
  fileHits,
  commandHits,
  loadingFiles,
  activeIndex,
  onSelectFile,
  onSelectCommand,
  onHighlight,
}: SuggestionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  if (!trigger) return null;

  return (
    <Command className="MentionPopover" label="Suggestions" shouldFilter={false}>
      <Command.List ref={listRef} className="MentionPopover-list">
        {trigger === "@" ? (
          loadingFiles ? (
            <div className="MentionItem MentionItem-empty">
              Searching workspace…
            </div>
          ) : fileHits.length === 0 ? (
            <div className="MentionItem MentionItem-empty">
              {query
                ? `No files matching "${query}"`
                : "No workspace files found"}
            </div>
          ) : (
            fileHits.map((file, index) => {
              const filename = utils.getBasename(file.path) || file.name;
              const dir = utils.getDirname(file.path);
              const isActive = index === activeIndex;
              return (
                <Command.Item
                  key={file.path}
                  value={file.path}
                  className="MentionItem"
                  data-active={isActive}
                  aria-selected={isActive}
                  onMouseEnter={() => onHighlight(index)}
                  onSelect={() => onSelectFile(file.path)}
                >
                  <ExplorerIcon
                    type="file"
                    name={filename}
                    className="MentionItem-icon"
                    width={14}
                    height={14}
                  />
                  <span className="MentionItem-name">{filename}</span>
                  {dir && <span className="MentionItem-path">{dir}</span>}
                </Command.Item>
              );
            })
          )
        ) : commandHits.length === 0 ? (
          <div className="MentionItem MentionItem-empty">
            No matching actions
          </div>
        ) : (
          commandHits.map((command, index) => {
            const isActive = index === activeIndex;
            return (
              <Command.Item
                key={command.key}
                value={command.key}
                className="MentionItem"
                data-active={isActive}
                aria-selected={isActive}
                onMouseEnter={() => onHighlight(index)}
                onSelect={() => onSelectCommand(command)}
              >
                <span className="MentionItem-slash">/{command.key}</span>
                <span className="MentionItem-name">{command.label}</span>
                <span className="MentionItem-path">{command.hint}</span>
              </Command.Item>
            );
          })
        )}
      </Command.List>
    </Command>
  );
}
