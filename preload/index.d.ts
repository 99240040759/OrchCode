import { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcArgs, IpcResult, BudgetInfo, AuthSession, ModelConfig } from '../shared/ipc-contracts'
import type { SessionHistoryRecord, MessageWithMetadata, SessionPendingPrompt } from '@cline/sdk'
import type { WorkspaceInfo } from '@cline/shared'
export interface AppAPI {
  sessionList: () => Promise<SessionHistoryRecord[]>
  sessionCreate: (args: IpcArgs<'session:create'>) => Promise<IpcResult<'session:create'>>
  sessionDelete: (args: IpcArgs<'session:delete'>) => Promise<boolean>
  sessionSend: (args: IpcArgs<'session:send'>) => Promise<boolean>
  sessionAbort: (args: IpcArgs<'session:abort'>) => Promise<boolean>
  sessionMessages: (args: IpcArgs<'session:messages'>) => Promise<MessageWithMetadata[]>
  sessionUpdateTitle: (args: IpcArgs<'session:update-title'>) => Promise<boolean>
  workspaceGetFolders: () => Promise<WorkspaceInfo[]>
  workspaceAddFolder: (args: IpcArgs<'workspace:add-folder'>) => Promise<boolean>
  workspaceRemoveFolder: (args: IpcArgs<'workspace:remove-folder'>) => Promise<boolean>
  workspaceOpenDialog: () => Promise<WorkspaceInfo | undefined>
  fileRead: (args: IpcArgs<'file:read'>) => Promise<string | undefined>
  fileList: (args: IpcArgs<'file:list'>) => Promise<string[]>
  audioTranscribe: (args: { buffer: Uint8Array }) => Promise<string>
  modelsList: () => Promise<Record<string, ModelConfig>>
  budgetGet: () => Promise<BudgetInfo | undefined>
  sessionUpdateModel: (args: IpcArgs<'session:update-model'>) => Promise<IpcResult<'session:update-model'>>
  sessionUpdateReasoning: (args: IpcArgs<'session:update-reasoning'>) => Promise<IpcResult<'session:update-reasoning'>>
  queueUpdate: (args: IpcArgs<'queue:update'>) => Promise<boolean>
  queueDelete: (args: IpcArgs<'queue:delete'>) => Promise<boolean>
  queueList: (args: IpcArgs<'queue:list'>) => Promise<SessionPendingPrompt[]>
  authStart: () => Promise<void>
  authGetSession: () => Promise<AuthSession | undefined>
  authSignOut: () => Promise<void>
  onAuthChange: (cb: (session: AuthSession | undefined) => void) => () => void
  appCheckForUpdates: () => Promise<boolean>
  appRestartAndUpdate: () => Promise<void>
  appOpenReleases: () => Promise<void>
  browserRegister: (args: IpcArgs<'browser:register'>) => Promise<boolean>
  onUpdateStatus: (cb: (info: { status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'; version?: string }) => void) => () => void
  onAskQuestion: (cb: (info: { id: string; sessionId: string; question: string; options: string[] }) => void) => () => void
  onAskQuestionDismiss: (cb: (info: { id: string }) => void) => () => void
  onCoreInitFailed: (cb: (info: { message: string }) => void) => () => void
  submitAnswer: (args: IpcArgs<'ask-question:response'>) => Promise<boolean>
  sessionSearch: (args: IpcArgs<'session:search'>) => Promise<IpcResult<'session:search'>>
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
