import 'dotenv/config'
import crypto from 'crypto'
import { app, shell, BrowserWindow, WebContentsView, ipcMain, dialog } from 'electron'
import { join, resolve, normalize, extname, dirname } from 'path'
import { promises as fs, realpathSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import windowStateKeeper from 'electron-window-state'
import log from 'electron-log'
import icon from '../../resources/icon.png?asset'
import {
  getOrCreateWorkspaceContext,
  updateWorkspacePath,
  getWorkspaceContext,
  setActiveConversationId,
  serializeWorkspace
} from './workspace'

import { streamText, type ModelMessage, stepCountIs, generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { tools } from './tools'

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
  deleteOpenedWorkspace
} from './db'

import pty from 'node-pty'

log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.info('[main] Orch-Code starting...')

let activeConversationId = `session-${Date.now()}`
setActiveConversationId(activeConversationId)

function setActiveSession(id: string) {
  activeConversationId = id
  setActiveConversationId(id)
}


const threadTokenAccumulator = new Map<string, number>()

const workspaceSerializationCache = new Map<string, { serialized: string; timestamp: number }>()

export function invalidateWorkspaceCache(conversationId: string) {
  workspaceSerializationCache.delete(conversationId)
}

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''
})
const TITLE_MODEL = process.env.GOOGLE_TITLE_MODEL_NAME as string

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

function createWindow(): BrowserWindow {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 820
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
      color: '#1e1e1e',
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
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const dir = dirname(filePath)
      try {
        const resolvedDir = realpathSync(dir)
        return join(resolvedDir, filePath.split(/[/\\]/).pop() ?? '')
      } catch {
        return filePath
      }
    }
    throw err
  }
}

