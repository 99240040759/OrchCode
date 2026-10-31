import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  VscBook,
  VscCheck,
  VscChevronRight,
  VscCopy,
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
import { useArtifactsStore } from "../lib/artifacts";
import { cn, useCopy } from "../lib/utils";
import { Markdown, renderTextWithMentions } from "./Markdown";
import { AttachmentCard, ExplorerIcon, FileTag, ThinkingIndicator } from "./ChatPrimitives";
import { Tooltip } from "./ui/Tooltip";
import { ConnectorIcon } from "./icons/ConnectorIcon";

type NonFileToolIcon = Exclude<ToolIcon, "file" | "folder">;

const TOOL_ICONS: Record<NonFileToolIcon, React.ComponentType<{ className?: string }>> = {
  terminal: VscTerminal,
  search: VscSearch,
  globe: VscGlobe,
  book: VscBook,
  cpu: VscMcp,
  zapOff: VscFlame,
};

function isNonFileToolIcon(icon: ToolIcon): icon is NonFileToolIcon {
  return icon !== "file" && icon !== "folder";
}

const CompactionDivider = React.memo(function CompactionDivider({ item }: { item: CompactionNoticeItem }) {
  const time = new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Tooltip
      content={`${item.originalMessageCount} earlier messages were summarised to free up context`}
      side="top"
    >
      <div className="CompactionNotice">
        <VscScreenNormal className="CompactionNotice-icon" />
        <span>
          Context compacted · {item.originalMessageCount} messages summarised · {time}
        </span>
      </div>
    </Tooltip>
  );
});

const ToolTarget = React.memo(function ToolTarget({ tool }: { tool: ToolCallItem }) {
  const info = tool.displayInfo;
  if (info.connector) {
    return (
      <span className="ToolRow-target">
        <ConnectorIcon id={info.connector} size={13} className="ToolRow-icon" />
        {info.targetText && <span className="ToolRow-text">{info.targetText}</span>}
      </span>
    );
  }

  if (info.filename) {
    return (
      <FileTag
        path={info.fullPath ?? ""}
        name={info.filename}
        lineRange={info.lineRange ?? undefined}
        added={info.addedLines ?? undefined}
        removed={info.removedLines ?? undefined}
        interactive={info.opensArtifact}
      />
    );
  }

  if (isNonFileToolIcon(info.icon)) {
    const Icon = TOOL_ICONS[info.icon];
    return (
      <span className="ToolRow-target">
        <Icon className="ToolRow-icon" />
        {info.targetText && <span className="ToolRow-text">{info.targetText}</span>}
      </span>
    );
  }

  if (!info.targetText) return null;

  return (
    <span className="ToolRow-target">
      <ExplorerIcon
        type={info.icon === "folder" ? "folder" : "file"}
        name={info.targetText}
        className="ToolRow-icon"
        width={13}
        height={13}
      />
      <span className="ToolRow-text">{info.targetText}</span>
    </span>
  );
});

