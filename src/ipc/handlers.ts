import { ipcMain, dialog, utilityProcess, MessageChannelMain, app, WebContentsView, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as pty from 'node-pty';
import { nanoid } from 'nanoid';
import { q } from '../db/queries';

import { registerAuthHandlers } from '../auth';
import { quitAndInstall, openReleasesPage, checkForUpdate } from '../main';
import type { Workspace, Conversation, Message, ToolCall, AgentInitConfig } from '../ipc/types';

const agentProcesses = new Map<string, ReturnType<typeof utilityProcess.fork>>();
const ptyInstances = new Map<string, ReturnType<typeof pty.spawn>>();
// scrollback ring per conv — max 4000 lines, avoids unbounded growth
const ptyScrollback = new Map<string, string[]>();
// active pty subscriber (the renderer webContents that is currently viewing this conv's terminal)
const ptySubscribers = new Map<string, Electron.WebContents>();
const SCROLLBACK_LIMIT = 4000;

// WebContentsView browser management
const convBrowserViews = new Map<string, WebContentsView>();
let activeBrowserConvId: string | null = null;
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win;
  registerAuthHandlers(() => mainWindow);
}
function send(channel: string, ...args: any[]) { mainWindow?.webContents.send(channel, ...args); }

function getBrowserView(convId: string): WebContentsView {
  if (convBrowserViews.has(convId)) return convBrowserViews.get(convId)!;
  const view = new WebContentsView({
    webPreferences: { partition: `persist:conv-${convId}`, sandbox: true, contextIsolation: true },
  });
  view.webContents.setBackgroundThrottling(false);
  view.webContents.on('did-start-loading', () => sendBrowserState(convId));
  view.webContents.on('did-stop-loading', () => sendBrowserState(convId));
  view.webContents.on('did-navigate', () => sendBrowserState(convId));
  view.webContents.on('did-navigate-in-page', () => sendBrowserState(convId));
  view.webContents.on('page-title-updated', () => sendBrowserState(convId));
  view.webContents.loadURL('https://www.google.com');
  convBrowserViews.set(convId, view);
  return view;
}

function sendBrowserState(convId: string) {
  const view = convBrowserViews.get(convId);
  if (!view || convId !== activeBrowserConvId) return;
  const wc = view.webContents;
  send('browser:state', {
    convId,
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
  });
}

function hideBrowserView() {
  if (!mainWindow || !activeBrowserConvId) return;
  const view = convBrowserViews.get(activeBrowserConvId);
  if (view) {
    try { mainWindow.contentView.removeChildView(view); } catch {}
  }
  activeBrowserConvId = null;
}

function showBrowserView(convId: string, bounds: { x: number; y: number; width: number; height: number }) {
  if (!mainWindow) return;
  hideBrowserView();
  const view = getBrowserView(convId);
  mainWindow.contentView.addChildView(view);
  view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
  activeBrowserConvId = convId;
  sendBrowserState(convId);
}

