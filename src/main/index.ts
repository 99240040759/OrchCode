import 'dotenv/config'
import { init as initSentry } from '@sentry/electron'
import crypto from 'crypto'
import { app, shell, BrowserWindow, WebContentsView, ipcMain, dialog } from 'electron'
import { join, extname } from 'path'
import { promises as fs, readFileSync } from 'fs'
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
  setActiveConversationId,
  serializeWorkspace,
  assertWithinWorkspace,
  listWorkspaceFiles
} from './workspace'

import { streamText, generateText, ModelMessage, ToolCallPart, ToolResultPart, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createCoreTools, browserTools, startBrowserAgentWorker, stopBrowserAgentWorker } from './tools'

import {
  getThreads,
  getThreadMessages,
  deleteThread,
  saveMessage,
  updateThreadTitle,
  setThreadWorkspace,
  getThreadWorkspace,
  getUniqueWorkspaces,
  deleteWorkspaceThreads,
  addOpenedWorkspace,
  deleteOpenedWorkspace,
  getThreadCompactionSummary,
  updateThreadCompactionSummary,
  getLastCompactedMessageId,
  updateThreadAccumulatedTokens,
  getThreadAccumulatedTokens
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
// CDP bound explicitly to loopback only — required for Playwright browser automation
app.commandLine.appendSwitch('remote-debugging-port', '9222')
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')

let activeConversationId = `session-${Date.now()}`
setActiveConversationId(activeConversationId)

function setActiveSession(id: string) {
  activeConversationId = id
  setActiveConversationId(id)
  try {
    const wsPath = getThreadWorkspace(id)
    if (wsPath) {
      updateWorkspacePath(id, wsPath)
    }
  } catch (err) {
    log.warn(`[main] Failed to auto-bind workspace for session ${id}:`, err)
  }
}

const workspaceSerializationCache = new Map<string, { serialized: string; timestamp: number }>()

export function invalidateWorkspaceCache(conversationId: string) {
  workspaceSerializationCache.delete(conversationId)
}

import { chatStreamLimiter, tavilyLimiter, geminiLimiter } from './limiters'
export { tavilyLimiter }

const google = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: (url, options) => {
    return geminiLimiter.schedule(() => {
      const headers = new Headers(options?.headers || {})
      headers.set('Authorization', `Bearer ${process.env.SUPABASE_ANON_KEY}`)
      headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
      return fetch(url, { ...options, headers })
    })
  }
})

let cachedModels: { gemini?: { id: string; name: string }; gemma?: { id: string; name: string } } | null = null
let cachedModelsAt = 0
const MODELS_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function getAvailableModels(): Promise<{ gemini?: { id: string; name: string }; gemma?: { id: string; name: string } }> {
  if (cachedModels && Date.now() - cachedModelsAt < MODELS_TTL_MS) return cachedModels
  const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/models`, {
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`)
  }
  cachedModels = await response.json()
  cachedModelsAt = Date.now()
  return cachedModels!
}

const activeAbortControllers = new Map<string, AbortController>()

let mainWindow: BrowserWindow | null = null

const activePtys = new Map<string, ReturnType<typeof pty.spawn>>()
 

let browserView: WebContentsView | null = null

function cleanupAllPtys() {
  activePtys.forEach((p) => {
    try {
      if (process.platform !== 'win32') {
        process.kill(-p.pid, 'SIGINT')
      } else {
        p.kill()
      }
    } catch {
      try { p.kill() } catch {}
    }
  })
  activePtys.clear()
}

let onboardingWindow: BrowserWindow | null = null

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
    backgroundColor: '#1e1e1e',
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
    log.info('[main] Onboarding Window ready to show')
  })

  onboardingWindow.on('closed', () => {
    onboardingWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    onboardingWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?view=onboarding')
  } else {
    onboardingWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'onboarding' } })
  }

  return onboardingWindow
}

function createMainWindow(): BrowserWindow {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 800
  })

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
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#0f0f11',
      symbolColor: '#9c9c9c',
      height: 38
    } : false,
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: '#1e1e1e',
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
    log.info('[main] Window ready to show')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    if (browserView) {
      try { browserView.webContents.close() } catch {}
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
    mainWindow.webContents.send('artifacts:changed', artifacts)
  } catch {}
}

