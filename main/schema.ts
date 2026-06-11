import { z } from 'zod'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import OpenAI from 'openai'
export type ModelMessage = OpenAI.ChatCompletionMessageParam

// ─── Block Schemas ────────────────────────────────────────────────────────────

const TextBlockSchema = z.object({
  type: z.literal('text'),
  content: z.string()
})

const ReasoningBlockSchema = z.object({
  type: z.literal('reasoning'),
  content: z.string(),
  durationMs: z.number().optional(),
  isStreaming: z.boolean().optional()
})

const ToolBlockSchema = z.object({
  type: z.literal('tool_call'),
  tool_call_id: z.string(),
  tool_name: z.string(),
  args: z.record(z.string(), z.any()),
  args_delta: z.string().optional(),
  result: z.any().optional(),
  status: z.enum(['pending', 'complete', 'error'])
})

const ErrorBlockSchema = z.object({
  type: z.literal('error'),
  message: z.string()
})

const SummarizeBlockSchema = z.object({
  type: z.literal('summarize'),
  savedTokens: z.number(),
  totalTokens: z.number()
})

const DurationBlockSchema = z.object({
  type: z.literal('duration'),
  durationSeconds: z.number()
})

const StreamBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ReasoningBlockSchema,
  ToolBlockSchema,
  ErrorBlockSchema,
  SummarizeBlockSchema,
  DurationBlockSchema
])

const UserMessageDataSchema = z.object({
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'document']),
        name: z.string(),
        mimeType: z.string().optional(),
        base64: z.string()
      })
    )
    .optional()
})

export type StreamBlock = z.infer<typeof StreamBlockSchema>
export type UserMessageData = z.infer<typeof UserMessageDataSchema>

export function parseAssistantMessageData(dataStr?: string | null): StreamBlock[] | undefined {
  if (!dataStr) return undefined
  try {
    const raw = JSON.parse(dataStr)
    if (Array.isArray(raw)) {
      const parsedList: StreamBlock[] = []
      for (const item of raw) {
        const parsed = StreamBlockSchema.safeParse(item)
        if (parsed.success) parsedList.push(parsed.data)
        else log.warn('[schema] Invalid block skipped:', parsed.error.format(), item)
      }
      return parsedList.length > 0 ? parsedList : undefined
    }
  } catch (err) { log.error('[schema] Failed to parse assistant message data:', err) }
  return undefined
}

export function parseUserMessageData(dataStr?: string | null): UserMessageData | undefined {
  if (!dataStr) return undefined
  try {
    const raw = JSON.parse(dataStr)
    const parsed = UserMessageDataSchema.safeParse(raw)
    return parsed.success ? parsed.data : undefined
  } catch {}
  return undefined
}

export function serializeMessageData(data: unknown): string {
  return JSON.stringify(data)
}

// ─── Attachment builder ───────────────────────────────────────────────────────
// Converts raw base64 attachments into Vercel AI SDK content parts,
// respecting per-model capability flags.

export function buildAttachmentParts(
  text: string,
  attachments: Array<{ type: string; name: string; mimeType?: string; base64: string }>,
  modelSupportsVision: boolean,
  modelSupportsNativeFiles: boolean
): any[] {
  const parts: any[] = [{ type: 'text', text }]
  for (const att of attachments) {
    const mime = att.mimeType || 'application/octet-stream'
    const isText =
      mime.startsWith('text/') || mime.endsWith('/json') ||
      mime.endsWith('+json') || mime.endsWith('/xml') || mime.endsWith('/javascript')
    if (isText) {
      try {
        parts[0].text +=
          `\n\n── Attachment Text: ${att.name} ──\n${Buffer.from(att.base64, 'base64').toString('utf-8')}`
      } catch {
        parts[0].text += `\n\n[Attachment: ${att.name} - Failed to decode text]`
      }
    } else if (mime.startsWith('image/')) {
      if (modelSupportsVision) parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${att.base64}` } })
      else parts[0].text += `\n\n[Image: ${att.name} - Omitted (no vision)]`
    } else {
      if (modelSupportsNativeFiles) parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${att.base64}` } })
      else parts[0].text += `\n\n[File: ${att.name} - Omitted (no native file support)]`
    }
  }
  return parts
}

// ─── History → ModelMessage[] ─────────────────────────────────────────────────

