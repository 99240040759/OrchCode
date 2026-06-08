import { contextBridge, ipcRenderer } from 'electron'

const activePorts = new Map<string, MessagePort>()

// ─── Types ────────────────────────────────────────────────────────────────────
// Shared with renderer via window.api

export type StreamChunk = {
  type: string
  payload?: unknown
  threadId?: string
}

export type StreamPayload = {
  promptText: string
  threadId: string
  modelType?: string
  attachments?: Array<{
    type: 'image' | 'document'
    name: string
    mimeType?: string
    base64: string
  }>
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('api', {
  /**
   * Send a named command to the main process with a validated payload.
   * All IPC is funneled through a single ipcMain.handle('api:invoke') router.
   */
  invoke: (command: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('api:invoke', { command, payload }),

  /**
   * Start an agent stream. Main will:
   *   1. Create a MessageChannelMain
   *   2. postMessage port2 back to us on 'stream:port'
   *   3. Begin streaming chunks through port1
   * We capture port2, attach onChunk, and return when the port closes.
   */
  stream: (payload: StreamPayload, onChunk: (chunk: StreamChunk) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ch = `stream:port:${payload.threadId}`, chCrashed = 'stream:worker-crashed'
      const cleanup = () => {
        ipcRenderer.off(ch, onPortReceived); ipcRenderer.off(chCrashed, onCrash)
        const p = activePorts.get(payload.threadId); if (p) { p.close(); activePorts.delete(payload.threadId) }
      }
      const onCrash = (_ev: unknown, data: any) => {
        if (data && data.threadId === payload.threadId) {
          cleanup()
          reject(new Error(`Utility worker process crashed (Exit code: ${data.code ?? 'unknown'})`))
        }
      }
      const onPortReceived = (ev: Electron.IpcRendererEvent) => {
        const p = ev.ports[0]; if (!p) { cleanup(); return reject(new Error('No port')) }
        activePorts.set(payload.threadId, p)
        p.onmessage = (e) => {
          try {
            onChunk(e.data)
            if (['finish', 'error'].includes(e.data.type)) { cleanup(); resolve() }
          } catch (err) { cleanup(); reject(err instanceof Error ? err : new Error(String(err))) }
        }
        p.onmessageerror = () => { cleanup(); reject(new Error('Message serialization error')) }
        p.start()
        if (payload.attachments?.length) {
          try {
            const bufs = payload.attachments.map(a => {
              const bin = atob(a.base64 || '')
              const arr = new Uint8Array(bin.length)
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
              return arr.buffer
            })
            p.postMessage({ type: 'bufs', bufs }, bufs)
          } catch (err: any) { cleanup(); reject(new Error(`Failed to decode attachments: ${err.message}`)) }
        }
      }
      ipcRenderer.once(ch, onPortReceived); ipcRenderer.on(chCrashed, onCrash)
      const stripped = { ...payload, attachments: payload.attachments?.map(({ base64: _, ...r }) => r) }
      ipcRenderer.invoke('api:stream', stripped).catch((e) => { cleanup(); reject(e) })
    })
  },

  /** Send abort signal on MessagePort to halt the stream session. */
  stopStream: (threadId: string): void => {
    const p = activePorts.get(threadId)
    if (p) { p.postMessage('abort'); p.close(); activePorts.delete(threadId) }
  },

  /**
   * Subscribe to push events emitted from main (e.g. terminal:data, browser:title-updated).
   * Returns an unsubscribe function.
   */
  on: (channel: string, cb: (data: unknown) => void): (() => void) => {
    const ALLOWED = ['auth:status-changed', 'terminal:data', 'terminal:exit', 'browser:title-updated', 'browser:url-changed', 'artifacts:changed', 'updater:status-changed', 'stream:worker-crashed', 'command:new-conversation', 'command:open-workspace']
    if (!ALLOWED.includes(channel)) throw new Error(`IPC subscription denied for channel: ${channel}`)
    const listener = (_: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  /** The platform string — exposed synchronously at bridge creation time. */
  platform: process.platform as 'darwin' | 'win32' | 'linux'
})
