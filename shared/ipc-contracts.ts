import type { SessionHistoryRecord, MessageWithMetadata, SessionPendingPrompt, WorkspaceInfo } from '@cline/sdk'

export interface BudgetInfo {
  cost_usd: number
  limit_usd: number
  remaining: number
  period: string
  allowed: boolean
}
export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}
export interface UsageSummary {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalCost?: number
}

import type { ModelInfo } from '@cline/shared'

export interface ModelConfig extends ModelInfo {
  provider: string
  reasoningEffort?: string
  badge?: string
}


export interface IpcContracts {
  'session:list': { args: void; result: SessionHistoryRecord[] }
  'session:create': {
    args: { title: string; workspacePath?: string; modelKey?: string }
    result: { sessionId: string; title: string } | { error: string } | undefined
  }
  'session:delete': { args: { sessionId: string }; result: boolean }
  'session:send': {
    args: {
      sessionId: string
      prompt: string
      userImages?: string[]
      userFiles?: string[]
      delivery?: 'queue' | 'steer'
    }
    result: boolean
  }
  'session:abort': { args: { sessionId: string }; result: boolean }
  'session:messages': { args: { sessionId: string }; result: MessageWithMetadata[] }

  'session:update-title': { args: { sessionId: string; title: string }; result: boolean }
  'session:update-model': {
    args: { sessionId: string; modelKey: string }
    result: { success?: boolean; error?: string }
  }
  'session:update-reasoning': {
    args: { sessionId: string; reasoningEffort: string | null }
    result: { success?: boolean; error?: string }
  }
  'queue:update': {
    args: { sessionId: string; promptId: string; prompt: string; delivery: 'queue' | 'steer' }
    result: boolean
  }
  'queue:delete': { args: { sessionId: string; promptId: string }; result: boolean }
  'queue:list': { args: { sessionId: string }; result: SessionPendingPrompt[] }
  'workspace:get-folders': { args: void; result: WorkspaceInfo[] }
  'workspace:add-folder': { args: { path: string; name: string }; result: boolean }
  'workspace:remove-folder': { args: { path: string }; result: boolean }
  'workspace:open-dialog': { args: void; result: WorkspaceInfo | undefined }
  'window:minimize': { args: void; result: boolean }
  'window:maximize': { args: void; result: boolean }
  'window:quit': { args: void; result: boolean }
  'file:read': { args: { filePath: string }; result: string | undefined }
  'file:list': { args: { dirPath: string }; result: string[] }

  'audio:transcribe': { args: { buffer: Uint8Array }; result: { text?: string; error?: string } }
  'models:list': { args: void; result: Record<string, ModelConfig> }
  'budget:get': { args: void; result: BudgetInfo | undefined }
  'auth:start': { args: void; result: void }
  'auth:get-session': { args: void; result: AuthSession | undefined }
  'auth:sign-out': { args: void; result: void }
  'app:check-for-updates': { args: void; result: boolean }
  'app:restart-and-update': { args: void; result: void }
  'app:open-releases': { args: void; result: void }
  'ask-question:response': { args: { id: string; answer: string }; result: boolean }
  'session:search': { args: { query: string }; result: { sessionId: string; title: string; role: string; text: string }[] }
}

export type IpcChannel = keyof IpcContracts
export type IpcArgs<C extends IpcChannel> = IpcContracts[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContracts[C]['result']
