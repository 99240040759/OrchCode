import crypto from 'node:crypto'
import log from 'electron-log'
import OpenAI from 'openai'
import { getAvailableModels, streamLlmResponse, getOpenAiTools } from './models'
import { getOrCreateWorkspaceContext, getWorkspaceContext, updateWorkspacePath, markWorkspaceActive, markWorkspaceIdle } from './workspace'
import { getUserSkillsPath, listInstalledSkills } from './skills'
import { createCoreTools, browserTools } from './tools'
import {
  getThreadMessages, getThread, saveMessage,
  getThreadWorkspace, setThreadWorkspace, addOpenedWorkspace,
  compactThreadHistory, updateThreadTokens
} from './db'
import { summariseContext } from './summarisation'
import { buildMemoryContext } from './memory'
import { getToolPermission, setPermission, type ApprovalResponse } from './permissions'
import { buildMessagesFromHistory, sanitizeMessages, buildAttachmentParts, StreamBlock } from './schema'
import type { ModelInfo } from './models'
import { countTokens, countMessagesTokens } from './tokenizer'
import { jsonrepair } from 'jsonrepair'
import { parse as parsePartialJson } from 'partial-json'

const activeAbortControllers = new Map<string, { controller: AbortController; sessionId: string }>()
const SUMMARISE_THRESHOLD = 180_000
const KEEP_LAST_N_MESSAGES = 20






class ReasoningStripper {
  private static TAGS = ['<think>', '<thought>', '<reasoning>', '<thinking>', '</think>', '</thought>', '</reasoning>', '</thinking>']
  private static CLOSING_TAGS = ['</think>', '</thought>', '</reasoning>', '</thinking>']
  private inBlock = false; private tagBuffer = ''
  process(delta: string): Array<{ type: 'text' | 'reasoning'; content: string }> {
    const res: Array<{ type: 'text' | 'reasoning'; content: string }> = []
    let currentType: 'text' | 'reasoning' = this.inBlock ? 'reasoning' : 'text', currentVal = ''
    const push = () => { if (currentVal) { res.push({ type: currentType, content: currentVal }); currentVal = '' } }
    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i]
      if (!this.inBlock) {
        if (ch === '<') { push(); this.tagBuffer = '<' }
        else if (this.tagBuffer) {
          this.tagBuffer += ch
          const buf = this.tagBuffer.toLowerCase()
          if (/^<\/?(think|thought|reasoning|thinking)>$/i.test(this.tagBuffer)) {
            this.inBlock = !this.tagBuffer.startsWith('</'); currentType = this.inBlock ? 'reasoning' : 'text'; this.tagBuffer = ''
          } else if (!ReasoningStripper.TAGS.some(tag => tag.startsWith(buf))) {
            if (currentType !== 'text') { push(); currentType = 'text' }
            currentVal += this.tagBuffer; this.tagBuffer = ''
          }
        } else {
          if (currentType !== 'text') { push(); currentType = 'text' }
          currentVal += ch
        }
      } else {
        
        this.tagBuffer += ch
        if (/<\/(think|thought|reasoning|thinking)>$/i.test(this.tagBuffer)) {
          
          const tagMatch = this.tagBuffer.match(/<\/(think|thought|reasoning|thinking)>$/i)!
          const beforeTag = this.tagBuffer.slice(0, this.tagBuffer.length - tagMatch[0].length)
          if (beforeTag) { if (currentType !== 'reasoning') { push(); currentType = 'reasoning' }; currentVal += beforeTag }
          push(); this.inBlock = false; currentType = 'text'; this.tagBuffer = ''
        } else if (!ReasoningStripper.CLOSING_TAGS.some(tag => tag.startsWith(this.tagBuffer.toLowerCase().slice(-Math.min(this.tagBuffer.length, tag.length))))) {
          
          if (currentType !== 'reasoning') { push(); currentType = 'reasoning' }
          currentVal += this.tagBuffer; this.tagBuffer = ''
        }
      }
    }
    if (!this.inBlock && this.tagBuffer && !this.tagBuffer.startsWith('<')) {
      if (currentType !== 'text') { push(); currentType = 'text' }
      currentVal += this.tagBuffer; this.tagBuffer = ''
    }
    push()
    for (const seg of res) { if (seg.type === 'reasoning' && seg.content.includes('</')) seg.content = seg.content.replace(/<\/?(think|thought|reasoning|thinking)>?/gi, '') }
    return res.filter(s => s.content)
  }
  flush(): { content: string; reasoning: string } {
    const content = (!this.inBlock && !this.tagBuffer.startsWith('<')) ? this.tagBuffer : ''
    this.tagBuffer = ''; this.inBlock = false
    return { content, reasoning: '' }
  }
}




const FILE_WRITE_TOOLS = ['write_to_file', 'multi_replace_file_content', 'generate_image']





