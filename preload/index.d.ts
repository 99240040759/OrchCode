export type { WorkspaceContext } from './types'

export interface ArtifactEntry {
  name: string
  path: string
  size: number
  modified: string
}

export interface ThreadEntry {
  id: string
  title?: string
  resourceId: string
  createdAt: string
  updatedAt: string
  workspacePath?: string | null
  accumulatedTokens?: number
  lifetimeTokens?: number
}

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  data?: string
  createdAt: string
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}

export interface UserProfile {
  uid: string
  name: string
  email: string
  photoUrl: string
}

export type FileReadResult =
  | {
      name: string
      path: string
      isBinary: true
      mimeType: string
      base64: string
    }
  | {
      name: string
      path: string
      isBinary: false
      content: string
      language: string
    }

export type { StreamChunk, StreamPayload } from './types'

export interface ApprovalRequest {
  toolCallId: string
  toolName: string
  args: Record<string, any>
}

export interface ApprovalResponse {
  approved: boolean
  remember?: boolean
}

export interface MemoryEntry {
  id: string
  content: string
  category: string
  workspace_path: string | null
  created_at: string
  updated_at: string
}

export interface McpServerEntry {
  id: string
  name: string
  transport: 'stdio' | 'sse'
  config: string
  enabled: number
  created_at: string
}

export interface UsageStats {
  totalInput: number
  totalOutput: number
  totalLifetime: number
}

export interface QuotaInfo {
  allowed: boolean
  remaining: number
  cost_usd: number
  limit_usd: number
  period: string
}

export interface Api {
  invoke(command: string, payload?: unknown): Promise<unknown>
  stream(payload: StreamPayload, onChunk: (chunk: StreamChunk) => void): Promise<void>
  stopStream(threadId: string): void
  injectToStream(threadId: string, text: string): void
  respondToApproval(threadId: string, response: ApprovalResponse): void
  on(channel: string, cb: (data: unknown) => void): () => void
  onTerminalPort(id: string): void
  platform: 'darwin' | 'win32' | 'linux'
}

declare global {
  interface Window {
    api: Api
  }
}