ipcMain.handle('workspace:select', async (_event, conversationId: string) => {
  const result = await dialog.showOpenDialog({
    title: 'Select Workspace Folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const selectedPath = result.filePaths[0]
  addOpenedWorkspace(selectedPath)

  const convId = conversationId || activeConversationId
  const ctx = updateWorkspacePath(convId, selectedPath)

  try {
    setThreadWorkspace(convId, selectedPath)
  } catch (err) {
    log.warn('[main] Could not bind thread to workspace:', err)
  }

  log.info(`[main] Workspace updated to: ${selectedPath}`)
  return ctx
})

ipcMain.handle('file:read', async (_event, filePath: string, conversationId?: string) => {
  try {
    const convId = conversationId || activeConversationId
    const ctx = getWorkspaceContext(convId) || getOrCreateWorkspaceContext(convId)
    const safePath = assertWithinWorkspace(ctx.rootPath, filePath, convId)

    const rawBuffer = await fs.readFile(safePath)
    const isBinary = rawBuffer.subarray(0, 512).includes(0x00)
    const filename = safePath.split(/[/\\]/).pop() ?? ''
    const ext = extname(safePath).toLowerCase()

    const mimes: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4'
    }
    const mimeType = mimes[ext] || 'application/octet-stream'

    if (isBinary) {
      return { name: filename, path: safePath, isBinary: true, mimeType, base64: rawBuffer.toString('base64') }
    } else {
      const languages: Record<string, string> = {
        '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
        '.json': 'json', '.css': 'css', '.html': 'html', '.md': 'markdown',
        '.py': 'python', '.rs': 'rust', '.go': 'go', '.sh': 'shell',
        '.yaml': 'yaml', '.yml': 'yaml'
      }
      return {
        name: filename, path: safePath, isBinary: false,
        content: rawBuffer.toString('utf-8'),
        language: languages[ext] || 'plaintext'
      }
    }
  } catch (err: any) {
    log.error(`[main] file:read error:`, err)
    throw err
  }
})

ipcMain.handle('file:read-original', async (_event, filePath: string, conversationId?: string) => {
  try {
    const convId = conversationId || activeConversationId
    const ctx = getWorkspaceContext(convId) || getOrCreateWorkspaceContext(convId)
    const safePath = assertWithinWorkspace(ctx.rootPath, filePath, convId)
    const workspaceRoot = ctx.rootPath

    // Get relative path from workspace root
    let relativePath = safePath
    if (relativePath.startsWith(workspaceRoot)) {
      relativePath = relativePath.slice(workspaceRoot.length)
    }
    // Remove leading slash if any
    if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      relativePath = relativePath.slice(1)
    }
    // Normalize path separators to forward slashes for git
    relativePath = relativePath.replace(/\\/g, '/')

    const { execSync } = require('child_process')
    try {
      const originalContent = execSync(`git show HEAD:"${relativePath}"`, {
        cwd: workspaceRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'] // ignore stderr, return stdout
      })
      return { content: originalContent }
    } catch (gitErr) {
      // If git show fails (e.g. file is untracked/new), return empty content
      return { content: '' }
    }
  } catch (err) {
    log.error(`[main] file:read-original error:`, err)
    return { content: '' }
  }
})

ipcMain.handle('file:write', async (_event, filePath: string, content: string, conversationId?: string) => {
  try {
    const convId = conversationId || activeConversationId
    const ctx = getWorkspaceContext(convId) || getOrCreateWorkspaceContext(convId)
    const safePath = assertWithinWorkspace(ctx.rootPath, filePath, convId)
    await fs.writeFile(safePath, content, 'utf-8')
    invalidateWorkspaceCache(convId)
    pushArtifactsChanged(convId)
    log.info(`[main] Direct edit saved: ${safePath}`)
    return true
  } catch (err: any) {
    log.error(`[main] file:write error:`, err)
    throw err
  }
})

ipcMain.handle('mastra:get-conversation-id', () => activeConversationId)

ipcMain.handle('session:set-active', (_event, threadId: string) => {
  setActiveSession(threadId)
  return true
})

ipcMain.handle('mastra:new-conversation', async () => {
  const newId = `session-${Date.now()}`
  setActiveSession(newId)
  getOrCreateWorkspaceContext(newId)
  log.info(`[main] New conversation: ${newId}`)
  return { conversationId: newId }
})

