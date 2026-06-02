import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { geminiLimiter } from '../limiters'
import {
  getThreadMessages,
  getLastCompactedMessageId,
  getThreadCompactionSummary,
  updateThreadCompactionSummary,
  saveMessage
} from '../db'
import log from 'electron-log'

// CRIT-5: Compaction uses its own google provider instance sourced directly from env,
// breaking the circular dependency on index.ts. This provider is still rate-limited
// via geminiLimiter so compaction doesn't burst through the queue.
//
// Compaction always uses a fixed model (gemma via gemini endpoint) regardless of the
// user's selected model \u2014 intentional design: light-weight summarisation only.
function makeCompactionProvider() {
  return createGoogleGenerativeAI({
    baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
    apiKey: 'placeholder',
    fetch: (url, options) => {
      return geminiLimiter.schedule(() => {
        const headers = new Headers(options?.headers || {})
        headers.set('Authorization', `Bearer ${process.env.SUPABASE_ANON_KEY}`)
        headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
        return fetch(url, { ...options, headers })
      })
    }
  })
}

// Fixed compaction model ID — intentionally gemma-4-31b-it (user requirement)
const COMPACTION_MODEL_ID = 'gemma-4-31b-it'

export async function triggerSemanticCompaction(threadId: string, _assistantMsgId: string): Promise<void> {
  log.info(`[compaction] Starting semantic summary for thread: ${threadId}`)
  try {
    const fullHistory = getThreadMessages(threadId)
    if (fullHistory.length === 0) return

    const lastCompactedId = getLastCompactedMessageId(threadId)
    let lastCompactionIndex = -1
    if (lastCompactedId) {
      lastCompactionIndex = fullHistory.findIndex((m) => m.id === lastCompactedId)
    }

    // SLIDING WINDOW: We leave the last 15 messages completely uncompacted.
    // We only summarize from the last compacted message up to (length - 15).
    const WINDOW_SIZE = 15
    const targetAnchorIndex = Math.max(0, fullHistory.length - WINDOW_SIZE)

    // If there's nothing new to compact outside the window, skip it.
    if (targetAnchorIndex <= lastCompactionIndex) {
      return
    }

    const newTurnsToCompact = fullHistory.slice(lastCompactionIndex + 1, targetAnchorIndex + 1)

    const formattedHistory = newTurnsToCompact.map((m) => {
      let text = `[${m.role.toUpperCase()}] ${m.content}`
      if (m.data) {
        try {
          const blocks = JSON.parse(m.data)
          if (Array.isArray(blocks)) {
            const toolBlocks = blocks.filter((b: any) => b.type === 'tool')
            if (toolBlocks.length > 0) {
              const toolSummaries = toolBlocks.map((t: any) => {
                let summary = `${t.toolName} \u2192 ${t.status}`
                if (t.result && t.status === 'complete') {
                  if (t.toolName === 'writeToFile' && t.result.absolutePath) {
                    summary += ` (created: ${t.result.absolutePath})`
                  } else if ((t.toolName === 'replaceFileContent' || t.toolName === 'multiReplaceFileContent') && t.result.absolutePath) {
                    summary += ` (edited: ${t.result.absolutePath})`
                  } else if (t.toolName === 'runCommand' && t.result.stdout) {
                    summary += ` (output: ${String(t.result.stdout).slice(0, 1000)})`
                  } else if (t.toolName === 'viewFile' && t.result.absolutePath) {
                    summary += ` (read: ${t.result.absolutePath})`
                  }
                } else if (t.status === 'error' && t.result) {
                  const errStr = typeof t.result === 'string' ? t.result : (t.result.error || JSON.stringify(t.result))
                  summary += ` (error: ${errStr.slice(0, 4000)})`
                }
                return summary
              // MINOR-3: Fixed \u2014 was join('\\n') which produced literal backslash-n, not newlines
              }).join('\n')
              text += `\n(Tools:\n${toolSummaries})`
            }
          }
        } catch {}
      }
      return text
    }).join('\n\n')

    const oldSummary = lastCompactionIndex !== -1 ? getThreadCompactionSummary(threadId) : null

    log.info(`[compaction] Generating summary using fixed model ${COMPACTION_MODEL_ID}...`)

    const compactionGoogle = makeCompactionProvider()

    let prompt = ''
    if (oldSummary) {
      prompt = `Here is a high-density summary of all accomplishments prior to this segment:\n${oldSummary}\n\nNew conversation turns since that summary:\n${formattedHistory}\n\nMerge the previous summary and new turns into a single unified, high-density state summary. Keep all completed task logs, modified file paths, and technical decisions intact while compressing the context size.`
    } else {
      prompt = `Conversation turns to summarize:\n${formattedHistory}\n\nCompile a high-density state summary. Highlight goals, technical decisions, completed files with their paths, and immediate next steps.`
    }

    const result = await generateText({
      model: compactionGoogle(COMPACTION_MODEL_ID),
      system: `You are an expert compiler of software agent states.
Analyze the provided conversation history and compile a high-density, structured semantic summary.

Extract:
1. PRIMARY GOAL: What core problem or features did the user request?
2. ARCHITECTURAL DECISIONS: What specific files, schemas, or styles were designed or modified?
3. SUCCESSFUL MUTATIONS: What files were created or edited? List exact paths.
4. ERROR HISTORY: What failed and why?
5. REMAINING TASK STATE: Exact technical state and immediate next step.

Format as highly compressed, bulleted Markdown. No intro, no pleasantries.`,
      prompt
    })

    const summaryText = result.text?.trim() ?? null
    if (summaryText) {
      updateThreadCompactionSummary(threadId, summaryText)
      log.info(`[compaction] Summary compiled for thread: ${threadId} (${summaryText.length} chars)`)

      const anchorMsg = fullHistory[targetAnchorIndex]
      if (anchorMsg) {
        saveMessage(threadId, {
          id: anchorMsg.id,
          role: anchorMsg.role,
          content: anchorMsg.content,
          data: anchorMsg.data,
          createdAt: anchorMsg.createdAt,
          isCompactionAnchor: true
        })
        log.info(`[compaction] Marked message ${anchorMsg.id} as compaction anchor`)
      }
    }
  } catch (err) {
    log.error('[compaction] Failed to generate semantic summary:', err)
    throw err // re-throw so caller (.catch) receives it for token-reset logic
  }
}
