import 'dotenv/config'
import { ipcMain } from 'electron'
import log from 'electron-log'
import { getAvailableModels } from './agent/models'
import { handleAgentStreamRequest, activeAbortControllers } from './agent/stream'
import { listArtifacts } from './agent/artifacts'
import { updateThreadTitle } from './db'
import { getCurrentSession } from './auth'
import { z } from 'zod'

const AttachmentSchema = z.object({
  type: z.enum(['image', 'document']),
  name: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional(),
  base64: z.string().max(14_000_000)
})

const StreamRequestSchema = z.object({
  promptText: z.string().max(200_000),
  threadId: z.string().regex(/^[a-zA-Z0-9-_]+$/),
  mode: z.string().max(50).optional(),
  modelType: z.string().max(255).optional(),
  attachments: z.array(AttachmentSchema).max(8).optional()
})

export function registerAgentIpc() {
  ipcMain.handle(
    'agent:stream-request',
    async (
      event,
      promptText: string,
      threadId: string,
      _mode: string | undefined, // reserved, currently unused
      modelType?: string,
      attachments?: Array<{
        type: 'image' | 'document'
        name: string
        mimeType?: string
        base64: string
      }>
    ) => {
      const session = getCurrentSession()
      if (!session) throw new Error('Unauthorized: Please sign in to use agents.')
      const request = StreamRequestSchema.parse({
        promptText,
        threadId,
        mode: _mode,
        modelType,
        attachments
      })
      const totalAttachmentBytes = (request.attachments ?? []).reduce(
        (total, attachment) => total + Math.ceil((attachment.base64.length * 3) / 4),
        0
      )
      if (totalAttachmentBytes > 25 * 1024 * 1024) {
        throw new Error('Attachments exceed the 25 MB total limit.')
      }
      return handleAgentStreamRequest(
        event,
        request.promptText,
        request.threadId,
        request.modelType,
        request.attachments
      )
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
          Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
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
