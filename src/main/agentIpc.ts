import 'dotenv/config'
import crypto from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import {
  streamText,
  generateText,
  stepCountIs,
  ModelMessage,
  ToolCallPart,
  ToolResultPart
} from 'ai'
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

// Map to track active abort controllers for stream cancellations
export const activeAbortControllers = new Map<string, AbortController>()

function getMainWindow(): BrowserWindow | null {
  return (globalThis as unknown as { mainWindow?: BrowserWindow }).mainWindow || null
}

function getBrowserView(): any {
  return (globalThis as unknown as { browserView?: any }).browserView || null
}

export const google = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: (url, options) => {
    return geminiLimiter.schedule(async () => {
      const isCompaction = options?.headers && (options.headers as Record<string, string>)['x-in-flight-compaction']
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
      const isCompaction = options?.headers && (options.headers as Record<string, string>)['x-in-flight-compaction']
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
            .map((part: any) => {
              if (part.text) return part.text
              if (part.image) return `[Image Data]`
              if (part.type === 'tool-call') {
                return `[Tool Call: ${part.toolName}, Args: ${JSON.stringify(part.args || part.input || {})}]`
              }
              if (part.type === 'tool-result') {
                return `[Tool Result for ${part.toolName}: ${JSON.stringify(part.output || part.result || {})}]`
              }
              return JSON.stringify(part)
            })
            .join("\n")
        } else if (Array.isArray(m.parts)) {
          contentStr = m.parts
            .map((part: any) => {
              if (part.text) return part.text
              if (part.type === 'tool-call') {
                return `[Tool Call: ${part.toolName}, Args: ${JSON.stringify(part.args || part.input || {})}]`
              }
              if (part.type === 'tool-result') {
                return `[Tool Result for ${part.toolName}: ${JSON.stringify(part.output || part.result || {})}]`
              }
              return JSON.stringify(part)
            })
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

async function pushArtifactsChanged(conversationId: string): Promise<void> {
  const mainWindow = getMainWindow()
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
                    ].includes((outputVal as { type?: string }).type || '')
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
    const browserView = getBrowserView()
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
      stopWhen: stepCountIs(100),
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
        textDeltaCount++
        if (textDeltaCount % 10 === 0) {
          await saveProgress()
        }
      } else if (part.type === 'tool-input-start' || (part as { type?: string }).type === 'tool-call-streaming-start') {
        const p = part as { toolCallId?: string; id?: string; toolName?: string }
        const tid = p.toolCallId || p.id || p.toolCallId || ''
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
          threadId: convId
        })
      } else if (part.type === 'tool-input-delta' || (part as { type?: string }).type === 'tool-call-delta') {
        const p = part as { toolCallId?: string; id?: string; argsTextDelta?: string; delta?: string }
        const tid = p.toolCallId || p.id || p.toolCallId || ''
        const delta = p.argsTextDelta || p.delta || ''
        const block = orderedBlocks.find(
          (b) => b.type === 'tool' && b.toolCallId === tid
        )
        if (block) {
          block.argsDelta = (block.argsDelta || '') + delta
        }
        event.sender.send('agent:stream-chunk', {
          type: 'tool-call-delta',
          payload: { toolCallId: tid, delta },
          threadId: convId
        })
      } else if (part.type === 'tool-call') {
        const p = part as { toolCallId?: string; id?: string; toolName?: string; args?: any; input?: any }
        const tid = p.toolCallId || p.id || ''
        const tName = p.toolName || ''
        log.info(`[main] Tool: ${tName} (${tid})`)
        const block = orderedBlocks.find(
          (b) => b.type === 'tool' && b.toolCallId === tid
        )
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

        const finishReason = (part as { finishReason?: string; reason?: string }).finishReason ?? (part as { finishReason?: string; reason?: string }).reason ?? ''
        if (finishReason === 'length') {
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
    if (activeAbortControllers.get(convId) === controller) {
      activeAbortControllers.delete(convId)
    }
  }
}

export function registerAgentIpc() {
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
}
