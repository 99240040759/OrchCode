export type StreamBlock =
  | { type: 'text'; content: string }
  | {
      type: 'tool_call'
      tool_call_id: string
      tool_name: string
      args: Record<string, unknown>
      args_delta?: string
      result?: unknown
      status: 'pending' | 'complete' | 'error'
    }
  | { type: 'error'; message: string }
  | { type: 'summarize'; savedTokens: number; totalTokens: number }
  | { type: 'duration'; durationSeconds: number }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: string
  orderedBlocks?: StreamBlock[]
  timestamp: number
  isStreaming?: boolean
}

export type ToolStreamBlock = Extract<StreamBlock, { type: 'tool_call' }>
export type ToolCallEntry = Omit<ToolStreamBlock, 'type' | 'tool_call_id'> & { id: string }


export interface EditorFile {
  name: string
  path: string
  content?: string
  language?: string
  isBinary?: boolean
  mimeType?: string
  base64?: string
}
