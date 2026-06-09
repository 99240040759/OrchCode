import { promises as fs } from 'node:fs'
import { extname, relative } from 'node:path'
import { execa } from 'execa'
import { dialog, BrowserWindow, app } from 'electron'
import log from 'electron-log'
import { z } from 'zod'
import {
  getOrCreateWorkspaceContext, updateWorkspacePath, getWorkspaceContext,
  assertWithinWorkspace, listWorkspaceFiles, isFileBinary, getMimeType, clearWorkspaceContext
} from './workspace'
import { addOpenedWorkspace, setThreadWorkspace, deleteOpenedWorkspace, deleteWorkspaceThreads } from './db'
import { getConversationPath } from './paths'
import WindowManager from './windowManager'
import { convIdSchema } from './threadCommands'
import { activeAbortControllers } from './stream'
import { pool } from './workerPool'
import { cleanupPtysForThread } from './terminalCommands'
import { MAX_FILE_READ_BYTES } from './fileTools'

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.css': 'css', '.html': 'html', '.md': 'markdown', '.py': 'python',
  '.rs': 'rust', '.go': 'go', '.sh': 'shell', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin',
  '.gradle': 'groovy', '.properties': 'properties', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php'
}


export const workspaceCommands = {
  'workspace:select': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: async ({ conversationId }: any, event: any) => {
      if (!conversationId) throw new Error('conversationId is required')
      const win = WindowManager.getMainWindow() || BrowserWindow.fromWebContents(event.sender)!
      const result = await dialog.showOpenDialog(win, { title: 'Select Workspace Folder', properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths[0]) return null
      const selectedPath = result.filePaths[0]
      addOpenedWorkspace(selectedPath); app.addRecentDocument(selectedPath)
      const ctx = await updateWorkspacePath(conversationId, selectedPath)
      try { setThreadWorkspace(conversationId, selectedPath) } catch (err) { log.error('[commands] Could not bind workspace:', err); throw err }
      return ctx
    }
  },
  'workspace:set-active': {
    schema: z.object({ conversationId: convIdSchema, workspacePath: z.string().min(1) }),
    execute: async ({ conversationId, workspacePath }: any) => {
      if (!conversationId) throw new Error('conversationId is required')
      const ctx = await updateWorkspacePath(conversationId, workspacePath)
      addOpenedWorkspace(workspacePath); app.addRecentDocument(workspacePath)
      try { setThreadWorkspace(conversationId, workspacePath) } catch (err) { log.error('[commands] Could not bind workspace:', err); throw err }
      return ctx
    }
  },
  'workspace:list-files': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: async ({ conversationId }: any) => {
      if (!conversationId) throw new Error('conversationId is required')
      const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
      if (!ctx?.rootPath) return []
      try { return await listWorkspaceFiles(ctx.rootPath) } catch (err) { log.error('[commands] listFiles error:', err); throw err }
    }
  },
  'workspace:close-and-delete': {
    schema: z.object({ workspacePath: z.string().min(1) }),
    execute: async ({ workspacePath }: any) => {
      try {
        deleteOpenedWorkspace(workspacePath)
        const affected = await deleteWorkspaceThreads(workspacePath)
        for (const tid of affected) {
          const ctrl = activeAbortControllers.get(tid)
          if (ctrl) { ctrl.abort(); activeAbortControllers.delete(tid) }
          pool.killJob(`stream:${tid}`); cleanupPtysForThread(tid)
          clearWorkspaceContext(tid)
          await new Promise(resolve => setTimeout(resolve, 200))
          await fs.rm(getConversationPath(tid), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
        return true
      } catch (err) { log.error('[commands] close-and-delete error:', err); throw err }
    }
  },
  'file:read': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema }),
    execute: async ({ filePath, conversationId }: any) => {
      const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
      const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId), stat = await fs.stat(safePath)
      if (stat.size > MAX_FILE_READ_BYTES) throw new Error('File exceeds 25 MB limit.')
      const rawBuffer = await fs.readFile(safePath), filename = safePath.split(/[/\\]/).pop() ?? '', ext = extname(safePath).toLowerCase()
      if (isFileBinary(safePath, rawBuffer)) return { name: filename, path: safePath, isBinary: true, mimeType: getMimeType(safePath), base64: rawBuffer.toString('base64') }
      return { name: filename, path: safePath, isBinary: false, content: rawBuffer.toString('utf-8'), language: EXT_TO_LANGUAGE[ext] || 'plaintext' }
    }
  },
  'file:read-original': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema.optional() }),
    execute: async ({ filePath, conversationId }: any) => {
      if (!conversationId) { try { return { content: await fs.readFile(filePath, 'utf-8') } } catch (fsErr) { log.error('[commands] disk read failed:', fsErr); throw fsErr } }
      try {
        const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
        const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId)
        const relativePath = relative(ctx.rootPath, safePath)
        const gitPath = relativePath.replace(/\\/g, '/')
        try {
          const { stdout } = await execa('git', ['show', `HEAD:${gitPath}`], { cwd: ctx.rootPath, timeout: 5000, reject: true, shell: false })
          return { content: stdout }
        } catch {
          try { return { content: await fs.readFile(safePath, 'utf-8') } } catch (fsErr) { log.error('[commands] git show and disk read failed:', fsErr); throw fsErr }
        }
      } catch (err: any) { log.error('[commands] file:read-original error:', err); throw err }
    }
  }
}