function assertWithinWorkspace(rootPath: string, targetPath: string, conversationId?: string): string {
  const cid = conversationId || activeConversationId
  const wctx = getWorkspaceContext(cid) || getOrCreateWorkspaceContext(cid)

  const resolvedRoot = safeRealpathSync(resolve(rootPath))
  const resolvedTarget = safeRealpathSync(resolve(targetPath))
  const normalizedTarget = normalize(resolvedTarget)

  const resolvedArtifactsRoot = safeRealpathSync(resolve(wctx.artifactsPath))
  if (normalizedTarget.startsWith(resolvedArtifactsRoot + '/') || normalizedTarget === resolvedArtifactsRoot) {
    return normalizedTarget
  }

  if (normalizedTarget.includes('/.orch-artifacts/') || normalizedTarget.endsWith('/.orch-artifacts')) {
    const idx = normalizedTarget.indexOf('.orch-artifacts')
    const relativePart = normalizedTarget.substring(idx + '.orch-artifacts'.length)
    const secureRedirect = normalize(join(wctx.artifactsPath, relativePart))
    return secureRedirect
  }

  if (!normalizedTarget.startsWith(resolvedRoot + '/') && normalizedTarget !== resolvedRoot) {
    const errorMsg = `Path traversal blocked: "${targetPath}" resolves outside workspace root: "${resolvedRoot}"`
    log.error(`[security] ${errorMsg}`)
    throw new Error(errorMsg)
  }
  return normalizedTarget
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
  setActiveSession(convId)
  const ctx = updateWorkspacePath(convId, workspacePath)

  addOpenedWorkspace(workspacePath)

  try {
    setThreadWorkspace(convId, workspacePath)
  } catch (err) {
    log.warn('[main] Could not bind thread to workspace:', err)
  }

  log.info(`[main] Active session switched to: ${convId}, workspace: ${workspacePath}`)
  return ctx
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

ipcMain.handle('models:get-available', () => {
  return {
    gemini: process.env.GOOGLE_MODEL_NAME_GEMINI,
    gemma: process.env.GOOGLE_MODEL_NAME_GEMMA
  }
})

ipcMain.handle('mastra:generate-title', async (_event, { text, threadId }) => {
  try {
    const result = await generateText({
      model: google(TITLE_MODEL),
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

ipcMain.handle('agent:stream-request', async (event, promptText: string, threadId: string, mode?: string, modelType?: string) => {
  log.info(`[main] Stream request: "${promptText.slice(0, 80)}" thread: "${threadId}"`)

  const existingController = activeAbortControllers.get(threadId)
  if (existingController) existingController.abort()

  const controller = new AbortController()
  activeAbortControllers.set(threadId, controller)

  try {
    const history = await getThreadMessages(threadId)
    await saveMessage(threadId, { id: `user-${Date.now()}`, role: 'user', content: promptText })

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
    const compactionIndex = history.map((m) => {
      if (m.data) {
        try {
          const blocks = JSON.parse(m.data)
          if (Array.isArray(blocks) && blocks.some((b: any) => b.type === 'compaction')) return true
        } catch {}
      }
      return false
    }).lastIndexOf(true)

    if (compactionIndex !== -1) {
      activeHistory = history.slice(compactionIndex + 1)
    }

    const messages: ModelMessage[] = [
      ...activeHistory.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      })),
      { role: 'user', content: promptText }
    ]

    let contextBlock = ''
    if (ctx.rootPath) {
      const cached = workspaceSerializationCache.get(convId)
      if (cached && Date.now() - cached.timestamp < 10000) {
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

    const modeSuffix = mode ? `\nMode: ${mode}.` : ''
    const systemInstruction = `You are Antigravity, a highly capable developer coding assistant. Active conversation ID: ${convId}.${modeSuffix}
You have native access to the active workspace context below. Use it to answer questions accurately:

${contextBlock || 'No workspace files available. The user has not opened a workspace yet.'}

── ARTIFACT BOUNDARIES & WORKFLOW COMPLIANCE ──
You must always structure your software development flow using the sandboxed Artifacts system inside the '.orch-artifacts/' folder of the active workspace.
Use your existing file-writing tools ('writeToFile', 'replaceFileContent', etc.) to manage these artifact files:

1. [PLANNING]: For any non-trivial architectural changes, feature additions, or complex debugging tasks, you MUST first create or update an implementation plan at '.orch-artifacts/implementation_plan.md'.
   - The user will view this in their Split-Screen Artifact Panel.
   - It should contain clear descriptions of proposed changes, component impacts, and verification methods.
   - You must stop and explicitly wait for the user to approve or reject the plan (they have convenient "Proceed" and "Reject" buttons inside the panel that will message you directly). Do not modify codebase source files until you receive approval!

2. [EXECUTION]: Once the plan is approved, you MUST create or update a checklist at '.orch-artifacts/task.md' to keep track of your task progress.
   - This task board is shown live to the user in their Right Sidebar's "Tasks & Progress" checklist.
   - You must use standard markdown checklist syntax to let the app parse and display it perfectly:
     - \`- [ ] Uncompleted task\`
     - \`- [/] In-progress task\`
     - \`- [x] Completed task\`
   - Check off tasks (\`[x]\`) or mark them in-progress (\`[/]\`) incrementally as you work through the tasks, keeping the task board 100% synchronized with your actual status.

3. [NO WALKTHROUGHS]: Never create or edit walkthrough markdown files. They are completely redundant and not needed.

Follow these native planning boundaries strictly to manage your work professionally and transparently!`

    const modelEnvKey = modelType === 'gemma' ? 'GOOGLE_MODEL_NAME_GEMMA' : 'GOOGLE_MODEL_NAME_GEMINI'
    const selectedModel = process.env[modelEnvKey] as string

    const result = streamText({
      model: google(selectedModel),
      system: systemInstruction,
      messages,
      tools,
      stopWhen: stepCountIs(50),
      abortSignal: controller.signal
    })

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
        event.sender.send('agent:stream-chunk', { type: 'reasoning-start' })
      } else if (part.type === 'reasoning-delta') {
        const textDelta = (part as any).text || (part as any).textDelta || (part as any).delta || ''
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') { last.content += textDelta; last.durationMs = Date.now() - currentReasoningStartMs }
        event.sender.send('agent:stream-chunk', { type: 'reasoning-delta', payload: textDelta })
      } else if (part.type === 'reasoning-end') {
        event.sender.send('agent:stream-chunk', { type: 'reasoning-end' })
      } else if (part.type === 'text-delta') {
        const textDelta = (part as any).text || (part as any).textDelta || ''
        assistantContent += textDelta
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: textDelta })
        else last.content += textDelta
        event.sender.send('agent:stream-chunk', { type: 'text-delta', payload: textDelta })
      } else if (part.type === 'tool-call') {
        log.info(`[main] Tool: ${part.toolName} (${part.toolCallId})`)
        orderedBlocks.push({ type: 'tool', toolCallId: part.toolCallId, toolName: part.toolName, args: part.input, status: 'pending' })
        event.sender.send('agent:stream-chunk', { type: 'tool-call', payload: { toolCallId: part.toolCallId, toolName: part.toolName, args: part.input } })
      } else if (part.type === 'tool-result') {
        log.info(`[main] Tool result: ${part.toolName}`)
        const block = orderedBlocks.find((b) => b.type === 'tool' && b.toolCallId === part.toolCallId)
        if (block) { block.result = part.output; block.status = 'complete' }
        event.sender.send('agent:stream-chunk', { type: 'tool-result', payload: { toolCallId: part.toolCallId, result: part.output } })

        const writingTools = ['writeToFile', 'replaceFileContent', 'multiReplaceFileContent']
        if (writingTools.includes(part.toolName)) {
          invalidateWorkspaceCache(convId)
          pushArtifactsChanged(convId)
        }
      } else if (part.type === 'error') {
        const errorMsg = (part as any).error?.message || String((part as any).error || 'Unknown error')
        log.error(`[main] Stream error: "${errorMsg}"`)
        const block = orderedBlocks.find((b) => b.type === 'tool' && b.status === 'pending')
        if (block) block.status = 'error'
        event.sender.send('agent:stream-chunk', { type: 'error', payload: errorMsg })
      } else if (part.type === 'finish') {
        const usage = (part as any).totalUsage || (part as any).usage || {}
        turnPromptTokens = usage.inputTokens || usage.promptTokens || 0
        turnCompletionTokens = usage.outputTokens || usage.completionTokens || 0
        const turnTotal = turnPromptTokens + turnCompletionTokens

        const prevAccumulated = threadTokenAccumulator.get(threadId) || 0
        const newAccumulated = prevAccumulated + turnTotal

        let compactionTriggered = false
        if (newAccumulated >= 200_000 && !orderedBlocks.some((b: any) => b.type === 'compaction')) {
          orderedBlocks.push({ type: 'compaction' })
          threadTokenAccumulator.set(threadId, 0)
          compactionTriggered = true
          log.info(`[main] Compaction triggered at ${newAccumulated} tokens for thread ${threadId}`)
        } else {
          threadTokenAccumulator.set(threadId, newAccumulated)
        }

        log.info(`[main] Stream finish — turn: ${turnTotal} tokens, accumulated: ${newAccumulated}`)
        event.sender.send('agent:stream-chunk', {
          type: 'finish',
          payload: {
            usage: { promptTokens: turnPromptTokens, completionTokens: turnCompletionTokens, totalTokens: turnTotal },
            accumulatedTokens: compactionTriggered ? 0 : newAccumulated,
            compactionTriggered
          }
        })
      }
    }

    if ((assistantContent || orderedBlocks.length > 0) && !controller.signal.aborted) {
      await saveMessage(threadId, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: assistantContent || '[Action Taken]',
        data: JSON.stringify(orderedBlocks)
      })
    }
  } catch (err: any) {
    log.error('[main] Stream error:', err)
    if (err.name !== 'AbortError') {
      event.sender.send('agent:stream-chunk', { type: 'error', payload: err.message })
    }
  } finally {
    activeAbortControllers.delete(threadId)
  }
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

ipcMain.handle('terminal:create', (event, { cols, rows, cwd }: { cols: number; rows: number; cwd?: string }) => {
  const id = `pty-${crypto.randomUUID()}`
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh')

  const convCtx = getWorkspaceContext(activeConversationId)
  const workingDir = cwd || (convCtx?.isUserWorkspace ? convCtx.rootPath : undefined) || process.env.HOME || '/'

  log.info(`[terminal] Spawning ${shell} in ${workingDir} (${cols}x${rows})`)

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(cols, 10),
    rows: Math.max(rows, 3),
    cwd: workingDir,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  })

  activePtys.set(id, ptyProcess)

  const dataListener = ptyProcess.onData((data) => {
    if (event.sender.isDestroyed()) {
      try {
        dataListener.dispose()
        if (process.platform !== 'win32') {
          process.kill(-ptyProcess.pid, 'SIGINT')
        } else {
          ptyProcess.kill()
        }
      } catch {
        try { ptyProcess.kill() } catch {}
      }
      activePtys.delete(id)
      return
    }
    try {
      event.sender.send('terminal:data', { id, data })
    } catch {}
  })

  ptyProcess.onExit(({ exitCode }) => {
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

  mainWindow.contentView.addChildView(browserView)
  browserView.setBounds(bounds)
  browserView.webContents.loadURL(url || 'https://google.com')

  browserView.webContents.on('page-title-updated', (_e, title) => {
    try { event.sender.send('browser:title-updated', title) } catch {}
  })
  browserView.webContents.on('did-navigate', (_e, navUrl) => {
    try { event.sender.send('browser:url-changed', navUrl) } catch {}
  })
  browserView.webContents.on('did-navigate-in-page', (_e, navUrl) => {
    try { event.sender.send('browser:url-changed', navUrl) } catch {}
  })

  log.info(`[browser] Opened: ${url}`)
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
    log.info('[browser] Closed')
  }
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.orch-code')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  log.info('[main] App ready — creating main window')

  getOrCreateWorkspaceContext(activeConversationId)

  createWindow()

  if (!is.dev) {
    autoUpdater.checkForUpdatesAndNotify()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
