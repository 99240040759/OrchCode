process.env.AI_SDK_LOG_WARNINGS = 'true'
process.env.CLINE_LOG_LEVEL = 'info'
import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage, Menu } from 'electron'
import * as Sentry from '@sentry/electron/main'


let sentryInitialized = false
if (process.env.SENTRY_DSN && app.isPackaged) {
  Sentry.init({ dsn: process.env.SENTRY_DSN })
  sentryInitialized = true
}

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err)
  if (sentryInitialized) Sentry.captureException(err)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled rejection at:', promise, 'reason:', reason)
  if (sentryInitialized) Sentry.captureException(reason)
})

import type {
  AuthSession,
  StoredAuthSession,
  IpcArgs,
  IpcChannel,
  IpcResult,
  ModelConfig
} from '../shared/ipc-contracts'
import { join, basename, resolve } from 'path'
import { pathToFileURL } from 'url'
import { mkdir, readFile, unlink, cp, readdir, stat, realpath } from 'fs/promises'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { autoUpdater } from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../resources/icon.png?asset'
import type { ClineCore, CoreSessionEvent, Message } from '@cline/sdk'
import type { CoreSessionConfig } from '@cline/core'
import type { WorkspaceInfo, WorkspaceManifest } from '@cline/shared'
import { emptyWorkspaceManifest, upsertWorkspaceInfo } from '@cline/shared'
import { isPathAllowedPure, writeAtomic, serviceUrl } from './utils/fs'
import { registerBrowserWebContents, unregisterBrowserWebContents, getExtraTools } from './extraTools'
import { MAX_ATTACHMENTS } from '../shared/pathHelpers'
const MAX_VIEWABLE_FILE_BYTES = 5 * 1024 * 1024
const MAX_PROMPT_LENGTH = 200_000
const REQUEST_TIMEOUT_MS = 30_000
const MAX_USER_FILE_BYTES = 15 * 1024 * 1024
const MAX_TOTAL_USER_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024
const stripPrefix = (id: string): string =>
  id.includes('/') ? id.substring(id.indexOf('/') + 1) : id

app.name = 'OrchCode'
if (process.defaultApp) {
  if (process.argv.length >= 2)
    app.setAsDefaultProtocolClient('orchcode', process.execPath, [
      join(process.cwd(), process.argv[1])
    ])
} else {
  app.setAsDefaultProtocolClient('orchcode')
}
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const url = commandLine.find((arg) => arg.startsWith('orchcode://'))
    if (url) handleAuthCallback(url)
  })
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleAuthCallback(url)
})

app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (_event, webPreferences, _params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })
})

let _userData = ''
const userData = (): string => {
  if (!_userData) _userData = app.getPath('userData')
  return _userData
}
const encAuthPath = (): string => join(userData(), 'auth.enc')

function isAuthSession(value: unknown): value is StoredAuthSession {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as StoredAuthSession).accessToken === 'string' &&
    typeof (value as StoredAuthSession).refreshToken === 'string' &&
    typeof (value as StoredAuthSession).expiresAt === 'number' &&
    Number.isFinite((value as StoredAuthSession).expiresAt)
  )
}

async function _readEncryptedSession(): Promise<{ json: string } | undefined> {
  try {
    const p = encAuthPath()
    let raw: string
    try {
      raw = await readFile(p, 'utf-8')
    } catch (readErr: any) {
      if (readErr?.code === 'ENOENT') return undefined
      throw readErr
    }
    if (!raw) return undefined
    const buf = Buffer.from(raw, 'base64')
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
    return { json }
  } catch (err: unknown) {
    if (sentryInitialized) Sentry.captureException(err)
    return undefined
  }
}

async function saveAuthSession(session: StoredAuthSession): Promise<boolean> {
  try {
    await mkdir(userData(), { recursive: true })
    const json = JSON.stringify(session)
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json).toString('base64')
      : Buffer.from(json).toString('base64')
    await writeAtomic(encAuthPath(), data)
    return true
  } catch (err: unknown) {
    console.error('[Auth] Save error:', err)
    if (sentryInitialized) Sentry.captureException(err)
    return false
  }
}


async function getRawAuthSession(): Promise<StoredAuthSession | undefined> {
  const result = await _readEncryptedSession()
  if (!result) return undefined
  try {
    const session = JSON.parse(result.json)
    return isAuthSession(session) ? session : undefined
  } catch (err: unknown) {
    if (sentryInitialized) Sentry.captureException(err)
    return undefined
  }
}

function toPublicAuthSession(session: StoredAuthSession | undefined): AuthSession | undefined {
  if (!session) return undefined
  let user: AuthSession['user']
  try {
    const payloadPart = session.accessToken.split('.')[1]
    if (payloadPart) {
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as Record<string, unknown>
      const metadata = payload.user_metadata
      const data = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
      const email = typeof payload.email === 'string' ? payload.email : ''
      const name =
        typeof data.full_name === 'string'
          ? data.full_name
          : typeof data.name === 'string'
            ? data.name
            : email.includes('@')
              ? email.split('@')[0]
              : 'User'
      const avatarUrl =
        typeof data.avatar_url === 'string'
          ? data.avatar_url
          : typeof data.picture === 'string'
            ? data.picture
            : ''
      user = { name, email, avatarUrl }
    }
  } catch {
  }
  return { expiresAt: session.expiresAt, user }
}

async function clearAuthSession(): Promise<void> {
  try {
    try {
      await unlink(encAuthPath())
    } catch (unlinkErr: any) {
      if (unlinkErr?.code !== 'ENOENT') throw unlinkErr
    }
  } catch (err: unknown) {
    console.error('[Auth] Clear auth.enc failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
  }
}

interface AuthResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}
interface PendingAuthRequest {
  verifier: string
  expiresAt: number
}
const pendingAuthRequests = new Map<string, PendingAuthRequest>()

function clearExpiredAuthRequests(): void {
  const now = Date.now()
  for (const [state, request] of pendingAuthRequests)
    if (request.expiresAt <= now) pendingAuthRequests.delete(state)
}

async function acceptAuthResponse(data: AuthResponse): Promise<StoredAuthSession | undefined> {
  if (!data.access_token || !data.refresh_token) return undefined
  const expiresIn = data.expires_in
  const ttl = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600
  const session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() + Math.min(ttl, 60 * 60 * 24 * 30) * 1000)
  }
  if (!(await saveAuthSession(session))) return undefined
  cachedModels = undefined
  cachedModelsAt = 0
  sendToRenderer('auth:change', toPublicAuthSession(session))
  return session
}

