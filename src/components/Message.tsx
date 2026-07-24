import { useEffect, useRef, useState } from "react";
import { FiChevronRight, FiTerminal, FiSearch, FiGlobe, FiCpu, FiAlertTriangle, FiMinimize2 } from "react-icons/fi";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ChatMessage, MessageItem, ToolCallItem, ReasoningItem, TextItem, CompactionNoticeItem } from "../lib/store";
import type { AttachmentRef } from "../lib/api";
import { inTauri } from "../lib/api";
import { Markdown, renderTextWithMentions } from "./Markdown";
import FileTag from "./FileTag";
import ExplorerIcon from "./ExplorerIcon";
import { ThinkingShimmer } from "./ThinkingShimmer";

function MsgAttachmentCard({ a }: { a: AttachmentRef }) {
  const isDataUri = a.path.startsWith("data:");
  const imgSrc = a.isImage
    ? (isDataUri ? a.path : (inTauri() ? convertFileSrc(a.path) : `file://${a.path}`))
    : undefined;

  if (a.isImage) {
    return (
      <div className="AttachmentCard AttachmentCard-image" title={a.name}>
        <div className="AttachmentCard-thumbWrap">
          <img
            src={imgSrc}
            alt={a.name}
            className="AttachmentCard-thumb"
            onError={(e) => { (e.currentTarget as HTMLElement).style.display = "none"; }}
          />
        </div>
        <span className="AttachmentCard-name">{a.name}</span>
      </div>
    );
  }

  return (
    <div className="AttachmentCard AttachmentCard-doc" title={a.name}>
      <ExplorerIcon type="file" name={a.name} className="AttachmentCard-icon" style={{ width: 15, height: 15, flexShrink: 0 }} />
      <span className="AttachmentCard-name">{a.name}</span>
    </div>
  );
}

function CompactionDivider({ item }: { item: CompactionNoticeItem }) {
  const time = new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="CompactionNotice" title={`${item.originalMessageCount} earlier messages summarised — full history is still saved`}>
      <FiMinimize2 className="CompactionNotice-icon" />
      <span>Context compacted — {item.originalMessageCount} messages summarised · {time}</span>
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolCallItem }) {
  const info = tool.displayInfo ?? { label: tool.name, icon: "terminal" as const, opensArtifact: false };
  const labelText = info.label || tool.name;

  return (
    <div className="ToolRow" data-status={tool.status}>
      <div className="ToolRow-header">
        <span className="ToolRow-label">{labelText}</span>
        {info.filename ? (
          <FileTag path={info.fullPath ?? info.filename} name={info.filename} lineRange={info.lineRange} added={info.addedLines} removed={info.removedLines} />
        ) : (
          <span className="ToolRow-target">
            {info.icon === "globe" ? <FiGlobe className="ToolRow-icon" /> : info.icon === "search" ? <FiSearch className="ToolRow-icon" /> : <FiTerminal className="ToolRow-icon" />}
            <span className="ToolRow-text">{info.targetText}</span>
          </span>
        )}
        {tool.status === "running" && <span className="ToolRow-spinner" aria-label="Running" />}
        {tool.status === "error" && <FiAlertTriangle className="ToolRow-errIcon" aria-label="Error" />}
      </div>
    </div>
  );
}

function ThinkingBlock({ item }: { item: ReasoningItem }) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState<number>(() => {
    if (item.durationSeconds !== undefined) return Math.round(item.durationSeconds);
    if (!item.startTime) return 0;
    return Math.max(1, Math.round((Date.now() - item.startTime) / 1000));
  });

  const prevActiveRef = useRef(item.active);
  useEffect(() => {
    if (prevActiveRef.current && !item.active) {
      setUserToggled(null);
    }
    prevActiveRef.current = item.active;
  }, [item.active]);

  useEffect(() => {
    if (!item.active) {
      if (item.durationSeconds !== undefined) setElapsed(Math.round(item.durationSeconds));
      return;
    }
    const interval = setInterval(() => setElapsed(Math.max(1, Math.round((Date.now() - item.startTime) / 1000))), 1000);
    return () => clearInterval(interval);
  }, [item.active, item.startTime, item.durationSeconds]);

  const isOpen = userToggled !== null ? userToggled : item.active;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (item.active && bodyRef.current && isOpen) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [item.text, item.active, isOpen]);

  const hasDuration = item.durationSeconds !== undefined || item.startTime > 0;
  const labelText = item.active
    ? `Thinking for ${elapsed}s`
    : hasDuration
      ? `Thought for ${elapsed}s`
      : "Thought process";

  return (
    <div className="Reasoning">
      <button
        className="Reasoning-toggle"
        data-open={isOpen}
        aria-expanded={isOpen}
        onClick={() => setUserToggled(!isOpen)}
      >
        <FiCpu className="Reasoning-icon" />
        <span className="Reasoning-label">{labelText}</span>
        {item.active && <span className="Reasoning-spinner" aria-hidden="true" />}
        <FiChevronRight className="Reasoning-chevron" />
      </button>
      {isOpen && <div className="Reasoning-body" ref={bodyRef}>{item.text}</div>}
    </div>
  );
}

type Group =
  | { type: "reasoning"; item: ReasoningItem }
  | { type: "text"; item: TextItem }
  | { type: "tools"; tools: ToolCallItem[] };

function groupItems(items: MessageItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    if (item.type === "compactionNotice") continue;
    if (item.type === "toolCall") {
      const last = groups[groups.length - 1];
      if (last?.type === "tools") last.tools.push(item);
      else groups.push({ type: "tools", tools: [item] });
    } else if (item.type === "reasoning") {
      groups.push({ type: "reasoning", item });
    } else {
      const last = groups[groups.length - 1];
      if (last?.type === "text") {
        last.item = { ...last.item, text: last.item.text + (last.item.text.endsWith("\n") ? "" : "\n") + item.text };
      } else {
        groups.push({ type: "text", item: { ...item } });
      }
    }
  }
  return groups;
}

export function Message({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    const notice = message.items.find((i): i is CompactionNoticeItem => i.type === "compactionNotice");
    if (notice) return <CompactionDivider item={notice} />;
    return null;
  }

  if (message.role === "user") {
    const text = (message.items.find((i): i is TextItem => i.type === "text")?.text) ?? "";
    return (
      <div className="Msg Msg-user">
        {message.attachments && message.attachments.length > 0 && (
          <div className="Msg-attachments">
            {message.attachments.map((a) => (
              <MsgAttachmentCard key={(a as AttachmentRef).path ?? a.name} a={a as AttachmentRef} />
            ))}
          </div>
        )}
        <div className="Msg-bubble">{renderTextWithMentions(text)}</div>
      </div>
    );
  }

  const groups = groupItems(message.items);

  return (
    <div className="Msg Msg-assistant">
      {groups.map((group, idx) => {
        if (group.type === "reasoning") return <ThinkingBlock key={group.item.id} item={group.item} />;
        if (group.type === "tools") {
          return (
            <div key={`tools-${idx}`} className="ToolList">
              {group.tools.map((t) => <ToolRow key={t.id} tool={t} />)}
            </div>
          );
        }
        return <Markdown key={group.item.id}>{group.item.text}</Markdown>;
      })}
      {message.streaming && message.items.length === 0 && <ThinkingShimmer />}
      {message.error && (
        <div className="Msg-error" role="alert">
          <FiAlertTriangle aria-hidden="true" />
          <span>{message.error}</span>
        </div>
      )}
    </div>
  );
}
