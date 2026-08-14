import React, { useEffect, useRef, useState } from "react";
import {
  VscBook,
  VscChevronRight,
  VscFlame,
  VscGlobe,
  VscMcp,
  VscScreenNormal,
  VscSearch,
  VscTerminal,
  VscWarning,
} from "react-icons/vsc";
import type { ToolIcon } from "../lib/api";
import type {
  ChatMessage,
  CompactionNoticeItem,
  MessageItem,
  ReasoningItem,
  TextItem,
  ToolCallItem,
} from "../lib/store";
import { Markdown, renderTextWithMentions } from "./Markdown";
import { AttachmentCard, ExplorerIcon, FileTag, ThinkingShimmer } from "./ChatPrimitives";
import { Tooltip } from "./ui/Tooltip";

const TOOL_ICONS: Record<Exclude<ToolIcon, "file">, React.ComponentType<{ className?: string }>> = {
  terminal: VscTerminal,
  search: VscSearch,
  globe: VscGlobe,
  book: VscBook,
  cpu: VscMcp,
  zapOff: VscFlame,
};

function CompactionDivider({ item }: { item: CompactionNoticeItem }) {
  const time = new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Tooltip
      content={`${item.originalMessageCount} earlier messages were summarised to free up context`}
      side="top"
    >
      <div className="CompactionNotice">
        <VscScreenNormal className="CompactionNotice-icon" />
        <span>
          Context compacted — {item.originalMessageCount} messages summarised · {time}
        </span>
      </div>
    </Tooltip>
  );
}

function ToolTarget({ tool }: { tool: ToolCallItem }) {
  const info = tool.displayInfo;
  if (info.filename) {
    return (
      <FileTag
        path={info.fullPath ?? info.filename}
        name={info.filename}
        lineRange={info.lineRange ?? undefined}
        added={info.addedLines ?? undefined}
        removed={info.removedLines ?? undefined}
      />
    );
  }

  const Icon = info.icon === "file" ? null : TOOL_ICONS[info.icon];
  return (
    <span className="ToolRow-target">
      {Icon ? (
        <Icon className="ToolRow-icon" />
      ) : (
        <ExplorerIcon
          type="file"
          name={info.targetText ?? ""}
          className="ToolRow-icon"
          width={13}
          height={13}
        />
      )}
      {info.targetText && <span className="ToolRow-text">{info.targetText}</span>}
    </span>
  );
}

function ToolRow({ tool }: { tool: ToolCallItem }) {
  const [open, setOpen] = useState(false);
  const output = tool.output?.trim() ?? "";
  const hasOutput = output.length > 0;
  const isFileAction = Boolean(tool.displayInfo.filename);
  const showToggle = hasOutput && (!isFileAction || tool.status === "error");

  return (
    <div className="ToolRow" data-status={tool.status}>
      <div className="ToolRow-header">
        <span className="ToolRow-label">{tool.displayInfo.label || tool.name}</span>
        <ToolTarget tool={tool} />
        {tool.status === "running" && <span className="ToolRow-spinner" role="status" />}
        {tool.status === "error" && (
          <VscWarning className="ToolRow-errIcon" aria-label="Tool call failed" />
        )}
        {showToggle && (
          <Tooltip content={open ? "Hide output" : "Show output"} side="top">
            <button
              type="button"
              className="ToolRow-toggle"
              data-open={open}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <VscChevronRight className="ToolRow-chevron" />
            </button>
          </Tooltip>
        )}
      </div>
      {open && showToggle && <pre className="ToolRow-output">{output}</pre>}
    </div>
  );
}

function ThinkingBlock({ item }: { item: ReasoningItem }) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(() => item.durationSeconds ?? 0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasActive = useRef(item.active);

  useEffect(() => {
    if (wasActive.current && !item.active) setUserToggled(null);
    wasActive.current = item.active;
  }, [item.active]);

  useEffect(() => {
    if (!item.active) {
      if (item.durationSeconds !== undefined) setElapsed(item.durationSeconds);
      return;
    }
    const tick = () =>
      setElapsed(Math.max(1, Math.round((Date.now() - item.startTime) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [item.active, item.startTime, item.durationSeconds]);

  const isOpen = userToggled ?? item.active;

  useEffect(() => {
    if (item.active && isOpen && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [item.text, item.active, isOpen]);

  const label = item.active
    ? `Thinking for ${elapsed}s`
    : elapsed > 0
      ? `Thought for ${elapsed}s`
      : "Thought process";

  return (
    <div className="Reasoning">
      <button
        type="button"
        className="Reasoning-toggle"
        data-open={isOpen}
        aria-expanded={isOpen}
        onClick={() => setUserToggled(!isOpen)}
      >
        <span className="Reasoning-label">{label}</span>
        {item.active && <span className="Reasoning-spinner" aria-hidden="true" />}
        <VscChevronRight className="Reasoning-chevron" />
      </button>
      {isOpen && (
        <div className="Reasoning-body" ref={bodyRef}>
          {item.text}
        </div>
      )}
    </div>
  );
}

type Group =
  | { kind: "reasoning"; item: ReasoningItem }
  | { kind: "text"; id: string; text: string }
  | { kind: "tools"; id: string; tools: ToolCallItem[] };

function groupItems(items: MessageItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    if (item.type === "compactionNotice") continue;
    if (item.type === "reasoning") {
      groups.push({ kind: "reasoning", item });
      continue;
    }
    if (item.type === "toolCall") {
      const last = groups[groups.length - 1];
      if (last?.kind === "tools") last.tools.push(item);
      else groups.push({ kind: "tools", id: item.id, tools: [item] });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.kind === "text") {
      last.text += last.text.endsWith("\n") ? item.text : `\n${item.text}`;
    } else {
      groups.push({ kind: "text", id: item.id, text: item.text });
    }
  }
  return groups;
}

export const Message = React.memo(function Message({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    const notice = message.items.find(
      (i): i is CompactionNoticeItem => i.type === "compactionNotice"
    );
    return notice ? <CompactionDivider item={notice} /> : null;
  }

  if (message.role === "user") {
    const text = message.items.find((i): i is TextItem => i.type === "text")?.text ?? "";
    return (
      <div className="Msg Msg-user">
        {message.attachments.length > 0 && (
          <div className="Msg-attachments">
            {message.attachments.map((attachment, index) => (
              <AttachmentCard
                key={`${attachment.name}-${index}`}
                name={attachment.name}
                isImage={attachment.isImage}
                path={attachment.path}
                dataUrl={attachment.dataUrl}
              />
            ))}
          </div>
        )}
        {text && <div className="Msg-bubble">{renderTextWithMentions(text)}</div>}
      </div>
    );
  }

  const groups = groupItems(message.items);

  return (
    <div className="Msg Msg-assistant">
      {groups.map((group) => {
        if (group.kind === "reasoning") {
          return <ThinkingBlock key={group.item.id} item={group.item} />;
        }
        if (group.kind === "tools") {
          return (
            <div key={`tools-${group.id}`} className="ToolList">
              {group.tools.map((tool) => (
                <ToolRow key={tool.id} tool={tool} />
              ))}
            </div>
          );
        }
        return <Markdown key={group.id}>{group.text}</Markdown>;
      })}
      {message.streaming && message.items.length === 0 && <ThinkingShimmer />}
      {message.error && (
        <div className="Msg-error" role="alert">
          <VscWarning aria-hidden="true" />
          <span>{message.error}</span>
        </div>
      )}
    </div>
  );
});

export default Message;
