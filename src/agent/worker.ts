import { nanoid } from 'nanoid';
import { buildToolDefs, executeTool, parseToolArgs } from './tools';
import { countMessages, compactHistory, generateTitle, makeClient, extractModelName, toOpenAIMessages } from './context';
import type { Message, ToolCall, AgentChunk, AgentInitConfig } from '../ipc/types';
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type { Stream } from 'openai/streaming';
const MAX_TOOL_ITERATIONS = 40;
const COMPACT_AT = 0.80;
const parent = (process as any).parentPort;
if (!parent) throw new Error('Must run as UtilityProcess');
console.log('[Worker] Process loaded');
let cfg: AgentInitConfig | null = null;
let history: Message[] = [];
let isRunning = false;
let abortController: AbortController | null = null;
const assistantToolCalls = new Map<string, Array<{ id: string; name: string; args: string }>>();
function getClient() {
  if (!cfg) throw new Error('Worker not initialized');
  return makeClient(cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider);
}
function send(chunk: AgentChunk) { parent.postMessage(chunk); }
function buildSystemPrompt(): string {
  const ws = cfg!.workspacePath;
  const sd = cfg!.sessionDir;
  return [
    `You are OrchCode, an AI coding assistant with full filesystem and shell access.`,
    ``,
    `# Environment`,
    ws ? `- Workspace: ${ws}` : `- No workspace bound (home mode)`,
    `- Session directory: ${sd} (for your plans, tasks, notes)`,
    `- OS: ${process.platform}`,
    ``,
    `# Workflow`,
    `For complex tasks (multi-file changes, new features, refactors):`,
    `1. Research: read relevant files, understand the codebase`,
    `2. Plan: write ${sd}/implementation_plan.md with your approach`,
    `3. Execute: make changes, track progress in ${sd}/task.md`,
    `4. Verify: run tests/builds to confirm correctness`,
    `5. Summarize: write ${sd}/walkthrough.md with what changed`,
    ``,
    `For simple tasks (quick fixes, questions, small edits): act directly.`,
    ``,
    `# Tools`,
    `- read_file / write_file / edit_file: file operations`,
    `- list_dir: explore directory structure`,
    `- run_command: shell commands (installs, builds, git, tests)`,
    `- search_web: search the internet`,
    `- search_workspace: ripgrep search across workspace files`,
    `- generate_image: create images from text prompts`,
    `- read_skill: load guides for specialized tasks (pdf, docx, xlsx, pptx, file-reading)`,
    ``,
    `# Style`,
    `- Be concise. Use edit_file for surgical changes, write_file for new/full rewrites.`,
    `- Paths are relative to workspace root unless absolute.`,
  ].join('\n');
}
async function tryCompact(): Promise<boolean> {
  if (!cfg) return false;
  const tokens = countMessages(history);
  if (tokens <= COMPACT_AT * cfg.contextWindow) return false;
  console.log(`[Agent] Compacting at ${tokens}/${cfg.contextWindow} tokens (${Math.round(tokens / cfg.contextWindow * 100)}%)`);
  const { summary, kept } = await compactHistory(history, cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider, cfg.modelId);
  if (!summary) return false;
  const summaryMsg: Message = { id: nanoid(), convId: cfg.convId, role: 'system', content: summary, tokenCount: 0, createdAt: Date.now() };
  // Clear stale assistantToolCalls entries for messages being compacted
  const keptIds = new Set(kept.map(m => m.id));
  for (const [msgId] of assistantToolCalls) { if (!keptIds.has(msgId)) assistantToolCalls.delete(msgId); }
  history = [summaryMsg, ...kept];
  send({ type: 'summary', summaryMsg });
  parent.postMessage({ type: 'db:write', message: summaryMsg });
  return true;
}
async function runAgent(userContent: string) {
  if (isRunning || !cfg) return;
  isRunning = true;
  try {
    // Add user message to in-memory history (DB write happens in renderer)
    const userMsg: Message = { id: nanoid(), convId: cfg.convId, role: 'user', content: userContent, tokenCount: 0, createdAt: Date.now() };
    history.push(userMsg);
    console.log(`[Agent:${cfg.convId.slice(0, 6)}] Starting: "${userContent.slice(0, 60)}"`);
    if (history.filter(m => m.role === 'user').length <= 1) {
      generateTitle(userContent, cfg.gcpBase, cfg.jwt, cfg.anonKey, cfg.provider, cfg.modelId)
        .then(title => parent.postMessage({ type: 'db:title', title }))
        .catch(e => console.error('[Agent] Title gen failed:', e.message));
    }
    // Pre-flight compaction
    await tryCompact();
    let iteration = 0;
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      const pendingToolCalls = await streamCompletion();
      if (!pendingToolCalls.length) break;
      console.log(`[Agent] Iter ${iteration}: ${pendingToolCalls.length} tools`);
      for (const ptc of pendingToolCalls) {
        const tcRecord: ToolCall = { id: ptc.id, msgId: ptc.msgId, convId: cfg.convId, name: ptc.name, input: ptc.args, createdAt: Date.now() };
        send({ type: 'tool_call', toolCall: tcRecord });
        parent.postMessage({ type: 'db:toolcall', toolCall: tcRecord });
        try {
          const parsedArgs = parseToolArgs(ptc.name, ptc.args);
          const { result, meta } = await executeTool(ptc.name, parsedArgs, cfg.workspacePath, { gcpBase: cfg.gcpBase, jwt: cfg.jwt, anonKey: cfg.anonKey });
          send({ type: 'tool_result', toolCallId: ptc.id, result, meta });
          parent.postMessage({ type: 'db:toolcall', toolCall: { ...tcRecord, output: result, ...meta } });
          const r: Message = { id: nanoid(), convId: cfg.convId, role: 'tool', content: result, toolCallId: ptc.id, tokenCount: 0, createdAt: Date.now() };
          history.push(r); parent.postMessage({ type: 'db:write', message: r });
        } catch (toolErr: any) {
          const errMsg = toolErr.message || String(toolErr);
          console.error(`[Agent] Tool ${ptc.name} failed:`, errMsg);
          send({ type: 'tool_result', toolCallId: ptc.id, result: `Error: ${errMsg}` });
          parent.postMessage({ type: 'db:toolcall', toolCall: { ...tcRecord, output: `Error: ${errMsg}` } });
          const r: Message = { id: nanoid(), convId: cfg.convId, role: 'tool', content: `Error: ${errMsg}`, toolCallId: ptc.id, tokenCount: 0, createdAt: Date.now() };
          history.push(r); parent.postMessage({ type: 'db:write', message: r });
        }
      }
      // In-flight compaction between tool iterations
      await tryCompact();
    }
    if (iteration >= MAX_TOOL_ITERATIONS) console.warn(`[Agent] Hit max iterations (${MAX_TOOL_ITERATIONS})`);
    send({ type: 'done' });
    parent.postMessage({ type: 'db:tokens', count: countMessages(history) });
  } catch (err: any) {
    console.error('[Agent] Run error:', err.message);
    send({ type: 'error', error: err.message || String(err) });
  } finally { isRunning = false; abortController = null; }
}
async function streamCompletion(): Promise<Array<{ id: string; name: string; args: string; msgId: string }>> {
  if (!cfg) return [];
  const oaiMessages = toOpenAIMessages(buildSystemPrompt(), history, assistantToolCalls);
  abortController = new AbortController();
  const pendingToolCalls: Array<{ id: string; name: string; args: string; msgId: string }> = [];
  let assistantContent = '';
  const assistantMsgId = nanoid();
  send({ type: 'iter_start', messageId: assistantMsgId });
  const client = getClient();
  const modelName = extractModelName(cfg.modelId);
  const params: ChatCompletionCreateParamsStreaming = {
    model: modelName, messages: oaiMessages, tools: buildToolDefs(),
    tool_choice: 'auto', stream: true, max_tokens: 8192,
    ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort as any } : {}),
  };
  // Write assistant message placeholder immediately for crash resilience
  const assistantMsg: Message = { id: assistantMsgId, convId: cfg.convId, role: 'assistant', content: '', tokenCount: 0, createdAt: Date.now() };
  parent.postMessage({ type: 'db:write', message: assistantMsg });
  const stream: Stream<ChatCompletionChunk> = await client.chat.completions.create(params, { signal: abortController.signal });
  const tokenCount = countMessages(history);
  let lastFlush = Date.now();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      assistantContent += delta.content;
      send({ type: 'chunk', delta: delta.content, tokenCount, contextWindow: cfg.contextWindow, messageId: assistantMsgId });
      // Periodic DB flush every 2s during streaming
      if (Date.now() - lastFlush > 2000) {
        parent.postMessage({ type: 'db:write', message: { ...assistantMsg, content: assistantContent } });
        lastFlush = Date.now();
      }
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.index !== undefined) {
          if (!pendingToolCalls[tc.index]) pendingToolCalls[tc.index] = { id: tc.id || nanoid(), name: tc.function?.name || '', args: '', msgId: assistantMsgId };
          if (tc.function?.name) pendingToolCalls[tc.index].name = tc.function.name;
          if (tc.function?.arguments) pendingToolCalls[tc.index].args += tc.function.arguments;
        }
      }
    }
  }
  const resolvedTCs = pendingToolCalls.filter(Boolean);
  if (resolvedTCs.length) {
    assistantToolCalls.set(assistantMsgId, resolvedTCs.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })));
  }
  // Final DB write with complete content
  assistantMsg.content = assistantContent;
  history.push(assistantMsg);
  parent.postMessage({ type: 'db:write', message: assistantMsg });
  return resolvedTCs;
}
parent.on('message', async (e: any) => {
  const msg = e.data;
  console.log('[Worker] Received message type:', msg?.type);
  if (msg.type === 'init') {
    cfg = msg as AgentInitConfig & { type: string };
    history = (msg as AgentInitConfig).history || [];
    console.log(`[Agent:${cfg.convId.slice(0, 6)}] Init. Model: ${cfg.modelId} ctx: ${cfg.contextWindow}`);
  } else if (msg.type === 'send' && !isRunning) {
    await runAgent(msg.content).catch(err => { console.error('[Agent] Fatal:', err); send({ type: 'error', error: String(err) }); isRunning = false; });
  } else if (msg.type === 'kill') {
    abortController?.abort();
    send({ type: 'done' });
    isRunning = false;
  }
});
parent.start();
console.log('[Worker] parentPort started, ready for messages');
