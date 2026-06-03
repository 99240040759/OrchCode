import 'dotenv/config'
import { init as initSentry } from '@sentry/electron'
import crypto from 'crypto'
import { app, shell, BrowserWindow, WebContentsView, ipcMain, dialog } from 'electron'
import { join, extname } from 'path'
import { promises as fs, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initUpdater } from './updater'
import { initAuth, loadSession, getCurrentSession } from './auth'
import windowStateKeeper from 'electron-window-state'
import log from 'electron-log'
import icon from '../../resources/icon.png?asset'
import {
  getOrCreateWorkspaceContext,
  updateWorkspacePath,
  getWorkspaceContext,
  assertWithinWorkspace,
  listWorkspaceFiles
} from './workspace'

import {
  streamText,
  generateText,
  stepCountIs,
  ModelMessage,
  ToolCallPart,
  ToolResultPart
} from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  createCoreTools,
  browserTools,
  startBrowserAgentWorker,
  stopBrowserAgentWorker
} from './tools'
import {
  getThreads,
  getThread,
  getThreadMessages,
  deleteThread,
  saveMessage,
  updateThreadTitle,
  setThreadWorkspace,
  getThreadWorkspace,
  getUniqueWorkspaces,
  checkpointDB,
  deleteWorkspaceThreads,
  addOpenedWorkspace,
  deleteOpenedWorkspace,
  updateThreadAccumulatedTokens
} from './db'

import pty from 'node-pty'

initSentry({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN && (app.isPackaged || process.env.NODE_ENV === 'production'),
  tracesSampleRate: 1.0
})

log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.info('[main] Orch-Code starting...')

app.commandLine.appendSwitch('remote-debugging-port', '9222')
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')

import { chatStreamLimiter, tavilyLimiter, geminiLimiter, nvidiaLimiter } from './limiters'
import { createOpenAI } from '@ai-sdk/openai'
export { tavilyLimiter }

export const google = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: (url, options) => {
    return geminiLimiter.schedule(async () => {
      const isCompaction = options?.headers && (options.headers as any)['x-in-flight-compaction']
      let bodyText = options?.body
      if (bodyText && typeof bodyText === 'string' && !isCompaction) {
        bodyText = await compactClientPayloadIfNeeded(bodyText)
      }
      const headers = new Headers(options?.headers || {})
      headers.set('Authorization', `Bearer ${process.env.SUPABASE_ANON_KEY}`)
      headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
      return fetch(url, { ...options, body: bodyText, headers })
    })
  }
})

export const nvidia = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/nvidia/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) => {
    return nvidiaLimiter.schedule(async () => {
      const isCompaction = options?.headers && (options.headers as any)['x-in-flight-compaction']
      let bodyText = options?.body
      if (bodyText && typeof bodyText === 'string' && !isCompaction) {
        bodyText = await compactClientPayloadIfNeeded(bodyText)
      }
      const headers = new Headers(options?.headers || {})
      headers.set('Authorization', `Bearer ${process.env.SUPABASE_ANON_KEY}`)
      headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
      return fetch(url, { ...options, body: bodyText, headers })
    })
  }
})

