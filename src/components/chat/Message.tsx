import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  LuBookOpen,
  LuCheck,
  LuChevronRight,
  LuCopy,
  LuCpu,
  LuFlame,
  LuGlobe,
  LuSearch,
  LuTerminal,
  LuTriangleAlert,
} from "react-icons/lu";
import type { ToolIcon } from "../../lib/api";
import type {
  ChatMessage,
  CompactionNoticeItem,
  MessageItem,
  ReasoningItem,
  TextItem,
  ToolCallItem,
  WorkRunItem,
} from "../../lib/store";
import { useCopy } from "../../lib/utils";
import { Attachment } from "../common/Attachment";
import { ConnectorIcon } from "../common/ConnectorIcon";
import { FileChip } from "../common/FileChip";
import { FileIcon } from "../common/FileIcon";
import { IconButton } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { useArtifactsStore } from "../../lib/artifacts";
import { Markdown, renderTextWithMentions } from "./Markdown";

const TOOL_ICONS: Record<Exclude<ToolIcon, "file" | "folder">, ComponentType> = {
  terminal: LuTerminal,
  search: LuSearch,
  globe: LuGlobe,
  book: LuBookOpen,
  cpu: LuCpu,
  zapOff: LuFlame,
};

type StepItem = ReasoningItem | ToolCallItem;
type Segment =
  | { kind: "work"; id: string; run: WorkRunItem; items: StepItem[] }
  | { kind: "text"; id: string; text: string };

const PENDING_RUN: WorkRunItem = { type: "work", id: "pending", active: true };

function buildSegments(items: MessageItem[]): Segment[] {
  const segments: Segment[] = [];
  for (const item of items) {
    if (item.type === "compactionNotice") continue;
    const last = segments[segments.length - 1];
    if (item.type === "work") {
      segments.push({ kind: "work", id: item.id, run: item, items: [] });
    } else if (item.type === "text") {
      if (!item.text?.trim()) continue;
      if (last?.kind === "text") last.text += last.text.endsWith("\n") ? item.text : `\n${item.text}`;
      else segments.push({ kind: "text", id: item.id, text: item.text });
    } else if (last?.kind === "work") {
      last.items.push(item);
    }
  }
  return segments;
}

function runningText(tool: ToolCallItem): string {
  const info = tool.displayInfo;
  const target = (info.filename ?? info.targetText ?? "").replace(/\s+/g, " ").trim();
  return target ? `${info.activeLabel} ${target}` : info.activeLabel;
}

function liveStatus(items: StepItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "toolCall" && item.status === "running") return runningText(item);
    if (i === items.length - 1 && item.type === "reasoning" && item.active) return "Thinking";
  }
  return "Thinking";
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(1, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

function useAutoOpen(live: boolean) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) setToggled(null);
    wasLive.current = live;
  }, [live]);
  return [toggled ?? live, setToggled] as const;
}

const Divider = memo(function Divider({ item }: { item: CompactionNoticeItem }) {
  const time = new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Tooltip content={`${item.originalMessageCount} earlier messages were summarised to free up context`}>
      <div className="msg-divider">Context compacted · {time}</div>
    </Tooltip>
  );
});

function ToolTarget({ tool }: { tool: ToolCallItem }) {
  const info = tool.displayInfo;
  if (!info.connector && info.filename) {
    return (
      <FileChip
        path={info.fullPath ?? ""}
        name={info.filename}
        lineRange={info.lineRange ?? undefined}
        added={info.addedLines ?? undefined}
        removed={info.removedLines ?? undefined}
        interactive={info.opensArtifact}
      />
    );
  }
  const Icon = info.icon !== "file" && info.icon !== "folder" ? TOOL_ICONS[info.icon] : null;
  if (!info.targetText && !info.connector && !Icon) return null;
  return (
    <span className="step-target">
      {info.connector ? (
        <ConnectorIcon id={info.connector} />
      ) : Icon ? (
        <Icon />
      ) : (
        <FileIcon name={info.targetText ?? ""} folder={info.icon === "folder"} />
      )}
      {info.targetText && <span className="truncate">{info.targetText}</span>}
    </span>
  );
}

