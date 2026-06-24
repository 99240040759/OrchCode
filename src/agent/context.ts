import { getEncoding } from 'js-tiktoken';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { Message } from '../ipc/types';
const enc = getEncoding('cl100k_base');
export const countTokens = (text: string): number => enc.encode(text).length;
export const countMessages = (msgs: Message[]): number => msgs.reduce((sum, m) => sum + countTokens(m.content) + 3, 0);
export const extractModelName = (modelId: string) => modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
export function makeClient(gcpBase: string, jwt: string, anonKey: string, provider?: string) {
  const route = provider === 'z-ai' ? 'z-ai' : 'opencode';
  return new OpenAI({ baseURL: `${gcpBase}/${route}/v1`, apiKey: jwt, defaultHeaders: { apikey: anonKey } });
}
export async function compactHistory(msgs: Message[], gcpBase: string, jwt: string, anonKey: string, provider?: string, modelId?: string): Promise<{ summary: string; kept: Message[] }> {
  const toolMsgIndices: number[] = [];
  for (let i = msgs.length - 1; i >= 0 && toolMsgIndices.length < 10; i--) {
    if (msgs[i].role === 'tool') toolMsgIndices.unshift(i);
  }
  const keepIndices = new Set<number>(toolMsgIndices);
  for (const ti of toolMsgIndices) {
    for (let i = ti - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') { keepIndices.add(i); break; }
    }
  }
  const lastKeptIdx = Math.max(...[...keepIndices]);
  for (let i = lastKeptIdx + 1; i < msgs.length; i++) {
    if (msgs[i].role === 'user') keepIndices.add(i);
  }
  const toSummarize = msgs.filter((_, i) => !keepIndices.has(i));
  const kept = msgs.filter((_, i) => keepIndices.has(i));
  if (toSummarize.length === 0) return { summary: '', kept: msgs };
  const prompt = toSummarize.map(m => `[${m.role}]: ${m.content.slice(0, 600)}`).join('\n\n');
  const client = makeClient(gcpBase, jwt, anonKey, provider);
  const model = extractModelName(modelId || 'deepseek-v4-flash-free');
  const params: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: 'Summarize this conversation history concisely. Preserve all key decisions, file paths, code written, errors encountered, and context needed to continue.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2048,
    stream: false,
  };
  const resp = await client.chat.completions.create(params);
  const text = resp.choices[0]?.message?.content;
  if (!text) throw new Error('Compaction returned empty summary');
  return { summary: text, kept };
}
export async function generateTitle(firstMessage: string, gcpBase: string, jwt: string, anonKey: string, provider?: string, modelId?: string): Promise<string> {
  const client = makeClient(gcpBase, jwt, anonKey, provider);
  const model = extractModelName(modelId || 'deepseek-v4-flash-free');
  const params: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [{ role: 'user', content: `Generate a short 3-5 word title for this conversation. Just the title, no quotes, no punctuation.\n\n${firstMessage.slice(0, 300)}` }],
    max_tokens: 20,
    stream: false,
  };
  const resp = await client.chat.completions.create(params);
  return resp.choices[0]?.message?.content?.trim() || 'New Conversation';
}
/** Convert internal Message[] to OpenAI ChatCompletionMessageParam[] */
export function toOpenAIMessages(systemPrompt: string, history: Message[], toolCallsMap: Map<string, Array<{ id: string; name: string; args: string }>>, reasoningMap?: Map<string, string>): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
  // Build fallback: for each assistant msg, collect tool_call_ids from subsequent tool msgs
  const historyTcMap = new Map<string, Array<{ id: string; name: string; args: string }>>();
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === 'assistant') {
      const tcs: Array<{ id: string; name: string; args: string }> = [];
      for (let j = i + 1; j < history.length && history[j].role === 'tool'; j++) {
        if (history[j].toolCallId) tcs.push({ id: history[j].toolCallId!, name: '', args: '{}' });
      }
      if (tcs.length) historyTcMap.set(m.id, tcs);
    }
  }
  for (const m of history) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId!, content: m.content });
    } else if (m.role === 'assistant') {
      const tcs = toolCallsMap.get(m.id) || historyTcMap.get(m.id);
      if (tcs?.length) {
        out.push({
          role: 'assistant', content: m.content || null,
          ...(reasoningMap?.get(m.id) ? { reasoning_content: reasoningMap.get(m.id) } as any : {}),
          tool_calls: tcs.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.args || '{}' } })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content, ...(reasoningMap?.get(m.id) ? { reasoning_content: reasoningMap.get(m.id) } as any : {}) });
      }
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    }
  }
  return out;
}
