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
  IpcArgs,
  IpcChannel,
  IpcResult,
  ModelConfig
} from '../shared/ipc-contracts'
import { join, basename, resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { readFile, unlink, readdir, copyFile, stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import { autoUpdater } from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../resources/icon.png?asset'
import type { ClineCore, CoreSessionEvent, Message } from '@cline/sdk'
import type { CoreSessionConfig } from '@cline/core'
import type { WorkspaceInfo, WorkspaceManifest } from '@cline/shared'
import { emptyWorkspaceManifest, upsertWorkspaceInfo } from '@cline/shared'
import dotenv from 'dotenv'
import { isPathAllowedPure, writeAtomic, serviceUrl } from './utils/fs'
import { MAX_ATTACHMENTS } from '../shared/pathHelpers'
const MAX_VIEWABLE_FILE_BYTES = 5 * 1024 * 1024
const MAX_PROMPT_LENGTH = 200_000
const REQUEST_TIMEOUT_MS = 30_000
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

function isAuthSession(value: unknown): value is AuthSession {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as AuthSession).accessToken === 'string' &&
    typeof (value as AuthSession).refreshToken === 'string' &&
    typeof (value as AuthSession).expiresAt === 'number' &&
    Number.isFinite((value as AuthSession).expiresAt)
  )
}

async function _readEncryptedSession(): Promise<{ json: string } | undefined> {
  try {
    const p = encAuthPath()
    if (!existsSync(p)) return undefined
    const raw = await readFile(p, 'utf-8')
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

async function saveAuthSession(session: AuthSession): Promise<boolean> {
  try {
    mkdirSync(userData(), { recursive: true })
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


async function getRawAuthSession(): Promise<AuthSession | undefined> {
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

async function clearAuthSession(): Promise<void> {
  try {
    if (existsSync(encAuthPath())) await unlink(encAuthPath())
  } catch (err: unknown) {
    console.error('[Auth] Clear auth.enc failed:', err)
    Sentry.captureException(err)
  }
}

interface AuthResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}
let _refreshPromise: Promise<AuthSession | undefined> | undefined = undefined
async function refreshAuthSessionIfNeeded(): Promise<AuthSession | undefined> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = _doRefresh().finally(() => {
    _refreshPromise = undefined
  })
  return _refreshPromise
}
async function _doRefresh(): Promise<AuthSession | undefined> {
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
    const data = (await response.json()) as AuthResponse
    if (!data.access_token || !data.refresh_token) return undefined
    const expiresIn = data.expires_in
    const ttl = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600
    const newSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() + Math.min(ttl, 60 * 60 * 24 * 30) * 1000)
    }
    if (!(await saveAuthSession(newSession))) return undefined
    sendToRenderer('auth:change', newSession)
    return newSession
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
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const rawExpiresIn = Number(params.get('expires_in'))
    if (accessToken && refreshToken) {
      const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : 3600
      const expiresAt = Math.floor(Date.now() + Math.min(expiresIn, 60 * 60 * 24 * 30) * 1000)
      const session = { accessToken, refreshToken, expiresAt }
      if (!(await saveAuthSession(session))) return
      cachedModels = undefined
      cachedModelsAt = 0
      sendToRenderer('auth:change', session)
    }
  } catch (err: unknown) {
    console.error('[Auth] Deep link parse failed:', err)
    Sentry.captureException(err)
  }
}

let cline: ClineCore | undefined
let mainWindow: BrowserWindow | undefined = undefined
let clineInitPromise: Promise<ClineCore> | undefined = undefined
let isQuitting = false
const activeClineSessions = new Set<string>()

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
  { resolve: (answer: string) => void; timer: NodeJS.Timeout; sessionId: string }
>()

