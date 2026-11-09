import { invoke, Channel } from "@tauri-apps/api/core";
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
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  running?: boolean;
}

export type ToolIcon =  | "file"
  | "folder"
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
  connector?: string | null;
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

export interface AgUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cached_tokens?: number;
  total_thought_tokens?: number;
}

export interface AgStep {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  is_error?: boolean;
  display?: ToolDisplayInfo;
}

export interface AgDelta {
  type?: string;
  text?: string;
  content?: { text?: string };
}

export interface AgEvent {
  event_type: string;
  index?: number;
  step?: AgStep;
  delta?: AgDelta;
  usage?: AgUsage;
  step_usage?: AgUsage;
  interaction?: { status?: string; usage?: AgUsage };
  status?: string;
  error?: { message?: string; code?: string };
  message?: string;
  duration_seconds?: number;
  original_message_count?: number;
  ts?: number;
  message_id?: string | null;
  item_id?: string | null;
}

export type ChatStreamEvent = AgEvent;

export interface HistoryContentPart {
  type: string;
  text?: string;
  data?: string;
  mime_type?: string;
  uri?: string;
  name?: string;
  path?: string;
}

export type HistoryRecord =
  | { kind: "user_input"; content: HistoryContentPart[] }
  | {
      kind: "step";
      index: number;
      step: AgStep;
      deltas: AgDelta[];
      stop?: { duration_seconds?: number } | null;
    }
  | { kind: "interaction"; event_type: string; data: Record<string, unknown> }
  | {
      kind: "orch.compaction";
      original_message_count: number;
      ts: number;
      message_id: string;
      item_id: string;
    };

export interface SessionRecord {
  seq: number;
  turn: number;
  record: HistoryRecord;
}

export interface SessionRecordPage {
  records: SessionRecord[];
  hasMore: boolean;
  earliestSeq: number | null;
}

export interface CloudWorkspaceInfo {
  workspace: string;
  repoUrl: string;
  repoDir: string;
}

type DictationEvent =
  | { type: "final"; text: string }
  | { type: "error"; message: string };

type TerminalEvent = { type: "data"; data: string } | { type: "exit" };

export type HistoryAction = "back" | "forward" | "reload" | "stop";

export interface LatestRelease {
  version: string;
  releaseUrl: string;
}

export function fetchLatestRelease(): Promise<LatestRelease> {
  return invoke("fetch_latest_release");
}

export function quitApp(): Promise<void> {
  return invoke("quit_app");
}

export function getAuthUser(): Promise<UserDisplay | null> {
  return invoke("get_auth_user");
}

export function getOAuthUrl(redirectTo?: string): Promise<string> {
  return invoke("get_oauth_url", redirectTo ? { redirectTo } : {});
}

export function signOutAuth(): Promise<void> {
  return invoke("sign_out_auth");
}

export function setWorkspace(path: string): Promise<string> {
  return invoke("set_workspace", { path });
}

export function initCloudWorkspace(repoUrl: string): Promise<CloudWorkspaceInfo> {
  return invoke("init_cloud_workspace", { repoUrl });
}

export function setCloudSession(sessionId: string | null): Promise<void> {
  return invoke("set_cloud_session", { sessionId });
}

export function forgetWorkspace(workspacePath: string): Promise<void> {
  return invoke("forget_workspace", { workspacePath });
}

export function listSessionsForWorkspace(workspacePath: string): Promise<SessionSummary[]> {
  return invoke("list_sessions_for_workspace", { workspacePath });
}

export function listModels(forceRefresh?: boolean): Promise<ModelDto[]> {
  return invoke("list_models", { forceRefresh });
}

export function getBudget(): Promise<Budget> {
  return invoke("get_budget");
}

export function getSessionRecords(
  sessionId: string,
  limit?: number,
  beforeSeq?: number | null
): Promise<SessionRecordPage> {
  return invoke("get_session_records", {
    sessionId,
    limit: limit ?? 50,
    beforeSeq: beforeSeq ?? null,
  });
}

export function clearSession(sessionId: string): Promise<void> {
  return invoke("clear_session", { sessionId });
}

export function getUserPref(key: string, scoped = false): Promise<string | null> {
  return invoke("get_user_pref", { key, scoped });
}

export function setUserPref(key: string, value: string, scoped = false): Promise<void> {
  return invoke("set_user_pref", { key, value, scoped });
}

export function startChat(
  sessionId: string,
  model: string,
  prompt: string,
  attachments: AttachmentRef[],
  activeConnectors: string[],
  thinkingEffort: string,
  onEvent: (evt: ChatStreamEvent) => void
): Promise<void> {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = onEvent;
  return invoke("start_chat", {
    sessionId,
    model,
    prompt,
    attachments,
    activeConnectors,
    thinkingEffort,
    onEvent: channel,
  });
}

export function resumeChat(
  sessionId: string,
  onEvent: (evt: ChatStreamEvent) => void
): Promise<void> {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = onEvent;
  return invoke("resume_chat", { sessionId, onEvent: channel });
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

export function readBinaryFile(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_binary_file", { path });
}

export interface SpreadsheetSheet {
  name: string;
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export function readSpreadsheet(path: string): Promise<SpreadsheetSheet[]> {
  return invoke("read_spreadsheet", { path });
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

export function newId(): string {
  return crypto.randomUUID();
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeTime(ts?: number): string {
  if (!ts) return "now";
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 45) return "just now";
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (absSec < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  if (absSec < 31536000) return rtf.format(Math.round(diffSec / 2592000), "month");
  return rtf.format(Math.round(diffSec / 31536000), "year");
}

export interface ConnectorDto {
  id: string;
  name: string;
  description: string;
  category: string;
  connected: boolean;
  toolCount: number;
}

export function listConnectors(): Promise<ConnectorDto[]> {
  return invoke("list_connectors");
}

export function getConnectorAuthUrl(connectorId: string): Promise<string> {
  return invoke("get_connector_auth_url", { connectorId });
}

export function disconnectConnector(connectorId: string): Promise<void> {
  return invoke("disconnect_connector", { connectorId });
}

export type DocumentArtifactKind = "pdf" | "docx" | "xlsx" | "pptx";

export function reportError(message: string): Promise<void> {
  return invoke("report_error", { message });
}
