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
const threadCompactionLocks = new Map<string, boolean>()

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

const FILE_WRITE_TOOLS = ['writeToFile', 'multiReplaceFileContent', 'generateImage']



async function setupStreamRequest(
  port: Electron.MessagePortMain,
  threadId: string,
  controller: AbortController,
  attachments?: any[]
) {
  let resolveAttachments: ((bufs: Buffer[]) => void) | null = null
  const bufsPromise = attachments && attachments.length
    ? new Promise<Buffer[]>((resolve) => { resolveAttachments = resolve })
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
  port.on('close', () => controller.abort())
  port.start()

  const bufs = await bufsPromise
  if (attachments && bufs.length) {
    attachments.forEach((a, i) => { if (bufs[i]) a.base64 = bufs[i].toString('base64') })
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

function buildSystemPrompt(threadId: string, rootPath: string, browserInstruction: string, skillsSection: string, estimatedContextTokens: number): string {
  const tokenWarning = estimatedContextTokens > 150000 ? `\n\n⚠️ CONTEXT WARNING: Session using ~${Math.round(estimatedContextTokens / 1000)}k tokens. Approaching 200k limit. Be concise.` : ''
  return `You are Orch Code, an advanced, highly specialized AI software engineering agent.${tokenWarning}
Active Conversation Thread ID: ${threadId}

=========================================
1. IDENTITY & PROFESSIONAL BEHAVIOR
=========================================
- You are Orch Code, a world-class developer assistant designed to write clean, correct, and premium code.
- Always communicate concisely and professionally. Focus on code accuracy, design elegance, and developer productivity.

=========================================
2. WORKSPACE & ENVIRONMENT ISOLATION
=========================================
- Active Workspace Folder: ${rootPath || 'No workspace directory currently selected.'}
- Your operations are strictly bound to this workspace. Do not write or touch files outside this directory.
- Always verify your understanding of the codebase first: search using \`searchWorkspace\` or browse directories using \`listDir\`.
- Always read the contents of a target file using \`viewFile\` (paging/paginating using \`startLine\` and \`endLine\` if needed) before proposing any edits.

=========================================
3. SEARCH, SKILLS & WEB SEARCH PRIORITIES
=========================================
- **Priority 1 (Local Code & Structure):** Always use \`searchWorkspace\` and \`listDir\` first to locate code symbols, config files, and understand codebase layout. Local code is the ground truth.
- **Priority 2 (Specialized Skills):** Check the \`── ADVANCED SKILLS ──\` section below. If any installed skill tools or workflows exist, prioritize using them to perform specialized repository tasks.
- **Priority 3 (Web Search):** Use \`searchWeb\` ONLY when you need external library documentation, API specs, external dependency details, or debugging information for a general framework error that is not documented locally. Do not use web search for finding local workspace resources.

=========================================
4. SURGICAL CODE EDITING & FORMATTING CONSTRAINTS
=========================================
- **Surgical Edits:** When modifying code, only change the absolute minimum lines required to execute the fix or feature.
- **Code Compression:** Avoid unnecessary empty lines or exploded whitespace. Collapse control flows, brackets, and simple blocks where syntactically clean.
- **No Refactoring Unchanged Code:** Do not clean up, reformat, or alter surrounding lines of code that are unrelated to the task. Keep changes highly localized.
- **AST Matching Resilience:** \`multiReplaceFileContent\` utilizes Abstract Syntax Tree (AST) matching where possible. For best results, make sure your target blocks are unique and contain sufficient context.

=========================================
5. STRUCTURED PLANNING & USER APPROVAL
=========================================
- **When to Plan:** If the request involves major architectural changes, multiple files, complex logic, or significant ambiguity, you MUST write an implementation plan at \`artifacts/implementation_plan.md\` first and wait for the user's approval.
- **When NOT to Plan:** For simple one-off tasks (small fixes, additions of single functions, formatting adjustments, small scripts), proceed to direct execution immediately without blocking.
- **Artifacts Directory:** Use the sandboxed directory \`artifacts/\` inside the conversation space for plans. Do not create walkthroughs or task files here; only use it for the implementation plan.

=========================================
6. TOOL UTILIZATION PROTOCOLS
=========================================
- **File System Tools:** Use only the native APIs (\`viewFile\`, \`writeToFile\`, \`multiReplaceFileContent\`, \`listDir\`, \`searchWorkspace\`) for all file actions.
- **Shell Commands:** Do NOT run shell utilities (\`grep\`, \`find\`, \`sed\`, \`awk\`, \`cat\`, \`echo\`) inside \`runCommand\` to read, write, or search files. \`runCommand\` is strictly reserved for:
  - Running compilation or build commands (e.g. \`npm run build\`).
  - Running tests or lint suites (e.g. \`npm run test\`, \`jest\`).
  - Package installations (e.g. \`npm install\`).
  - Checking formatting or running code formatters.

${browserInstruction}
${skillsSection}
`
}

export async function handleAgentStreamRequest(
  port: Electron.MessagePortMain,
  threadId: string,
  modelType: string | undefined,
  attachments: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64?: string }> | undefined,
  promptText: string | undefined,
  isBrowserActive: boolean | undefined
) {
  const text = promptText ?? ''
  log.info(`[stream] "${text.slice(0, 80)}" thread: "${threadId}"`)
  const send = (msg: Record<string, unknown>) => {
    try { port.postMessage(msg) } catch (err) { log.debug('[stream] Port send error:', err) }
  }
  const existingEntry = activeAbortControllers.get(threadId)
  if (existingEntry) {
    log.warn(`[stream] Duplicate stream attempt for ${threadId}, aborting previous`)
    existingEntry.controller.abort()
    await new Promise(resolve => setTimeout(resolve, 100))
  }
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
    const coreTools = createCoreTools(threadId, modelSupportsVision)
    const activeTools = {
      ...coreTools,
      ...(isBrowserActive ? browserTools(threadId, modelSupportsVision) : {})
    }
    const estimatedContextTokens = persistedAccumulatedTokens + sessionAccumulatedTokens + 2000 + (Object.keys(activeTools).length * 500)
    const systemInstruction = buildSystemPrompt(threadId, ctx.rootPath || '', browserInstruction, skillsSection, estimatedContextTokens)

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
        if (persistedAccumulatedTokens + sessionAccumulatedTokens < SUMMARISE_THRESHOLD || threadCompactionLocks.get(threadId)) return undefined
        threadCompactionLocks.set(threadId, true)
        try {
          log.info(`[stream] Context at ${sessionAccumulatedTokens} tokens — auto-summarising`)
          const summary = await summariseContext(currentMessages as ModelMessage[])
          if (!summary) return undefined
          await compactThreadHistory(threadId, summary)
          await updateThreadAccumulatedTokens(threadId, sessionAccumulatedTokens)
          await setThreadAccumulatedTokens(threadId, 0)
          persistedLifetimeTokens += sessionAccumulatedTokens
          persistedAccumulatedTokens = 0
          sessionAccumulatedTokens = 0
          send({ type: 'token-update', payload: { accumulatedTokens: 0, lifetimeTokens: persistedLifetimeTokens + sessionAccumulatedTokens }, threadId })
          return {
            system: systemInstruction + `\n\n── CONTEXT COMPACTED ──\nSummary:\n\n${summary}\n\nContinue from this state.`,
            messages: sanitizeMessages((currentMessages as ModelMessage[]).slice(-10))
          }
        } finally {
          threadCompactionLocks.delete(threadId)
        }
      },
      onAbort: () => { saveProgress(true) },
      onError: ({ error }) => { log.error('[stream] AI SDK error:', error); saveProgress(true) }
    })

    for await (const part of result.fullStream) {
      if (controller.signal.aborted) break
      switch (part.type) {
        case 'reasoning-start':
          currentReasoningStartMs = Date.now()
          orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0 })
          send({ type: 'reasoning-start', threadId })
          break
        case 'reasoning-delta': {
          const last = orderedBlocks[orderedBlocks.length - 1], delta = part.text || ''
          if (last?.type === 'reasoning') { last.content += delta; last.durationMs = Date.now() - currentReasoningStartMs }
          send({ type: 'reasoning-delta', payload: delta, threadId })
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
            orderedBlocks.push({ type: 'text', content: delta })
          } else {
            last.content += delta
          }
          send({ type: 'text-delta', payload: delta, threadId })
          void saveProgress(false)
          break
        }
        case 'tool-input-start': {
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
          const errMsg = part.error instanceof Error ? part.error.message : String(part.error || 'Unknown error')
          log.error(`[stream] error: "${errMsg}"`)
          for (const x of orderedBlocks) { if (x.type === 'tool' && x.status === 'pending') x.status = 'error' }
          send({ type: 'error', payload: { message: errMsg, content: assistantContent, orderedBlocks }, threadId })
          break
        }
        case 'finish': {
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
    const injectReason = controller.signal.reason as Error | undefined
    const isInject = injectReason?.message?.startsWith('__inject__:') || error?.message?.startsWith('__inject__:')
    if (isInject) {
      const injectedText = (injectReason?.message || error.message).slice('__inject__:'.length)
      log.info(`[stream] Inject received for ${threadId}: "${injectedText.slice(0, 60)}"`)
      for (const x of orderedBlocks) { if (x.type === 'tool' && x.status === 'pending') { x.status = 'complete'; x.result = { type: 'text', value: '[Tool execution interrupted by user injection]' } } }
      if (assistantContent || orderedBlocks.length > 0) { try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '', data: JSON.stringify(orderedBlocks) }) } catch (saveErr) { log.error('[stream] Inject save error:', saveErr) } }
      send({ type: 'inject-resume', payload: injectedText, threadId })
      send({ type: 'finish', payload: { accumulatedTokens: persistedAccumulatedTokens + sessionAccumulatedTokens, lifetimeTokens: persistedLifetimeTokens + sessionAccumulatedTokens, content: assistantContent, orderedBlocks }, threadId })
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
    markWorkspaceIdle(threadId)
    const entry = activeAbortControllers.get(threadId)
    if (entry && entry.sessionId === streamSessionId) activeAbortControllers.delete(threadId)
    try { port.close() } catch (err) { log.debug('[stream] Final port close error:', err) }
  }
}