async function formatToolOutputForModel(
  toolName: string, rawOutput: any, toolObj: any, multimodal: boolean
): Promise<{ text: string; imageData?: { base64: string; mimeType: string } }> {
  if (!toolObj?.toModelOutput) {
    const raw = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput ?? '')
    return { text: `[${toolName}] ${raw}` }
  }
  try {
    const modelOutput = await Promise.resolve(toolObj.toModelOutput({ output: rawOutput }))
    if (!modelOutput) return { text: `[${toolName}] (no output)` }

    if (modelOutput.type === 'image-data') {
      if (multimodal && modelOutput.data) {
        const label = modelOutput.filePath ?? rawOutput?.screenshotPath ?? rawOutput?.absolutePath ?? toolName
        return { text: `Screenshot: ${label}`, imageData: { base64: modelOutput.data, mimeType: modelOutput.mediaType || 'image/png' } }
      }
      return { text: modelOutput.filePath ? `Screenshot saved to ${modelOutput.filePath} (vision not supported)` : `Binary image result (vision not supported)` }
    }

    if (modelOutput.type === 'content' && Array.isArray(modelOutput.value)) {
      const textParts: string[] = []
      let imageData: { base64: string; mimeType: string } | undefined
      for (const part of modelOutput.value) {
        if (part.type === 'text' && part.text) textParts.push(part.text)
        else if (part.type === 'image-data' && part.data && multimodal) {
          imageData = { base64: part.data, mimeType: part.mediaType || 'image/png' }
        }
      }
      const text = textParts.join('\n')
      return { text: text || `[${toolName}] (empty output)`, imageData }
    }

    return { text: `[${toolName}] ${JSON.stringify(modelOutput)}` }
  } catch (err) {
    log.warn(`[stream] toModelOutput failed for ${toolName}:`, err)
    const raw = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput ?? '')
    return { text: `[${toolName}] ${raw}` }
  }
}






async function buildToolMessages(
  toolResults: Array<{ tool_call_id: string; tool_name: string; result: any; isError: boolean; formatted: { text: string; imageData?: { base64: string; mimeType: string } } }>,
  multimodal: boolean,
  stepCount: number
): Promise<{ toolMessages: any[]; imageUserMessages: any[]; continuationMessages: any[] }> {
  const toolMessages: any[] = []
  const stepImageParts: any[] = []
  for (const res of toolResults) {
    const statusLine = res.isError ? '❌ FAILED' : '✅ SUCCESS'
    const content = `${statusLine} — Tool: ${res.tool_name}\n${res.formatted.text || '(empty output)'}`
    toolMessages.push({ role: 'tool', tool_call_id: res.tool_call_id, name: res.tool_name, content })
    if (res.formatted.imageData && multimodal) {
      const { base64, mimeType } = res.formatted.imageData
      stepImageParts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } })
    }
  }
  const imageUserMessages: any[] = stepImageParts.length > 0
    ? [{ role: 'user', content: [{ type: 'text', text: `[browser_screenshot] Visual state of the browser after the above tool calls:` }, ...stepImageParts] }]
    : []
  const errorResults = toolResults.filter(r => r.isError)
  const successResults = toolResults.filter(r => !r.isError)
  const summaryLines: string[] = []
  if (successResults.length) summaryLines.push(`Completed: ${successResults.map(r => r.tool_name).join(', ')}`)
  if (errorResults.length) summaryLines.push(`Failed: ${errorResults.map(r => r.tool_name).join(', ')} — review error output above and correct course`)
  const continuationPrompt = [
    `[STEP ${stepCount} COMPLETE — ASSESS AND CONTINUE]`,
    summaryLines.join(' | '),
    errorResults.length > 0
      ? `One or more tools failed. Diagnose the error from the tool output above. Do NOT repeat the same call unchanged. Adjust your approach, fix the issue, and try again or choose an alternative strategy.`
      : `All tools succeeded. Review the output above. If your goal is complete, stop and summarise what was accomplished. If more steps are needed, continue with the next action immediately without asking for permission.`,
    `Think through: (1) Did I achieve what I intended with this step? (2) Does the output match expectations? (3) What is the logical next action?`,
    `Provide a single, very brief one-sentence summary of your immediate next step in your normal text response before emitting any tool calls.`
  ].filter(Boolean).join('\n')
  return { toolMessages, imageUserMessages, continuationMessages: [{ role: 'user', content: continuationPrompt }] }
}




async function setupStreamRequest(
  port: Electron.MessagePortMain,
  controller: AbortController,
  attachments: any[] | undefined,
  onInject: (text: string) => void,
  onApproval: (response: ApprovalResponse) => void
) {
  let resolveAttachments: ((bufs: Buffer[]) => void) | null = null
  const bufsPromise = attachments?.length
    ? new Promise<Buffer[]>(resolve => { resolveAttachments = resolve })
    : Promise.resolve([])

  port.on('message', e => {
    if (e.data === 'abort') {
      controller.abort()
      try { port.close() } catch {}
    } else if (e.data?.type === 'bufs') {
      resolveAttachments?.(e.data.bufs.map((b: ArrayBuffer) => Buffer.from(b)))
    } else if (e.data?.type === 'inject') {
      
      onInject(e.data.text ?? '')
    } else if (e.data?.type === 'approval_response') {
      onApproval({ approved: e.data.approved, remember: e.data.remember })
    }
  })
  port.on('close', () => controller.abort())
  port.start()

  const bufs = await bufsPromise
  if (attachments && bufs.length) {
    attachments.forEach((a, i) => { if (bufs[i]) a.base64 = bufs[i].toString('base64') })
  }
}


