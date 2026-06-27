import { nanoid } from 'nanoid';
import { buildToolDefs, executeTool, parseToolArgs } from './tools';
import { buildOpenAIMessages, makeClient, extractModelName, countHistory, estimateMessages, summarize, generateTitle } from './context';
import type { AgentRunConfig, HistoryMessage, HistoryPart, DBMessage, DBPart, AgentEvent, WorkerInbound } from '../ipc/types';
import type { ChatCompletionMessageParam, ChatCompletionCreateParamsStreaming, ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { Stream } from 'openai/streaming';
const COMPACT_AT = 0.80;
const KEEP_TAIL = 6;
const parent = (process as any).parentPort;
if (!parent) throw new Error('Must run as UtilityProcess');
const now = () => Date.now();
let abortController: AbortController | null = null;
let running = false;
function emit(e: AgentEvent) { parent.postMessage(e); }
function systemPrompt(cfg: AgentRunConfig): string {
  const ws = cfg.workspacePath, sd = cfg.sessionDir;
  return [
    `You are OrchCode, an AI coding assistant with full filesystem and shell access.`, ``,
    `# Environment`,
    ws ? `- Workspace: ${ws}` : `- No workspace bound (home mode)`,
    `- Session directory: ${sd} (for your plans, tasks, notes)`,
    `- OS: ${process.platform}`, ``,
    `# Workflow`,
    `For complex tasks: 1) research/read files 2) write ${sd}/implementation_plan.md 3) execute, track in ${sd}/task.md 4) verify with tests/builds 5) write ${sd}/walkthrough.md.`,
    `For simple tasks: act directly.`, ``,
    `# Tools`,
    `read_file / write_file / edit_file / list_dir / run_command / search_web / search_workspace / generate_image / read_skill.`, ``,
    `# Style`,
    `Be concise. edit_file for surgical changes, write_file for new/full rewrites. Paths relative to workspace root unless absolute.`,
  ].join('\n');
}
const textPart = (id: string, msgId: string, convId: string, seq: number, type: 'text' | 'reasoning'): DBPart => ({ id, messageId: msgId, convId, seq, type, text: '', toolCallId: null, toolName: null, toolArgs: null, toolResult: null, toolStatus: null, toolMeta: null, artifactId: null, path: null, createdAt: now(), updatedAt: now() });
const lightMeta = (meta: any) => { if (!meta) return undefined; const { dataUrl, ...rest } = meta; return rest; };
interface RoundUsage { prompt: number; total: number; }
interface RoundTool { id: string; name: string; args: string; }
async function streamOnce(messages: ChatCompletionMessageParam[], asstId: string, convId: string, nextSeq: () => number, cfg: AgentRunConfig): Promise<{ text: string; reasoning: string; toolCalls: RoundTool[]; usage: RoundUsage | null }> {
  const client = makeClient(cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider);
  const params: ChatCompletionCreateParamsStreaming = {
    model: extractModelName(cfg.modelId), messages, tools: buildToolDefs(), tool_choice: 'auto', stream: true, stream_options: { include_usage: true },
    ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort as any } : {}),
  };
  const stream: Stream<ChatCompletionChunk> = await client.chat.completions.create(params, { signal: abortController!.signal });
  let text = '', reasoning = '', textId: string | null = null, reasonId: string | null = null, usage: RoundUsage | null = null;
  const pending: RoundTool[] = [];
  for await (const chunk of stream) {
    if (chunk.usage) usage = { prompt: chunk.usage.prompt_tokens || 0, total: chunk.usage.total_tokens || 0 };
    const delta = chunk.choices[0]?.delta; if (!delta) continue;
    if (delta.content) {
      if (!textId) { textId = nanoid(); emit({ type: 'part.start', part: textPart(textId, asstId, convId, nextSeq(), 'text') }); }
      text += delta.content; emit({ type: 'part.delta', messageId: asstId, partId: textId, text: delta.content });
    }
    const rc = (delta as any).reasoning_content;
    if (rc) {
      if (!reasonId) { reasonId = nanoid(); emit({ type: 'part.start', part: textPart(reasonId, asstId, convId, nextSeq(), 'reasoning') }); }
      reasoning += rc; emit({ type: 'part.delta', messageId: asstId, partId: reasonId, text: rc });
    }
    if (delta.tool_calls) for (const tc of delta.tool_calls) {
      const idx = tc.index ?? pending.length; // native OpenAI always indexes; fall back to append so a call is never silently dropped
      if (!pending[idx]) pending[idx] = { id: tc.id || nanoid(), name: '', args: '' };
      if (tc.id) pending[idx].id = tc.id;
      if (tc.function?.name) pending[idx].name = tc.function.name;
      if (tc.function?.arguments) pending[idx].args += tc.function.arguments;
    }
  }
  return { text, reasoning, toolCalls: pending.filter(Boolean), usage };
}
// Pre-run compaction: summarize all-but-tail, emit summary message, return trimmed history.
async function maybeCompact(history: HistoryMessage[], cfg: AgentRunConfig): Promise<HistoryMessage[]> {
  if (countHistory(history) <= COMPACT_AT * cfg.contextWindow) return history;
  const live = history.filter(h => !h.message.compacted);
  if (live.length <= KEEP_TAIL + 1) return history;
  const older = live.slice(0, live.length - KEEP_TAIL);
  const kept = live.slice(live.length - KEEP_TAIL);
  try {
    const text = await summarize(buildOpenAIMessages('', older, cfg.workspacePath).slice(1), cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider, cfg.modelId);
    if (!text) return history;
    const sid = nanoid(), pid = nanoid();
    const summaryMessage: DBMessage = { id: sid, convId: cfg.convId, role: 'system', seq: 0, status: 'complete', error: null, model: cfg.modelId, compacted: 0, createdAt: now(), updatedAt: now() };
    const summaryPart: DBPart = { ...textPart(pid, sid, cfg.convId, 0, 'text'), text };
    emit({ type: 'compacted', summaryMessage, summaryPart, compactedIds: older.map(h => h.message.id) });
    return [{ message: summaryMessage, parts: [summaryPart as HistoryPart] }, ...kept];
  } catch { return history; }
}
// Mid-loop compaction: when the live message array nears the window, summarize the middle and keep system + recent tail.
async function compactInPlace(messages: ChatCompletionMessageParam[], cfg: AgentRunConfig): Promise<ChatCompletionMessageParam[]> {
  if (estimateMessages(messages) <= COMPACT_AT * cfg.contextWindow) return messages;
  if (messages.length <= KEEP_TAIL + 2) return messages;
  let cut = messages.length - KEEP_TAIL;
  while (cut > 1 && messages[cut].role === 'tool') cut--; // never orphan tool replies from their assistant tool_calls
  if (cut <= 1) return messages;
  const summary = await summarize(messages.slice(1, cut), cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider, cfg.modelId);
  if (!summary) return messages;
  return [messages[0], { role: 'system', content: `[Earlier context summary]\n${summary}` }, ...messages.slice(cut)];
}
async function run(req: { config: AgentRunConfig; history: HistoryMessage[] }) {
  if (running) return;
  running = true;
  const cfg = req.config, convId = cfg.convId;
  abortController = new AbortController();
  let aborted = false;
  abortController.signal.addEventListener('abort', () => { aborted = true; });
  const asstId = nanoid();
  emit({ type: 'message.start', message: { id: asstId, convId, role: 'assistant', seq: 0, status: 'streaming', error: null, model: cfg.modelId, compacted: 0, createdAt: now(), updatedAt: now() } });
  let seqCounter = 0;
  const nextSeq = () => seqCounter++;
  try {
    const userTurns = req.history.filter(h => h.message.role === 'user');
    if (userTurns.length === 1) {
      const firstText = userTurns[0].parts.map(p => p.text || p.path || '').join(' ').trim();
      generateTitle(firstText, cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider, cfg.modelId).then(t => emit({ type: 'title', title: t })).catch(() => {});
    }
    const history = await maybeCompact(req.history, cfg);
    let messages = buildOpenAIMessages(systemPrompt(cfg), history, cfg.workspacePath);
    let lastPrompt = 0, lifetime = 0;
    while (!aborted) {
      messages = await compactInPlace(messages, cfg);
      const round = await streamOnce(messages, asstId, convId, nextSeq, cfg);
      if (round.usage) { lastPrompt = round.usage.prompt; lifetime += round.usage.total; }
      else lifetime += estimateMessages([{ role: 'assistant', content: round.text } as any]); // fallback: count completion only, never re-add prompt
      const apiAsst: any = { role: 'assistant', content: round.text || null };
      if (round.reasoning) apiAsst.reasoning_content = round.reasoning;
      if (round.toolCalls.length) apiAsst.tool_calls = round.toolCalls.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args || '{}' } }));
      messages.push(apiAsst);
      if (!round.toolCalls.length) break;
      for (const tc of round.toolCalls) {
        if (aborted) break;
        const partId = nanoid();
        emit({ type: 'part.start', part: { id: partId, messageId: asstId, convId, seq: nextSeq(), type: 'tool', text: null, toolCallId: tc.id, toolName: tc.name, toolArgs: tc.args || '{}', toolResult: null, toolStatus: 'running', toolMeta: null, artifactId: null, path: null, createdAt: now(), updatedAt: now() } });
        try {
          const parsed = parseToolArgs(tc.name, tc.args || '{}');
          const { result, meta } = await executeTool(tc.name, parsed, cfg.workspacePath, { gcpBase: cfg.gcpBase, jwt: cfg.jwt, anonKey: cfg.anonKey }, abortController!.signal);
          emit({ type: 'tool.update', messageId: asstId, partId, status: 'done', result, meta: lightMeta(meta) });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          if (meta?.dataUrl) emit({ type: 'part.image', messageId: asstId, partId: nanoid(), seq: nextSeq(), mime: 'image/png', name: (meta.prompt || 'image').slice(0, 40), dataUrl: meta.dataUrl });
        } catch (e: any) {
          if (aborted) break;
          const msg = e.message || String(e);
          emit({ type: 'tool.update', messageId: asstId, partId, status: 'error', result: `Error: ${msg}` });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${msg}` });
        }
      }
    }
    emit({ type: 'message.end', messageId: asstId, status: aborted ? 'aborted' : 'complete' });
    emit({ type: 'tokens', context: lastPrompt || estimateMessages(messages), lifetime });
  } catch (e: any) {
    emit({ type: 'message.end', messageId: asstId, status: aborted ? 'aborted' : 'error', error: aborted ? undefined : (e.message || String(e)) });
  } finally { running = false; abortController = null; }
}
parent.on('message', (e: any) => {
  const msg = e.data as WorkerInbound;
  if (msg.type === 'run') run(msg).catch(err => emit({ type: 'message.end', messageId: 'unknown', status: 'error', error: String(err) }));
  else if (msg.type === 'abort') abortController?.abort();
});
parent.start();
parent.postMessage({ type: 'ready' });
console.log('[Worker] ready');
