import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  AgentBridge,
  ArtifactsBridge,
  AuthBridge,
  BrowserBridge,
  DialogBridge,
  TerminalBridge,
  ThreadsBridge,
  UpdaterBridge,
  WorkspaceBridge
} from './index.d'
import type { AgentAttachment, AgentStreamChunk } from './sharedTypes'

const workspaceBridge: WorkspaceBridge = {
  selectWorkspace: (conversationId: string) =>
    ipcRenderer.invoke('workspace:select', conversationId),
  setActiveWorkspace: (conversationId: string, workspacePath: string) =>
    ipcRenderer.invoke('workspace:set-active', { conversationId, workspacePath }),
  closeAndDeleteWorkspace: (workspacePath: string) =>
    ipcRenderer.invoke('workspace:close-and-delete', workspacePath),
  listWorkspaceFiles: (conversationId: string) =>
    ipcRenderer.invoke('workspace:list-files', conversationId),
  readFile: (filePath: string, conversationId?: string) =>
    ipcRenderer.invoke('file:read', filePath, conversationId),
  readOriginalFile: (filePath: string, conversationId?: string) =>
    ipcRenderer.invoke('file:read-original', filePath, conversationId)
}

const agentBridge: AgentBridge = {
  streamAgent: (
    promptText: string,
    threadId: string,
    mode?: string,
    modelType?: string,
    attachments?: AgentAttachment[]
  ) =>
    ipcRenderer.invoke('agent:stream-request', promptText, threadId, mode, modelType, attachments),
  stopAgentStream: (threadId?: string) => ipcRenderer.invoke('agent:stream-stop', threadId),
  onAgentChunk: (callback: (chunk: AgentStreamChunk) => void) => {
    const listener = (_event: IpcRendererEvent, chunk: AgentStreamChunk) => callback(chunk)
    ipcRenderer.on('agent:stream-chunk', listener)
    return () => ipcRenderer.removeListener('agent:stream-chunk', listener)
  },
  getAvailableModels: () => ipcRenderer.invoke('models:get-available')
}

const threadsBridge: ThreadsBridge = {
  getConversationId: () => ipcRenderer.invoke('mastra:get-conversation-id'),
  newConversation: () => ipcRenderer.invoke('mastra:new-conversation'),
  getThreads: () => ipcRenderer.invoke('mastra:get-threads'),
  getThread: (threadId: string) => ipcRenderer.invoke('mastra:get-thread', threadId),
  getThreadMessages: (threadId: string) =>
    ipcRenderer.invoke('mastra:get-thread-messages', threadId),
  deleteThread: (threadId: string) => ipcRenderer.invoke('mastra:delete-thread', threadId),
  getThreadWorkspace: (threadId: string) =>
    ipcRenderer.invoke('mastra:get-thread-workspace', threadId),
  generateTitle: (text: string, threadId: string) =>
    ipcRenderer.invoke('mastra:generate-title', { text, threadId }),
  setActiveSession: (threadId: string) => ipcRenderer.invoke('session:set-active', threadId)
}

const artifactsBridge: ArtifactsBridge = {
  listArtifacts: (conversationId: string) => ipcRenderer.invoke('artifacts:list', conversationId),
  onArtifactsChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, data: Parameters<typeof callback>[0]) =>
      callback(data)
    ipcRenderer.on('artifacts:changed', listener)
    return () => ipcRenderer.removeListener('artifacts:changed', listener)
  }
}

const terminalBridge: TerminalBridge = {
  createTerminal: (opts: { cols: number; rows: number; cwd?: string; conversationId?: string }) =>
    ipcRenderer.invoke('terminal:create', opts),
  terminalInput: (opts: { id: string; data: string }) => ipcRenderer.invoke('terminal:input', opts),
  terminalResize: (opts: { id: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('terminal:resize', opts),
  closeTerminal: (opts: { id: string }) => ipcRenderer.invoke('terminal:close', opts),
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback: (payload: { id: string; exitCode: number }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  }
}

const browserBridge: BrowserBridge = {
  openBrowser: (opts: {
    url: string
    bounds: { x: number; y: number; width: number; height: number }
  }) => ipcRenderer.invoke('browser:open', opts),
  navigateBrowser: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  resizeBrowser: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser:resize', bounds),
  closeBrowser: () => ipcRenderer.invoke('browser:close'),
  onBrowserTitleUpdated: (callback: (title: string) => void) => {
    const listener = (_event: IpcRendererEvent, title: string) => callback(title)
    ipcRenderer.on('browser:title-updated', listener)
    return () => ipcRenderer.removeListener('browser:title-updated', listener)
  },
  onBrowserUrlChanged: (callback: (url: string) => void) => {
    const listener = (_event: IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('browser:url-changed', listener)
    return () => ipcRenderer.removeListener('browser:url-changed', listener)
  }
}

const dialogBridge: DialogBridge = {
  showConfirmDialog: (opts: {
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }) => ipcRenderer.invoke('dialog:confirm', opts)
}

const updaterBridge: UpdaterBridge = {
  platform: process.platform as UpdaterBridge['platform'],
  getUpdateStatus: () => ipcRenderer.invoke('updater:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  openMacRelease: () => ipcRenderer.invoke('updater:open-mac-release'),
  onUpdateStatusChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, status: Parameters<typeof callback>[0]) =>
      callback(status)
    ipcRenderer.on('updater:status-changed', listener)
    return () => ipcRenderer.removeListener('updater:status-changed', listener)
  },
  getAppVersion: () => ipcRenderer.invoke('app:get-version')
}

const authBridge: AuthBridge = {
  startGoogleAuth: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getAuthUser: () => ipcRenderer.invoke('auth:get-user'),
  openMainAndCloseOnboarding: () => ipcRenderer.invoke('auth:open-main-and-close-onboarding'),
  onAuthStatusChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, user: Parameters<typeof callback>[0]) =>
      callback(user)
    ipcRenderer.on('auth:status-changed', listener)
    return () => ipcRenderer.removeListener('auth:status-changed', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('workspaceBridge', workspaceBridge)
    contextBridge.exposeInMainWorld('agentBridge', agentBridge)
    contextBridge.exposeInMainWorld('threadsBridge', threadsBridge)
    contextBridge.exposeInMainWorld('artifactsBridge', artifactsBridge)
    contextBridge.exposeInMainWorld('terminalBridge', terminalBridge)
    contextBridge.exposeInMainWorld('browserBridge', browserBridge)
    contextBridge.exposeInMainWorld('dialogBridge', dialogBridge)
    contextBridge.exposeInMainWorld('updaterBridge', updaterBridge)
    contextBridge.exposeInMainWorld('authBridge', authBridge)
  } catch (error) {
    console.error(error)
  }
}
