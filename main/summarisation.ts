import { generateText, type ModelMessage } from 'ai'
import log from 'electron-log'
import { googleBypass } from './models'

const SUMMARISE_MODEL = 'gemini-3.1-flash-lite'
export async function summariseContext(messages: ModelMessage[]): Promise<string | null> {
  try {
    const transcript = messages
      .map((m) => {
        const role = m.role === 'tool' ? 'TOOL_RESULT' : m.role.toUpperCase()
        let content = ''
        if (typeof m.content === 'string') {
          content = m.content.slice(0, 20000)
        } else if (Array.isArray(m.content)) {
          content = (m.content as Array<{ type?: string; text?: string; toolName?: string; input?: unknown; args?: unknown; output?: unknown; result?: unknown }>)
            .map((p) => {
              if (p.type === 'text') return p.text?.slice(0, 10000) ?? ''
              if (p.type === 'tool-call') {
                const name = p.toolName || (p as any).name || 'unknown'
                const args = p.args || p.input || {}
                return `[Tool Call: ${name}, Args: ${JSON.stringify(args).slice(0, 2000)}]`
              }
              if (p.type === 'tool-result') {
                const name = p.toolName || (p as any).name || 'unknown'
                const result = p.result || p.output || {}
                return `[Tool Result for ${name}: ${JSON.stringify(result).slice(0, 2000)}]`
              }
              return JSON.stringify(p).slice(0, 2000)
            })
            .filter(Boolean)
            .join('\n')
        }
        return `[${role}] ${content}`
      })
      .join('\n\n')
    const result = await generateText({
      model: googleBypass(SUMMARISE_MODEL),
      prompt: `Summarise this conversation history. Your summary must be EXTREMELY LONG and HIGHLY DETAILED. Do not compress or lose information. Preserve absolutely everything you can including: every single primary and secondary goal, all exact file paths modified, detailed architectural and design decisions, a comprehensive log of the current state, and step-by-step next actions. Write extensively and do not leave out context.\n\n${transcript}`,
      abortSignal: AbortSignal.timeout(30000)
    })
    return result.text?.trim() || null
  } catch (err) {
    log.error('[summarise] Context summarisation failed:', err)
    return null
  }
}