const ToolRow = React.memo(function ToolRow({ tool }: { tool: ToolCallItem }) {
  const [open, setOpen] = useState(false);
  const output = tool.output?.trim() ?? "";
  const hasOutput = output.length > 0;

  return (
    <div className="ToolRow" data-status={tool.status} data-expandable={hasOutput || undefined}>
      <div
        className={cn("ToolRow-header", hasOutput && "ToolRow-header--interactive")}
        role={hasOutput ? "button" : undefined}
        tabIndex={hasOutput ? 0 : undefined}
        aria-expanded={hasOutput ? open : undefined}
        onClick={hasOutput ? () => setOpen((v) => !v) : undefined}
        onKeyDown={
          hasOutput
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
      >
        <span className="ToolRow-label">{tool.displayInfo.label || tool.name}</span>
        <ToolTarget tool={tool} />
        {tool.status === "running" && <span className="ToolRow-spinner" role="status" aria-label="Running" />}
        {tool.status === "error" && (
          <VscWarning className="ToolRow-errIcon" aria-label="Tool call failed" />
        )}
        {hasOutput && (
          <span className="ToolRow-toggle" data-open={open} aria-hidden="true">
            <VscChevronRight className="ToolRow-chevron" />
          </span>
        )}
      </div>
      {open && hasOutput && <pre className="ToolRow-output">{output}</pre>}
    </div>
  );
});

const ThinkingBlock = React.memo(function ThinkingBlock({ item }: { item: ReasoningItem }) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(() => item.durationSeconds ?? 0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
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
    const el = bodyRef.current;
    if (item.active && isOpen && el && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [item.text, item.active, isOpen]);

  const handleScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
  };

  const label = item.active
    ? `Thinking for ${elapsed}s`
    : elapsed > 0
      ? `Thought for ${elapsed}s`
      : "Thought process";

  return (
    <div className="Reasoning" data-active={item.active || undefined}>
      <button
        type="button"
        className="Reasoning-toggle"
        data-open={isOpen}
        aria-expanded={isOpen}
        onClick={() => setUserToggled(!isOpen)}
      >
        <span className="Reasoning-label">{label}</span>
        <VscChevronRight className="Reasoning-chevron" />
      </button>
      {isOpen && (
        <div className="Reasoning-body" ref={bodyRef} onScroll={handleScroll}>
          <Markdown>{item.text.trim()}</Markdown>
        </div>
      )}
    </div>
  );
});

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
    if (item.type === "text") {
      if (!item.text || !item.text.trim()) continue;
      const last = groups[groups.length - 1];
      if (last?.kind === "text") {
        last.text += last.text.endsWith("\n") ? item.text : `\n${item.text}`;
      } else {
        groups.push({ kind: "text", id: item.id, text: item.text });
      }
      continue;
    }
  }
  return groups;
}

const MessageCopyBtn = React.memo(function MessageCopyBtn({ text }: { text: string }) {
  const { copied, copy } = useCopy(text, 1500);
  return (
    <div className="Msg-actions">
      <Tooltip content={copied ? "Copied" : "Copy response"} side="bottom">
        <button
          type="button"
          className="Msg-actionBtn"
          onClick={copy}
          aria-label="Copy response"
        >
          {copied ? <VscCheck className="CodeBlock-copyIconDone" /> : <VscCopy />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </Tooltip>
    </div>
  );
});

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
                onOpen={
                  attachment.path
                    ? () => useArtifactsStore.getState().openFile(attachment.path)
                    : undefined
                }
              />
            ))}
          </div>
        )}
        {text && <div className="Msg-bubble">{renderTextWithMentions(text)}</div>}
      </div>
    );
  }

  const groups = useMemo(() => groupItems(message.items), [message.items]);
  const fullText = useMemo(
    () =>
      groups
        .filter((g): g is Extract<Group, { kind: "text" }> => g.kind === "text")
        .map((g) => g.text.trim())
        .filter(Boolean)
        .join("\n\n"),
    [groups]
  );

  const isStreaming = Boolean(message.streaming);
  const lastItem = message.items[message.items.length - 1];
  const hasRunningTool = message.items.some((i) => i.type === "toolCall" && i.status === "running");
  const isReasoningActive = lastItem?.type === "reasoning" && Boolean(lastItem.active);
  const showThinking =
    !message.notice &&
    isStreaming &&
    !hasRunningTool &&
    !isReasoningActive &&
    lastItem?.type !== "text";

  return (
    <div className="Msg Msg-assistant" data-streaming={isStreaming || undefined}>
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
        if (!group.text.trim()) return null;
        return (
          <div key={group.id} className="Msg-textGroup">
            <Markdown>{group.text}</Markdown>
          </div>
        );
      })}
      {message.notice && (
        <div className="Msg-notice" role="status">
          <span className="Msg-notice-text">{message.notice}</span>
        </div>
      )}
      {showThinking && <ThinkingIndicator />}
      {message.error && (
        <div className="Msg-error" role="alert">
          <VscWarning aria-hidden="true" />
          <span>{message.error}</span>
        </div>
      )}
      {!isStreaming && fullText.length > 0 && <MessageCopyBtn text={fullText} />}
    </div>
  );
});
