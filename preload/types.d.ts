export interface WorkspaceContext {
  conversationId: string
  rootPath: string
  artifactsPath: string
  isUserWorkspace: boolean
}

export type StreamChunk = {
  type: string
  payload?: unknown
  threadId?: string
}

export type StreamPayload = {
  promptText: string
  threadId: string
  modelType?: string
  startTime?: number
  userMsgId?: string
  assistantMsgId?: string
  attachments?: Array<{
    type: 'image' | 'document'
    name: string
    mimeType?: string
    base64: string
  }>
}
