import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  BudgetInfo,
  AuthSession,
  ModelConfig
} from '../shared/ipc-contracts'
import type { SessionHistoryRecord, MessageWithMetadata } from '@cline/sdk'
import type { WorkspaceInfo } from '@cline/shared'
export interface AppAPI {
  sessionList: () => Promise<SessionHistoryRecord[]>
  sessionCreate: (args: {
    title: string
    workspacePath?: string
    modelKey?: string
  }) => Promise<{ sessionId: string; title: string } | { error: string } | undefined>
  sessionDelete: (args: { sessionId: string }) => Promise<boolean>
  sessionSend: (args: {
    sessionId: string
    prompt: string
    userImages?: string[]
    userFiles?: string[]
    delivery?: 'queue' | 'steer'
  }) => Promise<boolean>
  sessionAbort: (args: { sessionId: string }) => Promise<boolean>
  sessionMessages: (args: { sessionId: string }) => Promise<MessageWithMetadata[]>
  sessionUpdateTitle: (args: { sessionId: string; title: string }) => Promise<boolean>
  workspaceGetFolders: () => Promise<WorkspaceInfo[]>
  workspaceAddFolder: (args: { path: string; name: string }) => Promise<boolean>
  workspaceRemoveFolder: (args: { path: string }) => Promise<boolean>
  workspaceOpenDialog: () => Promise<WorkspaceInfo | undefined>
  fileRead: (args: { filePath: string }) => Promise<string | undefined>
  fileList: (args: { dirPath: string }) => Promise<string[]>

  audioTranscribe: (args: { buffer: Uint8Array }) => Promise<string>
  modelsList: () => Promise<Record<string, ModelConfig>>
  budgetGet: () => Promise<BudgetInfo | undefined>
  sessionUpdateModel: (args: { sessionId: string; modelKey: string }) => Promise<boolean>
  queueUpdate: (args: {
    sessionId: string
    promptId: string
    prompt: string
    delivery: 'queue' | 'steer'
  }) => Promise<boolean>
  queueDelete: (args: { sessionId: string; promptId: string }) => Promise<boolean>
  queueList: (args: { sessionId: string }) => Promise<
    {
      id: string
      prompt: string
      delivery: 'queue' | 'steer'
      attachmentCount: number
      userImages?: string[]
      userFiles?: string[]
    }[]
  >
  authStart: () => Promise<void>
  authGetSession: () => Promise<AuthSession | undefined>
  authSignOut: () => Promise<void>
  onAuthChange: (cb: (session: AuthSession | undefined) => void) => () => void
  appCheckForUpdates: () => Promise<boolean>
  appRestartAndUpdate: () => Promise<void>
  appOpenReleases: () => Promise<void>
  onUpdateStatus: (
    cb: (info: {
      status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      version?: string
    }) => void
  ) => () => void
  onAskQuestion: (
    cb: (info: { id: string; sessionId: string; question: string; options: string[] }) => void
  ) => () => void
  onAskQuestionDismiss: (cb: (info: { id: string }) => void) => () => void
  submitAnswer: (args: { id: string; answer: string }) => Promise<boolean>
  sessionSearch: (args: { query: string }) => Promise<{ sessionId: string; title: string; role: string; text: string }[]>
  windowMinimize: () => Promise<boolean>
  windowMaximize: () => Promise<boolean>
  windowQuit: () => Promise<boolean>
  getFilePath: (file: File) => string
  platform: string
}
declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
