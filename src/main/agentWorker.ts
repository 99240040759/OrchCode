import { handleAgentStreamRequest } from './agent/stream'
import log from 'electron-log'
const proc = process as any
const pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>()
export function callMainProcessTool(toolName: string, args: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(2)
    pendingRequests.set(requestId, { resolve, reject })
    proc.parentPort.postMessage({ type: 'tool-request', requestId, toolName, args })
  })
}
proc.parentPort.on('message', async (e: any) => {
  const { type, threadId, modelType, attachments, promptText, token, isBrowserActive } = e.data
  if (token) process.env.SUPABASE_SESSION_TOKEN = token
  if (type === 'start-stream') {
    const [port] = e.ports
    if (!port) return
    log.info(`[agentWorker] Starting stream for thread: ${threadId}`)
    try {
      await handleAgentStreamRequest(port, threadId, modelType, attachments, promptText, isBrowserActive)
      proc.parentPort.postMessage({ type: 'stream-finished', threadId })
    } catch (err: any) {
      log.error(`[agentWorker] Stream error for thread ${threadId}:`, err)
      proc.parentPort.postMessage({ type: 'stream-finished', threadId, error: err.message })
    }
  } else if (type === 'tool-response') {
    const { requestId, result, error } = e.data
    const pending = pendingRequests.get(requestId)
    if (pending) {
      pendingRequests.delete(requestId)
      if (error) pending.reject(new Error(error))
      else pending.resolve(result)
    }
  }
})
