import { invoke, Channel } from "@tauri-apps/api/core";
import { formatDistanceToNowStrict } from "date-fns";

export {
  cn,
  splitPathParts,
  getBasename,
  getDirname,
  getExt,
  IMAGE_EXTENSIONS,
  isImagePath,
  looksLikePath,
  createMentionRegex,
  formatUsd,
  useCopy,
} from "./utils";

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
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export type ToolIcon =
  | "file"
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

export function setWorkspace(path: string): Promise<void> {
  return invoke("set_workspace", { path });
}

export function listSessionsForWorkspace(workspacePath: string): Promise<SessionSummary[]> {
  return invoke("list_sessions_for_workspace", { workspacePath });
}

export function listModels(forceRefresh = false): Promise<ModelDto[]> {
  return invoke("list_models", { forceRefresh });
}

export function getBudget(): Promise<Budget> {
  return invoke("get_budget");
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
  attachments: AttachmentRef[],
  onEvent: (evt: ChatStreamEvent) => void
): Promise<void> {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = onEvent;
  return invoke("start_chat", { sessionId, model, prompt, attachments, onEvent: channel });
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

export function readBinaryFileAsDataUrl(path: string): Promise<string> {
  return invoke("read_binary_file_as_data_url", { path });
}

export interface DocumentFileMeta {
  name: string;
  sizeBytes: number;
  extension: string;
  mime: string;
  modified: number | null;
}

export function readDocumentMetadata(path: string): Promise<DocumentFileMeta> {
  return invoke("read_document_metadata", { path });
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

export function formatRelativeTime(ts?: number): string {
  if (!ts) return "now";
  return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Invalid data URL");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export interface ConnectorDto {
  id: string;
  name: string;
  description: string;
  category: string;
  authKind: string;
  isConfigured: boolean;
  hasToken: boolean;
  tokenExpiresAt?: number | null;
  error?: string | null;
}

export function listConnectors(): Promise<ConnectorDto[]> {
  return invoke("list_connectors");
}

export function getConnectorAuthUrl(connectorId: string): Promise<string> {
  return invoke("get_connector_auth_url", { connectorId });
}

export function completeConnectorAuth(
  connectorId: string,
  code: string,
  oauthState: string
): Promise<ConnectorDto> {
  return invoke("complete_connector_auth", { connectorId, code, oauthState });
}

export function disconnectConnector(connectorId: string): Promise<void> {
  return invoke("disconnect_connector", { connectorId });
}

export interface DocumentRecord {
  id: string;
  title: string;
  filePath?: string | null;
  source: string;
  sourceId?: string | null;
  fileType: string;
  sizeBytes: number;
  pageCount?: number | null;
  wordCount?: number | null;
  metadata: unknown;
  indexedAt: number;
  updatedAt: number;
}

export interface SearchHit {
  documentId: string;
  documentTitle: string;
  fileType: string;
  source: string;
  filePath?: string | null;
  passageId: string;
  snippet: string;
  pageNumber?: number | null;
  score: number;
}

export interface IngestResultDto {
  documentId: string;
  title: string;
  fileType: string;
  passageCount: number;
  wordCount: number;
  pageCount?: number | null;
  wasUpdate: boolean;
}

export function ingestDocument(path: string): Promise<IngestResultDto> {
  return invoke("ipc_ingest_document", { path });
}

export function listDocuments(opts?: {
  source?: string;
  fileType?: string;
  limit?: number;
  offset?: number;
}): Promise<DocumentRecord[]> {
  return invoke("ipc_list_documents", {
    source: opts?.source ?? null,
    fileType: opts?.fileType ?? null,
    limit: opts?.limit ?? 50,
    offset: opts?.offset ?? 0,
  });
}

export function getDocument(documentId: string): Promise<DocumentRecord | null> {
  return invoke("ipc_get_document", { documentId });
}

export function deleteDocument(documentId: string): Promise<void> {
  return invoke("ipc_delete_document", { documentId });
}

export function searchDocuments(query: string, limit?: number): Promise<SearchHit[]> {
  return invoke("ipc_search_documents", { query, limit: limit ?? 20 });
}

export function countDocuments(): Promise<number> {
  return invoke("ipc_count_documents");
}

export interface ParsedDocumentDto {
  title?: string | null;
  fileType: string;
  pageCount?: number | null;
  fullText: string;
}

export function readParsedDocument(path: string): Promise<ParsedDocumentDto> {
  return invoke("read_parsed_document", { path });
}

export type DocumentArtifactKind = "pdf" | "docx" | "xlsx" | "pptx";

const DOCUMENT_ARTIFACT_KINDS: Record<string, DocumentArtifactKind> = {
  pdf: "pdf",
  doc: "docx",
  docx: "docx",
  xls: "xlsx",
  xlsx: "xlsx",
  ppt: "pptx",
  pptx: "pptx",
};

export function documentArtifactKind(fileType: string): DocumentArtifactKind | undefined {
  return DOCUMENT_ARTIFACT_KINDS[fileType.toLowerCase()];
}

export function documentArtifactKindForPath(path: string): DocumentArtifactKind | undefined {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const extension = name.split(".").pop() ?? "";
  return documentArtifactKind(extension);
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  doc: "Word",
  xlsx: "Excel",
  xls: "Excel",
  pptx: "PowerPoint",
  ppt: "PowerPoint",
  txt: "Text",
  md: "Markdown",
  csv: "CSV",
  json: "JSON",
};

export function documentTypeLabel(fileType: string): string {
  const key = fileType.toLowerCase();
  return DOCUMENT_TYPE_LABELS[key] ?? fileType.toUpperCase();
}
