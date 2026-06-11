import log from 'electron-log'
import { captureException } from '@sentry/electron/main'
import { z } from 'zod'
import WindowManager, { pushArtifactsChanged } from './utils'
import { pool } from './workerPool'
import { getCurrentSession } from './auth'
import { browserTools } from './tools'
import * as db from './db'
import { getWorkspaceContext, invalidateWorkspaceFilesCache } from './workspace'

const StreamRequestSchema = z.object({
  promptText: z.string().max(200_000),
  threadId: z.string().regex(/^[a-zA-Z0-9-_]+$/),
  modelType: z.string().max(255).optional(),
  startTime: z.number().optional(),
  attachments: z.array(z.object({
    type: z.enum(['image', 'document']),
    name: z.string().min(1).max(255),
    mimeType: z.string().max(255).optional(),
    base64: z.string().max(14_000_000).optional()
  })).max(8).optional()
})

export function registerStreamIpc() {
  const { ipcMain, MessageChannelMain } = require('electron')
  ipcMain.handle('api:stream', async (event: any, rawPayload: any) => {
    try {
      const session = getCurrentSession()
      if (!session) throw new Error('Unauthorized: Please sign in to use agents.')
      const request = StreamRequestSchema.parse(rawPayload ?? {})

      const { port1, port2 } = new MessageChannelMain()
      event.sender.postMessage(`stream:port:${request.threadId}`, { threadId: request.threadId }, [port2])

      const worker = pool.allocateWorker(session.idToken, `stream:${request.threadId}`)
      worker.removeAllListeners('message'); worker.removeAllListeners('exit')
      const { port1: dbPort1, port2: dbPort2 } = new MessageChannelMain()
      db.shareDBPort(dbPort1)
      worker.postMessage({ type: 'db-port' }, [dbPort2])
      const win = WindowManager.getMainWindow()
      if (win && !win.isDestroyed()) win.setProgressBar(2)

      const onExit = (code: number | null) => {
        pool.clearJob(worker)
        worker.off('message', onMsg)
        const w = WindowManager.getMainWindow()
        if (w && !w.isDestroyed()) {
          w.setProgressBar(-1)
          w.webContents.send('stream:worker-crashed', { threadId: request.threadId, code })
        }
      }
      worker.once('exit', onExit)

      const onMsg = (msg: any) => {
        if (msg?.type === 'artifacts-changed') {
          try { const ctx = getWorkspaceContext(request.threadId); if (ctx?.rootPath) invalidateWorkspaceFilesCache(ctx.rootPath) } catch (e) { log.debug('[stream] Cache invalidation error:', e) }
          pushArtifactsChanged(msg.threadId)
        }
        if (msg?.type === 'tool-request' && msg.threadId === request.threadId) {
          const { requestId, toolName, args } = msg
          const t = browserTools(request.threadId, true)[toolName]
          if (t) {
            t.execute(args).then((res: any) => {
              worker.postMessage({ type: 'tool-response', requestId, result: res })
            }).catch((err: any) => worker.postMessage({ type: 'tool-response', requestId, error: err.message }))
          } else {
            worker.postMessage({ type: 'tool-response', requestId, error: `Tool ${toolName} not found on Main` })
          }
        }
        if (msg?.type === 'stream-finished' && msg.threadId === request.threadId) {
          pool.clearJob(worker)
          worker.off('message', onMsg)
          worker.off('exit', onExit)
          const w = WindowManager.getMainWindow()
          if (w && !w.isDestroyed()) w.setProgressBar(-1)
          if (msg.error) {
            const errObj = typeof msg.error === 'string' ? { message: msg.error } : msg.error
            const remoteError = new Error(errObj.message)
            remoteError.name = errObj.name || 'AgentWorkerError'
            if (errObj.stack) remoteError.stack = errObj.stack
            captureException(remoteError)
          }
        }
      }
      worker.on('message', onMsg)
      worker.postMessage(
        { type: 'start-stream', threadId: request.threadId, modelType: request.modelType, attachments: request.attachments, promptText: request.promptText, token: session.idToken, isBrowserActive: !!WindowManager.getBrowserView(), startTime: request.startTime },
        [port1]
      )
      return { ok: true }
    } catch (err) {
      const win = WindowManager.getMainWindow()
      if (win && !win.isDestroyed()) win.setProgressBar(-1)
      if (rawPayload?.threadId) {
        try { pool.killJob(`stream:${rawPayload.threadId}`) } catch (killErr) { log.debug('[stream] Error killing job:', killErr) }
      }
      log.error('[stream IPC Error]:', err)
      captureException(err)
      const e = new Error(err instanceof Error ? err.message : String(err))
      e.name = err instanceof Error ? err.name : 'Error'
      e.stack = err instanceof Error ? err.stack : undefined
      throw e
    }
  })
}
