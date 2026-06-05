import { z } from 'zod'
import { readFileSync } from 'node:fs'
import log from 'electron-log'
import type { ModelMessage } from 'ai'

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
  type: z.literal('tool'),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.any()),
  argsDelta: z.string().optional(),
  result: z.any().optional(),
  status: z.enum(['pending', 'complete', 'error'])
})

const ErrorBlockSchema = z.object({
  type: z.literal('error'),
  message: z.string()
})

const StreamBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ReasoningBlockSchema,
  ToolBlockSchema,
  ErrorBlockSchema
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
      const parsed = z.array(StreamBlockSchema).safeParse(raw)
      return parsed.success ? parsed.data : undefined
    }
  } catch {}
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
): unknown[] {
  const parts: unknown[] = [{ type: 'text', text }]
  for (const att of attachments) {
    const mime = att.mimeType || 'application/octet-stream'
    const isText =
      mime.startsWith('text/') || mime.endsWith('/json') ||
      mime.endsWith('+json') || mime.endsWith('/xml') || mime.endsWith('/javascript')
    if (isText) {
      try {
        (parts[0] as { text: string }).text +=
          `\n\n── Attachment Text: ${att.name} ──\n${Buffer.from(att.base64, 'base64').toString('utf-8')}`
      } catch {
        (parts[0] as { text: string }).text += `\n\n[Attachment: ${att.name} - Failed to decode text]`
      }
    } else if (mime.startsWith('image/')) {
      if (modelSupportsVision)
        parts.push({ type: 'image', image: Buffer.from(att.base64, 'base64'), mimeType: mime })
      else
        (parts[0] as { text: string }).text += `\n\n[Image: ${att.name} - Omitted (no vision)]`
    } else {
      if (modelSupportsNativeFiles)
        parts.push({ type: 'file', data: Buffer.from(att.base64, 'base64'), mimeType: mime })
      else
        (parts[0] as { text: string }).text += `\n\n[File: ${att.name} - Omitted (no file support)]`
    }
  }
  return parts
}

// ─── History → ModelMessage[] ─────────────────────────────────────────────────

type RawMessage = { role: string; content: string; data?: string | null }

export function buildMessagesFromHistory(
  history: RawMessage[],
  modelSupportsVision: boolean,
  modelSupportsNativeFiles: boolean
): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (const m of history) {
    if (m.role === 'user') {
      let userContent: string | unknown[] = m.content
      if (m.data) {
        try {
          const dataObj = JSON.parse(m.data)
          if (Array.isArray(dataObj.attachments) && dataObj.attachments.length > 0) {
            userContent = buildAttachmentParts(m.content, dataObj.attachments, modelSupportsVision, modelSupportsNativeFiles)
          }
        } catch (err) {
          log.error('[schema] Failed to parse attachment data:', err)
        }
      }
      messages.push({ role: 'user', content: userContent as any })
    } else if (m.role === 'assistant') {
      let blocks: StreamBlock[] = []
      if (m.data) {
        try {
          const parsed = JSON.parse(m.data)
          if (Array.isArray(parsed)) blocks = parsed
        } catch {}
      }
      if (blocks.length === 0) {
        messages.push({ role: 'assistant', content: m.content || '' })
      } else {
        let assistantParts: any[] = []
        let toolResults: any[] = []
        const flush = () => {
          if (assistantParts.length) { messages.push({ role: 'assistant', content: assistantParts as any }); assistantParts = [] }
          if (toolResults.length) { messages.push({ role: 'tool', content: toolResults as any }); toolResults = [] }
        }
        for (const block of blocks) {
          if (block.type === 'text') {
            if (toolResults.length) flush()
            assistantParts.push({ type: 'text', text: block.content })
          } else if (block.type === 'tool') {
            if (toolResults.length) flush()
            assistantParts.push({ type: 'tool-call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.args || {} })
            if (block.status === 'complete' || block.status === 'error' || 'result' in block) {
              const outputVal = block.result
              let formattedOutput: unknown
              const KNOWN_TYPES = ['text', 'json', 'execution-denied', 'error-text', 'error-json', 'content']
              if (outputVal && typeof outputVal === 'object' && 'type' in outputVal &&
                KNOWN_TYPES.includes((outputVal as { type?: string }).type || '')) {
                formattedOutput = outputVal
              } else if (block.toolName === 'browserScreenshot' && (outputVal as any)?.success && (outputVal as any)?.filePath) {
                try {
                  const cleanPath = (outputVal as { filePath: string }).filePath.replace('file://', '')
                  const base64Image = readFileSync(cleanPath).toString('base64')
                  formattedOutput = { type: 'content', value: [
                    { type: 'image-data', data: base64Image, mediaType: 'image/png' },
                    { type: 'text', text: `Screenshot: ${(outputVal as any).filePath}` }
                  ]}
                } catch (err: any) {
                  formattedOutput = { type: 'content', value: [{ type: 'text', text: `Failed to read screenshot: ${err.message}` }] }
                }
              } else if (block.toolName === 'viewFile' && (outputVal as any)?.isBinary &&
                (outputVal as any)?.mimeType?.startsWith('image/') && (outputVal as any)?.base64Content) {
                formattedOutput = { type: 'content', value: [
                  { type: 'image-data', data: (outputVal as any).base64Content, mediaType: (outputVal as any).mimeType },
                  { type: 'text', text: `Analyzed binary image: ${(outputVal as any).absolutePath}` }
                ]}
              } else {
                const isError = block.status === 'error'
                formattedOutput = isError
                  ? typeof outputVal === 'string' ? { type: 'error-text', value: outputVal } : { type: 'error-json', value: outputVal ?? null }
                  : typeof outputVal === 'string' ? { type: 'text', value: outputVal } : { type: 'json', value: outputVal ?? null }
              }
              toolResults.push({ type: 'tool-result', toolCallId: block.toolCallId, toolName: block.toolName, output: formattedOutput as any })
            }
          }
        }
        flush()
      }
    } else if (m.role === 'system') {
      messages.push({ role: 'system', content: m.content })
    }
  }
  return messages
}
