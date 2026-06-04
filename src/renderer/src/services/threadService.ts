import type { ThreadEntry, ThreadMessage } from '../../../preload/index.d'

export const threadService = {
  getConversationId: async (): Promise<string> => {
    try {
      return await window.threadsBridge.getConversationId()
    } catch (err) {
      console.error('[threadService] getConversationId failed:', err)
      throw err
    }
  },

  newConversation: async (): Promise<{ conversationId: string }> => {
    try {
      return await window.threadsBridge.newConversation()
    } catch (err) {
      console.error('[threadService] newConversation failed:', err)
      throw err
    }
  },

  getThreads: async (): Promise<ThreadEntry[]> => {
    try {
      return await window.threadsBridge.getThreads()
    } catch (err) {
      console.error('[threadService] getThreads failed:', err)
      return []
    }
  },

  getThread: async (threadId: string): Promise<(ThreadEntry & { workspacePath?: string | null }) | null> => {
    try {
      return await window.threadsBridge.getThread(threadId)
    } catch (err) {
      console.error(`[threadService] getThread(${threadId}) failed:`, err)
      return null
    }
  },

  getThreadMessages: async (threadId: string): Promise<ThreadMessage[]> => {
    try {
      return await window.threadsBridge.getThreadMessages(threadId)
    } catch (err) {
      console.error(`[threadService] getThreadMessages(${threadId}) failed:`, err)
      return []
    }
  },

  deleteThread: async (threadId: string): Promise<boolean> => {
    try {
      return await window.threadsBridge.deleteThread(threadId)
    } catch (err) {
      console.error(`[threadService] deleteThread(${threadId}) failed:`, err)
      return false
    }
  },

  getThreadWorkspace: async (threadId: string): Promise<string | null> => {
    try {
      return await window.threadsBridge.getThreadWorkspace(threadId)
    } catch (err) {
      console.error(`[threadService] getThreadWorkspace(${threadId}) failed:`, err)
      return null
    }
  },

  generateTitle: async (text: string, threadId: string): Promise<string | null> => {
    try {
      return await window.threadsBridge.generateTitle(text, threadId)
    } catch (err) {
      console.error(`[threadService] generateTitle failed:`, err)
      return null
    }
  },

  setActiveSession: async (threadId: string): Promise<boolean> => {
    try {
      return await window.threadsBridge.setActiveSession(threadId)
    } catch (err) {
      console.error(`[threadService] setActiveSession(${threadId}) failed:`, err)
      return false
    }
  }
}