async function compactClientPayloadIfNeeded(bodyText: string): Promise<string> {
  if (!bodyText) return bodyText

  try {
    const json = JSON.parse(bodyText)
    const THRESHOLD_CHARS = 400000 // ~100k tokens
    if (bodyText.length < THRESHOLD_CHARS) {
      return bodyText
    }

    log.info(`[client-compaction] Payload size (${bodyText.length} chars) exceeds threshold. Compacting in-flight...`)

    let isGoogleFormat = false
    let messages: any[] = []
    let systemPrompt = ""

    if (Array.isArray(json.contents)) {
      isGoogleFormat = true
      messages = json.contents
      systemPrompt = json.systemInstruction?.parts?.[0]?.text || ""
    } else if (Array.isArray(json.messages)) {
      messages = json.messages
      const systemMsg = messages.find((m: any) => m.role === 'system')
      systemPrompt = systemMsg?.content || ""
    } else {
      return bodyText // Unknown format
    }

    if (messages.length < 8) {
      return bodyText
    }

    const KEEP_RECENT = 4
    const endIndex = messages.length - KEEP_RECENT
    const startIndex = (isGoogleFormat ? 0 : (messages[0]?.role === 'system' ? 1 : 0))

    if (endIndex <= startIndex) {
      return bodyText
    }

    const messagesToCompact = messages.slice(startIndex, endIndex)
    const recentMessages = messages.slice(endIndex)

    const transcript = messagesToCompact
      .map((m: any) => {
        let role = m.role || 'user'
        if (role === 'model') role = 'assistant'
        
        let contentStr = ""
        if (typeof m.content === 'string') {
          contentStr = m.content
        } else if (Array.isArray(m.content)) {
          contentStr = m.content
            .map((part: any) => part.text || part.image || "")
            .join("\n")
        } else if (Array.isArray(m.parts)) {
          contentStr = m.parts
            .map((part: any) => part.text || "")
            .join("\n")
        }

        let text = `[${role.toUpperCase()}] ${contentStr}`
        return text
      })
      .join('\n\n')

    const compactionPrompt = `Analyze the provided conversation history and compile a detailed, high-fidelity, high-density semantic state summary.
Avoid vague generalizations. Do NOT sacrifice depth, detail, or file paths.

Ensure you fully document:
1. PRIMARY GOAL: What core problem or features did the user request?
2. ARCHITECTURAL DECISIONS: What specific files, schemas, or styles were designed or modified?
3. SUCCESSFUL MUTATIONS: What files were created or edited? List exact paths.
4. REMAINING TASK STATE: Exact technical state, checklists, and next step.

Conversation turns to summarize:
${transcript}`

    log.info(`[client-compaction] Calling local Gemini to compile compaction summary...`)
    
    const result = await generateText({
      model: google('gemini-3.1-flash-lite'),
      prompt: compactionPrompt,
      headers: { 'x-in-flight-compaction': 'true' }
    })

    const summaryText = result.text?.trim()
    if (!summaryText) {
      throw new Error("Empty summary returned from local Gemini")
    }

    log.info(`[client-compaction] Compaction succeeded! Summary size: ${summaryText.length} chars`)

    const compactionHeader = `\n\n── HISTORICAL CONVERSATION COMPACTION SUMMARY ──\nPrior conversation compacted to save context. Summary of what was accomplished:\n\n${summaryText}\n\nKeep this context in mind when handling the user's next request.`

    const newSystemPrompt = systemPrompt + compactionHeader

    if (isGoogleFormat) {
      json.systemInstruction = {
        parts: [{ text: newSystemPrompt }]
      }
      json.contents = recentMessages
    } else {
      let systemMsg = messages.find((m: any) => m.role === 'system')
      if (systemMsg) {
        systemMsg.content = newSystemPrompt
      } else {
        systemMsg = { role: 'system', content: newSystemPrompt }
      }
      
      const cleanRecent = recentMessages.filter((m: any) => m.role !== 'system')
      json.messages = [systemMsg, ...cleanRecent]
    }

    return JSON.stringify(json)
  } catch (err) {
    log.error(`[client-compaction] In-flight compaction failed:`, err)
    return bodyText
  }
}

export function resolveModel(modelId: string): {
  model: Parameters<typeof streamText>[0]['model']
  providerOptions: any
} {
  if (modelId.startsWith('nvidia/')) {
    return {
      model: nvidia.chat(modelId.replace('nvidia/', '')),
      providerOptions: {}
    }
  }

  if (modelId.startsWith('gemma-4') || modelId.includes('gemma-4')) {
    return {
      model: google(modelId),
      providerOptions: {
        google: {
          chatTemplateKwargs: { enable_thinking: true }
        }
      }
    }
  }

  const isThinkingModel = modelId.includes('thinking') || modelId.includes('pro')

  if (isThinkingModel) {
    return {
      model: google(modelId),
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: 'auto',
            includeThoughts: true
          }
        }
      }
    }
  }

  return {
    model: google(modelId),
    providerOptions: {}
  }
}

interface ModelInfo {
  id: string
  name: string
}

type AvailableModels = Record<string, ModelInfo>

let cachedModels: AvailableModels | null = null
let cachedModelsAt = 0
const MODELS_TTL_MS = 5 * 60 * 1000

export async function getAvailableModels(force = false): Promise<AvailableModels> {
  if (!force && cachedModels && Date.now() - cachedModelsAt < MODELS_TTL_MS) return cachedModels
  const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/models`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` }
  })
  if (!response.ok) throw new Error(`Failed to fetch models: HTTP ${response.status}`)
  cachedModels = await response.json()
  cachedModelsAt = Date.now()
  return cachedModels!
}

const activeAbortControllers = new Map<string, AbortController>()
let mainWindow: BrowserWindow | null = null
const activePtys = new Map<string, ReturnType<typeof pty.spawn>>()
let browserView: WebContentsView | null = null
let onboardingWindow: BrowserWindow | null = null

export function invalidateWorkspaceCache(_conversationId: string) {}

function cleanupAllPtys() {
  activePtys.forEach((p) => {
    try {
      if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT')
      else p.kill()
    } catch {
      try {
        p.kill()
      } catch {}
    }
  })
  activePtys.clear()
}

