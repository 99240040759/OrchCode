import crypto from 'node:crypto'
import log from 'electron-log'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { getAvailableModels, streamLlmResponse, getOpenAiTools } from './models'
import { getOrCreateWorkspaceContext, getWorkspaceContext, updateWorkspacePath, markWorkspaceActive, markWorkspaceIdle } from './workspace'
import { getUserSkillsPath, listInstalledSkills } from './skills'
import { createCoreTools, browserTools } from './tools'
import {
  getThreadMessages, getThread, saveMessage,
  setThreadAccumulatedTokens, getThreadWorkspace, setThreadWorkspace, addOpenedWorkspace,
  compactThreadHistory, updateThreadTokens
} from './db'
import { summariseContext } from './summarisation'
import { buildMessagesFromHistory, sanitizeMessages, buildAttachmentParts, StreamBlock } from './schema'
import type { ModelInfo } from './models'
import { countTokens, countMessagesTokens } from './tokenizer'
import { jsonrepair } from 'jsonrepair'
import { parse as parsePartialJson } from 'partial-json'





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
- Always inspect the structure or contents of a target file using \`viewFile\` (using startLine/endLine pagination if needed) or \`getFileOutline\` before proposing edits.

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
- **File System Tools:** Use only the native APIs (\`viewFile\`, \`writeToFile\`, \`multiReplaceFileContent\`, \`listDir\`, \`searchWorkspace\`, \`getFileOutline\`) for all file actions.
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
  isBrowserActive: boolean | undefined,
  startTimeParam?: number
) {
  const startTime = startTimeParam ?? Date.now()
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
  let lifetimeTokensAdded = 0
  let currentContextTokens = 0
  let persistedLifetimeTokens = 0

  try {
    const history = await getThreadMessages(threadId)
    const threadData = await getThread(threadId)
    currentContextTokens = threadData?.accumulatedTokens ?? 0
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
    const rawModel: ModelInfo | undefined = modelType ? (models[modelType] || Object.values(models).find(m => m.id === modelType)) : availableList[0]
    if (!rawModel) throw new Error(`Requested model "${modelType}" is not available.`)

    const modelSupportsVision = !!rawModel.capabilities?.vision
    const modelSupportsNativeFiles = !!rawModel.capabilities?.nativeFiles
    const { messages: historyMessages, systemInstructionSuffix } = await buildMessagesFromHistory(history, modelSupportsVision, modelSupportsNativeFiles)
    
    const messages = sanitizeMessages(historyMessages)
    messages.push({ role: 'user', content: attachments?.length ? buildAttachmentParts(text, attachments as any, modelSupportsVision, modelSupportsNativeFiles) as any : text })

    const browserInstruction = buildBrowserInstruction(!!isBrowserActive, modelSupportsVision)
    const skillsSection = await buildSkillsSection()
    const coreTools = createCoreTools(threadId, modelSupportsVision)
    const activeTools = {
      ...coreTools,
      ...(isBrowserActive ? browserTools(threadId, modelSupportsVision) : {})
    }

    assistantMsgId = crypto.randomUUID()
    let lastSaveMs = 0, saveInFlight = false, saveQueued = false

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

    let stepCount = 0
    let shouldContinue = true

    while (shouldContinue && stepCount < 100) {
      if (controller.signal.aborted) break
      stepCount++
      log.info(`[stream] Executing step ${stepCount} for thread ${threadId}`)

      const exactHistoryTokens = countMessagesTokens(messages, modelType)
      const systemInstruction = buildSystemPrompt(threadId, ctx.rootPath || '', browserInstruction, skillsSection, exactHistoryTokens)
      const fullSystemInstruction = systemInstruction + (systemInstructionSuffix || '')
      const sysPromptTokens = countTokens(fullSystemInstruction, modelType)
      const toolSchemaTokens = activeTools ? countTokens(JSON.stringify(getOpenAiTools(activeTools)), modelType) : 0
      const stepInputTokens = exactHistoryTokens + sysPromptTokens + toolSchemaTokens
      lifetimeTokensAdded += stepInputTokens
      currentContextTokens = stepInputTokens
      send({ type: 'token_update', payload: { accumulatedTokens: currentContextTokens, lifetimeTokens: persistedLifetimeTokens + lifetimeTokensAdded }, threadId })

      const chunkStream = await streamLlmResponse(
        rawModel.id,
        messages,
        fullSystemInstruction,
        activeTools,
        controller.signal
      )

      let hasToolCallsInStep = false
      const stepToolCalls: Array<{ id: string, name: string, args: Record<string, unknown> }> = []
      const toolCallAccumulators = new Map<number, { id: string, name: string, args: string, sent_start?: boolean }>()

      for await (const chunk of chunkStream) {
        if (controller.signal.aborted) break
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta
        if (delta) {
          if (delta.content) {
            const textDelta = delta.content
            assistantContent += textDelta
            const last = orderedBlocks[orderedBlocks.length - 1]
            if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: textDelta })
            else last.content += textDelta
            send({ type: 'text_delta', payload: textDelta, threadId })
            void saveProgress(false)
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index
              let accumulated = toolCallAccumulators.get(idx)
              if (!accumulated) {
                accumulated = { id: tc.id || '', name: tc.function?.name || '', args: '' }
                toolCallAccumulators.set(idx, accumulated)
              }
              if (tc.id && !accumulated.id) accumulated.id = tc.id
              if (tc.function?.name && !accumulated.name) accumulated.name = tc.function.name
              if (accumulated.id && accumulated.name && !accumulated.sent_start) {
                accumulated.sent_start = true
                send({ type: 'tool_call_start', payload: { tool_call_id: accumulated.id, tool_name: accumulated.name }, threadId })
              }
              const deltaArgs = tc.function?.arguments || ''
              accumulated.args += deltaArgs
              if (deltaArgs) send({ type: 'tool_call_delta', payload: { tool_call_id: accumulated.id, delta: deltaArgs }, threadId })
            }
          }
        }
        if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
          for (const [, accumulated] of toolCallAccumulators.entries()) {
            if (accumulated.id || accumulated.name) {
              let parsedArgs = {}
              try { parsedArgs = JSON.parse(accumulated.args) } catch {
                try { parsedArgs = JSON.parse(jsonrepair(accumulated.args)) } catch {
                  try { parsedArgs = parsePartialJson(accumulated.args) ?? {} } catch {}
                }
              }
              hasToolCallsInStep = true
              stepToolCalls.push({ id: accumulated.id, name: accumulated.name, args: parsedArgs })
              orderedBlocks.push({ type: 'tool_call', tool_call_id: accumulated.id, tool_name: accumulated.name, args: parsedArgs, status: 'pending' })
              send({ type: 'tool_call', payload: { tool_call_id: accumulated.id, tool_name: accumulated.name, args: parsedArgs }, threadId })
            }
          }
          toolCallAccumulators.clear()
        }
      }

      saveProgress(true)
      if (controller.signal.aborted) break

      if (!hasToolCallsInStep || stepToolCalls.length === 0) {
        const assistantTokens = countTokens(assistantContent, modelType)
        lifetimeTokensAdded += assistantTokens
        currentContextTokens += assistantTokens
        shouldContinue = false
        break
      }

      const assistantTokens = countTokens(assistantContent, modelType)
      const toolCallsTokens = countTokens(JSON.stringify(stepToolCalls), modelType)
      lifetimeTokensAdded += assistantTokens + toolCallsTokens
      currentContextTokens += assistantTokens + toolCallsTokens

      log.info(`[stream] Executing ${stepToolCalls.length} tools for step ${stepCount}`)
      const toolResults = await Promise.all(
        stepToolCalls.map(async (tc) => {
          const toolObj = (activeTools as any)[tc.name]
          if (!toolObj) {
            const errVal = `Tool "${tc.name}" not found.`, b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
            if (b && b.type === 'tool_call') { b.result = { success: false, error: errVal }; b.status = 'error' }
            return { tool_call_id: tc.id, tool_name: tc.name, result: { success: false, error: errVal }, isError: true }
          }
          send({ type: 'tool_result_pending', payload: { tool_call_id: tc.id }, threadId })
          try {
            const output = await toolObj.execute(tc.args, { tool_call_id: tc.id } as any)
            const b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
            const isErr = !output || output.success === false || output.type === 'error-text' || output.type === 'error-json'
            if (b && b.type === 'tool_call') { b.result = output; b.status = isErr ? 'error' : 'complete' }
            send({ type: 'tool_result', payload: { tool_call_id: tc.id, result: output }, threadId })
            if (FILE_WRITE_TOOLS.includes(tc.name)) (process as any).parentPort.postMessage({ type: 'artifacts-changed', threadId })
            return { tool_call_id: tc.id, tool_name: tc.name, result: output, isError: isErr }
          } catch (err: any) {
            log.error(`[stream] Tool execution failed: ${tc.name}:`, err)
            const b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
            if (b && b.type === 'tool_call') { b.result = { success: false, error: err.message }; b.status = 'error' }
            send({ type: 'tool_result', payload: { tool_call_id: tc.id, result: { success: false, error: err.message } }, threadId })
            return { tool_call_id: tc.id, tool_name: tc.name, result: { success: false, error: err.message }, isError: true }
          }
        })
      )

      messages.push({
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: stepToolCalls.length ? stepToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) }
        })) : undefined
      })

      let toolOutputsTokens = 0
      for (const res of toolResults) {
        let formattedOutput: string
        const outputVal = res.result
        if (outputVal && typeof outputVal === 'object' && 'type' in outputVal) {
          formattedOutput = JSON.stringify(outputVal)
        } else if (res.tool_name === 'browserScreenshot' && (outputVal as any)?.success && (outputVal as any)?.filePath) {
          try {
            const cleanPath = (outputVal as { filePath: string }).filePath.replace('file://', '')
            const base64Image = (await fs.readFile(cleanPath)).toString('base64')
            formattedOutput = JSON.stringify({ type: 'content', value: [{ type: 'image-data', data: base64Image, mediaType: 'image/png' }, { type: 'text', text: `Screenshot: ${(outputVal as any).filePath}` }] })
          } catch (err: any) { formattedOutput = `Failed to read screenshot: ${err.message}` }
        } else if (res.tool_name === 'viewFile' && (outputVal as any)?.isBinary && (outputVal as any)?.mimeType?.startsWith('image/') && (outputVal as any)?.base64Content) {
          formattedOutput = JSON.stringify({ type: 'content', value: [{ type: 'image-data', data: (outputVal as any).base64Content, mediaType: (outputVal as any).mimeType }, { type: 'text', text: `Analyzed binary image: ${(outputVal as any).absolutePath}` }] })
        } else {
          formattedOutput = typeof outputVal === 'string' ? outputVal : JSON.stringify(res.isError ? (outputVal ?? 'Error') : (outputVal ?? ''))
        }
        messages.push({ role: 'tool', tool_call_id: res.tool_call_id, content: formattedOutput })
        let outToks = 0
        if (formattedOutput.includes('image-data')) {
          try {
            const parsed = JSON.parse(formattedOutput)
            if (parsed?.type === 'content' && Array.isArray(parsed.value)) {
              for (const v of parsed.value) {
                if (v.type === 'image-data') outToks += 260
                else if (v.type === 'text' && v.text) outToks += countTokens(v.text, modelType)
              }
            } else { outToks += countTokens(formattedOutput, modelType) }
          } catch { outToks += countTokens(formattedOutput, modelType) }
        } else { outToks += countTokens(formattedOutput, modelType) }
        toolOutputsTokens += outToks
      }
      currentContextTokens += toolOutputsTokens
      if (currentContextTokens >= SUMMARISE_THRESHOLD && !threadCompactionLocks.get(threadId)) {
        threadCompactionLocks.set(threadId, true)
        try {
          log.info(`[stream] Context at ${currentContextTokens} tokens — auto-summarising`)
          const summary = await summariseContext(messages)
          if (summary) {
            await compactThreadHistory(threadId, summary)
            await updateThreadTokens(threadId, 0, lifetimeTokensAdded)
            persistedLifetimeTokens += lifetimeTokensAdded
            orderedBlocks.push({ type: 'summarize' as any, savedTokens: currentContextTokens, totalTokens: persistedLifetimeTokens } as any)
            send({ type: 'summarize', payload: { savedTokens: currentContextTokens, totalTokens: persistedLifetimeTokens }, threadId })
            lifetimeTokensAdded = 0
            messages.length = 0
            const freshHistory = await getThreadMessages(threadId)
            const { messages: reloaded } = await buildMessagesFromHistory(freshHistory, modelSupportsVision, modelSupportsNativeFiles)
            messages.push(...sanitizeMessages(reloaded))
            const newHistoryTokens = countMessagesTokens(messages, modelType)
            const newSystemInstruction = buildSystemPrompt(threadId, ctx.rootPath || '', browserInstruction, skillsSection, newHistoryTokens)
            const newFullSystemInstruction = newSystemInstruction + (systemInstructionSuffix || '')
            const newSysPromptTokens = countTokens(newFullSystemInstruction, modelType)
            const newToolSchemaTokens = activeTools ? countTokens(JSON.stringify(getOpenAiTools(activeTools)), modelType) : 0
            currentContextTokens = newHistoryTokens + newSysPromptTokens + newToolSchemaTokens
            await setThreadAccumulatedTokens(threadId, currentContextTokens)
            send({ type: 'token_update', payload: { accumulatedTokens: currentContextTokens, lifetimeTokens: persistedLifetimeTokens }, threadId })
          }
        } finally { threadCompactionLocks.delete(threadId) }
      }

      assistantContent = ''
      saveProgress(true)
    }

    if (!orderedBlocks.some(x => x.type === 'duration')) orderedBlocks.push({ type: 'duration' as any, durationSeconds: Math.round((Date.now() - startTime) / 1000) })
    send({
      type: 'finish',
      payload: {
        accumulatedTokens: currentContextTokens,
        lifetimeTokens: persistedLifetimeTokens + lifetimeTokensAdded,
        content: assistantContent,
        orderedBlocks
      },
      threadId
    })
    if (assistantContent || orderedBlocks.length > 0) { try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '', data: JSON.stringify(orderedBlocks) }) } catch (saveErr) { log.error('[stream] Final success saveMessage error:', saveErr) } }
  } catch (err: any) {
    const error = err as Error & { name?: string }
    const injectReason = controller.signal.reason as Error | undefined
    const isInject = injectReason?.message?.startsWith('__inject__:') || error?.message?.startsWith('__inject__:')
    if (isInject) {
      const injectedText = (injectReason?.message || error.message).slice('__inject__:'.length)
      log.info(`[stream] Inject received for ${threadId}: "${injectedText.slice(0, 60)}"`)
      for (const x of orderedBlocks) { if (x.type === 'tool_call' && x.status === 'pending') { x.status = 'complete'; x.result = { type: 'text', value: '[Tool execution interrupted by user injection]' } } }
      if (!orderedBlocks.some(x => x.type === 'duration')) orderedBlocks.push({ type: 'duration' as any, durationSeconds: Math.round((Date.now() - startTime) / 1000) })
      if (assistantContent || orderedBlocks.length > 0) { try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '', data: JSON.stringify(orderedBlocks) }) } catch (saveErr) { log.error('[stream] Inject save error:', saveErr) } }
      send({ type: 'inject_resume', payload: injectedText, threadId })
      send({ type: 'finish', payload: { accumulatedTokens: currentContextTokens, lifetimeTokens: persistedLifetimeTokens + lifetimeTokensAdded, content: assistantContent, orderedBlocks }, threadId })
    } else if (error.name !== 'AbortError' && error.message !== 'terminated' && !controller.signal.aborted) {
      log.error('[stream] error:', error)
      for (const x of orderedBlocks) { if (x.type === 'tool_call' && x.status === 'pending') x.status = 'error' }
      if (!orderedBlocks.some(x => x.type === 'duration')) orderedBlocks.push({ type: 'duration' as any, durationSeconds: Math.round((Date.now() - startTime) / 1000) })
      orderedBlocks.push({ type: 'error', message: error.message })
      if (assistantContent || orderedBlocks.length > 0) { try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '[Stream Error]', data: JSON.stringify(orderedBlocks) }) } catch (saveErr) { log.error('[stream] Final saveMessage error:', saveErr) } }
      send({ type: 'error', payload: error.message, threadId })
      throw err
    } else {
      // Clean abort cleanup
      for (const x of orderedBlocks) { if (x.type === 'tool_call' && x.status === 'pending') x.status = 'error' }
      if (!orderedBlocks.some(x => x.type === 'duration')) orderedBlocks.push({ type: 'duration' as any, durationSeconds: Math.round((Date.now() - startTime) / 1000) })
      if (assistantContent || orderedBlocks.length > 0) { try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '[Aborted]', data: JSON.stringify(orderedBlocks) }) } catch (saveErr) { log.error('[stream] Abort save error:', saveErr) } }
    }
  } finally {
    try { if (lifetimeTokensAdded > 0 || currentContextTokens > 0) await updateThreadTokens(threadId, currentContextTokens, lifetimeTokensAdded) } catch (err) { log.error('[stream] Final tokens save error:', err) }
    markWorkspaceIdle(threadId)
    const entry = activeAbortControllers.get(threadId)
    if (entry && entry.sessionId === streamSessionId) activeAbortControllers.delete(threadId)
    try { port.close() } catch (err) { log.debug('[stream] Final port close error:', err) }
  }
}


