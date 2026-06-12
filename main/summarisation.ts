import log from 'electron-log'
import { requireAuthToken } from './auth'
import { getApiBaseUrl } from './utils'

const SUMMARISE_MODEL = 'gemini-3.1-flash-lite'

const SUMMARISE_SYSTEM_PROMPT = `You are a conversation memory compactor for an AI coding agent. Your job is to produce a maximally detailed, lossless summary of the conversation so the agent can continue with full context.

Your summary MUST contain, in structured form:
1. **Primary Goal**: What the user originally asked for and the overall objective.
2. **Sub-goals & Decisions**: Every design decision made, architectural choice, approach selected.
3. **Files Modified/Created**: Every file path that was read, created, or modified — with exact paths and what was changed.
4. **Current Codebase State**: Key structures, exports, interfaces, and patterns that are now in place.
5. **Tool Execution Log**: Every tool call made and its outcome (success/failure/what it returned).
6. **Pending Actions**: Steps that were planned but not yet executed, TODOs, next steps.
7. **User Preferences**: Any style or behavior preferences the user expressed.
8. **Errors & Blockers**: Any errors encountered, how they were handled, and what remains unresolved.

Write as much as needed. Do NOT compress or drop any detail. Use section headers and bullet points. The agent reading this summary must be able to continue exactly where it left off.`

function buildTranscript(messages: any[]): string {
  return messages.map(m => {
    const role = m.role === 'tool' ? 'TOOL_RESULT' : m.role.toUpperCase()
    let content = ''
    if (typeof m.content === 'string') {
      content = m.content
    } else if (Array.isArray(m.content)) {
      content = (m.content as any[])
        .map(p => {
          if (p.type === 'text') return p.text ?? ''
          if (p.type === 'image_url') return `[Image: ${p.image_url?.url?.slice(0, 80) ?? 'data'}]`
          return JSON.stringify(p)
        })
        .filter(Boolean)
        .join('\n')
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const callsStr = m.tool_calls.map((tc: any) =>
        `[Tool Call ID: ${tc.id} | Name: ${tc.function?.name} | Args: ${tc.function?.arguments}]`
      ).join('\n')
      content = (content ? content + '\n' : '') + callsStr
    }
    if (m.role === 'tool') {
      content = `[Tool Call ID: ${m.tool_call_id}]\n${content}`
    }
    return `[${role}]\n${content}`
  }).join('\n\n---\n\n')
}

export async function summariseContext(messages: any[]): Promise<string | null> {
  try {
    const transcript = buildTranscript(messages)
    const url = `${getApiBaseUrl()}/gemini/v1beta/models/${SUMMARISE_MODEL}:generateContent`
    const headers = new Headers()
    headers.set('Authorization', `Bearer ${requireAuthToken()}`)
    headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
    headers.set('Content-Type', 'application/json')
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SUMMARISE_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `Produce a complete, structured, maximally detailed summary of the following agent conversation history:\n\n${transcript}` }] }]
      })
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} — ${await response.text()}`)
    const json = await response.json()
    const result = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!result) throw new Error('Empty summary response')
    log.info(`[summarise] Summary generated: ${result.length} chars`)
    return result
  } catch (err) {
    log.error('[summarise] Context summarisation failed:', err)
    return null
  }
}
