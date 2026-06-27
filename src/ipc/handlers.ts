import { ipcMain, dialog, utilityProcess, app, WebContentsView, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as pty from 'node-pty';
import { nanoid } from 'nanoid';
import { q } from '../db/queries';
import { registerAuthHandlers } from '../auth';
import { quitAndInstall, openReleasesPage, checkForUpdate } from '../main';
import { buildHistoryMessages } from './types';
import type { Workspace, Conversation, AgentRunConfig, AgentEvent, HistoryMessage, HistoryPart, DBMessage, DBPart, DBArtifact } from './types';
import { secureResolve } from '../lib/securePath';
const now = () => Date.now();
// ─── Agent runtime state (main is the single authority) ─────────────────────
type Proc = ReturnType<typeof utilityProcess.fork>;
interface WorkerBox { proc: Proc; ready: boolean; queue: any[]; }
const workers = new Map<string, WorkerBox>();
const active = new Map<string, string>(); // convId → in-flight assistant messageId
const textBuffers = new Map<string, { convId: string; text: string; dirty: boolean }>(); // partId → buffer
// ─── PTY / Browser ──────────────────────────────────────────────────────────
const ptyInstances = new Map<string, ReturnType<typeof pty.spawn>>();
const ptyScrollback = new Map<string, string[]>();
const ptySubscribers = new Map<string, Electron.WebContents>();
const SCROLLBACK_LIMIT = 4000;
const convBrowserViews = new Map<string, WebContentsView>();
let activeBrowserConvId: string | null = null;
let mainWindow: BrowserWindow | null = null;
export function setMainWindow(win: BrowserWindow) { mainWindow = win; registerAuthHandlers(() => mainWindow); }
function send(channel: string, ...args: any[]) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  win?.webContents.send(channel, ...args);
}
// ─── Persistence-first event handling ───────────────────────────────────────
function flushBuffers() { for (const [partId, b] of textBuffers) if (b.dirty) { q.setPartText(partId, b.text); b.dirty = false; } }
setInterval(flushBuffers, 150);
function persistAndForward(convId: string, ev: AgentEvent) {
  switch (ev.type) {
    case 'message.start': { const seq = q.nextSeq(convId); ev.message.seq = seq; q.insertMessage(ev.message); active.set(convId, ev.message.id); break; }
    case 'part.start': { q.insertPart(ev.part); if (ev.part.type === 'text' || ev.part.type === 'reasoning') textBuffers.set(ev.part.id, { convId, text: '', dirty: false }); break; }
    case 'part.delta': { const b = textBuffers.get(ev.partId); if (b) { b.text += ev.text; b.dirty = true; } break; }
    case 'part.image': {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(ev.dataUrl);
      const mime = m?.[1] || ev.mime, data = m?.[2] || '';
      const artId = nanoid();
      const art: DBArtifact = { id: artId, convId, messageId: ev.messageId, partId: ev.partId, kind: 'image', mime, name: ev.name, data, createdAt: now() };
      q.insertArtifact(art);
      const part: DBPart = { id: ev.partId, messageId: ev.messageId, convId, seq: ev.seq, type: 'image', text: null, toolCallId: null, toolName: null, toolArgs: null, toolResult: null, toolStatus: null, toolMeta: null, artifactId: artId, path: null, createdAt: now(), updatedAt: now() };
      q.insertPart(part);
      break;
    }
    case 'tool.update': q.setPartTool(ev.partId, ev.status, ev.result ?? null, ev.meta ? JSON.stringify(ev.meta) : null); break;
    case 'compacted': { const seq = q.nextSeq(convId); ev.summaryMessage.seq = seq; q.insertMessage(ev.summaryMessage); q.insertPart(ev.summaryPart); q.markCompacted(ev.compactedIds); break; }
    case 'message.end': flushBuffers(); q.setMessageStatus(ev.messageId, ev.status, ev.error ?? null); q.touchConversation(convId); active.delete(convId); break;
    case 'title': q.updateConversation(convId, { title: ev.title, updatedAt: now() }); send('conv:titleUpdated', convId, ev.title); break;
    case 'tokens': q.addLifetimeTokens(ev.count); break;
  }
  send('agent:event', convId, ev);
}
function buildHistory(convId: string): HistoryMessage[] {
  return buildHistoryMessages(q.getMessages(convId), q.getParts(convId), q.getArtifacts(convId));
}
function getWorker(convId: string): WorkerBox {
  const existing = workers.get(convId);
  if (existing) return existing;
  const proc = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { env: { ...process.env }, stdio: 'pipe' });
  const box: WorkerBox = { proc, ready: false, queue: [] };
  workers.set(convId, box);
  proc.stdout?.on('data', (d: Buffer) => console.log(`[Worker:${convId.slice(0, 6)}]`, d.toString().trim()));
  proc.stderr?.on('data', (d: Buffer) => console.error(`[Worker:${convId.slice(0, 6)}]`, d.toString().trim()));
  proc.on('message', (ev: any) => {
    if (ev?.type === 'ready') { box.ready = true; for (const m of box.queue.splice(0)) proc.postMessage(m); return; }
    persistAndForward(convId, ev as AgentEvent);
  });
  proc.on('exit', (code) => {
    workers.delete(convId);
    const msgId = active.get(convId);
    if (msgId) {
      // Flush only this conv's text buffers, clear stale entries
      for (const [partId, b] of textBuffers) if (b.convId === convId) { q.setPartText(partId, b.text); textBuffers.delete(partId); }
      q.setMessageStatus(msgId, 'error', `Worker exited (${code})`); active.delete(convId);
      send('agent:event', convId, { type: 'message.end', messageId: msgId, status: 'error', error: `Worker exited (${code})` });
    }
  });
  return box;
}
function postToWorker(convId: string, payload: any) {
  const box = getWorker(convId);
  if (box.ready) box.proc.postMessage(payload); else box.queue.push(payload);
}
// ─── User-message input parts (from renderer) ───────────────────────────────
type InputPart = { type: 'text'; text: string } | { type: 'mention'; path: string } | { type: 'image' | 'file'; name: string; mime: string; dataUrl: string };
function persistUserMessage(convId: string, id: string, parts: InputPart[]): DBMessage {
  const seq = q.nextSeq(convId);
  const m: DBMessage = { id, convId, role: 'user', seq, status: 'complete', error: null, model: null, compacted: 0, createdAt: now(), updatedAt: now() };
  q.insertMessage(m);
  let ps = 0;
  for (const p of parts) {
    const pid = nanoid(), base = { id: pid, messageId: id, convId, seq: ps++, text: null as string | null, toolCallId: null, toolName: null, toolArgs: null, toolResult: null, toolStatus: null, toolMeta: null, artifactId: null as string | null, path: null as string | null, createdAt: now(), updatedAt: now() };
    if (p.type === 'text') q.insertPart({ ...base, type: 'text', text: p.text });
    else if (p.type === 'mention') q.insertPart({ ...base, type: 'mention', path: p.path });
    else { const mm = /^data:([^;]+);base64,(.*)$/s.exec(p.dataUrl); const artId = nanoid(); q.insertArtifact({ id: artId, convId, messageId: id, partId: pid, kind: p.type, mime: mm?.[1] || p.mime, name: p.name, data: mm?.[2] || '', createdAt: now() }); q.insertPart({ ...base, type: p.type, text: p.name, artifactId: artId }); }
  }
  q.touchConversation(convId);
  return m;
}
export function registerHandlers() {
  const checkOrigin = (wc: Electron.WebContents) => {
    const u = wc.getURL(), devUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : '';
    if (!u.startsWith('file://') && (!devUrl || !u.startsWith(devUrl))) throw new Error('Unauthorized IPC');
  };
  const safeHandle = (ch: string, fn: (e: Electron.IpcMainInvokeEvent, ...a: any[]) => any) => ipcMain.handle(ch, (e, ...a) => { checkOrigin(e.sender); return fn(e, ...a); });
  const safeOn = (ch: string, fn: (e: Electron.IpcMainEvent, ...a: any[]) => any) => ipcMain.on(ch, (e, ...a) => { checkOrigin(e.sender); return fn(e, ...a); });
  safeHandle('app:getUserDataPath', () => app.getPath('userData'));
  // ─── DB ───
  safeHandle('db:getWorkspaces', () => q.getWorkspaces());
  safeHandle('db:createWorkspace', (_, w: Workspace) => { q.createWorkspace(w); return w; });
  safeHandle('db:deleteWorkspace', (_, id: string) => q.deleteWorkspace(id));
  safeHandle('db:getConversations', (_, wsId: string | null) => q.getConversations(wsId));
  safeHandle('db:createConversation', (_, c: Conversation) => { q.createConversation(c); return c; });
  safeHandle('db:updateConversation', (_, id: string, patch: Partial<Conversation>) => q.updateConversation(id, patch));
  safeHandle('db:deleteConversation', (_, id: string) => {
    workers.get(id)?.proc.kill(); workers.delete(id); active.delete(id);
    q.deleteConversation(id);
    const view = convBrowserViews.get(id); if (view) { if (activeBrowserConvId === id) hideBrowserView(); convBrowserViews.delete(id); }
    ptyInstances.get(id)?.kill(); ptyInstances.delete(id); ptyScrollback.delete(id); ptySubscribers.delete(id);
  });
  safeHandle('db:loadConversation', (_, convId: string) => q.loadConversation(convId));
  safeHandle('db:getFirstLaunch', () => q.isFirstLaunch());
  safeHandle('db:setFirstLaunchDone', () => q.setFirstLaunchDone());
  safeOn('onboarding:close', () => q.setFirstLaunchDone());
  safeHandle('stats:get', () => ({ lifetimeTokens: q.getLifetimeTokens(), conversationCount: q.getConversationCount(), messageCount: q.getMessageCount() }));
  safeHandle('workspace:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const dirPath = result.filePaths[0];
    const ws: Workspace = { id: nanoid(), name: path.basename(dirPath), path: dirPath, createdAt: now() };
    q.createWorkspace(ws); return ws;
  });
  safeHandle('workspace:listFiles', async (_, { dirPath, query }: { dirPath: string; query: string }) => {
    const { glob } = await import('fast-glob');
    const files = await glob(query ? `**/*${query}*` : '**/*', { cwd: dirPath, onlyFiles: true, dot: true, ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.vite/**', '**/out/**'], absolute: false, deep: 4 });
    return files.slice(0, 30);
  });
  safeHandle('workspace:readFile', (_, { dirPath, filePath }: { dirPath: string; filePath: string }) => {
    try { return fs.readFileSync(secureResolve(dirPath, filePath), 'utf8'); } catch (e: any) { return `Error: ${e.message}`; }
  });
  // ─── Agent ───
  safeHandle('agent:send', (_, { config, message }: { config: AgentRunConfig; message: { id: string; parts: InputPart[] } }) => {
    const convId = config.convId;
    if (active.has(convId)) return { ok: false, busy: true };
    persistUserMessage(convId, message.id, message.parts);
    const history = buildHistory(convId);
    postToWorker(convId, { type: 'run', config, history });
    return { ok: true };
  });
  safeHandle('agent:abort', (_, convId: string) => { const box = workers.get(convId); if (!box) return; if (box.ready) box.proc.postMessage({ type: 'abort' }); else box.queue.push({ type: 'abort' }); });
  safeHandle('budget:get', async (_, { gcpBase, jwt, anonKey }: { gcpBase: string; jwt: string; anonKey: string }) => {
    const res = await fetch(`${gcpBase}/budget`, { headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`Budget fetch failed: ${res.status}`); return res.json();
  });
  safeHandle('models:get', async (_, { gcpBase, jwt, anonKey }: { gcpBase: string; jwt: string; anonKey: string }) => {
    const res = await fetch(`${gcpBase}/models`, { headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`Models fetch failed: ${res.status}`); return res.json();
  });
  // ─── Browser ───
  safeHandle('browser:show', (_, { convId, bounds }: { convId: string; bounds: Bounds }) => showBrowserView(convId, bounds));
  safeHandle('browser:hide', () => hideBrowserView());
  safeHandle('browser:setBounds', (_, { convId, bounds }: { convId: string; bounds: Bounds }) => { if (convId === activeBrowserConvId) convBrowserViews.get(convId)?.setBounds(roundB(bounds)); });
  safeHandle('browser:navigate', (_, { convId, url }: { convId: string; url: string }) => { getBrowserView(convId).webContents.loadURL(url); });
  safeHandle('browser:back', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.goBack(); });
  safeHandle('browser:forward', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.goForward(); });
  safeHandle('browser:reload', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.reload(); });
  safeHandle('browser:stop', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.stop(); });
  safeHandle('browser:destroy', (_, convId: string) => { const v = convBrowserViews.get(convId); if (v) { if (activeBrowserConvId === convId) hideBrowserView(); convBrowserViews.delete(convId); } });
  safeHandle('browser:findInPage', (_, { convId, text, opts }: { convId: string; text: string; opts?: any }) => { convBrowserViews.get(convId)?.webContents.findInPage(text, opts); });
  safeHandle('browser:stopFind', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.stopFindInPage('clearSelection'); });
  // ─── PTY ───
  safeHandle('pty:ensure', (_, { convId, cwd }: { convId: string; cwd?: string }) => {
    if (ptyInstances.has(convId)) return;
    if (!ptyScrollback.has(convId)) ptyScrollback.set(convId, []);
    const shell = process.platform === 'win32' ? (process.env.COMSPEC || 'powershell.exe') : (process.env.SHELL || '/bin/bash');
    try {
      const term = pty.spawn(shell, [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: cwd || app.getPath('home'), env: process.env as Record<string, string> });
      ptyInstances.set(convId, term);
      term.onData(data => { const buf = ptyScrollback.get(convId)!; buf.push(data); if (buf.length > SCROLLBACK_LIMIT) buf.splice(0, buf.length - SCROLLBACK_LIMIT); ptySubscribers.get(convId)?.send(`pty:data:${convId}`, data); });
      term.onExit(() => { ptyInstances.delete(convId); ptySubscribers.get(convId)?.send(`pty:exit:${convId}`); });
    } catch (e: any) {
      ptyScrollback.get(convId)?.push(`\r\n\x1b[31m[Terminal] Failed to spawn shell '${shell}': ${e.message}\x1b[0m\r\n`);
      ptySubscribers.get(convId)?.send(`pty:data:${convId}`, `\r\n\x1b[31m[Terminal] Failed to spawn shell '${shell}': ${e.message}\x1b[0m\r\n`);
    }
  });
  safeHandle('pty:attach', (event, { convId, cols, rows }: { convId: string; cols: number; rows: number }) => { ptySubscribers.set(convId, event.sender); try { ptyInstances.get(convId)?.resize(cols, rows); } catch {} return (ptyScrollback.get(convId) || []).join(''); });
  safeHandle('pty:detach', (_, convId: string) => { ptySubscribers.delete(convId); });
  safeOn('pty:write', (_, { convId, data }: { convId: string; data: string }) => ptyInstances.get(convId)?.write(data));
  safeHandle('pty:resize', (_, { convId, cols, rows }: { convId: string; cols: number; rows: number }) => { try { ptyInstances.get(convId)?.resize(cols, rows); } catch {} });
  safeHandle('pty:kill', (_, convId: string) => { ptyInstances.get(convId)?.kill(); ptyInstances.delete(convId); ptyScrollback.delete(convId); ptySubscribers.delete(convId); });
  // ─── Updater ───
  safeOn('update:quitAndInstall', () => quitAndInstall());
  safeOn('update:openReleases', () => openReleasesPage());
  safeOn('update:check', () => checkForUpdate());
}
// ─── Browser helpers ───
type Bounds = { x: number; y: number; width: number; height: number };
const roundB = (b: Bounds) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
function getBrowserView(convId: string): WebContentsView {
  const ex = convBrowserViews.get(convId); if (ex) return ex;
  const view = new WebContentsView({ webPreferences: { partition: `persist:conv-${convId}`, sandbox: true, contextIsolation: true } });
  view.setBackgroundColor('#1e1e1e');
  view.webContents.setBackgroundThrottling(false);
  for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) view.webContents.on(ev as any, () => sendBrowserState(convId));
  view.webContents.on('found-in-page', (_, r) => send('browser:find-result', { convId, active: r.activeMatchOrdinal, total: r.matches }));
  view.webContents.loadURL('https://www.google.com');
  convBrowserViews.set(convId, view);
  return view;
}
function sendBrowserState(convId: string) {
  const view = convBrowserViews.get(convId); if (!view || convId !== activeBrowserConvId) return;
  const wc = view.webContents;
  send('browser:state', { convId, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
}
function hideBrowserView() { if (!mainWindow || !activeBrowserConvId) return; const view = convBrowserViews.get(activeBrowserConvId); if (view) { try { mainWindow.contentView.removeChildView(view); } catch {} } activeBrowserConvId = null; }
function showBrowserView(convId: string, bounds: Bounds) { if (!mainWindow) return; hideBrowserView(); const view = getBrowserView(convId); mainWindow.contentView.addChildView(view); view.setBounds(roundB(bounds)); activeBrowserConvId = convId; sendBrowserState(convId); }
