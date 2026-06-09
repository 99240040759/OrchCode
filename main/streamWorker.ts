import crypto from 'node:crypto'
import { streamText, stepCountIs, type ModelMessage, type UserContent } from 'ai'
import log from 'electron-log'
import { z } from 'zod'
import { getAvailableModels, resolveModel } from './models'
import { getOrCreateWorkspaceContext, getWorkspaceContext, updateWorkspacePath, markWorkspaceActive, markWorkspaceIdle } from './workspace'
import { getUserSkillsPath, listInstalledSkills } from './skills'
import { createCoreTools, browserTools } from './tools'
import {
  getThreadMessages, getThread, saveMessage, updateThreadAccumulatedTokens,
  setThreadAccumulatedTokens, getThreadWorkspace, setThreadWorkspace, addOpenedWorkspace,
  compactThreadHistory
} from './db'
import { summariseContext } from './summarisation'
import { buildMessagesFromHistory, buildAttachmentParts, sanitizeMessages } from './schema'
import type { ModelInfo } from './models'

export type StreamBlock =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string; durationMs: number }
  | { type: 'tool'; toolCallId: string; toolName: string; args: Record<string, unknown>; argsDelta?: string; result?: unknown; status: 'pending' | 'complete' | 'error' }
  | { type: 'error'; message: string }

interface ToolStreamPart {
  type: string
  toolCallId?: string
  id?: string
  toolName?: string
  args?: Record<string, unknown>
  input?: Record<string, unknown>
  argsDelta?: string
  argsTextDelta?: string
  delta?: string
  result?: unknown
  error?: unknown
}

const activeAbortControllers = new Map<string, { controller: AbortController; sessionId: string }>()
const SUMMARISE_THRESHOLD = 180_000

const AttachmentSchema = z.object({
  type: z.enum(['image', 'document']),
  name: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional(),
  base64: z.string().max(14_000_000).optional()
})
const StreamRequestSchema = z.object({
  promptText: z.string().max(200_000),
  threadId: z.string().regex(/^[a-zA-Z0-9-_]+$/),
  modelType: z.string().max(255).optional(),
  attachments: z.array(AttachmentSchema).max(8).optional()
})

export { StreamRequestSchema }

const FILE_WRITE_TOOLS = ['writeToFile', 'multiReplaceFileContent']

const finishedPorts = new WeakSet<Electron.MessagePortMain>()

function markPortFinished(port: Electron.MessagePortMain) {
  finishedPorts.add(port)
}

function isPortFinished(port: Electron.MessagePortMain): boolean {
  return finishedPorts.has(port)
}

async function setupStreamRequest(
  port: Electron.MessagePortMain,
  threadId: string,
  controller: AbortController,
  attachments?: any[]
) {
  let resolveAttachments: ((bufs: Buffer[]) => void) | null = null
  const bufsPromise = attachments && attachments.length
    ? new Promise<Buffer[]>((resolve, reject) => {
        resolveAttachments = resolve
        setTimeout(() => reject(new Error('Attachment handshake timeout')), 30000)
      })
    : Promise.resolve([])

  port.on('message', (e) => {
    if (e.data === 'abort') {
      controller.abort()
      try { port.close() } catch (err) { log.debug('[stream] Port close error:', err) }
    }
    if (e.data?.type === 'bufs') {
      resolveAttachments?.(e.data.bufs.map((b: ArrayBuffer) => Buffer.from(b)))
    }
    if (e.data?.type === 'inject') {
      controller.abort(new Error('__inject__:' + (e.data.text ?? '')))
    }
  })
  port.on('close', () => {
    if (!isPortFinished(port)) {
      log.info(`[stream] Port closed unexpectedly for ${threadId}. Aborting.`)
      controller.abort()
    }
  })
  port.start()

  const bufs = await bufsPromise.catch(err => {
    log.error('[stream] Attachment handshake error:', err)
    throw err
  })
  if (attachments && bufs.length) {
    attachments.forEach((a, i) => { if (bufs[i]) a.base64 = bufs[i].toString('base64') })
    if (bufs.reduce((t, b) => t + b.length, 0) > 25 * 1024 * 1024) {
      throw new Error('Attachments exceed 25 MB limit.')
    }
  }

  const wsPath = await getThreadWorkspace(threadId)
  if (wsPath) await updateWorkspacePath(threadId, wsPath)
}

