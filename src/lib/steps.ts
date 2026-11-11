import { newId } from "./api";
import type {
  AgDelta,
  AgEvent,
  AgStep,
  HistoryContentPart,
  HistoryRecord,
  SessionRecord,
  ToolDisplayInfo,
} from "./api";
import type { ChatMessage, MessageItem, ToolCallItem } from "./store";
import { getBasename } from "./utils";

export const EXECUTE_BASH = "execute_bash";

type Args = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

function lineCount(value: unknown): number | undefined {
  const text = str(value);
  if (!text) return undefined;
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines.length : undefined;
}

function fileInfo(
  label: string,
  activeLabel: string,
  path: string | undefined,
  extra: Partial<ToolDisplayInfo>
): ToolDisplayInfo {
  return {
    label,
    activeLabel,
    filename: path ? getBasename(path) : null,
    fullPath: path ?? null,
    icon: "file",
    opensArtifact: true,
    ...extra,
  };
}

export function toolDisplayInfo(name: string, args: Args, provided?: ToolDisplayInfo | null): ToolDisplayInfo {
  switch (name) {
    case "view_file": {
      const start = num(args.StartLine);
      const end = num(args.EndLine);
      const lineRange =
        start !== undefined && end !== undefined ? `#L${start}-${end}` : start !== undefined ? `#L${start}` : null;
      return fileInfo("Read", "Reading", str(args.AbsolutePath), { lineRange });
    }
    case "write_to_file":
      return fileInfo("Wrote", "Writing", str(args.TargetFile), { addedLines: lineCount(args.CodeContent) ?? null });
    case "replace_file_content":
      return fileInfo("Edited", "Editing", str(args.TargetFile), {
        addedLines: lineCount(args.ReplacementContent) ?? null,
        removedLines: lineCount(args.TargetContent) ?? null,
      });
    case EXECUTE_BASH:
      return { label: "Ran", activeLabel: "Running", targetText: str(args.command) ?? null, icon: "terminal", opensArtifact: false };
    case "stop_command":
      return { label: "Stopped Task", activeLabel: "Stopping Task", targetText: str(args.task_id) ?? null, icon: "zapOff", opensArtifact: false };
    case "get_command_status":
      return { label: "Task Status", activeLabel: "Checking Task", targetText: str(args.task_id) ?? null, icon: "cpu", opensArtifact: false };
    case "read_skill":
      return { label: "Read Skill", activeLabel: "Reading Skill", targetText: str(args.name) ?? null, icon: "book", opensArtifact: false };
    case "search":
      return {
        label: "Searched Web",
        activeLabel: "Searching Web",
        targetText: strList(args.queries).join(" · ") || null,
        icon: "globe",
        opensArtifact: false,
      };
    case "browse": {
      const urls = strList(args.urls);
      const first = urls[0];
      return {
        label: "Browsed",
        activeLabel: "Browsing",
        targetText: first ? (urls.length > 1 ? `${first} +${urls.length - 1}` : first) : null,
        icon: "globe",
        opensArtifact: false,
      };
    }
    case "search_workspace":
      return { label: "Searched Code", activeLabel: "Searching Code", targetText: str(args.query) ?? null, icon: "search", opensArtifact: false };
    case "find_by_name": {
      const extensions = strList(args.Extensions).map((e) => `*.${e}`).join(", ");
      return {
        label: "Found Files",
        activeLabel: "Finding Files",
        targetText: str(args.Pattern) ?? (extensions || str(args.SearchDirectory) || null),
        icon: "search",
        opensArtifact: false,
      };
    }
    case "list_dir": {
      const path = str(args.DirectoryPath);
      return { label: "Listed", activeLabel: "Listing", targetText: path ?? null, fullPath: path ?? null, icon: "folder", opensArtifact: false };
    }
    default:
      return (
        provided ?? {
          label: name,
          activeLabel: name,
          targetText: JSON.stringify(args).slice(0, 120),
          icon: "terminal",
          opensArtifact: false,
        }
      );
  }
}

interface CallInfo {
  id: string;
  name: string;
  args: Args;
}

function callFromStep(step: AgStep): CallInfo | null {
  const id = step.id ?? "";
  switch (step.type) {
    case "function_call":
      return { id, name: step.name ?? "tool", args: step.arguments ?? {} };
    case "code_execution_call": {
      const args = step.arguments ?? {};
      return { id, name: EXECUTE_BASH, args: { command: args.code, language: args.language } };
    }
    case "google_search_call":
      return { id, name: "search", args: step.arguments ?? {} };
    case "url_context_call":
      return { id, name: "browse", args: step.arguments ?? {} };
    default:
      return null;
  }
}

export interface ResultInfo {
  id: string;
  output?: string;
  isError: boolean;
}

function resultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return undefined;
  try {
    return JSON.stringify(result);
  } catch {
    return undefined;
  }
}

