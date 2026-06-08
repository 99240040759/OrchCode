import crypto from 'node:crypto'
import { streamText, stepCountIs, type ModelMessage, type UserContent } from 'ai'
import log from 'electron-log'
import { captureException } from '@sentry/electron'
import { z } from 'zod'
import WindowManager from './windowManager'
import { getAvailableModels, resolveModel } from './models'
import { checkModelVisionSupport, checkModelNativeFileSupport } from './vision'
import { getOrCreateWorkspaceContext, getWorkspaceContext, updateWorkspacePath } from './workspace'
import { getUserSkillsPath, listInstalledSkills } from './skills'
import { createCoreTools, browserTools } from './tools'
import {
  getThreadMessages, getThread, saveMessage, updateThreadAccumulatedTokens,
  setThreadAccumulatedTokens, getThreadWorkspace, setThreadWorkspace, addOpenedWorkspace,
  compactThreadHistory
} from './db'
import { summariseContext } from './summarisation'
import { pushArtifactsChanged } from './artifacts'
import { buildMessagesFromHistory, buildAttachmentParts, sanitizeMessages } from './schema'
import type { ModelInfo } from './models'
import { pool } from './workerPool'
import { getCurrentSession } from './auth'

type StreamBlock = { type: 'text'; content: string } | { type: 'reasoning'; content: string; durationMs: number } | { type: 'tool'; toolCallId: string; toolName: string; args: Record<string, unknown>; argsDelta?: string; result?: unknown; status: 'pending' | 'complete' | 'error' } | { type: 'error'; message: string }
interface ToolStreamPart { type: string; toolCallId?: string; id?: string; toolName?: string; args?: Record<string, unknown>; input?: Record<string, unknown>; argsDelta?: string; argsTextDelta?: string; delta?: string; result?: unknown; error?: unknown }

export const activeAbortControllers = new Map<string, AbortController>()
const activePorts = new Map<string, Electron.MessagePortMain>()
const pendingAttachments = new Map<string, Promise<Buffer[]>>()
const attachmentResolvers = new Map<string, (bufs: Buffer[]) => void>()
const SUMMARISE_THRESHOLD = 180_000

const AttachmentSchema = z.object({ type: z.enum(['image', 'document']), name: z.string().min(1).max(255), mimeType: z.string().max(255).optional(), base64: z.string().max(14_000_000).optional() })
const StreamRequestSchema = z.object({ promptText: z.string().max(200_000), threadId: z.string().regex(/^[a-zA-Z0-9-_]+$/), modelType: z.string().max(255).optional(), attachments: z.array(AttachmentSchema).max(8).optional() })

/** Shared file-write tool names — keep in sync with renderer/lib/toolConstants.ts */
const FILE_WRITE_TOOLS = ['writeToFile', 'multiReplaceFileContent']

export function registerStreamIpc() {
  const { ipcMain, MessageChannelMain } = require('electron')
  ipcMain.handle('api:stream', async (event, rawPayload) => {
    try {
      const session = getCurrentSession()
      if (!session) throw new Error('Unauthorized: Please sign in to use agents.')
      const request = StreamRequestSchema.parse(rawPayload ?? {})
      if (request.attachments?.length) {
        pendingAttachments.set(request.threadId, new Promise<Buffer[]>((resolve, reject) => {
          const timeoutId = setTimeout(() => { attachmentResolvers.delete(request.threadId); reject(new Error('Attachment handshake timeout')) }, 10000)
          attachmentResolvers.set(request.threadId, (bufs) => { clearTimeout(timeoutId); resolve(bufs) })
        }))
      }
      const { port1, port2 } = new MessageChannelMain()
      event.sender.postMessage(`stream:port:${request.threadId}`, { threadId: request.threadId }, [port2])
      const worker = pool.allocateWorker(session.idToken, `stream:${request.threadId}`)
      const win = WindowManager.getMainWindow()
      if (win && !win.isDestroyed()) win.setProgressBar(2)
      const onExit = (code: number | null) => {
        pool.clearJob(worker.pid!)
        worker.off('message', onMsg)
        const win = WindowManager.getMainWindow()
        if (win && !win.isDestroyed()) {
          win.setProgressBar(-1)
          win.webContents.send('stream:worker-crashed', { threadId: request.threadId, code })
        }
      }
      worker.once('exit', onExit)
      const onMsg = (msg: any) => {
        if (msg?.type === 'artifacts-changed') pushArtifactsChanged(msg.threadId)
        if (msg?.type === 'tool-request' && msg.threadId === request.threadId) {
          const { requestId, toolName, args } = msg
          const t = browserTools(request.threadId, true)[toolName]
          if (t) {
            t.execute(args).then((res: any) => {
              const transfers = res && res.buffer instanceof ArrayBuffer ? [res.buffer] : []
              worker.postMessage({ type: 'tool-response', requestId, result: res }, transfers)
            }).catch((err: any) => worker.postMessage({ type: 'tool-response', requestId, error: err.message }))
          } else worker.postMessage({ type: 'tool-response', requestId, error: `Tool ${toolName} not found on Main` })
        }
        if (msg?.type === 'stream-finished' && msg.threadId === request.threadId) {
          pool.clearJob(worker.pid!)
          worker.off('message', onMsg); worker.off('exit', onExit)
          const win = WindowManager.getMainWindow()
          if (win && !win.isDestroyed()) win.setProgressBar(-1)
          if (msg.error) {
            const errObj = typeof msg.error === 'string' ? { message: msg.error } : msg.error
            const remoteError = new Error(errObj.message); remoteError.name = errObj.name || 'AgentWorkerError'
            if (errObj.stack) remoteError.stack = errObj.stack
            captureException(remoteError)
          }
        }
      }
      worker.on('message', onMsg)
      const isBrowserActive = !!WindowManager.getBrowserView()
      worker.postMessage({ type: 'start-stream', threadId: request.threadId, modelType: request.modelType, attachments: request.attachments, promptText: request.promptText, token: session.idToken, isBrowserActive }, [port1])
      return { ok: true }
    } catch (err) {
      log.error('[stream IPC Error]:', err)
      captureException(err)
      throw err
    }
  })
}

