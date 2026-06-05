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
import { startBrowserAgentWorker, stopBrowserAgentWorker } from '../tools'
import { getCurrentUpdateStatus, triggerUpdateCheck, triggerInstall } from '../updater'
import { startGoogleAuth, getAuthUser, logoutUser } from '../auth'
import pty from 'node-pty'


// ─── Schema primitives ───────────────────────────────────────────────────────

const threadIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9-_]+$/, 'Invalid thread ID format')

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

// ─── PTY state ───────────────────────────────────────────────────────────────

const activePtys = new Map<string, ReturnType<typeof pty.spawn>>()
const activePtyOwners = new Map<string, number>()

export function cleanupAllPtys() {
  activePtys.forEach((p) => {
    try {
      if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT')
      else p.kill()
    } catch {
      try { p.kill() } catch {}
    }
  })
  activePtys.clear()
  activePtyOwners.clear()
}

// ─── Browser helper ──────────────────────────────────────────────────────────

function normalizeBrowserUrl(value: string): string {
  const candidate = value.trim()
  if (!candidate || candidate === 'about:blank') return 'about:blank'
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  const parsed = new URL(withProtocol)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported browser URL protocol: ${parsed.protocol}`)
  }
  return parsed.toString()
}

function normalizeBounds(bounds: { x: number; y: number; width: number; height: number }) {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!values.every(Number.isFinite)) throw new Error('Browser bounds must be finite numbers.')
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  }
}

// ─── Command registry ────────────────────────────────────────────────────────

type CommandHandler = {
  schema: z.ZodTypeAny
  execute: (payload: any, event: Electron.IpcMainInvokeEvent) => Promise<unknown> | unknown
}

const commands: Record<string, CommandHandler> = {

  // ── Agent ──────────────────────────────────────────────────────────────────

  'agent:stop': {
    schema: z.object({ threadId: threadIdSchema.optional() }),
    execute: ({ threadId }) => {
      if (threadId) {
        const ctrl = activeAbortControllers.get(threadId)
        if (ctrl) { ctrl.abort(); activeAbortControllers.delete(threadId) }
      } else {
        activeAbortControllers.forEach((c) => c.abort())
        activeAbortControllers.clear()
      }
    }
  },

  'models:list': {
    schema: z.object({}),
    execute: () => getAvailableModels()
  },

  'artifacts:list': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: ({ conversationId }) => listArtifacts(conversationId)
  },

  'thread:generate-title': {
    schema: z.object({ text: z.string().max(5000), threadId: threadIdSchema }),
    execute: async ({ text, threadId }) => {
      try {
        const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/generate-title`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        })
        if (!response.ok) throw new Error(`Failed to generate title: ${response.statusText}`)
        const data = await response.json()
        const title = data.title?.trim() ?? null
        if (title) await updateThreadTitle(threadId, title)
        return title
      } catch (err) {
        log.error('[commands] Title generation error:', err)
        return null
      }
    }
  },

  // ── Threads ────────────────────────────────────────────────────────────────

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

  'thread:new': {
    schema: z.object({}),
    execute: async () => {
      const newId = `session-${crypto.randomUUID()}`
      await getOrCreateWorkspaceContext(newId)
      log.info(`[commands] New conversation: ${newId}`)
      return { conversationId: newId }
    }
  },

  'thread:set-active': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }) => {
      try {
        setActiveThreadId(threadId)
        const wsPath = getThreadWorkspace(threadId)
        if (wsPath) await updateWorkspacePath(threadId, wsPath)
      } catch (err) {
        log.warn(`[commands] Failed to auto-bind workspace for session ${threadId}:`, err)
      }
      return true
    }
  },

  'thread:list': {
    schema: z.object({}),
    execute: async () => {
      try { return await getThreads() }
      catch (err) { log.error('[commands] getThreads:', err); return [] }
    }
  },

  'thread:get': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: ({ threadId }) => {
      try { return getThread(threadId) }
      catch { return null }
    }
  },

  'thread:messages': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: ({ threadId }) => {
      try {
        return getThreadMessages(threadId).map((message) => {
          const parsed =
            message.role === 'assistant'
              ? parseAssistantMessageData(message.data)
              : message.role === 'user'
                ? parseUserMessageData(message.data)
                : undefined
          return { ...message, data: parsed ? serializeMessageData(parsed) : undefined }
        })
      } catch (err) { log.error('[commands] getThreadMessages:', err); return [] }
    }
  },

  'thread:delete': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }) => {
      try {
        const activeId = getActiveThreadId()
        if (activeId === threadId) setActiveThreadId(null)
        const workspacePath = getThreadWorkspace(threadId)
        const context = clearWorkspaceContext(threadId)
        const deleted = deleteThread(threadId)
        if (!workspacePath && context?.isUserWorkspace !== true) {
          await fs.rm(getConversationPath(threadId), { recursive: true, force: true })
        }
        return deleted
      } catch (err) { log.error('[commands] deleteThread:', err); return false }
    }
  },

  'thread:workspace': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: ({ threadId }) => {
      try { return getThreadWorkspace(threadId) }
      catch { return null }
    }
  },

  // ── Workspace ──────────────────────────────────────────────────────────────

  'workspace:select': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: async ({ conversationId }, event) => {
      if (!conversationId) throw new Error('conversationId is required')
      const mainWindow = WindowManager.getMainWindow()
      const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.fromWebContents(event.sender)!, {
        title: 'Select Workspace Folder',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return null
      const selectedPath = result.filePaths[0]
      addOpenedWorkspace(selectedPath)
      const ctx = await updateWorkspacePath(conversationId, selectedPath)
      try { setThreadWorkspace(conversationId, selectedPath) }
      catch (err) { log.warn('[commands] Could not bind thread to workspace:', err) }
      log.info(`[commands] Workspace updated to: ${selectedPath}`)
      return ctx
    }
  },

  'workspace:set-active': {
    schema: z.object({ conversationId: convIdSchema, workspacePath: z.string().min(1) }),
    execute: async ({ conversationId, workspacePath }) => {
      if (!conversationId) throw new Error('conversationId is required')
      const ctx = await updateWorkspacePath(conversationId, workspacePath)
      addOpenedWorkspace(workspacePath)
      try { setThreadWorkspace(conversationId, workspacePath) }
      catch (err) { log.warn('[commands] Could not bind thread to workspace:', err) }
      return ctx
    }
  },

  'workspace:list-files': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: async ({ conversationId }) => {
      if (!conversationId) throw new Error('conversationId is required')
      const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
      if (!ctx?.rootPath) return []
      try { return await listWorkspaceFiles(ctx.rootPath) }
      catch (err) { log.error('[commands] Error listing workspace files:', err); return [] }
    }
  },

  'workspace:close-and-delete': {
    schema: z.object({ workspacePath: z.string().min(1) }),
    execute: async ({ workspacePath }) => {
      try {
        deleteOpenedWorkspace(workspacePath)
        const affectedThreadIds = await deleteWorkspaceThreads(workspacePath)
        for (const threadId of affectedThreadIds) {
          clearWorkspaceContext(threadId)
          const targetDir = getConversationPath(threadId)
          try { await fs.rm(targetDir, { recursive: true, force: true }) }
          catch (err) { log.warn(`[commands] Could not purge directory ${targetDir}:`, err) }
        }
        return true
      } catch (err) { log.error('[commands] workspace:close-and-delete error:', err); return false }
    }
  },

  // ── Files ──────────────────────────────────────────────────────────────────

  'file:read': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema }),
    execute: async ({ filePath, conversationId }) => {
      try {
        const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
        const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId)
        const stat = await fs.stat(safePath)
        if (stat.size > MAX_FILE_READ_BYTES) throw new Error('File exceeds the 25 MB preview limit.')
        const rawBuffer = await fs.readFile(safePath)
        const filename = safePath.split(/[/\\]/).pop() ?? ''
        const ext = extname(safePath).toLowerCase()
        const binary = isFileBinary(safePath, rawBuffer)
        if (binary) {
          return { name: filename, path: safePath, isBinary: true, mimeType: getMimeType(safePath), base64: rawBuffer.toString('base64') }
        }
        return { name: filename, path: safePath, isBinary: false, content: rawBuffer.toString('utf-8'), language: EXT_TO_LANGUAGE[ext] || 'plaintext' }
      } catch (err: any) { log.error('[commands] file:read error:', err); throw err }
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
        const workspaceRoot = ctx.rootPath
        let relativePath = safePath.startsWith(workspaceRoot) ? safePath.slice(workspaceRoot.length) : safePath
        if (relativePath.startsWith('/') || relativePath.startsWith('\\')) relativePath = relativePath.slice(1)
        const gitRelativePath = relativePath.replace(/\\/g, '/')
        try {
          const { stdout } = await execa('git', ['show', `HEAD:${gitRelativePath}`], { cwd: workspaceRoot, timeout: 5000, reject: true, shell: false })
          return { content: stdout }
        } catch {
          try { return { content: await fs.readFile(safePath, 'utf-8') } }
          catch { return { content: '' } }
        }
      } catch (err: any) {
        log.error('[commands] file:read-original error:', err)
        if (err.message?.includes('Path traversal')) throw err
        return { content: '' }
      }
    }
  },

  // ── Dialog ─────────────────────────────────────────────────────────────────

  'dialog:confirm': {
    schema: z.object({
      message: z.string().max(1000),
      detail: z.string().max(2000).optional(),
      buttons: z.array(z.string().max(100)).max(5).optional(),
      defaultId: z.number().int().optional(),
      cancelId: z.number().int().optional()
    }),
    execute: async (opts, event) => {
      const mainWindow = WindowManager.getMainWindow()
      const win = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : BrowserWindow.fromWebContents(event.sender)
      if (!win) return opts.cancelId ?? 0
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: opts.buttons || ['Cancel', 'OK'],
        defaultId: opts.defaultId ?? 1,
        cancelId: opts.cancelId ?? 0,
        message: opts.message,
        detail: opts.detail ?? ''
      })
      return result.response
    }
  },

  // ── Updater ────────────────────────────────────────────────────────────────

  'updater:get-status': {
    schema: z.object({}),
    execute: () => getCurrentUpdateStatus()
  },

  'app:get-version': {
    schema: z.object({}),
    execute: () => app.getVersion()
  },

  'updater:check': {
    schema: z.object({}),
    execute: () => { triggerUpdateCheck() }
  },

  'updater:install': {
    schema: z.object({}),
    execute: () => { triggerInstall() }
  },

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

  // ── Auth ──────────────────────────────────────────────────────────────────

  'auth:get-user': {
    schema: z.object({}),
    execute: () => getAuthUser()
  },

  'auth:login': {
    schema: z.object({}),
    execute: () => startGoogleAuth()
  },

  'auth:logout': {
    schema: z.object({}),
    execute: () => logoutUser()
  },

  'auth:open-onboarding': {
    schema: z.object({}),
    execute: () => { app.emit('auth:open-main-and-close-onboarding') }
  },

  // ── Terminal ───────────────────────────────────────────────────────────────

  'terminal:create': {
    schema: z.object({
      cols: z.number().int().min(10).max(500),
      rows: z.number().int().min(3).max(200),
      cwd: z.string().optional(),
      conversationId: z.string().optional()   // may be '' when no thread selected yet
    }),
    execute: (opts, event) => {
      const id = `pty-${crypto.randomUUID()}`
      const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')
      const convCtx = opts.conversationId ? getWorkspaceContext(opts.conversationId) : undefined
      const workingDir = convCtx
        ? opts.cwd ? assertWithinWorkspace(convCtx.rootPath, opts.cwd, opts.conversationId) : convCtx.rootPath
        : process.env.HOME || process.cwd()

      log.info(`[terminal] Spawning ${shell} in ${workingDir} (${opts.cols}x${opts.rows})`)

      let ptyProcess: ReturnType<typeof pty.spawn>
      try {
        ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: Math.max(opts.cols, 10),
          rows: Math.max(opts.rows, 3),
          cwd: workingDir,
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        })
      } catch (err: any) {
        log.error('[terminal:create] Failed to spawn PTY shell:', err)
        throw new Error(`Failed to initialize shell process: ${err.message}`)
      }

      activePtys.set(id, ptyProcess)
      activePtyOwners.set(id, event.sender.id)

      let dataListener: ReturnType<ReturnType<typeof pty.spawn>['onData']> | undefined
      const destroyListener = () => {
        try {
          if (dataListener) dataListener.dispose()
          if (process.platform !== 'win32') process.kill(-ptyProcess.pid, 'SIGINT')
          else ptyProcess.kill()
        } catch { try { ptyProcess.kill() } catch {} }
        activePtys.delete(id)
        activePtyOwners.delete(id)
      }
      event.sender.once('destroyed', destroyListener)

      dataListener = ptyProcess.onData((data) => {
        if (event.sender.isDestroyed()) { destroyListener(); event.sender.off('destroyed', destroyListener); return }
        try { event.sender.send('terminal:data', { id, data }) } catch {}
      })

      ptyProcess.onExit(({ exitCode }) => {
        event.sender.off('destroyed', destroyListener)
        activePtys.delete(id)
        activePtyOwners.delete(id)
        try { event.sender.send('terminal:exit', { id, exitCode }) } catch {}
        log.info(`[terminal] PTY ${id} exited with code ${exitCode}`)
      })

      return { id }
    }
  },

  'terminal:input': {
    schema: z.object({ id: z.string().min(1), data: z.string().max(65536) }),
    execute: ({ id, data }, event) => {
      try {
        if (activePtyOwners.get(id) !== event.sender.id) return
        activePtys.get(id)?.write(data)
      } catch (err) { log.error(`[terminal:input] error writing to ${id}:`, err) }
    }
  },

  'terminal:resize': {
    schema: z.object({
      id: z.string().min(1),
      cols: z.number().int().min(10).max(500),
      rows: z.number().int().min(3).max(200)
    }),
    execute: ({ id, cols, rows }, event) => {
      try {
        if (activePtyOwners.get(id) !== event.sender.id) return
        const p = activePtys.get(id)
        if (p) p.resize(Math.max(cols, 10), Math.max(rows, 3))
      } catch (err) { log.error(`[terminal:resize] error resizing ${id}:`, err) }
    }
  },

  'terminal:close': {
    schema: z.object({ id: z.string().min(1) }),
    execute: ({ id }, event) => {
      if (activePtyOwners.get(id) !== event.sender.id) return
      const p = activePtys.get(id)
      if (p) {
        try {
          if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT')
          else p.kill()
        } catch { try { p.kill() } catch {} }
        activePtys.delete(id)
        activePtyOwners.delete(id)
      }
    }
  },

  // ── Browser ────────────────────────────────────────────────────────────────

  'browser:open': {
    schema: z.object({
      url: z.string().min(1),
      bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    }),
    execute: async ({ url, bounds }, event) => {
      const mainWindow = WindowManager.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window is not available.')

      let browserView = WindowManager.getBrowserView()
      if (browserView) {
        browserView.setBounds(normalizeBounds(bounds))
        await browserView.webContents.loadURL(normalizeBrowserUrl(url))
        return
      }

      browserView = new WebContentsView({
        webPreferences: { webSecurity: true, nodeIntegration: false, contextIsolation: true, sandbox: true }
      })
      WindowManager.setBrowserView(browserView)
      mainWindow.contentView.addChildView(browserView)
      browserView.setBounds(normalizeBounds(bounds))
      await browserView.webContents.loadURL(normalizeBrowserUrl(url || 'https://google.com'))

      browserView.webContents.on('page-title-updated', (_e, title) => {
        try { event.sender.send('browser:title-updated', title) } catch {}
      })
      const onNavigate = (_e: any, navUrl: string) => {
        try { event.sender.send('browser:url-changed', navUrl) } catch {}
        try { const w = startBrowserAgentWorker(); if (w) w.syncUrl(navUrl).catch(() => {}) } catch {}
      }
      browserView.webContents.on('did-navigate', onNavigate)
      browserView.webContents.on('did-navigate-in-page', onNavigate)

      log.info(`[browser] Opened: ${url}`)
      startBrowserAgentWorker()
    }
  },

  'browser:navigate': {
    schema: z.object({ url: z.string().min(1) }),
    execute: ({ url }) => {
      const bv = WindowManager.getBrowserView()
      if (!bv) throw new Error('Browser panel is not open.')
      return bv.webContents.loadURL(normalizeBrowserUrl(url))
    }
  },

  'browser:back': {
    schema: z.object({}),
    execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoBack()) bv.webContents.goBack() }
  },

  'browser:forward': {
    schema: z.object({}),
    execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoForward()) bv.webContents.goForward() }
  },

  'browser:reload': {
    schema: z.object({}),
    execute: () => { WindowManager.getBrowserView()?.webContents.reload() }
  },

  'browser:resize': {
    schema: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    execute: (bounds) => { WindowManager.getBrowserView()?.setBounds(normalizeBounds(bounds)) }
  },

  'browser:close': {
    schema: z.object({}),
    execute: async () => {
      const mainWindow = WindowManager.getMainWindow()
      const bv = WindowManager.getBrowserView()
      if (bv && mainWindow) {
        try { mainWindow.contentView.removeChildView(bv); bv.webContents.close() } catch {}
      }
      WindowManager.setBrowserView(null)
      await stopBrowserAgentWorker()
      log.info('[browser] Closed')
    }
  }
}

// ─── Router registration ─────────────────────────────────────────────────────

export function registerAllIpc() {
  ipcMain.handle('api:invoke', async (event, { command, payload }) => {
    const handler = commands[command]
    if (!handler) {
      log.warn(`[router] Unknown command: ${command}`)
      throw new Error(`Unknown command: ${command}`)
    }
    const parsed = handler.schema.parse(payload ?? {})
    return handler.execute(parsed, event)
  })

  log.info(`[router] Registered ${Object.keys(commands).length} commands on api:invoke`)
}