ipcMain.handle('mastra:get-threads', async () => {
  try { return await getThreads() } catch (err) { log.error('[main] getThreads:', err); return [] }
})

ipcMain.handle('mastra:get-thread-messages', async (_event, threadId: string) => {
  try { return await getThreadMessages(threadId) } catch (err) { log.error('[main] getThreadMessages:', err); return [] }
})

ipcMain.handle('mastra:delete-thread', async (_event, threadId: string) => {
  try { return await deleteThread(threadId) } catch (err) { log.error('[main] deleteThread:', err); return false }
})

ipcMain.handle('mastra:get-thread-workspace', async (_event, threadId: string) => {
  try { return getThreadWorkspace(threadId) } catch { return null }
})

ipcMain.handle('mastra:get-unique-workspaces', async () => {
  try { return await getUniqueWorkspaces() } catch { return [] }
})

ipcMain.handle('workspace:set-active', async (_event, { conversationId, workspacePath }) => {
  const convId = conversationId || activeConversationId
  // Do NOT call setActiveSession here — only the active stream-request should own the global session.
  // This handler only registers the workspace binding for the given conversationId.
  const ctx = updateWorkspacePath(convId, workspacePath)

  addOpenedWorkspace(workspacePath)

  try {
    setThreadWorkspace(convId, workspacePath)
  } catch (err) {
    log.warn('[main] Could not bind thread to workspace:', err)
  }

  log.info(`[main] Workspace bound: conv=${convId} path=${workspacePath}`)
  return ctx
})

