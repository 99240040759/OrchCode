import 'dotenv/config'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { ipcMain, dialog, app, BrowserWindow, WebContentsView } from 'electron'
import log from 'electron-log'
import { z } from 'zod'
import {
  getOrCreateWorkspaceContext,
  updateWorkspacePath,
  getWorkspaceContext,
  assertWithinWorkspace,
  listWorkspaceFiles,
  isFileBinary,
  getMimeType,
  clearWorkspaceContext
} from '../workspace'
import {
  addOpenedWorkspace,
  setThreadWorkspace,
  deleteOpenedWorkspace,
  deleteWorkspaceThreads,
  getThreads,
  getThread,
  getThreadMessages,
  deleteThread,
  getThreadWorkspace,
  getActiveThreadId,
  setActiveThreadId,
  updateThreadTitle
} from '../db'
import {
  parseAssistantMessageData,
  parseUserMessageData,
  serializeMessageData
} from '../agent/schema'
import { getAvailableModels } from '../agent/models'
import { activeAbortControllers } from '../agent/stream'
import { listArtifacts } from '../agent/artifacts'
import { getConversationPath } from '../paths'
import WindowManager from '../windowManager'
import { getCurrentUpdateStatus, triggerUpdateCheck, triggerInstall } from '../updater'
import { startGoogleAuth, getAuthUser, logoutUser, getCurrentSession } from '../auth'
import pty from 'node-pty'

const threadIdSchema = z.string().min(1).max(256).regex(/^[a-zA-Z0-9-_]+$/, 'Invalid format')
const convIdSchema = z.string().min(1).max(256)

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.css': 'css', '.html': 'html', '.md': 'markdown', '.py': 'python',
  '.rs': 'rust', '.go': 'go', '.sh': 'shell', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin',
  '.gradle': 'groovy', '.properties': 'properties', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php'
}

const MAX_FILE_READ_BYTES = 25 * 1024 * 1024
const activePtys = new Map<string, ReturnType<typeof pty.spawn>>()
const activePtyOwners = new Map<string, number>()

