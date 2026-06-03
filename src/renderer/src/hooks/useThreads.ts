import { useEffect, useRef, useCallback } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  threadListAtom,
  activeThreadIdAtom,
  chatMessagesAtom,
  activeWorkspaceAtom,
  sessionTokensAtom,
  filesChangedAtom,
  isThreadLoadingAtom,
  type ChatMessage
} from '../store/agentStore'
import type { ThreadEntry } from '../../../preload/index.d'

export function useThreads() {
  // activeThreadIdAtom is the single unified ID atom (conversationIdAtom is the same atom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const [threads, setThreads] = useAtom(threadListAtom)
  const setActiveThreadId = useSetAtom(activeThreadIdAtom)
  const setMessages = useSetAtom(chatMessagesAtom)
  const setActiveWorkspace = useSetAtom(activeWorkspaceAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)
  const setFilesChanged = useSetAtom(filesChangedAtom)
  const setIsThreadLoading = useSetAtom(isThreadLoadingAtom)

  // Ref to track the active selection across async calls to cancel stale ones
  const activeRef = useRef<string>('')

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

  const selectThread = useCallback(
    async (threadId: string) => {
      // Reset UI state immediately
      setMessages([])
      setSessionTokens(0)
      setFilesChanged([])
      setIsThreadLoading(true)

      // Track intent — any later stale callback will bail out
      activeRef.current = threadId

      try {
        await window.api.setActiveSession(threadId)
      } catch (err) {
        console.error('[useThreads] Failed to sync session to backend:', err)
      }

      if (activeRef.current !== threadId) return

      try {
        const workspacePath = await window.api.getThreadWorkspace(threadId)
        if (activeRef.current !== threadId) return
        if (workspacePath) {
          setActiveWorkspace({
            name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace',
            path: workspacePath
          })
        }
      } catch (err) {
        console.error('[useThreads] Failed to bind workspace for thread:', err)
      }

      if (activeRef.current !== threadId) return

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
              orderedBlocks: m.data
                ? (() => {
                    try {
                      return JSON.parse(m.data)
                    } catch {
                      return undefined
                    }
                  })()
                : undefined,
              timestamp: new Date(m.createdAt ?? Date.now()).getTime(),
              isStreaming: false
            }))
          setMessages(chatMsgs)
        }

        // Fetch fresh token count from DB — don't use stale atom
        try {
          const freshThread = await window.api.getThread(threadId)
          if (freshThread && activeRef.current === threadId) {
            setSessionTokens(freshThread.accumulatedTokens ?? 0)
          }
        } catch {
          // Fall back to thread list atom if getThread fails
          const selectedThread = threads.find((t) => t.id === threadId)
          setSessionTokens(selectedThread?.accumulatedTokens ?? 0)
        }
      } catch (err) {
        console.error('[useThreads] Failed to load thread messages:', err)
      }

      // Update the active thread ID only after everything is loaded
      if (activeRef.current === threadId) {
        setActiveThreadId(threadId)
      }

      setIsThreadLoading(false)
    },
    [
      setActiveThreadId,
      setMessages,
      setSessionTokens,
      setFilesChanged,
      setIsThreadLoading,
      setActiveWorkspace,
      threads
    ]
  )

  const newConversation = useCallback(async () => {
    try {
      const { conversationId: newId } = await window.api.newConversation()
      if (activeWorkspace?.path) {
        await window.api.setActiveWorkspace(newId, activeWorkspace.path)
      }
      // Update atom immediately since we have the exact ID
      setActiveThreadId(newId)
      setMessages([])
      setSessionTokens(0)
      setFilesChanged([])
      await loadThreads()
      return newId
    } catch (err) {
      console.error('[useThreads] New conversation error:', err)
      return null
    }
  }, [
    activeWorkspace,
    setActiveThreadId,
    setMessages,
    setSessionTokens,
    setFilesChanged,
    loadThreads
  ])

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await window.api.deleteThread(threadId)
        setThreads((prev: ThreadEntry[]) => prev.filter((t) => t.id !== threadId))
        if (activeThreadId === threadId) {
          setActiveThreadId('')
          setMessages([])
          setSessionTokens(0)
        }
      } catch (err) {
        console.error('[useThreads] Delete thread error:', err)
      }
    },
    [activeThreadId, setThreads, setActiveThreadId, setMessages, setSessionTokens]
  )

  const switchWorkspace = useCallback(
    async (path: string) => {
      try {
        const ctx = await window.api.setActiveWorkspace(activeThreadId, path)
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
    },
    [activeThreadId, setActiveWorkspace]
  )

  const closeAndDeleteWorkspace = useCallback(
    async (path: string) => {
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
    },
    [activeWorkspace, setActiveWorkspace, loadThreads]
  )

  const openWorkspace = useCallback(async () => {
    try {
      const ctx = await window.api.selectWorkspace(activeThreadId)
      if (ctx) {
        await window.api.setActiveWorkspace(activeThreadId, ctx.rootPath)
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
  }, [activeThreadId, setActiveWorkspace, loadThreads])

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
