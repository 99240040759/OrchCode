import 'dotenv/config'
import crypto from 'node:crypto'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import log from 'electron-log'
import { getOrCreateWorkspaceContext, updateWorkspacePath } from './workspace'
import {
  getThreads,
  getThread,
  getThreadMessages,
  deleteThread,
  getThreadWorkspace
} from './db'

export function registerThreadIpc() {
  ipcMain.handle('mastra:get-conversation-id', () => {
    return `session-${crypto.randomUUID()}`
  })

  ipcMain.handle('session:set-active', async (_event, threadId: string) => {
    try {
      const wsPath = getThreadWorkspace(threadId)
      if (wsPath) await updateWorkspacePath(threadId, wsPath)
    } catch (err) {
      log.warn(`[main] Failed to auto-bind workspace for session ${threadId}:`, err)
    }
    return true
  })

  ipcMain.handle('mastra:new-conversation', async () => {
    const newId = `session-${crypto.randomUUID()}`
    await getOrCreateWorkspaceContext(newId)
    log.info(`[main] New conversation: ${newId}`)
    return { conversationId: newId }
  })

  ipcMain.handle('mastra:get-threads', async () => {
    try {
      return await getThreads()
    } catch (err) {
      log.error('[main] getThreads:', err)
      return []
    }
  })

  ipcMain.handle('mastra:get-thread-messages', async (_event, threadId: string) => {
    try {
      return await getThreadMessages(threadId)
    } catch (err) {
      log.error('[main] getThreadMessages:', err)
      return []
    }
  })

  ipcMain.handle('mastra:delete-thread', async (_event, threadId: string) => {
    try {
      return await deleteThread(threadId)
    } catch (err) {
      log.error('[main] deleteThread:', err)
      return false
    }
  })

  ipcMain.handle('mastra:get-thread-workspace', async (_event, threadId: string) => {
    try {
      return getThreadWorkspace(threadId)
    } catch {
      return null
    }
  })

  ipcMain.handle('mastra:get-thread', async (_event, threadId: string) => {
    try {
      return getThread(threadId)
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'dialog:confirm',
    async (
      _event,
      opts: {
        message: string
        detail?: string
        buttons?: string[]
        defaultId?: number
        cancelId?: number
      }
    ) => {
      const mainWindow = (globalThis as unknown as { mainWindow?: BrowserWindow }).mainWindow
      if (!mainWindow) return null
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: opts.buttons || ['Cancel', 'OK'],
        defaultId: opts.defaultId ?? 1,
        cancelId: opts.cancelId ?? 0,
        message: opts.message,
        detail: opts.detail ?? ''
      })
      return result.response
    }
  )
}
