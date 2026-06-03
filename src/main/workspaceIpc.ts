import 'dotenv/config'
import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { ipcMain, dialog, app } from 'electron'
import log from 'electron-log'
import { execa } from 'execa'
import mime from 'mime-types'
import {
  getOrCreateWorkspaceContext,
  updateWorkspacePath,
  getWorkspaceContext,
  assertWithinWorkspace,
  listWorkspaceFiles
} from './workspace'
import {
  addOpenedWorkspace,
  setThreadWorkspace,
  deleteOpenedWorkspace,
  deleteWorkspaceThreads
} from './db'

export function registerWorkspaceIpc() {
  ipcMain.handle('workspace:select', async (_event, conversationId: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Select Workspace Folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null

    const selectedPath = result.filePaths[0]
    addOpenedWorkspace(selectedPath)
    const ctx = await updateWorkspacePath(conversationId, selectedPath)

    try {
      setThreadWorkspace(conversationId, selectedPath)
    } catch (err) {
      log.warn('[main] Could not bind thread to workspace:', err)
    }

    log.info(`[main] Workspace updated to: ${selectedPath}`)
    return ctx
  })

  ipcMain.handle('workspace:set-active', async (_event, { conversationId, workspacePath }) => {
    const ctx = await updateWorkspacePath(conversationId, workspacePath)
    addOpenedWorkspace(workspacePath)

    try {
      setThreadWorkspace(conversationId, workspacePath)
    } catch (err) {
      log.warn('[main] Could not bind thread to workspace:', err)
    }

    log.info(`[main] Workspace bound: conv=${conversationId} path=${workspacePath}`)
    return ctx
  })

  ipcMain.handle('workspace:list-files', async (_event, conversationId: string) => {
    const ctx =
      getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
    if (!ctx?.rootPath) return []
    try {
      return await listWorkspaceFiles(ctx.rootPath)
    } catch (err) {
      log.error('[main] Error listing workspace files:', err)
      return []
    }
  })

  ipcMain.handle('workspace:close-and-delete', async (_event, workspacePath: string) => {
    try {
      log.info(`[main] Closing and deleting all workspace data for: ${workspacePath}`)
      deleteOpenedWorkspace(workspacePath)
      const affectedThreadIds = await deleteWorkspaceThreads(workspacePath)

      for (const threadId of affectedThreadIds) {
        const targetDir = join(app.getPath('userData'), 'conversations', threadId)
        try {
          await fs.rm(targetDir, { recursive: true, force: true })
        } catch (err) {
          log.warn(`[main] Could not purge directory ${targetDir}:`, err)
        }
      }
      return true
    } catch (err) {
      log.error('[main] workspace:close-and-delete error:', err)
      return false
    }
  })

  ipcMain.handle('file:read', async (_event, filePath: string, conversationId?: string) => {
    try {
      const ctx =
        getWorkspaceContext(conversationId!) || (await getOrCreateWorkspaceContext(conversationId!))
      const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId)

      const rawBuffer = await fs.readFile(safePath)
      const isBinary = rawBuffer.subarray(0, 512).includes(0x00)
      const filename = safePath.split(/[/\\]/).pop() ?? ''
      const ext = extname(safePath).toLowerCase()

      const languages: Record<string, string> = {
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.json': 'json',
        '.css': 'css',
        '.html': 'html',
        '.md': 'markdown',
        '.py': 'python',
        '.rs': 'rust',
        '.go': 'go',
        '.sh': 'shell',
        '.yaml': 'yaml',
        '.yml': 'yaml'
      }

      if (isBinary) {
        return {
          name: filename,
          path: safePath,
          isBinary: true,
          mimeType: mime.lookup(safePath) || 'application/octet-stream',
          base64: rawBuffer.toString('base64')
        }
      }
      return {
        name: filename,
        path: safePath,
        isBinary: false,
        content: rawBuffer.toString('utf-8'),
        language: languages[ext] || 'plaintext'
      }
    } catch (err: any) {
      log.error('[main] file:read error:', err)
      throw err
    }
  })

  ipcMain.handle('file:read-original', async (_event, filePath: string, conversationId?: string) => {
    try {
      const ctx =
        getWorkspaceContext(conversationId!) || (await getOrCreateWorkspaceContext(conversationId!))
      const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId)
      const workspaceRoot = ctx.rootPath

      let relativePath = safePath
      if (relativePath.startsWith(workspaceRoot)) {
        relativePath = relativePath.slice(workspaceRoot.length)
      }
      if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
        relativePath = relativePath.slice(1)
      }

      const gitRelativePath = relativePath.replace(/\\/g, '/')

      try {
        const { stdout } = await execa('git', ['show', `HEAD:${gitRelativePath}`], {
          cwd: workspaceRoot,
          timeout: 5000,
          reject: true
        })
        return { content: stdout }
      } catch {
        try {
          const rawContent = await fs.readFile(safePath, 'utf-8')
          return { content: rawContent }
        } catch (err2) {
          return { content: '' }
        }
      }
    } catch (err: any) {
      log.error('[main] file:read-original error:', err)
      if (err.message && err.message.includes('Path traversal')) throw err
      return { content: '' }
    }
  })
}
