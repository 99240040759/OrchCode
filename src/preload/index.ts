import { contextBridge, ipcRenderer } from 'electron'

const api = {
  selectWorkspace: (conversationId: string) =>
    ipcRenderer.invoke('workspace:select', conversationId),
  setActiveWorkspace: (conversationId: string, workspacePath: string) =>
    ipcRenderer.invoke('workspace:set-active', { conversationId, workspacePath }),
  closeAndDeleteWorkspace: (workspacePath: string) =>
    ipcRenderer.invoke('workspace:close-and-delete', workspacePath),
  listWorkspaceFiles: (conversationId: string) =>
    ipcRenderer.invoke('workspace:list-files', conversationId),

  streamAgent: (
    promptText: string,
    threadId: string,
    mode?: string,
    modelType?: string,
    attachments?: any[]
  ) =>
    ipcRenderer.invoke('agent:stream-request', promptText, threadId, mode, modelType, attachments),
  stopAgentStream: (threadId?: string) => ipcRenderer.invoke('agent:stream-stop', threadId),
  onAgentChunk: (callback: (chunk: any) => void) => {
    const listener = (_event: any, chunk: any) => callback(chunk)
    ipcRenderer.on('agent:stream-chunk', listener)
    return () => ipcRenderer.removeListener('agent:stream-chunk', listener)
  },
  getAvailableModels: () => ipcRenderer.invoke('models:get-available'),

  getConversationId: () => ipcRenderer.invoke('mastra:get-conversation-id'),
  newConversation: () => ipcRenderer.invoke('mastra:new-conversation'),
  getThreads: () => ipcRenderer.invoke('mastra:get-threads'),
  getThread: (threadId: string) => ipcRenderer.invoke('mastra:get-thread', threadId),
  getThreadMessages: (threadId: string) =>
    ipcRenderer.invoke('mastra:get-thread-messages', threadId),
  deleteThread: (threadId: string) => ipcRenderer.invoke('mastra:delete-thread', threadId),
  getThreadWorkspace: (threadId: string) =>
    ipcRenderer.invoke('mastra:get-thread-workspace', threadId),
  getUniqueWorkspaces: () => ipcRenderer.invoke('mastra:get-unique-workspaces'),
  generateTitle: (text: string, threadId: string) =>
    ipcRenderer.invoke('mastra:generate-title', { text, threadId }),

  listArtifacts: (conversationId: string) => ipcRenderer.invoke('artifacts:list', conversationId),
  readFile: (filePath: string, conversationId?: string) =>
    ipcRenderer.invoke('file:read', filePath, conversationId),
  readOriginalFile: (filePath: string, conversationId?: string) =>
    ipcRenderer.invoke('file:read-original', filePath, conversationId),
  writeFile: (filePath: string, content: string, conversationId?: string) =>
    ipcRenderer.invoke('file:write', filePath, content, conversationId),
  onArtifactsChanged: (callback: (data: { conversationId: string; artifacts: any[] }) => void) => {
    const listener = (_event: any, data: { conversationId: string; artifacts: any[] }) => callback(data)
    ipcRenderer.on('artifacts:changed', listener)
    return () => ipcRenderer.removeListener('artifacts:changed', listener)
  },

  createTerminal: (opts: { cols: number; rows: number; cwd?: string; conversationId?: string }) =>
    ipcRenderer.invoke('terminal:create', opts),
  terminalInput: (opts: { id: string; data: string }) => ipcRenderer.invoke('terminal:input', opts),
  terminalResize: (opts: { id: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('terminal:resize', opts),
  closeTerminal: (opts: { id: string }) => ipcRenderer.invoke('terminal:close', opts),
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback: (payload: { id: string; exitCode: number }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },

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
    const listener = (_event: any, title: string) => callback(title)
    ipcRenderer.on('browser:title-updated', listener)
    return () => ipcRenderer.removeListener('browser:title-updated', listener)
  },
  onBrowserUrlChanged: (callback: (url: string) => void) => {
    const listener = (_event: any, url: string) => callback(url)
    ipcRenderer.on('browser:url-changed', listener)
    return () => ipcRenderer.removeListener('browser:url-changed', listener)
  },

  showConfirmDialog: (opts: {
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }) => ipcRenderer.invoke('dialog:confirm', opts),

  getUpdateStatus: () => ipcRenderer.invoke('updater:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  openMacRelease: () => ipcRenderer.invoke('updater:open-mac-release'),
  onUpdateStatusChanged: (callback: (status: any) => void) => {
    const listener = (_event: any, status: any) => callback(status)
    ipcRenderer.on('updater:status-changed', listener)
    return () => ipcRenderer.removeListener('updater:status-changed', listener)
  },
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  startGoogleAuth: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getAuthUser: () => ipcRenderer.invoke('auth:get-user'),
  openMainAndCloseOnboarding: () => ipcRenderer.invoke('auth:open-main-and-close-onboarding'),
  onAuthStatusChanged: (callback: (user: any) => void) => {
    const listener = (_event: any, user: any) => callback(user)
    ipcRenderer.on('auth:status-changed', listener)
    return () => ipcRenderer.removeListener('auth:status-changed', listener)
  },
  setActiveSession: (threadId: string) => ipcRenderer.invoke('session:set-active', threadId)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}