type RawMessage = { role: string; content: string; data?: string | null }

export function sanitizeMessages(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []
  const seenToolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      if (msg.tool_calls) { for (const tc of msg.tool_calls) if (tc.id) seenToolCallIds.add(tc.id) }
      result.push(msg)
    } else if (msg.role === 'tool') {
      if (seenToolCallIds.has(msg.tool_call_id)) result.push(msg)
    } else {
      result.push(msg)
    }
  }
  return result
}

export async function buildMessagesFromHistory(
  history: RawMessage[],
  modelSupportsVision: boolean,
  modelSupportsNativeFiles: boolean
): Promise<{ messages: ModelMessage[]; systemInstructionSuffix: string }> {
  const rawMessages: ModelMessage[] = []
  let systemInstructionSuffix = ''
  for (const m of history) {
    if (m.role === 'system') {
      systemInstructionSuffix += `\n\n${m.content}`
    } else if (m.role === 'user') {
      let userContent: any = m.content
      if (m.data) {
        try {
          const dataObj = JSON.parse(m.data)
          if (Array.isArray(dataObj.attachments) && dataObj.attachments.length > 0) {
            userContent = buildAttachmentParts(m.content, dataObj.attachments, modelSupportsVision, modelSupportsNativeFiles)
          }
        } catch (err) { log.error('[schema] Failed to parse attachment data:', err) }
      }
      rawMessages.push({ role: 'user', content: userContent })
    } else if (m.role === 'assistant') {
      let blocks: StreamBlock[] = []
      if (m.data) {
        const parsed = parseAssistantMessageData(m.data)
        if (parsed) blocks = parsed
      }
      if (blocks.length === 0) {
        rawMessages.push({ role: 'assistant', content: m.content || '' })
      } else {
        let textVal = ''
        const toolCalls: any[] = []
        const toolResults: any[] = []
        for (const block of blocks) {
          if (block.type === 'text') {
            textVal += block.content
          } else if (block.type === 'tool_call') {
            toolCalls.push({ id: block.tool_call_id, type: 'function', function: { name: block.tool_name, arguments: typeof block.args === 'string' ? block.args : JSON.stringify(block.args || {}) } })
            if (block.status === 'complete' || block.status === 'error' || 'result' in block) {
              const outputVal = block.result
              let formattedOutput: string
              if (outputVal && typeof outputVal === 'object' && 'type' in outputVal) {
                formattedOutput = JSON.stringify(outputVal)
              } else if (block.tool_name === 'browserScreenshot' && (outputVal as any)?.success && (outputVal as any)?.filePath) {
                try {
                  const cleanPath = (outputVal as { filePath: string }).filePath.replace('file://', '')
                  const base64Image = (await fs.readFile(cleanPath)).toString('base64')
                  formattedOutput = JSON.stringify({ type: 'content', value: [
                    { type: 'image-data', data: base64Image, mediaType: 'image/png' },
                    { type: 'text', text: `Screenshot: ${(outputVal as any).filePath}` }
                  ]})
                } catch (err: any) { formattedOutput = `Failed to read screenshot: ${err.message}` }
              } else if (block.tool_name === 'viewFile' && (outputVal as any)?.isBinary &&
                (outputVal as any)?.mimeType?.startsWith('image/') && (outputVal as any)?.base64Content) {
                formattedOutput = JSON.stringify({ type: 'content', value: [
                  { type: 'image-data', data: (outputVal as any).base64Content, mediaType: (outputVal as any).mimeType },
                  { type: 'text', text: `Analyzed binary image: ${(outputVal as any).absolutePath}` }
                ]})
              } else {
                formattedOutput = typeof outputVal === 'string' ? outputVal : JSON.stringify(block.status === 'error' ? (outputVal ?? 'Error') : (outputVal ?? ''))
              }
              toolResults.push({ tool_call_id: block.tool_call_id, content: formattedOutput })
            } else {
              toolResults.push({ tool_call_id: block.tool_call_id, content: 'Tool execution was interrupted or cancelled.' })
            }
          }
        }
        rawMessages.push({ role: 'assistant', content: textVal || null, tool_calls: toolCalls.length ? toolCalls : undefined })
        for (const tr of toolResults) {
          rawMessages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content })
        }
      }
    }
  }
  return { messages: sanitizeMessages(rawMessages), systemInstructionSuffix }
}
