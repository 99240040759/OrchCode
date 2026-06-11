import { z } from 'zod'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import OpenAI from 'openai'
export type ModelMessage = OpenAI.ChatCompletionMessageParam

// ─── Block Schemas ────────────────────────────────────────────────────────────

const TextBlockSchema = z.object({ type: z.literal('text'), content: z.string() })
const ReasoningBlockSchema = z.object({ type: z.literal('reasoning'), content: z.string(), durationMs: z.number().optional(), isStreaming: z.boolean().optional() })
const ToolBlockSchema = z.object({ type: z.literal('tool_call'), tool_call_id: z.string(), tool_name: z.string(), args: z.record(z.string(), z.any()), args_delta: z.string().optional(), result: z.any().optional(), status: z.enum(['pending', 'complete', 'error']) })
const ErrorBlockSchema = z.object({ type: z.literal('error'), message: z.string() })
const SummarizeBlockSchema = z.object({ type: z.literal('summarize'), savedTokens: z.number(), totalTokens: z.number() })
const DurationBlockSchema = z.object({ type: z.literal('duration'), durationSeconds: z.number() })

const StreamBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema, ReasoningBlockSchema, ToolBlockSchema, ErrorBlockSchema, SummarizeBlockSchema, DurationBlockSchema
])

const UserMessageDataSchema = z.object({
  attachments: z.array(z.object({ type: z.enum(['image', 'document']), name: z.string(), mimeType: z.string().optional(), base64: z.string() })).optional()
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
  } catch (err) { log.error('[schema] Failed to parse user message data:', err) }
  return undefined
}

export function serializeMessageData(data: unknown): string { return JSON.stringify(data) }

export async function extractTextFromBinaryAttachment(name: string, mime: string, base64: string): Promise<string> {
  const buf = Buffer.from(base64, 'base64'), ext = name.split('.').pop()?.toLowerCase()
  if (mime === 'application/pdf' || ext === 'pdf') {
    try { const pdf = require('pdf-parse'), instance = new pdf.PDFParse({ data: buf }), data = await instance.getText(); return data.text || '' }
    catch (err: any) { log.error('[schema] pdf-parse failed:', err.message); return `[PDF File: ${name} - Text extraction failed: ${err.message}]` }
  }
  if (mime.includes('spreadsheet') || mime.includes('excel') || ext === 'xlsx' || ext === 'xls') {
    try {
      const XLSX = require('xlsx'), wb = XLSX.read(buf, { type: 'buffer' })
      let text = ''; for (const sn of wb.SheetNames) { const s = wb.Sheets[sn], csv = XLSX.utils.sheet_to_csv(s); if (csv.trim()) text += `\n\nSheet: ${sn}\n${csv}` }
      return text.trim() || `[Excel File: ${name} - Empty sheet content]`
    } catch (err: any) { log.error('[schema] xlsx parsing failed:', err.message); return `[Excel File: ${name} - Text extraction failed: ${err.message}]` }
  }
  if (mime.includes('word') || ext === 'docx') {
    try { const mammoth = require('mammoth'), res = await mammoth.extractRawText({ buffer: buf }); return res.value || '' }
    catch (err: any) { log.error('[schema] mammoth failed:', err.message); return `[Word File: ${name} - Text extraction failed: ${err.message}]` }
  }
  if (mime.includes('presentation') || ext === 'pptx') {
    try { const officeParser = require('officeparser'), ast = await officeParser.parseOffice(buf, { fileType: 'pptx' }); return ast.toText() || '' }
    catch (err: any) { log.error('[schema] officeparser failed:', err.message); return `[PowerPoint File: ${name} - Text extraction failed: ${err.message}]` }
  }
  return `[Binary File: ${name} (${mime}) - Binary file text extraction not supported]`
}