ipcMain.handle('workspace:list-files', async (_event, conversationId: string) => {
  const convId = conversationId || activeConversationId
  const ctx = getWorkspaceContext(convId) || getOrCreateWorkspaceContext(convId)
  if (!ctx || !ctx.rootPath) return []
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
        log.info(`[main] Purged conversation directory: ${targetDir}`)
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

ipcMain.handle('dialog:confirm', async (_event, opts: { message: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number }) => {
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
})

ipcMain.handle('models:get-available', async () => {
  return await getAvailableModels()
})

ipcMain.handle('mastra:generate-title', async (_event, { text, threadId }) => {
  try {
    const models = await getAvailableModels()
    if (!models.gemini) throw new Error('Gemini model name not configured on server.')
    const result = await generateText({
      model: google(models.gemini.id),
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

async function handleAgentStreamRequest(event: any, promptText: string, threadId: string, mode?: string, modelType?: string, attachments?: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }>) {
  log.info(`[main] Stream request: "${promptText.slice(0, 80)}" thread: "${threadId}" with ${attachments?.length || 0} attachments`)

  const existingController = activeAbortControllers.get(threadId)
  if (existingController) existingController.abort()

  const controller = new AbortController()
  activeAbortControllers.set(threadId, controller)

  // Sync the workspace module's global activeConversationId to this thread
  // so tools like browserScreenshot save to the correct conversation directory
  setActiveSession(threadId)

  try {
    const history = await getThreadMessages(threadId)
    const userMsgId = `user-${Date.now()}`
    const attachmentsData = attachments && attachments.length > 0 ? JSON.stringify({ attachments }) : undefined
    await saveMessage(threadId, { id: userMsgId, role: 'user', content: promptText, data: attachmentsData })

    const convId = threadId
    const ctx = getWorkspaceContext(convId) || getOrCreateWorkspaceContext(convId)
    if (ctx.isUserWorkspace && !getThreadWorkspace(threadId)) {
      try {
        setThreadWorkspace(threadId, ctx.rootPath)
        addOpenedWorkspace(ctx.rootPath)
        log.info(`[main] Auto-bound thread ${threadId} to workspace ${ctx.rootPath}`)
      } catch (err) {
        log.warn('[main] Auto-bind thread to workspace failed:', err)
      }
    }

    let activeHistory = history
    const lastCompactedId = getLastCompactedMessageId(threadId)
    let compactionIndex = -1
    if (lastCompactedId) {
      compactionIndex = history.findIndex((m) => m.id === lastCompactedId)
      if (compactionIndex !== -1) {
        // Slice EXCLUSIVE of the compaction anchor message itself
        // to avoid sending it twice (once in systemInstruction summary, once in history)
        activeHistory = history.slice(compactionIndex + 1)
      }
    }
 
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
        messages.push({
          role: 'user',
          content: userContent
        })
      } else if (m.role === 'assistant') {
        // Derive text EXCLUSIVELY from blocks to avoid content-column duplication (#4 fix)
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
                    ['text', 'json', 'execution-denied', 'error-text', 'error-json', 'content'].includes((outputVal as any).type)
                  ) {
                    formattedOutput = outputVal
                  } else if (
                    block.toolName === 'browserScreenshot' &&
                    outputVal &&
                    typeof outputVal === 'object' &&
                    outputVal.success &&
                    outputVal.filePath
                  ) {
                    try {
                      const cleanPath = outputVal.filePath.replace('file://', '')
                      const base64Image = readFileSync(cleanPath).toString('base64')
                      formattedOutput = {
                        type: 'content',
                        value: [
                          { type: 'image-data', data: base64Image, mediaType: 'image/png' },
                          { type: 'text', text: `Screenshot captured: ${outputVal.filePath}` }
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
                    outputVal &&
                    typeof outputVal === 'object' &&
                    outputVal.isBinary &&
                    outputVal.mimeType?.startsWith('image/') &&
                    outputVal.base64Content
                  ) {
                    formattedOutput = {
                      type: 'content',
                      value: [
                        { type: 'image-data', data: outputVal.base64Content, mediaType: outputVal.mimeType },
                        { type: 'text', text: `Successfully analyzed binary image: ${outputVal.absolutePath}` }
                      ]
                    }
                  } else {
                    formattedOutput = isError
                      ? (typeof outputVal === 'string'
                          ? { type: 'error-text' as const, value: outputVal }
                          : { type: 'error-json' as const, value: outputVal === undefined ? null : outputVal })
                      : (typeof outputVal === 'string'
                          ? { type: 'text' as const, value: outputVal }
                          : { type: 'json' as const, value: outputVal === undefined ? null : outputVal })
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

        // If no text blocks were found in the stored blocks, use the raw content column
        // (legacy messages or turns that had only tool calls with no accompanying text).
        // Do NOT use a magic string sentinel — check the blocks array directly.
        const hasTextBlock = parsedBlocks && parsedBlocks.some((b: any) => b.type === 'text')
        if (!textContent && !hasTextBlock) {
          textContent = m.content
        }

        // Pairing validation: only include calls that have a matching result (#25 fix)
        const resultIds = new Set(toolResults.map((r) => r.toolCallId))
        const pairedCalls = toolCalls.filter((c) => resultIds.has(c.toolCallId))
        const pairedResults = toolResults.filter((r) => pairedCalls.some((c) => c.toolCallId === r.toolCallId))

        let finalAssistantContent: string | Array<any>
        if (pairedCalls.length > 0) {
          const parts: Array<any> = []
          if (textContent) {
            parts.push({ type: 'text', text: textContent })
          }
          for (const call of pairedCalls) {
            parts.push(call)
          }
          finalAssistantContent = parts
        } else {
          finalAssistantContent = textContent || '[Action Taken]'
        }

        messages.push({
          role: 'assistant',
          content: finalAssistantContent
        })

        if (pairedResults.length > 0) {
          messages.push({
            role: 'tool',
            content: pairedResults
          })
        }
      } else {
        messages.push({
          role: m.role,
          content: m.content
        })
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

    let contextBlock = ''
    if (ctx.rootPath) {
      const cached = workspaceSerializationCache.get(convId)
      if (cached && Date.now() - cached.timestamp < 30000) {
        contextBlock = cached.serialized
      } else {
        try {
          contextBlock = await serializeWorkspace(ctx.rootPath)
          workspaceSerializationCache.set(convId, { serialized: contextBlock, timestamp: Date.now() })
        } catch (err) {
          log.error('[main] serializeWorkspace failed:', err)
        }
      }
    }

    const modeSuffix = mode && mode !== 'undefined' ? `\nMode: ${mode}.` : ''
    let browserInstruction = ''
    if (browserView) {
      browserInstruction = `\n── BROWSER AUTOMATION ACTIVE ──
You currently have active eyes and hands in the browser panel. Use the 5 core browser tools to complete tasks:
1. 'browserNavigate(url)': Open pages.
2. 'browserType(selector, text, frameSelector?)': Pierce frames natively by providing optional frameSelector (e.g. 'iframe#payment-frame') to target nested input elements and pierce shadow DOMs.
3. 'browserScroll(direction, amount?)': Scroll 'up', 'down', 'left', 'right' to load lazy elements or view hidden content.
4. 'browserMouseClickCoordinate(x, y, button?)': Click absolute pixel coordinates with left/right/middle click buttons. Use to click elements, buttons, links, or canvas structures visualised on your screenshot.
5. 'browserScreenshot()': Visual feedback. ALWAYS capture a screenshot after significant navigation, typing, or scrolling to visually verify the page state.`
    }

    let compactionInstruction = ''
    if (compactionIndex !== -1) {
      const compactionSummary = getThreadCompactionSummary(threadId)
      if (compactionSummary) {
        compactionInstruction = `\n── HISTORICAL CONVERSATION COMPACTION SUMMARY ──
The conversation history prior to this point has been compacted to save context tokens. Here is a high-density semantic summary of what has been accomplished so far:

${compactionSummary}

Keep this historical context in mind when answering the user's immediate next request.`
      }
    }
 
    const systemInstruction = `You are Antigravity, a highly capable developer coding assistant. Active conversation ID: ${convId}.${modeSuffix}
You have native access to the active workspace context below. Use it to answer questions accurately:
 
${contextBlock || 'No workspace files available. The user has not opened a workspace yet.'}
${browserInstruction}
${compactionInstruction ? `\n${compactionInstruction}` : ''}

── ARTIFACT BOUNDARIES & WORKFLOW COMPLIANCE ──
You must always structure your software development flow using the sandboxed Artifacts system inside the '.orch-artifacts/' folder of the active workspace.
Use your existing file-writing tools ('writeToFile', 'replaceFileContent', etc.) to manage these artifact files:

1. [PLANNING]: For any non-trivial architectural changes, feature additions, or complex debugging tasks, you MUST first create or update an implementation plan at '.orch-artifacts/implementation_plan.md'.
   - The user will view this in their Split-Screen Artifact Panel.
   - It should contain clear descriptions of proposed changes, component impacts, and verification methods.
   - You must stop and explicitly wait for the user to approve or reject the plan (they have convenient "Proceed" and "Reject" buttons inside the panel that will message you directly). Do not modify codebase source files until you receive approval!

2. [NO WALKTHROUGHS]: Never create or edit walkthrough markdown files. They are completely redundant and not needed.

Follow these native planning boundaries strictly to manage your work professionally and transparently!`

    const models = await getAvailableModels()
    const rawModel = modelType === 'gemma' ? models.gemma : models.gemini
    if (!rawModel) throw new Error(`${modelType} model name not configured on server.`)
 
    const coreTools = createCoreTools(convId)
    const activeTools = {
      ...coreTools,
      ...(browserView ? browserTools : {})
    }

    const result = streamText({
      model: google(rawModel.id),
      system: systemInstruction,
      messages,
      tools: activeTools,
      stopWhen: stepCountIs(50),
      abortSignal: controller.signal
    })

    const assistantMsgId = `assistant-${Date.now()}`

    const saveProgress = async () => {
      if (assistantContent || orderedBlocks.length > 0) {
        try {
          await saveMessage(threadId, {
            id: assistantMsgId,
            role: 'assistant',
            content: assistantContent || '[Action Taken]',
            data: JSON.stringify(orderedBlocks)
          })
        } catch (saveErr) {
          log.error('[main] Progressive save failed:', saveErr)
        }
      }
    }

    let assistantContent = ''
    const orderedBlocks: any[] = []
    let currentReasoningStartMs = 0

    let turnPromptTokens = 0
    let turnCompletionTokens = 0

    for await (const part of result.fullStream) {
      if (controller.signal.aborted) break

      if (part.type === 'reasoning-start') {
        currentReasoningStartMs = Date.now()
        orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0 })
        event.sender.send('agent:stream-chunk', { type: 'reasoning-start', threadId })
      } else if (part.type === 'reasoning-delta') {
        const textDelta = part.text || ''
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') { last.content += textDelta; last.durationMs = Date.now() - currentReasoningStartMs }
        event.sender.send('agent:stream-chunk', { type: 'reasoning-delta', payload: textDelta, threadId })
      } else if (part.type === 'reasoning-end') {
        event.sender.send('agent:stream-chunk', { type: 'reasoning-end', threadId })
        await saveProgress()
      } else if (part.type === 'text-delta') {
        const textDelta = part.text || ''
        assistantContent += textDelta
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: textDelta })
        else last.content += textDelta
        event.sender.send('agent:stream-chunk', { type: 'text-delta', payload: textDelta, threadId })
      } else if (part.type === 'tool-call') {
        log.info(`[main] Tool: ${part.toolName} (${part.toolCallId})`)
        orderedBlocks.push({ type: 'tool', toolCallId: part.toolCallId, toolName: part.toolName, args: part.input, status: 'pending' })
        event.sender.send('agent:stream-chunk', { type: 'tool-call', payload: { toolCallId: part.toolCallId, toolName: part.toolName, args: part.input }, threadId })
        await saveProgress()
      } else if (part.type === 'tool-result') {
        log.info(`[main] Tool result: ${part.toolName}`)
        const block = orderedBlocks.find((b) => b.type === 'tool' && b.toolCallId === part.toolCallId)
        if (block) { block.result = part.output; block.status = 'complete' }
        event.sender.send('agent:stream-chunk', { type: 'tool-result', payload: { toolCallId: part.toolCallId, result: part.output }, threadId })

        const writingTools = ['writeToFile', 'replaceFileContent', 'multiReplaceFileContent']
        if (writingTools.includes(part.toolName)) {
          invalidateWorkspaceCache(convId)
          pushArtifactsChanged(convId)
        }
        await saveProgress()
      } else if (part.type === 'error') {
        const errorMsg = part.error instanceof Error ? part.error.message : String(part.error || 'Unknown error')
        log.error(`[main] Stream error: "${errorMsg}"`)
        for (const block of orderedBlocks) {
          if (block.type === 'tool' && block.status === 'pending') {
            block.status = 'error'
          }
        }
        event.sender.send('agent:stream-chunk', { type: 'error', payload: errorMsg, threadId })
      } else if (part.type === 'finish') {
        const usage = part.totalUsage || {}
        turnPromptTokens = usage.inputTokens || 0
        turnCompletionTokens = usage.outputTokens || 0
        const turnTotal = turnPromptTokens + turnCompletionTokens

        let finalAccumulated = turnTotal
        try {
          const currentAcc = getThreadAccumulatedTokens(threadId)
          finalAccumulated = currentAcc + turnTotal
        } catch (dbErr) {
          log.error('[main] Failed to read native accumulated tokens:', dbErr)
        }

        let compactionTriggered = false
        // Trigger compaction if the accumulated active tokens exceed 200,000 natively
        if (finalAccumulated >= 200_000) {
          compactionTriggered = true
          log.info(`[main] Compaction triggered at ${finalAccumulated} tokens for thread ${threadId}`)

          // Asynchronously compile semantic compaction summary using Gemini and write compaction marker
          triggerSemanticCompaction(threadId, assistantMsgId).catch((err) => {
            log.error('[main] Asynchronous semantic compaction summary failed:', err)
          })
        }

        log.info(`[main] Stream finish — turn: ${turnTotal} tokens`)

        try {
          updateThreadAccumulatedTokens(threadId, compactionTriggered ? 0 : finalAccumulated)
          log.info(`[main] Saved native token count (${compactionTriggered ? 0 : finalAccumulated}, added ${turnTotal}) to db for thread ${threadId}`)
        } catch (dbErr) {
          log.error('[main] Failed to save native accumulated tokens:', dbErr)
        }

        event.sender.send('agent:stream-chunk', {
          type: 'finish',
          payload: {
            usage: { promptTokens: turnPromptTokens, completionTokens: turnCompletionTokens, totalTokens: turnTotal },
            accumulatedTokens: compactionTriggered ? 0 : finalAccumulated,
            compactionTriggered
          },
          threadId
        })
        await saveProgress()
      }
    }

    if (!controller.signal.aborted) {
      await saveProgress()
    }
  } catch (err: any) {
    log.error('[main] Stream error:', err)
    if (err.name !== 'AbortError') {
      event.sender.send('agent:stream-chunk', { type: 'error', payload: err.message, threadId })
    }
  } finally {
    activeAbortControllers.delete(threadId)
  }
}

ipcMain.handle('agent:stream-request', async (event, promptText: string, threadId: string, mode?: string, modelType?: string, attachments?: any[]) => {
  const session = getCurrentSession()
  if (!session) {
    throw new Error('Unauthorized: Please sign in to use agents.')
  }
  return chatStreamLimiter.schedule(() =>
    handleAgentStreamRequest(event, promptText, threadId, mode, modelType, attachments)
  )
})

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
  const ctx = getWorkspaceContext(conversationId || activeConversationId)
  if (!ctx) return []
  try {
    const entries = await fs.readdir(ctx.artifactsPath, { withFileTypes: true })
    return Promise.all(
      entries.filter((e) => e.isFile()).map(async (e) => {
        const p = join(ctx.artifactsPath, e.name)
        const stat = await fs.stat(p)
        return { name: e.name, path: p, size: stat.size, modified: stat.mtime.toISOString() }
      })
    )
  } catch { return [] }
})

ipcMain.handle('terminal:create', (event, { cols, rows, cwd, conversationId }: { cols: number; rows: number; cwd?: string; conversationId?: string }) => {
  const id = `pty-${crypto.randomUUID()}`
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh')

  const convId = conversationId || activeConversationId
  const convCtx = getWorkspaceContext(convId)
  const workingDir = cwd || (convCtx?.isUserWorkspace ? convCtx.rootPath : undefined) || process.env.HOME || '/'

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
    log.error(`[terminal:create] Failed to spawn PTY shell:`, err)
    throw new Error(`Failed to initialize shell process: ${err.message}`)
  }

  activePtys.set(id, ptyProcess)

  let dataListener: any
  const destroyListener = () => {
    try {
      if (dataListener) dataListener.dispose()
      if (process.platform !== 'win32') {
        process.kill(-ptyProcess.pid, 'SIGINT')
      } else {
        ptyProcess.kill()
      }
    } catch {
      try { ptyProcess.kill() } catch {}
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
    try { event.sender.send('terminal:exit', { id, exitCode }) } catch {}
    log.info(`[terminal] PTY ${id} exited with code ${exitCode}`)
  })

  return { id }
})

ipcMain.handle('terminal:input', (_event, { id, data }: { id: string; data: string }) => {
  try {
    activePtys.get(id)?.write(data)
  } catch (err) {
    log.error(`[terminal:input] error writing to ${id}:`, err)
  }
})

ipcMain.handle('terminal:resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  try {
    const p = activePtys.get(id)
    if (p) p.resize(Math.max(cols, 10), Math.max(rows, 3))
  } catch (err) {
    log.error(`[terminal:resize] error resizing ${id}:`, err)
  }
})

