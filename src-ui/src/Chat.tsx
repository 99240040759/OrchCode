import { createSignal, createMemo, onCleanup, For, Show, createEffect, createResource, batch, untrack } from 'solid-js';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import type { StreamChunk } from './api';
import { threadMessages, agentStream, agentStop, stateDeleteThread, stateCreateThread, stateSwitchThread, stateGenerateTitle } from './api';
import { activeThreadId, threads, isStreaming, setIsStreaming, models, selectedModel, setSelectedModel, workspacePath, activeThread, setAppState, appState } from './store';
import InputBar from './components/InputBar';
import Dropdown from './components/Dropdown';
import Dialog from './components/Dialog';
import Spinner from './components/Spinner';
import ToolActivity, { type LiveTool } from './components/ToolActivity';
import { VsAdd, VsChevronDown } from 'solid-icons/vs';
import { BiRegularTrash } from 'solid-icons/bi';
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const hl = lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang }).value : hljs.highlightAuto(text).value;
  return `<pre><code class="hljs language-${lang ?? ''}">${hl}</code></pre>`;
};
renderer.hr = () => '';
renderer.table = (token: any) => {
  try { return `<div class="md-table-wrap">${marked.Renderer.prototype.table.call(renderer, token)}</div>`; }
  catch { return '<div class="md-table-wrap"><table><tbody></tbody></table></div>'; }
};
marked.use({ renderer, gfm: true });
function escapeHtml(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function safeMarkdown(raw: string) {
  try {
    const html = marked.parse(raw) as string;
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['pre','code','table','thead','tbody','tr','th','td','div','span'],
      ADD_ATTR: ['class','align'],
    });
  } catch { return `<p>${escapeHtml(raw)}</p>`; }
}
const base = (p: string) => p?.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
function toolLabel(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, any>;
  switch (name) {
    case 'list_dir': return `Listing ${base(a.directory_path) || 'directory'}`;
    case 'view_file': {
      const f = base(a.absolute_path) || 'file';
      return `Reading ${f}:${a.start_line||1}-${a.end_line||'800'}`;
    }
    case 'write_to_file': return `Writing ${base(a.target_file) || 'file'}`;
    case 'multi_replace_file_content': return `Editing ${base(a.target_file) || 'file'}`;
    case 'search_workspace': return `Searching${a.query ? ` for "${a.query}"` : ''}`;
    case 'run_command': return `Running: ${(a.command_line ?? '').slice(0, 45)}`;
    case 'search_web': return `Searching web${a.query ? ` for "${a.query}"` : ''}`;
    case 'generate_image': return 'Generating image';
    default: return name.replace(/_/g, ' ');
  }
}
type ToolKind = 'read' | 'edit' | 'run' | 'search' | 'generate' | 'other';
function toolKind(name: string): ToolKind {
  switch (name) {
    case 'view_file': case 'list_dir': return 'read';
    case 'write_to_file': case 'multi_replace_file_content': return 'edit';
    case 'run_command': return 'run';
    case 'search_workspace': case 'search_web': return 'search';
    case 'generate_image': return 'generate';
    default: return 'other';
  }
}
function summarizeTools(tools: LiveTool[]): string {
  const c: Partial<Record<ToolKind, number>> = {};
  for (const t of tools) { const k = toolKind(t.name); c[k] = (c[k] ?? 0) + 1; }
  const p: string[] = [];
  if (c.read) p.push(`Read ${c.read} ${c.read === 1 ? 'file' : 'files'}`);
  if (c.edit) p.push(`Edited ${c.edit} ${c.edit === 1 ? 'file' : 'files'}`);
  if (c.run) p.push(`Ran ${c.run} ${c.run === 1 ? 'command' : 'commands'}`);
  if (c.search) p.push(`Searched ${c.search} ${c.search === 1 ? 'time' : 'times'}`);
  if (c.generate) p.push(`Generated ${c.generate} ${c.generate === 1 ? 'image' : 'images'}`);
  if (c.other) p.push(`Used ${c.other} ${c.other === 1 ? 'tool' : 'tools'}`);
  return p.join(' · ');
}
type MsgItem = { id: string; role: 'user' | 'assistant' | 'tool_activity'; content: string; created_at: string };
type CompletedEntry = { id: string; kind: 'text'; content: string } | { id: string; kind: 'tools'; tools: LiveTool[] };
export default function Chat() {
  let messagesEl!: HTMLDivElement;
  const [messages, { mutate: mutateMessages }] = createResource(activeThreadId, async (tid) => {
    if (!tid) return [] as MsgItem[];
    const raw = await threadMessages(tid);
    const items: MsgItem[] = [];
    for (const m of raw) {
      if (m.role === 'assistant' && m.data) {
        try {
          const parsed = JSON.parse(m.data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            if (parsed[0]?.type === 'text' || parsed[0]?.type === 'tools') {
              for (const seg of parsed) {
                if (seg.type === 'text' && seg.content)
                  items.push({ id: crypto.randomUUID(), role: 'assistant', content: seg.content, created_at: m.created_at });
                else if (seg.type === 'tools' && Array.isArray(seg.tools))
                  items.push({ id: crypto.randomUUID(), role: 'tool_activity', content: JSON.stringify(seg.tools), created_at: m.created_at });
              }
            } else {
              items.push({ id: m.id, role: 'assistant', content: m.content, created_at: m.created_at });
              items.push({ id: m.id + ':tools', role: 'tool_activity', content: m.data, created_at: m.created_at });
            }
            continue;
          }
        } catch {}
      }
      items.push({ id: m.id, role: m.role as any, content: m.content, created_at: m.created_at });
    }
    return items;
  });
  const [completedGroups, setCompletedGroups] = createSignal<CompletedEntry[]>([]);
  const [liveText, setLiveText] = createSignal('');
  const [pendingTools, setPendingTools] = createSignal<LiveTool[]>([]);
  const [doneToolsInGroup, setDoneToolsInGroup] = createSignal<LiveTool[]>([]);
  const [deleteTarget, setDeleteTarget] = createSignal<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [renderedLiveHtml, setRenderedLiveHtml] = createSignal('');
  const [streamTokens, setStreamTokens] = createSignal<{ input: number; output: number }>({ input: 0, output: 0 });
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let titleGenThread: string | null = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      const raw = liveText();
      if (!raw) { setRenderedLiveHtml(''); return; }
      setRenderedLiveHtml(safeMarkdown(raw));
    }, 60);
  }
  function scrollBottom() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = null; requestAnimationFrame(() => { if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight; }); }, 50);
  }
  function scrollNow() { requestAnimationFrame(() => requestAnimationFrame(() => { if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight; })); }
  function resetStream() {
    setCompletedGroups([]); setLiveText(''); setRenderedLiveHtml('');
    setPendingTools([]); setDoneToolsInGroup([]);
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  }
  onCleanup(() => { if (renderTimer) clearTimeout(renderTimer); if (scrollTimer) clearTimeout(scrollTimer); });
  // Restore tokens when thread changes
  createEffect(() => {
    const tid = activeThreadId();
    untrack(() => {
      resetStream();
      const pair = tid ? appState.threadTokens[tid] : null;
      setStreamTokens(pair ? { input: pair[0], output: pair[1] } : { input: 0, output: 0 });
    });
  });
  // Scroll when resource resolves
  createEffect(() => { if (messages() !== undefined) scrollNow(); });
  async function send(text: string) {
    if (!text || isStreaming()) return;
    const tid = activeThreadId();
    if (!tid) return;
    // Capture workspace at send time — stable for this stream's lifetime
    const streamTid = tid;
    const streamWs = workspacePath() ?? undefined; // derived from appState — guaranteed in sync
    batch(() => { setIsStreaming(true); resetStream(); mutateMessages(prev => prev ?? []); });
    mutateMessages(m => [...(m ?? []), { id: 'tmp', role: 'user', content: text, created_at: new Date().toISOString() }]);
    scrollNow();
    const modelId = selectedModel();
    const model = models().find(m => m.id === modelId);
    let committed = false;
    function commitStream(errored = false) {
      if (committed) return; // Guard: error+finish both call this — only commit once
      committed = true;
      if (activeThreadId() !== streamTid) { batch(() => { resetStream(); setIsStreaming(false); }); return; }
      const capturedLive = liveText();
      const capturedDone = doneToolsInGroup();
      const capturedPending = pendingTools().map(t => ({ ...t, status: (errored ? 'error' : 'success') as 'error' | 'success' }));
      const capturedGroups = completedGroups();
      const allTools = [...capturedDone, ...capturedPending];
      const now = new Date().toISOString();
      const turnItems: MsgItem[] = [];
      for (const g of capturedGroups) {
        if (g.kind === 'text') turnItems.push({ id: g.id, role: 'assistant', content: g.content, created_at: now });
        else turnItems.push({ id: g.id, role: 'tool_activity', content: JSON.stringify(g.tools), created_at: now });
      }
      if (allTools.length > 0) turnItems.push({ id: crypto.randomUUID(), role: 'tool_activity', content: JSON.stringify(allTools), created_at: now });
      if (capturedLive) turnItems.push({ id: crypto.randomUUID(), role: 'assistant', content: capturedLive, created_at: now });
      batch(() => {
        mutateMessages(m => {
          const prev = (m ?? []).filter(x => x.id !== 'tmp');
          return [...prev, { id: crypto.randomUUID(), role: 'user' as const, content: text, created_at: now }, ...turnItems];
        });
        resetStream();
        setIsStreaming(false);
      });
      if ((messages() ?? []).filter(m => m.role === 'user').length <= 1) {
        titleGenThread = streamTid;
        stateGenerateTitle(text, streamTid).catch(() => {});
      }
      scrollNow();
    }
    try {
      await agentStream(
        { thread_id: streamTid, model_id: modelId, prompt_text: text, context_window: model?.contextWindow, workspace_path: streamWs },
        (chunk: StreamChunk) => {
          if (chunk.type === 'text_delta') {
            const done = doneToolsInGroup();
            if (done.length > 0) { setCompletedGroups(g => [...g, { id: crypto.randomUUID(), kind: 'tools', tools: done }]); setDoneToolsInGroup([]); }
            setLiveText(t => t + chunk.content);
            scheduleRender();
            scrollBottom();
          } else if (chunk.type === 'tool_call') {
            const cur = liveText();
            if (cur) { setCompletedGroups(g => [...g, { id: crypto.randomUUID(), kind: 'text', content: cur }]); setLiveText(''); setRenderedLiveHtml(''); }
            setPendingTools(tools => [...tools, { id: chunk.tool_call_id, name: chunk.tool_name, args: chunk.args, status: 'pending' }]);
            scrollBottom();
          } else if (chunk.type === 'tool_result') {
            const hit = pendingTools().find(t => t.id === chunk.tool_call_id);
            if (hit) { setPendingTools(t => t.filter(x => x.id !== chunk.tool_call_id)); setDoneToolsInGroup(d => [...d, { ...hit, status: chunk.status as any }]); }
          } else if (chunk.type === 'token_update') {
            setStreamTokens({ input: chunk.input_tokens, output: chunk.output_tokens });
          } else if (chunk.type === 'finish') {
            const raw = liveText(); if (raw) setRenderedLiveHtml(safeMarkdown(raw));
            commitStream(false);
          } else if (chunk.type === 'error') {
            console.error('[stream] ERROR', chunk);
            const raw = liveText(); if (raw) setRenderedLiveHtml(safeMarkdown(raw));
            commitStream(true);
          }
        }
      );
    } catch (e) { console.error('[stream] CATCH', e); commitStream(true); }
  }
  async function switchThread(tid: string) {
    const snap = await stateSwitchThread(tid);
    setAppState(snap);
  }
  async function newThread() {
    resetStream();
    const snap = await stateCreateThread();
    setAppState(snap);
    mutateMessages([]);
  }
  async function confirmDeleteThread() {
    const t = deleteTarget();
    if (!t) return;
    setIsDeleting(true);
    const snap = await stateDeleteThread(t.id);
    setAppState(snap);
    batch(() => { resetStream(); mutateMessages([]); setDeleteTarget(null); setIsDeleting(false); });
  }
  function handleStop() { const tid = activeThreadId(); if (tid) agentStop(tid).catch(() => {}); }
  function parseMsgTools(content: string): LiveTool[] | null { try { const t = JSON.parse(content); return Array.isArray(t) ? t : null; } catch { return null; } }
  function renderMsg(msg: MsgItem) {
    if (msg.role === 'tool_activity') { const tools = parseMsgTools(msg.content); if (tools) return <ToolActivity tools={tools}/>; return <div class="ta-summary">{msg.content}</div>; }
    if (msg.role === 'user') return <div class="msg msg-user"><div class="msg-bubble">{msg.content}</div></div>;
    return <div class="msg msg-assistant"><div class="msg-body" innerHTML={safeMarkdown(msg.content)}/></div>;
  }
  const hasPending = createMemo(() => pendingTools().length > 0);
  const hasProgress = createMemo(() => pendingTools().length > 0 || doneToolsInGroup().length > 0);
  const progressText = createMemo(() => {
    const parts: string[] = [];
    const done = doneToolsInGroup(); const pending = pendingTools();
    if (done.length > 0) parts.push(summarizeTools(done));
    if (pending.length > 0) parts.push(toolLabel(pending[0].name, pending[0].args));
    return parts.join(' · ');
  });
  return (
    <>
    <div class="chat-panel">
      <div class="chat-header">
        <Dropdown
          trigger={<button class="thread-select-trigger select-trigger"><span class="select-value">{activeThread()?.title ?? 'New conversation'}</span><span class="select-icon"><VsChevronDown size={10}/></span></button>}
          items={threads().map(t => ({
            label: t.title ?? 'New conversation',
            onSelect: () => switchThread(t.id),
            icon: <button class="icon-btn" style="width:22px;height:22px" onClick={e => { e.stopPropagation(); setDeleteTarget({ id: t.id, title: t.title ?? 'New conversation' }); }}>
              {isStreaming() && activeThreadId() === t.id ? <Spinner size={11}/> : <BiRegularTrash size={11}/>}
            </button>,
          }))}
          placement="bottom-start"
          menuClass="thread-dropdown-menu"
        />
        <button class="icon-btn" title="New thread" onClick={newThread}><VsAdd size={14}/></button>
      </div>
      <div class="chat-messages" ref={messagesEl}>
        <For each={messages() ?? []}>{msg => renderMsg(msg)}</For>
        <Show when={isStreaming()}>
          <div class="msg msg-assistant">
            <For each={completedGroups()}>{(g, i) => g.kind === 'text'
              ? <div class="msg-body" innerHTML={safeMarkdown(g.content)}/>
              : <ToolActivity tools={g.tools} active={i() === completedGroups().length - 1 && !liveText()}/>}</For>
            <Show when={hasProgress()}><ToolActivity tools={pendingTools().concat(doneToolsInGroup())} active={true}/></Show>
            <Show when={liveText()}><div class="msg-body" innerHTML={renderedLiveHtml() || `<p>${escapeHtml(liveText())}</p>`}/></Show>
            <Show when={!liveText() && !hasProgress() && completedGroups().length === 0}><div class="typing"><span/><span/><span/></div></Show>
          </div>
        </Show>
      </div>
      <InputBar onSend={send} onStop={handleStop} isStreaming={isStreaming} models={models} selectedModel={selectedModel} setSelectedModel={setSelectedModel}
        streamTokens={streamTokens}/>
    </div>
    <Show when={deleteTarget()}>
      <Dialog open={true} onClose={() => setDeleteTarget(null)} title="Delete conversation?" description={`"${deleteTarget()!.title}" — all messages will be permanently removed.`}>
        <div class="dialog-actions">
          <button class="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
          <button class="btn-danger" onClick={confirmDeleteThread} disabled={isDeleting()}>{isDeleting() ? <Spinner size={12} color="#fff"/> : 'Delete'}</button>
        </div>
      </Dialog>
    </Show>
    </>
  );
}