async function buildSkillsSection(): Promise<string> {
  const installedSkills = await listInstalledSkills()
  const skillsRootPath = getUserSkillsPath().replace(/\\/g, '/')
  if (installedSkills.length === 0) return ''
  return `
## 7. Advanced Skills (Outside Workspace)
- You have access to pre-installed capability skills located at: ${skillsRootPath}
- Available skills:
${installedSkills.map(s => `  * ${s.name}: ${s.description || 'No description'}`).join('\n')}
- **HOW TO USE:** If the user request matches any of the available skills, you MUST:
  1. Use \`list_dir\` to browse the skill folder: \`${skillsRootPath}/<skill_name>\`.
  2. Use \`view_file\` to read the \`SKILL.md\` file inside that folder.
  3. Strictly follow the instructions, design rules, templates, and execution scripts specified in the \`SKILL.md\` file.
  4. You are explicitly authorized to read/write within the skills directory to execute these workflows.
`
}

function buildBrowserInstruction(isBrowserActive: boolean, multimodal: boolean): string {
  if (!isBrowserActive) return ''
  return `
## Browser Active
You have full browser control. Available tools:
1. browser_navigate(url) — Navigate to a URL and wait for page load.
2. browser_click(selector?, x?, y?, click_type?) — Click via CSS/Playwright selector (preferred) or coordinates. click_type: 'click' | 'dblclick' | 'right-click'.
3. browser_type(selector, text) — Fill text into an input field.
4. browser_keyboard_press(key) — Press keys (e.g. "Enter", "Tab", "Control+A").
${multimodal
    ? `5. browser_screenshot() — ALWAYS screenshot after navigation/interaction to visually verify page state.
6. browser_get_page_content() — Extract URL, visible text, and compact accessibility tree.`
    : `5. browser_get_page_content() — Extract URL, visible text, and compact accessibility tree.
6. browser_screenshot() — Capture PNG screenshot (saved as file path).`
  }
**Workflow**: navigate → interact (click/type/keyboard) → screenshot or get_page_content to verify result.`
}

function buildSystemPrompt(
  threadId: string,
  rootPath: string,
  browserInstruction: string,
  skillsSection: string,
  inputTokens: number
): string {
  const tokenWarning = inputTokens > 150_000
    ? `\n\n⚠️ CONTEXT WARNING: ~${Math.round(inputTokens / 1000)}k tokens in context. Approaching 200k limit — be concise in responses.`
    : ''
  return `You are Orch Code, an advanced, highly specialized AI software engineering agent.${tokenWarning}
Active Conversation Thread ID: ${threadId}

## 1. Identity & Professional Behavior
- You are Orch Code, a world-class developer assistant designed to write clean, correct, and premium code.
- Always communicate concisely and professionally. Focus on code accuracy, design elegance, and developer productivity.
- **Immediate Action Summary:** Before emitting any tool calls, always provide a single, extremely brief one-sentence summary of your immediate next step in your normal text response so the user knows what you are doing.

## 2. Workspace & Environment Isolation
- Active Workspace Folder: ${rootPath || 'No workspace directory currently selected.'}
- Your operations are strictly bound to this workspace. Do not write or touch files outside this directory.
- Always verify your understanding of the codebase first: search using \`search_workspace\` or browse directories using \`list_dir\`.
- Always inspect the structure or contents of a target file using \`view_file\` (using start_line/end_line pagination if needed) before proposing edits.

## 3. Search, Skills & Web Search Priorities
- **Priority 1 (Local Code & Structure):** Always use \`search_workspace\` and \`list_dir\` first to locate code symbols, config files, and understand codebase layout. Local code is the ground truth.
- **Priority 2 (Specialized Skills):** Check the "Advanced Skills (Outside Workspace)" section below. If any installed skill tools or workflows exist, prioritize using them to perform specialized repository tasks.
- **Priority 3 (Web Search):** Use \`search_web\` ONLY when you need external library documentation, API specs, external dependency details, or debugging information for a general framework error that is not documented locally. Do not use web search for finding local workspace resources.

## 4. Surgical Code Editing & Formatting Constraints
- **Surgical Edits:** When modifying code, only change the absolute minimum lines required to execute the fix or feature.
- **Code Compression:** Avoid unnecessary empty lines or exploded whitespace. Collapse control flows, brackets, and simple blocks where syntactically clean.
- **No Refactoring Unchanged Code:** Do not clean up, reformat, or alter surrounding lines of code that are unrelated to the task. Keep changes highly localized.
- **AST Matching Resilience:** \`multi_replace_file_content\` utilizes Abstract Syntax Tree (AST) matching where possible. For best results, make sure your target blocks are unique and contain sufficient context.

## 5. Structured Planning & User Approval
- **When to Plan:** If the request involves major architectural changes, multiple files, complex logic, or significant ambiguity, you MUST write an implementation plan at \`artifacts/implementation_plan.md\` first and wait for the user's approval.
- **When NOT to Plan:** For simple one-off tasks (small fixes, additions of single functions, formatting adjustments, small scripts), proceed to direct execution immediately without blocking.
- **Artifacts Directory:** Write all planning artifacts (including \`implementation_plan.md\`, \`task.md\`, and \`walkthrough.md\`) to the sandboxed directory \`artifacts/\` (e.g. \`artifacts/implementation_plan.md\`, \`artifacts/task.md\`, \`artifacts/walkthrough.md\`). Do NOT write them to the user's workspace root directory.

## 6. Tool Utilization Protocols
- **File System Tools:** Use only the native APIs (\`view_file\`, \`write_to_file\`, \`multi_replace_file_content\`, \`list_dir\`, \`search_workspace\`) for all file actions.
- **Shell Commands:** Do NOT run shell utilities (\`grep\`, \`find\`, \`sed\`, \`awk\`, \`cat\`, \`echo\`) inside \`run_command\` to read, write, or search files. \`run_command\` is strictly reserved for:
  - Running compilation or build commands (e.g. \`npm run build\`).
  - Running tests or lint suites (e.g. \`npm run test\`, \`jest\`).
  - Package installations (e.g. \`npm install\`).
  - Checking formatting or running code formatters.

${browserInstruction}
${skillsSection}`
}


