// ─── Core domain ─────────────────────────────────────────────────────────────
export interface Workspace { id: string; name: string; path: string; createdAt: number; }
export interface Conversation { id: string; workspaceId: string | null; title: string; createdAt: number; updatedAt: number; }
export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'streaming' | 'complete' | 'aborted' | 'error';
export type PartType = 'text' | 'reasoning' | 'tool' | 'image' | 'mention' | 'file';
export type ToolStatus = 'running' | 'done' | 'error';
// ─── DB rows ──────────────────────────────────────────────────────────────────
export interface DBMessage { id: string; convId: string; role: Role; seq: number; status: MessageStatus; error: string | null; model: string | null; compacted: number; createdAt: number; updatedAt: number; }
export interface DBPart {
  id: string; messageId: string; convId: string; seq: number; type: PartType;
  text: string | null;
  toolCallId: string | null; toolName: string | null; toolArgs: string | null; toolResult: string | null; toolStatus: ToolStatus | null; toolMeta: string | null;
  artifactId: string | null; path: string | null;
  createdAt: number; updatedAt: number;
}
export interface DBArtifact { id: string; convId: string; messageId: string | null; partId: string | null; kind: string; mime: string; name: string; data: string; createdAt: number; }
// ─── UI projection (renderer) ─────────────────────────────────────────────────
export interface UITextPart { type: 'text' | 'reasoning'; id: string; text: string; }
export interface UIToolPart { type: 'tool'; id: string; toolCallId: string; name: string; args: string; result?: string; status: ToolStatus; meta?: Record<string, any>; }
export interface UIImagePart { type: 'image'; id: string; artifactId: string | null; mime: string; name: string; dataUrl?: string; }
export interface UIMentionPart { type: 'mention'; id: string; path: string; }
export interface UIFilePart { type: 'file'; id: string; artifactId: string | null; name: string; mime: string; }
export type UIPart = UITextPart | UIToolPart | UIImagePart | UIMentionPart | UIFilePart;
export interface UIMessage { id: string; convId: string; role: Role; status: MessageStatus; error?: string | null; parts: UIPart[]; createdAt: number; }
// Build UI messages from flat DB rows (artifacts inlined into image/file parts as dataUrl)
export function buildUIMessages(messages: DBMessage[], parts: DBPart[], artifacts: DBArtifact[]): UIMessage[] {
  const artMap = new Map(artifacts.map(a => [a.id, a]));
  const partsByMsg = new Map<string, DBPart[]>();
  for (const p of parts) { const a = partsByMsg.get(p.messageId) || []; a.push(p); partsByMsg.set(p.messageId, a); }
  return messages.map(m => ({
    id: m.id, convId: m.convId, role: m.role, status: m.status, error: m.error, createdAt: m.createdAt,
    parts: (partsByMsg.get(m.id) || []).sort((a, b) => a.seq - b.seq).map(p => dbPartToUI(p, artMap)),
  }));
}
export function dbPartToUI(p: DBPart, artMap: Map<string, DBArtifact>): UIPart {
  switch (p.type) {
    case 'tool': return { type: 'tool', id: p.id, toolCallId: p.toolCallId!, name: p.toolName!, args: p.toolArgs || '{}', result: p.toolResult ?? undefined, status: (p.toolStatus || 'running') as ToolStatus, meta: p.toolMeta ? safeJson(p.toolMeta) : undefined };
    case 'image': { const a = p.artifactId ? artMap.get(p.artifactId) : undefined; return { type: 'image', id: p.id, artifactId: p.artifactId, mime: a?.mime || 'image/png', name: a?.name || 'image', dataUrl: a ? `data:${a.mime};base64,${a.data}` : undefined }; }
    case 'file': { const a = p.artifactId ? artMap.get(p.artifactId) : undefined; return { type: 'file', id: p.id, artifactId: p.artifactId, name: a?.name || p.path || 'file', mime: a?.mime || 'application/octet-stream' }; }
    case 'mention': return { type: 'mention', id: p.id, path: p.path! };
    default: return { type: p.type as 'text' | 'reasoning', id: p.id, text: p.text || '' };
  }
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
// ─── Models / budget / auth ───────────────────────────────────────────────────
export interface ModelDef { id: string; name: string; multimodal: boolean; contextWindow: number; badge: string | null; provider: 'opencode' | 'z-ai'; reasoningEffort: string | null; }
export type { AuthUser } from '../auth';
export interface BudgetInfo { cost_usd: number; limit_usd: number; remaining: number; period: string; allowed: boolean; }
// ─── Agent run protocol ───────────────────────────────────────────────────────
export interface AgentRunConfig { convId: string; workspacePath: string | null; sessionDir: string; jwt: string; anonKey: string; gcpBase: string; modelId: string; provider: string; contextWindow: number; reasoningEffort: string | null; }
// History passed to worker: message + its parts; image/file parts carry inlined dataUrl for the model
export interface HistoryPart extends DBPart { dataUrl?: string; }
export interface HistoryMessage { message: DBMessage; parts: HistoryPart[]; }
export interface RunRequest { type: 'run'; config: AgentRunConfig; history: HistoryMessage[]; }
export interface AbortRequest { type: 'abort'; }
export type WorkerInbound = RunRequest | AbortRequest;
// Events: worker → main (persist) → renderer (project)
export type AgentEvent =
  | { type: 'message.start'; message: DBMessage }
  | { type: 'part.start'; part: DBPart }
  | { type: 'part.delta'; messageId: string; partId: string; text: string }
  | { type: 'part.image'; messageId: string; partId: string; seq: number; mime: string; name: string; dataUrl: string }
  | { type: 'tool.update'; messageId: string; partId: string; status: ToolStatus; result?: string; meta?: Record<string, any> }
  | { type: 'message.end'; messageId: string; status: MessageStatus; error?: string }
  | { type: 'title'; title: string }
  | { type: 'tokens'; count: number }
  | { type: 'compacted'; summaryMessage: DBMessage; summaryPart: DBPart; compactedIds: string[] };
