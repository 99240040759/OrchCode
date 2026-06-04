import type { WorkspaceContext } from '../../../preload/index.d'

export const workspaceService = {
  selectWorkspace: async (conversationId: string): Promise<WorkspaceContext | null> => {
    try {
      return await window.workspaceBridge.selectWorkspace(conversationId)
    } catch (err) {
      console.error(`[workspaceService] selectWorkspace failed for thread ${conversationId}:`, err)
      throw err
    }
  },

  setActiveWorkspace: async (conversationId: string, workspacePath: string): Promise<any> => {
    try {
      return await window.workspaceBridge.setActiveWorkspace(conversationId, workspacePath)
    } catch (err) {
      console.error(`[workspaceService] setActiveWorkspace failed:`, err)
      throw err
    }
  },

  closeAndDeleteWorkspace: async (workspacePath: string): Promise<boolean> => {
    try {
      return await window.workspaceBridge.closeAndDeleteWorkspace(workspacePath)
    } catch (err) {
      console.error(`[workspaceService] closeAndDeleteWorkspace failed:`, err)
      return false
    }
  },

  listWorkspaceFiles: async (conversationId: string): Promise<string[]> => {
    try {
      return await window.workspaceBridge.listWorkspaceFiles(conversationId)
    } catch (err) {
      console.error(`[workspaceService] listWorkspaceFiles failed:`, err)
      return []
    }
  },

  readFile: async (filePath: string, conversationId?: string): Promise<any> => {
    try {
      return await window.workspaceBridge.readFile(filePath, conversationId)
    } catch (err) {
      console.error(`[workspaceService] readFile failed for ${filePath}:`, err)
      throw err
    }
  },

  readOriginalFile: async (filePath: string, conversationId?: string): Promise<any> => {
    try {
      return await window.workspaceBridge.readOriginalFile(filePath, conversationId)
    } catch (err) {
      console.error(`[workspaceService] readOriginalFile failed for ${filePath}:`, err)
      throw err
    }
  }
}
