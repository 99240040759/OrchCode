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
      const ch = `stream:port:${payload.threadId}`
      ipcRenderer.once(ch, (ev) => {
        const p = ev.ports[0]; if (!p) return reject(new Error('No port'))
        activePorts.set(payload.threadId, p)
        p.onmessage = (e) => {
          try { onChunk(e.data); if (['finish', 'error'].includes(e.data.type)) { p.close(); activePorts.delete(payload.threadId); resolve() } }
          catch { activePorts.delete(payload.threadId); resolve() }
        }
        p.onmessageerror = () => { activePorts.delete(payload.threadId); resolve() }
        p.start()
        if (payload.attachments?.length) {
          const bufs = payload.attachments.map(a => Uint8Array.from(atob(a.base64), c => c.charCodeAt(0)).buffer)
          p.postMessage({ type: 'bufs', bufs }, bufs)
        }
      })
      const stripped = { ...payload, attachments: payload.attachments?.map(({ base64: _, ...r }) => r) }
      ipcRenderer.invoke('api:stream', stripped).catch((e) => { ipcRenderer.removeAllListeners(ch); reject(e) })
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
    const listener = (_: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  /** The platform string — exposed synchronously at bridge creation time. */
  platform: process.platform as 'darwin' | 'win32' | 'linux'
})
