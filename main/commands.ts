import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, relative, join, isAbsolute } from 'node:path'
import { app, BrowserWindow, dialog, WebContentsView, utilityProcess, MessageChannelMain, ipcMain, nativeTheme, shell } from 'electron'
import { execa } from 'execa'
import log from 'electron-log'
import { z } from 'zod'

import { startGoogleAuth, getAuthUser, logoutUser, requireAuthToken, authEvents } from './auth'
import WindowManager from './utils'
import { getCurrentUpdateStatus, triggerUpdateCheck, triggerInstall } from './updater'
import { getAvailableModels } from './models'
import { listArtifacts, getConversationPath, getApiBaseUrl } from './utils'
import { pool } from './workerPool'
import {
  getOrCreateWorkspaceContext, updateWorkspacePath, getWorkspaceContext,
  assertWithinWorkspace, listWorkspaceFiles, isFileBinary, getMimeType,
  clearWorkspaceContext
} from './workspace'
import {
  updateThreadTitle, getActiveThreadId, getThread, getThreads, setActiveThreadId,
  getThreadMessages, deleteThread, getThreadWorkspace, createThread,
  deleteOpenedWorkspace, deleteWorkspaceThreads, addOpenedWorkspace, setThreadWorkspace
} from './db'
import { parseAssistantMessageData, parseUserMessageData, serializeMessageData } from './schema'
import { MAX_FILE_READ_BYTES } from './tools'

const threadIdSchema = z.string().min(1).max(256).regex(/^[a-zA-Z0-9-_]+$/, 'Invalid format')
const convIdSchema = z.string().min(1).max(256)

function resolveCommandPath(ctx: any, filePath: string): string {
  const norm = filePath.replace(/\\/g, '/'), clean = (norm.startsWith('/') && !norm.match(/^\/[a-zA-Z]:/)) ? norm.slice(1) : norm
  const normArt = ctx.artifactsPath.replace(/\\/g, '/'), win = process.platform === 'win32'
  if (isAbsolute(clean)) {
    const m = clean.match(/\/conversations\/(session-[a-zA-Z0-9-_]+)\/artifacts\//i)
    if (m) {
      const art = join(getConversationPath(m[1]), 'artifacts'), nArt = art.replace(/\\/g, '/')
      if (win ? clean.toLowerCase().startsWith(nArt.toLowerCase()) : clean.startsWith(nArt)) return assertWithinWorkspace(art, clean)
    }
    const isArt = win ? clean.toLowerCase().startsWith(normArt.toLowerCase()) : clean.startsWith(normArt)
    return assertWithinWorkspace(isArt ? ctx.artifactsPath : ctx.rootPath, clean)
  }
  if (clean.startsWith('artifacts/') || clean.startsWith('./artifacts/')) return assertWithinWorkspace(ctx.artifactsPath, clean.replace(/^\.?\/??artifacts\//, ''))
  return assertWithinWorkspace(ctx.rootPath, clean)
}

// --- Terminal (PTY) State & Helpers ---
const activePtys = new Map<string, any>()
const activePtyOwners = new Map<string, number>()
const activePtyConversations = new Map<string, string>()
const destroyListeners = new Map<string, () => void>()

export function cleanupAllPtys() {
  activePtys.forEach((child) => {
    try { child.kill('SIGTERM') } catch (err) { log.debug('[terminal] SIGTERM error:', err) }
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 1000)
  })
  activePtys.clear()
  activePtyOwners.clear()
  activePtyConversations.clear()
  destroyListeners.clear()
}

export function cleanupPtysForThread(threadId: string) {
  activePtyConversations.forEach((convId, id) => {
    if (convId === threadId) {
      const child = activePtys.get(id)
      if (child) {
        try { child.kill('SIGTERM') } catch (err) { log.debug('[terminal] SIGTERM error:', err) }
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 1000)
        activePtys.delete(id); activePtyOwners.delete(id)
      }
      activePtyConversations.delete(id)
    }
  })
}

// --- Browser Helpers ---
function removeBrowserView(win: BrowserWindow, bv: WebContentsView) {
  try { win.contentView.removeChildView(bv) } catch (err) { console.debug('[browser] Remove view error:', err) }
}
function normalizeBrowserUrl(val: string): string {
  const c = val.trim()
  if (!c || c === 'about:blank') return 'about:blank'
  const hasSpace = /\s/.test(c), hasDot = c.includes('.'), isLocal = c.startsWith('localhost') || c.includes('localhost:')
  if (hasSpace || (!hasDot && !isLocal && !/^https?:\/\//i.test(c))) return `https://www.google.com/search?q=${encodeURIComponent(c)}`
  try {
    const parsed = new URL(/^https?:\/\//i.test(c) ? c : `https://${c}`)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Unsupported protocol: ${parsed.protocol}`)
    return parsed.toString()
  } catch { return `https://www.google.com/search?q=${encodeURIComponent(c)}` }
}
function normalizeBounds(b: { x: number; y: number; width: number; height: number }) {
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) throw new Error('Bounds must be finite.')
  return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) }
}

// --- Workspace Helpers ---
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.css': 'css', '.html': 'html', '.md': 'markdown', '.py': 'python',
  '.rs': 'rust', '.go': 'go', '.sh': 'shell', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin',
  '.gradle': 'groovy', '.properties': 'properties', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php'
}

