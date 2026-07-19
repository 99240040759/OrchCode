import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { IpcArgs, IpcChannel, IpcResult } from '../shared/ipc-contracts'

type InvokeArgs<C extends IpcChannel> = IpcArgs<C> extends void ? [] : [IpcArgs<C>]
function invoke<C extends IpcChannel>(channel: C, ...args: InvokeArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args).catch((err) => { console.error(`[Preload IPC Error] ${channel}:`, err); throw err })
}
function makeListener<T>(channel: string, cb: (data: T) => void): () => void {
  const fn = (_: unknown, data: T): void => cb(data)
  const cast = fn as Parameters<typeof ipcRenderer.on>[1]
  ipcRenderer.on(channel, cast)
  return () => ipcRenderer.removeListener(channel, cast)
}

const api = {
  sessionList: () => invoke('session:list'),
  sessionCreate: (args: IpcArgs<'session:create'>) => invoke('session:create', args),
  sessionDelete: (args: IpcArgs<'session:delete'>) => invoke('session:delete', args),
  sessionSend: (args: IpcArgs<'session:send'>) => invoke('session:send', args),
  sessionAbort: (args: IpcArgs<'session:abort'>) => invoke('session:abort', args),
  sessionMessages: (args: IpcArgs<'session:messages'>) => invoke('session:messages', args),
  sessionUpdateTitle: (args: IpcArgs<'session:update-title'>) => invoke('session:update-title', args),
  workspaceGetFolders: () => invoke('workspace:get-folders'),
  workspaceAddFolder: (args: IpcArgs<'workspace:add-folder'>) => invoke('workspace:add-folder', args),
  workspaceRemoveFolder: (args: IpcArgs<'workspace:remove-folder'>) => invoke('workspace:remove-folder', args),
  workspaceOpenDialog: () => invoke('workspace:open-dialog'),
  fileRead: (args: IpcArgs<'file:read'>) => invoke('file:read', args),
  fileList: (args: IpcArgs<'file:list'>) => invoke('file:list', args),
  audioTranscribe: async (args: IpcArgs<'audio:transcribe'>) => {
    const res = await invoke('audio:transcribe', args)
    if (res.error) throw new Error(res.error)
    return res.text ?? ''
  },
  modelsList: () => invoke('models:list'),
  budgetGet: () => invoke('budget:get'),
  sessionUpdateModel: (args: IpcArgs<'session:update-model'>) => invoke('session:update-model', args),
  sessionUpdateReasoning: (args: IpcArgs<'session:update-reasoning'>) => invoke('session:update-reasoning', args),
  queueUpdate: (args: IpcArgs<'queue:update'>) => invoke('queue:update', args),
  queueDelete: (args: IpcArgs<'queue:delete'>) => invoke('queue:delete', args),
  queueList: (args: IpcArgs<'queue:list'>) => invoke('queue:list', args),
  authStart: () => invoke('auth:start'),
  authGetSession: () => invoke('auth:get-session'),
  authSignOut: () => invoke('auth:sign-out'),
  onAuthChange: (cb: (session: IpcResult<'auth:get-session'>) => void) => makeListener<IpcResult<'auth:get-session'>>('auth:change', cb),
  onAuthError: (cb: (info: { message: string }) => void) => makeListener<{ message: string }>('auth:error', cb),
  appCheckForUpdates: () => invoke('app:check-for-updates'),
  appRestartAndUpdate: () => invoke('app:restart-and-update'),
  appOpenReleases: () => invoke('app:open-releases'),
  browserRegister: (args: IpcArgs<'browser:register'>) => invoke('browser:register', args),
  onUpdateStatus: (cb: (info: { status: string; version?: string }) => void) => makeListener<{ status: string; version?: string }>('update:status', cb),
  onAskQuestion: (cb: (info: { id: string; sessionId: string; question: string; options: string[] }) => void) => makeListener<{ id: string; sessionId: string; question: string; options: string[] }>('ask-question', cb),
  onAskQuestionDismiss: (cb: (info: { id: string }) => void) => makeListener<{ id: string }>('ask-question:dismiss', cb),
  onCoreInitFailed: (cb: (info: { message: string }) => void) => makeListener<{ message: string }>('core:init-failed', cb),
  submitAnswer: (args: IpcArgs<'ask-question:response'>) => invoke('ask-question:response', args),
  sessionSearch: (args: IpcArgs<'session:search'>) => invoke('session:search', args),
  windowMinimize: () => invoke('window:minimize'),
  windowMaximize: () => invoke('window:maximize'),
  windowQuit: () => invoke('window:quit'),
  getFilePath: (file: File) => {
    const p = webUtils.getPathForFile(file)
    if (!p) throw new Error('File path could not be resolved in the sandbox.')
    return p
  },
  platform: process.platform as string
}

window.addEventListener('message', (event) => {
  if (event.source !== window || (event.origin !== window.location.origin && (window.location.protocol !== 'file:' || event.origin !== 'null'))) return
  const data = event.data as { type?: unknown; sessionId?: unknown } | null
  if (data?.type === 'session:register-port-transfer' && typeof data.sessionId === 'string' && data.sessionId.length <= 200) {
    const port = event.ports[0]
    if (port) ipcRenderer.postMessage('session:register-port', { sessionId: data.sessionId }, [port])
  }
  if (data?.type === 'session:unregister-port-transfer' && typeof data.sessionId === 'string' && data.sessionId.length <= 200) {
    ipcRenderer.send('session:unregister-port', { sessionId: data.sessionId })
  }
})

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (err: unknown) {
  console.error('[Preload] contextBridge expose failed:', err)
}
