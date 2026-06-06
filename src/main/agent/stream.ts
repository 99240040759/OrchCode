import 'dotenv/config'
import crypto from 'node:crypto'
import { streamText, stepCountIs, type ModelMessage } from 'ai'
import { ipcMain, MessageChannelMain } from 'electron'
import log from 'electron-log'
import { z } from 'zod'
import WindowManager from '../windowManager'
import { getAvailableModels, resolveModel } from './models'
import { checkModelVisionSupport, checkModelNativeFileSupport } from '../vision'
import { getOrCreateWorkspaceContext, getWorkspaceContext, updateWorkspacePath } from '../workspace'
import { getUserSkillsPath, listInstalledSkills } from '../skills'
import { createCoreTools, browserTools } from '../tools'
import {
  getThreadMessages,
  getThread,
  saveMessage,
  updateThreadAccumulatedTokens,
  setThreadAccumulatedTokens,
  getThreadWorkspace,
  setThreadWorkspace,
  addOpenedWorkspace
} from '../db'
import { summariseContext, compactThreadHistory } from './summarisation'
import { pushArtifactsChanged } from './artifacts'
import { getCurrentSession } from '../auth'
import { buildMessagesFromHistory, buildAttachmentParts, sanitizeMessages } from './schema'

export const activeAbortControllers = new Map<string, AbortController>()

const SUMMARISE_THRESHOLD = 180_000

// ─── IPC registration ─────────────────────────────────────────────────────────

const AttachmentSchema = z.object({
  type: z.enum(['image', 'document']),
  name: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional(),
  base64: z.string().max(14_000_000)
})

const StreamRequestSchema = z.object({
  promptText: z.string().max(200_000),
  threadId: z.string().regex(/^[a-zA-Z0-9-_]+$/),
  modelType: z.string().max(255).optional(),
  attachments: z.array(AttachmentSchema).max(8).optional()
})

export function registerStreamIpc() {
  ipcMain.handle('api:stream', async (event, rawPayload) => {
    const session = getCurrentSession()
    if (!session) throw new Error('Unauthorized: Please sign in to use agents.')

    const request = StreamRequestSchema.parse(rawPayload ?? {})
    const totalAttachmentBytes = (request.attachments ?? []).reduce(
      (total, a) => total + Math.ceil((a.base64.length * 3) / 4), 0
    )
    if (totalAttachmentBytes > 25 * 1024 * 1024) throw new Error('Attachments exceed the 25 MB total limit.')

    const { port1, port2 } = new MessageChannelMain()
    event.sender.postMessage('stream:port', { threadId: request.threadId }, [port2])

    handleAgentStreamRequest(port1, request.threadId, request.modelType, request.attachments, request.promptText)
      .catch((err) => {
        log.error('[stream] Unhandled stream error:', err)
        try { port1.postMessage({ type: 'error', payload: err.message, threadId: request.threadId }) } catch {}
        try { port1.close() } catch {}
      })

    return { ok: true }
  })
}

// ─── Stream handler ───────────────────────────────────────────────────────────

