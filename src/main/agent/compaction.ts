import { generateText } from 'ai'
import { google, getAvailableModels } from '../index'
import {
  getThreadMessages,
  getLastCompactedMessageId,
  getThreadCompactionSummary,
  updateThreadCompactionSummary,
  saveMessage
} from '../db'
import log from 'electron-log'

export async function triggerSemanticCompaction(threadId: string, assistantMsgId: string): Promise<void> {
  log.info(`[compaction] Starting semantic summary for thread: ${threadId}`)
  try {
    const fullHistory = getThreadMessages(threadId)
    if (fullHistory.length === 0) return

    const lastCompactedId = getLastCompactedMessageId(threadId)
    let lastCompactionIndex = -1
    if (lastCompactedId) {
      lastCompactionIndex = fullHistory.findIndex((m) => m.id === lastCompactedId)
    }

    const newTurns = lastCompactionIndex !== -1 ? fullHistory.slice(lastCompactionIndex + 1) : fullHistory

    const formattedHistory = newTurns.map((m) => {
      let text = `[${m.role.toUpperCase()}] ${m.content}`
      if (m.data) {
        try {
          const blocks = JSON.parse(m.data)
          if (Array.isArray(blocks)) {
            const toolBlocks = blocks.filter((b: any) => b.type === 'tool')
            if (toolBlocks.length > 0) {
              const toolSummaries = toolBlocks.map((t: any) => {
                let summary = `${t.toolName} → ${t.status}`
                if (t.result && t.status === 'complete') {
                  if (t.toolName === 'writeToFile' && t.result.absolutePath) {
                    summary += ` (created: ${t.result.absolutePath})`
                  } else if ((t.toolName === 'replaceFileContent' || t.toolName === 'multiReplaceFileContent') && t.result.absolutePath) {
                    summary += ` (edited: ${t.result.absolutePath})`
                  } else if (t.toolName === 'runCommand' && t.result.stdout) {
                    summary += ` (output: ${String(t.result.stdout).slice(0, 200)})`
                  } else if (t.toolName === 'viewFile' && t.result.absolutePath) {
                    summary += ` (read: ${t.result.absolutePath})`
                  }
                } else if (t.status === 'error' && t.result) {
                  const errStr = typeof t.result === 'string' ? t.result : (t.result.error || JSON.stringify(t.result)).slice(0, 200)
                  summary += ` (error: ${errStr})`
                }
                return summary
              }).join(', ')
              text += `\n(Tools: ${toolSummaries})`
            }
          }
        } catch {}
      }
      return text
    }).join('\n\n')

    const oldSummary = lastCompactionIndex !== -1 ? getThreadCompactionSummary(threadId) : null
    const models = await getAvailableModels()
    if (!models.gemini) throw new Error('Gemini model not configured.')
    const compactionModel = models.gemini.id

    log.info(`[compaction] Generating summary using ${compactionModel}...`)

    let prompt = ''
    if (oldSummary) {
      prompt = `Here is a high-density summary of all accomplishments prior to this segment:\n${oldSummary}\n\nNew conversation turns since that summary:\n${formattedHistory}\n\nMerge the previous summary and new turns into a single unified, high-density state summary. Keep all completed task logs, modified file paths, and technical decisions intact while compressing the context size.`
    } else {
      prompt = `Conversation turns to summarize:\n${formattedHistory}\n\nCompile a high-density state summary. Highlight goals, technical decisions, completed files with their paths, and immediate next steps.`
    }

    const result = await generateText({
      model: google(compactionModel),
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

      const compactionMsg = fullHistory.find((m) => m.id === assistantMsgId)
      if (compactionMsg) {
        saveMessage(threadId, {
          id: compactionMsg.id,
          role: compactionMsg.role,
          content: compactionMsg.content,
          data: compactionMsg.data,
          createdAt: compactionMsg.createdAt,
          isCompactionAnchor: true
        })
        log.info(`[compaction] Marked message ${assistantMsgId} as compaction anchor`)
      }
    }
  } catch (err) {
    log.error('[compaction] Failed to generate semantic summary:', err)
  }
}