const SYSTEM_PROMPT =
  'You are Orch AI, a premium AI coding assistant. Help developers plan, build, and debug software. You have access to filesystem tools: read, write, edit files, run terminal commands, search the web. Be precise, concise, and always prefer working code over explanations.'

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.setFeedURL({ provider: 'github', owner: 'sameer786ss', repo: 'OrchCode' })
  autoUpdater.on('checking-for-update', () =>
    sendToRenderer('update:status', { status: 'checking' })
  )
  autoUpdater.on('update-available', (info) =>
    sendToRenderer('update:status', { status: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () =>
    sendToRenderer('update:status', { status: 'not-available' })
  )
  autoUpdater.on('error', (err) => {
    Sentry.captureException(err)
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
  if (!is.dev) return value.startsWith('file://')
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!rendererUrl) return false
  try {
    return new URL(value).origin === new URL(rendererUrl).origin
  } catch {
    return false
  }
}

async function loadEnv(): Promise<void> {
  const base = app.getAppPath()
  const p = join(base, '.env')
  if (!existsSync(p)) return
  try {
    dotenv.config({ path: p })
  } catch (err: unknown) {
    console.error('[Env] Load failed:', err)
    Sentry.captureException(err)
  }
}

const wpPath = (): string => join(userData(), 'workspaces.json')
async function loadManifest(): Promise<WorkspaceManifest> {
  try {
    if (!existsSync(wpPath())) return emptyWorkspaceManifest()
    const parsed = JSON.parse(await readFile(wpPath(), 'utf-8'))
    return parsed && typeof parsed === 'object' && parsed.workspaces ? parsed as WorkspaceManifest : emptyWorkspaceManifest()
  } catch (err: unknown) {
    console.error('[Workspaces] Load manifest failed:', err)
    Sentry.captureException(err)
    return emptyWorkspaceManifest()
  }
}
async function saveManifest(manifest: WorkspaceManifest): Promise<void> {
  try {
    await writeAtomic(wpPath(), JSON.stringify(manifest))
  } catch (err: unknown) {
    console.error('[Workspaces] Save manifest failed:', err)
    Sentry.captureException(err)
  }
}
async function loadFolders(): Promise<WorkspaceInfo[]> {
  const manifest = await loadManifest()
  return Object.values(manifest.workspaces).map((w) => ({ ...w, rootPath: resolve(w.rootPath) }))
}
async function addWorkspaceFolder(fp: string, name: string): Promise<boolean> {
  try {
    if (!(await stat(fp)).isDirectory()) return false
    const manifest = await loadManifest()
    const { generateWorkspaceInfo } = await import('@cline/core')
    const info = await generateWorkspaceInfo(fp)
    info.hint = name.trim() || basename(fp)
    const updated = upsertWorkspaceInfo(manifest, info)
    await saveManifest(updated)
    return true
  } catch (err: unknown) {
    console.error('[Workspaces] Add folder failed:', err)
    Sentry.captureException(err)
    return false
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    const { getFileIndex } = await import('@cline/sdk')
    const index = await getFileIndex(dir)
    return Array.from(index)
  } catch (err: unknown) {
    console.error('[listDir] Failed:', err)
    if (sentryInitialized) Sentry.captureException(err)
    return []
  }
}



async function isPathAllowed(filePath: string): Promise<boolean> {
  const folders = await loadFolders()
  return isPathAllowedPure(
    filePath,
    userData(),
    folders.map((f) => f.rootPath)
  )
}

function registerSessionPort(sessionId: string, port: Electron.MessagePortMain): void {
  const existing = sessionPorts.get(sessionId)
  if (existing) {
    existing.unsub()
    try {
      existing.port.close()
    } catch (err: unknown) {
      console.error('[SessionPort] Port close failed:', err)
      if (sentryInitialized) Sentry.captureException(err)
    }
    sessionPorts.delete(sessionId)
  }
  port.start()
  const entry: PortEntry = { port, unsub: () => {} }
  sessionPorts.set(sessionId, entry)

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
          entry.unsub()
          if (sessionPorts.get(sessionId) === entry) sessionPorts.delete(sessionId)
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
        sessionPorts.delete(sessionId)
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
    backgroundColor: '#000000',
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
    if (!existsSync(srcDir)) return
    const destDir = join(app.getPath('home'), '.cline', 'skills')
    mkdirSync(destDir, { recursive: true })
    const entries = await readdir(srcDir, { withFileTypes: true })
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const srcFile = join(srcDir, entry.name)
          const destFile = join(destDir, entry.name)
          await copyFile(srcFile, destFile)
        })
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
              shell: 'powershell'
            }
          }),
          askQuestion: async (question, options, context) =>
            new Promise<string>((resolve) => {
              const id = randomUUID()
              const sessionId = context?.sessionId ?? ''
              const settle = (answer: string): void => {
                const pending = pendingQuestions.get(id)
                if (!pending) return
                clearTimeout(pending.timer)
                pendingQuestions.delete(id)
                pending.resolve(answer)
              }
              const timer = setTimeout(
                () => {
                  settle('No response was provided.')
                  sendToRenderer('ask-question:dismiss', { id })
                },
                10 * 60 * 1000
              )
              pendingQuestions.set(id, { resolve, timer, sessionId })
              if (!mainWindow || mainWindow.isDestroyed()) settle('No response was provided.')
              else sendToRenderer('ask-question', { id, sessionId, question, options })
            })
        }
      }
    })
    cline = core
    console.log('[Main] ClineCore ready')
    return core
  })()
  try {
    return await clineInitPromise
  } catch (err: unknown) {
    clineInitPromise = undefined
    Sentry.captureException(err)
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
    Sentry.captureException(err)
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
  const path = join(app.getPath('userData'), 'sandbox')
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
  return path
}

