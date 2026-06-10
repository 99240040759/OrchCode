import type { ThreadEntry, ThreadMessage, WorkspaceContext, FileReadResult, UserProfile } from '../../preload/index.d'

const invoke = <T>(command: string, payload?: unknown): Promise<T> =>
  window.api.invoke(command, payload) as Promise<T>

export const threadService = {
  getConversationId: () => invoke<string>('thread:active-id'),
  newConversation: (workspacePath?: string | null) => invoke<{ conversationId: string }>('thread:new', { workspacePath }),
  getThreads: () => invoke<ThreadEntry[]>('thread:list'),
  getThread: (threadId: string) => invoke<(ThreadEntry & { workspacePath?: string | null }) | null>('thread:get', { threadId }),
  getThreadMessages: (threadId: string) => invoke<ThreadMessage[]>('thread:messages', { threadId }),
  deleteThread: (threadId: string) => invoke<boolean>('thread:delete', { threadId }),
  getThreadWorkspace: (threadId: string) => invoke<string | null>('thread:workspace', { threadId }),
  generateTitle: (text: string, threadId: string) => invoke<string | null>('thread:generate-title', { text, threadId }),
  setActiveSession: (threadId: string) => invoke<boolean>('thread:set-active', { threadId })
}

export const workspaceService = {
  selectWorkspace: (conversationId: string) => invoke<WorkspaceContext | null>('workspace:select', { conversationId }),
  setActiveWorkspace: (conversationId: string, workspacePath: string) => invoke<WorkspaceContext>('workspace:set-active', { conversationId, workspacePath }),
  closeAndDeleteWorkspace: (workspacePath: string) => invoke<boolean>('workspace:close-and-delete', { workspacePath }),
  listWorkspaceFiles: (conversationId: string) => invoke<string[]>('workspace:list-files', { conversationId }),
  readFile: (filePath: string, conversationId: string) => invoke<FileReadResult>('file:read', { filePath, conversationId }),
  readOriginalFile: (filePath: string, conversationId?: string) => invoke<{ content: string }>('file:read-original', { filePath, conversationId })
}

export const authService = {
  startGoogleAuth: async (): Promise<UserProfile | null> => {
    try { return await invoke<UserProfile | null>('auth:login') }
    catch (err) { console.error('[authService] startGoogleAuth failed:', err); throw err }
  },
  logout: async (): Promise<boolean> => {
    try { return await invoke<boolean>('auth:logout') }
    catch (err) { console.error('[authService] logout failed:', err); throw err }
  },
  getAuthUser: async (): Promise<UserProfile | null> => {
    try { return await invoke<UserProfile | null>('auth:get-user') }
    catch (err) { console.error('[authService] getAuthUser failed:', err); throw err }
  },
  onAuthStatusChanged: (callback: (user: UserProfile | null) => void): (() => void) => {
    return window.api.on('auth:status-changed', (user) => {
      try { callback(user as UserProfile | null) }
      catch (err) { console.error('[authService] Error in auth status callback:', err); throw err }
    })
  }
}
