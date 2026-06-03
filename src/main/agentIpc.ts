import 'dotenv/config'
import crypto from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import WindowManager from './windowManager'
import log from 'electron-log'
import {
  streamText,
  generateText,
  stepCountIs,
  type ModelMessage,
  type ToolCallPart,
  type ToolResultPart
} from 'ai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { chatStreamLimiter, geminiLimiter, nvidiaLimiter } from './limiters'
import {
  getOrCreateWorkspaceContext,
  getWorkspaceContext,
  updateWorkspacePath
} from './workspace'
import { createCoreTools, browserTools } from './tools'
import {
  getThreadMessages,
  saveMessage,
  updateThreadAccumulatedTokens,
  getThreadWorkspace,
  setThreadWorkspace,
  addOpenedWorkspace,
  updateThreadTitle
} from './db'
import { getCurrentSession } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelInfo {
  id: string
  name: string
}

type AvailableModels = Record<string, ModelInfo>

// ─── Model Cache ──────────────────────────────────────────────────────────────

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

// ─── Abort Controllers ────────────────────────────────────────────────────────

export const activeAbortControllers = new Map<string, AbortController>()

// ─── Helpers ──────────────────────────────────────────────────────────────────



function makeFetchWithAuth(extraHeaders?: Record<string, string>) {
  return (url: RequestInfo | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers || {})
    headers.set('Authorization', `Bearer ${process.env.SUPABASE_ANON_KEY}`)
    headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v)
    }
    return fetch(url, { ...options, headers })
  }
}

// ─── Provider Instances ───────────────────────────────────────────────────────

// Main Gemini provider — rate-limited via geminiLimiter
export const google = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: (url, options) =>
    geminiLimiter.schedule(() => fetch(url, {
      ...options,
      headers: (() => {
        const h = new Headers(options?.headers || {})
        h.set('Authorization', `Bearer ${process.env.SUPABASE_ANON_KEY}`)
        h.set('apikey', process.env.SUPABASE_ANON_KEY || '')
        return h
      })()
    }))
})

// Nvidia provider — rate-limited
export const nvidia = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/nvidia/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) =>
    nvidiaLimiter.schedule(() => fetch(url, {
      ...options,
      headers: (() => {
        const h = new Headers(options?.headers || {})
        h.set('Authorization', `Bearer ${process.env.SUPABASE_ANON_KEY}`)
        h.set('apikey', process.env.SUPABASE_ANON_KEY || '')
        return h
      })()
    }))
})

// Bypass provider for summarisation & title — no limiter, no compaction re-entry
const googleBypass = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: makeFetchWithAuth()
})

// ─── Context Summarisation ────────────────────────────────────────────────────

const SUMMARISE_THRESHOLD = 180_000 // tokens — trigger before hitting 200K hard limit
const SUMMARISE_MODEL = 'gemini-3.1-flash-lite'

async function summariseContext(messages: ModelMessage[]): Promise<string | null> {
  try {
    const transcript = messages
      .map((m) => {
        const role = m.role === 'tool' ? 'TOOL_RESULT' : m.role.toUpperCase()
        let content = ''
        if (typeof m.content === 'string') {
          content = m.content.slice(0, 3000)
        } else if (Array.isArray(m.content)) {
          content = (m.content as Array<{ type?: string; text?: string; toolName?: string; input?: unknown; args?: unknown; output?: unknown }>)
            .map((p) => {
              if (p.type === 'text') return p.text?.slice(0, 1000) ?? ''
              if (p.type === 'tool-call')
                return `[Tool: ${p.toolName}, Args: ${JSON.stringify(p.input || p.args || {}).slice(0, 400)}]`
              if (p.type === 'tool-result')
                return `[Result for ${p.toolName}: ${JSON.stringify(p.output || {}).slice(0, 400)}]`
              return ''
            })
            .filter(Boolean)
            .join('\n')
        }
        return `[${role}] ${content}`
      })
      .join('\n\n')

    const result = await generateText({
      model: googleBypass(SUMMARISE_MODEL),
      prompt: `Summarise this conversation history very compactly. Preserve: primary goal, exact file paths modified, architectural decisions, current state and next steps. Be dense — no fluff.\n\n${transcript}`
    })
    return result.text?.trim() || null
  } catch (err) {
    log.error('[summarise] Context summarisation failed:', err)
    return null
  }
}

// ─── Model Resolution ─────────────────────────────────────────────────────────

export function resolveModel(modelId: string): {
  model: Parameters<typeof streamText>[0]['model']
  providerOptions: ProviderOptions
} {
  if (modelId.startsWith('nvidia/')) {
    return { model: nvidia.chat(modelId.replace('nvidia/', '')), providerOptions: {} }
  }

  if (modelId.includes('gemma-4')) {
    return {
      model: google(modelId),
      providerOptions: { google: { chatTemplateKwargs: { enable_thinking: true } } } as ProviderOptions
    }
  }

  if (modelId.includes('thinking') || modelId.includes('pro')) {
    return {
      model: google(modelId),
      providerOptions: {
        google: { thinkingConfig: { thinkingLevel: 'auto', includeThoughts: true } }
      } as ProviderOptions
    }
  }

  return { model: google(modelId), providerOptions: {} }
}

