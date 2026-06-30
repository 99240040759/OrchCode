import { nanoid } from 'nanoid';
import { mkdirSync } from 'node:fs';
import { buildToolDefs, executeTool, parseToolArgs } from './tools';
import { buildOpenAIMessages, makeClient, extractModelName, countHistory, estimateMessages, summarize, generateTitle } from './context';
import type { AgentRunConfig, HistoryMessage, HistoryPart, DBMessage, DBPart, AgentEvent, WorkerInbound } from '../ipc/types';
import type { ChatCompletionMessageParam, ChatCompletionCreateParamsStreaming, ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { Stream } from 'openai/streaming';
const COMPACT_AT = 0.80;
const KEEP_TAIL = 6;
const parent = (process as any).parentPort;
if (!parent) throw new Error('Must run as UtilityProcess');
// Surface fatal worker errors to main's stderr logger (the utility process has no Sentry of its own).
process.on('uncaughtException', (e) => console.error('[Worker] uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('[Worker] unhandledRejection', e));
const now = () => Date.now();
let abortController: AbortController | null = null;
let running = false;
function emit(e: AgentEvent) { parent.postMessage(e); }
function systemPrompt(cfg: AgentRunConfig): string {
  const ws = cfg.workspacePath, sd = cfg.sessionDir;
  return [
    `You are OrchCode, an autonomous AI coding assistant running on the user's machine with full filesystem and shell access. You can read and write files, run commands, search code and the web, and generate images. Act directly to accomplish the user's goal end to end.`, ``,
    `# Environment`,
    ws ? `- Workspace: ${ws} — the user's project. Do all project work here; relative paths resolve from this root.` : `- No workspace bound (home mode) — use absolute paths or the session directory.`,
    `- Session directory: ${sd} — your own scratch space. Keep your plans, task tracking, notes, and generated artifacts (e.g. images) here, never in the user's project.`,
    `- OS: ${process.platform}. Shell commands run in ${process.platform === 'win32' ? 'PowerShell' : 'the default shell'}.`, ``,
    `# Approach`,
    `- Simple/direct requests: just do them.`,
    `- Complex tasks: research and read relevant files first, write a plan to ${sd}/implementation_plan.md, track progress in ${sd}/task.md, implement, then verify with tests/builds and summarize in ${sd}/walkthrough.md.`,
    `- Match the project's existing style and conventions. Change only what the task needs; don't touch unrelated code. Verify your work before claiming it's done.`, ``,
    `# Tools`,
    `- read_file — read a file; pass start_line/end_line to page through large files.`,
    `- write_file — create or overwrite a file (parent directories are created automatically). Use for new files or full rewrites.`,
    `- edit_file — surgical edits by exact text replacement: each target must match the file verbatim and appear exactly once (include surrounding lines to make it unique). A syntax check flags edits that break parsing. Use write_file for new files or large rewrites.`,
    `- list_dir — list a directory's entries with type and size.`,
    `- run_command — run a shell command (30s timeout, 5MB output cap); defaults to the workspace root.`,
    `- search_workspace — ripgrep regex search across the workspace; supports a glob include filter.`,
    `- search_web — web search returning the top results with titles, URLs, and snippets.`,
    `- generate_image — text-to-image (FLUX); the image is saved to your session directory and shown to the user automatically.`,
    `- read_skill — load a detailed guide before specialized work: pdf, docx, xlsx, pptx, or file-reading.`, ``,
    `# Style`,
    `Be concise and clear. Explain notable decisions briefly, show results, and surface any blockers or follow-ups.`,
  ].join('\n');
}
const textPart = (id: string, msgId: string, convId: string, seq: number, type: 'text' | 'reasoning'): DBPart => ({ id, messageId: msgId, convId, seq, type, text: '', toolCallId: null, toolName: null, toolArgs: null, toolResult: null, toolStatus: null, toolMeta: null, artifactId: null, path: null, createdAt: now(), updatedAt: now() });
const lightMeta = (meta: any) => { if (!meta) return undefined; const { dataUrl, ...rest } = meta; return rest; };
interface RoundUsage { prompt: number; completion: number; }
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
    if (chunk.usage) usage = { prompt: chunk.usage.prompt_tokens || 0, completion: chunk.usage.completion_tokens || 0 };
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
    const text = await summarize(buildOpenAIMessages('', older, cfg.workspacePath).slice(1), cfg.gcpBase, cfg.jwt, cfg.anonKey);
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
  const summary = await summarize(messages.slice(1, cut), cfg.gcpBase, cfg.jwt, cfg.anonKey);
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
  let seqCounter = 0;
  const nextSeq = () => seqCounter++;
  try {
    try { mkdirSync(cfg.sessionDir, { recursive: true }); } catch { /* plan dir optional; file ops will report per-write errors */ }
    const userTurns = req.history.filter(h => h.message.role === 'user');
    if (userTurns.length === 1) {
      const firstText = userTurns[0].parts.map(p => p.text || p.path || '').join(' ').trim();
      generateTitle(firstText, cfg.gcpBase, cfg.jwt, cfg.anonKey).then(t => emit({ type: 'title', title: t })).catch(() => {});
    }
    // Compact BEFORE the assistant message exists so the summary persists with a lower seq than the
    // assistant turn — keeping live and reloaded message ordering identical.
    const history = await maybeCompact(req.history, cfg);
    emit({ type: 'message.start', message: { id: asstId, convId, role: 'assistant', seq: 0, status: 'streaming', error: null, model: cfg.modelId, compacted: 0, createdAt: now(), updatedAt: now() } });
    let messages = buildOpenAIMessages(systemPrompt(cfg), history, cfg.workspacePath);
    let lastPrompt = 0, lifetime = 0, countedPrompt = false;
    while (!aborted) {
      messages = await compactInPlace(messages, cfg);
      const round = await streamOnce(messages, asstId, convId, nextSeq, cfg);
      if (round.usage) {
        lastPrompt = round.usage.prompt;
        if (!countedPrompt) { lifetime += round.usage.prompt; countedPrompt = true; } // initial prompt counted exactly once
        lifetime += round.usage.completion; // each round adds only its new completion, never the re-sent prompt
      } else lifetime += estimateMessages([{ role: 'assistant', content: round.text } as any]); // fallback: completion only
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
          const { result, meta } = await executeTool(tc.name, parsed, cfg.workspacePath, cfg.sessionDir, { gcpBase: cfg.gcpBase, jwt: cfg.jwt, anonKey: cfg.anonKey }, abortController!.signal);
          emit({ type: 'tool.update', messageId: asstId, partId, status: 'done', result, meta: lightMeta(meta) });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          if (meta?.dataUrl) emit({ type: 'part.image', messageId: asstId, partId: nanoid(), seq: nextSeq(), mime: 'image/png', name: (meta.prompt || 'image').slice(0, 40), dataUrl: meta.dataUrl });
        } catch (e: any) {
          // Always finalize the part — never leave a tool row stuck on 'running' (perpetual spinner on reload).
          const msg = e.message || String(e);
          emit({ type: 'tool.update', messageId: asstId, partId, status: 'error', result: aborted ? 'Aborted by user' : `Error: ${msg}` });
          if (aborted) break;
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