function buildBrowserInstruction(isBrowserActive: boolean, modelSupportsVision: boolean): string {
  return isBrowserActive
    ? `\n── BROWSER ACTIVE ──\nYou have active browser control. Use these tools:\n1. browserNavigate(url)\n2. browserType(selector, text, frameSelector?)\n3. browserScroll(direction, amount?)\n4. browserMouseClickCoordinate(x, y, button?)\n${modelSupportsVision ? `5. browserScreenshot(): ALWAYS screenshot after navigation/typing.` : `5. browserGetPageContent(): Extract page text and interactive elements for non-vision models.`}`
    : ''
}

async function buildSkillsSection(): Promise<string> {
  const installedSkills = await listInstalledSkills()
  const skillsRootPath = getUserSkillsPath().replace(/\\/g, '/')
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

export async function handleAgentStreamRequest(
  port: Electron.MessagePortMain,
  threadId: string,
  modelType: string | undefined,
  attachments: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64?: string }> | undefined,
  promptText: string | undefined,
  isBrowserActive: boolean | undefined,
  sharedBuffer: SharedArrayBuffer
) {
  const text = promptText ?? ''
  log.info(`[stream] "${text.slice(0, 80)}" thread: "${threadId}"`)
  const send = (msg: Record<string, unknown>) => {
    try { port.postMessage(msg) } catch (err) { log.debug('[stream] Port send error:', err) }
  }

  const headerView = new Int32Array(sharedBuffer, 0, 16)
  const reasoningView = new Uint8Array(sharedBuffer, 64, 256 * 1024)
  const textView = new Uint8Array(sharedBuffer, 64 + 256 * 1024, 512 * 1024)
  const toolView = new Uint8Array(sharedBuffer, 64 + 256 * 1024 + 512 * 1024, 256 * 1024)

  headerView[0] = 0
  headerView[1] = 0
  headerView[2] = 0
  headerView[3] = 1
  headerView[4] = 0
  headerView[5] = 0

  send({ type: 'buffer-init', payload: sharedBuffer, threadId })

  const encoder = new TextEncoder()
  const writeToSharedBuffer = (view: Uint8Array, cursorIdx: number, textVal: string) => {
    const bytes = encoder.encode(textVal)
    let currentCursor = headerView[cursorIdx]
    if (currentCursor + bytes.length <= view.byteLength) {
      view.set(bytes, currentCursor)
      headerView[cursorIdx] = currentCursor + bytes.length
    } else {
      const spaceLeft = view.byteLength - currentCursor
      if (spaceLeft > 0) view.set(bytes.subarray(0, spaceLeft), currentCursor)
      view.set(bytes.subarray(spaceLeft), 0)
      headerView[cursorIdx] = bytes.length - spaceLeft
      headerView[cursorIdx + 6] += 1
    }
  }

  const existingEntry = activeAbortControllers.get(threadId)
  if (existingEntry) existingEntry.controller.abort()
  const controller = new AbortController()
  const streamSessionId = crypto.randomUUID()
  activeAbortControllers.set(threadId, { controller, sessionId: streamSessionId })
  markWorkspaceActive(threadId)

  try {
    await setupStreamRequest(port, threadId, controller, attachments)
  } catch (err) {
    log.error(`[stream] Failed setup/workspace bind for ${threadId}:`, err)
    throw err
  }

  let assistantMsgId = '', assistantContent = ''
  const orderedBlocks: StreamBlock[] = []
  let sessionAccumulatedTokens = 0
  let persistedAccumulatedTokens = 0
  let persistedLifetimeTokens = 0

  try {
    const history = await getThreadMessages(threadId)
    const threadData = await getThread(threadId)
    persistedAccumulatedTokens = threadData?.accumulatedTokens ?? 0
    persistedLifetimeTokens = threadData?.lifetimeTokens ?? 0
    const userMsgId = crypto.randomUUID()
    await saveMessage(threadId, {
      id: userMsgId,
      role: 'user',
      content: text,
      data: attachments?.length ? JSON.stringify({ attachments }) : undefined
    })

    const ctx = getWorkspaceContext(threadId) || (await getOrCreateWorkspaceContext(threadId))
    if (ctx.isUserWorkspace && !(await getThreadWorkspace(threadId))) {
      try {
        await setThreadWorkspace(threadId, ctx.rootPath)
        await addOpenedWorkspace(ctx.rootPath)
      } catch (err) { log.error('[stream] Auto-bind error:', err) }
    }

    const models = await getAvailableModels()
    const availableList = Object.values(models)
    if (!availableList.length) throw new Error('No models configured.')
    const rawModel: ModelInfo | undefined = modelType ? models[modelType] : availableList[0]
    if (!rawModel) throw new Error(`Requested model "${modelType}" is not available.`)

    const modelSupportsVision = !!rawModel.capabilities?.vision
    const modelSupportsNativeFiles = !!rawModel.capabilities?.nativeFiles
    const { messages: historyMessages, systemInstructionSuffix } = await buildMessagesFromHistory(history, modelSupportsVision, modelSupportsNativeFiles)
    const userContent = attachments?.length
      ? (buildAttachmentParts(text, attachments as Array<{ type: string; name: string; mimeType?: string; base64: string }>, modelSupportsVision, modelSupportsNativeFiles) as UserContent)
      : text
    historyMessages.push({ role: 'user', content: userContent })
    const messages = sanitizeMessages(historyMessages)

    const browserInstruction = buildBrowserInstruction(!!isBrowserActive, modelSupportsVision)
    const skillsSection = await buildSkillsSection()
    const systemInstruction = buildSystemPrompt(threadId, ctx.rootPath || '', browserInstruction, skillsSection)

    const coreTools = createCoreTools(threadId, modelSupportsVision)
    const activeTools = {
      ...coreTools,
      ...(isBrowserActive ? browserTools(threadId, modelSupportsVision) : {})
    }

    const { model: resolvedModel, providerOptions: modelProviderOptions } = resolveModel(rawModel.id)
    log.info(`[stream] model: ${rawModel.id}, messages: ${messages.length}`)

    assistantMsgId = crypto.randomUUID()
    let currentReasoningStartMs = 0, lastSaveMs = 0, saveInFlight = false, saveQueued = false

    const saveProgress = (force = false) => {
      const now = Date.now()
      if (!force && now - lastSaveMs < 1000) return
      if (saveInFlight) { if (force) saveQueued = true; return }
      if (assistantContent || orderedBlocks.length > 0) {
        saveInFlight = true
        const doSave = () => {
          saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '', data: JSON.stringify(orderedBlocks) })
            .then(() => { lastSaveMs = Date.now() })
            .catch(err => log.error('[stream] Progressive save failed:', err))
            .finally(() => {
              saveInFlight = false
              if (saveQueued) { saveQueued = false; saveProgress(true) }
            })
        }
        if (force) doSave()
        else setImmediate(doSave)
      }
    }

    const result = streamText({
      model: resolvedModel,
      system: systemInstruction + (systemInstructionSuffix || ''),
      messages,
      tools: activeTools,
      maxRetries: 3,
      stopWhen: stepCountIs(100),
      abortSignal: controller.signal,
      ...(Object.keys(modelProviderOptions).length > 0 ? { providerOptions: modelProviderOptions } : {}),
      onStepFinish: async ({ usage }) => {
        if (usage) {
          const step = usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)
          sessionAccumulatedTokens += step
          send({ type: 'token-update', payload: { accumulatedTokens: persistedAccumulatedTokens + sessionAccumulatedTokens, lifetimeTokens: persistedLifetimeTokens + sessionAccumulatedTokens }, threadId })
        }
      },
      prepareStep: async ({ messages: currentMessages }) => {
        if (persistedAccumulatedTokens + sessionAccumulatedTokens < SUMMARISE_THRESHOLD) return undefined
        log.info(`[stream] Context at ${sessionAccumulatedTokens} tokens — auto-summarising`)
        const prevPersisted = persistedAccumulatedTokens, prevSession = sessionAccumulatedTokens
        const summary = await summariseContext(currentMessages as ModelMessage[])
        if (!summary) return undefined
        try {
          await compactThreadHistory(threadId, summary)
          await updateThreadAccumulatedTokens(threadId, sessionAccumulatedTokens)
          await setThreadAccumulatedTokens(threadId, 0)
          persistedLifetimeTokens += sessionAccumulatedTokens
          persistedAccumulatedTokens = 0
          sessionAccumulatedTokens = 0
        } catch (err) {
          log.error('[stream] Compaction failed, reverting counters:', err)
          persistedAccumulatedTokens = prevPersisted
          sessionAccumulatedTokens = prevSession
          return undefined
        }
        send({ type: 'token-update', payload: { accumulatedTokens: 0, lifetimeTokens: persistedLifetimeTokens + sessionAccumulatedTokens }, threadId })
        return {
          system: systemInstruction + `\n\n── CONTEXT COMPACTED ──\nSummary:\n\n${summary}\n\nContinue from this state.`,
          messages: sanitizeMessages((currentMessages as ModelMessage[]).slice(-10))
        }
      },
      onAbort: () => { saveProgress(true) },
      onError: ({ error }) => { log.error('[stream] AI SDK error:', error); saveProgress(true) }
    })

    for await (const part of result.fullStream) {
      if (controller.signal.aborted) break
      switch (part.type) {
        case 'reasoning-start':
          headerView[0] = 0
          headerView[4] += 1
          currentReasoningStartMs = Date.now()
          orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0 })
          send({ type: 'reasoning-start', threadId })
          break
        case 'reasoning-delta': {
          const last = orderedBlocks[orderedBlocks.length - 1]
          const delta = part.text || ''
          if (last?.type === 'reasoning') { last.content += delta; last.durationMs = Date.now() - currentReasoningStartMs }
          writeToSharedBuffer(reasoningView, 0, delta)
          break
        }
        case 'reasoning-end':
          send({ type: 'reasoning-end', threadId })
          break
        case 'text-delta': {
          const delta = part.text || ''
          assistantContent += delta
          const last = orderedBlocks[orderedBlocks.length - 1]
          const isNewBlock = !last || last.type !== 'text'
          if (isNewBlock) {
            headerView[1] = 0
            headerView[5] += 1
            orderedBlocks.push({ type: 'text', content: delta })
          } else {
            last.content += delta
          }
          // Always send text-delta for every delta — both new and continued blocks
          send({ type: 'text-delta', payload: delta, threadId })
          writeToSharedBuffer(textView, 1, delta)
          void saveProgress(false)
          break
        }
        case 'tool-input-start': {
          headerView[2] = 0
          const p = part as unknown as ToolStreamPart
          const tid = p.toolCallId || p.id || ''
          orderedBlocks.push({ type: 'tool', toolCallId: tid, toolName: p.toolName || '', args: {}, argsDelta: '', status: 'pending' })
          send({ type: 'tool-call-streaming-start', payload: { toolCallId: tid, toolName: p.toolName || '' }, threadId })
          break
        }
        case 'tool-input-delta': {
          const p = part as unknown as ToolStreamPart
          const tid = p.toolCallId || p.id || ''
          const delta = p.argsTextDelta || p.delta || ''
          const b = orderedBlocks.find(x => x.type === 'tool' && x.toolCallId === tid)
          if (b && b.type === 'tool') b.argsDelta = (b.argsDelta || '') + delta
          writeToSharedBuffer(toolView, 2, delta)
          break
        }
        case 'tool-call': {
          const p = part as unknown as ToolStreamPart
          const tid = p.toolCallId || p.id || ''
          const args = (p.args || p.input || {}) as Record<string, unknown>
          const b = orderedBlocks.find(x => x.type === 'tool' && x.toolCallId === tid)
          if (b && b.type === 'tool') { b.args = args; b.argsDelta = undefined }
          else orderedBlocks.push({ type: 'tool', toolCallId: tid, toolName: p.toolName || '', args, status: 'pending' })
          send({ type: 'tool-call', payload: { toolCallId: tid, toolName: p.toolName || '', args }, threadId })
          break
        }
        case 'tool-result': {
          const p = part as unknown as { toolCallId: string; toolName: string; result: unknown }
          const b = orderedBlocks.find(x => x.type === 'tool' && x.toolCallId === p.toolCallId)
          if (b && b.type === 'tool') { b.result = p.result; b.status = 'complete' }
          send({ type: 'tool-result', payload: { toolCallId: p.toolCallId, result: p.result }, threadId })
          if (FILE_WRITE_TOOLS.includes(p.toolName)) {
            ;(process as any).parentPort.postMessage({ type: 'artifacts-changed', threadId })
          }
          void saveProgress(false)
          break
        }
        case 'error': {
          headerView[3] = 2
          const errMsg = part.error instanceof Error ? part.error.message : String(part.error || 'Unknown error')
          log.error(`[stream] error: "${errMsg}"`)
          for (const x of orderedBlocks) { if (x.type === 'tool' && x.status === 'pending') x.status = 'error' }
          send({ type: 'error', payload: { message: errMsg, content: assistantContent, orderedBlocks }, threadId })
          break
        }
        case 'finish': {
          headerView[3] = 2
          const p = part as unknown as { totalUsage?: { inputTokens?: number; outputTokens?: number }; finishReason?: string }
          const u = p.totalUsage || {}
          const pTokens = u.inputTokens || 0, cTokens = u.outputTokens || 0
          try { await updateThreadAccumulatedTokens(threadId, sessionAccumulatedTokens) } catch (err) { log.error('[stream] Token count save failed:', err) }
          send({ type: 'finish', payload: { usage: { promptTokens: pTokens, completionTokens: cTokens, totalTokens: pTokens + cTokens }, accumulatedTokens: persistedAccumulatedTokens + sessionAccumulatedTokens, lifetimeTokens: persistedLifetimeTokens + sessionAccumulatedTokens, content: assistantContent, orderedBlocks }, threadId })
          if (p.finishReason === 'length') { log.warn(`[stream] Token limit for thread ${threadId}`); send({ type: 'step-limit', threadId }) }
          break
        }
        default: {
          const p = part as unknown as ToolStreamPart
          if (p.type === 'tool-error') {
            const errMsg = p.error instanceof Error ? p.error.message : String(p.error)
            const b = orderedBlocks.find(x => x.type === 'tool' && x.toolCallId === p.toolCallId)
            if (b && b.type === 'tool') { b.result = { success: false, error: errMsg }; b.status = 'error' }
            send({ type: 'tool-result', payload: { toolCallId: p.toolCallId, result: { success: false, error: errMsg } }, threadId })
          }
        }
      }
    }

    saveProgress(true)
  } catch (err: unknown) {
    const error = err as Error & { name?: string }
    const isInject = error?.message?.startsWith('__inject__:')
    if (isInject) {
      const injectedText = error.message.slice('__inject__:'.length)
      log.info(`[stream] Inject received for ${threadId}: "${injectedText.slice(0, 60)}"`)
      for (const x of orderedBlocks) { if (x.type === 'tool' && x.status === 'pending') x.status = 'error' }
      if (assistantContent || orderedBlocks.length > 0) {
        try {
          await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '', data: JSON.stringify(orderedBlocks) })
        } catch (saveErr) { log.error('[stream] Inject save error:', saveErr) }
      }
      // inject-resume MUST be sent before finish — preload closes the port on finish
      send({ type: 'inject-resume', payload: injectedText, threadId })
      send({ type: 'finish', payload: { accumulatedTokens: 0, lifetimeTokens: persistedLifetimeTokens + sessionAccumulatedTokens, content: assistantContent, orderedBlocks }, threadId })
    } else if (error.name !== 'AbortError') {
      log.error('[stream] error:', error)
      for (const x of orderedBlocks) { if (x.type === 'tool' && x.status === 'pending') x.status = 'error' }
      if (assistantContent || orderedBlocks.length > 0) {
        try {
          await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '[Stream Error]', data: JSON.stringify(orderedBlocks) })
        } catch (saveErr) { log.error('[stream] Final saveMessage error:', saveErr) }
      }
      send({ type: 'error', payload: error.message, threadId })
      throw err
    }
  } finally {
    headerView[3] = 2
    markPortFinished(port)
    markWorkspaceIdle(threadId)
    const entry = activeAbortControllers.get(threadId)
    if (entry && entry.sessionId === streamSessionId) activeAbortControllers.delete(threadId)
    try { port.close() } catch (err) { log.debug('[stream] Final port close error:', err) }
  }
}