// ─── Artifacts Push ───────────────────────────────────────────────────────────

async function pushArtifactsChanged(conversationId: string): Promise<void> {
  const mainWindow = WindowManager.getMainWindow()
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
    mainWindow.webContents.send('artifacts:changed', { conversationId, artifacts })
  } catch {}
}

// ─── History Builder ──────────────────────────────────────────────────────────

function buildMessagesFromHistory(
  history: Awaited<ReturnType<typeof getThreadMessages>>
): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (const m of history) {
    if (m.role === 'user') {
      let userContent: string | unknown[]= m.content
      if (m.data) {
        try {
          const dataObj = JSON.parse(m.data)
          if (Array.isArray(dataObj.attachments) && dataObj.attachments.length > 0) {
            const parts: unknown[] = [{ type: 'text', text: m.content }]
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
                  ;(parts[0] as { text: string }).text +=
                    `\n\n--- Attached Document: ${att.name} ---\n${fileContent}\n--- End of Document ---`
                } catch {}
              }
            }
            userContent = parts
          }
        } catch {}
      }
      messages.push({ role: 'user', content: userContent as string })
    } else if (m.role === 'assistant') {
      let textContent = ''
      const toolCalls: ToolCallPart[] = []
      const toolResults: ToolResultPart[] = []

      if (m.data) {
        try {
          const blocks = JSON.parse(m.data)
          if (Array.isArray(blocks)) {
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

                const outputVal = block.result
                let formattedOutput: unknown

                if (
                  outputVal &&
                  typeof outputVal === 'object' &&
                  'type' in outputVal &&
                  ['text', 'json', 'execution-denied', 'error-text', 'error-json', 'content'].includes(
                    (outputVal as { type?: string }).type || ''
                  )
                ) {
                  formattedOutput = outputVal
                } else if (
                  block.toolName === 'browserScreenshot' &&
                  (outputVal as { success?: boolean; filePath?: string })?.success &&
                  (outputVal as { filePath?: string })?.filePath
                ) {
                  try {
                    const cleanPath = (outputVal as { filePath: string }).filePath.replace('file://', '')
                    const base64Image = readFileSync(cleanPath).toString('base64')
                    formattedOutput = {
                      type: 'content',
                      value: [
                        { type: 'image-data', data: base64Image, mediaType: 'image/png' },
                        { type: 'text', text: `Screenshot: ${(outputVal as { filePath: string }).filePath}` }
                      ]
                    }
                  } catch (err: unknown) {
                    formattedOutput = {
                      type: 'content',
                      value: [{ type: 'text', text: `Failed to read screenshot: ${(err as Error).message}` }]
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

                toolResults.push({
                  type: 'tool-result',
                  toolCallId: block.toolCallId,
                  toolName: block.toolName,
                  output: formattedOutput as ToolResultPart['output']
                })
              }
            }
          }
        } catch {}
      }

      // Use raw content if no text block was found in structured data
      if (!textContent) textContent = m.content

      // Only include tool calls that have a matching result — prevents orphaned tool-role messages
      const resultIds = new Set(toolResults.map((r) => r.toolCallId))
      const pairedCalls = toolCalls.filter((c) => resultIds.has(c.toolCallId))
      const pairedResults = toolResults.filter((r) =>
        pairedCalls.some((c) => c.toolCallId === r.toolCallId)
      )

      let finalAssistantContent: string | unknown[]
      if (pairedCalls.length > 0) {
        const parts: unknown[] = []
        if (textContent) parts.push({ type: 'text', text: textContent })
        for (const call of pairedCalls) parts.push(call)
        finalAssistantContent = parts
      } else {
        finalAssistantContent = textContent || ''
      }

      messages.push({ role: 'assistant', content: finalAssistantContent as string })

      // CRITICAL: only push tool results if the assistant message actually contains tool-call parts
      if (
        pairedResults.length > 0 &&
        Array.isArray(finalAssistantContent) &&
        (finalAssistantContent as unknown[]).some(
          (p) => (p as { type?: string }).type === 'tool-call'
        )
      ) {
        messages.push({ role: 'tool', content: pairedResults })
      }
    }
  }

  return messages
}

function buildPromptContent(
  promptText: string,
  attachments?: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }>
): string | unknown[] {
  if (!attachments || attachments.length === 0) return promptText
  const parts: unknown[] = [{ type: 'text', text: promptText }]
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
        ;(parts[0] as { text: string }).text +=
          `\n\n--- Attached Document: ${att.name} ---\n${fileContent}\n--- End of Document ---`
      } catch {}
    }
  }
  return parts
}

// ─── Main Stream Handler ──────────────────────────────────────────────────────