export function resultFromStep(step: AgStep): ResultInfo | null {
  const id = step.call_id ?? "";
  const isError = step.is_error === true;
  switch (step.type) {
    case "code_execution_result":
      return { id, output: resultText(step.result), isError };
    case "function_result":
    case "google_search_result":
    case "url_context_result":
      return { id, isError };
    default:
      return null;
  }
}

export function toolItemFromStep(step: AgStep): ToolCallItem | null {
  const call = callFromStep(step);
  if (!call) return null;
  return {
    type: "toolCall",
    id: call.id || newId(),
    name: call.name,
    args: JSON.stringify(call.args),
    displayInfo: toolDisplayInfo(call.name, call.args, step.display),
    status: "running",
  };
}

export function applyResult(items: MessageItem[], result: ResultInfo): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "toolCall" && item.id === result.id) {
      item.output = result.output;
      item.status = result.isError ? "error" : "done";
      return true;
    }
  }
  return false;
}

export function deltaText(delta: AgDelta | undefined): string {
  if (!delta) return "";
  if (typeof delta.content?.text === "string") return delta.content.text;
  if ((delta.type === undefined || delta.type === "text") && typeof delta.text === "string") return delta.text;
  return "";
}

export interface UsageInfo {
  contextTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export function usageFromEvent(event: AgEvent): UsageInfo | null {
  const total = event.usage ?? event.interaction?.usage;
  const step = event.step_usage;
  if (!total && !step) return null;
  const context = step?.total_input_tokens;
  if (context === undefined && !total) return null;
  return {
    contextTokens: context,
    inputTokens: total?.total_input_tokens,
    outputTokens: total?.total_output_tokens,
    cachedTokens: total?.total_cached_tokens,
    reasoningTokens: total?.total_thought_tokens,
  };
}

function userMessage(seq: number, content: HistoryContentPart[]): ChatMessage {
  const text = content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text as string)
    .join("\n\n");
  const attachments: ChatMessage["attachments"] = [];
  for (const part of content) {
    if (part.type === "image") {
      const mime = part.mime_type ?? "image/png";
      attachments.push({
        name: `image.${mime.split("/")[1] ?? "png"}`,
        isImage: true,
        dataUrl: part.data ? `data:${mime};base64,${part.data}` : part.uri,
      });
    } else if (part.type === "document") {
      attachments.push({
        name: part.name || getBasename(part.path ?? "") || "document",
        isImage: false,
        path: part.path,
      });
    }
  }
  return {
    id: `h-${seq}`,
    role: "user",
    items: text ? [{ type: "text", id: `h-${seq}-text`, text }] : [],
    attachments,
    streaming: false,
  };
}

function applyStepRecord(
  items: MessageItem[],
  record: Extract<HistoryRecord, { kind: "step" }>,
  seq: number
): void {
  const step = record.step;
  const itemId = `h-${seq}-${items.length}`;
  switch (step.type) {
    case "thought": {
      const text = record.deltas.map(deltaText).join("");
      if (!text) return;
      items.push({
        type: "reasoning",
        id: itemId,
        text,
        active: false,
        startTime: 0,
        durationSeconds: record.stop?.duration_seconds,
      });
      return;
    }
    case "model_output": {
      const text = record.deltas.map(deltaText).join("");
      if (!text) return;
      items.push({ type: "text", id: itemId, text });
      return;
    }
    case "work": {
      items.push({
        type: "work",
        id: itemId,
        active: false,
        durationSeconds: record.stop?.duration_seconds,
        stopped: record.stop?.stopped,
      });
      return;
    }
    default: {
      const tool = toolItemFromStep(step);
      if (tool) {
        tool.status = "done";
        items.push(tool);
        return;
      }
      const result = resultFromStep(step);
      if (result) applyResult(items, result);
    }
  }
}

export function recordsToMessages(records: SessionRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;

  const ensureAssistant = (seq: number): ChatMessage => {
    if (assistant) return assistant;
    const created: ChatMessage = {
      id: `h-${seq}`,
      role: "assistant",
      items: [],
      attachments: [],
      streaming: false,
    };
    messages.push(created);
    assistant = created;
    return created;
  };

  for (const { seq, record } of records) {
    switch (record.kind) {
      case "user_input":
        assistant = null;
        messages.push(userMessage(seq, record.content));
        break;
      case "step":
        applyStepRecord(ensureAssistant(seq).items, record, seq);
        break;
      case "interaction": {
        if (record.event_type === "error") {
          const error = record.data.error as { message?: string } | undefined;
          if (error?.message) ensureAssistant(seq).error = error.message;
        }
        break;
      }
      case "orch.compaction":
        assistant = null;
        messages.push({
          id: record.message_id || `h-${seq}`,
          role: "system",
          items: [
            {
              type: "compactionNotice",
              id: record.item_id || `h-${seq}-compaction`,
              originalMessageCount: record.original_message_count,
              ts: record.ts,
            },
          ],
          attachments: [],
          streaming: false,
        });
        break;
    }
  }
  return messages;
}
