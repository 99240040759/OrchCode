import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import { z } from 'zod'
import { getOrCreateWorkspaceContext, clearWorkspaceContext, updateWorkspacePath } from './workspace'
import {
  updateThreadTitle, getActiveThreadId, getThread, getThreads, setActiveThreadId,
  getThreadMessages, deleteThread, getThreadWorkspace
} from './db'
import { parseAssistantMessageData, parseUserMessageData, serializeMessageData } from './schema'
import { getAvailableModels } from './models'
import { activeAbortControllers } from './stream'
import { listArtifacts } from './artifacts'
import { getConversationPath } from './paths'
import { getCurrentSession } from './auth'
import { pool } from './workerPool'
import { cleanupPtysForThread } from './terminalCommands'

const threadIdSchema = z.string().min(1).max(256).regex(/^[a-zA-Z0-9-_]+$/, 'Invalid format')
export const convIdSchema = z.string().min(1).max(256)

export const threadCommands = {
  'agent:stop': {
    schema: z.object({ threadId: threadIdSchema.optional() }),
    execute: ({ threadId }: any) => {
      if (threadId) {
        const ctrl = activeAbortControllers.get(threadId)
        if (ctrl) { ctrl.abort(); activeAbortControllers.delete(threadId) }
      } else { activeAbortControllers.forEach(c => c.abort()); activeAbortControllers.clear() }
    }
  },
  'models:list': { schema: z.object({}), execute: () => getAvailableModels() },
  'artifacts:list': { schema: z.object({ conversationId: convIdSchema }), execute: ({ conversationId }: any) => listArtifacts(conversationId) },
  'thread:generate-title': {
    schema: z.object({ text: z.string().max(5000), threadId: threadIdSchema }),
    execute: async ({ text, threadId }: any) => {
      try {
        const session = getCurrentSession(), token = session?.idToken
        if (!token) throw new Error('Unauthenticated: Please sign in to generate titles.')
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')
        const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/generate-title`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        })
        if (!response.ok) throw new Error(`Failed to generate title: ${response.statusText}`)
        const data = await response.json(), title = data.title?.trim() ?? null
        if (title) await updateThreadTitle(threadId, title)
        return title
      } catch (err) { log.error('[commands] Title generation error:', err); throw err }
    }
  },
  'thread:active-id': {
    schema: z.object({}),
    execute: () => {
      const activeId = getActiveThreadId()
      if (activeId && getThread(activeId)) return activeId
      const threads = getThreads()
      return threads?.length ? threads[0].id : ''
    }
  },
  'thread:new': { schema: z.object({}), execute: async () => { const newId = `session-${crypto.randomUUID()}`; await getOrCreateWorkspaceContext(newId); return { conversationId: newId } } },
  'thread:set-active': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }: any) => {
      try { setActiveThreadId(threadId); const wsPath = getThreadWorkspace(threadId); if (wsPath) await updateWorkspacePath(threadId, wsPath) }
      catch (err) { log.warn(`[commands] Auto-bind error for ${threadId}:`, err); throw err }
      return true
    }
  },
  'thread:list': { schema: z.object({}), execute: async () => { try { return await getThreads() } catch (err) { log.error('[commands] getThreads:', err); throw err } } },
  'thread:get': { schema: z.object({ threadId: threadIdSchema }), execute: ({ threadId }: any) => { try { return getThread(threadId) } catch (err) { throw err } } },
  'thread:messages': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: ({ threadId }: any) => {
      try {
        return getThreadMessages(threadId).map((message) => {
          const parsed = message.role === 'assistant' ? parseAssistantMessageData(message.data) : message.role === 'user' ? parseUserMessageData(message.data) : undefined
          return { ...message, data: parsed ? serializeMessageData(parsed) : undefined }
        })
      } catch (err) { log.error('[commands] getThreadMessages:', err); throw err }
    }
  },
  'thread:delete': {
    schema: z.object({ threadId: threadIdSchema }),
    execute: async ({ threadId }: any) => {
      try {
        if (getActiveThreadId() === threadId) setActiveThreadId('')
        const ctrl = activeAbortControllers.get(threadId)
        if (ctrl) { ctrl.abort(); activeAbortControllers.delete(threadId) }
        pool.killJob(`stream:${threadId}`); cleanupPtysForThread(threadId)
        getThreadWorkspace(threadId); clearWorkspaceContext(threadId); const deleted = deleteThread(threadId)
        await fs.rm(getConversationPath(threadId), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        return deleted
      } catch (err) { log.error('[commands] deleteThread:', err); throw err }
    }
  },
  'thread:workspace': { schema: z.object({ threadId: threadIdSchema }), execute: ({ threadId }: any) => { try { return getThreadWorkspace(threadId) } catch (err) { throw err } } }
}