export function cleanupAllPtys() {
  activePtys.forEach(p => { try { if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT'); else p.kill() } catch { try { p.kill() } catch {} } })
  activePtys.clear(); activePtyOwners.clear()
}

function normalizeBrowserUrl(val: string): string {
  const c = val.trim()
  if (!c || c === 'about:blank') return 'about:blank'
  const parsed = new URL(/^https?:\/\//i.test(c) ? c : `https://${c}`)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Unsupported protocol: ${parsed.protocol}`)
  return parsed.toString()
}

function normalizeBounds(b: { x: number; y: number; width: number; height: number }) {
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) throw new Error('Bounds must be finite.')
  return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) }
}

type CommandHandler = {
  schema: z.ZodTypeAny
  execute: (payload: any, event: Electron.IpcMainInvokeEvent) => Promise<unknown> | unknown
}

const commands: Record<string, CommandHandler> = {
  'agent:stop': {
    schema: z.object({ threadId: threadIdSchema.optional() }),
    execute: ({ threadId }) => {
      if (threadId) {
        const ctrl = activeAbortControllers.get(threadId)
        if (ctrl) { ctrl.abort(); activeAbortControllers.delete(threadId) }
      } else {
        activeAbortControllers.forEach(c => c.abort())
        activeAbortControllers.clear()
      }
    }
  },
  'models:list': { schema: z.object({}), execute: () => getAvailableModels() },
  'artifacts:list': { schema: z.object({ conversationId: convIdSchema }), execute: ({ conversationId }) => listArtifacts(conversationId) },
  'thread:generate-title': {
    schema: z.object({ text: z.string().max(5000), threadId: threadIdSchema }),
    execute: async ({ text, threadId }) => {
      try {
        const session = getCurrentSession()
        const token = session?.idToken
        if (!token) throw new Error('Unauthenticated: Please sign in to generate titles.')
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')

        const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/generate-title`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text })
        })
        if (!response.ok) throw new Error(`Failed to generate title: ${response.statusText}`)
        const data = await response.json()
        const title = data.title?.trim() ?? null
        if (title) await updateThreadTitle(threadId, title)
        return title
      } catch (err) { log.error('[commands] Title generation error:', err); return null }
    }
  },
  'thread:active-id': {
    schema: z.object({}),
    execute: () => {
      try {
        const activeId = getActiveThreadId()
        if (activeId && getThread(activeId)) return activeId
        const threads = getThreads()
        return threads?.length ? threads[0].id : ''
      } catch { return '' }
    }
  },
  'thread:new': { schema: z.object({}), execute: async () => { const newId = `session-${crypto.randomUUID()}`; await getOrCreateWorkspaceContext(newId); return { conversationId: newId } } },
  'thread:set-active': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }) => {
      try { setActiveThreadId(threadId); const wsPath = getThreadWorkspace(threadId); if (wsPath) await updateWorkspacePath(threadId, wsPath) }
      catch (err) { log.warn(`[commands] Auto-bind error for ${threadId}:`, err) }
      return true
    }
  },
  'thread:list': { schema: z.object({}), execute: async () => { try { return await getThreads() } catch (err) { log.error('[commands] getThreads:', err); return [] } } },
  'thread:get': { schema: z.object({ threadId: threadIdSchema }), execute: ({ threadId }) => { try { return getThread(threadId) } catch { return null } } },
  'thread:messages': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: ({ threadId }) => {
      try {
        return getThreadMessages(threadId).map((message) => {
          const parsed = message.role === 'assistant' ? parseAssistantMessageData(message.data) : message.role === 'user' ? parseUserMessageData(message.data) : undefined
          return { ...message, data: parsed ? serializeMessageData(parsed) : undefined }
        })
      } catch (err) { log.error('[commands] getThreadMessages:', err); return [] }
    }
  },
  'thread:delete': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }) => {
      try {
        if (getActiveThreadId() === threadId) setActiveThreadId(null)
        const wsPath = getThreadWorkspace(threadId)
        const context = clearWorkspaceContext(threadId)
        const deleted = deleteThread(threadId)
        if (!wsPath && context?.isUserWorkspace !== true) await fs.rm(getConversationPath(threadId), { recursive: true, force: true })
        return deleted
      } catch (err) { log.error('[commands] deleteThread:', err); return false }
    }
  },
  'thread:workspace': { schema: z.object({ threadId: threadIdSchema }), execute: ({ threadId }) => { try { return getThreadWorkspace(threadId) } catch { return null } } },
  'workspace:select': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: async ({ conversationId }, event) => {
      if (!conversationId) throw new Error('conversationId is required')
      const win = WindowManager.getMainWindow() || BrowserWindow.fromWebContents(event.sender)!
      const result = await dialog.showOpenDialog(win, { title: 'Select Workspace Folder', properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths[0]) return null
      const selectedPath = result.filePaths[0]
      addOpenedWorkspace(selectedPath)
      const ctx = await updateWorkspacePath(conversationId, selectedPath)
      try { setThreadWorkspace(conversationId, selectedPath) } catch (err) { log.warn('[commands] Could not bind workspace:', err) }
      return ctx
    }
  },
  'workspace:set-active': {
    schema: z.object({ conversationId: convIdSchema, workspacePath: z.string().min(1) }),
    execute: async ({ conversationId, workspacePath }) => {
      if (!conversationId) throw new Error('conversationId is required')
      const ctx = await updateWorkspacePath(conversationId, workspacePath)
      addOpenedWorkspace(workspacePath)
      try { setThreadWorkspace(conversationId, workspacePath) } catch (err) { log.warn('[commands] Could not bind workspace:', err) }
      return ctx
    }
  },
  'workspace:list-files': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: async ({ conversationId }) => {
      if (!conversationId) throw new Error('conversationId is required')
      const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
      if (!ctx?.rootPath) return []
      try { return await listWorkspaceFiles(ctx.rootPath) } catch (err) { log.error('[commands] listFiles error:', err); return [] }
    }
  },
  'workspace:close-and-delete': {
    schema: z.object({ workspacePath: z.string().min(1) }),
    execute: async ({ workspacePath }) => {
      try {
        deleteOpenedWorkspace(workspacePath)
        const affected = await deleteWorkspaceThreads(workspacePath)
        for (const tid of affected) {
          clearWorkspaceContext(tid)
          try { await fs.rm(getConversationPath(tid), { recursive: true, force: true }) } catch {}
        }
        return true
      } catch (err) { log.error('[commands] close-and-delete error:', err); return false }
    }
  },
  'file:read': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema }),
    execute: async ({ filePath, conversationId }) => {
      const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
      const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId)
      const stat = await fs.stat(safePath)
      if (stat.size > MAX_FILE_READ_BYTES) throw new Error('File exceeds 25 MB limit.')
      const rawBuffer = await fs.readFile(safePath)
      const filename = safePath.split(/[/\\]/).pop() ?? ''
      const ext = extname(safePath).toLowerCase()
      if (isFileBinary(safePath, rawBuffer)) {
        return { name: filename, path: safePath, isBinary: true, mimeType: getMimeType(safePath), base64: rawBuffer.toString('base64') }
      }
      return { name: filename, path: safePath, isBinary: false, content: rawBuffer.toString('utf-8'), language: EXT_TO_LANGUAGE[ext] || 'plaintext' }
    }
  },
  'file:read-original': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema.optional() }),
    execute: async ({ filePath, conversationId }) => {
      if (!conversationId) return { content: '' }
      try {
        const { execa } = await import('execa')
        const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
        const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId)
        const relativePath = safePath.startsWith(ctx.rootPath) ? safePath.slice(ctx.rootPath.length).replace(/^[/\\]/, '') : safePath
        const gitPath = relativePath.replace(/\\/g, '/')
        try {
          const { stdout } = await execa('git', ['show', `HEAD:${gitPath}`], { cwd: ctx.rootPath, timeout: 5000, reject: true, shell: false })
          return { content: stdout }
        } catch {
          try { return { content: await fs.readFile(safePath, 'utf-8') } } catch { return { content: '' } }
        }
      } catch (err: any) {
        log.error('[commands] file:read-original error:', err)
        if (err.message?.includes('Path traversal')) throw err
        return { content: '' }
      }
    }
  },
  'dialog:confirm': {
    schema: z.object({ message: z.string().max(1000), detail: z.string().max(2000).optional(), buttons: z.array(z.string().max(100)).max(5).optional(), defaultId: z.number().int().optional(), cancelId: z.number().int().optional() }),
    execute: async (opts, event) => {
      const win = WindowManager.getMainWindow() || BrowserWindow.fromWebContents(event.sender)
      if (!win) return opts.cancelId ?? 0
      const result = await dialog.showMessageBox(win, { type: 'question', buttons: opts.buttons || ['Cancel', 'OK'], defaultId: opts.defaultId ?? 1, cancelId: opts.cancelId ?? 0, message: opts.message, detail: opts.detail ?? '' })
      return result.response
    }
  },
  'updater:get-status': { schema: z.object({}), execute: () => getCurrentUpdateStatus() },
  'app:get-version': { schema: z.object({}), execute: () => app.getVersion() },
  'updater:check': { schema: z.object({}), execute: () => { triggerUpdateCheck() } },
  'updater:install': { schema: z.object({}), execute: () => { triggerInstall() } },
  'updater:open-mac-release': {
    schema: z.object({}),
    execute: async () => {
      if (process.platform === 'darwin') {
        const { shell } = await import('electron')
        await shell.openExternal('https://github.com/sameer786ss/OrchCode/releases/latest')
        app.quit()
      }
    }
  },
  'auth:get-user': { schema: z.object({}), execute: () => getAuthUser() },
  'auth:login': { schema: z.object({}), execute: () => startGoogleAuth() },
  'auth:logout': { schema: z.object({}), execute: () => logoutUser() },
  'auth:open-onboarding': { schema: z.object({}), execute: () => { app.emit('auth:open-main-and-close-onboarding') } },
  'terminal:create': {
    schema: z.object({ cols: z.number().int().min(10).max(500), rows: z.number().int().min(3).max(200), cwd: z.string().optional(), conversationId: z.string().optional() }),
    execute: (opts, event) => {
      const id = `pty-${crypto.randomUUID()}`
      const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')
      const convCtx = opts.conversationId ? getWorkspaceContext(opts.conversationId) : undefined
      const workingDir = convCtx ? (opts.cwd ? assertWithinWorkspace(convCtx.rootPath, opts.cwd, opts.conversationId!) : convCtx.rootPath) : process.env.HOME || process.cwd()
      let ptyProcess: any
      try {
        ptyProcess = pty.spawn(shell, [], { name: 'xterm-256color', cols: Math.max(opts.cols, 10), rows: Math.max(opts.rows, 3), cwd: workingDir, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
      } catch (err: any) {
        log.error('[terminal:create] Failed to spawn:', err)
        throw new Error(`Spawn failed: ${err.message}`)
      }
      activePtys.set(id, ptyProcess); activePtyOwners.set(id, event.sender.id)
      let dataListener: any
      const destroyListener = () => {
        try {
          if (dataListener) dataListener.dispose()
          if (process.platform !== 'win32') process.kill(-ptyProcess.pid, 'SIGINT')
          else ptyProcess.kill()
        } catch { try { ptyProcess.kill() } catch {} }
        activePtys.delete(id); activePtyOwners.delete(id)
      }
      event.sender.once('destroyed', destroyListener)
      dataListener = ptyProcess.onData((data: string) => {
        if (event.sender.isDestroyed()) { destroyListener(); event.sender.off('destroyed', destroyListener); return }
        try { event.sender.send('terminal:data', { id, data }) } catch {}
      })
      ptyProcess.onExit(({ exitCode }: any) => {
        event.sender.off('destroyed', destroyListener)
        activePtys.delete(id); activePtyOwners.delete(id)
        try { event.sender.send('terminal:exit', { id, exitCode }) } catch {}
      })
      return { id }
    }
  },
  'terminal:input': {
    schema: z.object({ id: z.string().min(1), data: z.string().max(65536) }),
    execute: ({ id, data }, event) => { if (activePtyOwners.get(id) === event.sender.id) activePtys.get(id)?.write(data) }
  },
  'terminal:resize': {
    schema: z.object({ id: z.string().min(1), cols: z.number().int().min(10).max(500), rows: z.number().int().min(3).max(200) }),
    execute: ({ id, cols, rows }, event) => { if (activePtyOwners.get(id) === event.sender.id) activePtys.get(id)?.resize(Math.max(cols, 10), Math.max(rows, 3)) }
  },
  'terminal:close': {
    schema: z.object({ id: z.string().min(1) }),
    execute: ({ id }, event) => {
      if (activePtyOwners.get(id) !== event.sender.id) return
      const p = activePtys.get(id)
      if (p) {
        try { if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT'); else p.kill() } catch { try { p.kill() } catch {} }
        activePtys.delete(id); activePtyOwners.delete(id)
      }
    }
  },
  'browser:open': {
    schema: z.object({ url: z.string().min(1), bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), conversationId: z.string().optional() }),
    execute: async ({ url, bounds, conversationId }, event) => {
      const mainWindow = WindowManager.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window not available.')
      let bv = WindowManager.getBrowserView()
      if (bv && (bv as any).conversationId !== conversationId) {
        try { mainWindow.contentView.removeChildView(bv); bv.webContents.close() } catch {}
        bv = null; WindowManager.setBrowserView(null)
      }
      if (bv) { bv.setBounds(normalizeBounds(bounds)); await bv.webContents.loadURL(normalizeBrowserUrl(url)); return }
      const partition = conversationId ? `persist:conversation_${conversationId}` : undefined
      bv = new WebContentsView({ webPreferences: { webSecurity: true, nodeIntegration: false, contextIsolation: true, sandbox: true, partition } })
      ;(bv as any).conversationId = conversationId
      WindowManager.setBrowserView(bv); mainWindow.contentView.addChildView(bv); bv.setBounds(normalizeBounds(bounds))
      await bv.webContents.loadURL(normalizeBrowserUrl(url || 'https://google.com'))
      bv.webContents.on('page-title-updated', (_e, title) => { try { event.sender.send('browser:title-updated', title) } catch {} })
      const onNavigate = (_e: any, navUrl: string) => { try { event.sender.send('browser:url-changed', navUrl) } catch {} }
      bv.webContents.on('did-navigate', onNavigate); bv.webContents.on('did-navigate-in-page', onNavigate)
    }
  },
  'browser:navigate': { schema: z.object({ url: z.string().min(1) }), execute: ({ url }) => { const bv = WindowManager.getBrowserView(); if (!bv) throw new Error('Browser closed.'); return bv.webContents.loadURL(normalizeBrowserUrl(url)) } },
  'browser:back': { schema: z.object({}), execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoBack()) bv.webContents.goBack() } },
  'browser:forward': { schema: z.object({}), execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoForward()) bv.webContents.goForward() } },
  'browser:reload': { schema: z.object({}), execute: () => { WindowManager.getBrowserView()?.webContents.reload() } },
  'browser:resize': { schema: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), execute: (bounds) => { WindowManager.getBrowserView()?.setBounds(normalizeBounds(bounds)) } },
  'browser:close': {
    schema: z.object({}),
    execute: () => {
      const win = WindowManager.getMainWindow()
      const bv = WindowManager.getBrowserView()
      if (bv && win) { try { win.contentView.removeChildView(bv); bv.webContents.close() } catch {} }
      WindowManager.setBrowserView(null)
    }
  }
}

export function registerAllIpc() {
  ipcMain.handle('api:invoke', async (event, { command, payload }) => {
    const handler = commands[command]
    if (!handler) throw new Error(`Unknown command: ${command}`)
    const parsed = handler.schema.parse(payload ?? {})
    return handler.execute(parsed, event)
  })
  log.info(`[router] Registered ${Object.keys(commands).length} commands on api:invoke`)
}
