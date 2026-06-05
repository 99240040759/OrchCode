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
  openFilesAtom,
  activeEditorFileAtom,
  artifactsAtom,
  artifactPanelModeAtom,
  agentRunStateAtom,
  type ChatMessage,
  type StreamBlock
} from '../store/agentStore'
import type { ThreadEntry, ThreadMessage } from '../../../preload/index.d'

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
  const setOpenFiles = useSetAtom(openFilesAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifacts = useSetAtom(artifactsAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const setAgentRunState = useSetAtom(agentRunStateAtom)

  const resetThreadScopedPanels = useCallback(() => {
    setFilesChanged([])
    setOpenFiles([])
    setActiveEditorFile(null)
    setArtifacts([])
    setArtifactPanelMode('overview')
  }, [setFilesChanged, setOpenFiles, setActiveEditorFile, setArtifacts, setArtifactPanelMode])

  // Ref to track the active selection across async calls to cancel stale ones
  const activeRef = useRef<string>('')

  useEffect(() => {
    activeRef.current = activeThreadId
  }, [activeThreadId])

  const loadThreads = useCallback(async () => {
    try {
      const data = await window.threadsBridge.getThreads()
      setThreads(data ?? [])
    } catch (err) {
      console.error('[useThreads] Failed to load threads:', err)
    }
  }, [setThreads])

  const selectThread = useCallback(
    async (threadId: string) => {
      if (!threadId) return
      // Always reset run state — prevents spinner getting stuck if previous thread
      // was still in 'thinking'/'streaming' when the switch happened
      setAgentRunState('idle')
      if (activeThreadId && activeThreadId !== threadId) {
        await window.agentBridge.stopAgentStream(activeThreadId).catch(() => {})
      }

      // Reset UI state immediately
      setMessages([])
      setSessionTokens(0)
      resetThreadScopedPanels()

      // Track intent — any later stale callback will bail out
      activeRef.current = threadId

      // Debounce the loading overlay: only show spinner if loading takes > 200ms
      // This prevents a rapid flash/stutter on fast thread switches
      let loadingTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (activeRef.current === threadId) setIsThreadLoading(true)
        loadingTimer = null
      }, 200)

      const clearTimer = () => {
        if (loadingTimer !== null) {
          clearTimeout(loadingTimer)
          loadingTimer = null
        }
      }

      try {
        await window.threadsBridge.setActiveSession(threadId)
      } catch (err) {
        console.error('[useThreads] Failed to sync session to backend:', err)
      }

      if (activeRef.current !== threadId) {
        clearTimer()
        setIsThreadLoading(false)
        return
      }

      try {
        const workspacePath = await window.threadsBridge.getThreadWorkspace(threadId)
        if (activeRef.current !== threadId) {
          clearTimer()
          setIsThreadLoading(false)
          return
        }
        if (workspacePath) {
          setActiveWorkspace({
            name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace',
            path: workspacePath
          })
        } else {
          setActiveWorkspace(null)
        }
      } catch (err) {
        console.error('[useThreads] Failed to bind workspace for thread:', err)
        setActiveWorkspace(null)
      }

      if (activeRef.current !== threadId) {
        clearTimer()
        setIsThreadLoading(false)
        return
      }

      try {
        const rawMessages = await window.threadsBridge.getThreadMessages(threadId)

        if (activeRef.current !== threadId) {
          clearTimer()
          setIsThreadLoading(false)
          return
        }

        if (rawMessages && rawMessages.length > 0) {
          const chatMsgs: ChatMessage[] = rawMessages
            .filter(
              (m): m is ThreadMessage & { role: 'user' | 'assistant' } =>
                m.role === 'user' || m.role === 'assistant'
            )
            .map((m, idx: number) => ({
              id: m.id ?? `msg-${idx}`,
              role: m.role as 'user' | 'assistant',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              orderedBlocks: m.data
                ? (() => {
                    try {
                      const parsed: unknown = JSON.parse(m.data)
                      return Array.isArray(parsed) ? (parsed as StreamBlock[]) : undefined
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
          const freshThread = await window.threadsBridge.getThread(threadId)
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

      // Cancel timer (loading finished before the debounce delay fired)
      clearTimer()

      // Update the active thread ID and clear loading in the same commit
      if (activeRef.current === threadId) {
        setActiveThreadId(threadId)
        setIsThreadLoading(false)
      }
    },
    [
      setActiveThreadId,
      setMessages,
      setSessionTokens,
      resetThreadScopedPanels,
      setIsThreadLoading,
      setActiveWorkspace,
      activeThreadId,
      setAgentRunState,
      threads
    ]
  )

  const newConversation = useCallback(async () => {
    try {
      const { conversationId: newId } = await window.threadsBridge.newConversation()
      if (activeThreadId) await window.agentBridge.stopAgentStream(activeThreadId).catch(() => {})
      setAgentRunState('idle')
      if (activeWorkspace?.path) {
        await window.workspaceBridge.setActiveWorkspace(newId, activeWorkspace.path)
      }
      // Update atom immediately since we have the exact ID
      setActiveThreadId(newId)
      setMessages([])
      setSessionTokens(0)
      resetThreadScopedPanels()
      await loadThreads()
      return newId
    } catch (err) {
      console.error('[useThreads] New conversation error:', err)
      return null
    }
  }, [
    activeWorkspace,
    activeThreadId,
    setActiveThreadId,
    setMessages,
    setSessionTokens,
    resetThreadScopedPanels,
    setAgentRunState,
    loadThreads
  ])

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await window.threadsBridge.deleteThread(threadId)
        setThreads((prev: ThreadEntry[]) => prev.filter((t) => t.id !== threadId))
        if (activeThreadId === threadId) {
          await window.agentBridge.stopAgentStream(threadId).catch(() => {})
          setAgentRunState('idle')
          setActiveThreadId('')
          setMessages([])
          setSessionTokens(0)
          setActiveWorkspace(null)
          resetThreadScopedPanels()
        }
      } catch (err) {
        console.error('[useThreads] Delete thread error:', err)
      }
    },
    [
      activeThreadId,
      setThreads,
      setActiveThreadId,
      setMessages,
      setSessionTokens,
      setActiveWorkspace,
      resetThreadScopedPanels,
      setAgentRunState
    ]
  )

  const switchWorkspace = useCallback(
    async (path: string) => {
      try {
        let currentId = activeThreadId
        if (!currentId) {
          const newId = await newConversation()
          if (!newId) return null
          currentId = newId
        }
        const ctx = await window.workspaceBridge.setActiveWorkspace(currentId, path)
        if (ctx) {
          resetThreadScopedPanels()
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
    [activeThreadId, newConversation, setActiveWorkspace, resetThreadScopedPanels]
  )

  const closeAndDeleteWorkspace = useCallback(
    async (path: string) => {
      try {
        const success = await window.workspaceBridge.closeAndDeleteWorkspace(path)
        if (success) {
          if (activeWorkspace?.path === path) {
            if (activeThreadId) {
              await window.agentBridge.stopAgentStream(activeThreadId).catch(() => {})
            }
            setAgentRunState('idle')
            setActiveWorkspace(null)
            setActiveThreadId('')
            setMessages([])
            setSessionTokens(0)
            resetThreadScopedPanels()
          }
          await loadThreads()
        }
        return success
      } catch (err) {
        console.error('[useThreads] Close and delete workspace error:', err)
        return false
      }
    },
    [
      activeWorkspace,
      setActiveWorkspace,
      loadThreads,
      setActiveThreadId,
      setMessages,
      setSessionTokens,
      resetThreadScopedPanels,
      activeThreadId,
      setAgentRunState
    ]
  )

  const openWorkspace = useCallback(async () => {
    try {
      let currentId = activeThreadId
      if (!currentId) {
        const newId = await newConversation()
        if (!newId) return null
        currentId = newId
      }
      const ctx = await window.workspaceBridge.selectWorkspace(currentId)
      if (ctx) {
        resetThreadScopedPanels()
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
  }, [activeThreadId, newConversation, setActiveWorkspace, loadThreads, resetThreadScopedPanels])

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