async function runCompaction(
  messages: any[],
  threadId: string,
  modelType: string | undefined,
  send: (msg: Record<string, unknown>) => void
): Promise<{ compacted: boolean; newMessages: any[]; savedTokens: number }> {
  try {
    log.info(`[stream] Context at ${countMessagesTokens(messages, modelType)} tokens — compacting`)
    const summary = await summariseContext(messages)
    if (!summary) {
      log.warn('[stream] Summarisation returned null — skipping compaction')
      return { compacted: false, newMessages: messages, savedTokens: 0 }
    }
    const savedTokens = countMessagesTokens(messages, modelType)
    
    const keepFrom = Math.max(0, messages.length - KEEP_LAST_N_MESSAGES)
    const recentMessages = messages.slice(keepFrom)
    const summarySystemMsg = {
      role: 'system',
      content: `[CONTEXT COMPACTED]\nPrior conversation summarised to preserve context window. Summary:\n\n${summary}`
    }
    const newMessages = [summarySystemMsg, ...recentMessages]
    
    await compactThreadHistory(threadId, summary, KEEP_LAST_N_MESSAGES)
    send({ type: 'summarize', payload: { savedTokens, totalTokens: countMessagesTokens(newMessages, modelType) }, threadId })
    return { compacted: true, newMessages, savedTokens }
  } catch (err) {
    log.error('[stream] Compaction error:', err)
    return { compacted: false, newMessages: messages, savedTokens: 0 }
  }
}
function getPrimitiveType(type: any): string | null {
  if (!type) return null
  const name = type._def?.typeName
  if (name === 'ZodBoolean') return 'boolean'
  if (name === 'ZodNumber') return 'number'
  if (type._def?.innerType) return getPrimitiveType(type._def.innerType)
  if (type._def?.schema) return getPrimitiveType(type._def.schema)
  return null
}
function coerceArgs(args: any, schema: any): any {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !schema?.shape) return args
  const coerced = { ...args }
  for (const k of Object.keys(schema.shape)) {
    const v = coerced[k]
    if (v === undefined) continue
    const exp = getPrimitiveType(schema.shape[k])
    if (exp === 'boolean') {
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase()
        if (s === 'true' || s === '1') coerced[k] = true
        else if (s === 'false' || s === '0') coerced[k] = false
      } else if (typeof v === 'number') coerced[k] = v !== 0
    } else if (exp === 'number' && typeof v === 'string') {
      const n = Number(v.trim())
      if (!isNaN(n)) coerced[k] = n
    }
  }
  return coerced
}
export async function handleAgentStreamRequest(
  port: Electron.MessagePortMain,
  threadId: string,
  modelType: string | undefined,
  attachments: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64?: string }> | undefined,
  promptText: string | undefined,
  isBrowserActive: boolean | undefined,
  startTimeParam?: number,
  userMsgIdParam?: string,
  assistantMsgIdParam?: string
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

  
  let pendingInject: string | null = null
  const onInject = (text: string) => { pendingInject = text; log.info(`[stream] Inject queued for ${threadId}: "${text.slice(0, 60)}"`) }
  let pendingApprovalResolve: ((res: ApprovalResponse) => void) | null = null
  const onApproval = (response: ApprovalResponse) => {
    if (pendingApprovalResolve) { pendingApprovalResolve(response); pendingApprovalResolve = null }
  }

  try {
    await setupStreamRequest(port, controller, attachments, onInject, onApproval)
  } catch (err) {
    log.error(`[stream] Setup failed for ${threadId}:`, err)
    markWorkspaceIdle(threadId)
    const entry = activeAbortControllers.get(threadId)
    if (entry?.sessionId === streamSessionId) activeAbortControllers.delete(threadId)
    try { port.close() } catch {}
    throw err
  }

  const assistantMsgId = assistantMsgIdParam || crypto.randomUUID()
  let assistantContent = ''
  const orderedBlocks: StreamBlock[] = []
  let lifetimeTokensAdded = 0
  let currentContextTokens = 0
  let prevContextTokens = 0    
  let prevStepInputTokens = 0  
  let totalInputAdded = 0      
  let totalOutputAdded = 0     

  
  let lastSaveMs = 0
  let saveInFlight = false
  let saveQueued = false
  const saveProgress = (force = false) => {
    const now = Date.now()
    if (!force && now - lastSaveMs < 800) return
    if (saveInFlight) { if (force) saveQueued = true; return }
    if (!assistantContent && orderedBlocks.length === 0) return
    saveInFlight = true
    const doSave = () => {
      saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent, data: JSON.stringify(orderedBlocks) })
        .then(() => { lastSaveMs = Date.now() })
        .catch(err => log.error('[stream] Progressive save failed:', err))
        .finally(() => {
          saveInFlight = false
          if (saveQueued) { saveQueued = false; doSave() }
        })
    }
    if (force) doSave(); else setImmediate(doSave)
  }

  try {
    const history = await getThreadMessages(threadId)
    const threadData = await getThread(threadId)
    currentContextTokens = threadData?.accumulatedTokens ?? 0

    
    const userMsgId = userMsgIdParam || crypto.randomUUID()
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
    const wsPath = await getThreadWorkspace(threadId)
    if (wsPath) await updateWorkspacePath(threadId, wsPath)

    
    const models = await getAvailableModels()
    const availableList = Object.values(models)
    if (!availableList.length) throw new Error('No models configured.')
    const rawModel: ModelInfo | undefined = modelType
      ? (models[modelType] || availableList.find(m => m.id === modelType))
      : availableList[0]
    if (!rawModel) throw new Error(`Requested model "${modelType}" is not available.`)

    const multimodal = !!rawModel.multimodal

    
    const { messages: historyMessages, systemInstructionSuffix } = await buildMessagesFromHistory(history, multimodal)
    let messages: any[] = sanitizeMessages(historyMessages)
    
    messages.push({
      role: 'user',
      content: attachments?.length
        ? await buildAttachmentParts(text, attachments as any, multimodal)
        : text
    })

    
    const browserInstruction = buildBrowserInstruction(!!isBrowserActive, multimodal)
    const skillsSection = await buildSkillsSection()
    const memorySection = await buildMemoryContext(ctx.rootPath)
    const coreTools = createCoreTools(threadId, multimodal)
    const activeTools: Record<string, any> = {
      ...coreTools,
      ...(isBrowserActive ? browserTools(threadId, multimodal) : {})
    }

    
    let shouldContinue = true
    let stepCount = 0

    while (shouldContinue) {
      if (controller.signal.aborted) break
      stepCount++
      log.info(`[stream] Step ${stepCount} — thread ${threadId}`)

      
      const inputTokens = countMessagesTokens(messages, modelType)
      const threshold = rawModel.contextWindow ? Math.floor(rawModel.contextWindow * 0.8) : SUMMARISE_THRESHOLD
      if (inputTokens >= threshold) {
        const { compacted, newMessages } = await runCompaction(messages, threadId, modelType, send)
        if (compacted) {
          messages = newMessages
          
          saveProgress(true)
        }
      }

      
      if (pendingInject !== null) {
        const injText = pendingInject
        pendingInject = null
        messages.push({ role: 'user', content: injText })
        
        const injMsgId = crypto.randomUUID()
        await saveMessage(threadId, { id: injMsgId, role: 'user', content: injText })
        send({ type: 'inject_queued', payload: injText, threadId })
        log.info(`[stream] Inject consumed and saved for thread ${threadId}`)
      }
      const stepInputTokens = countMessagesTokens(messages, modelType)
      const systemInstruction = buildSystemPrompt(threadId, ctx.rootPath || '', browserInstruction, skillsSection, stepInputTokens) + memorySection + (systemInstructionSuffix || '')
      const sysTokens = countTokens(systemInstruction, modelType)
      const toolSchemaTokens = countTokens(JSON.stringify(getOpenAiTools(activeTools)), modelType)
      prevContextTokens = currentContextTokens
      currentContextTokens = stepInputTokens + sysTokens + toolSchemaTokens
      
      send({ type: 'token_update', payload: { accumulatedTokens: currentContextTokens, lifetimeTokens: (threadData?.lifetimeTokens ?? 0) + lifetimeTokensAdded }, threadId })

      
      const chunkStream = await streamLlmResponse(rawModel.id, messages, systemInstruction, activeTools, controller.signal, prevStepInputTokens)

      
      
      const stripper = new ReasoningStripper()
      let hasToolCalls = false
      const stepToolCalls: Array<{ id: string; name: string; args: Record<string, unknown>; extra_content?: any }> = []
      const toolCallAccumulators = new Map<number, { id: string; name: string; args: string; sentStart?: boolean; extra_content?: any }>()
      let stepAssistantContent = '', stepReasoningContent = ''

      let stepActualInput = 0, stepActualOutput = 0, hasActualUsage = false
      for await (const chunk of chunkStream) {
        if (controller.signal.aborted) break
        
        if ((chunk as any).usage) {
          const u = (chunk as any).usage
          stepActualInput = (u.prompt_tokens ?? 0) as number
          stepActualOutput = (u.completion_tokens ?? 0) as number
          if (stepActualInput > 0 || stepActualOutput > 0) hasActualUsage = true
        }
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta

        if (delta?.content) {
          stepAssistantContent += delta.content
          assistantContent += delta.content
          const segments = stripper.process(delta.content)
          for (const seg of segments) {
            if (seg.type === 'text') {
              const last = orderedBlocks[orderedBlocks.length - 1]
              if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: seg.content })
              else (last as any).content += seg.content
              send({ type: 'text_delta', payload: seg.content, threadId })
            } else if (seg.type === 'reasoning') {
              const last = orderedBlocks[orderedBlocks.length - 1]
              if (!last || last.type !== 'reasoning') orderedBlocks.push({ type: 'reasoning', content: seg.content })
              else (last as any).content += seg.content
            }
          }
          if (segments.length > 0) void saveProgress(false)
        }
        const rDelta = (delta as any)?.reasoning_content || (delta as any)?.reasoning
        if (rDelta) {
          stepReasoningContent += rDelta
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (!last || last.type !== 'reasoning') orderedBlocks.push({ type: 'reasoning', content: rDelta })
          else (last as any).content += rDelta
          void saveProgress(false)
        }

        if (delta?.tool_calls) {
          for (let i = 0; i < delta.tool_calls.length; i++) {
            const tc = delta.tool_calls[i]
            const idx = tc.index !== undefined ? tc.index : i
            let acc = toolCallAccumulators.get(idx)
            if (!acc) {
              const tcId = tc.id || `call_${crypto.randomUUID().slice(0, 8)}`
              acc = { id: tcId, name: tc.function?.name || '', args: '' }
              toolCallAccumulators.set(idx, acc)
            }
            if (tc.id && !acc.id) acc.id = tc.id
            if (tc.function?.name && !acc.name) acc.name = tc.function.name
            if ((tc as any).extra_content) acc.extra_content = (tc as any).extra_content
            if (acc.id && acc.name && !acc.sentStart) {
              acc.sentStart = true
              send({ type: 'tool_call_start', payload: { tool_call_id: acc.id, tool_name: acc.name }, threadId })
            }
            const argsDelta = tc.function?.arguments || ''
            acc.args += argsDelta
            if (argsDelta) send({ type: 'tool_call_delta', payload: { tool_call_id: acc.id, delta: argsDelta }, threadId })
          }
        }
      }
      if (!controller.signal.aborted && toolCallAccumulators.size > 0) {
        for (const [, acc] of toolCallAccumulators) {
          if (!acc.id && !acc.name) continue
          let parsedArgs: Record<string, unknown> = {}
          try { parsedArgs = JSON.parse(acc.args) } catch {
            try { parsedArgs = JSON.parse(jsonrepair(acc.args)) } catch {
              try { parsedArgs = parsePartialJson(acc.args) ?? {} } catch {}
            }
          }
          hasToolCalls = true
          stepToolCalls.push({ id: acc.id, name: acc.name, args: parsedArgs, extra_content: acc.extra_content })
          orderedBlocks.push({ type: 'tool_call', tool_call_id: acc.id, tool_name: acc.name, args: parsedArgs, status: 'pending' })
          send({ type: 'tool_call', payload: { tool_call_id: acc.id, tool_name: acc.name, args: parsedArgs }, threadId })
        }
        toolCallAccumulators.clear()
      }

      
      const trailing = stripper.flush()
      if (trailing.content) {
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: trailing.content })
        else (last as any).content += trailing.content
        send({ type: 'text_delta', payload: trailing.content, threadId })
      }

      saveProgress(true)
      if (controller.signal.aborted) break
      
      if (hasActualUsage) {
        
        
        
        
        const newInputThisStep = Math.max(0, stepActualInput - prevStepInputTokens)
        currentContextTokens = stepActualInput
        lifetimeTokensAdded += newInputThisStep + stepActualOutput
        totalInputAdded += newInputThisStep
        totalOutputAdded += stepActualOutput
        prevStepInputTokens = stepActualInput
      } else {
        
        const stepOutputEst = countTokens(stepAssistantContent, modelType) + countTokens(stepReasoningContent, modelType)
        const newInputEst = Math.max(0, currentContextTokens - prevContextTokens)
        lifetimeTokensAdded += newInputEst + stepOutputEst
        totalInputAdded += newInputEst
        totalOutputAdded += stepOutputEst
      }
      send({ type: 'token_update', payload: { accumulatedTokens: currentContextTokens, lifetimeTokens: (threadData?.lifetimeTokens ?? 0) + lifetimeTokensAdded }, threadId })

      
      if (!hasToolCalls || stepToolCalls.length === 0) {
        if (pendingInject !== null) {
          
          const injText = pendingInject; pendingInject = null
          messages.push({ role: 'assistant', content: stepAssistantContent || ' ' })
          messages.push({ role: 'user', content: injText })
          const injMsgId = crypto.randomUUID()
          await saveMessage(threadId, { id: injMsgId, role: 'user', content: injText })
          send({ type: 'inject_queued', payload: injText, threadId })
          log.info(`[stream] Inject consumed at turn boundary for thread ${threadId}`)
          
          continue
        }
        shouldContinue = false
        break
      }

      
      messages.push({
        role: 'assistant',
        content: stepAssistantContent || null,
        tool_calls: stepToolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {})
        })),
        ...(stepReasoningContent ? { reasoning_content: stepReasoningContent } : {})
      } as any)

      
      log.info(`[stream] Executing ${stepToolCalls.length} tools in step ${stepCount}`)

      
      const deniedCommandIds = new Set<string>()
      for (const tc of stepToolCalls) {
        if (tc.name !== 'run_command' || !activeTools[tc.name]) continue
        const perm = await getToolPermission(tc.name)
        if (perm === 'always_deny') { deniedCommandIds.add(tc.id); continue }
        if (perm === 'always_ask') {
          send({ type: 'approval_request', payload: { toolCallId: tc.id, toolName: tc.name, args: tc.args }, threadId })
          const response = await new Promise<ApprovalResponse>(resolve => { pendingApprovalResolve = resolve })
          if (response.remember) await setPermission(tc.name, response.approved ? 'always_allow' : 'always_deny')
          if (!response.approved) deniedCommandIds.add(tc.id)
        }
      }

      const toolResults = await Promise.all(
        stepToolCalls.map(async tc => {
          const toolObj = activeTools[tc.name]
          if (!toolObj) {
            const errVal = `Tool "${tc.name}" not found.`
            const b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
            if (b && b.type === 'tool_call') { b.result = { success: false, error: errVal }; b.status = 'error' }
            send({ type: 'tool_result', payload: { tool_call_id: tc.id, result: { success: false, error: errVal } }, threadId })
            return { tool_call_id: tc.id, tool_name: tc.name, result: { success: false, error: errVal }, isError: true, formatted: { text: `Error: ${errVal}` } }
          }
          if (deniedCommandIds.has(tc.id)) {
            const denyMsg = `Command was not approved.`
            const b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
            if (b && b.type === 'tool_call') { b.result = { success: false, error: denyMsg }; b.status = 'error' }
            send({ type: 'tool_result', payload: { tool_call_id: tc.id, result: { success: false, error: denyMsg } }, threadId })
            return { tool_call_id: tc.id, tool_name: tc.name, result: { success: false, error: denyMsg }, isError: true, formatted: { text: denyMsg } }
          }
          send({ type: 'tool_result_pending', payload: { tool_call_id: tc.id }, threadId })
          try {
            const parsed = toolObj.inputSchema.safeParse(coerceArgs(tc.args, toolObj.inputSchema))
            if (!parsed.success) {
              const errVal = `Schema validation failed: ${parsed.error.message}`
              const b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
              if (b && b.type === 'tool_call') { b.result = { success: false, error: errVal }; b.status = 'error' }
              send({ type: 'tool_result', payload: { tool_call_id: tc.id, result: { success: false, error: errVal } }, threadId })
              return { tool_call_id: tc.id, tool_name: tc.name, result: { success: false, error: errVal }, isError: true, formatted: { text: `Error: ${errVal}` } }
            }
            const rawOutput = await toolObj.execute(parsed.data, { tool_call_id: tc.id, signal: controller.signal })
            const isErr = !rawOutput || rawOutput.success === false || rawOutput.type === 'error-text' || rawOutput.type === 'error-json'
            const b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
            if (b && b.type === 'tool_call') { b.result = rawOutput; b.status = isErr ? 'error' : 'complete' }
            send({ type: 'tool_result', payload: { tool_call_id: tc.id, result: rawOutput }, threadId })
            if (FILE_WRITE_TOOLS.includes(tc.name)) {
              const pp = (process as any).parentPort
              if (pp) pp.postMessage({ type: 'artifacts-changed', threadId })
            }
            const formatted = await formatToolOutputForModel(tc.name, rawOutput, toolObj, multimodal)
            return { tool_call_id: tc.id, tool_name: tc.name, result: rawOutput, isError: isErr, formatted }
          } catch (err: any) {
            log.error(`[stream] Tool execution error: ${tc.name}:`, err)
            const b = orderedBlocks.find(x => x.type === 'tool_call' && x.tool_call_id === tc.id)
            if (b && b.type === 'tool_call') { b.result = { success: false, error: err.message }; b.status = 'error' }
            send({ type: 'tool_result', payload: { tool_call_id: tc.id, result: { success: false, error: err.message } }, threadId })
            return { tool_call_id: tc.id, tool_name: tc.name, result: { success: false, error: err.message }, isError: true, formatted: { text: `Error: ${err.message}` } }
          }
        })
      )

      

      const { toolMessages, imageUserMessages, continuationMessages } = await buildToolMessages(toolResults, multimodal, stepCount)
      for (const tm of toolMessages) messages.push(tm)
      for (const im of imageUserMessages) messages.push(im)
      for (const cm of continuationMessages) messages.push(cm)

      
      stepAssistantContent = ''
      saveProgress(true)
    }
    

    
    if (!orderedBlocks.some(x => x.type === 'duration')) {
      orderedBlocks.push({ type: 'duration', durationSeconds: Math.round((Date.now() - startTime) / 1000) })
    }
    
    if (assistantContent || orderedBlocks.length > 0) {
      try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent, data: JSON.stringify(orderedBlocks) }) }
      catch (saveErr) { log.error('[stream] Final save error:', saveErr) }
    }

    send({
      type: 'finish',
      payload: {
        accumulatedTokens: currentContextTokens,
        lifetimeTokens: (threadData?.lifetimeTokens ?? 0) + lifetimeTokensAdded,
        content: assistantContent,
        orderedBlocks
      },
      threadId
    })

  } catch (err: any) {
    
    const isAbort = controller.signal.aborted ||
      err?.name === 'AbortError' || err?.message === 'terminated'

    let userMessage: string
    if (err instanceof OpenAI.APIConnectionError || err instanceof OpenAI.APIConnectionTimeoutError) {
      userMessage = "You're offline or the server can't be reached. Check your connection and try again."
    } else if (err instanceof OpenAI.AuthenticationError) {
      userMessage = "Your session has expired. Sign out and sign back in to continue."
    } else if (err instanceof OpenAI.PermissionDeniedError) {
      userMessage = "You don't have access to this model. Try selecting a different one."
    } else if (err instanceof OpenAI.NotFoundError) {
      userMessage = "This model isn't available right now. Try selecting a different one."
    } else if (err instanceof OpenAI.RateLimitError) {
      userMessage = "You've hit a usage limit. Wait a moment and try again, or switch to another model."
    } else if (err instanceof OpenAI.BadRequestError) {
      userMessage = "Something went wrong with that request. Try rephrasing or starting a new conversation."
    } else if (err instanceof OpenAI.UnprocessableEntityError) {
      userMessage = "We couldn't process that request. Try again or start a new conversation."
    } else if (err instanceof OpenAI.InternalServerError) {
      userMessage = "The AI service is having a moment. Please try again shortly."
    } else if (err instanceof OpenAI.APIError) {
      userMessage = "Something went wrong. Please try again."
    } else if (err?.message?.includes('both be empty') || err?.message?.includes('model output must contain') || err?.message?.includes('output text or tool calls')) {
      userMessage = "The model didn't produce a response. Please try again."
    } else {
      userMessage = err?.message ?? "Something went wrong. Please try again."
    }

    if (!isAbort) {
      log.error('[stream] error:', err)
      for (const x of orderedBlocks) { if (x.type === 'tool_call' && x.status === 'pending') x.status = 'error' }
      if (!orderedBlocks.some(x => x.type === 'duration')) {
        orderedBlocks.push({ type: 'duration', durationSeconds: Math.round((Date.now() - startTime) / 1000) })
      }
      orderedBlocks.push({ type: 'error', message: userMessage })
      try {
        await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '[Stream Error]', data: JSON.stringify(orderedBlocks) })
      } catch (saveErr) { log.error('[stream] Error save failed:', saveErr) }
      send({ type: 'error', payload: userMessage, threadId })
      throw err
    } else {
      
      for (const x of orderedBlocks) { if (x.type === 'tool_call' && x.status === 'pending') x.status = 'error' }
      if (!orderedBlocks.some(x => x.type === 'duration')) {
        orderedBlocks.push({ type: 'duration', durationSeconds: Math.round((Date.now() - startTime) / 1000) })
      }
      if (assistantContent || orderedBlocks.length > 0) {
        try { await saveMessage(threadId, { id: assistantMsgId, role: 'assistant', content: assistantContent || '[Aborted]', data: JSON.stringify(orderedBlocks) }) }
        catch (saveErr) { log.error('[stream] Abort save error:', saveErr) }
      }
    }
  } finally {
    try {
      if (lifetimeTokensAdded > 0 || currentContextTokens > 0) {
        await updateThreadTokens(threadId, currentContextTokens, lifetimeTokensAdded, totalInputAdded, totalOutputAdded)
      }
    } catch (err) { log.error('[stream] Final tokens save error:', err) }
    markWorkspaceIdle(threadId)
    const entry = activeAbortControllers.get(threadId)
    if (entry?.sessionId === streamSessionId) activeAbortControllers.delete(threadId)
    try { port.close() } catch {}
  }
}