// ─── Attachment builder ───────────────────────────────────────────────────────
export async function buildAttachmentParts(
  text: string,
  attachments: Array<{ type: string; name: string; mimeType?: string; base64: string }>,
  multimodal: boolean
): Promise<any[]> {
  const parts: any[] = [{ type: 'text', text }]
  for (const att of attachments) {
    const mime = att.mimeType || 'application/octet-stream'
    const isText = mime.startsWith('text/') || mime.endsWith('/json') || mime.endsWith('+json') || mime.endsWith('/xml') || mime.endsWith('/javascript')
    if (isText) {
      try { parts[0].text += `\n\n── Attachment Text: ${att.name} ──\n${Buffer.from(att.base64, 'base64').toString('utf-8')}` }
      catch { parts[0].text += `\n\n[Attachment: ${att.name} - Failed to decode text]` }
    } else if (mime.startsWith('image/')) {
      if (multimodal) parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${att.base64}` } })
      else parts[0].text += `\n\n[Image: ${att.name} - Omitted (no vision)]`
    } else {
      const extracted = await extractTextFromBinaryAttachment(att.name, mime, att.base64)
      parts[0].text += `\n\n── Attachment Document: ${att.name} ──\n${extracted}`
    }
  }
  return parts
}

// ─── Format a stored tool result into a model-facing string ──────────────────
// Same logic as streamWorker's formatToolOutputForModel but for history reconstruction.
// If the screenshot file no longer exists we use a text placeholder — no crash.
async function formatStoredToolResult(
  toolName: string,
  outputVal: any,
  status: 'complete' | 'error' | 'pending',
  multimodal: boolean
): Promise<{ content: string; isImage: boolean; imgBase64?: string; imgMime?: string }> {
  if (status === 'pending') {
    return { content: 'Tool execution was interrupted or cancelled.', isImage: false }
  }
  // view_file binary image
  if (toolName === 'view_file' && outputVal?.isBinary && outputVal?.mimeType?.startsWith('image/') && outputVal?.base64Content && multimodal) {
    return { content: '', isImage: true, imgBase64: outputVal.base64Content, imgMime: outputVal.mimeType }
  }
  // browser_screenshot — try to read, fall back to text
  if (toolName === 'browser_screenshot' && outputVal?.success && outputVal?.filePath) {
    if (multimodal) {
      try {
        const cleanPath = (outputVal.filePath as string).replace('file://', '')
        const base64Image = (await fs.readFile(cleanPath)).toString('base64')
        return { content: '', isImage: true, imgBase64: base64Image, imgMime: 'image/png' }
      } catch {
        // File no longer exists — fall through to text
      }
    }
    return { content: `Screenshot was captured at: ${outputVal.filePath} (image data unavailable)`, isImage: false }
  }
  // view_file text — produce the METADATA + content format
  if (toolName === 'view_file' && outputVal && typeof outputVal === 'object' && 'content' in outputVal && !outputVal.isBinary) {
    const metaLine = `[METADATA: readStart=${outputVal.readStart ?? 1}, readEnd=${outputVal.readEnd ?? '?'}]`
    const contentStr = outputVal.content ?? outputVal.error ?? 'No content'
    return { content: `${metaLine}\n${contentStr}`, isImage: false }
  }
  // list_dir — produce clean text list
  if (toolName === 'list_dir' && outputVal?.entries && Array.isArray(outputVal.entries)) {
    const text = outputVal.entries.map((e: any) =>
      e.isDirectory ? `[DIR] ${e.name}/ (${e.numChildren ?? '?'} items)` : `[FILE] ${e.name} (${e.sizeBytes ?? '?'} bytes)`
    ).join('\n') || 'Empty directory'
    return { content: text, isImage: false }
  }
  // Error case
  if (outputVal?.success === false) {
    return { content: `Error: ${outputVal.error ?? 'Unknown error'}`, isImage: false }
  }
  // Generic
  const str = typeof outputVal === 'string' ? outputVal : JSON.stringify(outputVal ?? '')
  return { content: str, isImage: false }
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
  multimodal: boolean
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
            userContent = await buildAttachmentParts(m.content, dataObj.attachments, multimodal)
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
        continue
      }

      let textVal = '', reasoningVal = ''
      const toolCalls: any[] = []
      const toolResults: { tool_call_id: string; content: string }[] = []
      const stepImageParts: { imgBase64: string; imgMime: string }[] = []

      for (const block of blocks) {
        if (block.type === 'text') {
          textVal += block.content
        } else if (block.type === 'reasoning') {
          reasoningVal += block.content
        } else if (block.type === 'tool_call') {
          toolCalls.push({
            id: block.tool_call_id,
            type: 'function',
            function: {
              name: block.tool_name,
              arguments: typeof block.args === 'string' ? block.args : JSON.stringify(block.args || {})
            }
          })
          const formatted = await formatStoredToolResult(block.tool_name, block.result, block.status, multimodal)
          if (formatted.isImage && formatted.imgBase64 && formatted.imgMime) {
            const textSummary = block.tool_name === 'browser_screenshot'
              ? `Screenshot captured: ${block.result?.filePath ?? ''}`
              : `Binary image read: ${block.result?.absolute_path ?? block.result?.absolutePath ?? ''}`
            toolResults.push({ tool_call_id: block.tool_call_id, content: JSON.stringify({ success: true, message: textSummary }) })
            stepImageParts.push({ imgBase64: formatted.imgBase64, imgMime: formatted.imgMime })
          } else {
            toolResults.push({ tool_call_id: block.tool_call_id, content: formatted.content })
          }
        }
      }

      const assistantMsg: any = { role: 'assistant', content: textVal || '' }
      if (reasoningVal) {
        assistantMsg.reasoning_content = reasoningVal
        assistantMsg.reasoning = reasoningVal
      }
      if (toolCalls.length) {
        assistantMsg.tool_calls = toolCalls
      }
      rawMessages.push(assistantMsg)
      for (const tr of toolResults) rawMessages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content })
      if (stepImageParts.length > 0 && multimodal) {
        rawMessages.push({
          role: 'user',
          content: [
            { type: 'text' as const, text: 'Images from the previous tool calls:' },
            ...stepImageParts.map(p => ({ type: 'image_url' as const, image_url: { url: `data:${p.imgMime};base64,${p.imgBase64}` } }))
          ]
        })
      }
    }
  }

  return { messages: sanitizeMessages(rawMessages), systemInstructionSuffix }
}
