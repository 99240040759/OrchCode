import { contextBridge, ipcRenderer } from 'electron'

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
      // Register for the port BEFORE invoking, to avoid any race
      ipcRenderer.once('stream:port', (event) => {
        const port = event.ports[0]
        port.onmessage = (e: MessageEvent<StreamChunk>) => {
          try {
            onChunk(e.data)
            if (e.data.type === 'finish' || e.data.type === 'error') {
              port.close()
            }
          } catch {}
        }
        port.onmessageerror = () => resolve()
        // The port closes when main calls port.close() at stream end
        port.start()
        resolve()
      })
      ipcRenderer.invoke('api:stream', payload).catch(reject)
    })
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