async function pushArtifactsChanged(conversationId: string): Promise<void> {
  if (!mainWindow) return
  const ctx = getWorkspaceContext(conversationId)
  if (!ctx) return
  try {
    const entries = await fs.readdir(ctx.artifactsPath, { withFileTypes: true })
    const artifacts = await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const p = join(ctx.artifactsPath, e.name)
          const stat = await fs.stat(p)
          return { name: e.name, path: p, size: stat.size, modified: stat.mtime.toISOString() }
        })
    )
    // Include conversationId so renderer can filter and only update the correct panel
    mainWindow.webContents.send('artifacts:changed', { conversationId, artifacts })
  } catch {}
}

function createOnboardingWindow(): BrowserWindow {
  onboardingWindow = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 480,
    minHeight: 680,
    maxWidth: 480,
    maxHeight: 680,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: '#0f0f11',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  onboardingWindow.on('ready-to-show', () => {
    onboardingWindow!.show()
    log.info('[main] Onboarding Window ready')
  })
  onboardingWindow.on('closed', () => {
    onboardingWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    onboardingWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?view=onboarding')
  } else {
    onboardingWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view: 'onboarding' }
    })
  }
  return onboardingWindow
}

function createMainWindow(): BrowserWindow {
  const mainWindowState = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 800 })

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: '#1a1a1a',
            symbolColor: '#b4b4b4',
            height: 40
          }
        : false,
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: '#0f0f11',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  ;(globalThis as any).mainWindow = mainWindow
  mainWindowState.manage(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    log.info('[main] Window ready')
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    if (browserView) {
      try {
        browserView.webContents.close()
      } catch {}
      browserView = null
    }
    cleanupAllPtys()
    mainWindow = null
    ;(globalThis as any).mainWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

ipcMain.handle('workspace:select', async (_event, conversationId: string) => {
  const result = await dialog.showOpenDialog({
    title: 'Select Workspace Folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const selectedPath = result.filePaths[0]
  addOpenedWorkspace(selectedPath)
  const ctx = await updateWorkspacePath(conversationId, selectedPath)
  invalidateWorkspaceCache(conversationId)

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
  invalidateWorkspaceCache(conversationId)

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

    const mimes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4'
    }
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
        mimeType: mimes[ext] || 'application/octet-stream',
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
      const originalContent = execFileSync('git', ['show', `HEAD:${gitRelativePath}`], {
        cwd: workspaceRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
      return { content: originalContent }
    } catch {
      try {
        const rawContent = await fs.readFile(safePath, 'utf-8')
        return { content: rawContent }
      } catch (err2) {
        return { content: '' }
      }
    }
  } catch (err) {
    log.error('[main] file:read-original error:', err)
    return { content: '' }
  }
})

ipcMain.handle(
  'file:write',
  async (_event, filePath: string, content: string, conversationId?: string) => {
    try {
      const ctx =
        getWorkspaceContext(conversationId!) || (await getOrCreateWorkspaceContext(conversationId!))
      const safePath = assertWithinWorkspace(ctx.rootPath, filePath, conversationId)
      await fs.writeFile(safePath, content, 'utf-8')
      invalidateWorkspaceCache(conversationId!)
      pushArtifactsChanged(conversationId!)
      log.info(`[main] Direct edit saved: ${safePath}`)
      return true
    } catch (err: any) {
      log.error('[main] file:write error:', err)
      throw err
    }
  }
)

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

ipcMain.handle('mastra:get-unique-workspaces', async () => {
  try {
    return await getUniqueWorkspaces()
  } catch {
    return []
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

ipcMain.handle('models:get-available', async () => {
  return await getAvailableModels()
})

ipcMain.handle('mastra:generate-title', async (_event, { text, threadId }) => {
  try {
    const models = await getAvailableModels()
    const availableModelsList = Object.values(models)
    if (availableModelsList.length === 0) throw new Error('No models configured on server.')
    const result = await generateText({
      model: resolveModel('gemini-3.1-flash-lite').model,
      prompt: `Generate a short 3-6 word title for this conversation. No quotes, no punctuation at end. Just the title.\n\n${text}`
    })
    const title = result.text?.trim() ?? null
    if (title) await updateThreadTitle(threadId, title)
    return title
  } catch (err) {
    log.error('[main] Title generation error:', err)
    return null
  }
})

async function handleAgentStreamRequest(
  event: any,
  promptText: string,
  threadId: string,
  _mode?: string,
  modelType?: string,
  attachments?: Array<{
    type: 'image' | 'document'
    name: string
    mimeType?: string
    base64: string
  }>
) {
  log.info(`[main] Stream request: "${promptText.slice(0, 80)}" thread: "${threadId}"`)

  const existingController = activeAbortControllers.get(threadId)
  if (existingController) existingController.abort()

  const controller = new AbortController()
  activeAbortControllers.set(threadId, controller)

  const convId = threadId

  try {
    const wsPath = getThreadWorkspace(convId)
    if (wsPath) await updateWorkspacePath(convId, wsPath)
  } catch (err) {
    log.warn(`[main] Failed to bind workspace for stream ${convId}:`, err)
  }

  let assistantMsgId = ''
  let assistantContent = ''
  const orderedBlocks: any[] = []

  try {
    const history = await getThreadMessages(convId)

    const userMsgId = crypto.randomUUID()
    const attachmentsData =
      attachments && attachments.length > 0 ? JSON.stringify({ attachments }) : undefined
    await saveMessage(convId, {
      id: userMsgId,
      role: 'user',
      content: promptText,
      data: attachmentsData
    })

    const ctx = getWorkspaceContext(convId) || (await getOrCreateWorkspaceContext(convId))
    if (ctx.isUserWorkspace && !getThreadWorkspace(convId)) {
      try {
        setThreadWorkspace(convId, ctx.rootPath)
        addOpenedWorkspace(ctx.rootPath)
        log.info(`[main] Auto-bound thread ${convId} to workspace ${ctx.rootPath}`)
      } catch (err) {
        log.warn('[main] Auto-bind thread to workspace failed:', err)
      }
    }

    const activeHistory = history

    const messages: ModelMessage[] = []

    for (const m of activeHistory) {
      if (m.role === 'user') {
        let userContent: any = m.content
        if (m.data) {
          try {
            const dataObj = JSON.parse(m.data)
            if (dataObj && Array.isArray(dataObj.attachments) && dataObj.attachments.length > 0) {
              const parts: any[] = [{ type: 'text', text: m.content }]
              for (const att of dataObj.attachments) {
                if (att.type === 'image') {
                  parts.push({
                    type: 'image',
                    image: Buffer.from(att.base64, 'base64'),
                    mimeType: att.mimeType || 'image/png'
                  })
                } else if (att.type === 'document') {
                  try {
                    const fileContent = Buffer.from(att.base64, 'base64').toString('utf-8')
                    parts[0].text += `\n\n--- Attached Document: ${att.name} ---\n${fileContent}\n--- End of Document ---`
                  } catch {}
                }
              }
              userContent = parts
            }
          } catch {}
        }
        messages.push({ role: 'user', content: userContent })
      } else if (m.role === 'assistant') {
        let textContent = ''
        const toolCalls: ToolCallPart[] = []
        const toolResults: ToolResultPart[] = []
        let parsedBlocks: any[] | null = null

        if (m.data) {
          try {
            const blocks = JSON.parse(m.data)
            if (Array.isArray(blocks)) {
              parsedBlocks = blocks
              for (const block of blocks) {
                if (block.type === 'text') {
                  textContent += block.content
                } else if (block.type === 'tool') {
                  toolCalls.push({
                    type: 'tool-call',
                    toolCallId: block.toolCallId,
                    toolName: block.toolName,
                    input: block.args
                  })
                  const isError = block.status === 'error'
                  const outputVal = block.result
                  let formattedOutput: any

                  if (
                    outputVal &&
                    typeof outputVal === 'object' &&
                    'type' in outputVal &&
                    [
                      'text',
                      'json',
                      'execution-denied',
                      'error-text',
                      'error-json',
                      'content'
                    ].includes((outputVal as any).type)
                  ) {
                    formattedOutput = outputVal
                  } else if (
                    block.toolName === 'browserScreenshot' &&
                    outputVal?.success &&
                    outputVal?.filePath
                  ) {
                    try {
                      const cleanPath = outputVal.filePath.replace('file://', '')
                      const base64Image = readFileSync(cleanPath).toString('base64')
                      formattedOutput = {
                        type: 'content',
                        value: [
                          { type: 'image-data', data: base64Image, mediaType: 'image/png' },
                          { type: 'text', text: `Screenshot: ${outputVal.filePath}` }
                        ]
                      }
                    } catch (err: any) {
                      formattedOutput = {
                        type: 'content',
                        value: [{ type: 'text', text: `Failed to read screenshot: ${err.message}` }]
                      }
                    }
                  } else if (
                    block.toolName === 'viewFile' &&
                    outputVal?.isBinary &&
                    outputVal?.mimeType?.startsWith('image/') &&
                    outputVal?.base64Content
                  ) {
                    formattedOutput = {
                      type: 'content',
                      value: [
                        {
                          type: 'image-data',
                          data: outputVal.base64Content,
                          mediaType: outputVal.mimeType
                        },
                        { type: 'text', text: `Analyzed binary image: ${outputVal.absolutePath}` }
                      ]
                    }
                  } else {
                    formattedOutput = isError
                      ? typeof outputVal === 'string'
                        ? { type: 'error-text' as const, value: outputVal }
                        : { type: 'error-json' as const, value: outputVal ?? null }
                      : typeof outputVal === 'string'
                        ? { type: 'text' as const, value: outputVal }
                        : { type: 'json' as const, value: outputVal ?? null }
                  }

                  toolResults.push({
                    type: 'tool-result',
                    toolCallId: block.toolCallId,
                    toolName: block.toolName,
                    output: formattedOutput
                  })
                }
              }
            }
          } catch {}
        }

        const hasTextBlock = parsedBlocks && parsedBlocks.some((b: any) => b.type === 'text')
        if (!textContent && !hasTextBlock) textContent = m.content

        const resultIds = new Set(toolResults.map((r) => r.toolCallId))
        const pairedCalls = toolCalls.filter((c) => resultIds.has(c.toolCallId))
        const pairedResults = toolResults.filter((r) =>
          pairedCalls.some((c) => c.toolCallId === r.toolCallId)
        )

        let finalAssistantContent: string | Array<any>
        if (pairedCalls.length > 0) {
          const parts: Array<any> = []
          if (textContent) parts.push({ type: 'text', text: textContent })
          for (const call of pairedCalls) parts.push(call)
          finalAssistantContent = parts
        } else {
          finalAssistantContent = textContent || ''
        }

        messages.push({ role: 'assistant', content: finalAssistantContent })
        if (pairedResults.length > 0) messages.push({ role: 'tool', content: pairedResults })
      } else {
        messages.push({ role: m.role, content: m.content })
      }
    }

    let promptContent: any = promptText
    if (attachments && attachments.length > 0) {
      const parts: any[] = [{ type: 'text', text: promptText }]
      for (const att of attachments) {
        if (att.type === 'image') {
          parts.push({
            type: 'image',
            image: Buffer.from(att.base64, 'base64'),
            mimeType: att.mimeType || 'image/png'
          })
        } else if (att.type === 'document') {
          try {
            const fileContent = Buffer.from(att.base64, 'base64').toString('utf-8')
            parts[0].text += `\n\n--- Attached Document: ${att.name} ---\n${fileContent}\n--- End of Document ---`
          } catch {}
        }
      }
      promptContent = parts
    }
    messages.push({ role: 'user', content: promptContent })

    let browserInstruction = ''
    if (browserView) {
      browserInstruction = `\n── BROWSER AUTOMATION ACTIVE ──
You have active browser control. Use these tools:
1. browserNavigate(url): Open pages.
2. browserType(selector, text, frameSelector?): Type into inputs, pierce iframes.
3. browserScroll(direction, amount?): Scroll to load lazy elements.
4. browserMouseClickCoordinate(x, y, button?): Click absolute pixel coordinates.
5. browserScreenshot(): ALWAYS capture a screenshot after navigation/typing to verify page state.`
    }
    const systemInstruction = `You are Orch Code, a highly capable AI developer assistant. Active conversation ID: ${convId}.

── WORKSPACE ──
Root path: ${ctx.rootPath || 'No workspace selected'}

IMPORTANT: Use searchWorkspace(query) to find files or code by pattern. Use listDir(directoryPath) to explore directories. Do NOT assume file contents — always read before editing.
${browserInstruction}

── ARTIFACT BOUNDARIES & WORKFLOW ──
Use the sandboxed Artifacts system inside '.orch-artifacts/' folder of the active workspace.
Use writeToFile, replaceFileContent tools to manage these artifact files:

1. [PLANNING]: For any non-trivial changes, create or update an implementation plan at '.orch-artifacts/implementation_plan.md'.
   - Stop and wait for user approval (they have Proceed/Reject buttons in the panel).
   - Do NOT modify source files until you receive approval.

2. [NO WALKTHROUGHS]: Never create or edit walkthrough markdown files.

Follow these boundaries strictly to manage your work professionally and transparently!

── CRITICAL TOOL SELECTION RULE ──
You must ALWAYS use native function calling tools (e.g. viewFile, writeToFile, replaceFileContent, searchWorkspace, listDir) for reading, writing, editing, or searching files. 
Do NOT execute terminal/shell commands (like type, cat, Get-Content, gc, head, etc. via runCommand) for file operations. 
Using runCommand to read/view files is STRICTLY forbidden and causes severe memory issues. Use runCommand ONLY for running tests, compilers, formatters, and environment setup.`

    const models = await getAvailableModels()
    const availableModelsList = Object.values(models)
    if (availableModelsList.length === 0) throw new Error('No models configured on server.')
    const rawModel = models[modelType || ''] || availableModelsList[0]
    if (!rawModel) throw new Error('Failed to resolve model.')

    const coreTools = createCoreTools(convId)
    const activeTools = {
      ...coreTools,
      ...(browserView ? browserTools(convId) : {})
    }

    const { model: resolvedModel, providerOptions: modelProviderOptions } = resolveModel(
      rawModel.id
    )

    log.info(`[vercel-ai-sdk] streamText request model: ${rawModel.id}`)
    log.info(`[vercel-ai-sdk] providerOptions: ${JSON.stringify(modelProviderOptions)}`)
    log.info(`[vercel-ai-sdk] systemInstruction length: ${systemInstruction.length}`)
    log.info(`[vercel-ai-sdk] total messages count: ${messages.length}`)

    const result = streamText({
      model: resolvedModel,
      system: systemInstruction,
      messages,
      tools: activeTools,
      stopWhen: stepCountIs(100), // Agent will loop automatically up to 100 times
      abortSignal: controller.signal,

      ...(Object.keys(modelProviderOptions).length > 0
        ? { providerOptions: modelProviderOptions }
        : {})
    })

    assistantMsgId = crypto.randomUUID()

    let currentReasoningStartMs = 0
    let turnPromptTokens = 0
    let turnCompletionTokens = 0
    let textDeltaCount = 0

    const saveProgress = async () => {
      const blocksSnapshot = [...orderedBlocks]
      const contentSnapshot = assistantContent
      if (contentSnapshot || blocksSnapshot.length > 0) {
        try {
          await saveMessage(convId, {
            id: assistantMsgId,
            role: 'assistant',
            content: contentSnapshot || '',
            data: JSON.stringify(blocksSnapshot)
          })
        } catch (saveErr) {
          log.error('[main] Progressive save failed:', saveErr)
        }
      }
    }

    for await (const part of result.fullStream) {
      if (controller.signal.aborted) break
      log.info(`[vercel-ai-sdk] part: ${JSON.stringify(part)}`)

      if (part.type === 'reasoning-start') {
        currentReasoningStartMs = Date.now()
        orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0 })
        event.sender.send('agent:stream-chunk', { type: 'reasoning-start', threadId: convId })
      } else if (part.type === 'reasoning-delta') {
        const textDelta = part.text || ''
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') {
          last.content += textDelta
          last.durationMs = Date.now() - currentReasoningStartMs
        }
        event.sender.send('agent:stream-chunk', {
          type: 'reasoning-delta',
          payload: textDelta,
          threadId: convId
        })
      } else if (part.type === 'reasoning-end') {
        event.sender.send('agent:stream-chunk', { type: 'reasoning-end', threadId: convId })
        await saveProgress()
      } else if (part.type === 'text-delta') {
        const textDelta = part.text || ''
        assistantContent += textDelta
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: textDelta })
        else last.content += textDelta
        event.sender.send('agent:stream-chunk', {
          type: 'text-delta',
          payload: textDelta,
          threadId: convId
        })
        // Live-save every 10 text deltas to preserve progress
        textDeltaCount++
        if (textDeltaCount % 10 === 0) {
          await saveProgress()
        }
      } else if (part.type === 'tool-call') {
        log.info(`[main] Tool: ${part.toolName} (${part.toolCallId})`)
        orderedBlocks.push({
          type: 'tool',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.input,
          status: 'pending'
        })
        event.sender.send('agent:stream-chunk', {
          type: 'tool-call',
          payload: { toolCallId: part.toolCallId, toolName: part.toolName, args: part.input },
          threadId: convId
        })
        await saveProgress()
      } else if (part.type === 'tool-result') {
        log.info(`[main] Tool result: ${part.toolName}`)
        const block = orderedBlocks.find(
          (b) => b.type === 'tool' && b.toolCallId === part.toolCallId
        )
        if (block) {
          block.result = part.output
          block.status = 'complete'
        }
        event.sender.send('agent:stream-chunk', {
          type: 'tool-result',
          payload: { toolCallId: part.toolCallId, result: part.output },
          threadId: convId
        })

        const writingTools = ['writeToFile', 'replaceFileContent', 'multiReplaceFileContent']
        if (writingTools.includes(part.toolName)) {
          invalidateWorkspaceCache(convId)
          pushArtifactsChanged(convId)
        }
        await saveProgress()
      } else if (part.type === 'error') {
        const errorMsg =
          part.error instanceof Error ? part.error.message : String(part.error || 'Unknown error')
        log.error(`[main] Stream error: "${errorMsg}"`)
        for (const block of orderedBlocks) {
          if (block.type === 'tool' && block.status === 'pending') block.status = 'error'
        }
        event.sender.send('agent:stream-chunk', {
          type: 'error',
          payload: errorMsg,
          threadId: convId
        })
      } else if (part.type === 'finish') {
        const usage = part.totalUsage || {}
        turnPromptTokens = usage.inputTokens || 0
        turnCompletionTokens = usage.outputTokens || 0
        const turnTotal = turnPromptTokens + turnCompletionTokens

        try {
          updateThreadAccumulatedTokens(convId, turnTotal)
        } catch (dbErr) {
          log.error('[main] Failed to save active session token count:', dbErr)
        }

        const finishReason = (part as any).finishReason ?? (part as any).reason ?? ''
        if (finishReason === 'length') {
          // Model-level token length limit (not our step limit — we removed that)
          log.warn(`[main] Model hit token length limit for thread ${convId}`)
          event.sender.send('agent:stream-chunk', { type: 'step-limit', threadId: convId })
        }

        log.info(`[main] Stream finish — turn: ${turnTotal} tokens`)

        event.sender.send('agent:stream-chunk', {
          type: 'finish',
          payload: {
            usage: {
              promptTokens: turnPromptTokens,
              completionTokens: turnCompletionTokens,
              totalTokens: turnTotal
            },
            accumulatedTokens: turnTotal,
            compactionTriggered: false
          },
          threadId: convId
        })
        await saveProgress()
      }
    }

    await saveProgress()
  } catch (err: any) {
    log.error('[main] Stream error:', err)
    if (err.name !== 'AbortError') {
      for (const block of orderedBlocks) {
        if (block.type === 'tool' && block.status === 'pending') {
          block.status = 'error'
        }
      }

      if (assistantContent || orderedBlocks.length > 0) {
        try {
          await saveMessage(convId, {
            id: assistantMsgId,
            role: 'assistant',
            content: assistantContent || '[Stream Error]',
            data: JSON.stringify(orderedBlocks)
          })
        } catch {}
      }
      event.sender.send('agent:stream-chunk', {
        type: 'error',
        payload: err.message,
        threadId: convId
      })
    }
  } finally {
    activeAbortControllers.delete(convId)
  }
}

