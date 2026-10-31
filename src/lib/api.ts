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

interface AttachmentView {
  name: string;
  isImage: boolean;
  path?: string | null;
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
  | { type: "toolResult"; id: string; output?: string; isError: boolean }
  | {
      type: "usage";
      contextTokens: number;
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      reasoningTokens?: number;
    }
  | {
      type: "compacted";
      originalMessageCount: number;
      ts: number;
      compactionMessageId?: string;
      compactionItemId?: string;
    }
  | { type: "notice"; message: string }
  | { type: "done" }
  | { type: "cancelled" }
  | { type: "error"; message: string };

type DictationEvent =
  | { type: "final"; text: string }
  | { type: "error"; message: string };

type TerminalEvent = { type: "data"; data: string } | { type: "exit" };

export type HistoryAction = "back" | "forward" | "reload" | "stop";

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

export function createQuickProjectDir(id: string, name: string): Promise<string> {
  return invoke("create_quick_project_dir", { id, name });
}

export function forgetWorkspace(workspacePath: string, deleteProject: boolean): Promise<void> {
  return invoke("forget_workspace", { workspacePath, deleteProject });
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

interface SessionViewPage {
  messages: MessageView[];
  hasMore: boolean;
  earliestMessageId: number | null;
}

export function getSessionMessagesPage(
  sessionId: string,
  limit?: number,
  beforeMessageId?: number | null
): Promise<SessionViewPage> {
  return invoke("get_session_messages_page", {
    sessionId,
    limit: limit ?? 50,
    beforeMessageId: beforeMessageId ?? null,
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
