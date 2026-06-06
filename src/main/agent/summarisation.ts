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
          content = m.content.slice(0, 3000)
        } else if (Array.isArray(m.content)) {
          content = (m.content as Array<{ type?: string; text?: string; toolName?: string; input?: unknown; args?: unknown; output?: unknown; result?: unknown }>)
            .map((p) => {
              if (p.type === 'text') return p.text?.slice(0, 1000) ?? ''
              if (p.type === 'tool-call') {
                const name = p.toolName || (p as any).name || 'unknown'
                const args = p.args || p.input || {}
                return `[Tool Call: ${name}, Args: ${JSON.stringify(args).slice(0, 400)}]`
              }
              if (p.type === 'tool-result') {
                const name = p.toolName || (p as any).name || 'unknown'
                const result = p.result || p.output || {}
                return `[Tool Result for ${name}: ${JSON.stringify(result).slice(0, 400)}]`
              }
              return JSON.stringify(p).slice(0, 500)
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
