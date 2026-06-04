export type AgentStreamChunkType =
  | 'reasoning-start'
  | 'reasoning-delta'
  | 'reasoning-end'
  | 'text-delta'
  | 'tool-call-streaming-start'
  | 'tool-call-delta'
  | 'tool-call'
  | 'tool-result'
  | 'error'
  | 'step-limit'
  | 'token-update'
  | 'finish'

export interface AgentStreamChunk {
  type: AgentStreamChunkType
  payload?: any
  threadId: string
}

export interface AgentStreamTokenUpdatePayload {
  accumulatedTokens: number
}

export interface AgentStreamFinishPayload {
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  accumulatedTokens?: number
}

export interface AgentStreamToolCallStreamingStartPayload {
  toolCallId: string
  toolName: string
}

export interface AgentStreamToolCallDeltaPayload {
  toolCallId: string
  delta: string
}

export interface AgentStreamToolCallPayload {
  toolCallId: string
  toolName: string
  args: any
}

export interface AgentStreamToolResultPayload {
  toolCallId: string
  result: any
}
