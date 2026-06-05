import 'dotenv/config'
import crypto from 'node:crypto'
import {
  streamText,
  stepCountIs,
  type ModelMessage
} from 'ai'
import { readFileSync } from 'node:fs'
import log from 'electron-log'
import WindowManager from '../windowManager'
import { getAvailableModels, resolveModel } from './models'
import { checkModelVisionSupport, checkModelNativeFileSupport } from '../vision'
import { getOrCreateWorkspaceContext, getWorkspaceContext, updateWorkspacePath } from '../workspace'
import { getUserSkillsPath } from '../skills'
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

export const activeAbortControllers = new Map<string, AbortController>()

const SUMMARISE_THRESHOLD = 180_000 // tokens — trigger before hitting 200K hard limit

function buildMessagesFromHistory(
  history: Awaited<ReturnType<typeof getThreadMessages>>,
  modelSupportsVision: boolean,
  modelSupportsNativeFiles: boolean
): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (const m of history) {
    if (m.role === 'user') {
      let userContent: string | unknown[] = m.content
      if (m.data) {
        try {
          const dataObj = JSON.parse(m.data)
          if (Array.isArray(dataObj.attachments) && dataObj.attachments.length > 0) {
            const parts: unknown[] = [{ type: 'text', text: m.content }]
            for (const att of dataObj.attachments) {
              const mime = att.mimeType || 'application/octet-stream'
              const isText =
                mime.startsWith('text/') ||
                mime.endsWith('/json') ||
                mime.endsWith('+json') ||
                mime.endsWith('/xml') ||
                mime.endsWith('/javascript')

              if (isText) {
                try {
                  const textContent = Buffer.from(att.base64, 'base64').toString('utf-8')
                  ;(parts[0] as { text: string }).text +=
                    `\n\n── Attachment Text: ${att.name} ──\n${textContent}`
                } catch (decodeErr) {
                  log.error(`[main] Failed to decode attachment text:`, decodeErr)
                  ;(parts[0] as { text: string }).text +=
                    `\n\n[Attachment: ${att.name} - Failed to decode text]`
                }
              } else if (mime.startsWith('image/')) {
                if (modelSupportsVision) {
                  parts.push({
                    type: 'image',
                    image: Buffer.from(att.base64, 'base64'),
                    mimeType: mime
                  })
                } else {
                  ;(parts[0] as { text: string }).text +=
                    `\n\n[Attachment (Image): ${att.name} - Omitted from context because this model does not support vision]`
                }
              } else {
                if (modelSupportsNativeFiles) {
                  parts.push({
                    type: 'file',
                    data: Buffer.from(att.base64, 'base64'),
                    mimeType: mime
                  })
                } else {
                  ;(parts[0] as { text: string }).text +=
                    `\n\n[Attachment (File): ${att.name} - Omitted because this model does not support file attachments]`
                }
              }
            }
            userContent = parts
          }
        } catch (err) {
          log.error('[main] Failed to parse attachment data:', err)
        }
      }
      messages.push({ role: 'user', content: userContent as any })
    } else if (m.role === 'assistant') {
      let blocks: any[] = []
      if (m.data) {
        try {
          const parsed = JSON.parse(m.data)
          if (Array.isArray(parsed)) {
            blocks = parsed
          }
        } catch (err) {
          log.error('[main] Failed to parse message block data:', err)
        }
      }

      if (blocks.length === 0) {
        messages.push({ role: 'assistant', content: m.content || '' })
      } else {
        let currentAssistantParts: any[] = []
        let currentToolResults: any[] = []

        const flushCurrent = () => {
          if (currentAssistantParts.length > 0) {
            messages.push({ role: 'assistant', content: currentAssistantParts as any })
            currentAssistantParts = []
          }
          if (currentToolResults.length > 0) {
            messages.push({ role: 'tool', content: currentToolResults as any })
            currentToolResults = []
          }
        }

        for (const block of blocks) {
          if (block.type === 'text') {
            if (currentToolResults.length > 0) {
              flushCurrent()
            }
            currentAssistantParts.push({ type: 'text', text: block.content })
          } else if (block.type === 'tool') {
            if (currentToolResults.length > 0) {
              flushCurrent()
            }
            currentAssistantParts.push({
              type: 'tool-call',
              toolCallId: block.toolCallId,
              toolName: block.toolName,
              input: block.args || {}
            })

            if (block.status === 'complete' || block.status === 'error' || 'result' in block) {
              const outputVal = block.result
              let formattedOutput: unknown

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
                ].includes((outputVal as { type?: string }).type || '')
              ) {
                formattedOutput = outputVal
              } else if (
                block.toolName === 'browserScreenshot' &&
                (outputVal as { success?: boolean; filePath?: string })?.success &&
                (outputVal as { filePath?: string })?.filePath
              ) {
                try {
                  const cleanPath = (outputVal as { filePath: string }).filePath.replace(
                    'file://',
                    ''
                  )
                  const base64Image = readFileSync(cleanPath).toString('base64')
                  formattedOutput = {
                    type: 'content',
                    value: [
                      { type: 'image-data', data: base64Image, mediaType: 'image/png' },
                      {
                        type: 'text',
                        text: `Screenshot: ${(outputVal as { filePath: string }).filePath}`
                      }
                    ]
                  }
                } catch (err: unknown) {
                  formattedOutput = {
                    type: 'content',
                    value: [
                      {
                        type: 'text',
                        text: `Failed to read screenshot: ${(err as Error).message}`
                      }
                    ]
                  }
                }
              } else if (
                block.toolName === 'viewFile' &&
                (outputVal as { isBinary?: boolean })?.isBinary &&
                (outputVal as { mimeType?: string })?.mimeType?.startsWith('image/') &&
                (outputVal as { base64Content?: string })?.base64Content
              ) {
                formattedOutput = {
                  type: 'content',
                  value: [
                    {
                      type: 'image-data',
                      data: (outputVal as { base64Content: string }).base64Content,
                      mediaType: (outputVal as { mimeType: string }).mimeType
                    },
                    {
                      type: 'text',
                      text: `Analyzed binary image: ${(outputVal as { absolutePath: string }).absolutePath}`
                    }
                  ]
                }
              } else {
                const isError = block.status === 'error'
                formattedOutput = isError
                  ? typeof outputVal === 'string'
                    ? { type: 'error-text' as const, value: outputVal }
                    : { type: 'error-json' as const, value: outputVal ?? null }
                  : typeof outputVal === 'string'
                    ? { type: 'text' as const, value: outputVal }
                    : { type: 'json' as const, value: outputVal ?? null }
              }

              currentToolResults.push({
                type: 'tool-result',
                toolCallId: block.toolCallId,
                toolName: block.toolName,
                output: formattedOutput as any
              })
            }
          }
        }

        flushCurrent()
      }
    } else if (m.role === 'system') {
      messages.push({ role: 'system', content: m.content })
    }
  }

  return messages
}