ipcMain.handle('terminal:close', (_event, { id }: { id: string }) => {
  const p = activePtys.get(id)
  if (p) {
    try {
      if (process.platform !== 'win32') {
        process.kill(-p.pid, 'SIGINT')
      } else {
        p.kill()
      }
    } catch {
      try { p.kill() } catch {}
    }
    activePtys.delete(id)
  }
})

ipcMain.handle('browser:open', (event, { url, bounds }: { url: string; bounds: { x: number; y: number; width: number; height: number } }) => {
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
    try { event.sender.send('browser:title-updated', title) } catch {}
  })
  browserView.webContents.on('did-navigate', (_e, navUrl) => {
    try { event.sender.send('browser:url-changed', navUrl) } catch {}
    try {
      const worker = startBrowserAgentWorker()
      if (worker) worker.syncUrl(navUrl).catch(() => {})
    } catch {}
  })
  browserView.webContents.on('did-navigate-in-page', (_e, navUrl) => {
    try { event.sender.send('browser:url-changed', navUrl) } catch {}
    try {
      const worker = startBrowserAgentWorker()
      if (worker) worker.syncUrl(navUrl).catch(() => {})
    } catch {}
  })

  log.info(`[browser] Opened: ${url}`)
  startBrowserAgentWorker()
})

