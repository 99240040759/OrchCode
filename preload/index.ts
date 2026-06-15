import { contextBridge, ipcRenderer } from 'electron'
import { PUSH_CHANNELS } from '../shared/ipcChannels'

const activeStreams = new Map<string, { port: MessagePort; cleanup: () => void; abort: () => void }>()




import type { StreamChunk, StreamPayload } from './types'
export type { StreamChunk, StreamPayload }



contextBridge.exposeInMainWorld('api', {
   
  invoke: (command: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('api:invoke', { command, payload }),


   
  stream: (payload: StreamPayload, onChunk: (chunk: StreamChunk) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ch = `stream:port:${payload.threadId}`, chCrashed = 'stream:worker-crashed'
      const cleanup = () => {
        ipcRenderer.off(ch, onPortReceived); ipcRenderer.off(chCrashed, onCrash)
        const st = activeStreams.get(payload.threadId); if (st) { st.port.close(); activeStreams.delete(payload.threadId) }
      }
      const onCrash = (_ev: unknown, data: any) => {
        if (data && data.threadId === payload.threadId) {
          cleanup()
          reject(new Error(`Utility worker process crashed (Exit code: ${data.code ?? 'unknown'})`))
        }
      }
      const onPortReceived = (ev: Electron.IpcRendererEvent) => {
        const p = ev.ports[0]; if (!p) { cleanup(); return reject(new Error('No port')) }
    activeStreams.set(payload.threadId, { port: p, cleanup, abort: () => { const e = new Error('Stream aborted locally'); e.name = 'AbortError'; reject(e) } })
        p.onmessage = (e) => {
          onChunk(e.data)
          if (['finish', 'error'].includes(e.data.type)) { cleanup(); resolve() }
        }
        p.onmessageerror = () => { cleanup(); reject(new Error('Message serialization error')) }
        p.start()
        if (payload.attachments?.length) {
          const bufs = payload.attachments.map(a => {
            const bin = atob(a.base64!)
            const arr = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
            return arr.buffer
          })
          p.postMessage({ type: 'bufs', bufs }, bufs)
        }
      }
      ipcRenderer.once(ch, onPortReceived); ipcRenderer.on(chCrashed, onCrash)
      const stripped = { ...payload, attachments: payload.attachments?.map(({ base64: _, ...r }) => r) }
      ipcRenderer.invoke('api:stream', stripped).catch((e) => { cleanup(); reject(e) })
    })
  },

   
  stopStream: (threadId: string): void => {
    const st = activeStreams.get(threadId)
    if (st) { st.port.postMessage('abort'); activeStreams.delete(threadId); st.abort() }
  },

   
  injectToStream: (threadId: string, text: string): void => {
    const st = activeStreams.get(threadId)
    if (st) st.port.postMessage({ type: 'inject', text })
  },

  respondToApproval: (threadId: string, response: { approved: boolean; remember?: boolean }): void => {
    const st = activeStreams.get(threadId)
    if (st) st.port.postMessage({ type: 'approval_response', ...response })
  },

   
  on: (channel: string, cb: (data: unknown) => void): (() => void) => {
    if (!(PUSH_CHANNELS as readonly string[]).includes(channel)) throw new Error(`IPC subscription denied for channel: ${channel}`)
    const listener = (_: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  onTerminalPort: (id: string): void => {
    ipcRenderer.once(`terminal:port:${id}`, (ev) => {
      const p = ev.ports[0]
      if (p) window.postMessage({ type: 'terminal-port-transfer', id }, window.location.origin === 'null' ? '*' : (window.location.origin || '*'), [p])
    })
  },

   
  platform: process.platform as 'darwin' | 'win32' | 'linux'
})
