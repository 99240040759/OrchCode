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

export interface AppAPI {
  selectWorkspace: (conversationId: string) => Promise<WorkspaceContext | null>

  streamAgent: (promptText: string, threadId: string, mode?: string, modelType?: string) => Promise<void>
  stopAgentStream: (threadId?: string) => Promise<void>
  onAgentChunk: (callback: (chunk: { type: string; payload: any }) => void) => () => void
  getAvailableModels: () => Promise<{ gemini?: string; gemma?: string }>

  getConversationId: () => Promise<string>
  newConversation: () => Promise<{ conversationId: string }>
  getThreads: () => Promise<ThreadEntry[]>
  getThreadMessages: (threadId: string) => Promise<ThreadMessage[]>
  deleteThread: (threadId: string) => Promise<boolean>
  getThreadWorkspace: (threadId: string) => Promise<string | null>
  getUniqueWorkspaces: () => Promise<string[]>
  setActiveWorkspace: (conversationId: string, workspacePath: string) => Promise<any>
  closeAndDeleteWorkspace: (workspacePath: string) => Promise<boolean>
  generateTitle: (text: string, threadId: string) => Promise<string | null>

  listArtifacts: (conversationId: string) => Promise<ArtifactEntry[]>
  readFile: (filePath: string, conversationId?: string) => Promise<any>
  writeFile: (filePath: string, content: string, conversationId?: string) => Promise<boolean>
  onArtifactsChanged: (callback: (artifacts: ArtifactEntry[]) => void) => () => void

  createTerminal: (opts: { cols: number; rows: number; cwd?: string }) => Promise<{ id: string }>
  terminalInput: (opts: { id: string; data: string }) => Promise<void>
  terminalResize: (opts: { id: string; cols: number; rows: number }) => Promise<void>
  closeTerminal: (opts: { id: string }) => Promise<void>
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void
  onTerminalExit: (callback: (payload: { id: string; exitCode: number }) => void) => () => void

  openBrowser: (opts: { url: string; bounds: { x: number; y: number; width: number; height: number } }) => Promise<void>
  navigateBrowser: (url: string) => Promise<void>
  browserBack: () => Promise<void>
  browserForward: () => Promise<void>
  browserReload: () => Promise<void>
  resizeBrowser: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  closeBrowser: () => Promise<void>
  onBrowserTitleUpdated: (callback: (title: string) => void) => () => void
  onBrowserUrlChanged: (callback: (url: string) => void) => () => void

  showConfirmDialog: (opts: { message: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number }) => Promise<number>

  getUpdateStatus: () => Promise<UpdateStatus>
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
  openMacRelease: () => Promise<void>
  onUpdateStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
  getAppVersion: () => Promise<string>

  startGoogleAuth: () => Promise<UserProfile | null>
  logout: () => Promise<boolean>
  getAuthUser: () => Promise<UserProfile | null>
  onAuthStatusChanged: (callback: (user: UserProfile | null) => void) => () => void
}

declare global {
  interface Window {
    api: AppAPI
  }
}
