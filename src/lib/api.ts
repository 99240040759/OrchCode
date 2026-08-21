import { invoke, Channel } from "@tauri-apps/api/core";
import { formatDistanceToNowStrict } from "date-fns";

export interface WorkspaceInfo {
  path: string;
  name: string;
  isSandbox: boolean;
}

export interface ModelDto {
  key: string;
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  capabilities: string[];
  badge?: string | null;
}

export interface Budget {
  costUsd: number;
  limitUsd: number;
  remaining: number;
  period: string;
  allowed: boolean;
}

export interface SessionSummary {
  id: string;
  title?: string | null;
  workspacePath?: string | null;
  updatedAt: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastTotalTokens: number;
}

export type ToolIcon =
  | "file"
  | "terminal"
  | "search"
  | "globe"
  | "book"
  | "cpu"
  | "zapOff";

export interface ToolDisplayInfo {
  label: string;
  filename?: string | null;
  fullPath?: string | null;
  lineRange?: string | null;
  addedLines?: number | null;
  removedLines?: number | null;
  targetText?: string | null;
  icon: ToolIcon;
  opensArtifact: boolean;
}

export type MessageItemView =
  | { type: "text"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string; durationSeconds?: number | null }
  | {
      type: "toolCall";
      id: string;
      name: string;
      args: string;
      output?: string | null;
      displayInfo: ToolDisplayInfo;
      status: string;
    }
  | { type: "compactionNotice"; id: string; originalMessageCount: number; ts: number };

export interface AttachmentView {
  name: string;
  isImage: boolean;
  dataUrl?: string | null;
}

export interface MessageView {
  id: string;
  role: string;
  items: MessageItemView[];
  attachments: AttachmentView[];
}

export interface UserDisplay {
  id: string;
  email?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  initial: string;
}

export interface FileEntry {
  path: string;
  name: string;
}

export interface FileContent {
  path: string;
  content: string;
  truncated: boolean;
}

export interface AttachmentRef {
  path: string;
  name: string;
  isImage: boolean;
}

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoningDone"; durationSeconds: number }
  | { type: "toolCall"; id: string; name: string; args: string; displayInfo: ToolDisplayInfo }
  | { type: "toolResult"; id: string; output: string; isError: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: "compacted"; originalMessageCount: number; ts: number }
  | { type: "done" }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export type DictationEvent =
  | { type: "final"; text: string }
  | { type: "error"; message: string };

export type TerminalEvent = { type: "data"; data: string } | { type: "exit" };

export type HistoryAction = "back" | "forward" | "reload";

export function getAuthUser(): Promise<UserDisplay | null> {
  return invoke("get_auth_user");
}

export function getOAuthUrl(redirectTo: string): Promise<string> {
  return invoke("get_oauth_url", { redirectTo });
}

export function signOutAuth(): Promise<void> {
  return invoke("sign_out_auth");
}

export function setWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke("set_workspace", { path });
}

export function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  return invoke("get_workspace_info");
}

export function useSandbox(): Promise<WorkspaceInfo> {
  return invoke("use_sandbox");
}

export function listModels(forceRefresh = false): Promise<ModelDto[]> {
  return invoke("list_models", { forceRefresh });
}

export function getBudget(): Promise<Budget> {
  return invoke("get_budget");
}

export function listSessions(): Promise<SessionSummary[]> {
  return invoke("list_sessions");
}

export function getSessionView(sessionId: string): Promise<MessageView[]> {
  return invoke("get_session_view", { sessionId });
}

export function clearSession(sessionId: string): Promise<void> {
  return invoke("clear_session", { sessionId });
}

export function getUserPref(key: string): Promise<string | null> {
  return invoke("get_user_pref", { key });
}

export function setUserPref(key: string, value: string): Promise<void> {
  return invoke("set_user_pref", { key, value });
}

export function startChat(
  sessionId: string,
  model: string,
  prompt: string,
  reasoningEffort: string,
  attachments: AttachmentRef[],
  onEvent: (evt: ChatStreamEvent) => void
): Promise<void> {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = onEvent;
  return invoke("start_chat", {
    sessionId,
    model,
    prompt,
    reasoningEffort,
    attachments,
    onEvent: channel,
  });
}

export function cancelChat(sessionId: string): Promise<void> {
  return invoke("cancel_chat", { sessionId });
}

export function listWorkspaceFiles(query: string, limit = 100): Promise<FileEntry[]> {
  return invoke("list_workspace_files", { query, limit });
}

export function readTextFile(path: string): Promise<FileContent> {
  return invoke("read_text_file", { path });
}

export function readImageDataUrl(path: string): Promise<string> {
  return invoke("read_image_data_url", { path });
}

export function startDictation(onEvent: (evt: DictationEvent) => void): Promise<void> {
  const channel = new Channel<DictationEvent>();
  channel.onmessage = onEvent;
  return invoke("start_dictation", { onEvent: channel });
}

export function stopDictation(): Promise<void> {
  return invoke("stop_dictation");
}

export function terminalOpen(
  id: string,
  cols: number,
  rows: number,
  onEvent: (evt: TerminalEvent) => void
): Promise<void> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke("terminal_open", { id, cols, rows, onEvent: channel });
}

export function terminalWrite(id: string, data: string): Promise<void> {
  return invoke("terminal_write", { id, data });
}

export function terminalResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke("terminal_resize", { id, cols, rows });
}

export function terminalClose(id: string): Promise<void> {
  return invoke("terminal_close", { id });
}

export function webviewNavigate(label: string, url: string): Promise<void> {
  return invoke("webview_navigate", { label, url });
}

export function webviewHistory(label: string, action: HistoryAction): Promise<void> {
  return invoke("webview_history", { label, action });
}

export function webviewClose(label: string): Promise<void> {
  return invoke("webview_close", { label });
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export { clsx as cn } from "clsx";

export function newId(): string {
  return crypto.randomUUID();
}

export function splitPathParts(pathStr: string): string[] {
  return pathStr.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function getBasename(pathStr: string): string {
  if (!pathStr) return "";
  const parts = pathStr.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || pathStr;
}

export function getDirname(pathStr: string): string {
  if (!pathStr) return "";
  const parts = pathStr.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
}

export const MENTION_PATTERN = "(?:@\\[([^\\]]+)\\]|@([^\\s@]+))(#L\\d+(?:-\\d+)?)?";

export function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.[a-zA-Z0-9]+$/.test(value);
}

export function createMentionRegex(): RegExp {
  return new RegExp(MENTION_PATTERN, "g");
}

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUsd(amount: number): string {
  return USD_FORMAT.format(amount);
}

export function formatRelativeTime(ts?: number): string {
  if (!ts) return "now";
  return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
}

const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function isImagePath(pathStr: string): boolean {
  return IMAGE_EXT_PATTERN.test(pathStr);
}
