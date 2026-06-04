import type { AgentStreamChunk } from './sharedTypes'

export interface WorkspaceContext {
  conversationId: string
  rootPath: string
  artifactsPath: string
  isUserWorkspace: boolean
}

export interface ArtifactEntry {
  name: string
  path: string
  size: number
  modified: string
}

export interface ThreadEntry {
  id: string
  title?: string
  resourceId: string
  createdAt: string
  updatedAt: string
  workspacePath?: string | null
  accumulatedTokens?: number
}

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  data?: string
  createdAt: string
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}

export interface UserProfile {
  uid: string
  name: string
  email: string
  photoUrl: string
}

export interface WorkspaceBridge {
  selectWorkspace: (conversationId: string) => Promise<WorkspaceContext | null>
  setActiveWorkspace: (conversationId: string, workspacePath: string) => Promise<any>
  closeAndDeleteWorkspace: (workspacePath: string) => Promise<boolean>
  listWorkspaceFiles: (conversationId: string) => Promise<string[]>
  readFile: (filePath: string, conversationId?: string) => Promise<any>
  readOriginalFile: (filePath: string, conversationId?: string) => Promise<any>
}

export interface AgentBridge {
  streamAgent: (
    promptText: string,
    threadId: string,
    mode?: string,
    modelType?: string,
    attachments?: any[]
  ) => Promise<void>
  stopAgentStream: (threadId?: string) => Promise<void>
  onAgentChunk: (
    callback: (chunk: AgentStreamChunk) => void
  ) => () => void
  getAvailableModels: () => Promise<Record<string, { id: string; name: string }>>
}

export interface ThreadsBridge {
  getConversationId: () => Promise<string>
  newConversation: () => Promise<{ conversationId: string }>
  getThreads: () => Promise<ThreadEntry[]>
  getThread: (threadId: string) => Promise<(ThreadEntry & { workspacePath?: string | null }) | null>
  getThreadMessages: (threadId: string) => Promise<ThreadMessage[]>
  deleteThread: (threadId: string) => Promise<boolean>
  getThreadWorkspace: (threadId: string) => Promise<string | null>
  generateTitle: (text: string, threadId: string) => Promise<string | null>
  setActiveSession: (threadId: string) => Promise<boolean>
}

export interface ArtifactsBridge {
  listArtifacts: (conversationId: string) => Promise<ArtifactEntry[]>
  onArtifactsChanged: (
    callback: (data: { conversationId: string; artifacts: ArtifactEntry[] }) => void
  ) => () => void
}

export interface TerminalBridge {
  createTerminal: (opts: {
    cols: number
    rows: number
    cwd?: string
    conversationId?: string
  }) => Promise<{ id: string }>
  terminalInput: (opts: { id: string; data: string }) => Promise<void>
  terminalResize: (opts: { id: string; cols: number; rows: number }) => Promise<void>
  closeTerminal: (opts: { id: string }) => Promise<void>
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void
  onTerminalExit: (callback: (payload: { id: string; exitCode: number }) => void) => () => void
}

export interface BrowserBridge {
  openBrowser: (opts: {
    url: string
    bounds: { x: number; y: number; width: number; height: number }
  }) => Promise<void>
  navigateBrowser: (url: string) => Promise<void>
  browserBack: () => Promise<void>
  browserForward: () => Promise<void>
  browserReload: () => Promise<void>
  resizeBrowser: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  closeBrowser: () => Promise<void>
  onBrowserTitleUpdated: (callback: (title: string) => void) => () => void
  onBrowserUrlChanged: (callback: (url: string) => void) => () => void
}

export interface DialogBridge {
  showConfirmDialog: (opts: {
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }) => Promise<number>
}

export interface UpdaterBridge {
  getUpdateStatus: () => Promise<UpdateStatus>
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
  openMacRelease: () => Promise<void>
  onUpdateStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
  getAppVersion: () => Promise<string>
}

export interface AuthBridge {
  startGoogleAuth: () => Promise<UserProfile | null>
  logout: () => Promise<boolean>
  getAuthUser: () => Promise<UserProfile | null>
  openMainAndCloseOnboarding: () => Promise<void>
  onAuthStatusChanged: (callback: (user: UserProfile | null) => void) => () => void
}

declare global {
  interface Window {
    workspaceBridge: WorkspaceBridge
    agentBridge: AgentBridge
    threadsBridge: ThreadsBridge
    artifactsBridge: ArtifactsBridge
    terminalBridge: TerminalBridge
    browserBridge: BrowserBridge
    dialogBridge: DialogBridge
    updaterBridge: UpdaterBridge
    authBridge: AuthBridge
  }
}