// --- Thread Helpers ---
export async function deleteThreadData(threadId: string): Promise<boolean> {
  if (await getActiveThreadId() === threadId) await setActiveThreadId(null)
  pool.killJob(`stream:${threadId}`); cleanupPtysForThread(threadId)
  clearWorkspaceContext(threadId); const deleted = await deleteThread(threadId)
  await fs.rm(getConversationPath(threadId), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  return deleted
}

export const ipcCommands = {
  // Theme Commands
  'theme:get': { schema: z.object({}), execute: () => ({ dark: nativeTheme.shouldUseDarkColors, systemUI: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI }) },
  // Auth Commands
  'auth:get-user': { schema: z.object({}), execute: () => getAuthUser() },
  'auth:login': { schema: z.object({}), execute: () => startGoogleAuth() },
  'auth:logout': { schema: z.object({}), execute: () => logoutUser() },
  'auth:complete-onboarding': { schema: z.object({}), execute: () => { authEvents.emit('open-main-and-close-onboarding') } },
  'dialog:confirm': {
    schema: z.object({ message: z.string().max(1000), detail: z.string().max(2000).optional(), buttons: z.array(z.string().max(100)).max(5).optional(), defaultId: z.number().int().optional(), cancelId: z.number().int().optional() }),
    execute: async (opts: any, event: any) => {
      const win = WindowManager.getMainWindow() || BrowserWindow.fromWebContents(event.sender)
      if (!win) return opts.cancelId ?? 0
      const result = await dialog.showMessageBox(win, { type: 'question', buttons: opts.buttons || ['Cancel', 'OK'], defaultId: opts.defaultId ?? 1, cancelId: opts.cancelId ?? 0, message: opts.message, detail: opts.detail ?? '' })
      return result.response
    }
  },

  // Updater Commands
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
        setTimeout(() => app.quit(), 500)
      }
    }
  },

  // Thread Commands
  'models:list': { schema: z.object({}), execute: () => getAvailableModels() },
  'artifacts:list': { schema: z.object({ conversationId: convIdSchema }), execute: ({ conversationId }: any) => listArtifacts(conversationId) },
  'thread:generate-title': {
    schema: z.object({ text: z.string().max(5000), threadId: threadIdSchema }),
    execute: async ({ text, threadId }: any) => {
      try {
        const token = requireAuthToken()
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')
        const headers = { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' }
        const response = await fetch(`${getApiBaseUrl()}/generate-title`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text }),
        })
        if (!response.ok) throw new Error(`Failed to generate title: ${response.statusText}`)
        const data = await response.json(), title = data.title?.trim() ?? null
        if (title) await updateThreadTitle(threadId, title)
        return title
      } catch (err) { log.error('[commands] Title generation error:', err); throw err }
    }
  },
  'thread:active-id': {
    schema: z.object({}),
    execute: async () => {
      const activeId = await getActiveThreadId()
      if (activeId && await getThread(activeId)) return activeId
      return null
    }
  },
  'thread:new': {
    schema: z.object({ workspacePath: z.string().nullable().optional() }),
    execute: async ({ workspacePath }: any) => {
      const newId = `session-${crypto.randomUUID()}`
      await createThread(newId, workspacePath ?? null)
      await getOrCreateWorkspaceContext(newId)
      return { conversationId: newId }
    }
  },
  'thread:set-active': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }: any) => {
      try { await setActiveThreadId(threadId); const wsPath = await getThreadWorkspace(threadId); if (wsPath) await updateWorkspacePath(threadId, wsPath) }
      catch (err) { log.warn(`[commands] Auto-bind error for ${threadId}:`, err); throw err }
      return true
    }
  },
  'thread:list': { schema: z.object({}), execute: async () => { try { return await getThreads() } catch (err) { log.error('[commands] getThreads:', err); throw err } } },
  'thread:get': { schema: z.object({ threadId: threadIdSchema }), execute: async ({ threadId }: any) => { try { return await getThread(threadId) } catch (err) { throw err } } },
  'thread:messages': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }: any) => {
      try {
        return (await getThreadMessages(threadId)).map((message) => {
          const parsed = message.role === 'assistant' ? parseAssistantMessageData(message.data) : message.role === 'user' ? parseUserMessageData(message.data) : undefined
          return { ...message, data: parsed ? serializeMessageData(parsed) : undefined }
        })
      } catch (err) { log.error('[commands] getThreadMessages:', err); throw err }
    }
  },
  'thread:delete': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }: any) => {
      try { return await deleteThreadData(threadId) }
      catch (err) { log.error('[commands] deleteThread:', err); throw err }
    }
  },
  'thread:workspace': { schema: z.object({ threadId: threadIdSchema }), execute: async ({ threadId }: any) => { try { return await getThreadWorkspace(threadId) } catch (err) { throw err } } },

  // Workspace Commands
  'workspace:select': {
    schema: z.object({ conversationId: convIdSchema }),
    execute: async ({ conversationId }: any, event: any) => {
      if (!conversationId) throw new Error('conversationId is required')
      const win = WindowManager.getMainWindow() || BrowserWindow.fromWebContents(event.sender)!
      const result = await dialog.showOpenDialog(win, { title: 'Select Workspace Folder', properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths[0]) return null
      const selectedPath = result.filePaths[0]
      try { await addOpenedWorkspace(selectedPath); await setThreadWorkspace(conversationId, selectedPath); app.addRecentDocument(selectedPath) } catch (err) { log.error('[commands] Could not bind workspace:', err); throw err }
      const ctx = await updateWorkspacePath(conversationId, selectedPath)
      return ctx
    }
  },
  'workspace:set-active': {
    schema: z.object({ conversationId: convIdSchema, workspacePath: z.string().min(1) }),
    execute: async ({ conversationId, workspacePath }: any) => {
      if (!conversationId) throw new Error('conversationId is required')
      try { await addOpenedWorkspace(workspacePath); await setThreadWorkspace(conversationId, workspacePath); app.addRecentDocument(workspacePath) } catch (err) { log.error('[commands] Could not bind workspace:', err); throw err }
      const ctx = await updateWorkspacePath(conversationId, workspacePath)
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
        await deleteOpenedWorkspace(workspacePath)
        const affected = await deleteWorkspaceThreads(workspacePath)
        for (const tid of affected) await deleteThreadData(tid)
        return true
      } catch (err) { log.error('[commands] close-and-delete error:', err); throw err }
    }
  },
  'file:read': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema }),
    execute: async ({ filePath, conversationId }: any) => {
      const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
      const safePath = resolveCommandPath(ctx, filePath), stat = await fs.stat(safePath)
      if (stat.isDirectory()) throw new Error('Cannot read a directory as a file.')
      if (stat.size > MAX_FILE_READ_BYTES) throw new Error('File exceeds 25 MB limit.')
      const rawBuffer = await fs.readFile(safePath), filename = safePath.split(/[/\\]/).pop() ?? '', ext = extname(safePath).toLowerCase()
      if (isFileBinary(safePath, rawBuffer)) return { name: filename, path: safePath, isBinary: true, mimeType: getMimeType(safePath), base64: rawBuffer.toString('base64') }
      return { name: filename, path: safePath, isBinary: false, content: rawBuffer.toString('utf-8'), language: EXT_TO_LANGUAGE[ext] || 'plaintext' }
    }
  },
  'file:read-original': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema }),
    execute: async ({ filePath, conversationId }: any) => {
      try {
        const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
        const safePath = resolveCommandPath(ctx, filePath)
        const relativePath = relative(ctx.rootPath, safePath)
        const gitPath = relativePath.replace(/\\/g, '/')
        const { stdout } = await execa('git', ['show', `HEAD:${gitPath}`], { cwd: ctx.rootPath, timeout: 5000, reject: true, shell: false })
        return { content: stdout }
      } catch (err: any) {
        if (err?.exitCode !== undefined) {
          throw new Error('No git history available for this file. Ensure the workspace is a git repository with at least one commit.')
        }
        log.error('[commands] file:read-original error:', err)
        throw err
      }
    }
  },
  'file:is-directory': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema }),
    execute: async ({ filePath, conversationId }: any) => {
      try {
        const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
        const safePath = resolveCommandPath(ctx, filePath)
        const stat = await fs.stat(safePath)
        return stat.isDirectory()
      } catch { return false }
    }
  },
  'file:open-path': {
    schema: z.object({ filePath: z.string().min(1), conversationId: convIdSchema }),
    execute: async ({ filePath, conversationId }: any) => {
      try {
        const ctx = getWorkspaceContext(conversationId) || (await getOrCreateWorkspaceContext(conversationId))
        const safePath = resolveCommandPath(ctx, filePath)
        await shell.openPath(safePath)
        return true
      } catch (err: any) { log.error('[commands] file:open-path error:', err.message); return false }
    }
  },

  // Terminal Commands
  'terminal:create': {
    schema: z.object({ id: z.string().optional(), cols: z.number().int().min(10).max(500), rows: z.number().int().min(3).max(200), cwd: z.string().optional(), conversationId: z.string().optional() }),
    execute: (opts: any, event: any) => {
      const id = opts.id || `pty-${crypto.randomUUID()}`
      const existing = activePtys.get(id)
      if (existing) {
        log.info(`[commands] Reconnecting PTY: ${id}`)
        const { port1, port2 } = new MessageChannelMain()
        event.sender.postMessage(`terminal:port:${id}`, null, [port2])
        existing.postMessage({ type: 'reconnect-port' }, [port1])
        activePtyOwners.set(id, event.sender.id)
        const destroyListener = () => { try { existing.kill() } catch {}; activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id); destroyListeners.delete(id) }
        const old = destroyListeners.get(id); if (old) event.sender.off('destroyed', old)
        destroyListeners.set(id, destroyListener); event.sender.once('destroyed', destroyListener)
        return { id }
      }
      const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')
      const convCtx = opts.conversationId ? getWorkspaceContext(opts.conversationId) : undefined
      const workingDir = convCtx ? (opts.cwd ? assertWithinWorkspace(convCtx.rootPath, opts.cwd) : convCtx.rootPath) : process.env.HOME || process.cwd()
      let ptyWorkerPath = join(__dirname, 'ptyWorker.js')
      const child = utilityProcess.fork(ptyWorkerPath, [], { stdio: 'inherit', env: { ...process.env, USER_DATA_PATH: app.getPath('userData'), RESOURCES_PATH: process.resourcesPath } })
      const { port1, port2 } = new MessageChannelMain()
      event.sender.postMessage(`terminal:port:${id}`, null, [port2])
      child.postMessage({ type: 'init-pty', cols: opts.cols, rows: opts.rows, cwd: workingDir, shell }, [port1])
      activePtys.set(id, child); activePtyOwners.set(id, event.sender.id)
      if (opts.conversationId) activePtyConversations.set(id, opts.conversationId)
      const destroyListener = () => { try { child.kill() } catch {}; activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id); destroyListeners.delete(id) }
      destroyListeners.set(id, destroyListener); event.sender.once('destroyed', destroyListener)
      child.once('exit', () => { event.sender.off('destroyed', destroyListener); activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id); destroyListeners.delete(id) })
      return { id }
    }
  },
  'terminal:close': {
    schema: z.object({ id: z.string().min(1) }),
    execute: ({ id }: any, event: any) => {
      if (activePtyOwners.get(id) !== event.sender.id) return
      const listener = destroyListeners.get(id)
      if (listener) { event.sender.off('destroyed', listener); destroyListeners.delete(id) }
      const child = activePtys.get(id)
      if (child) {
        try { child.kill('SIGTERM') } catch (err) { log.debug('[terminal] SIGTERM error:', err) }
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 1000)
        activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id)
      }
    }
  },

  // Browser Commands
  'browser:open': {
    schema: z.object({ url: z.string().min(1), bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), conversationId: z.string().optional() }),
    execute: async ({ url, bounds, conversationId }: any, event: any) => {
      const mainWindow = WindowManager.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window not available.')
      const activeId = conversationId || 'default'
      WindowManager.setBrowserConversationId(activeId)
      WindowManager.getAllBrowserViews().forEach((view, key) => { if (key !== activeId) removeBrowserView(mainWindow, view) })
      let bv = WindowManager.getBrowserViewForConversation(activeId)
      const setupListeners = (view: any, sender: any) => {
        view.webContents.removeAllListeners('page-title-updated'); view.webContents.removeAllListeners('did-navigate'); view.webContents.removeAllListeners('did-navigate-in-page'); view.webContents.removeAllListeners('dom-ready'); view.webContents.removeAllListeners('did-start-navigation')
        view.webContents.on('page-title-updated', (_e: any, title: string) => { try { sender.send('browser:title-updated', title) } catch (err) { console.debug('[browser] IPC send error:', err) } })
        const onNavigate = (_e: any, navUrl: string) => { try { sender.send('browser:url-changed', navUrl) } catch (err) { console.debug('[browser] IPC send error:', err) } }
        view.webContents.on('did-navigate', onNavigate); view.webContents.on('did-navigate-in-page', onNavigate)
        const injectId = () => { view.webContents.executeJavaScript(`window.__orchConversationId = "${activeId}"`).catch(() => {}) }
        const injectCursor = () => {
          view.webContents.executeJavaScript(`
            if (!document.getElementById('playwright-cursor')) {
              const dot = document.createElement('div');
              dot.id = 'playwright-cursor';
              Object.assign(dot.style, {
                position: 'absolute', width: '24px', height: '24px',
                pointerEvents: 'none', zIndex: '2147483647'
              });
              dot.innerHTML = \`
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="position: absolute; top: 0; left: 0;">
                  <path fill="black" stroke="white" stroke-width="1.5" d="M4,3 L15,14 L11,14 L15,21 L12.5,22 L8.5,15 L4,19 Z"/>
                </svg>
              \`;
              const p = document.body || document.documentElement;
              if (p) p.appendChild(dot);
              document.addEventListener('mousemove', (e) => {
                dot.style.left = e.pageX + 'px';
                dot.style.top = e.pageY + 'px';
              });
            }
          `).catch(() => {})
        }
        view.webContents.on('dom-ready', () => { injectId(); injectCursor() })
        view.webContents.on('did-start-navigation', injectId)
        injectId(); injectCursor()
      }
      if (bv) {
        bv.setBounds(normalizeBounds(bounds)); try { mainWindow.contentView.addChildView(bv) } catch (err) { console.debug('[browser] Add child view error:', err) }
        setupListeners(bv, event.sender)
        const curUrl = bv.webContents.getURL()
        if (curUrl === 'about:blank' || curUrl === '') {
          const targetUrl = normalizeBrowserUrl(url)
          await bv.webContents.loadURL(targetUrl)
        }
        return
      }
      const partition = conversationId ? `persist:conversation_${conversationId}` : undefined
      bv = new WebContentsView({ webPreferences: { webSecurity: true, nodeIntegration: false, contextIsolation: true, sandbox: true, partition } })
      WindowManager.setBrowserViewForConversation(activeId, bv); mainWindow.contentView.addChildView(bv); bv.setBounds(normalizeBounds(bounds))
      setupListeners(bv, event.sender)
      await bv.webContents.loadURL(normalizeBrowserUrl(url || 'https://google.com'))
    }
  },
  'browser:navigate': { schema: z.object({ url: z.string().min(1) }), execute: ({ url }: any) => { const bv = WindowManager.getBrowserView(); if (!bv) throw new Error('Browser closed.'); return bv.webContents.loadURL(normalizeBrowserUrl(url)) } },
  'browser:back': { schema: z.object({}), execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoBack()) bv.webContents.goBack() } },
  'browser:forward': { schema: z.object({}), execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoForward()) bv.webContents.goForward() } },
  'browser:reload': { schema: z.object({}), execute: () => { WindowManager.getBrowserView()?.webContents.reload() } },
  'browser:resize': { schema: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), execute: (bounds: any) => { WindowManager.getBrowserView()?.setBounds(normalizeBounds(bounds)) } },
  'browser:hide': { schema: z.object({}), execute: () => { const win = WindowManager.getMainWindow(), bv = WindowManager.getBrowserView(); if (bv && win) removeBrowserView(win, bv) } },
  'browser:close': {
    schema: z.object({}),
    execute: () => {
      const win = WindowManager.getMainWindow(), activeId = WindowManager.getBrowserConversationId()
      if (activeId) {
        const bv = WindowManager.getBrowserViewForConversation(activeId)
        if (bv) {
          if (win) removeBrowserView(win, bv)
          const hasActiveJob = Array.from((pool as any).activeJobs.values()).some((jobName: any) => jobName === `stream:${activeId}`)
          if (!hasActiveJob) WindowManager.setBrowserViewForConversation(activeId, null)
        }
      }
    }
  }
}

export function registerAllIpc() {
  ipcMain.handle('api:invoke', async (event, { command, payload }) => {
    const cmd = (ipcCommands as any)[command]
    if (!cmd) {
      log.error(`[ipc] Unknown command: ${command}`)
      throw new Error(`Unknown command: ${command}`)
    }
    try {
      const validatedPayload = cmd.schema ? cmd.schema.parse(payload ?? {}) : (payload ?? {})
      return await cmd.execute(validatedPayload, event)
    } catch (err: any) {
      log.error(`[ipc] Error in ${command}:`, err)
      throw err
    }
  })
}
