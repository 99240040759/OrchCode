import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { Workspace, Conversation, Message, ToolCall, UIMessage, AgentChunk, AgentInitConfig, BudgetInfo, ModelDef } from './ipc/types';
import type { StoredSession } from './auth';
const agentPorts = new Map<string, MessagePort>();
const agentCallbacks = new Map<string, (msg: AgentChunk) => void>();
const pendingSends = new Map<string, unknown[]>();
let GCP_BASE = '', ANON_KEY = '';
try { GCP_BASE = process.env.GCP_FUNCTIONS_URL || ''; ANON_KEY = process.env.SUPABASE_ANON_KEY || ''; } catch {}
const api = {
  getZoomFactor: () => webFrame.getZoomFactor(),
  getUserDataPath: (): Promise<string> => ipcRenderer.invoke('app:getUserDataPath'),
  // ─── Config (baked in at build time) ───────────────────────────────────────
  gcpBase: GCP_BASE,
  anonKey: ANON_KEY,
  // ─── DB ─────────────────────────────────────────────────────────────────────
  getWorkspaces: (): Promise<Workspace[]> => ipcRenderer.invoke('db:getWorkspaces'),
  createWorkspace: (w: Workspace): Promise<Workspace> => ipcRenderer.invoke('db:createWorkspace', w),
  deleteWorkspace: (id: string): Promise<void> => ipcRenderer.invoke('db:deleteWorkspace', id),
  getConversations: (wsId: string | null): Promise<Conversation[]> => ipcRenderer.invoke('db:getConversations', wsId),
  createConversation: (c: Conversation): Promise<Conversation> => ipcRenderer.invoke('db:createConversation', c),
  updateConversation: (id: string, patch: Partial<Conversation>): Promise<void> => ipcRenderer.invoke('db:updateConversation', id, patch),
  deleteConversation: (id: string): Promise<void> => ipcRenderer.invoke('db:deleteConversation', id),
  getMessages: (convId: string): Promise<Message[]> => ipcRenderer.invoke('db:getMessages', convId),
  loadConversation: (convId: string): Promise<UIMessage[]> => ipcRenderer.invoke('db:loadConversation', convId),
  writeMessage: (m: Message) => ipcRenderer.send('db:writeMessage', m),
  writeToolCall: (tc: ToolCall) => ipcRenderer.send('db:writeToolCall', tc),
  getStats: (): Promise<{ lifetimeTokens: number; conversationCount: number; messageCount: number }> => ipcRenderer.invoke('stats:get'),
  openWorkspaceDialog: (): Promise<Workspace | null> => ipcRenderer.invoke('workspace:open'),
  listWorkspaceFiles: (dirPath: string, query: string): Promise<string[]> => ipcRenderer.invoke('workspace:listFiles', { dirPath, query }),
  readWorkspaceFile: (dirPath: string, filePath: string): Promise<string> => ipcRenderer.invoke('workspace:readFile', { dirPath, filePath }),
  // ─── Auth ───────────────────────────────────────────────────────────────────
  loadStoredSession: (): Promise<StoredSession | null> => ipcRenderer.invoke('auth:loadSession'),
  saveSession: (s: StoredSession): Promise<void> => ipcRenderer.invoke('auth:saveSession', s),
  startOAuth: (): Promise<void> => ipcRenderer.invoke('auth:startOAuth'),
  signOut: (): Promise<void> => ipcRenderer.invoke('auth:signOut'),
  onSessionReceived: (cb: (s: StoredSession) => void): (() => void) => {
    const h = (_: Electron.IpcRendererEvent, s: StoredSession) => cb(s);
    ipcRenderer.on('auth:sessionReceived', h);
    return () => ipcRenderer.removeListener('auth:sessionReceived', h);
  },
  // ─── Models & Budget ────────────────────────────────────────────────────────
  fetchModels: (jwt: string): Promise<Record<string, ModelDef>> => ipcRenderer.invoke('models:get', { gcpBase: GCP_BASE, jwt, anonKey: ANON_KEY }),
  getBudget: (jwt: string): Promise<BudgetInfo> => ipcRenderer.invoke('budget:get', { gcpBase: GCP_BASE, jwt, anonKey: ANON_KEY }),
  // ─── Settings ───────────────────────────────────────────────────────────────
  openSettings: () => ipcRenderer.send('settings:open'),
  // ─── Agent ──────────────────────────────────────────────────────────────────
  spawnAgent: (config: AgentInitConfig): Promise<void> => ipcRenderer.invoke('agent:spawn', config),
  killAgent: (convId: string): Promise<void> => ipcRenderer.invoke('agent:kill', convId),
  onAgentPort: (cb: (convId: string) => void): (() => void) => {
    const handler = (event: Electron.IpcRendererEvent, data: { convId: string }) => {
      const port = event.ports[0]; if (!port) return;
      agentPorts.set(data.convId, port);
      port.onmessage = (e: MessageEvent<AgentChunk>) => { agentCallbacks.get(data.convId)?.(e.data); };
      port.start(); cb(data.convId);
      const queue = pendingSends.get(data.convId) || []; pendingSends.delete(data.convId);
      queue.forEach(msg => port.postMessage(msg));
    };
    ipcRenderer.on('agent:port', handler);
    return () => ipcRenderer.removeListener('agent:port', handler);
  },
  onAgentMessage: (convId: string, cb: (msg: AgentChunk) => void) => { agentCallbacks.set(convId, cb); },
  sendToAgent: (convId: string, msg: { type: 'send'; content: string } | { type: 'kill' }) => {
    const port = agentPorts.get(convId);
    if (port) port.postMessage(msg);
    else { const queue = pendingSends.get(convId) || []; queue.push(msg); pendingSends.set(convId, queue); }
  },
  removeAgentPort: (convId: string) => { agentPorts.get(convId)?.close(); agentPorts.delete(convId); agentCallbacks.delete(convId); pendingSends.delete(convId); },
  onConvTitleUpdated: (cb: (convId: string, title: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, convId: string, title: string) => cb(convId, title);
    ipcRenderer.on('conv:titleUpdated', handler);
    return () => ipcRenderer.removeListener('conv:titleUpdated', handler);
  },
  // ─── Browser (WebContentsView) ──────────────────────────────────────────────
  browserShow: (convId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void> => ipcRenderer.invoke('browser:show', { convId, bounds }),
  browserHide: (): Promise<void> => ipcRenderer.invoke('browser:hide'),
  browserSetBounds: (convId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void> => ipcRenderer.invoke('browser:setBounds', { convId, bounds }),
  browserNavigate: (convId: string, url: string): Promise<void> => ipcRenderer.invoke('browser:navigate', { convId, url }),
  browserBack: (convId: string): Promise<void> => ipcRenderer.invoke('browser:back', convId),
  browserForward: (convId: string): Promise<void> => ipcRenderer.invoke('browser:forward', convId),
  browserReload: (convId: string): Promise<void> => ipcRenderer.invoke('browser:reload', convId),
  browserStop: (convId: string): Promise<void> => ipcRenderer.invoke('browser:stop', convId),
  browserDestroy: (convId: string): Promise<void> => ipcRenderer.invoke('browser:destroy', convId),
  browserFindInPage: (convId: string, text: string, opts?: { forward?: boolean; findNext?: boolean }): Promise<void> => ipcRenderer.invoke('browser:findInPage', { convId, text, opts }),
  browserStopFind: (convId: string): Promise<void> => ipcRenderer.invoke('browser:stopFind', convId),
  onBrowserState: (cb: (state: { convId: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: any) => cb(state);
    ipcRenderer.on('browser:state', handler);
    return () => ipcRenderer.removeListener('browser:state', handler);
  },
  // ─── PTY ────────────────────────────────────────────────────────────────────
  ptyEnsure: (convId: string, cwd?: string): Promise<void> => ipcRenderer.invoke('pty:ensure', { convId, cwd }),
  ptyAttach: (convId: string, cols: number, rows: number): Promise<string> => ipcRenderer.invoke('pty:attach', { convId, cols, rows }),
  ptyDetach: (convId: string): Promise<void> => ipcRenderer.invoke('pty:detach', convId),
  ptyWrite: (convId: string, data: string) => ipcRenderer.send('pty:write', { convId, data }),
  ptyResize: (convId: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke('pty:resize', { convId, cols, rows }),
  ptyKill: (convId: string): Promise<void> => ipcRenderer.invoke('pty:kill', convId),
  onPtyData: (convId: string, cb: (data: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on(`pty:data:${convId}`, handler);
    return () => ipcRenderer.removeListener(`pty:data:${convId}`, handler);
  },
  onPtyExit: (convId: string, cb: () => void): (() => void) => {
    const h = () => cb();
    ipcRenderer.once(`pty:exit:${convId}`, h);
    return () => ipcRenderer.removeListener(`pty:exit:${convId}`, h);
  },
  // ─── Updater ────────────────────────────────────────────────────────────────
  onUpdateStatus: (cb: (status: string, info?: string) => void): (() => void) => {
    const h = (_: Electron.IpcRendererEvent, status: string, info?: string) => cb(status, info);
    ipcRenderer.on('update:status', h);
    return () => ipcRenderer.removeListener('update:status', h);
  },
  updateQuitAndInstall: () => ipcRenderer.send('update:quitAndInstall'),
  updateOpenReleases: () => ipcRenderer.send('update:openReleases'),
  updateCheck: () => ipcRenderer.send('update:check'),
};
contextBridge.exposeInMainWorld('electron', api);