ipcMain.handle(
  'agent:stream-request',
  async (
    event,
    promptText: string,
    threadId: string,
    mode?: string,
    modelType?: string,
    attachments?: any[]
  ) => {
    const session = getCurrentSession()
    if (!session) throw new Error('Unauthorized: Please sign in to use agents.')
    return chatStreamLimiter.schedule(() =>
      handleAgentStreamRequest(event, promptText, threadId, mode, modelType, attachments)
    )
  }
)

ipcMain.handle('agent:stream-stop', (_event, threadId?: string) => {
  if (threadId) {
    const controller = activeAbortControllers.get(threadId)
    if (controller) {
      controller.abort()
      activeAbortControllers.delete(threadId)
    }
  } else {
    activeAbortControllers.forEach((c) => c.abort())
    activeAbortControllers.clear()
  }
})

ipcMain.handle('artifacts:list', async (_event, conversationId: string) => {
  const ctx = getWorkspaceContext(conversationId)
  if (!ctx) return []
  try {
    const entries = await fs.readdir(ctx.artifactsPath, { withFileTypes: true })
    return Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const p = join(ctx.artifactsPath, e.name)
          const stat = await fs.stat(p)
          return { name: e.name, path: p, size: stat.size, modified: stat.mtime.toISOString() }
        })
    )
  } catch {
    return []
  }
})

