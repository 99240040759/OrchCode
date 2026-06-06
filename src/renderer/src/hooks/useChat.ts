import { useRef, useCallback, useEffect } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  agentRunStateAtom, chatMessagesAtom, activeThreadIdAtom, threadListAtom,
  sessionTokensAtom, selectedModelAtom, activeWorkspaceAtom, isThreadLoadingAtom,
  openFilesAtom, activeEditorFileAtom, artifactsAtom, artifactPanelModeAtom,
  type StreamBlock
} from '../store/agentStore'
import { cleanErrorMessage } from '../lib/cleanErrorMessage'
import type { StreamChunk, ThreadEntry, ThreadMessage, StreamPayload } from '../../../preload/index.d'

const invoke = <T>(cmd: string, payload?: unknown): Promise<T> => window.api.invoke(cmd, payload) as Promise<T>
const isToolResultError = (r: unknown): boolean => {
  if (!r || typeof r !== 'object') return false
  const obj = r as Record<string, unknown>
  return obj.success === false || (typeof obj.type === 'string' && (obj.type === 'error-text' || obj.type === 'error-json'))
}

export function useChat() {
  const [activeThreadId, setActiveThreadId] = useAtom(activeThreadIdAtom)
  const setRunState = useSetAtom(agentRunStateAtom)
  const setMessages = useSetAtom(chatMessagesAtom)
  const [threads, setThreads] = useAtom(threadListAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const [activeWorkspace, setActiveWorkspace] = useAtom(activeWorkspaceAtom)
  const setIsThreadLoading = useSetAtom(isThreadLoadingAtom)
  const setOpenFiles = useSetAtom(openFilesAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifacts = useSetAtom(artifactsAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

  const activeStreamThreadIdRef = useRef('')
  const rafIdRef = useRef<number | null>(null)

  const resetThreadScopedPanels = useCallback(() => {
    setOpenFiles([]); setActiveEditorFile(null); setArtifacts([]); setArtifactPanelMode('overview')
  }, [setOpenFiles, setActiveEditorFile, setArtifacts, setArtifactPanelMode])

  useEffect(() => { activeStreamThreadIdRef.current = activeThreadId }, [activeThreadId])

  const loadThreads = useCallback(async () => {
    try { setThreads((await invoke<ThreadEntry[]>('thread:list')) ?? []) }
    catch (err) { console.error('[useChat] Failed to load threads:', err) }
  }, [setThreads])

  const stop = useCallback(() => {
    const tid = activeStreamThreadIdRef.current
    setRunState('idle')
    setMessages(prev => prev.map(m => !m.isStreaming ? m : {
      ...m, isStreaming: false,
      orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' } : b)
    }))
    window.api.stopStream(tid)
  }, [setRunState, setMessages])

  const selectThread = useCallback(async (threadId: string) => {
    if (!threadId) return
    setRunState('idle')
    if (activeThreadId && activeThreadId !== threadId) {
      window.api.stopStream(activeThreadId)
    }
    setMessages([]); setSessionTokens(0); resetThreadScopedPanels()
    activeStreamThreadIdRef.current = threadId

    let loadingTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (activeStreamThreadIdRef.current === threadId) setIsThreadLoading(true)
      loadingTimer = null
    }, 200)

    const clearTimer = () => { if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null } }
    const checkStale = () => { if (activeStreamThreadIdRef.current !== threadId) { clearTimer(); setIsThreadLoading(false); return true }; return false }

    try { await invoke('thread:set-active', { threadId }) }
    catch (err) { console.error('[useChat] Failed to sync session:', err) }

    if (checkStale()) return

    try {
      const workspacePath = await invoke<string | null>('thread:workspace', { threadId })
      if (checkStale()) return
      setActiveWorkspace(workspacePath ? { name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace', path: workspacePath } : null)
    } catch (err) {
      console.error('[useChat] Failed to bind workspace:', err)
      setActiveWorkspace(null)
    }

    if (checkStale()) return

    try {
      const rawMessages = await invoke<ThreadMessage[]>('thread:messages', { threadId })
      if (checkStale()) return

      if (rawMessages?.length > 0) {
        setMessages(rawMessages.filter((m): m is ThreadMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant').map((m, idx) => {
          let blocks: StreamBlock[] | undefined
          try { blocks = m.data ? JSON.parse(m.data) : undefined } catch {}
          return {
            id: m.id ?? `msg-${idx}`, role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            orderedBlocks: Array.isArray(blocks) ? blocks : undefined,
            timestamp: new Date(m.createdAt ?? Date.now()).getTime(), isStreaming: false
          }
        }))
      }

      try {
        const fresh = await invoke<ThreadEntry & { accumulatedTokens?: number } | null>('thread:get', { threadId })
        if (fresh && activeStreamThreadIdRef.current === threadId) setSessionTokens(fresh.accumulatedTokens ?? 0)
      } catch {
        setSessionTokens(threads.find(t => t.id === threadId)?.accumulatedTokens ?? 0)
      }
    } catch (err) {
      console.error('[useChat] Failed to load messages:', err)
    }

    clearTimer()
    if (activeStreamThreadIdRef.current === threadId) { setActiveThreadId(threadId); setIsThreadLoading(false) }
  }, [setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, setIsThreadLoading, setActiveWorkspace, activeThreadId, setRunState, threads])

  const newConversation = useCallback(async () => {
    try {
      const { conversationId: newId } = await invoke<{ conversationId: string }>('thread:new')
      if (activeThreadId) window.api.stopStream(activeThreadId)
      setRunState('idle')
      if (activeWorkspace?.path) await invoke('workspace:set-active', { conversationId: newId, workspacePath: activeWorkspace.path })
      setActiveThreadId(newId); setMessages([]); setSessionTokens(0); resetThreadScopedPanels(); await loadThreads(); return newId
    } catch (err) { console.error('[useChat] New conversation error:', err); return null }
  }, [activeWorkspace, activeThreadId, setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, setRunState, loadThreads])

  const deleteThread = useCallback(async (threadId: string) => {
    try {
      await invoke('thread:delete', { threadId })
      setThreads(prev => prev.filter(t => t.id !== threadId))
      if (activeThreadId === threadId) {
        window.api.stopStream(threadId)
        setRunState('idle'); setActiveThreadId(''); setMessages([]); setSessionTokens(0); setActiveWorkspace(null); resetThreadScopedPanels()
      }
    } catch (err) { console.error('[useChat] Delete thread error:', err) }
  }, [activeThreadId, setThreads, setActiveThreadId, setMessages, setSessionTokens, setActiveWorkspace, resetThreadScopedPanels, setRunState])

  const switchWorkspace = useCallback(async (path: string) => {
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
    } catch (err) { console.error('[useChat] Switch workspace error:', err); return null }
  }, [activeThreadId, newConversation, setActiveWorkspace, resetThreadScopedPanels])

  const closeAndDeleteWorkspace = useCallback(async (path: string) => {
    try {
      if (activeWorkspace?.path === path) {
        if (activeThreadId) window.api.stopStream(activeThreadId)
        setRunState('idle'); setActiveWorkspace(null); setActiveThreadId(''); setMessages([]); setSessionTokens(0); resetThreadScopedPanels()
      }
      const success = await invoke<boolean>('workspace:close-and-delete', { workspacePath: path })
      if (success) await loadThreads()
      return success
    } catch (err) { console.error('[useChat] Close & delete workspace error:', err); return false }
  }, [activeWorkspace, setActiveWorkspace, loadThreads, setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, activeThreadId, setRunState])

  const openWorkspace = useCallback(async () => {
    try {
      let currentId = activeThreadId
      if (!currentId) { const newId = await newConversation(); if (!newId) return null; currentId = newId }
      const ctx = await invoke<{ rootPath: string } | null>('workspace:select', { conversationId: currentId })
      if (ctx) {
        resetThreadScopedPanels()
        setActiveWorkspace({ name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace', path: ctx.rootPath })
        await loadThreads(); return ctx
      }
      return null
    } catch (err) { console.error('[useChat] Open workspace error:', err); return null }
  }, [activeThreadId, newConversation, setActiveWorkspace, loadThreads, resetThreadScopedPanels])

  const run = useCallback(async (promptText: string, _mode?: string, attachments?: StreamPayload['attachments'], forceThreadId?: string) => {
    const resolvedThreadId = forceThreadId || activeThreadId || `session-${crypto.randomUUID()}`
    const isNewThread = !threads.some(t => t.id === resolvedThreadId) || threads.find(t => t.id === resolvedThreadId)?.title === 'New Chat'
    activeStreamThreadIdRef.current = resolvedThreadId

    if (resolvedThreadId !== activeThreadId) setActiveThreadId(resolvedThreadId)
    setRunState('thinking')

    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: promptText, data: attachments?.length ? JSON.stringify({ attachments }) : undefined, timestamp: Date.now() }])

    const assistantMsgId = crypto.randomUUID()
    setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', orderedBlocks: [], timestamp: Date.now(), isStreaming: true }])

    let fullContent = ''
    const orderedBlocks: StreamBlock[] = []
    let currentReasoningStartMs = 0
    let assistantIsStreaming = true

    const scheduleFlush = () => {
      if (rafIdRef.current !== null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        const snapshot = [...orderedBlocks]
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming } : m))
      })
    }

    const flushNow = () => {
      if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
      const snapshot = [...orderedBlocks]
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming } : m))
    }

    const processChunk = (chunk: StreamChunk) => {
      if (!chunk || chunk.threadId !== resolvedThreadId) return
      const chunkType = chunk.type
      const chunkData = chunk.payload && typeof chunk.payload === 'object' ? (chunk.payload as Record<string, unknown>) : undefined
      const chunkText = typeof chunk.payload === 'string' ? chunk.payload : ''

      if (chunkType === 'reasoning-start') {
        currentReasoningStartMs = Date.now()
        orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0, isStreaming: true })
        scheduleFlush()
      } else if (chunkType === 'reasoning-delta') {
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') orderedBlocks[orderedBlocks.length - 1] = { ...last, content: last.content + chunkText, durationMs: Date.now() - currentReasoningStartMs }
        scheduleFlush()
      } else if (chunkType === 'reasoning-end') {
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') orderedBlocks[orderedBlocks.length - 1] = { ...last, durationMs: Date.now() - currentReasoningStartMs, isStreaming: false }
        scheduleFlush()
      } else if (chunkType === 'text-delta') {
        fullContent += chunkText
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') { last.isStreaming = false; orderedBlocks.push({ type: 'text', content: chunkText }) }
        else if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: chunkText })
        else orderedBlocks[orderedBlocks.length - 1] = { ...last, content: last.content + chunkText }
        scheduleFlush()
      } else if (chunkType === 'tool-call-streaming-start') {
        setRunState('tool-calling')
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') last.isStreaming = false
        orderedBlocks.push({ type: 'tool', toolCallId: chunkData?.toolCallId as string ?? crypto.randomUUID(), toolName: chunkData?.toolName as string ?? 'unknown', args: {} as Record<string, unknown>, argsDelta: '', status: 'pending' })
        scheduleFlush()
      } else if (chunkType === 'tool-call-delta') {
        const tcId = chunkData?.toolCallId as string
        const delta = chunkData?.delta as string ?? ''
        const idx = orderedBlocks.findIndex(b => b.type === 'tool' && b.toolCallId === tcId)
        if (idx !== -1) {
          const old = orderedBlocks[idx]
          if (old.type === 'tool') {
            orderedBlocks[idx] = { ...old, argsDelta: (old.argsDelta || '') + delta }
          }
        }
        scheduleFlush()
      } else if (chunkType === 'tool-call') {
        setRunState('tool-calling')
        const tcId = chunkData?.toolCallId as string ?? crypto.randomUUID()
        const idx = orderedBlocks.findIndex(b => b.type === 'tool' && b.toolCallId === tcId)
        if (idx !== -1) {
          const old = orderedBlocks[idx]
          if (old.type === 'tool') {
            orderedBlocks[idx] = { ...old, args: (chunkData?.args ?? {}) as Record<string, unknown>, argsDelta: undefined }
          }
        } else {
          orderedBlocks.push({ type: 'tool', toolCallId: tcId, toolName: chunkData?.toolName as string ?? 'unknown', args: (chunkData?.args ?? {}) as Record<string, unknown>, status: 'pending' })
        }
        scheduleFlush()
      } else if (chunkType === 'tool-result') {
        const tcId = chunkData?.toolCallId as string
        const idx = orderedBlocks.findIndex(b => b.type === 'tool' && b.toolCallId === tcId)
        if (idx !== -1) {
          const old = orderedBlocks[idx]
          if (old.type === 'tool') {
            orderedBlocks[idx] = { ...old, result: chunkData?.result, status: isToolResultError(chunkData?.result) ? 'error' : 'complete', argsDelta: undefined }
          }
        }
        scheduleFlush()
        setRunState('streaming')
      } else if (chunkType === 'error') {
        assistantIsStreaming = false
        for (let i = 0; i < orderedBlocks.length; i++) {
          const b = orderedBlocks[i]
          if (b.type === 'tool' && b.status === 'pending') {
            orderedBlocks[i] = { ...b, status: 'error' }
          }
        }
        orderedBlocks.push({ type: 'error', message: cleanErrorMessage(chunk.payload) })
        flushNow()
        setRunState('error')
      } else if (chunkType === 'step-limit') {
        orderedBlocks.push({ type: 'text', content: '\n\n> **⚠️ The model hit its context limit.** You can ask me to continue from where I left off.' })
        scheduleFlush()
      } else if (chunkType === 'token-update') {
        const live = Number(chunkData?.accumulatedTokens ?? 0)
        if (live > 0) setSessionTokens(live)
      } else if (chunkType === 'finish') {
        assistantIsStreaming = false
        setSessionTokens(Number(chunkData?.accumulatedTokens ?? 0))
        flushNow()
        setRunState('idle')

        if (isNewThread && (fullContent || orderedBlocks.length > 0)) {
          window.api.invoke('thread:generate-title', { text: promptText.slice(0, 200) + ' ' + fullContent.slice(0, 200), threadId: resolvedThreadId })
            .then(async () => {
              try { setThreads((await invoke<ThreadEntry[]>('thread:list')) ?? []) } catch {}
            }).catch(console.error)
        }
      }
    }

    setRunState('streaming')
    try {
      await window.api.stream({ promptText, threadId: resolvedThreadId, modelType: selectedModel, attachments }, processChunk)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[useChat] Invocation Error:', err)
      setMessages(prev => prev.map(m => {
        if (m.id !== assistantMsgId) return m
        return {
          ...m, isStreaming: false,
          orderedBlocks: [...(m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b), { type: 'error', message: cleanErrorMessage(errorMsg) }]
        }
      }))
      setRunState('error')
    }
  }, [activeThreadId, selectedModel, setActiveThreadId, setMessages, setRunState, setThreads, setSessionTokens, threads])

  return { run, stop, loadThreads, selectThread, newConversation, deleteThread, openWorkspace, switchWorkspace, closeAndDeleteWorkspace }
}
