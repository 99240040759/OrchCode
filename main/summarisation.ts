import log from 'electron-log'
import { requireAuthToken } from './auth'
import { getApiBaseUrl } from './utils'

const SUMMARISE_MODEL = 'gemini-3.1-flash-lite'

export async function summariseContext(messages: any[]): Promise<string | null> {
  try {
    const transcript = messages
      .map((m) => {
        const role = m.role === 'tool' ? 'TOOL_RESULT' : m.role.toUpperCase()
        let content = ''
        if (typeof m.content === 'string') {
          content = m.content.slice(0, 20000)
        } else if (Array.isArray(m.content)) {
          content = (m.content as any[])
            .map((p) => {
              if (p.type === 'text') return p.text?.slice(0, 10000) ?? ''
              if (p.type === 'image_url') return `[Image Content Part: ${p.image_url?.url?.slice(0, 100)}]`
              return JSON.stringify(p).slice(0, 2000)
            })
            .filter(Boolean)
            .join('\n')
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const callsStr = m.tool_calls.map((tc: any) => `[Tool Call ID: ${tc.id}, Name: ${tc.function?.name}, Args: ${tc.function?.arguments}]`).join('\n')
          content = (content ? content + '\n' : '') + callsStr
        }
        if (m.role === 'tool') {
          content = `[Tool Call ID: ${m.tool_call_id}] Result: ${content}`
        }
        return `[${role}] ${content}`
      })
      .join('\n\n')

    const url = `${getApiBaseUrl()}/gemini/v1beta/models/${SUMMARISE_MODEL}:generateContent`
    const headers = new Headers()
    headers.set('Authorization', `Bearer ${requireAuthToken()}`)
    headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
    headers.set('Content-Type', 'application/json')

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `Summarise this conversation history. Your summary must be EXTREMELY LONG and HIGHLY DETAILED. Do not compress or lose information. Preserve absolutely everything you can including: every single primary and secondary goal, all exact file paths modified, detailed architectural and design decisions, a comprehensive log of the current state, and step-by-step next actions. Write extensively and do not leave out context.\n\n${transcript}` }]
          }
        ]
      }),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status} - ${await response.text()}`)
    const json = await response.json()
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch (err) {
    log.error('[summarise] Context summarisation failed:', err)
    return null
  }
}
