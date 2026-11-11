import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  LuBookOpen,
  LuCheck,
  LuChevronRight,
  LuCopy,
  LuCpu,
  LuFlame,
  LuGlobe,
  LuSearch,
  LuShrink,
  LuTerminal,
  LuTriangleAlert,
} from "react-icons/lu";
import type { ToolIcon } from "../lib/api";
import type {
  ChatMessage,
  CompactionNoticeItem,
  MessageItem,
  ReasoningItem,
  TextItem,
  ToolCallItem,
  WorkRunItem,
} from "../lib/store";
import { useArtifactsStore } from "../lib/artifacts";
import { cn, useCopy } from "../lib/utils";
import { Markdown, renderTextWithMentions } from "./Markdown";
import { AttachmentCard, ExplorerIcon, FileTag } from "./ChatPrimitives";
import { Tooltip } from "./ui/Tooltip";
import { ConnectorIcon } from "./icons/ConnectorIcon";

type NonFileToolIcon = Exclude<ToolIcon, "file" | "folder">;

const TOOL_ICONS: Record<NonFileToolIcon, React.ComponentType<{ className?: string }>> = {
  terminal: LuTerminal,
  search: LuSearch,
  globe: LuGlobe,
  book: LuBookOpen,
  cpu: LuCpu,
  zapOff: LuFlame,
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
        <LuShrink className="CompactionNotice-icon" />
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
        <ConnectorIcon id={info.connector} className="ToolRow-icon" />
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
        {tool.status === "error" && (
          <LuTriangleAlert className="ToolRow-errIcon" aria-label="Tool call failed" />
        )}
        {hasOutput && (
          <span className="ToolRow-toggle" data-open={open} aria-hidden="true">
            <LuChevronRight className="ToolRow-chevron" />
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
        <LuChevronRight className="Reasoning-chevron" />
      </button>
      {isOpen && (
        <div className="Reasoning-body" ref={bodyRef} onScroll={handleScroll}>
          <Markdown>{item.text.trim()}</Markdown>
        </div>
      )}
    </div>
  );
});

type StepItem = ReasoningItem | ToolCallItem;

type Segment =
  | { kind: "work"; id: string; run: WorkRunItem; items: StepItem[] }
  | { kind: "text"; id: string; text: string };

function buildSegments(items: MessageItem[]): Segment[] {
  const segments: Segment[] = [];
  for (const item of items) {
    if (item.type === "compactionNotice") continue;
    const last = segments[segments.length - 1];
    if (item.type === "work") {
      segments.push({ kind: "work", id: item.id, run: item, items: [] });
    } else if (item.type === "text") {
      if (!item.text || !item.text.trim()) continue;
      if (last?.kind === "text") {
        last.text += last.text.endsWith("\n") ? item.text : `\n${item.text}`;
      } else {
        segments.push({ kind: "text", id: item.id, text: item.text });
      }
    } else if (last?.kind === "work") {
      last.items.push(item);
    }
  }
  return segments;
}

function runningText(tool: ToolCallItem): string {
  const info = tool.displayInfo;
  const verb = info.activeLabel;
  const target = (info.filename ?? info.targetText ?? "").replace(/\s+/g, " ").trim();
  return target ? `${verb} ${target}` : verb;
}

function currentStatus(items: StepItem[]): string {
  const last = items[items.length - 1];
  if (last?.type === "toolCall" && last.status === "running") return runningText(last);
  if (last?.type === "reasoning" && last.active) return "Thinking";
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "toolCall" && item.status === "running") return runningText(item);
  }
  return "Thinking";
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(1, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

function summaryLabel(run: WorkRunItem): string {
  if (run.stopped) return "Stopped";
  return run.durationSeconds ? `Worked for ${formatDuration(run.durationSeconds)}` : "Worked";
}

const PENDING_RUN: WorkRunItem = { type: "work", id: "pending", active: true };

const WorkBlock = React.memo(function WorkBlock({
  run,
  items,
}: {
  run: WorkRunItem;
  items: StepItem[];
}) {
  const live = run.active;
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const wasLive = useRef(live);

  useEffect(() => {
    if (wasLive.current && !live) setUserToggled(null);
    wasLive.current = live;
  }, [live]);

  const hasSteps = items.length > 0;
  const open = hasSteps && (userToggled ?? live);
  const label = live ? currentStatus(items) : summaryLabel(run);

  return (
    <div className="Work" data-live={live || undefined} data-open={open}>
      {hasSteps ? (
        <button
          type="button"
          className="Work-toggle"
          aria-expanded={open}
          onClick={() => setUserToggled(!open)}
        >
          <span className={cn("Work-label", live && "Shimmer")}>{label}</span>
          <LuChevronRight className="Work-chevron" />
        </button>
      ) : (
        <div className="Work-toggle Work-toggle--static" role="status">
          <span className={cn("Work-label", live && "Shimmer")}>{label}</span>
        </div>
      )}
      {open && (
        <div className="Work-steps">
          {items.map((item) =>
            item.type === "reasoning" ? (
              <ThinkingBlock key={item.id} item={item} />
            ) : (
              <ToolRow key={item.id} tool={item} />
            )
          )}
        </div>
      )}
    </div>
  );
});

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
          {copied ? <LuCheck className="CodeBlock-copyIconDone" /> : <LuCopy />}
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
            {message.attachments.map((attachment, index) => {
              const { path } = attachment;
              return (
                <AttachmentCard
                  key={`${attachment.name}-${index}`}
                  name={attachment.name}
                  isImage={attachment.isImage}
                  path={path}
                  dataUrl={attachment.dataUrl}
                  onOpen={path ? () => useArtifactsStore.getState().openFile(path) : undefined}
                />
              );
            })}
          </div>
        )}
        {text && <div className="Msg-bubble">{renderTextWithMentions(text)}</div>}
      </div>
    );
  }

  const segments = useMemo(() => buildSegments(message.items), [message.items]);
  const fullText = useMemo(
    () =>
      segments
        .filter((g): g is Extract<Segment, { kind: "text" }> => g.kind === "text")
        .map((g) => g.text.trim())
        .filter(Boolean)
        .join("\n\n"),
    [segments]
  );

  const isStreaming = Boolean(message.streaming);
  const lastItem = message.items[message.items.length - 1];
  const lastSegment = segments[segments.length - 1];
  const runActive = lastSegment?.kind === "work" && lastSegment.run.active;
  const showThinking =
    !message.notice && isStreaming && !runActive && lastItem?.type !== "text";

  return (
    <div className="Msg Msg-assistant" data-streaming={isStreaming || undefined}>
      {segments.map((segment) =>
        segment.kind === "work" ? (
          <WorkBlock key={`work-${segment.id}`} run={segment.run} items={segment.items} />
        ) : (
          <div key={segment.id} className="Msg-textGroup">
            <Markdown>{segment.text}</Markdown>
          </div>
        )
      )}
      {showThinking && <WorkBlock key="work-pending" run={PENDING_RUN} items={[]} />}
      {message.notice && (
        <div className="Msg-notice" role="status">
          <span className="Msg-notice-text">{message.notice}</span>
        </div>
      )}
      {message.error && (
        <div className="Msg-error" role="alert">
          <LuTriangleAlert aria-hidden="true" />
          <span>{message.error}</span>
        </div>
      )}
      {!isStreaming && fullText.length > 0 && <MessageCopyBtn text={fullText} />}
    </div>
  );
});
