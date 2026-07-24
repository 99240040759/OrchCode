import { invoke, Channel } from "@tauri-apps/api/core";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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
  badge?: string;
  reasoningEffort?: string;
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
  title?: string;
  workspacePath?: string;
  updatedAt: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastTotalTokens: number;
}

export interface ToolDisplayInfo {
  label: string;
  filename?: string;
  fullPath?: string;
  lineRange?: string;
  addedLines?: number;
  removedLines?: number;
  targetText?: string;
  icon: "file" | "terminal" | "search" | "globe" | "book" | "cpu" | "mousePointer" | "keyboard" | "eye" | "zapOff" | "database";
  opensArtifact: boolean;
}

export type MessageItemView =
  | { type: "text"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string; durationSeconds?: number }
  | {
      type: "toolCall";
      id: string;
      name: string;
      args: string;
      output?: string;
      displayInfo: ToolDisplayInfo;
      status: string;
    }
  | { type: "compactionNotice"; id: string; originalMessageCount: number; ts: number };

export interface AttachmentView {
  name: string;
  isImage: boolean;
  dataUrl: string;
}

export interface MessageView {
  id: string;
  role: "user" | "assistant";
  items: MessageItemView[];
  attachments: AttachmentView[];
}

export interface UserDisplay {
  id: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
  initial: string;
}

export interface FileEntry {
  path: string;
  name: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type DictationEvent =
  | { type: "final"; text: string }
  | { type: "error"; message: string };

export type TerminalEvent =
  | { type: "data"; data: string }
  | { type: "exit" };

export async function isAuthenticated(): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke("is_authenticated");
}

export async function getAuthUser(): Promise<UserDisplay | null> {
  if (!inTauri()) return null;
  return invoke("get_auth_user");
}

export async function getOAuthUrl(redirectTo?: string): Promise<string> {
  if (!inTauri()) return "";
  return invoke("get_oauth_url", { redirectTo });
}

export async function setAuthSession(accessToken: string, refreshToken?: string): Promise<UserDisplay> {
  if (!inTauri()) throw new Error("Tauri API unavailable");
  return invoke("set_auth_session", { accessToken, refreshToken });
}

export async function signOutAuth(): Promise<void> {
  if (!inTauri()) return;
  return invoke("sign_out_auth");
}

export async function setWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke("set_workspace", { path });
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  return invoke("get_workspace_info");
}

export async function useSandbox(): Promise<WorkspaceInfo> {
  return invoke("use_sandbox");
}

export async function listModels(forceRefresh = false): Promise<ModelDto[]> {
  if (!inTauri()) return [];
  return invoke("list_models", { forceRefresh });
}

export async function getBudget(): Promise<Budget | null> {
  if (!inTauri()) return null;
  return invoke("get_budget");
}

export async function listSessions(): Promise<SessionSummary[]> {
  if (!inTauri()) return [];
  return invoke("list_sessions");
}

export async function getSessionView(sessionId: string): Promise<MessageView[]> {
  if (!inTauri()) return [];
  return invoke("get_session_view", { sessionId });
}

export async function clearSession(sessionId?: string): Promise<void> {
  if (!inTauri() || !sessionId) return;
  return invoke("clear_session", { sessionId });
}

export async function getUserPref(key: string): Promise<unknown> {
  if (!inTauri()) return null;
  return invoke("get_user_pref", { key });
}

export async function setUserPref(key: string, value: unknown): Promise<void> {
  if (!inTauri()) return;
  return invoke("set_user_pref", { key, value });
}

export interface AttachmentRef {
  path: string;
  name: string;
  isImage: boolean;
}

export async function startChat(
  sessionId: string,
  model: string,
  prompt: string,
  reasoningEffort?: string,
  attachments?: AttachmentRef[],
  onEvent?: (evt: unknown) => void
): Promise<void> {
  if (!inTauri()) return;
  const ch = new Channel<unknown>();
  if (onEvent) ch.onmessage = onEvent;
  return invoke("start_chat", { sessionId, model, prompt, reasoningEffort, attachments: attachments ?? [], onEvent: ch });
}

export async function cancelChat(sessionId: string): Promise<void> {
  if (!inTauri() || !sessionId) return;
  return invoke("cancel_chat", { sessionId });
}

export async function listWorkspaceFiles(query: string, limit = 100): Promise<FileEntry[]> {
  if (!inTauri()) return [];
  return invoke("list_workspace_files", { query, limit });
}

export async function listDir(path?: string): Promise<DirEntry[]> {
  if (!inTauri()) return [];
  return invoke("list_dir", { path: path ?? null });
}

export async function readTextFile(path: string): Promise<{ content: string; truncated: boolean }> {
  if (!inTauri()) return { content: "", truncated: false };
  return invoke("read_text_file", { path });
}

export async function startDictation(onEvent: (evt: DictationEvent) => void): Promise<void> {
  if (!inTauri()) return;
  const ch = new Channel<DictationEvent>();
  ch.onmessage = onEvent;
  await invoke("start_dictation", { onEvent: ch });
}

export async function stopDictation(): Promise<void> {
  if (!inTauri()) return;
  await invoke("stop_dictation");
}

export async function terminalOpen(
  id: string,
  cwd: string | null,
  cols: number,
  rows: number,
  onEvent: (data: TerminalEvent) => void
): Promise<void> {
  if (!inTauri()) return;
  const ch = new Channel<TerminalEvent>();
  ch.onmessage = onEvent;
  return invoke("terminal_open", { id, cwd, cols, rows, onEvent: ch });
}

export async function terminalWrite(id: string, data: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("terminal_write", { id, data });
}

export async function terminalResize(id: string, cols: number, rows: number): Promise<void> {
  if (!inTauri()) return;
  return invoke("terminal_resize", { id, cols, rows });
}

export async function terminalClose(id: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("terminal_close", { id });
}

export async function webviewNavigate(label: string, url: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("webview_navigate", { label, url });
}

export async function webviewBack(label: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("webview_history", { label, action: "back" });
}

export async function webviewForward(label: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("webview_history", { label, action: "forward" });
}

export async function webviewReload(label: string): Promise<void> {
  if (!inTauri()) return;
  return invoke("webview_history", { label, action: "reload" });
}
