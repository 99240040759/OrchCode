import { z } from 'zod'

export const TextBlockSchema = z.object({
  type: z.literal('text'),
  content: z.string()
})

export const ReasoningBlockSchema = z.object({
  type: z.literal('reasoning'),
  content: z.string(),
  durationMs: z.number().optional(),
  isStreaming: z.boolean().optional()
})

export const ToolBlockSchema = z.object({
  type: z.literal('tool'),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.any()),
  argsDelta: z.string().optional(),
  result: z.any().optional(),
  status: z.enum(['pending', 'complete', 'error'])
})

export const ErrorBlockSchema = z.object({
  type: z.literal('error'),
  message: z.string()
})

export const StreamBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ReasoningBlockSchema,
  ToolBlockSchema,
  ErrorBlockSchema
])

export const UserMessageDataSchema = z.object({
  attachments: z.array(z.object({
    type: z.enum(['image', 'document']),
    name: z.string(),
    mimeType: z.string().optional(),
    base64: z.string()
  })).optional()
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
