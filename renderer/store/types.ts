export type StreamBlock =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string; durationMs?: number; isStreaming?: boolean }
  | {
      type: 'tool'
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
      argsDelta?: string
      result?: unknown
      status: 'pending' | 'complete' | 'error'
    }
  | { type: 'error'; message: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: string
  orderedBlocks?: StreamBlock[]
  timestamp: number
  isStreaming?: boolean
}

export interface ToolCallEntry {
  id: string
  toolName: string
  args: Record<string, unknown>
  argsDelta?: string
  result?: unknown
  status: 'pending' | 'complete' | 'error'
}


export interface EditorFile {
  name: string
  path: string
  content?: string
  language?: string
  isBinary?: boolean
  mimeType?: string
  base64?: string
}