const ToolStep = memo(function ToolStep({ tool }: { tool: ToolCallItem }) {
  const [open, setOpen] = useState(false);
  const output = tool.output?.trim() ?? "";
  const toggle = output ? () => setOpen((v) => !v) : undefined;

  return (
    <div className="step" data-status={tool.status}>
      <div
        className="step-head"
        role={toggle ? "button" : undefined}
        tabIndex={toggle ? 0 : undefined}
        aria-expanded={toggle ? open : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (toggle && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span>{tool.displayInfo.label || tool.name}</span>
        <ToolTarget tool={tool} />
        {tool.status === "error" && <LuTriangleAlert aria-label="Tool call failed" />}
        {toggle && <LuChevronRight className="step-chevron" />}
      </div>
      {open && output && <pre className="step-output selectable">{output}</pre>}
    </div>
  );
});

const ThinkingStep = memo(function ThinkingStep({ item }: { item: ReasoningItem }) {
  const [open, setOpen] = useAutoOpen(item.active);
  const [elapsed, setElapsed] = useState(() => item.durationSeconds ?? 0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    if (!item.active) {
      if (item.durationSeconds !== undefined) setElapsed(item.durationSeconds);
      return;
    }
    const tick = () => setElapsed(Math.max(1, Math.round((Date.now() - item.startTime) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [item.active, item.startTime, item.durationSeconds]);

  useEffect(() => {
    const el = bodyRef.current;
    if (item.active && open && el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [item.text, item.active, open]);

  const label = item.active ? `Thinking for ${elapsed}s` : elapsed > 0 ? `Thought for ${elapsed}s` : "Thought process";

  return (
    <div className="step">
      <button
        type="button"
        className="disclosure"
        data-live={item.active || undefined}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <LuChevronRight />
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="thinking"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
          }}
        >
          <Markdown>{item.text.trim()}</Markdown>
        </div>
      )}
    </div>
  );
});

const WorkRun = memo(function WorkRun({ run, items }: { run: WorkRunItem; items: StepItem[] }) {
  const live = run.active;
  const [autoOpen, setOpen] = useAutoOpen(live);
  const open = items.length > 0 && autoOpen;
  const label = live
    ? liveStatus(items)
    : run.stopped
      ? "Stopped"
      : run.durationSeconds
        ? `Worked for ${formatDuration(run.durationSeconds)}`
        : "Worked";

  return (
    <div className="step">
      {items.length > 0 ? (
        <button
          type="button"
          className="disclosure"
          data-live={live || undefined}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="truncate">{label}</span>
          <LuChevronRight />
        </button>
      ) : (
        <div className="disclosure" data-live={live || undefined} role="status">
          <span className="truncate">{label}</span>
        </div>
      )}
      {open && (
        <div className="steps">
          {items.map((item) =>
            item.type === "reasoning" ? <ThinkingStep key={item.id} item={item} /> : <ToolStep key={item.id} tool={item} />
          )}
        </div>
      )}
    </div>
  );
});

function CopyAction({ text }: { text: string }) {
  const { copied, copy } = useCopy(text, 1500);
  return (
    <div className="msg-actions">
      <IconButton label={copied ? "Copied" : "Copy response"} size="sm" onClick={copy}>
        {copied ? <LuCheck /> : <LuCopy />}
      </IconButton>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  const text = message.items.find((i): i is TextItem => i.type === "text")?.text ?? "";
  return (
    <div className="msg-user">
      {message.attachments.length > 0 && (
        <div className="msg-files">
          {message.attachments.map((a, i) => (
            <Attachment
              key={`${a.name}-${i}`}
              name={a.name}
              isImage={a.isImage}
              path={a.path}
              dataUrl={a.dataUrl}
              onOpen={a.path ? () => useArtifactsStore.getState().openFile(a.path!) : undefined}
            />
          ))}
        </div>
      )}
      {text && <div className="msg-bubble selectable">{renderTextWithMentions(text)}</div>}
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const segments = useMemo(() => buildSegments(message.items), [message.items]);
  const fullText = useMemo(
    () =>
      segments
        .flatMap((s) => (s.kind === "text" && s.text.trim() ? [s.text.trim()] : []))
        .join("\n\n"),
    [segments]
  );
  const streaming = Boolean(message.streaming);
  const lastSegment = segments[segments.length - 1];
  const runActive = lastSegment?.kind === "work" && lastSegment.run.active;
  const pending = !message.notice && streaming && !runActive && message.items[message.items.length - 1]?.type !== "text";

  return (
    <div className="msg-bot">
      {segments.map((segment) =>
        segment.kind === "work" ? (
          <WorkRun key={`work-${segment.id}`} run={segment.run} items={segment.items} />
        ) : (
          <Markdown key={segment.id}>{segment.text}</Markdown>
        )
      )}
      {pending && <WorkRun run={PENDING_RUN} items={[]} />}
      {message.notice && (
        <div className="alert" data-tone="warn" role="status">
          <span>{message.notice}</span>
        </div>
      )}
      {message.error && (
        <div className="alert" role="alert">
          <LuTriangleAlert aria-hidden="true" />
          <span>{message.error}</span>
        </div>
      )}
      {!streaming && fullText && <CopyAction text={fullText} />}
    </div>
  );
}

export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    const notice = message.items.find((i): i is CompactionNoticeItem => i.type === "compactionNotice");
    return notice ? <Divider item={notice} /> : null;
  }
  if (message.role === "user") return <UserMessage message={message} />;
  return <AssistantMessage message={message} />;
});