function buildBrowserInstruction(isBrowserActive: boolean, modelSupportsVision: boolean): string {
  const browserView = process.type === 'utility' ? null : WindowManager.getBrowserView()
  return (browserView || isBrowserActive)
    ? `\n── BROWSER ACTIVE ──\nYou have active browser control. Use these tools:\n1. browserNavigate(url)\n2. browserType(selector, text, frameSelector?)\n3. browserScroll(direction, amount?)\n4. browserMouseClickCoordinate(x, y, button?)\n${modelSupportsVision ? `5. browserScreenshot(): ALWAYS screenshot after navigation/typing.` : `5. browserGetPageContent(): Extract inner text and elements.`}`
    : ''
}
async function buildSkillsSection(): Promise<string> {
  const installedSkills = await listInstalledSkills(), skillsRootPath = getUserSkillsPath().replace(/\\/g, '/')
  return installedSkills.length > 0
    ? `── ADVANCED SKILLS ──\nSkills directory: ${skillsRootPath}\nAvailable: ${installedSkills.map(s => `- ${s.name}${s.description ? ` (${s.description})` : ''}`).join('\n')}\nUse listDir/readFile to explore. Follow workflows inside.`
    : ''
}
function buildSystemPrompt(threadId: string, rootPath: string, browserInstruction: string, skillsSection: string): string {
  return `You are Orch Code, a highly capable AI developer assistant. Active thread: ${threadId}.
── WORKSPACE ──
Root: ${rootPath || 'No workspace selected'}
Use searchWorkspace(query) to find files. Use listDir(path) to explore. Read before editing.
${browserInstruction}
${skillsSection}
── ARTIFACTS ──
Use the sandboxed system inside 'artifacts/'. Manage with writeToFile, multiReplaceFileContent:
1. PLANNING: For non-trivial changes, write implementation plan at 'artifacts/implementation_plan.md' and wait for user approval.
2. ONLY PLANNING: Never create or edit other files in the artifacts directory. Do not write walkthroughs or task files.
── TOOLS ──
Use native tools (viewFile, writeToFile, multiReplaceFileContent, searchWorkspace, listDir) for files. Do NOT execute shell commands for file actions. runCommand is only for tests, compile, and format.`
}
async function setupStreamRequest(port: Electron.MessagePortMain, threadId: string, controller: AbortController, attachments?: any[]) {
  activePorts.set(threadId, port)
  let streamFinished = false
  port.on('message', (e) => {
    if (e.data === 'abort') controller.abort()
    if (e.data?.type === 'bufs') {
      const resolver = attachmentResolvers.get(threadId)
      if (resolver) { resolver(e.data.bufs.map((b: ArrayBuffer) => Buffer.from(b))); attachmentResolvers.delete(threadId) }
    }
  })
  // FIXED: only abort on unexpected port close, not on normal finish-triggered close
  port.on('close', () => {
    if (!streamFinished) {
      log.info(`[stream] Port closed unexpectedly for ${threadId}. Aborting.`)
      controller.abort()
    }
  })
  // Expose a way for handleAgentStreamRequest to mark stream as done before closing port
  ;(port as any).__markFinished = () => { streamFinished = true }
  port.start()
  const attachmentPromise = pendingAttachments.get(threadId), bufs = attachmentPromise ? await attachmentPromise : []
  pendingAttachments.delete(threadId)
  if (attachments && bufs.length) {
    attachments.forEach((a, i) => { if (bufs[i]) a.base64 = bufs[i].toString('base64') })
    if (bufs.reduce((t, b) => t + b.length, 0) > 25 * 1024 * 1024) throw new Error('Attachments exceed 25 MB limit.')
  }
  const wsPath = getThreadWorkspace(threadId)
  if (wsPath) await updateWorkspacePath(threadId, wsPath)
}
export async function handleAgentStreamRequest(
  port: Electron.MessagePortMain,
  threadId: string,
  modelType?: string,
  attachments?: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64?: string }>,
  promptText?: string,
  isBrowserActive?: boolean
) {
  const text = promptText ?? ''
  log.info(`[stream] "${text.slice(0, 80)}" thread: "${threadId}"`)
  const send = (msg: Record<string, unknown>) => { try { port.postMessage(msg) } catch {} }
  let bufferedText = '', bufferedReasoning = '', flushTimeout: NodeJS.Timeout | null = null
  const flushBuffers = () => {
    if (flushTimeout) { clearTimeout(flushTimeout); flushTimeout = null }
    if (bufferedText) { send({ type: 'text-delta', payload: bufferedText, threadId }); bufferedText = '' }
    if (bufferedReasoning) { send({ type: 'reasoning-delta', payload: bufferedReasoning, threadId }); bufferedReasoning = '' }
  }
  const queueTextDelta = (text: string) => { bufferedText += text; if (!flushTimeout) flushTimeout = setTimeout(flushBuffers, 16) }
  const queueReasoningDelta = (text: string) => { bufferedReasoning += text; if (!flushTimeout) flushTimeout = setTimeout(flushBuffers, 16) }
  const existingController = activeAbortControllers.get(threadId)
  if (existingController) existingController.abort()
  const controller = new AbortController()
  activeAbortControllers.set(threadId, controller)
  try { await setupStreamRequest(port, threadId, controller, attachments) }
  catch (err) { pendingAttachments.delete(threadId); attachmentResolvers.delete(threadId); log.error(`[stream] Failed setup/workspace bind for ${threadId}:`, err); throw err }
  let assistantMsgId = '', assistantContent = ''
  const orderedBlocks: StreamBlock[] = []
  let sessionAccumulatedTokens = 0
  try {
    const history = await getThreadMessages(threadId)
    let persistedAccumulatedTokens = getThread(threadId)?.accumulatedTokens ?? 0
    const userMsgId = crypto.randomUUID()
    await saveMessage(threadId, { id: userMsgId, role: 'user', content: text, data: attachments?.length ? JSON.stringify({ attachments }) : undefined })
    const ctx = getWorkspaceContext(threadId) || (await getOrCreateWorkspaceContext(threadId))
    if (ctx.isUserWorkspace && !getThreadWorkspace(threadId)) {
      try { setThreadWorkspace(threadId, ctx.rootPath); addOpenedWorkspace(ctx.rootPath) } catch {}
    }
    const models = await getAvailableModels(), availableList = Object.values(models)
    if (!availableList.length) throw new Error('No models configured.')
    const rawModel: ModelInfo | undefined = modelType ? models[modelType] : availableList[0]
    if (!rawModel) throw new Error(`Requested model "${modelType}" is not available.`)
    const modelSupportsVision = checkModelVisionSupport(rawModel.id)
    const modelSupportsNativeFiles = checkModelNativeFileSupport(rawModel.id)
    const { messages: historyMessages, systemInstructionSuffix } = buildMessagesFromHistory(history, modelSupportsVision, modelSupportsNativeFiles)
    const userContent = attachments?.length ? (buildAttachmentParts(text, attachments as Array<{ type: string; name: string; mimeType?: string; base64: string }>, modelSupportsVision, modelSupportsNativeFiles) as UserContent) : text
    historyMessages.push({ role: 'user', content: userContent })
    const messages = sanitizeMessages(historyMessages)
    const browserView = process.type === 'utility' ? null : WindowManager.getBrowserView()
    const browserInstruction = buildBrowserInstruction(!!isBrowserActive, modelSupportsVision)
    const skillsSection = await buildSkillsSection()
    const systemInstruction = buildSystemPrompt(threadId, ctx.rootPath || '', browserInstruction, skillsSection)
    const coreTools = createCoreTools(threadId, modelSupportsVision)
    const activeTools = { ...coreTools, ...((browserView || isBrowserActive) ? browserTools(threadId, modelSupportsVision) : {}) }
    const { model: resolvedModel, providerOptions: modelProviderOptions } = resolveModel(rawModel.id)
    log.info(`[stream] model: ${rawModel.id}, messages: ${messages.length}`)
    assistantMsgId = crypto.randomUUID()
    let currentReasoningStartMs = 0, lastSaveMs = 0, saveInFlight = false
    const saveProgress = async (force = false) => {
      const now = Date.now()
      if (!force && now - lastSaveMs < 1000) return
      if (saveInFlight) return // FIXED: prevent concurrent writes to same assistantMsgId
      if (assistantContent || orderedBlocks.length > 0) {
        saveInFlight = true
        try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '', data: JSON.stringify(orderedBlocks) }); lastSaveMs = Date.now() }
        catch (err) { log.error('[stream] Progressive save failed:', err) }
        finally { saveInFlight = false }
      }
    }
    const result = streamText({
      model: resolvedModel,
      system: systemInstruction + (systemInstructionSuffix || ''),
      messages,
      tools: activeTools,
      stopWhen: stepCountIs(100),
      abortSignal: controller.signal,
      // Note: AI SDK streamText does not accept a timeout object here; rely on abortSignal for cancellation
      ...(Object.keys(modelProviderOptions).length > 0 ? { providerOptions: modelProviderOptions } : {}),
      onStepFinish: async ({ usage }) => {
        if (usage) {
          const step = usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)
          sessionAccumulatedTokens += step
          send({ type: 'token-update', payload: { accumulatedTokens: persistedAccumulatedTokens + sessionAccumulatedTokens }, threadId })
        }
      },
      prepareStep: async ({ messages: currentMessages }) => {
        if (persistedAccumulatedTokens + sessionAccumulatedTokens < SUMMARISE_THRESHOLD) return undefined
        log.info(`[stream] Context at ${sessionAccumulatedTokens} tokens — auto-summarising`)
        const summary = await summariseContext(currentMessages as ModelMessage[])
        if (!summary) return undefined
        try {
          compactThreadHistory(threadId, summary)
          setThreadAccumulatedTokens(threadId, 0)
          persistedAccumulatedTokens = 0; sessionAccumulatedTokens = 0
        } catch (err) { log.error('[stream] Compaction failed:', err) }
        send({ type: 'token-update', payload: { accumulatedTokens: 0 }, threadId })
        return {
          system: systemInstruction + `\n\n── CONTEXT COMPACTED ──\nSummary:\n\n${summary}\n\nContinue from this state.`,
          messages: sanitizeMessages((currentMessages as ModelMessage[]).slice(-10))
        }
      },
      onAbort: () => { void saveProgress(true) },
      onError: async ({ error }) => { log.error('[stream] AI SDK error:', error); await saveProgress(true) }
    })
    for await (const part of result.fullStream) {
      if (controller.signal.aborted) break
      switch (part.type) {
        case 'reasoning-start':
          flushBuffers()
          currentReasoningStartMs = Date.now(); orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0 })
          send({ type: 'reasoning-start', threadId }); break
        case 'reasoning-delta': {
          const last = orderedBlocks[orderedBlocks.length - 1]
          const delta = part.text || ''
          if (last?.type === 'reasoning') { last.content += delta; last.durationMs = Date.now() - currentReasoningStartMs }
          queueReasoningDelta(delta); break
        }
        case 'reasoning-end':
          flushBuffers()
          send({ type: 'reasoning-end', threadId }); break
        case 'text-delta': {
          const delta = part.text || ''; assistantContent += delta
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: delta })
          else last.content += delta
          queueTextDelta(delta)
          void saveProgress(false); break
        }
        case 'tool-input-start': {
          flushBuffers()
          const p = part as unknown as ToolStreamPart, tid = p.toolCallId || p.id || ''
          orderedBlocks.push({ type: 'tool', toolCallId: tid, toolName: p.toolName || '', args: {}, argsDelta: '', status: 'pending' })
          send({ type: 'tool-call-streaming-start', payload: { toolCallId: tid, toolName: p.toolName || '' }, threadId }); break
        }
        case 'tool-input-delta': {
          const p = part as unknown as ToolStreamPart, tid = p.toolCallId || p.id || '', delta = p.argsTextDelta || p.delta || ''
          const b = orderedBlocks.find((x) => x.type === 'tool' && x.toolCallId === tid)
          if (b && b.type === 'tool') b.argsDelta = (b.argsDelta || '') + delta
          send({ type: 'tool-call-delta', payload: { toolCallId: tid, delta }, threadId }); break
        }
        case 'tool-call': {
          flushBuffers()
          const p = part as unknown as ToolStreamPart, tid = p.toolCallId || p.id || '', args = (p.args || p.input || {}) as Record<string, unknown>
          const b = orderedBlocks.find((x) => x.type === 'tool' && x.toolCallId === tid)
          if (b && b.type === 'tool') { b.args = args; b.argsDelta = undefined }
          else orderedBlocks.push({ type: 'tool', toolCallId: tid, toolName: p.toolName || '', args, status: 'pending' })
          send({ type: 'tool-call', payload: { toolCallId: tid, toolName: p.toolName || '', args }, threadId }); break
        }
        case 'tool-result': {
          flushBuffers()
          const p = part as unknown as { toolCallId: string; toolName: string; result: unknown }, b = orderedBlocks.find((x) => x.type === 'tool' && x.toolCallId === p.toolCallId)
          if (b && b.type === 'tool') { b.result = p.result; b.status = 'complete' }
          send({ type: 'tool-result', payload: { toolCallId: p.toolCallId, result: p.result }, threadId })
          if (FILE_WRITE_TOOLS.includes(p.toolName)) {
            if (process.type === 'utility') (process as any).parentPort.postMessage({ type: 'artifacts-changed', threadId })
            else pushArtifactsChanged(threadId)
          }
          void saveProgress(false); break
        }
        case 'error': {
          flushBuffers()
          const errMsg = part.error instanceof Error ? part.error.message : String(part.error || 'Unknown error')
          log.error(`[stream] error: "${errMsg}"`); for (const x of orderedBlocks) { if (x.type === 'tool' && x.status === 'pending') x.status = 'error' }
          send({ type: 'error', payload: errMsg, threadId }); break
        }
        case 'finish': {
          flushBuffers()
          const p = part as unknown as { totalUsage?: { inputTokens?: number; outputTokens?: number }; finishReason?: string }, u = p.totalUsage || {}, pTokens = u.inputTokens || 0, cTokens = u.outputTokens || 0, tot = pTokens + cTokens
          try { updateThreadAccumulatedTokens(threadId, sessionAccumulatedTokens || tot) } catch (err) { log.error('[stream] Token count save failed:', err) }
          // Mark finished BEFORE sending finish event so port.close() in finally doesn't trigger abort
          ;(port as any).__markFinished?.()
          send({ type: 'finish', payload: { usage: { promptTokens: pTokens, completionTokens: cTokens, totalTokens: tot }, accumulatedTokens: persistedAccumulatedTokens + (sessionAccumulatedTokens || tot) }, threadId })
          if (p.finishReason === 'length') { log.warn(`[stream] Token limit for thread ${threadId}`); send({ type: 'step-limit', threadId }) }
          break
        }
        default: {
          // Handle tool-error which has no dedicated case (not a duplicate of existing cases)
          const p = part as unknown as ToolStreamPart
          if (p.type === 'tool-error') {
            const errMsg = p.error instanceof Error ? p.error.message : String(p.error)
            const b = orderedBlocks.find((x) => x.type === 'tool' && x.toolCallId === p.toolCallId)
            if (b && b.type === 'tool') { b.result = { success: false, error: errMsg }; b.status = 'error' }
            send({ type: 'tool-result', payload: { toolCallId: p.toolCallId, result: { success: false, error: errMsg } }, threadId })
          }
          // tool-call-streaming-start and tool-call-delta are handled by tool-input-start/tool-input-delta cases above
        }
      }
    }
    await saveProgress(true)
  } catch (err: unknown) {
    const error = err as Error & { name?: string }
    log.error('[stream] error:', error)
    if (error.name !== 'AbortError') {
      for (const x of orderedBlocks) { if (x.type === 'tool' && x.status === 'pending') x.status = 'error' }
      if (assistantContent || orderedBlocks.length > 0) {
        try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '[Stream Error]', data: JSON.stringify(orderedBlocks) }) } catch {}
      }
      send({ type: 'error', payload: error.message, threadId })
    }
    throw err
  } finally {
    flushBuffers()
    // Mark finished so the port 'close' handler (from setupStreamRequest) doesn't abort
    ;(port as any).__markFinished?.()
    if (activeAbortControllers.get(threadId) === controller) activeAbortControllers.delete(threadId)
    activePorts.delete(threadId)
    try { port.close() } catch {}
  }
}
