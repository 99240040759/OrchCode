import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getEncoding } from 'js-tiktoken';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { HistoryMessage, HistoryPart } from '../ipc/types';
import { secureResolve } from '../lib/securePath';
const enc = getEncoding('cl100k_base');
export const countText = (t: string): number => enc.encode(t || '').length;
export const extractModelName = (modelId: string) => modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
export function makeClient(gcpBase: string, jwt: string, anonKey: string, provider?: string) {
  const route = provider === 'z-ai' ? 'z-ai' : 'opencode';
  return new OpenAI({ baseURL: `${gcpBase}/${route}/v1`, apiKey: jwt, defaultHeaders: { apikey: anonKey } });
}
// Tokens for a whole history (approx) — used for compaction decisions. Compacted messages are excluded (they aren't sent).
export function countHistory(history: HistoryMessage[]): number {
  let n = 0;
  for (const { message, parts } of history) { if (message.compacted) continue; for (const p of parts) n += countText(p.text || p.toolResult || p.toolArgs || '') + 4; }
  return n;
}
// Approx token size of a built OpenAI message array — used for mid-loop compaction decisions.
export function estimateMessages(messages: ChatCompletionMessageParam[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') n += countText(m.content);
    else if (Array.isArray(m.content)) for (const c of m.content as any[]) if (c.type === 'text') n += countText(c.text);
    const tc = (m as any).tool_calls; if (tc) for (const t of tc) n += countText(t.function?.arguments || '');
    const rc = (m as any).reasoning_content; if (rc) n += countText(rc);
    n += 4;
  }
  return n;
}
const MENTION_MAX = 24_000;
function readMention(workspacePath: string | null, rel: string): string {
  try {
    const fp = workspacePath ? secureResolve(workspacePath, rel) : (path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel));
    const raw = readFileSync(fp, 'utf8');
    return raw.length > MENTION_MAX ? raw.slice(0, MENTION_MAX) + '\n…[truncated]' : raw;
  } catch (e: any) { return `[mention ${rel}: ${e.message}]`; }
}
// Serialize a user message's parts into OpenAI content (multimodal when images present)
function userContent(parts: HistoryPart[], workspacePath: string | null): string | any[] {
  const text: string[] = [];
  const images: any[] = [];
  for (const p of parts) {
    if (p.type === 'text') text.push(p.text || '');
    else if (p.type === 'mention') text.push(`@${p.path}\n<file path="${p.path}">\n${readMention(workspacePath, p.path!)}\n</file>`);
    else if (p.type === 'file') text.push(`<file name="${p.path || 'file'}">\n${p.text || ''}\n</file>`);
    else if (p.type === 'image' && p.dataUrl) images.push({ type: 'image_url', image_url: { url: p.dataUrl } });
  }
  const joined = text.join('\n').trim();
  if (!images.length) return joined;
  return [...(joined ? [{ type: 'text', text: joined }] : []), ...images];
}
// Split an assistant message's ordered parts into valid OpenAI message rounds.
function assistantRounds(parts: HistoryPart[], out: ChatCompletionMessageParam[]) {
  let text: string[] = [], reasoning: string[] = [], tools: HistoryPart[] = [];
  const flush = () => {
    if (!text.length && !tools.length) return;
    const msg: any = { role: 'assistant', content: text.join('') || null };
    if (reasoning.length) msg.reasoning_content = reasoning.join('');
    if (tools.length) msg.tool_calls = tools.map(t => ({ id: t.toolCallId!, type: 'function', function: { name: t.toolName || 'unknown', arguments: t.toolArgs || '{}' } }));
    out.push(msg);
    for (const t of tools) out.push({ role: 'tool', tool_call_id: t.toolCallId!, content: t.toolResult ?? '[interrupted]' });
    text = []; reasoning = []; tools = [];
  };
  for (const p of parts) {
    if (p.type === 'tool') tools.push(p);
    else if (p.type === 'reasoning') { if (tools.length) flush(); reasoning.push(p.text || ''); }
    else if (p.type === 'text') { if (tools.length) flush(); text.push(p.text || ''); }
    // image parts on assistant are display-only; the model already got the tool result
  }
  flush();
}
export function buildOpenAIMessages(systemPrompt: string, history: HistoryMessage[], workspacePath: string | null): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
  const live = history.filter(h => !h.message.compacted);
  // Compaction summaries (system role) always lead, regardless of seq, so prior context precedes the live tail.
  for (const { message, parts } of live) if (message.role === 'system') { const t = parts.map(p => p.text || '').join('\n'); if (t) out.push({ role: 'system', content: t }); }
  for (const { message, parts } of live) {
    if (message.role === 'user') { const c = userContent(parts, workspacePath); if ((typeof c === 'string' && c) || (Array.isArray(c) && c.length)) out.push({ role: 'user', content: c as any }); }
    else if (message.role === 'assistant') assistantRounds(parts, out);
  }
  return out;
}
export async function generateTitle(firstMessage: string, gcpBase: string, jwt: string, anonKey: string, provider: string, modelId: string): Promise<string> {
  const client = makeClient(gcpBase, jwt, anonKey, provider);
  const params: ChatCompletionCreateParamsNonStreaming = {
    model: extractModelName(modelId),
    messages: [{ role: 'user', content: `Generate a short 3-5 word title for this conversation. Just the title, no quotes, no punctuation.\n\n${firstMessage.slice(0, 300)}` }],
    max_tokens: 20, stream: false,
  };
  const resp = await client.chat.completions.create(params);
  return resp.choices[0]?.message?.content?.trim() || 'New Conversation';
}
// Summarize the OpenAI-shaped messages (everything except the trailing window) into one string.
export async function summarize(messages: ChatCompletionMessageParam[], gcpBase: string, jwt: string, anonKey: string, provider: string, modelId: string): Promise<string> {
  const text = messages.map(m => `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 600) : '[multimodal]'}`).join('\n\n');
  try {
    const res = await fetch(`${gcpBase}/generate-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey, 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return '';
    const data = await res.json() as any;
    return data.summary || '';
  } catch { return ''; }
}