async function buildSessionConfig(
  sessionId: string,
  workspacePath: string | undefined,
  model: ModelConfig,
  session: AuthSession,
  metadata?: any
): Promise<CoreSessionConfig> {
  const baseUrl = serviceUrl(`${model.provider}/v1`)
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!baseUrl || !anonKey) throw new Error('The application server configuration is incomplete.')
  const rawEffort = metadata && metadata.reasoningEffort !== undefined ? metadata.reasoningEffort : model.reasoningEffort
  const reasoningEffort = getReasoningEffort(rawEffort)
  let workspaceMetadata: string | undefined
  if (workspacePath) {
    try {
      const { buildWorkspaceMetadata } = await import('@cline/core')
      workspaceMetadata = await buildWorkspaceMetadata(workspacePath)
    } catch (err: unknown) {
      console.error('[SessionConfig] Failed to build workspace metadata:', err)
    }
  }
  let extraTools: any[] = []
  try {
    const { getExtraTools } = await import('./extraTools')
    extraTools = getExtraTools(session.accessToken, sessionId)
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
    yolo: true,
    maxIterations: 100,
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
  const sanitized = (images ?? [])
    .filter((image) => {
      if (typeof image !== 'string') return false
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image)) return false
      if (image.length > 15 * 1024 * 1024) return false
      const key = `${image.length}:${image.slice(0, 64)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_ATTACHMENTS)
  return sanitized.length ? sanitized : undefined
}

async function sanitizeUserFiles(files: string[] | undefined): Promise<string[] | undefined> {
  const candidates = (files ?? [])
    .filter((file) => typeof file === 'string' && file.trim().length > 0 && file.length <= 4_096)
    .map((file) => file.trim())
    .slice(0, MAX_ATTACHMENTS)
  const dedupe = Array.from(new Set(candidates))
  const allowed = await Promise.all(
    dedupe.map(async (file) => ((await isPathAllowed(file)) ? file : null))
  )
  const sanitized = allowed.filter((f): f is string => f !== null)
  return sanitized.length ? sanitized : undefined
}

async function readViewableFile(filePath: string): Promise<string | undefined> {
  try {
    if (!(await isPathAllowed(filePath))) {
      console.error('[FileRead] Path not allowed:', filePath)
      return undefined
    }
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_VIEWABLE_FILE_BYTES) return undefined
    const content = await readFile(filePath, 'utf-8')
    return content.includes('\0') ? undefined : content
  } catch (err: unknown) {
    if (sentryInitialized) Sentry.captureException(err)
    return undefined
  }
}


function isTrustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const win = mainWindow
  if (!win || win.isDestroyed()) return false
  return event.sender === win.webContents && isRendererUrl(event.senderFrame?.url ?? '')
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
      if (!isTrustedSender(event)) return defaultVal
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
  safeIpc('workspace:add-folder', async (_, { path: fp, name }) => addWorkspaceFolder(fp, name), false)
  safeIpc(
    'workspace:remove-folder',
    async (_, { path: fp }) => {
      const manifest = await loadManifest()
      if (manifest.workspaces[fp]) {
        delete manifest.workspaces[fp]
        if (manifest.currentWorkspacePath === fp) delete manifest.currentWorkspacePath
        await saveManifest(manifest)
        return true
      }
      return false
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
      const results: { sessionId: string; title: string; role: string; text: string }[] = []
      await Promise.all(
        raw
          .filter((s) => s.status !== 'idle')
          .map(async (s) => {
            try {
              const msgs = await core.readMessages(s.sessionId)
              for (const m of msgs) {
                if (results.length >= 200) return
                let text = ''
                if (typeof m.content === 'string') {
                  text = m.content
                } else if (Array.isArray(m.content)) {
                  for (const part of m.content) {
                    if (part.type === 'text') text += part.text
                    else if (part.type === 'thinking') text += part.thinking
                    else if (part.type === 'tool_result' && typeof part.content === 'string') text += part.content
                    if (text.length > 4000) break
                  }
                }
                if (text && text.toLowerCase().includes(q)) {
                  results.push({
                    sessionId: s.sessionId,
                    title: s.metadata?.title || 'Untitled',
                    role: m.role || 'assistant',
                    text: text.slice(0, 300)
                  })
                }
              }
            } catch {
            }
          })
      )
      return results
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
    const url = new URL(`${supabaseUrl}/auth/v1/authorize`)
    url.searchParams.set('provider', 'google')
    url.searchParams.set('redirect_to', 'orchcode://auth-callback')
    await shell.openExternal(url.toString())
  })
  safeIpc('auth:get-session', () => refreshAuthSessionIfNeeded(), undefined)
  safeIpc('auth:sign-out', async () => {
    await clearAuthSession()
    cachedModels = undefined
    cachedModelsAt = 0
    sendToRenderer('auth:change', undefined)
  })
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
        Sentry.captureException(err)
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
      draftSessions.set(sessionId, { title: normalizedTitle, workspacePath, modelKey })
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
      if (draftSessions.delete(sessionId)) return true
      const deleted = await (await initClineCore()).delete(sessionId)
      if (!deleted) return false
      activeClineSessions.delete(sessionId)
      sessionStartLocks.delete(sessionId)
      resolvePendingQuestionsForSession(sessionId, 'Session was deleted.')
      const e = sessionPorts.get(sessionId)
      if (e) {
        e.unsub()
        try {
          e.port.close()
        } catch (err: unknown) {
          console.error('[SessionDelete] Port close failed:', err)
          Sentry.captureException(err)
        }
        sessionPorts.delete(sessionId)
      }
      return true
    },
    false
  )
  safeIpc(
    'session:abort',
    async (_, { sessionId }) => {
      if (draftSessions.has(sessionId)) {
        draftSessions.delete(sessionId)
        return true
      }
      try {
        await (await initClineCore()).abort(sessionId)
        return true
      } catch (err: unknown) {
        console.error('[SessionAbort] Abort failed:', err)
        Sentry.captureException(err)
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
        Sentry.captureException(err)
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
        Sentry.captureException(err)
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
        Sentry.captureException(err)
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
      const fp = result.filePaths[0], name = basename(fp)
      const ok = await addWorkspaceFolder(fp, name)
      if (ok) {
        const manifest = await loadManifest()
        return manifest.workspaces[fp]
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
        Sentry.captureException(err)
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
      let core!: ClineCore
      const draft = draftSessions.get(sessionId)
      if (draft) {
        const existing = draftStartLocks.get(sessionId)
        if (existing) {
          const ok = await existing
          if (!ok) return false
          core = await ensureSessionIsActive(sessionId)
        } else {
          const draftStartPromise = (async (): Promise<boolean> => {
            try {
              const models = await fetchModelsList()
              if (!models || Object.keys(models).length === 0) return false
              const modelKey = draft.modelKey || Object.keys(models)[0]
              const mCfg = models[modelKey]
              if (!mCfg) return false
              const session = await refreshAuthSessionIfNeeded()
              if (!session) return false
              core = await initClineCore()
              draftSessions.delete(sessionId)
              try {
                await core.start({
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
              } catch (err: unknown) {
                console.error('[SessionSend] Draft start failed:', err)
                if (sentryInitialized) Sentry.captureException(err)
                return false
              }
              activeClineSessions.add(sessionId)
              return true
            } finally {
              draftStartLocks.delete(sessionId)
            }
          })()
          draftStartLocks.set(sessionId, draftStartPromise)
          const ok = await draftStartPromise
          if (!ok) return false
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
  ipcMain.on('session:register-port', (event, { sessionId }: { sessionId: string }) => {
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
}



if (is.dev) app.commandLine.appendSwitch('remote-debugging-port', '9222')

app.whenReady().then(async () => {
  await loadEnv()
  electronApp.setAppUserModelId('live.orch.app')
  app.on('browser-window-created', (_, win) => optimizer.watchWindowShortcuts(win))
  setupAutoUpdater()
  registerIpcHandlers()
  createWindow()
  const startupUrl = process.argv.find((arg) => arg.startsWith('orchcode://'))
  if (startupUrl) void handleAuthCallback(startupUrl)
  setTimeout(() => {
    initClineCore().catch((err: unknown) => {
      console.error('[Main] ClineCore init failed:', err)
      Sentry.captureException(err)
    })

    setTimeout(
      () =>
        autoUpdater.checkForUpdates().catch((err: unknown) => {
          console.error('[Main] Startup update check failed:', err)
          Sentry.captureException(err)
        }),
      3000
    )
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
    for (const entry of sessionPorts.values()) {
      try {
        entry.unsub()
      } catch (err: unknown) {
        console.error('[Quit] unsub failed:', err)
        Sentry.captureException(err)
      }
      try {
        entry.port.close()
      } catch (err: unknown) {
        console.error('[Quit] port close failed:', err)
        Sentry.captureException(err)
      }
    }
    sessionPorts.clear()
    try {
      await Promise.race([
        cline?.dispose(),
        new Promise<void>((resolve) => setTimeout(resolve, 6000))
      ])
    } catch (err: unknown) {
      console.error('[Quit] Cline dispose failed:', err)
      Sentry.captureException(err)
    } finally {
      clearTimeout(forceExit)
      app.exit(0)
    }
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
