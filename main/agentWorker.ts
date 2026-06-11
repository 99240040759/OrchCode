import { randomUUID } from 'node:crypto'
import { handleAgentStreamRequest } from './streamWorker'
import { setDBPort } from './db'
import log from 'electron-log'

const proc = process as any
const pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>()

export function callMainProcessTool(toolName: string, args: any, threadId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    pendingRequests.set(requestId, { resolve, reject })
    proc.parentPort.postMessage({ type: 'tool-request', requestId, toolName, args, threadId })
  })
}
;(globalThis as any).callMainProcessTool = callMainProcessTool

type StreamIpcMessage =
  | { type: 'start-stream'; threadId: string; modelType?: string; attachments?: any[]; promptText?: string; token?: string; isBrowserActive?: boolean }
  | { type: 'tool-response'; requestId: string; result?: any; error?: any }
  | { type: 'update-token'; token: string }
  | { type: 'db-port' }

proc.parentPort.on('message', async (e: { data: StreamIpcMessage; ports: Electron.MessagePortMain[] }) => {
  const msg = e.data
  if ('token' in msg && msg.token) process.env.SUPABASE_SESSION_TOKEN = msg.token
  if (msg.type === 'db-port') {
    const [port] = e.ports
    if (port) setDBPort(port)
  } else if (msg.type === 'start-stream') {
    const { threadId, modelType, attachments, promptText, isBrowserActive, startTime } = msg as any
    const [port] = e.ports
    if (!port) return
    log.info(`[agentWorker] Starting stream for thread: ${threadId}`)
    try {
      await handleAgentStreamRequest(port, threadId, modelType, attachments, promptText, isBrowserActive, startTime)
      proc.parentPort.postMessage({ type: 'stream-finished', threadId })
    } catch (err: any) {
      log.error(`[agentWorker] Stream error for thread ${threadId}:`, err)
      if (err?.name !== 'AbortError') {
        proc.parentPort.postMessage({ type: 'stream-finished', threadId, error: { message: err?.message || String(err), stack: err?.stack, name: err?.name } })
      } else {
        proc.parentPort.postMessage({ type: 'stream-finished', threadId })
      }
    }
  } else if (msg.type === 'tool-response') {
    const { requestId, result, error } = msg
    const pending = pendingRequests.get(requestId)
    if (pending) {
      pendingRequests.delete(requestId)
      if (error) pending.reject(new Error(error))
      else pending.resolve(result)
    }
  }
})