async function exchangeAuthCode(code: string, verifier: string): Promise<StoredAuthSession | undefined> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return undefined
  const parsed = new URL(supabaseUrl)
  if (parsed.protocol !== 'https:') return undefined
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) return undefined
  return acceptAuthResponse((await response.json()) as AuthResponse)
}
let _refreshPromise: Promise<StoredAuthSession | undefined> | undefined = undefined
async function refreshAuthSessionIfNeeded(): Promise<StoredAuthSession | undefined> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = _doRefresh().finally(() => {
    _refreshPromise = undefined
  })
  return _refreshPromise
}
async function _doRefresh(): Promise<StoredAuthSession | undefined> {
  const session = await getRawAuthSession()
  if (!session || !session.refreshToken) return undefined
  if (session.expiresAt - Date.now() > 5 * 60 * 1000) return session
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return undefined
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        await clearAuthSession()
        cachedModels = undefined
        cachedModelsAt = 0
        sendToRenderer('auth:change', undefined)
      } else {
        sendToRenderer('auth:error', {
          message: 'Network error during token refresh. Please check your connection.'
        })
      }
      console.error('[Auth] Refresh failed:', response.status)
      return undefined
    }
    return acceptAuthResponse((await response.json()) as AuthResponse)
  } catch (err: unknown) {
    console.error('[Auth] Refresh error:', err)
    if (sentryInitialized) Sentry.captureException(err)
    sendToRenderer('auth:error', { message: 'Token refresh failed. Please try again.' })
    return undefined
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

async function handleAuthCallback(urlStr: string): Promise<void> {
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'orchcode:' || parsed.hostname !== 'auth-callback') return
    const params = new URLSearchParams(parsed.search)
    if (parsed.hash.length > 1)
      for (const [key, value] of new URLSearchParams(parsed.hash.slice(1))) params.set(key, value)
    const state = params.get('state')
    const code = params.get('code')
    if (!state || !code) return
    clearExpiredAuthRequests()
    const request = pendingAuthRequests.get(state)
    if (!request) return
    pendingAuthRequests.delete(state)
    await exchangeAuthCode(code, request.verifier)
  } catch (err: unknown) {
    console.error('[Auth] Deep link parse failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
  }
}

let cline: ClineCore | undefined
let mainWindow: BrowserWindow | undefined = undefined
let clineInitPromise: Promise<ClineCore> | undefined = undefined
let isQuitting = false
const activeClineSessions = new Set<string>()
const cancelledSessions = new Set<string>()

interface PortEntry {
  port: Electron.MessagePortMain
  unsub: () => void
}
const sessionPorts = new Map<string, PortEntry>()
const draftSessions = new Map<
  string,
  { title: string; workspacePath?: string; modelKey?: string; reasoningEffort?: string | null }
>()
const pendingQuestions = new Map<
  string,
  { resolve: (answer: string) => void; timer?: NodeJS.Timeout; sessionId: string }
>()