ipcMain.handle('browser:navigate', (_event, url: string) => {
  if (browserView) {
    const target = url.startsWith('http') ? url : `https://${url}`
    browserView.webContents.loadURL(target)
  }
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

ipcMain.handle('browser:resize', (_event, bounds: { x: number; y: number; width: number; height: number }) => {
  browserView?.setBounds(bounds)
})

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
  electronApp.setAppUserModelId('com.orch-code')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  log.info('[main] App ready — initializing modules')

  getOrCreateWorkspaceContext(activeConversationId)

  initUpdater()
  initAuth()

  // Asynchronously load active session
  const session = await loadSession()
  if (session) {
    createMainWindow()
  } else {
    createOnboardingWindow()
  }

  // Handle onboarding to main window transition beautifully
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

  // Handle logout transition
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
})
 
async function triggerSemanticCompaction(threadId: string, assistantMsgId: string): Promise<void> {
  log.info(`[compaction] Starting semantic summary generation for thread: ${threadId} (anchor message: ${assistantMsgId})`)
  try {
    const fullHistory = getThreadMessages(threadId)
    if (fullHistory.length === 0) return
 
    // 1. Find the index of the prior compaction using our fast SQL helper
    const lastCompactedId = getLastCompactedMessageId(threadId)
    let lastCompactionIndex = -1
    if (lastCompactedId) {
      lastCompactionIndex = fullHistory.findIndex((m) => m.id === lastCompactedId)
    }
 
    // 2. Identify the active active turns since the last compaction point
    const newTurns = lastCompactionIndex !== -1 
      ? fullHistory.slice(lastCompactionIndex + 1)
      : fullHistory
 
    const formattedHistory = newTurns.map((m) => {
      let text = `[${m.role.toUpperCase()}] ${m.content}`
      if (m.data) {
        try {
          const blocks = JSON.parse(m.data)
          if (Array.isArray(blocks)) {
            const tools = blocks.filter(b => b.type === 'tool')
            if (tools.length > 0) {
              text += `\n(Executed Tools: ${tools.map(t => `${t.toolName} -> ${t.status}`).join(', ')})`
            }
          }
        } catch {}
      }
      return text
    }).join('\n\n')
 
    // 3. Read the old compaction summary if it exists
    const oldSummary = lastCompactionIndex !== -1 ? getThreadCompactionSummary(threadId) : null
    const models = await getAvailableModels()
    if (!models.gemini) throw new Error('Gemini model name not configured on server.')
    const compactionModel = models.gemini.id
    
    log.info(`[compaction] Generating state summary using ${compactionModel}...`)
 
    let prompt = ''
    if (oldSummary) {
      prompt = `Here is a high-density summary of all accomplishments, files, and architectural decisions made in the conversation PRIOR to this segment:\n${oldSummary}\n\nHere are the new active conversation turns that occurred since that summary:\n${formattedHistory}\n\nYour task is to merge the previous summary and the new conversation turns into a single, unified, high-density state summary. Keep all core completed task logs, modified file path lists, and technical decisions intact while compressing the overall context size.`
    } else {
      prompt = `Here are the active conversation turns to summarize:\n${formattedHistory}\n\nYour task is to compile a high-density state summary from these turns. Highlight the goals, technical decisions, completed files, and immediate next steps.`
    }
 
    const result = await generateText({
      model: google(compactionModel),
      system: `You are an expert compiler of software agent states.
Analyze the provided conversation history segment and compile a high-density, structured semantic summary.
 
Strict focus on extracting:
1. PRIMARY GOAL: What core problem or features did the user request?
2. ARCHITECTURAL DECISIONS: What specific files, databases, schemas, or styles were designed or modified?
3. SUCCESSFUL MUTATIONS: What files/directories were viewed, created, or successfully edited?
4. PLAN PROGRESS: What tasks in the plan were completed, and which are still outstanding?
5. REMAINING TASK STATE: What is the exact technical state of the application right now, and what is the immediate next step?
 
Format the output strictly as a highly compressed, bulleted Markdown summary. Do not include introductory chat, conversation snippets, or pleasantries.`,
      prompt
    })
 
    const summaryText = result.text?.trim() ?? null
    if (summaryText) {
      updateThreadCompactionSummary(threadId, summaryText)
      log.info(`[compaction] Semantic summary compiled successfully for thread: ${threadId} (${summaryText.length} chars)`)

      // Mark the compaction boundary directly using the dedicated isCompactionAnchor column
      const compactionMsg = fullHistory.find((m) => m.id === assistantMsgId)
      if (compactionMsg) {
        saveMessage(threadId, {
          id: compactionMsg.id,
          role: compactionMsg.role,
          content: compactionMsg.content,
          data: compactionMsg.data,
          createdAt: compactionMsg.createdAt,
          isCompactionAnchor: true
        })
        log.info(`[compaction] Marked message ${assistantMsgId} as compaction anchor`)
      }
    }
  } catch (err) {
    log.error('[compaction] Failed to generate semantic summary:', err)
  }
}
