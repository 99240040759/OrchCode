import 'dotenv/config'
import crypto from 'node:crypto'
import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import {
  clearWorkspaceContext,
  getOrCreateWorkspaceContext,
  updateWorkspacePath
} from './workspace'
import { getThreads, getThread, getThreadMessages, deleteThread, getThreadWorkspace, getActiveThreadId, setActiveThreadId } from './db'
import WindowManager from './windowManager'
import { getConversationPath } from './paths'
import {
  parseAssistantMessageData,
  parseUserMessageData,
  serializeMessageData
} from './agent/schema'

export function registerThreadIpc() {
  ipcMain.handle('mastra:get-conversation-id', () => {
    try {
      const activeId = getActiveThreadId()
      if (activeId) {
        const thread = getThread(activeId)
        if (thread) return activeId
      }
      const threads = getThreads()
      if (threads && threads.length > 0) {
        return threads[0].id
      }
    } catch (err) {
      log.error('[main] get-conversation-id error:', err)
    }
    return ''
  })

  ipcMain.handle('session:set-active', async (_event, threadId: string) => {
    try {
      setActiveThreadId(threadId)
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
      return getThreadMessages(threadId).map((message) => {
        const parsed =
          message.role === 'assistant'
            ? parseAssistantMessageData(message.data)
            : message.role === 'user'
              ? parseUserMessageData(message.data)
              : undefined
        return {
          ...message,
          data: parsed ? serializeMessageData(parsed) : undefined
        }
      })
    } catch (err) {
      log.error('[main] getThreadMessages:', err)
      return []
    }
  })

  ipcMain.handle('mastra:delete-thread', async (_event, threadId: string) => {
    try {
      const activeId = getActiveThreadId()
      if (activeId === threadId) {
        setActiveThreadId(null)
      }
      const workspacePath = getThreadWorkspace(threadId)
      const context = clearWorkspaceContext(threadId)
      const deleted = deleteThread(threadId)
      if (!workspacePath && context?.isUserWorkspace !== true) {
        await fs.rm(getConversationPath(threadId), {
          recursive: true,
          force: true
        })
      }
      return deleted
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
      const mainWindow = WindowManager.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) return opts.cancelId ?? 0
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