export async function handleAgentStreamRequest(
  port: Electron.MessagePortMain,
  threadId: string,
  modelType?: string,
  attachments?: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }>,
  promptText?: string
) {
  const text = promptText ?? ''
  log.info(`[stream] "${text.slice(0, 80)}" thread: "${threadId}"`)

  const send = (msg: Record<string, unknown>) => { try { port.postMessage(msg) } catch {} }

  const existingController = activeAbortControllers.get(threadId)
  if (existingController) existingController.abort()
  const controller = new AbortController()
  activeAbortControllers.set(threadId, controller)

  try {
    const wsPath = getThreadWorkspace(threadId)
    if (wsPath) await updateWorkspacePath(threadId, wsPath)
  } catch (err) {
    log.warn(`[stream] Failed to bind workspace for ${threadId}:`, err)
  }

  let assistantMsgId = ''
  let assistantContent = ''
  const orderedBlocks: Record<string, unknown>[] = []
  let sessionAccumulatedTokens = 0

  try {
    const history = await getThreadMessages(threadId)
    let persistedAccumulatedTokens = getThread(threadId)?.accumulatedTokens ?? 0

    const userMsgId = crypto.randomUUID()
    await saveMessage(threadId, {
      id: userMsgId, role: 'user', content: text,
      data: attachments?.length ? JSON.stringify({ attachments }) : undefined
    })

    const ctx = getWorkspaceContext(threadId) || (await getOrCreateWorkspaceContext(threadId))
    if (ctx.isUserWorkspace && !getThreadWorkspace(threadId)) {
      try { setThreadWorkspace(threadId, ctx.rootPath); addOpenedWorkspace(ctx.rootPath) } catch {}
    }

    const models = await getAvailableModels()
    const availableModelsList = Object.values(models)
    if (!availableModelsList.length) throw new Error('No models configured on server.')
    const rawModel: any = modelType ? models[modelType] : availableModelsList[0]
    if (!rawModel) throw new Error(`Requested model "${modelType}" is not available.`)

    const modelSupportsVision = checkModelVisionSupport(rawModel.id)
    const modelSupportsNativeFiles = checkModelNativeFileSupport(rawModel.id)

    const { messages: historyMessages, systemInstructionSuffix } = buildMessagesFromHistory(
      history,
      modelSupportsVision,
      modelSupportsNativeFiles
    )
    const userContent = attachments?.length
      ? buildAttachmentParts(text, attachments, modelSupportsVision, modelSupportsNativeFiles)
      : text
    historyMessages.push({ role: 'user', content: userContent as any })
    const messages = sanitizeMessages(historyMessages)

    const browserView = WindowManager.getBrowserView()
    const browserInstruction = browserView
      ? `\n── BROWSER AUTOMATION ACTIVE ──\nYou have active browser control. Use these tools:\n1. browserNavigate(url): Open pages.\n2. browserType(selector, text, frameSelector?): Type into inputs, pierce iframes.\n3. browserScroll(direction, amount?): Scroll to load lazy elements.\n4. browserMouseClickCoordinate(x, y, button?): Click absolute pixel coordinates.\n${modelSupportsVision ? `5. browserScreenshot(): ALWAYS capture a screenshot after navigation/typing to verify page state.` : `5. browserGetPageContent(): Extract page URL, title, inner text, and interactive elements.`}`
      : ''

    // Dynamically scan installed skills so the list never rots as skills are added/removed
    const installedSkills = await listInstalledSkills()
    const skillsRootPath = getUserSkillsPath().replace(/\\/g, '/')
    const skillsSection = installedSkills.length > 0
      ? `── ADVANCED HELPER SKILLS ──
You have access to a set of advanced helper skills (guidelines, scripts, and libraries) located at:
${skillsRootPath}

Available skills:
${installedSkills.map((s) => `- ${s.name}${s.description ? ` (${s.description})` : ''}`).join('\n')}

Before performing any tasks related to these domain areas, use listDir to explore the skill folder and readFile to read the SKILL.md at that path. Always follow the exact workflows, scripts, and tools detailed in the skill file.`
      : ''

    const systemInstruction = `You are Orch Code, a highly capable AI developer assistant. Active conversation ID: ${threadId}.

── WORKSPACE ──
Root path: ${ctx.rootPath || 'No workspace selected'}

IMPORTANT: Use searchWorkspace(query) to find files or code by pattern. Use listDir(directoryPath) to explore directories. Do NOT assume file contents — always read before editing.
${browserInstruction}
${skillsSection}
── ARTIFACT BOUNDARIES & WORKFLOW ──
Use the sandboxed Artifacts system inside '.orch-artifacts/' folder of the active workspace.
Use writeToFile, replaceFileContent tools to manage these artifact files:

1. [PLANNING]: For any non-trivial changes, create or update an implementation plan at '.orch-artifacts/implementation_plan.md'.
   - Stop and wait for user approval (they have Proceed/Reject buttons in the panel).
   - Do NOT modify source files until you receive approval.

2. [NO WALKTHROUGHS]: Never create or edit walkthrough markdown files.

── CRITICAL TOOL SELECTION RULE ──
You must ALWAYS use native function calling tools (e.g. viewFile, writeToFile, replaceFileContent, searchWorkspace, listDir) for reading, writing, editing, or searching files.
Do NOT execute terminal/shell commands for file operations. Use runCommand ONLY for running tests, compilers, formatters, and environment setup.`

    const coreTools = createCoreTools(threadId, modelSupportsVision)
    const activeTools = { ...coreTools, ...(browserView ? browserTools(threadId, modelSupportsVision) : {}) }
    const { model: resolvedModel, providerOptions: modelProviderOptions } = resolveModel(rawModel.id)

    log.info(`[stream] model: ${rawModel.id}, messages: ${messages.length}`)
    assistantMsgId = crypto.randomUUID()
    let currentReasoningStartMs = 0

    const saveProgress = async () => {
      if (assistantContent || orderedBlocks.length > 0) {
        try {
          await saveMessage(threadId, {
            id: assistantMsgId, role: 'assistant',
            content: assistantContent || '', data: JSON.stringify(orderedBlocks)
          })
        } catch (err) { log.error('[stream] Progressive save failed:', err) }
      }
    }

    const result = streamText({
      model: resolvedModel,
      system: systemInstruction + (systemInstructionSuffix || ''),
      messages,
      tools: activeTools,
      stopWhen: stepCountIs(100),
      abortSignal: controller.signal,
      timeout: { totalMs: 30 * 60 * 1000, stepMs: 5 * 60 * 1000, chunkMs: 90 * 1000 },
      ...(Object.keys(modelProviderOptions).length > 0 ? { providerOptions: modelProviderOptions } : {}),

      onStepFinish: async ({ usage }) => {
        if (usage) {
          const stepTokens = usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)
          sessionAccumulatedTokens += stepTokens
          send({ type: 'token-update', payload: { accumulatedTokens: persistedAccumulatedTokens + sessionAccumulatedTokens }, threadId })
        }
      },

      prepareStep: async ({ messages: currentMessages }) => {
        if (persistedAccumulatedTokens + sessionAccumulatedTokens < SUMMARISE_THRESHOLD) return undefined
        log.info(`[stream] Context at ${sessionAccumulatedTokens} tokens — triggering auto-summarise`)
        const summary = await summariseContext(currentMessages as ModelMessage[])
        if (!summary) return undefined
        try {
          compactThreadHistory(threadId, summary)
          setThreadAccumulatedTokens(threadId, 0)
          persistedAccumulatedTokens = 0
          sessionAccumulatedTokens = 0
        } catch (err) { log.error('[stream] Database compaction failed:', err) }
        send({ type: 'token-update', payload: { accumulatedTokens: 0 }, threadId })
        const sliced = (currentMessages as ModelMessage[]).slice(-10)
        const sanitized = sanitizeMessages(sliced)
        return {
          system: systemInstruction + `\n\n── CONTEXT COMPACTED ──\nPrior conversation summarised. Summary:\n\n${summary}\n\nContinue from this state.`,
          messages: sanitized
        }
      },

      onAbort: saveProgress,
      onError: async ({ error }) => { log.error('[stream] AI SDK error:', error); await saveProgress() }
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
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (last?.type === 'reasoning') {
            (last as any).content += part.text || ''
            ;(last as any).durationMs = Date.now() - currentReasoningStartMs
          }
          send({ type: 'reasoning-delta', payload: part.text || '', threadId })
          break
        }

        case 'reasoning-end':
          send({ type: 'reasoning-end', threadId })
          break

        case 'text-delta': {
          const delta = part.text || ''
          assistantContent += delta
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: delta })
          else (last as any).content += delta
          send({ type: 'text-delta', payload: delta, threadId })
          break
        }

        case 'tool-input-start': {
          const p = part as any
          const tid = p.toolCallId || p.id || ''
          orderedBlocks.push({ type: 'tool', toolCallId: tid, toolName: p.toolName || '', args: {}, argsDelta: '', status: 'pending' })
          send({ type: 'tool-call-streaming-start', payload: { toolCallId: tid, toolName: p.toolName || '' }, threadId })
          break
        }

        case 'tool-input-delta': {
          const p = part as any
          const tid = p.toolCallId || p.id || ''
          const delta = p.argsTextDelta || p.delta || ''
          const block = orderedBlocks.find((b) => b.type === 'tool' && (b as any).toolCallId === tid) as any
          if (block) block.argsDelta = (block.argsDelta || '') + delta
          send({ type: 'tool-call-delta', payload: { toolCallId: tid, delta }, threadId })
          break
        }

        case 'tool-call': {
          const p = part as any
          const tid = p.toolCallId || p.id || ''
          const block = orderedBlocks.find((b) => b.type === 'tool' && (b as any).toolCallId === tid) as any
          if (block) { block.args = p.args || p.input; block.argsDelta = undefined }
          else orderedBlocks.push({ type: 'tool', toolCallId: tid, toolName: p.toolName || '', args: p.args || p.input, status: 'pending' })
          send({ type: 'tool-call', payload: { toolCallId: tid, toolName: p.toolName || '', args: p.args || p.input }, threadId })
          break
        }

        case 'tool-result': {
          const block = orderedBlocks.find((b) => b.type === 'tool' && (b as any).toolCallId === part.toolCallId) as any
          if (block) { block.result = part.output; block.status = 'complete' }
          send({ type: 'tool-result', payload: { toolCallId: part.toolCallId, result: part.output }, threadId })
          if (['writeToFile', 'replaceFileContent', 'multiReplaceFileContent'].includes(part.toolName)) {
            pushArtifactsChanged(threadId)
          }
          break
        }

        case 'error': {
          const errorMsg = part.error instanceof Error ? part.error.message : String(part.error || 'Unknown error')
          log.error(`[stream] error: "${errorMsg}"`)
          for (const b of orderedBlocks) { if ((b as any).status === 'pending') (b as any).status = 'error' }
          send({ type: 'error', payload: errorMsg, threadId })
          break
        }

        case 'finish': {
          const usage = (part as any).totalUsage || {}
          const promptTokens = usage.inputTokens || 0
          const completionTokens = usage.outputTokens || 0
          const total = promptTokens + completionTokens
          try { updateThreadAccumulatedTokens(threadId, sessionAccumulatedTokens || total) }
          catch (err) { log.error('[stream] Failed to save token count:', err) }
          send({
            type: 'finish',
            payload: { usage: { promptTokens, completionTokens, totalTokens: total }, accumulatedTokens: persistedAccumulatedTokens + (sessionAccumulatedTokens || total) },
            threadId
          })
          if ((part as any).finishReason === 'length') {
            log.warn(`[stream] Model hit token length limit for thread ${threadId}`)
            send({ type: 'step-limit', threadId })
          }
          log.info(`[stream] finish — turn: ${total} tokens, session: ${sessionAccumulatedTokens}`)
          break
        }

        default: {
          // Handle legacy event names from older AI SDK versions
          const p = part as any
          if (p.type === 'tool-call-streaming-start') {
            const tid = p.toolCallId || p.id || ''
            orderedBlocks.push({ type: 'tool', toolCallId: tid, toolName: p.toolName || '', args: {}, argsDelta: '', status: 'pending' })
            send({ type: 'tool-call-streaming-start', payload: { toolCallId: tid, toolName: p.toolName || '' }, threadId })
          } else if (p.type === 'tool-call-delta') {
            const tid = p.toolCallId || p.id || ''
            const delta = p.argsTextDelta || p.delta || ''
            const block = orderedBlocks.find((b) => b.type === 'tool' && (b as any).toolCallId === tid) as any
            if (block) block.argsDelta = (block.argsDelta || '') + delta
            send({ type: 'tool-call-delta', payload: { toolCallId: tid, delta }, threadId })
          } else if (p.type === 'tool-error') {
            const errMsg = p.error instanceof Error ? p.error.message : String(p.error)
            const block = orderedBlocks.find((b) => b.type === 'tool' && (b as any).toolCallId === p.toolCallId) as any
            if (block) { block.result = { success: false, error: errMsg }; block.status = 'error' }
            send({ type: 'tool-result', payload: { toolCallId: p.toolCallId, result: { success: false, error: errMsg } }, threadId })
          }
        }
      }
    }

    await saveProgress()
  } catch (err: unknown) {
    const error = err as Error & { name?: string }
    log.error('[stream] error:', error)
    if (error.name !== 'AbortError') {
      for (const b of orderedBlocks) { if ((b as any).status === 'pending') (b as any).status = 'error' }
      if (assistantContent || orderedBlocks.length > 0) {
        try {
          await saveMessage(threadId, {
            id: assistantMsgId, role: 'assistant',
            content: assistantContent || '[Stream Error]', data: JSON.stringify(orderedBlocks)
          })
        } catch {}
      }
      send({ type: 'error', payload: error.message, threadId })
    }
  } finally {
    if (activeAbortControllers.get(threadId) === controller) activeAbortControllers.delete(threadId)
    // The renderer process is now responsible for closing the port when it receives the 'finish' or 'error' chunk.
    // This guarantees that all IPC messages are flushed and processed before the pipe is destroyed.
  }
}