export function registerHandlers() {
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));
  // DB handlers
  ipcMain.handle('db:getWorkspaces', () => q.getWorkspaces());
  ipcMain.handle('db:createWorkspace', (_, w: Workspace) => { q.createWorkspace(w); return w; });
  ipcMain.handle('db:deleteWorkspace', (_, id: string) => q.deleteWorkspace(id));
  ipcMain.handle('db:getConversations', (_, wsId: string | null) => q.getConversations(wsId));
  ipcMain.handle('db:createConversation', (_, c: Conversation) => { q.createConversation(c); return c; });
  ipcMain.handle('db:updateConversation', (_, id: string, patch: Partial<Conversation>) => q.updateConversation(id, patch));
  ipcMain.handle('db:deleteConversation', (_, id: string) => {
    q.deleteConversation(id);
    // Clean up browser view
    const view = convBrowserViews.get(id);
    if (view) { if (activeBrowserConvId === id) hideBrowserView(); convBrowserViews.delete(id); }
    // Clean up PTY
    ptyInstances.get(id)?.kill(); ptyInstances.delete(id); ptyScrollback.delete(id); ptySubscribers.delete(id);
    // Clean up agent
    const proc = agentProcesses.get(id);
    if (proc) { try { proc.kill(); } catch {} agentProcesses.delete(id); }
  });
  ipcMain.handle('db:getMessages', (_, convId: string) => q.getMessages(convId));
  ipcMain.handle('db:loadConversation', (_, convId: string) => q.loadConversation(convId));
  ipcMain.on('db:writeMessage', (_, m: Message) => q.writeMessage(m));
  ipcMain.on('db:writeToolCall', (_, tc: ToolCall) => q.writeToolCall(tc));
  ipcMain.handle('db:getFirstLaunch', () => q.isFirstLaunch());
  ipcMain.handle('db:setFirstLaunchDone', () => q.setFirstLaunchDone());
  ipcMain.on('onboarding:close', () => { q.setFirstLaunchDone(); });

  ipcMain.handle('stats:get', () => ({
    lifetimeTokens: q.getLifetimeTokens(),
    conversationCount: q.getConversationCount(),
    messageCount: q.getMessageCount(),
  }));

  ipcMain.handle('workspace:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const dirPath = result.filePaths[0];
    const ws: Workspace = { id: nanoid(), name: path.basename(dirPath), path: dirPath, createdAt: Date.now() };
    q.createWorkspace(ws);
    return ws;
  });
  ipcMain.handle('workspace:listFiles', async (_, { dirPath, query }: { dirPath: string; query: string }) => {
    const { glob } = await import('fast-glob');
    const pattern = query ? `**/*${query}*` : '**/*';
    const files = await glob(pattern, { cwd: dirPath, onlyFiles: true, ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.vite/**', '**/out/**'], absolute: false, deep: 4 });
    return files.slice(0, 30);
  });
  ipcMain.handle('workspace:readFile', (_, { dirPath, filePath }: { dirPath: string; filePath: string }) => {
    const fp = path.isAbsolute(filePath) ? filePath : path.join(dirPath, filePath);
    try { return fs.readFileSync(fp, 'utf8'); } catch (e: any) { return `Error: ${e.message}`; }
  });

  // Agent — receives full AgentInitConfig from renderer (jwt, gcpBase, model, etc.)
  ipcMain.handle('agent:spawn', (event, config: AgentInitConfig) => {
    const { convId } = config;
    console.log(`[Agent:${convId.slice(0, 6)}] Spawning worker. Model: ${config.modelId}, gcpBase: ${config.gcpBase?.slice(0, 40)}, jwt: ${config.jwt ? 'present' : 'MISSING'}, anonKey: ${config.anonKey ? 'present' : 'MISSING'}`);
    if (agentProcesses.has(convId)) { console.log(`[Agent:${convId.slice(0, 6)}] Killing existing worker`); try { agentProcesses.get(convId)?.kill(); } catch {} agentProcesses.delete(convId); }
    const { port1, port2 } = new MessageChannelMain();
    const proc = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { env: { ...process.env }, stdio: 'pipe' });
    agentProcesses.set(convId, proc);
    proc.stdout?.on('data', (d: Buffer) => console.log(`[Worker:${convId.slice(0, 6)}]`, d.toString().trim()));
    proc.stderr?.on('data', (d: Buffer) => console.error(`[Worker:${convId.slice(0, 6)}]`, d.toString().trim()));
    proc.on('message', (msg: any) => {
      console.log(`[Agent:${convId.slice(0, 6)}] Worker msg:`, msg.type, msg.type === 'chunk' ? `"${(msg.delta || '').slice(0, 30)}"` : '');
      if (msg.type === 'db:write') { q.writeMessage(msg.message); return; }
      if (msg.type === 'db:toolcall') { q.writeToolCall(msg.toolCall); return; }
      if (msg.type === 'db:title') { q.updateConversation(convId, { title: msg.title, updatedAt: Date.now() }); send('conv:titleUpdated', convId, msg.title); return; }
      if (msg.type === 'db:tokens') { q.addLifetimeTokens(msg.count); port1.postMessage(msg); return; }
      port1.postMessage(msg);
    });
    port1.on('message', (e) => { console.log(`[Agent:${convId.slice(0, 6)}] Port msg from renderer:`, (e.data as any)?.type); proc.postMessage(e.data); });
    port1.start();
    proc.postMessage({ type: 'init', ...config });
    event.sender.postMessage('agent:port', { convId }, [port2]);
    console.log(`[Agent:${convId.slice(0, 6)}] Worker spawned, port transferred to renderer`);
    proc.on('exit', (code) => { console.log(`[Agent:${convId.slice(0, 6)}] Worker exited with code:`, code); agentProcesses.delete(convId); port1.close(); });
  });
  ipcMain.handle('agent:kill', (_, convId: string) => {
    const proc = agentProcesses.get(convId);
    if (proc) { proc.postMessage({ type: 'kill' }); setTimeout(() => { try { proc.kill(); } catch {} }, 500); agentProcesses.delete(convId); }
  });
  // Settings window

  // Budget — proxied from GCP, called with user JWT from renderer
  ipcMain.handle('budget:get', async (_, { gcpBase, jwt, anonKey }: { gcpBase: string; jwt: string; anonKey: string }) => {
    const res = await fetch(`${gcpBase}/budget`, { headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`Budget fetch failed: ${res.status}`);
    return res.json();
  });
  // Models — fetched from GCP public /models endpoint (no auth needed)
  ipcMain.handle('models:get', async (_, { gcpBase, jwt, anonKey }: { gcpBase: string; jwt: string; anonKey: string }) => {
    const res = await fetch(`${gcpBase}/models`, { headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`Models fetch failed: ${res.status}`);
    return res.json();
  });
  ipcMain.handle('browser:show', (_, { convId, bounds }: { convId: string; bounds: { x: number; y: number; width: number; height: number } }) => {
    showBrowserView(convId, bounds);
  });
  ipcMain.handle('browser:hide', () => hideBrowserView());
  ipcMain.handle('browser:setBounds', (_, { convId, bounds }: { convId: string; bounds: { x: number; y: number; width: number; height: number } }) => {
    if (convId !== activeBrowserConvId) return;
    const view = convBrowserViews.get(convId);
    if (view) view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
  });
  ipcMain.handle('browser:navigate', (_, { convId, url }: { convId: string; url: string }) => {
    getBrowserView(convId).webContents.loadURL(url);
  });
  ipcMain.handle('browser:back', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.goBack(); });
  ipcMain.handle('browser:forward', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.goForward(); });
  ipcMain.handle('browser:reload', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.reload(); });
  ipcMain.handle('browser:stop', (_, convId: string) => { convBrowserViews.get(convId)?.webContents.stop(); });
  ipcMain.handle('browser:destroy', (_, convId: string) => {
    const view = convBrowserViews.get(convId);
    if (view) { if (activeBrowserConvId === convId) hideBrowserView(); convBrowserViews.delete(convId); }
  });
  ipcMain.handle('browser:findInPage', (_, { convId, text, opts }: { convId: string; text: string; opts?: any }) => {
    convBrowserViews.get(convId)?.webContents.findInPage(text, opts);
  });
  ipcMain.handle('browser:stopFind', (_, convId: string) => {
    convBrowserViews.get(convId)?.webContents.stopFindInPage('clearSelection');
  });

  // ─── PTY ───────────────────────────────────────────────────────────────────
  // Ensure PTY exists and init scrollback for convId
  ipcMain.handle('pty:ensure', (_, { convId, cwd }: { convId: string; cwd?: string }) => {
    if (ptyInstances.has(convId)) return;
    if (!ptyScrollback.has(convId)) ptyScrollback.set(convId, []);
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';
    const term = pty.spawn(shell, [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: cwd || app.getPath('home'), env: process.env as Record<string, string> });
    ptyInstances.set(convId, term);
    term.onData(data => {
      // Append to scrollback ring
      const buf = ptyScrollback.get(convId)!;
      buf.push(data);
      if (buf.length > SCROLLBACK_LIMIT) buf.splice(0, buf.length - SCROLLBACK_LIMIT);
      // Forward to subscriber if attached
      ptySubscribers.get(convId)?.send(`pty:data:${convId}`, data);
    });
    term.onExit(() => { ptyInstances.delete(convId); ptySubscribers.get(convId)?.send(`pty:exit:${convId}`); });
  });
  // Attach renderer to pty — replays scrollback, subscribes to new data
  ipcMain.handle('pty:attach', (event, { convId, cols, rows }: { convId: string; cols: number; rows: number }) => {
    ptySubscribers.set(convId, event.sender);
    const term = ptyInstances.get(convId);
    if (term) { try { term.resize(cols, rows); } catch {} }
    // Replay entire scrollback buffer immediately
    const scrollback = ptyScrollback.get(convId) || [];
    return scrollback.join(''); // return as single string for efficiency
  });
  // Detach renderer — PTY keeps running, scrollback keeps accumulating
  ipcMain.handle('pty:detach', (_, convId: string) => { ptySubscribers.delete(convId); });
  ipcMain.on('pty:write', (_, { convId, data }: { convId: string; data: string }) => ptyInstances.get(convId)?.write(data));
  ipcMain.handle('pty:resize', (_, { convId, cols, rows }: { convId: string; cols: number; rows: number }) => { try { ptyInstances.get(convId)?.resize(cols, rows); } catch {} });
  ipcMain.handle('pty:kill', (_, convId: string) => {
    ptyInstances.get(convId)?.kill(); ptyInstances.delete(convId);
    ptyScrollback.delete(convId); ptySubscribers.delete(convId);
  });
  // ─── Updater ─────────────────────────────────────────────────────────────
  ipcMain.on('update:quitAndInstall', () => quitAndInstall());
  ipcMain.on('update:openReleases', () => openReleasesPage());
  ipcMain.on('update:check', () => checkForUpdate());
}