async function handleAgentStreamRequest(
  event: Electron.IpcMainInvokeEvent,
  promptText: string,
  threadId: string,
  modelType?: string,
  attachments?: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }>
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

    // Build message history
    const messages = buildMessagesFromHistory(history)
    messages.push({ role: 'user', content: buildPromptContent(promptText, attachments) as string })

    // System instruction
    const browserView = WindowManager.getBrowserView()
    const browserInstruction = browserView
      ? `\n── BROWSER AUTOMATION ACTIVE ──
You have active browser control. Use these tools:
1. browserNavigate(url): Open pages.
2. browserType(selector, text, frameSelector?): Type into inputs, pierce iframes.
3. browserScroll(direction, amount?): Scroll to load lazy elements.
4. browserMouseClickCoordinate(x, y, button?): Click absolute pixel coordinates.
5. browserScreenshot(): ALWAYS capture a screenshot after navigation/typing to verify page state.`
      : ''

    const systemInstruction = `You are Orch Code, a highly capable AI developer assistant. Active conversation ID: ${threadId}.

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

    // Resolve model
    const models = await getAvailableModels()
    const availableModelsList = Object.values(models)
    if (availableModelsList.length === 0) throw new Error('No models configured on server.')
    const rawModel = models[modelType || ''] || availableModelsList[0]
    if (!rawModel) throw new Error('Failed to resolve model.')

    const coreTools = createCoreTools(threadId)
    const activeTools = {
      ...coreTools,
      ...(browserView ? browserTools(threadId) : {})
    }

    const { model: resolvedModel, providerOptions: modelProviderOptions } = resolveModel(rawModel.id)

    log.info(`[main] streamText model: ${rawModel.id}, messages: ${messages.length}`)

    assistantMsgId = crypto.randomUUID()

    let currentReasoningStartMs = 0

    const saveProgress = async () => {
      const blocksSnapshot = [...orderedBlocks]
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
      ...(Object.keys(modelProviderOptions).length > 0
        ? { providerOptions: modelProviderOptions }
        : {}),

      // Fires after each agentic step — emit live token update to renderer
      onStepFinish: async ({ usage }) => {
        if (usage) {
          const stepTokens = usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)
          sessionAccumulatedTokens += stepTokens
          event.sender.send('agent:stream-chunk', {
            type: 'token-update',
            payload: { accumulatedTokens: sessionAccumulatedTokens },
            threadId
          })
        }
      },

      // Fires before each step — auto-summarise context if approaching 200K limit
      prepareStep: async ({ messages: currentMessages }) => {
        if (sessionAccumulatedTokens < SUMMARISE_THRESHOLD) return undefined

        log.info(
          `[main] Context at ${sessionAccumulatedTokens} tokens — triggering auto-summarise`
        )
        const summary = await summariseContext(currentMessages as ModelMessage[])
        if (!summary) return undefined

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

        // Keep only the 4 most recent messages to give model clean context
        const recentMessages = (currentMessages as ModelMessage[]).slice(-4)

        return { system: compactedSystem, messages: recentMessages }
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
        await saveProgress()
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
        if (textDeltaCount % 10 === 0) await saveProgress()
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
        const p = part as { toolCallId?: string; id?: string; argsTextDelta?: string; delta?: string }
        const tid = p.toolCallId || p.id || ''
        const delta = p.argsTextDelta || p.delta || ''
        const block = orderedBlocks.find(
          (b) => b.type === 'tool' && b.toolCallId === tid
        ) as { argsDelta?: string } | undefined
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
        await saveProgress()
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
          threadId
        })
      } else if (part.type === 'finish') {
        const usage = (part as { totalUsage?: { inputTokens?: number; outputTokens?: number } }).totalUsage || {}
        const turnPromptTokens = usage.inputTokens || 0
        const turnCompletionTokens = usage.outputTokens || 0
        const turnTotal = turnPromptTokens + turnCompletionTokens

        try {
          updateThreadAccumulatedTokens(threadId, turnTotal)
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
            accumulatedTokens: sessionAccumulatedTokens
          },
          threadId
        })

        const finishReason = (
          part as { finishReason?: string; reason?: string }
        ).finishReason ?? (part as { reason?: string }).reason ?? ''
        if (finishReason === 'length') {
          log.warn(`[main] Model hit token length limit for thread ${threadId}`)
          event.sender.send('agent:stream-chunk', { type: 'step-limit', threadId })
        }

        log.info(`[main] Stream finish — turn: ${turnTotal} tokens, session: ${sessionAccumulatedTokens}`)
        await saveProgress()
      }
    }
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
        } catch {}
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

// ─── IPC Registration ─────────────────────────────────────────────────────────

export function registerAgentIpc() {
  ipcMain.handle(
    'agent:stream-request',
    async (
      event,
      promptText: string,
      threadId: string,
      _mode: string | undefined, // reserved, currently unused
      modelType?: string,
      attachments?: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }>
    ) => {
      const session = getCurrentSession()
      if (!session) throw new Error('Unauthorized: Please sign in to use agents.')
      return chatStreamLimiter.schedule(() =>
        handleAgentStreamRequest(event, promptText, threadId, modelType, attachments)
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

  ipcMain.handle('models:get-available', async () => {
    return await getAvailableModels()
  })

  ipcMain.handle('mastra:generate-title', async (_event, { text, threadId }) => {
    try {
      const result = await generateText({
        model: googleBypass(SUMMARISE_MODEL),
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
}
