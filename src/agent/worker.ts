import { nanoid } from 'nanoid';
import { buildToolDefs, executeTool, parseToolArgs } from './tools';
import { buildOpenAIMessages, makeClient, extractModelName, countText, countHistory, summarize, generateTitle } from './context';
import type { AgentRunConfig, HistoryMessage, HistoryPart, DBMessage, DBPart, AgentEvent, WorkerInbound } from '../ipc/types';
import type { ChatCompletionMessageParam, ChatCompletionCreateParamsStreaming, ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { Stream } from 'openai/streaming';
const MAX_TOOL_ITERATIONS = 40;
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
function countMessages(msgs: ChatCompletionMessageParam[]): number {
  let n = 0;
  for (const m of msgs) { if (typeof m.content === 'string') n += countText(m.content) + 4; if ((m as any).tool_calls) for (const t of (m as any).tool_calls) n += countText(t.function?.arguments || '') + 4; }
  return n;
}
interface RoundTool { id: string; name: string; args: string; }
async function streamOnce(messages: ChatCompletionMessageParam[], asstId: string, convId: string, nextSeq: () => number, cfg: AgentRunConfig): Promise<{ text: string; reasoning: string; toolCalls: RoundTool[] }> {
  const client = makeClient(cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider);
  const params: ChatCompletionCreateParamsStreaming = {
    model: extractModelName(cfg.modelId), messages, tools: buildToolDefs(), tool_choice: 'auto', stream: true, max_tokens: 8192,
    ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort as any } : {}),
  };
  const stream: Stream<ChatCompletionChunk> = await client.chat.completions.create(params, { signal: abortController!.signal });
  let text = '', reasoning = '', textId: string | null = null, reasonId: string | null = null;
  const pending: RoundTool[] = [];
  for await (const chunk of stream) {
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
      if (tc.index === undefined) continue;
      if (!pending[tc.index]) pending[tc.index] = { id: tc.id || nanoid(), name: tc.function?.name || '', args: '' };
      if (tc.function?.name) pending[tc.index].name = tc.function.name;
      if (tc.function?.arguments) pending[tc.index].args += tc.function.arguments;
    }
  }
  return { text, reasoning, toolCalls: pending.filter(Boolean) };
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
    const messages = buildOpenAIMessages(systemPrompt(cfg), history, cfg.workspacePath);
    let iteration = 0;
    while (iteration < MAX_TOOL_ITERATIONS && !aborted) {
      iteration++;
      const round = await streamOnce(messages, asstId, convId, nextSeq, cfg);
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
          const { result, meta } = await executeTool(tc.name, parsed, cfg.workspacePath, { gcpBase: cfg.gcpBase, jwt: cfg.jwt, anonKey: cfg.anonKey });
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
    emit({ type: 'tokens', count: countMessages(messages) });
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