ipcMain.handle(
  'terminal:create',
  (
    event,
    {
      cols,
      rows,
      cwd,
      conversationId
    }: { cols: number; rows: number; cwd?: string; conversationId?: string }
  ) => {
    const id = `pty-${crypto.randomUUID()}`
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh')

    const convCtx = conversationId ? getWorkspaceContext(conversationId) : undefined
    const workingDir =
      cwd || (convCtx?.isUserWorkspace ? convCtx.rootPath : undefined) || process.env.HOME || '/'

    log.info(`[terminal] Spawning ${shell} in ${workingDir} (${cols}x${rows})`)

    let ptyProcess: any
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: Math.max(cols, 10),
        rows: Math.max(rows, 3),
        cwd: workingDir,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      })
    } catch (err: any) {
      log.error('[terminal:create] Failed to spawn PTY shell:', err)
      throw new Error(`Failed to initialize shell process: ${err.message}`)
    }

    activePtys.set(id, ptyProcess)

    let dataListener: any
    const destroyListener = () => {
      try {
        if (dataListener) dataListener.dispose()
        if (process.platform !== 'win32') process.kill(-ptyProcess.pid, 'SIGINT')
        else ptyProcess.kill()
      } catch {
        try {
          ptyProcess.kill()
        } catch {}
      }
      activePtys.delete(id)
    }
    event.sender.once('destroyed', destroyListener)

    dataListener = ptyProcess.onData((data) => {
      if (event.sender.isDestroyed()) {
        destroyListener()
        event.sender.off('destroyed', destroyListener)
        return
      }
      try {
        event.sender.send('terminal:data', { id, data })
      } catch {}
    })

    ptyProcess.onExit(({ exitCode }) => {
      event.sender.off('destroyed', destroyListener)
      activePtys.delete(id)
      try {
        event.sender.send('terminal:exit', { id, exitCode })
      } catch {}
      log.info(`[terminal] PTY ${id} exited with code ${exitCode}`)
    })

    return { id }
  }
)

