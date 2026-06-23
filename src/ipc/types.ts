export interface Workspace { id: string; name: string; path: string; createdAt: number; }
export interface Conversation { id: string; workspaceId: string | null; title: string; createdAt: number; updatedAt: number; }
// DB-layer types (SQLite schema unchanged)
export interface Message { id: string; convId: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolCallId?: string; tokenCount: number; createdAt: number; }
export interface ToolCall { id: string; msgId: string; convId: string; name: string; input: string; output?: string; startLine?: number; endLine?: number; diffAdded?: number; diffRemoved?: number; createdAt: number; }
// UI-layer types — parts[] model
export type TextPart = { type: 'text'; text: string };
export type ToolPart = { type: 'tool-call'; id: string; name: string; input: string; output?: string; startLine?: number; endLine?: number; diffAdded?: number; diffRemoved?: number; };
export type MessagePart = TextPart | ToolPart;
export interface UIMessage { id: string; convId: string; role: 'user' | 'assistant' | 'system'; parts: MessagePart[]; createdAt: number; }
// Utility: reconstruct UIMessages from flat DB rows
export function dbRowsToUIMessages(msgs: Message[], tcs: ToolCall[]): UIMessage[] {
  const tcByMsgId = new Map<string, ToolCall[]>();
  for (const tc of tcs) { const arr = tcByMsgId.get(tc.msgId) || []; arr.push(tc); tcByMsgId.set(tc.msgId, arr); }
  const result: UIMessage[] = [];
  for (const m of msgs) {
    if (m.role === 'tool') continue; // tool results are embedded as output on ToolPart
    const parts: MessagePart[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const tc of tcByMsgId.get(m.id) || []) {
      parts.push({ type: 'tool-call', id: tc.id, name: tc.name, input: tc.input, output: tc.output, startLine: tc.startLine, endLine: tc.endLine, diffAdded: tc.diffAdded, diffRemoved: tc.diffRemoved });
    }
    result.push({ id: m.id, convId: m.convId, role: m.role as UIMessage['role'], parts, createdAt: m.createdAt });
  }
  return result;
}
export interface ModelDef { id: string; name: string; multimodal: boolean; contextWindow: number; badge: string | null; provider: 'opencode' | 'z-ai'; reasoningEffort: string | null; }
export type { AuthUser } from '../auth';
export interface BudgetInfo { cost_usd: number; limit_usd: number; remaining: number; period: string; allowed: boolean; }
export interface AgentInitConfig { convId: string; workspacePath: string | null; sessionDir: string; history: Message[]; jwt: string; anonKey: string; gcpBase: string; modelId: string; provider: string; contextWindow: number; reasoningEffort: string | null; }
export type AgentChunk =
  | { type: 'iter_start'; messageId: string }
  | { type: 'chunk'; delta: string; tokenCount: number; contextWindow: number; messageId: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; result: string; meta?: Record<string, any> }
  | { type: 'done' }
  | { type: 'error'; error: string }
  | { type: 'summary'; summaryMsg: Message }
  | { type: 'db:tokens'; count: number };
