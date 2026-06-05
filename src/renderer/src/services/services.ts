import type { ThreadEntry, ThreadMessage } from '../../../preload/index.d'
import type { WorkspaceContext } from '../../../preload/index.d'

export const threadService = {
  getConversationId: async (): Promise<string> => {
    try { return await window.threadsBridge.getConversationId() }
    catch (err) { console.error('[threadService] getConversationId failed:', err); throw err }
  },
  newConversation: async (): Promise<{ conversationId: string }> => {
    try { return await window.threadsBridge.newConversation() }
    catch (err) { console.error('[threadService] newConversation failed:', err); throw err }
  },
  getThreads: async (): Promise<ThreadEntry[]> => {
    try { return await window.threadsBridge.getThreads() }
    catch (err) { console.error('[threadService] getThreads failed:', err); throw err }
  },
  getThread: async (threadId: string): Promise<(ThreadEntry & { workspacePath?: string | null }) | null> => {
    try { return await window.threadsBridge.getThread(threadId) }
    catch (err) { console.error(`[threadService] getThread(${threadId}) failed:`, err); throw err }
  },
  getThreadMessages: async (threadId: string): Promise<ThreadMessage[]> => {
    try { return await window.threadsBridge.getThreadMessages(threadId) }
    catch (err) { console.error(`[threadService] getThreadMessages(${threadId}) failed:`, err); throw err }
  },
  deleteThread: async (threadId: string): Promise<boolean> => {
    try { return await window.threadsBridge.deleteThread(threadId) }
    catch (err) { console.error(`[threadService] deleteThread(${threadId}) failed:`, err); throw err }
  },
  getThreadWorkspace: async (threadId: string): Promise<string | null> => {
    try { return await window.threadsBridge.getThreadWorkspace(threadId) }
    catch (err) { console.error(`[threadService] getThreadWorkspace(${threadId}) failed:`, err); throw err }
  },
  generateTitle: async (text: string, threadId: string): Promise<string | null> => {
    try { return await window.threadsBridge.generateTitle(text, threadId) }
    catch (err) { console.error(`[threadService] generateTitle failed:`, err); throw err }
  },
  setActiveSession: async (threadId: string): Promise<boolean> => {
    try { return await window.threadsBridge.setActiveSession(threadId) }
    catch (err) { console.error(`[threadService] setActiveSession(${threadId}) failed:`, err); throw err }
  }
}

export const workspaceService = {
  selectWorkspace: async (conversationId: string): Promise<WorkspaceContext | null> => {
    try { return await window.workspaceBridge.selectWorkspace(conversationId) }
    catch (err) { console.error(`[workspaceService] selectWorkspace failed for thread ${conversationId}:`, err); throw err }
  },
  setActiveWorkspace: async (conversationId: string, workspacePath: string): Promise<any> => {
    try { return await window.workspaceBridge.setActiveWorkspace(conversationId, workspacePath) }
    catch (err) { console.error(`[workspaceService] setActiveWorkspace failed:`, err); throw err }
  },
  closeAndDeleteWorkspace: async (workspacePath: string): Promise<boolean> => {
    try { return await window.workspaceBridge.closeAndDeleteWorkspace(workspacePath) }
    catch (err) { console.error(`[workspaceService] closeAndDeleteWorkspace failed:`, err); throw err }
  },
  listWorkspaceFiles: async (conversationId: string): Promise<string[]> => {
    try { return await window.workspaceBridge.listWorkspaceFiles(conversationId) }
    catch (err) { console.error(`[workspaceService] listWorkspaceFiles failed:`, err); throw err }
  },
  readFile: async (filePath: string, conversationId?: string): Promise<any> => {
    try { return await window.workspaceBridge.readFile(filePath, conversationId) }
    catch (err) { console.error(`[workspaceService] readFile failed for ${filePath}:`, err); throw err }
  },
  readOriginalFile: async (filePath: string, conversationId?: string): Promise<any> => {
    try { return await window.workspaceBridge.readOriginalFile(filePath, conversationId) }
    catch (err) { console.error(`[workspaceService] readOriginalFile failed for ${filePath}:`, err); throw err }
  }
}