ipcMain.handle('terminal:input', (_event, { id, data }: { id: string; data: string }) => {
  try {
    activePtys.get(id)?.write(data)
  } catch (err) {
    log.error(`[terminal:input] error writing to ${id}:`, err)
  }
})

ipcMain.handle(
  'terminal:resize',
  (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    try {
      const p = activePtys.get(id)
      if (p) p.resize(Math.max(cols, 10), Math.max(rows, 3))
    } catch (err) {
      log.error(`[terminal:resize] error resizing ${id}:`, err)
    }
  }
)

ipcMain.handle('terminal:close', (_event, { id }: { id: string }) => {
  const p = activePtys.get(id)
  if (p) {
    try {
      if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT')
      else p.kill()
    } catch {
      try {
        p.kill()
      } catch {}
    }
    activePtys.delete(id)
  }
})

ipcMain.handle(
  'browser:open',
  (
    event,
    {
      url,
      bounds
    }: { url: string; bounds: { x: number; y: number; width: number; height: number } }
  ) => {
    if (!mainWindow) return

    if (browserView) {
      browserView.setBounds(bounds)
      browserView.webContents.loadURL(url || 'about:blank')
      return
    }

    browserView = new WebContentsView({
      webPreferences: {
        webSecurity: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    ;(globalThis as any).browserView = browserView

    mainWindow.contentView.addChildView(browserView)
    browserView.setBounds(bounds)
    browserView.webContents.loadURL(url || 'https://google.com')

    browserView.webContents.on('page-title-updated', (_e, title) => {
      try {
        event.sender.send('browser:title-updated', title)
      } catch {}
    })
    browserView.webContents.on('did-navigate', (_e, navUrl) => {
      try {
        event.sender.send('browser:url-changed', navUrl)
      } catch {}
      try {
        const worker = startBrowserAgentWorker()
        if (worker) worker.syncUrl(navUrl).catch(() => {})
      } catch {}
    })
    browserView.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      try {
        event.sender.send('browser:url-changed', navUrl)
      } catch {}
      try {
        const worker = startBrowserAgentWorker()
        if (worker) worker.syncUrl(navUrl).catch(() => {})
      } catch {}
    })

    log.info(`[browser] Opened: ${url}`)
    startBrowserAgentWorker()
  }
)

ipcMain.handle('browser:navigate', (_event, url: string) => {
  if (browserView) browserView.webContents.loadURL(url.startsWith('http') ? url : `https://${url}`)
})
ipcMain.handle('browser:back', () => {
  if (browserView?.webContents.canGoBack()) browserView.webContents.goBack()
})
ipcMain.handle('browser:forward', () => {
  if (browserView?.webContents.canGoForward()) browserView.webContents.goForward()
})
ipcMain.handle('browser:reload', () => {
  browserView?.webContents.reload()
})
ipcMain.handle(
  'browser:resize',
  (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    browserView?.setBounds(bounds)
  }
)
ipcMain.handle('browser:close', () => {
  if (browserView && mainWindow) {
    try {
      mainWindow.contentView.removeChildView(browserView)
      browserView.webContents.close()
    } catch {}
    browserView = null
    ;(globalThis as any).browserView = null
    log.info('[browser] Closed')
    stopBrowserAgentWorker()
  }
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.orchcode.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  log.info('[main] App ready — initializing modules')

  initUpdater()
  initAuth()

  const session = await loadSession()
  if (session) {
    createMainWindow()
  } else {
    createOnboardingWindow()
  }

  ;(app as any).on('auth:open-main-and-close-onboarding', () => {
    log.info('[main] Onboarding completed, transitioning to main window...')
    const main = createMainWindow()
    main.once('ready-to-show', () => {
      main.show()
      if (onboardingWindow) {
        onboardingWindow.close()
        onboardingWindow = null
      }
    })
  })
  ;(app as any).on('auth:logged-out', () => {
    log.info('[main] User logged out, showing onboarding window...')
    createOnboardingWindow()
    if (mainWindow) {
      mainWindow.close()
      mainWindow = null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (getCurrentSession()) createMainWindow()
      else createOnboardingWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    cleanupAllPtys()
    log.info('[main] Cleaned up — quitting')
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanupAllPtys()
  checkpointDB()
})
