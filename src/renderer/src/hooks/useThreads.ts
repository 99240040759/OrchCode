import { useEffect, useRef, useCallback } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  threadListAtom,
  activeThreadIdAtom,
  chatMessagesAtom,
  activeWorkspaceAtom,
  sessionTokensAtom,
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

const invoke = <T>(command: string, payload?: unknown): Promise<T> =>
  window.api.invoke(command, payload) as Promise<T>

export function useThreads() {
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const [threads, setThreads] = useAtom(threadListAtom)
  const setActiveThreadId = useSetAtom(activeThreadIdAtom)
  const setMessages = useSetAtom(chatMessagesAtom)
  const setActiveWorkspace = useSetAtom(activeWorkspaceAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)
  const setIsThreadLoading = useSetAtom(isThreadLoadingAtom)
  const setOpenFiles = useSetAtom(openFilesAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifacts = useSetAtom(artifactsAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const setAgentRunState = useSetAtom(agentRunStateAtom)

  const resetThreadScopedPanels = useCallback(() => {
    setOpenFiles([])
    setActiveEditorFile(null)
    setArtifacts([])
    setArtifactPanelMode('overview')
  }, [setOpenFiles, setActiveEditorFile, setArtifacts, setArtifactPanelMode])

  const activeRef = useRef<string>('')

  useEffect(() => {
    activeRef.current = activeThreadId
  }, [activeThreadId])

  const loadThreads = useCallback(async () => {
    try {
      const data = await invoke<ThreadEntry[]>('thread:list')
      setThreads(data ?? [])
    } catch (err) {
      console.error('[useThreads] Failed to load threads:', err)
    }
  }, [setThreads])

  const selectThread = useCallback(
    async (threadId: string) => {
      if (!threadId) return
      setAgentRunState('idle')
      if (activeThreadId && activeThreadId !== threadId) {
        await window.api.invoke('agent:stop', { threadId: activeThreadId }).catch(() => {})
      }

      setMessages([])
      setSessionTokens(0)
      resetThreadScopedPanels()

      activeRef.current = threadId

      let loadingTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (activeRef.current === threadId) setIsThreadLoading(true)
        loadingTimer = null
      }, 200)

      const clearTimer = () => {
        if (loadingTimer !== null) { clearTimeout(loadingTimer); loadingTimer = null }
      }

      try {
        await invoke('thread:set-active', { threadId })
      } catch (err) {
        console.error('[useThreads] Failed to sync session to backend:', err)
      }

      if (activeRef.current !== threadId) { clearTimer(); setIsThreadLoading(false); return }

      try {
        const workspacePath = await invoke<string | null>('thread:workspace', { threadId })
        if (activeRef.current !== threadId) { clearTimer(); setIsThreadLoading(false); return }
        if (workspacePath) {
          setActiveWorkspace({ name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace', path: workspacePath })
        } else {
          setActiveWorkspace(null)
        }
      } catch (err) {
        console.error('[useThreads] Failed to bind workspace for thread:', err)
        setActiveWorkspace(null)
      }

      if (activeRef.current !== threadId) { clearTimer(); setIsThreadLoading(false); return }

      try {
        const rawMessages = await invoke<ThreadMessage[]>('thread:messages', { threadId })

        if (activeRef.current !== threadId) { clearTimer(); setIsThreadLoading(false); return }

        if (rawMessages?.length > 0) {
          const chatMsgs: ChatMessage[] = rawMessages
            .filter((m): m is ThreadMessage & { role: 'user' | 'assistant' } =>
              m.role === 'user' || m.role === 'assistant'
            )
            .map((m, idx) => ({
              id: m.id ?? `msg-${idx}`,
              role: m.role as 'user' | 'assistant',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              orderedBlocks: m.data
                ? (() => { try { const p: unknown = JSON.parse(m.data); return Array.isArray(p) ? (p as StreamBlock[]) : undefined } catch { return undefined } })()
                : undefined,
              timestamp: new Date(m.createdAt ?? Date.now()).getTime(),
              isStreaming: false
            }))
          setMessages(chatMsgs)
        }

        try {
          const freshThread = await invoke<(ThreadEntry & { workspacePath?: string | null }) | null>('thread:get', { threadId })
          if (freshThread && activeRef.current === threadId) {
            setSessionTokens(freshThread.accumulatedTokens ?? 0)
          }
        } catch {
          const selectedThread = threads.find((t) => t.id === threadId)
          setSessionTokens(selectedThread?.accumulatedTokens ?? 0)
        }
      } catch (err) {
        console.error('[useThreads] Failed to load thread messages:', err)
      }

      clearTimer()
      if (activeRef.current === threadId) {
        setActiveThreadId(threadId)
        setIsThreadLoading(false)
      }
    },
    [setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, setIsThreadLoading, setActiveWorkspace, activeThreadId, setAgentRunState, threads]
  )

  const newConversation = useCallback(async () => {
    try {
      const { conversationId: newId } = await invoke<{ conversationId: string }>('thread:new')
      if (activeThreadId) await window.api.invoke('agent:stop', { threadId: activeThreadId }).catch(() => {})
      setAgentRunState('idle')
      if (activeWorkspace?.path) {
        await invoke('workspace:set-active', { conversationId: newId, workspacePath: activeWorkspace.path })
      }
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
  }, [activeWorkspace, activeThreadId, setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, setAgentRunState, loadThreads])

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await invoke('thread:delete', { threadId })
        setThreads((prev: ThreadEntry[]) => prev.filter((t) => t.id !== threadId))
        if (activeThreadId === threadId) {
          await window.api.invoke('agent:stop', { threadId }).catch(() => {})
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
    [activeThreadId, setThreads, setActiveThreadId, setMessages, setSessionTokens, setActiveWorkspace, resetThreadScopedPanels, setAgentRunState]
  )

  const switchWorkspace = useCallback(
    async (path: string) => {
      try {
        let currentId = activeThreadId
        if (!currentId) { const newId = await newConversation(); if (!newId) return null; currentId = newId }
        const ctx = await invoke<{ rootPath: string }>('workspace:set-active', { conversationId: currentId, workspacePath: path })
        if (ctx) {
          resetThreadScopedPanels()
          setActiveWorkspace({ name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace', path: ctx.rootPath })
          return ctx
        }
        return null
      } catch (err) { console.error('[useThreads] Switch workspace error:', err); return null }
    },
    [activeThreadId, newConversation, setActiveWorkspace, resetThreadScopedPanels]
  )

  const closeAndDeleteWorkspace = useCallback(
    async (path: string) => {
      try {
        const success = await invoke<boolean>('workspace:close-and-delete', { workspacePath: path })
        if (success) {
          if (activeWorkspace?.path === path) {
            if (activeThreadId) await window.api.invoke('agent:stop', { threadId: activeThreadId }).catch(() => {})
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
      } catch (err) { console.error('[useThreads] Close and delete workspace error:', err); return false }
    },
    [activeWorkspace, setActiveWorkspace, loadThreads, setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, activeThreadId, setAgentRunState]
  )

  const openWorkspace = useCallback(async () => {
    try {
      let currentId = activeThreadId
      if (!currentId) { const newId = await newConversation(); if (!newId) return null; currentId = newId }
      const ctx = await invoke<{ rootPath: string } | null>('workspace:select', { conversationId: currentId })
      if (ctx) {
        resetThreadScopedPanels()
        setActiveWorkspace({ name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace', path: ctx.rootPath })
        await loadThreads()
        return ctx
      }
      return null
    } catch (err) { console.error('[useThreads] Open workspace error:', err); return null }
  }, [activeThreadId, newConversation, setActiveWorkspace, loadThreads, resetThreadScopedPanels])

  return { loadThreads, selectThread, newConversation, deleteThread, openWorkspace, switchWorkspace, closeAndDeleteWorkspace }
}
