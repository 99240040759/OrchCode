import { useEffect, useRef, useCallback } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  threadListAtom,
  activeThreadIdAtom,
  conversationIdAtom,
  chatMessagesAtom,
  activeWorkspaceAtom,
  sessionTokensAtom,
  type ChatMessage
} from '../store/agentStore'
import type { ThreadEntry } from '../../../preload/index.d'

export function useThreads() {
  const conversationId = useAtomValue(conversationIdAtom)
  const [threads, setThreads] = useAtom(threadListAtom)
  const [activeThreadId, setActiveThreadId] = useAtom(activeThreadIdAtom)
  const setMessages = useSetAtom(chatMessagesAtom)
  const setConversationId = useSetAtom(conversationIdAtom)
  const setActiveWorkspace = useSetAtom(activeWorkspaceAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)

  const activeRef = useRef<string | null>(activeThreadId)

  useEffect(() => {
    activeRef.current = activeThreadId
  }, [activeThreadId])

  const loadThreads = useCallback(async () => {
    try {
      const data = await window.api.getThreads()
      setThreads(data ?? [])
    } catch (err) {
      console.error('[useThreads] Failed to load threads:', err)
    }
  }, [setThreads])

  const selectThread = async (threadId: string) => {
    setActiveThreadId(threadId)
    setConversationId(threadId)
    setMessages([])
    setSessionTokens(0)

    // Set session first, then immediately bind workspace BEFORE returning control.
    // This prevents any IPC fired between the two calls from getting a default workspace context.
    try {
      await window.api.setActiveSession(threadId)
    } catch (err) {
      console.error('[useThreads] Failed to sync session to backend:', err)
    }

    // Fetch and bind workspace atomically right after session
    try {
      const workspacePath = await window.api.getThreadWorkspace(threadId)
      if (workspacePath) {
        setActiveWorkspace({
          name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace',
          path: workspacePath
        })
        await window.api.setActiveWorkspace(threadId, workspacePath)
      }
    } catch (err) {
      console.error('[useThreads] Failed to bind workspace for thread:', err)
    }

    try {
      const rawMessages = await window.api.getThreadMessages(threadId)
      if (activeRef.current !== threadId) return

      if (rawMessages && rawMessages.length > 0) {
        const chatMsgs: ChatMessage[] = rawMessages
          .filter((m: any) => m.role === 'user' || m.role === 'assistant')
          .map((m: any, idx: number) => ({
            id: m.id ?? `msg-${idx}`,
            role: m.role as 'user' | 'assistant',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            orderedBlocks: m.data ? (() => { try { return JSON.parse(m.data) } catch { return undefined } })() : undefined,
            timestamp: new Date(m.createdAt ?? Date.now()).getTime(),
            isStreaming: false
          }))
        setMessages(chatMsgs)

        const selectedThread = threads.find((t) => t.id === threadId)
        const savedTokens = selectedThread?.accumulatedTokens ?? 0
        setSessionTokens(savedTokens)
      }
    } catch (err) {
      console.error('[useThreads] Failed to load thread messages:', err)
    }
  }


  const newConversation = async () => {
    try {
      const { conversationId: newId } = await window.api.newConversation()
      if (activeWorkspace?.path) {
        await window.api.setActiveWorkspace(newId, activeWorkspace.path)
      }
      setConversationId(newId)
      setActiveThreadId(newId)
      setMessages([])
      setSessionTokens(0)
      // #12 fix: reload thread list so the new thread appears immediately
      await loadThreads()
      return newId
    } catch (err) {
      console.error('[useThreads] New conversation error:', err)
      return null
    }
  }

  const deleteThread = async (threadId: string) => {
    try {
      await window.api.deleteThread(threadId)
      setThreads((prev: ThreadEntry[]) => prev.filter((t) => t.id !== threadId))
      if (activeThreadId === threadId) {
        setActiveThreadId(null)
        setMessages([])
        setSessionTokens(0)
      }
    } catch (err) {
      console.error('[useThreads] Delete thread error:', err)
    }
  }

  const switchWorkspace = async (path: string) => {
    try {
      const ctx = await window.api.setActiveWorkspace(conversationId, path)
      if (ctx) {
        setActiveWorkspace({
          name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace',
          path: ctx.rootPath
        })
        return ctx
      }
      return null
    } catch (err) {
      console.error('[useThreads] Switch workspace error:', err)
      return null
    }
  }

  const closeAndDeleteWorkspace = async (path: string) => {
    try {
      const success = await window.api.closeAndDeleteWorkspace(path)
      if (success) {
        if (activeWorkspace?.path === path) {
          setActiveWorkspace(null)
        }
        await loadThreads()
      }
      return success
    } catch (err) {
      console.error('[useThreads] Close and delete workspace error:', err)
      return false
    }
  }

  const openWorkspace = async () => {
    try {
      const ctx = await window.api.selectWorkspace(conversationId)
      if (ctx) {
        setActiveWorkspace({
          name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace',
          path: ctx.rootPath
        })
        await loadThreads()
        return ctx
      }
      return null
    } catch (err) {
      console.error('[useThreads] Open workspace error:', err)
      return null
    }
  }

  return {
    loadThreads,
    selectThread,
    newConversation,
    deleteThread,
    openWorkspace,
    switchWorkspace,
    closeAndDeleteWorkspace
  }
}