export async function handleAgentStreamRequest(
  event: Electron.IpcMainInvokeEvent,
  promptText: string,
  threadId: string,
  modelType?: string,
  attachments?: Array<{
    type: 'image' | 'document'
    name: string
    mimeType?: string
    base64: string
  }>
) {
  log.info(`[main] Stream request: "${promptText.slice(0, 80)}" thread: "${threadId}"`)

  // Abort any existing stream for this thread
  const existingController = activeAbortControllers.get(threadId)
  if (existingController) existingController.abort()

  const controller = new AbortController()
  activeAbortControllers.set(threadId, controller)

  // Bind workspace if needed
  try {
    const wsPath = getThreadWorkspace(threadId)
    if (wsPath) await updateWorkspacePath(threadId, wsPath)
  } catch (err) {
    log.warn(`[main] Failed to bind workspace for stream ${threadId}:`, err)
  }

  let assistantMsgId = ''
  let assistantContent = ''
  const orderedBlocks: Record<string, unknown>[] = []

  // Running token total for this stream session (across all steps)
  let sessionAccumulatedTokens = 0

  try {
    const history = await getThreadMessages(threadId)
    let persistedAccumulatedTokens = getThread(threadId)?.accumulatedTokens ?? 0

    // Save user message
    const userMsgId = crypto.randomUUID()
    const attachmentsData =
      attachments && attachments.length > 0 ? JSON.stringify({ attachments }) : undefined
    await saveMessage(threadId, {
      id: userMsgId,
      role: 'user',
      content: promptText,
      data: attachmentsData
    })

    // Ensure workspace context
    const ctx = getWorkspaceContext(threadId) || (await getOrCreateWorkspaceContext(threadId))
    if (ctx.isUserWorkspace && !getThreadWorkspace(threadId)) {
      try {
        setThreadWorkspace(threadId, ctx.rootPath)
        addOpenedWorkspace(ctx.rootPath)
        log.info(`[main] Auto-bound thread ${threadId} to workspace ${ctx.rootPath}`)
      } catch (err) {
        log.warn('[main] Auto-bind thread to workspace failed:', err)
      }
    }

    // Resolve model first to know capabilities
    const models = await getAvailableModels()
    const availableModelsList = Object.values(models)
    if (availableModelsList.length === 0) throw new Error('No models configured on server.')

    let rawModel: any = null
    if (modelType) {
      rawModel = models[modelType]
      if (!rawModel) {
        throw new Error(`Requested model "${modelType}" is not configured or available on the server.`)
      }
    } else {
      rawModel = availableModelsList[0]
    }
    if (!rawModel) throw new Error('Failed to resolve model.')

    const modelSupportsVision = checkModelVisionSupport(rawModel.id)
    const modelSupportsNativeFiles = checkModelNativeFileSupport(rawModel.id)

    // Build current user message content
    let userContent: string | unknown[] = promptText
    if (attachments && attachments.length > 0) {
      const parts: unknown[] = [{ type: 'text', text: promptText }]
      for (const att of attachments) {
        const mime = att.mimeType || 'application/octet-stream'
        const isText =
          mime.startsWith('text/') ||
          mime.endsWith('/json') ||
          mime.endsWith('+json') ||
          mime.endsWith('/xml') ||
          mime.endsWith('/javascript')

        if (isText) {
          try {
            const textContent = Buffer.from(att.base64, 'base64').toString('utf-8')
            ;(parts[0] as { text: string }).text +=
              `\n\n── Attachment Text: ${att.name} ──\n${textContent}`
          } catch (decodeErr) {
            log.error(`[main] Failed to decode attachment text:`, decodeErr)
            ;(parts[0] as { text: string }).text +=
              `\n\n[Attachment: ${att.name} - Failed to decode text]`
          }
        } else if (mime.startsWith('image/')) {
          if (modelSupportsVision) {
            parts.push({
              type: 'image',
              image: Buffer.from(att.base64, 'base64'),
              mimeType: mime
            })
          } else {
            ;(parts[0] as { text: string }).text +=
              `\n\n[Attachment (Image): ${att.name} - Omitted from context because this model does not support vision]`
          }
        } else {
          if (modelSupportsNativeFiles) {
            parts.push({
              type: 'file',
              data: Buffer.from(att.base64, 'base64'),
              mimeType: mime
            })
          } else {
            ;(parts[0] as { text: string }).text +=
              `\n\n[Attachment (File): ${att.name} - Omitted because this model does not support file attachments]`
          }
        }
      }
      userContent = parts
    }

    const messages = buildMessagesFromHistory(
      history,
      modelSupportsVision,
      modelSupportsNativeFiles
    )
    messages.push({ role: 'user', content: userContent as any })

    // System instruction
    const browserView = WindowManager.getBrowserView()
    const browserInstruction = browserView
      ? `\n── BROWSER AUTOMATION ACTIVE ──
You have active browser control. Use these tools:
1. browserNavigate(url): Open pages.
2. browserType(selector, text, frameSelector?): Type into inputs, pierce iframes.
3. browserScroll(direction, amount?): Scroll to load lazy elements.
4. browserMouseClickCoordinate(x, y, button?): Click absolute pixel coordinates.
${
  modelSupportsVision
    ? `5. browserScreenshot(): ALWAYS capture a screenshot after navigation/typing to verify page state.`
    : `5. browserGetPageContent(): Extract the page URL, title, inner text, and interactive elements to understand the page state (since you do NOT support vision/images, do NOT capture screenshots).`
}`
      : ''

    const systemInstruction = `You are Orch Code, a highly capable AI developer assistant. Active conversation ID: ${threadId}.

── WORKSPACE ──
Root path: ${ctx.rootPath || 'No workspace selected'}

IMPORTANT: Use searchWorkspace(query) to find files or code by pattern. Use listDir(directoryPath) to explore directories. Do NOT assume file contents — always read before editing.
${browserInstruction}
── ADVANCED HELPER SKILLS ──
You have access to a set of advanced helper skills (guidelines, scripts, and libraries) located at:
${getUserSkillsPath().replace(/\\/g, '/')}

Available skills:
- algorithmic-art (algorithmic art generator and viewer templates)
- brand-guidelines (styling with brand palettes)
- docx (creating/editing/repacking .docx files using docx-js and python scripts)
- frontend-design (frontend design principles and guidelines)
- pdf (reading/filling forms and converting PDFs using python scripts)
- pptx (creating/editing presentations using python scripts and pptxgenjs)
- theme-factory (themes with color palettes and font pairings)
- xlsx (creating/modifying/recalculating spreadsheets using openpyxl and recalc.py)

Before performing any tasks related to these domain areas (e.g., generating slide decks, spreadsheets, word docs, fillable PDFs, or frontend designs), you MUST read the corresponding SKILL.md file at that path (using viewFile) to understand the requirements, workflows, guidelines, and tool usage (including the absolute paths to the helper scripts). Always use the exact scripts and tools detailed in the skill guidelines.

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

    const coreTools = createCoreTools(threadId, modelSupportsVision)
    const activeTools = {
      ...coreTools,
      ...(browserView ? browserTools(threadId, modelSupportsVision) : {})
    }

    const { model: resolvedModel, providerOptions: modelProviderOptions } = resolveModel(
      rawModel.id
    )

    log.info(`[main] streamText model: ${rawModel.id}, messages: ${messages.length}`)

    assistantMsgId = crypto.randomUUID()

    let currentReasoningStartMs = 0

    const saveProgress = async () => {
      const blocksSnapshot = JSON.parse(JSON.stringify(orderedBlocks))
      const contentSnapshot = assistantContent
      if (contentSnapshot || blocksSnapshot.length > 0) {
        try {
          await saveMessage(threadId, {
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

    const result = streamText({
      model: resolvedModel,
      system: systemInstruction,
      messages,
      tools: activeTools,
      stopWhen: stepCountIs(100),
      abortSignal: controller.signal,
      timeout: { totalMs: 30 * 60 * 1000, stepMs: 5 * 60 * 1000, chunkMs: 90 * 1000 },
      ...(Object.keys(modelProviderOptions).length > 0
        ? { providerOptions: modelProviderOptions }
        : {}),

      // Fires after each agentic step — emit live token update to renderer
      onStepFinish: async ({ usage }) => {
        if (usage) {
          const stepTokens =
            usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)
          sessionAccumulatedTokens += stepTokens
          event.sender.send('agent:stream-chunk', {
            type: 'token-update',
            payload: { accumulatedTokens: persistedAccumulatedTokens + sessionAccumulatedTokens },
            threadId
          })
        }
      },

      // Fires before each step — auto-summarise context and compact history
      prepareStep: async ({ messages: currentMessages }) => {
        if (persistedAccumulatedTokens + sessionAccumulatedTokens < SUMMARISE_THRESHOLD) {
          return undefined
        }

        log.info(`[main] Context at ${sessionAccumulatedTokens} tokens — triggering auto-summarise`)
        const summary = await summariseContext(currentMessages as ModelMessage[])
        if (!summary) return undefined

        // Persist context compaction to SQLite!
        try {
          compactThreadHistory(threadId, summary)
          setThreadAccumulatedTokens(threadId, 0)
          persistedAccumulatedTokens = 0
          sessionAccumulatedTokens = 0
          log.info(`[main] Compacted history persisted for thread ${threadId}`)
        } catch (compactErr) {
          log.error('[main] Database compaction execution failed:', compactErr)
        }

        // Reset accumulated count after successful compaction
        sessionAccumulatedTokens = 0
        event.sender.send('agent:stream-chunk', {
          type: 'token-update',
          payload: { accumulatedTokens: 0 },
          threadId
        })

        const compactedSystem =
          systemInstruction +
          `\n\n── CONTEXT COMPACTED ──\nPrior conversation summarised to preserve context window. Summary:\n\n${summary}\n\nContinue from this state.`

        // Keep only the 10 most recent messages to give model clean context
        const recentMessages = (currentMessages as ModelMessage[]).slice(-10)

        return { system: compactedSystem, messages: recentMessages }
      },
      onAbort: saveProgress,
      onError: async ({ error }) => {
        log.error('[main] AI SDK stream error:', error)
        await saveProgress()
      }
    })

    let textDeltaCount = 0

    for await (const part of result.fullStream) {
      if (controller.signal.aborted) break

      if (part.type === 'reasoning-start') {
        currentReasoningStartMs = Date.now()
        orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0 })
        event.sender.send('agent:stream-chunk', { type: 'reasoning-start', threadId })
      } else if (part.type === 'reasoning-delta') {
        const textDelta = part.text || ''
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') {
          ;(last as { content: string; durationMs: number }).content += textDelta
          ;(last as { durationMs: number }).durationMs = Date.now() - currentReasoningStartMs
        }
        event.sender.send('agent:stream-chunk', {
          type: 'reasoning-delta',
          payload: textDelta,
          threadId
        })
      } else if (part.type === 'reasoning-end') {
        event.sender.send('agent:stream-chunk', { type: 'reasoning-end', threadId })
      } else if (part.type === 'text-delta') {
        const textDelta = part.text || ''
        assistantContent += textDelta
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (!last || last.type !== 'text') {
          orderedBlocks.push({ type: 'text', content: textDelta })
        } else {
          ;(last as { content: string }).content += textDelta
        }
        event.sender.send('agent:stream-chunk', {
          type: 'text-delta',
          payload: textDelta,
          threadId
        })
        textDeltaCount++
      } else if (
        part.type === 'tool-input-start' ||
        (part as { type?: string }).type === 'tool-call-streaming-start'
      ) {
        const p = part as { toolCallId?: string; id?: string; toolName?: string }
        const tid = p.toolCallId || p.id || ''
        const tName = p.toolName || ''
        log.info(`[main] Tool streaming start: ${tName} (${tid})`)
        orderedBlocks.push({
          type: 'tool',
          toolCallId: tid,
          toolName: tName,
          args: {},
          argsDelta: '',
          status: 'pending'
        })
        event.sender.send('agent:stream-chunk', {
          type: 'tool-call-streaming-start',
          payload: { toolCallId: tid, toolName: tName },
          threadId
        })
      } else if (
        part.type === 'tool-input-delta' ||
        (part as { type?: string }).type === 'tool-call-delta'
      ) {
        const p = part as {
          toolCallId?: string
          id?: string
          argsTextDelta?: string
          delta?: string
        }
        const tid = p.toolCallId || p.id || ''
        const delta = p.argsTextDelta || p.delta || ''
        const block = orderedBlocks.find((b) => b.type === 'tool' && b.toolCallId === tid) as
          | { argsDelta?: string }
          | undefined
        if (block) block.argsDelta = (block.argsDelta || '') + delta
        event.sender.send('agent:stream-chunk', {
          type: 'tool-call-delta',
          payload: { toolCallId: tid, delta },
          threadId
        })
      } else if (part.type === 'tool-call') {
        const p = part as {
          toolCallId?: string
          id?: string
          toolName?: string
          args?: unknown
          input?: unknown
        }
        const tid = p.toolCallId || p.id || ''
        const tName = p.toolName || ''
        log.info(`[main] Tool: ${tName} (${tid})`)
        const block = orderedBlocks.find((b) => b.type === 'tool' && b.toolCallId === tid) as
          | Record<string, unknown>
          | undefined
        if (block) {
          block.args = p.args || p.input
          block.argsDelta = undefined
        } else {
          orderedBlocks.push({
            type: 'tool',
            toolCallId: tid,
            toolName: tName,
            args: p.args || p.input,
            status: 'pending'
          })
        }
        event.sender.send('agent:stream-chunk', {
          type: 'tool-call',
          payload: { toolCallId: tid, toolName: tName, args: p.args || p.input },
          threadId
        })
      } else if (part.type === 'tool-result') {
        log.info(`[main] Tool result: ${part.toolName}`)
        const block = orderedBlocks.find(
          (b) => b.type === 'tool' && b.toolCallId === part.toolCallId
        ) as Record<string, unknown> | undefined
        if (block) {
          block.result = part.output
          block.status = 'complete'
        }
        event.sender.send('agent:stream-chunk', {
          type: 'tool-result',
          payload: { toolCallId: part.toolCallId, result: part.output },
          threadId
        })
        const writingTools = ['writeToFile', 'replaceFileContent', 'multiReplaceFileContent']
        if (writingTools.includes(part.toolName)) pushArtifactsChanged(threadId)
      } else if ((part as { type?: string }).type === 'tool-error') {
        const toolError = part as {
          toolCallId: string
          toolName: string
          error: unknown
        }
        const errorMessage =
          toolError.error instanceof Error ? toolError.error.message : String(toolError.error)
        const block = orderedBlocks.find(
          (b) => b.type === 'tool' && b.toolCallId === toolError.toolCallId
        ) as Record<string, unknown> | undefined
        if (block) {
          block.result = { success: false, error: errorMessage }
          block.status = 'error'
        }
        event.sender.send('agent:stream-chunk', {
          type: 'tool-result',
          payload: {
            toolCallId: toolError.toolCallId,
            result: { success: false, error: errorMessage }
          },
          threadId
        })
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
          threadId
        })
      } else if (part.type === 'finish') {
        const usage =
          (part as { totalUsage?: { inputTokens?: number; outputTokens?: number } }).totalUsage ||
          {}
        const turnPromptTokens = usage.inputTokens || 0
        const turnCompletionTokens = usage.outputTokens || 0
        const turnTotal = turnPromptTokens + turnCompletionTokens

        try {
          const tokensToPersist = sessionAccumulatedTokens || turnTotal
          updateThreadAccumulatedTokens(threadId, tokensToPersist)
        } catch (dbErr) {
          log.error('[main] Failed to save session token count:', dbErr)
        }

        // Send the running session total (not just this turn) so the ring is accurate
        event.sender.send('agent:stream-chunk', {
          type: 'finish',
          payload: {
            usage: {
              promptTokens: turnPromptTokens,
              completionTokens: turnCompletionTokens,
              totalTokens: turnTotal
            },
            accumulatedTokens: persistedAccumulatedTokens + (sessionAccumulatedTokens || turnTotal)
          },
          threadId
        })

        const finishReason =
          (part as { finishReason?: string; reason?: string }).finishReason ??
          (part as { reason?: string }).reason ??
          ''
        if (finishReason === 'length') {
          log.warn(`[main] Model hit token length limit for thread ${threadId}`)
          event.sender.send('agent:stream-chunk', { type: 'step-limit', threadId })
        }

        log.info(
          `[main] Stream finish — turn: ${turnTotal} tokens, session: ${sessionAccumulatedTokens}`
        )
      }
    }

    // Persist final assistant response state exactly once on successful finish
    await saveProgress()
  } catch (err: unknown) {
    const error = err as Error & { name?: string }
    log.error('[main] Stream error:', error)
    if (error.name !== 'AbortError') {
      for (const block of orderedBlocks) {
        if (block.type === 'tool' && block.status === 'pending') block.status = 'error'
      }
      if (assistantContent || orderedBlocks.length > 0) {
        try {
          await saveMessage(threadId, {
            id: assistantMsgId,
            role: 'assistant',
            content: assistantContent || '[Stream Error]',
            data: JSON.stringify(orderedBlocks)
          })
        } catch (err) {
          log.error('[main] Failed to save stream error message:', err)
        }
      }
      event.sender.send('agent:stream-chunk', {
        type: 'error',
        payload: error.message,
        threadId
      })
    }
  } finally {
    if (activeAbortControllers.get(threadId) === controller) {
      activeAbortControllers.delete(threadId)
    }
  }
}