function unregisterSessionPort(sessionId: string, expected?: PortEntry): void {
  const entry = sessionPorts.get(sessionId)
  if (!entry || (expected && entry !== expected)) return
  sessionPorts.delete(sessionId)
  try {
    entry.unsub()
  } catch (err: unknown) {
    console.error('[SessionPort] unsubscribe failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
  }
  try {
    entry.port.close()
  } catch (err: unknown) {
    console.error('[SessionPort] close failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
  }
}

function unregisterAllSessionPorts(): void {
  for (const sessionId of Array.from(sessionPorts.keys())) unregisterSessionPort(sessionId)
}

const SYSTEM_PROMPT =
  'You are Orch AI, a premium AI coding assistant. Help developers plan, build, and debug software. You have access to filesystem tools: read, write, edit files, run terminal commands, search the web. Be precise, concise, and always prefer working code over explanations.'

function setupAutoUpdater(): void {
  const isMac = process.platform === 'darwin'
  autoUpdater.autoDownload = !isMac
  autoUpdater.setFeedURL({ provider: 'github', owner: 'sameer786ss', repo: 'OrchCode' })
  autoUpdater.on('checking-for-update', () =>
    sendToRenderer('update:status', { status: 'checking' })
  )
  autoUpdater.on('update-available', (info) =>
    sendToRenderer('update:status', {
      status: isMac ? 'mac-available' : 'available',
      version: info.version
    })
  )
  autoUpdater.on('update-not-available', () =>
    sendToRenderer('update:status', { status: 'not-available' })
  )
  autoUpdater.on('error', (err) => {
    if (sentryInitialized) Sentry.captureException(err)
    sendToRenderer('update:status', { status: 'error' })
  })
  autoUpdater.on('download-progress', () =>
    sendToRenderer('update:status', { status: 'downloading' })
  )
  autoUpdater.on('update-downloaded', (info) =>
    sendToRenderer('update:status', { status: 'downloaded', version: info.version })
  )
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

function isRendererUrl(value: string): boolean {
  try {
    if (is.dev) {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL
      if (!rendererUrl) return false
      const expected = new URL(rendererUrl)
      const actual = new URL(value)
      return actual.origin === expected.origin && actual.pathname === expected.pathname
    }
    return value === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
  } catch {
    return false
  }
}



const wpPath = (): string => join(userData(), 'workspaces.json')
async function loadManifest(): Promise<WorkspaceManifest> {
  try {
    let raw: string
    try {
      raw = await readFile(wpPath(), 'utf-8')
    } catch (readErr: any) {
      if (readErr?.code === 'ENOENT') return emptyWorkspaceManifest()
      throw readErr
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyWorkspaceManifest()
    const workspaces = (parsed as { workspaces?: unknown }).workspaces
    if (!workspaces || typeof workspaces !== 'object' || Array.isArray(workspaces))
      return emptyWorkspaceManifest()
    return parsed as WorkspaceManifest
  } catch (err: unknown) {
    console.error('[Workspaces] Load manifest failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
    return emptyWorkspaceManifest()
  }
}
async function saveManifest(manifest: WorkspaceManifest): Promise<void> {
  try {
    await writeAtomic(wpPath(), JSON.stringify(manifest))
  } catch (err: unknown) {
    console.error('[Workspaces] Save manifest failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
  }
}
let resolvedFoldersCache: string[] | null = null

async function getResolvedWorkspaceRoots(): Promise<string[]> {
  if (resolvedFoldersCache !== null) return resolvedFoldersCache
  try {
    const folders = await loadFolders()
    const resolved = await Promise.all(
      folders.map(async (folder) => {
        try {
          return await realpath(folder.rootPath)
        } catch {
          return undefined
        }
      })
    )
    resolvedFoldersCache = resolved.filter((r): r is string => r !== undefined)
    return resolvedFoldersCache
  } catch (err: unknown) {
    console.error('[Workspaces] Failed to resolve workspace roots:', err)
    return []
  }
}

let manifestMutationQueue: Promise<void> = Promise.resolve()
async function mutateManifest<T>(
  operation: (manifest: WorkspaceManifest) => Promise<T>
): Promise<T> {
  const operationPromise = manifestMutationQueue.then(async () => {
    const res = await operation(await loadManifest())
    resolvedFoldersCache = null
    return res
  })
  manifestMutationQueue = operationPromise.then(
    () => undefined,
    (err) => {
      console.error('[ManifestQueue] Mutation error:', err)
      resolvedFoldersCache = null
      return undefined
    }
  )
  return operationPromise
}
async function loadFolders(): Promise<WorkspaceInfo[]> {
  const manifest = await loadManifest()
  return Object.values(manifest.workspaces).map((w) => ({ ...w, rootPath: resolve(w.rootPath) }))
}
async function addWorkspaceFolder(fp: string, name: string): Promise<{ ok: boolean; resolvedPath: string }> {
  try {
    const workspacePath = await realpath(fp)
    if (!(await stat(workspacePath)).isDirectory()) return { ok: false, resolvedPath: '' }
    const { generateWorkspaceInfo } = await import('@cline/core')
    const info = await generateWorkspaceInfo(workspacePath)
    info.hint = name.trim().slice(0, 120) || basename(workspacePath)
    await mutateManifest(async (manifest) => {
      await saveManifest(upsertWorkspaceInfo(manifest, info))
    })
    return { ok: true, resolvedPath: workspacePath }
  } catch (err: unknown) {
    console.error('[Workspaces] Add folder failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
    return { ok: false, resolvedPath: '' }
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    if (!(await isPathAllowed(dir))) return []
    const { getFileIndex } = await import('@cline/sdk')
    const index = await getFileIndex(dir, { ttlMs: 2_000 })
    return Array.from(index)
  } catch (err: unknown) {
    console.error('[listDir] Failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
    return []
  }
}



async function isPathAllowed(filePath: string): Promise<boolean> {
  try {
    const [resolvedPath, roots] = await Promise.all([
      realpath(filePath),
      getResolvedWorkspaceRoots()
    ])
    return isPathAllowedPure(resolvedPath, undefined, roots)
  } catch {
    return false
  }
}

function registerSessionPort(sessionId: string, port: Electron.MessagePortMain): void {
  unregisterSessionPort(sessionId)
  port.start()
  const entry: PortEntry = { port, unsub: () => {} }
  sessionPorts.set(sessionId, entry)
  port.on('close', () => unregisterSessionPort(sessionId, entry))

  const subscribeToCore = (core: ClineCore): void => {
    if (sessionPorts.get(sessionId) !== entry) return
    entry.unsub = core.subscribe(
      (event: CoreSessionEvent) => {
        if (sessionPorts.get(sessionId) !== entry) return
        try {
          port.postMessage(event)
        } catch (err: unknown) {
          console.error('[SessionPort] postMessage failed:', err)
          if (sentryInitialized) Sentry.captureException(err)
          unregisterSessionPort(sessionId, entry)
        }
      },
      { sessionId }
    )
  }

  if (cline) {
    subscribeToCore(cline)
  } else {
    void initClineCore()
      .then(subscribeToCore)
      .catch((error: unknown) => {
        if (sessionPorts.get(sessionId) !== entry) return
        try {
          port.postMessage({
            type: 'error',
            payload: { sessionId, error: 'AI core failed to initialize.' }
          })
        } catch (postErr: unknown) {
          console.error('[SessionPort] postMessage error failed:', postErr)
          if (sentryInitialized) Sentry.captureException(postErr)
        }
        unregisterSessionPort(sessionId, entry)
        console.error('[Session port] Initialization failed:', error)
        if (sentryInitialized) Sentry.captureException(error)
      })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#17171a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#9c9c9f', height: 40 },
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
      webviewTag: true,
      allowRunningInsecureContent: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    resolvePendingQuestions('The application window was closed.')
    unregisterAllSessionPorts()
    mainWindow = undefined
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })

  mainWindow.webContents.on('context-menu', (_, props) => {
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'cut', enabled: props.editFlags.canCut },
      { role: 'copy', enabled: props.editFlags.canCopy },
      { role: 'paste', enabled: props.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: props.editFlags.canSelectAll }
    ]
    Menu.buildFromTemplate(template).popup()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

async function copySkillsToGlobalFolder(): Promise<void> {
  try {
    const srcDir = join(app.getAppPath(), 'skills')
    let entries: import('fs').Dirent[] = []
    try {
      entries = await readdir(srcDir, { withFileTypes: true })
    } catch (readErr: any) {
      if (readErr?.code === 'ENOENT') return
      throw readErr
    }
    const destDir = join(app.getPath('home'), '.cline', 'skills')
    await mkdir(destDir, { recursive: true })
    await Promise.all(
      entries.map((entry) =>
        cp(join(srcDir, entry.name), join(destDir, entry.name), {
          recursive: entry.isDirectory(),
          force: false,
          errorOnExist: false
        })
      )
    )
  } catch (err: unknown) {
    console.error('[Skills] Global copy failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
  }
}

function resolvePendingQuestions(answer: string): void {
  for (const [id, pending] of pendingQuestions) {
    clearTimeout(pending.timer)
    pending.resolve(answer)
    pendingQuestions.delete(id)
  }
}

function resolvePendingQuestionsForSession(sessionId: string, answer: string): void {
  for (const [id, pending] of pendingQuestions) {
    if (pending.sessionId === sessionId) {
      clearTimeout(pending.timer)
      pending.resolve(answer)
      pendingQuestions.delete(id)
    }
  }
}

async function initClineCore(): Promise<ClineCore> {
  if (cline) return cline
  if (clineInitPromise) return clineInitPromise
  clineInitPromise = (async () => {
    await copySkillsToGlobalFolder()
    const { ClineCore, createDefaultExecutors } = await import('@cline/sdk')
    const core = await ClineCore.create({
      clientName: 'orchcode',
      backendMode: 'local',
      logger: console,
      capabilities: {
        toolExecutors: {
          ...createDefaultExecutors({
            bash: {
              shell: 'powershell',
              timeoutMs: 120000
            }
          }),
          askQuestion: async (question, options, context) =>
            new Promise<string>((resolve) => {
              const id = randomUUID()
              const sessionId = context?.sessionId ?? ''
              let timer: NodeJS.Timeout | undefined = undefined
              const settle = (answer: string): void => {
                const pending = pendingQuestions.get(id)
                if (!pending) return
                if (pending.timer) clearTimeout(pending.timer)
                pendingQuestions.delete(id)
                pending.resolve(answer)
              }
              pendingQuestions.set(id, { resolve, timer: undefined, sessionId })
              timer = setTimeout(
                () => {
                  settle('No response was provided.')
                  sendToRenderer('ask-question:dismiss', { id })
                },
                10 * 60 * 1000
              )
              const pending = pendingQuestions.get(id)
              if (pending) pending.timer = timer
              if (!mainWindow || mainWindow.isDestroyed()) settle('No response was provided.')
              else sendToRenderer('ask-question', { id, sessionId, question, options })
            })
        }
      }
    })
    cline = core
    clineInitPromise = undefined
    console.log('[Main] ClineCore ready')
    return core
  })()
  try {
    return await clineInitPromise
  } catch (err: unknown) {
    clineInitPromise = undefined
    if (sentryInitialized) Sentry.captureException(err)
    throw err
  }
}

let cachedModels: Record<string, ModelConfig> | undefined = undefined
let cachedModelsAt = 0
const MODELS_TTL = 5 * 60 * 1000


function normalizeModels(value: unknown): Record<string, ModelConfig> {
  return (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, ModelConfig>
}

async function fetchModelsList(): Promise<Record<string, ModelConfig> | undefined> {
  if (cachedModels && Date.now() - cachedModelsAt < MODELS_TTL) return cachedModels
  const session = await refreshAuthSessionIfNeeded()
  const url = serviceUrl('models')
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!session || !url || !anonKey) return undefined
  try {
    const response = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (response.ok) {
      cachedModels = normalizeModels(await response.json())
      cachedModelsAt = Date.now()
      return cachedModels
    }
  } catch (err: unknown) {
    console.error('[Models] Fetch failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
  }
  return undefined
}

function getReasoningEffort(
  value: string | undefined
): CoreSessionConfig['reasoningEffort'] | undefined {
  if (value === 'max' || value === 'xhigh') return 'high'
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

const getSandboxFallbackPath = (): string => {
  return join(app.getPath('userData'), 'sandbox')
}

interface SessionMetadata {
  reasoningEffort?: string | null
  title?: string
  workspacePath?: string
  modelId?: string
  providerId?: string
  [key: string]: unknown
}

async function buildSessionConfig(
  sessionId: string,
  workspacePath: string | undefined,
  model: ModelConfig,
  session: StoredAuthSession,
  metadata?: SessionMetadata
): Promise<CoreSessionConfig> {
  const baseUrl = serviceUrl(`${model.provider}/v1`)
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!baseUrl || !anonKey) throw new Error('The application server configuration is incomplete.')
  const rawEffort = metadata?.reasoningEffort !== undefined ? metadata.reasoningEffort : model.reasoningEffort
  const reasoningEffort = getReasoningEffort(rawEffort as string | undefined)
  let workspaceMetadata: string | undefined
  if (workspacePath) {
    try {
      const { buildWorkspaceMetadata } = await import('@cline/core')
      workspaceMetadata = await buildWorkspaceMetadata(workspacePath)
    } catch (err: unknown) {
      console.error('[SessionConfig] Failed to build workspace metadata:', err)
    }
  }
  let extraTools: ReturnType<typeof getExtraTools> = []
  try {
    extraTools = getExtraTools(session.accessToken, sessionId)
    if (!model.capabilities?.includes('images')) {
      extraTools = extraTools.filter(t => t.name !== 'playwright_screenshot')
    }
  } catch (err: unknown) {
    console.error('[SessionConfig] Failed to load extra tools:', err)
  }
  return {
    providerId: 'openai-compatible',
    modelId: stripPrefix(model.id),
    apiKey: 'sk-no-key',
    baseUrl,
    headers: { apikey: anonKey, Authorization: `Bearer ${session.accessToken}` },
    thinking: !!reasoningEffort,
    reasoningEffort,
    systemPrompt: SYSTEM_PROMPT,
    mode: 'act',
    enableTools: true,
    disableMcpSettingsTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    yolo: false,
    maxIterations: 50,
    execution: { maxConsecutiveMistakes: 6, loopDetection: { softThreshold: 3, hardThreshold: 5 } },
    compaction: { enabled: true, thresholdRatio: 0.8, strategy: 'agentic' },
    sessionId,
    cwd: workspacePath || getSandboxFallbackPath(),
    workspaceRoot: workspacePath,
    workspaceMetadata,
    extraTools
  }
}

function selectModel(
  models: Record<string, ModelConfig>,
  modelId: string,
  provider?: string
): ModelConfig | undefined {
  return (
    Object.values(models).find(
      (model) => stripPrefix(model.id) === modelId && (!provider || model.provider === provider)
    ) ?? Object.values(models).find((model) => stripPrefix(model.id) === modelId)
  )
}

const sessionStartLocks = new Map<string, Promise<ClineCore>>()
const draftStartLocks = new Map<string, Promise<boolean>>()

async function ensureSessionIsActive(sessionId: string): Promise<ClineCore> {
  const core = await initClineCore()
  if (activeClineSessions.has(sessionId)) return core

  const existingDraft = draftStartLocks.get(sessionId)
  if (existingDraft) await existingDraft
  if (activeClineSessions.has(sessionId)) return core

  const existing = sessionStartLocks.get(sessionId)
  if (existing) return existing
  const startPromise = (async () => {
    try {
      const record = await core.get(sessionId)
      if (!record?.model) throw new Error('This session is no longer available.')
      const [models, session, messages] = await Promise.all([
        fetchModelsList(),
        refreshAuthSessionIfNeeded(),
        core.readMessages(sessionId)
      ])
      const providerId =
        typeof record.metadata?.providerId === 'string' ? record.metadata.providerId : undefined
      const model = models ? selectModel(models, record.model, providerId) : undefined
      if (!model || !session)
        throw new Error('The model used by this session is no longer available.')
      const workspacePath =
        typeof record.cwd === 'string' && record.cwd ? record.cwd : record.workspaceRoot
      await core.start({
        config: await buildSessionConfig(sessionId, workspacePath, model, session),
        interactive: true,
        initialMessages: messages.map((m: Message & { ts?: number; id?: string }) => {
          const { ts: _ts, id: _id, ...rest } = m
          void _ts
          void _id
          return rest as unknown as Message
        }),
        sessionMetadata: record.metadata
      })
      if (cancelledSessions.has(sessionId)) {
        await core.delete(sessionId)
        throw new Error('This session was deleted while it was starting.')
      }
      activeClineSessions.add(sessionId)
      return core
    } catch (err: unknown) {
      throw err
    } finally {
      sessionStartLocks.delete(sessionId)
    }
  })()
  sessionStartLocks.set(sessionId, startPromise)
  return startPromise
}

function sanitizeUserImages(images: string[] | undefined): string[] | undefined {
  const seen = new Set<string>()
  let totalBytes = 0
  const sanitized: string[] = []
  for (const image of images ?? []) {
    if (sanitized.length >= MAX_ATTACHMENTS || typeof image !== 'string') continue
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image)) continue
    if (image.length > 15 * 1024 * 1024 || seen.has(image)) continue
    if (totalBytes + image.length > MAX_TOTAL_IMAGE_BYTES) continue
    seen.add(image)
    totalBytes += image.length
    sanitized.push(image)
  }
  return sanitized.length ? sanitized : undefined
}

async function sanitizeUserFiles(files: string[] | undefined): Promise<string[] | undefined> {
  const candidates = Array.from(
    new Set(
      (files ?? [])
    .filter((file) => typeof file === 'string' && file.trim().length > 0 && file.length <= 4_096)
    .map((file) => file.trim())
    )
  )
  const sanitized: string[] = []
  let totalBytes = 0
  for (const file of candidates) {
    if (sanitized.length >= MAX_ATTACHMENTS) break
    try {
      if (!(await isPathAllowed(file))) continue
      const info = await stat(file)
      if (!info.isFile() || info.size > MAX_USER_FILE_BYTES) continue
      if (totalBytes + info.size > MAX_TOTAL_USER_FILE_BYTES) continue
      totalBytes += info.size
      sanitized.push(file)
    } catch {
    }
  }
  return sanitized.length ? sanitized : undefined
}

async function readViewableFile(filePath: string): Promise<string | undefined> {
  try {
    if (!(await isPathAllowed(filePath))) {
      console.error('[FileRead] Path not allowed:', filePath)
      return undefined
    }
    const resolvedPath = await realpath(filePath)
    const info = await stat(resolvedPath)
    if (!info.isFile() || info.size > MAX_VIEWABLE_FILE_BYTES) return undefined
    const content = await readFile(resolvedPath, 'utf-8')
    return content.includes('\0') ? undefined : content
  } catch (err: unknown) {
    if (sentryInitialized) Sentry.captureException(err)
    return undefined
  }
}

async function resolveWorkspacePath(workspacePath: string | undefined): Promise<string | undefined> {
  if (!workspacePath) return undefined
  const resolvedPath = await realpath(workspacePath)
  if (!(await stat(resolvedPath)).isDirectory() || !(await isPathAllowed(resolvedPath)))
    throw new Error('Workspace is not an approved directory.')
  return resolvedPath
}


function isTrustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const win = mainWindow
  if (!win || win.isDestroyed()) return false
  return (
    event.sender === win.webContents &&
    event.senderFrame?.parent === null &&
    isRendererUrl(event.senderFrame?.url ?? '')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown, maxLength = 4_096): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

function isSessionId(value: unknown): value is string {
  return isString(value, 200) && value.length > 0
}

function hasNoArgs(value: unknown): boolean {
  return value === undefined || value === null
}

function isDelivery(value: unknown): value is 'queue' | 'steer' | undefined {
  return value === undefined || value === 'queue' || value === 'steer'
}

function hasValidIpcArgs(channel: IpcChannel, args: unknown): boolean {
  if (
    channel === 'session:list' ||
    channel === 'workspace:get-folders' ||
    channel === 'workspace:open-dialog' ||
    channel === 'window:minimize' ||
    channel === 'window:maximize' ||
    channel === 'window:quit' ||
    channel === 'models:list' ||
    channel === 'budget:get' ||
    channel === 'auth:start' ||
    channel === 'auth:get-session' ||
    channel === 'auth:sign-out' ||
    channel === 'app:check-for-updates' ||
    channel === 'app:restart-and-update' ||
    channel === 'app:open-releases'
  )
    return hasNoArgs(args)
  if (!isRecord(args)) return false
  if (channel === 'session:create')
    return (
      isString(args.title, 120) &&
      (args.workspacePath === undefined || isString(args.workspacePath, 4_096)) &&
      (args.modelKey === undefined || isString(args.modelKey, 512))
    )
  if (
    channel === 'session:delete' ||
    channel === 'session:abort' ||
    channel === 'session:messages'
  )
    return isSessionId(args.sessionId)
  if (channel === 'session:update-title')
    return isSessionId(args.sessionId) && isString(args.title, 120)
  if (channel === 'session:update-model')
    return isSessionId(args.sessionId) && isString(args.modelKey, 512)
  if (channel === 'session:update-reasoning')
    return (
      isSessionId(args.sessionId) &&
      (args.reasoningEffort === null ||
        args.reasoningEffort === 'low' ||
        args.reasoningEffort === 'medium' ||
        args.reasoningEffort === 'high' ||
        args.reasoningEffort === 'xhigh' ||
        args.reasoningEffort === 'max')
    )
  if (channel === 'session:send')
    return (
      isSessionId(args.sessionId) &&
      isString(args.prompt, MAX_PROMPT_LENGTH) &&
      isDelivery(args.delivery) &&
      (args.userImages === undefined ||
        (Array.isArray(args.userImages) &&
          args.userImages.length <= MAX_ATTACHMENTS &&
          args.userImages.every((image) => isString(image, 15 * 1024 * 1024)))) &&
      (args.userFiles === undefined ||
        (Array.isArray(args.userFiles) &&
          args.userFiles.length <= MAX_ATTACHMENTS &&
          args.userFiles.every((file) => isString(file, 4_096))))
    )
  if (channel === 'queue:update')
    return (
      isSessionId(args.sessionId) &&
      isString(args.promptId, 200) &&
      isString(args.prompt, MAX_PROMPT_LENGTH) &&
      (args.delivery === 'queue' || args.delivery === 'steer')
    )
  if (channel === 'queue:delete') return isSessionId(args.sessionId) && isString(args.promptId, 200)
  if (channel === 'queue:list') return isSessionId(args.sessionId)
  if (channel === 'workspace:add-folder') return isString(args.path, 4_096) && isString(args.name, 120)
  if (channel === 'workspace:remove-folder') return isString(args.path, 4_096)
  if (channel === 'file:read' || channel === 'file:list')
    return isString(channel === 'file:read' ? args.filePath : args.dirPath, 4_096)
  if (channel === 'audio:transcribe') return args.buffer instanceof Uint8Array
  if (channel === 'browser:register')
    return (
      isSessionId(args.sessionId) &&
      typeof args.webContentsId === 'number' &&
      Number.isSafeInteger(args.webContentsId) &&
      args.webContentsId > 0
    )
  if (channel === 'ask-question:response')
    return isString(args.id, 200) && isString(args.answer, 4_000)
  if (channel === 'session:search') return isString(args.query, 2_000)
  return false
}

function registerIpcHandlers(): void {
  const safeIpc = <C extends IpcChannel>(
    channel: C,
    fn: (
      event: Electron.IpcMainInvokeEvent,
      args: IpcArgs<C>
    ) => Promise<IpcResult<C>> | IpcResult<C>,
    defaultVal?: IpcResult<C>
  ): void => {
    ipcMain.handle(channel, async (event, args) => {
      if (!isTrustedSender(event) || !hasValidIpcArgs(channel, args)) return defaultVal
      try {
        return await fn(event, args as IpcArgs<C>)
      } catch (e: unknown) {
        console.error(`[IPC] ${channel}:`, e)
        if (sentryInitialized) Sentry.captureException(e)
        if (e instanceof Error && e.message) {
          throw e
        }
        return defaultVal
      }
    })
  }
  safeIpc(
    'session:list',
    async () => {
      const raw = await (await initClineCore()).list(500)
      return raw.map((s) => ({
        ...s,
        workspaceRoot: s.workspaceRoot ? resolve(s.workspaceRoot) : '',
        cwd: s.cwd ? resolve(s.cwd) : ''
      }))
    },
    []
  )
  safeIpc(
    'session:messages',
    async (_, { sessionId }) => (await initClineCore()).readMessages(sessionId),
    []
  )

  safeIpc(
    'session:update-title',
    async (_, { sessionId, title }) => {
      const normalizedTitle = title.trim().slice(0, 120)
      if (!normalizedTitle) return false
      const draft = draftSessions.get(sessionId)
      if (draft) {
        draft.title = normalizedTitle
        return true
      }
      return (await initClineCore())
        .update(sessionId, { title: normalizedTitle })
        .then((result) => result.updated)
    },
    false
  )
  safeIpc('workspace:get-folders', async () => loadFolders(), [])
  safeIpc('workspace:add-folder', async (_, { path: fp, name }) => {
    const { ok } = await addWorkspaceFolder(fp, name)
    return ok
  }, false)
  safeIpc(
    'workspace:remove-folder',
    async (_, { path: fp }) => {
      return mutateManifest(async (manifest) => {
        if (!manifest.workspaces[fp]) return false
        delete manifest.workspaces[fp]
        if (manifest.currentWorkspacePath === fp) delete manifest.currentWorkspacePath
        await saveManifest(manifest)
        return true
      })
    },
    false
  )
  safeIpc(
    'session:search',
    async (_, { query }) => {
      const q = query.trim().toLowerCase()
      if (!q) return []
      const core = await initClineCore()
      const raw = await core.list(500)
      const sessions = raw
        .sort((a, b) => {
          const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
          const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
          return tb - ta
        })
        .slice(0, 50)
      const results: { sessionId: string; title: string; role: string; text: string }[] = []
      const BATCH = 10
      for (let i = 0; i < sessions.length && results.length < 50; i += BATCH) {
        const batch = sessions.slice(i, i + BATCH)
        const batchResults = await Promise.all(
          batch.map(async (session) => {
            const found: typeof results = []
            try {
              const messages = await core.readMessages(session.sessionId)
              for (const message of messages) {
                if (found.length >= 5) break
                let text = ''
                if (typeof message.content === 'string') text = message.content
                else if (Array.isArray(message.content)) {
                  for (const part of message.content) {
                    if (part.type === 'text') text += part.text
                    else if (part.type === 'thinking') text += part.thinking
                    else if (part.type === 'tool_result' && typeof part.content === 'string')
                      text += part.content
                    if (text.length > 4_000) break
                  }
                }
                if (text && text.toLowerCase().includes(q))
                  found.push({
                    sessionId: session.sessionId,
                    title: session.metadata?.title || 'Untitled',
                    role: message.role || 'assistant',
                    text: text.slice(0, 300)
                  })
              }
            } catch {}
            return found
          })
        )
        for (const batchHits of batchResults) results.push(...batchHits)
      }
      return results.slice(0, 50)
    },
    []
  )
  safeIpc('file:read', (_, { filePath }) => readViewableFile(filePath), undefined)
  safeIpc('file:list', (_, { dirPath }) => listDir(dirPath), [])

  safeIpc(
    'audio:transcribe',
    async (_, { buffer }) => {
      const session = await refreshAuthSessionIfNeeded()
      const url = serviceUrl('transcribe')
      const anonKey = process.env.SUPABASE_ANON_KEY
      if (!session || !url || !anonKey) return { error: 'Not authenticated' }
      if (buffer.byteLength > 15 * 1024 * 1024) return { error: 'Audio recording is too large.' }
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${session.accessToken}`
          },
          body: JSON.stringify({ audio: Buffer.from(buffer).toString('base64') }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        if (response.ok) return { text: ((await response.json()) as { text?: string }).text ?? '' }
      } catch (err: unknown) {
        console.error('[Speech] Transcription failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
      }
      return { error: 'Transcription failed' }
    },
    { error: 'Unknown error' }
  )
  safeIpc('auth:start', async () => {
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
    if (!supabaseUrl) throw new Error('Authentication is not configured.')
    const supabase = new URL(supabaseUrl)
    if (supabase.protocol !== 'https:') throw new Error('Authentication must use HTTPS.')
    clearExpiredAuthRequests()
    const state = randomUUID()
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    pendingAuthRequests.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 })
    const url = new URL(`${supabaseUrl}/auth/v1/authorize`)
    url.searchParams.set('provider', 'google')
    url.searchParams.set('redirect_to', 'orchcode://auth-callback')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state)
    await shell.openExternal(url.toString())
  })
  safeIpc('auth:get-session', async () => toPublicAuthSession(await refreshAuthSessionIfNeeded()), undefined)
  safeIpc('auth:sign-out', async () => {
    await clearAuthSession()
    cachedModels = undefined
    cachedModelsAt = 0
    sendToRenderer('auth:change', undefined)
  })
  safeIpc(
    'browser:register',
    async (_, { sessionId, webContentsId }) =>
      (activeClineSessions.has(sessionId) || draftSessions.has(sessionId)) &&
      registerBrowserWebContents(sessionId, webContentsId as number),
    false
  )
  safeIpc('models:list', async () => (await fetchModelsList()) || {}, {})
  safeIpc(
    'budget:get',
    async () => {
      const session = await refreshAuthSessionIfNeeded()
      const url = serviceUrl('budget')
      const anonKey = process.env.SUPABASE_ANON_KEY
      if (!session || !url || !anonKey) return undefined
      try {
        const response = await fetch(url, {
          headers: { apikey: anonKey, Authorization: `Bearer ${session.accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        if (response.ok) return await response.json()
      } catch (err: unknown) {
        console.error('[Budget] Fetch failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
      }
      return undefined
    },
    undefined
  )
  safeIpc(
    'session:update-model',
    async (_, { sessionId, modelKey }) => {
      const draft = draftSessions.get(sessionId)
      if (draft) {
        draft.modelKey = modelKey
        return { success: true }
      }
      const models = await fetchModelsList()
      const mCfg = models?.[modelKey]
      if (!mCfg) return { error: 'Model not found' }
      const strippedId = stripPrefix(mCfg.id)
      try {
        const core = await ensureSessionIsActive(sessionId)
        await core.updateSessionModel(sessionId, strippedId)
        const record = await core.get(sessionId)
        return {
          success: (
            await core.update(sessionId, {
              metadata: { ...record?.metadata, modelId: mCfg.id, providerId: mCfg.provider }
            })
          ).updated
        }
      } catch (err: unknown) {
        console.error('[Models] Update model failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    { error: 'Unknown error' }
  )
  safeIpc(
    'session:update-reasoning',
    async (_, { sessionId, reasoningEffort }) => {
      const draft = draftSessions.get(sessionId)
      if (draft) {
        draft.reasoningEffort = reasoningEffort
        return { success: true }
      }
      try {
        const core = await ensureSessionIsActive(sessionId)
        const record = await core.get(sessionId)
        return {
          success: (
            await core.update(sessionId, {
              metadata: { ...record?.metadata, reasoningEffort: reasoningEffort || undefined }
            })
          ).updated
        }
      } catch (err: unknown) {
        console.error('[Models] Update reasoning failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    { error: 'Unknown error' }
  )
  safeIpc(
    'session:create',
    async (_, { title, workspacePath, modelKey }) => {
      const normalizedTitle = title.trim().slice(0, 120) || 'Untitled chat'
      if (draftSessions.size >= 100)
        return {
          error:
            'You have too many open chats. Please send a message or delete an existing chat first.'
      }
      const sessionId = `draft_${randomUUID()}`
      cancelledSessions.delete(sessionId)
      let approvedWorkspacePath: string | undefined
      try {
        approvedWorkspacePath = await resolveWorkspacePath(workspacePath)
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : 'Workspace is not available.' }
      }
      draftSessions.set(sessionId, { title: normalizedTitle, workspacePath: approvedWorkspacePath, modelKey })
      return { sessionId, title: normalizedTitle }
    },
    undefined
  )
  safeIpc(
    'ask-question:response',
    async (_, { id, answer }) => {
      const pending = pendingQuestions.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(answer)
        pendingQuestions.delete(id)
        return true
      }
      return false
    },
    false
  )
  safeIpc(
    'session:delete',
    async (_, { sessionId }) => {
      cancelledSessions.add(sessionId)
      if (draftSessions.delete(sessionId)) {
        unregisterSessionPort(sessionId)
        unregisterBrowserWebContents(sessionId)
        return true
      }
      const deleted = await (await initClineCore()).delete(sessionId)
      if (!deleted) return false
      activeClineSessions.delete(sessionId)
      sessionStartLocks.delete(sessionId)
      resolvePendingQuestionsForSession(sessionId, 'Session was deleted.')
      unregisterSessionPort(sessionId)
      unregisterBrowserWebContents(sessionId)
      return true
    },
    false
  )
  safeIpc(
    'session:abort',
    async (_, { sessionId }) => {
      if (draftSessions.has(sessionId)) {
        cancelledSessions.add(sessionId)
        draftSessions.delete(sessionId)
        return true
      }
      try {
        await (await initClineCore()).abort(sessionId)
        return true
      } catch (err: unknown) {
        console.error('[SessionAbort] Abort failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        return false
      }
    },
    false
  )
  safeIpc(
    'queue:update',
    async (_, { sessionId, promptId, prompt, delivery }) => {
      try {
        const core = await ensureSessionIsActive(sessionId)
        return core.pendingPrompts
          .update({ sessionId, promptId, prompt, delivery })
          .then((res) => !!res.updated)
      } catch (err: unknown) {
        console.error('[QueueUpdate] Failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        return false
      }
    },
    false
  )
  safeIpc(
    'queue:delete',
    async (_, { sessionId, promptId }) => {
      try {
        const core = await ensureSessionIsActive(sessionId)
        return core.pendingPrompts.delete({ sessionId, promptId }).then((res) => !!res.removed)
      } catch (err: unknown) {
        console.error('[QueueDelete] Failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        return false
      }
    },
    false
  )
  safeIpc(
    'queue:list',
    async (_, { sessionId }) => {
      try {
        const core = await ensureSessionIsActive(sessionId)
        return await core.pendingPrompts.list({ sessionId })
      } catch (err: unknown) {
        console.error('[QueueList] Failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        return []
      }
    },
    []
  )
  safeIpc(
    'workspace:open-dialog',
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return undefined
      const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths.length) return undefined
      const fp = result.filePaths[0]
      const { ok, resolvedPath } = await addWorkspaceFolder(fp, basename(fp))
      if (ok) {
        const manifest = await loadManifest()
        return manifest.workspaces[resolvedPath]
      }
      return undefined
    },
    undefined
  )
  safeIpc(
    'app:check-for-updates',
    async () => {
      try {
        await autoUpdater.checkForUpdates()
        return true
      } catch (err: unknown) {
        console.error('[AutoUpdate] Check failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        return false
      }
    },
    false
  )
  safeIpc('app:restart-and-update', () => {
    autoUpdater.quitAndInstall(true, true)
  })
  safeIpc('app:open-releases', () => {
    shell.openExternal('https://github.com/sameer786ss/OrchCode/releases')
  })
  safeIpc(
    'window:minimize',
    async () => {
      mainWindow?.minimize()
      return true
    },
    false
  )
  safeIpc(
    'window:maximize',
    async () => {
      if (mainWindow) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize()
        else mainWindow.maximize()
        return true
      }
      return false
    },
    false
  )
  safeIpc(
    'window:quit',
    async () => {
      app.quit()
      return true
    },
    false
  )

  safeIpc(
    'session:send',
    async (_, { sessionId, prompt, userImages, userFiles, delivery }) => {
      const normalizedPrompt = prompt.trim()
      if (normalizedPrompt.length > MAX_PROMPT_LENGTH) return false
      if (!normalizedPrompt && !userImages?.length && !userFiles?.length) return false
      let core: ClineCore
      const draft = draftSessions.get(sessionId)
      if (draft) {
        const existing = draftStartLocks.get(sessionId)
        if (existing) {
          const ok = await existing
          if (!ok) return false
          core = await ensureSessionIsActive(sessionId)
        } else {
          const draftStartPromise = (async (): Promise<ClineCore | null> => {
            try {
              const models = await fetchModelsList()
              if (!models || Object.keys(models).length === 0) return null
              const modelKey = draft.modelKey || Object.keys(models)[0]
              const mCfg = models[modelKey]
              if (!mCfg) return null
              const session = await refreshAuthSessionIfNeeded()
              if (!session) return null
              const initedCore = await initClineCore()
              if (cancelledSessions.has(sessionId)) return null
              await initedCore.start({
                config: await buildSessionConfig(sessionId, draft.workspacePath, mCfg, session, { reasoningEffort: draft.reasoningEffort }),
                interactive: true,
                sessionMetadata: {
                  title: draft.title,
                  workspacePath: draft.workspacePath || undefined,
                  modelId: mCfg.id,
                  providerId: mCfg.provider,
                  reasoningEffort: draft.reasoningEffort || undefined
                }
              })
              if (cancelledSessions.has(sessionId)) {
                await initedCore.delete(sessionId)
                return null
              }
              draftSessions.delete(sessionId)
              activeClineSessions.add(sessionId)
              return initedCore
            } catch (err: unknown) {
              console.error('[SessionSend] Draft start failed:', err)
              if (sentryInitialized) Sentry.captureException(err)
              return null
            } finally {
              draftStartLocks.delete(sessionId)
            }
          })()
          draftStartLocks.set(sessionId, draftStartPromise.then((c) => c !== null))
          const startedCore = await draftStartPromise
          if (!startedCore) return false
          core = startedCore
        }
      } else {
        core = await ensureSessionIsActive(sessionId)
      }
      const sanitizedFiles = await sanitizeUserFiles(userFiles)
      core.send({
        sessionId,
        prompt: normalizedPrompt,
        userImages: sanitizeUserImages(userImages),
        userFiles: sanitizedFiles,
        delivery
      }).then((result) => {
        if (result?.finishReason === 'error') {
          const error = result.text || 'The agent could not complete this request.'
          try {
            sessionPorts.get(sessionId)?.port.postMessage({ type: 'error', payload: { sessionId, error } })
          } catch (postErr: unknown) {
            console.error('[SessionSend] Error postMessage failed:', postErr)
            if (sentryInitialized) Sentry.captureException(postErr)
          }
        }
      }).catch((err: unknown) => {
        console.error('[SessionSend] core.send failed:', err)
        if (sentryInitialized) Sentry.captureException(err)
        try {
          sessionPorts.get(sessionId)?.port.postMessage({
            type: 'error',
            payload: { sessionId, error: err instanceof Error ? err.message : String(err) }
          })
        } catch (postErr: unknown) {
          console.error('[SessionSend] Error postMessage failed:', postErr)
        }
      })
      return true
    },
    false
  )
  ipcMain.on('session:register-port', (event, args: unknown) => {
    const sessionId = isRecord(args) ? args.sessionId : undefined
    if (
      !isTrustedSender(event) ||
      typeof sessionId !== 'string' ||
      !sessionId ||
      sessionId.length > 200
    )
      return
    if (
      !activeClineSessions.has(sessionId) &&
      !draftSessions.has(sessionId) &&
      !sessionStartLocks.has(sessionId) &&
      !draftStartLocks.has(sessionId)
    )
      return
    const port = event.ports[0]
    if (port) registerSessionPort(sessionId, port)
  })
  ipcMain.on('session:unregister-port', (event, args: unknown) => {
    const sessionId = isRecord(args) ? args.sessionId : undefined
    if (isTrustedSender(event) && isSessionId(sessionId)) unregisterSessionPort(sessionId)
  })
}



app.whenReady().then(async () => {
  electronApp.setAppUserModelId('live.orch.app')
  await mkdir(getSandboxFallbackPath(), { recursive: true })
  app.on('browser-window-created', (_, win) => optimizer.watchWindowShortcuts(win))
  setupAutoUpdater()
  registerIpcHandlers()
  createWindow()
  const startupUrl = process.argv.find((arg) => arg.startsWith('orchcode://'))
  if (startupUrl) void handleAuthCallback(startupUrl)
  setTimeout(() => {
    initClineCore().catch((err: unknown) => {
      console.error('[Main] ClineCore init failed:', err)
      if (sentryInitialized) Sentry.captureException(err)
      sendToRenderer('core:init-failed', { message: 'AI core failed to initialize. Please restart the application.' })
    })
  }, 100)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  resolvePendingQuestions('The application is closing.')
  if (isQuitting) return
  if (!cline) return
  isQuitting = true
  event.preventDefault()
  const forceExit = setTimeout(() => app.exit(1), 8000)
  void (async () => {
    unregisterAllSessionPorts()
    try {
      await Promise.race([
        cline.dispose(),
        new Promise<void>((resolve) => setTimeout(resolve, 6000))
      ])
    } catch (err: unknown) {
      console.error('[Quit] Cline dispose failed:', err)
      if (sentryInitialized) Sentry.captureException(err)
    } finally {
      clearTimeout(forceExit)
      app.exit(0)
    }
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
