import 'dotenv/config'
import { ipcMain } from 'electron'
import log from 'electron-log'
import { getAvailableModels } from './agent/models'
import { handleAgentStreamRequest, activeAbortControllers } from './agent/stream'
import { listArtifacts } from './agent/artifacts'
import { updateThreadTitle } from './db'
import { getCurrentSession } from './auth'

export function registerAgentIpc() {
  ipcMain.handle(
    'agent:stream-request',
    async (
      event,
      promptText: string,
      threadId: string,
      _mode: string | undefined, // reserved, currently unused
      modelType?: string,
      attachments?: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }>
    ) => {
      const session = getCurrentSession()
      if (!session) throw new Error('Unauthorized: Please sign in to use agents.')
      return handleAgentStreamRequest(event, promptText, threadId, modelType, attachments)
    }
  )

  ipcMain.handle('agent:stream-stop', (_event, threadId?: string) => {
    if (threadId) {
      const controller = activeAbortControllers.get(threadId)
      if (controller) {
        controller.abort()
        activeAbortControllers.delete(threadId)
      }
    } else {
      activeAbortControllers.forEach((c) => c.abort())
      activeAbortControllers.clear()
    }
  })

  ipcMain.handle('artifacts:list', async (_event, conversationId: string) => {
    return listArtifacts(conversationId)
  })

  ipcMain.handle('models:get-available', async () => {
    return getAvailableModels()
  })

  ipcMain.handle('mastra:generate-title', async (_event, { text, threadId }) => {
    try {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/generate-title`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      })
      if (!response.ok) {
        throw new Error(`Failed to generate title: ${response.statusText}`)
      }
      const data = await response.json()
      const title = data.title?.trim() ?? null
      if (title) await updateThreadTitle(threadId, title)
      return title
    } catch (err) {
      log.error('[main] Title generation error:', err)
      return null
    }
  })
}
