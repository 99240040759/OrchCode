import { useRef, useCallback, useEffect } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  agentRunStateAtom, chatMessagesAtom, activeThreadIdAtom, threadListAtom,
  sessionTokensAtom, selectedModelAtom, activeWorkspaceAtom, isThreadLoadingAtom,
  openFilesAtom, activeEditorFileAtom, artifactsAtom, artifactPanelModeAtom,
  type StreamBlock
} from '../store/agentStore'
import { cleanErrorMessage } from '../lib/cleanErrorMessage'
import type { StreamChunk, ThreadMessage, StreamPayload } from '../../preload/index.d'
import { threadService, workspaceService } from '../services/services'

const isToolResultError = (r: unknown): boolean => {
  if (!r || typeof r !== 'object') return false
  const obj = r as Record<string, unknown>
  return obj.success === false || (typeof obj.type === 'string' && (obj.type === 'error-text' || obj.type === 'error-json'))
}

export function useChat() {
  const [activeThreadId, setActiveThreadId] = useAtom(activeThreadIdAtom)
  const [runState, setRunState] = useAtom(agentRunStateAtom)
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
  const flushRafRef = useRef<number | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const workerVersionRef = useRef<Map<string, number>>(new Map())
  const isCompilingRef = useRef(false)
  const pendingCompileRef = useRef<{ content: string; targetId: string } | null>(null)
  const isMountedRef = useRef(true)
  const threadsRef = useRef(threads)
  const selectLockRef = useRef(false)

  useEffect(() => { threadsRef.current = threads }, [threads])
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (flushRafRef.current !== null) cancelAnimationFrame(flushRafRef.current)
    }
  }, [])

  // Init markdown worker once
  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current.onmessage = (e) => {
      const { html, targetId, version } = e.data
      isCompilingRef.current = false
      if (pendingCompileRef.current) {
        const next = pendingCompileRef.current
        pendingCompileRef.current = null
        if (workerRef.current) {
          isCompilingRef.current = true
          const nextVer = (workerVersionRef.current.get(next.targetId) ?? 0) + 1
          workerVersionRef.current.set(next.targetId, nextVer)
          workerRef.current.postMessage({ type: 'compile', content: next.content, targetId: next.targetId, version: nextVer })
        }
      }
      const latest = workerVersionRef.current.get(targetId)
      // drop stale results
      if (latest !== undefined && version < latest) return
      window.dispatchEvent(new CustomEvent('stream:html-update', { detail: { targetId, html } }))
    }
    return () => { workerRef.current?.terminate(); workerRef.current = null }
  }, [])

  const postToWorker = useCallback((content: string, targetId: string) => {
    if (!workerRef.current) return
    if (isCompilingRef.current) {
      pendingCompileRef.current = { content, targetId }
      return
    }
    isCompilingRef.current = true
    const version = (workerVersionRef.current.get(targetId) ?? 0) + 1
    workerVersionRef.current.set(targetId, version)
    workerRef.current.postMessage({ type: 'compile', content, targetId, version })
  }, [])

  const resetThreadScopedPanels = useCallback(() => {
    setOpenFiles([]); setActiveEditorFile(null); setArtifacts([]); setArtifactPanelMode('overview')
  }, [setOpenFiles, setActiveEditorFile, setArtifacts, setArtifactPanelMode])

  useEffect(() => { activeStreamThreadIdRef.current = activeThreadId }, [activeThreadId])

  // Worker crash: single handler here only (preload handles the reject; this just updates UI)
  useEffect(() => {
    const unsub = window.api.on('stream:worker-crashed', (payload: any) => {
      if (payload?.threadId !== activeStreamThreadIdRef.current) return
      setRunState('error')
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (!lastMsg?.isStreaming) return prev
        return prev.map(m => m.id !== lastMsg.id ? m : {
          ...m, isStreaming: false,
          orderedBlocks: [
            ...(m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b),
            { type: 'error', message: `Utility worker crashed (Exit code: ${payload.code ?? 'unknown'})` }
          ]
        })
      })
    })
    return () => unsub()
  }, [setRunState, setMessages])

  const loadThreads = useCallback(async () => {
    try { setThreads((await threadService.getThreads()) ?? []) }
    catch (err) { console.error('[useChat] Failed to load threads:', err); throw err }
  }, [setThreads])

  const stop = useCallback(() => {
    const tid = activeStreamThreadIdRef.current
    window.api.stopStream(tid)
    setRunState('idle')
    if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null }
    setMessages(prev => prev.map(m => !m.isStreaming ? m : {
      ...m, isStreaming: false,
      orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b)
    }))
  }, [setRunState, setMessages])

  const activeThreadIdRef = useRef(activeThreadId)
  useEffect(() => { activeThreadIdRef.current = activeThreadId }, [activeThreadId])

  const selectThread = useCallback(async (threadId: string) => {
    if (!threadId || selectLockRef.current) return
    selectLockRef.current = true
    setRunState('idle')
    activeStreamThreadIdRef.current = threadId
    let loadingTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (activeStreamThreadIdRef.current === threadId && isMountedRef.current) setIsThreadLoading(true)
      loadingTimer = null
    }, 200)
    const clearTimer = () => { if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null } }
    const checkStale = () => {
      if (activeStreamThreadIdRef.current !== threadId) { clearTimer(); if (isMountedRef.current) setIsThreadLoading(false); return true }
      return false
    }
    try {
      await threadService.setActiveSession(threadId)
      if (checkStale()) return
      const workspacePath = await threadService.getThreadWorkspace(threadId)
      if (checkStale()) return
      const rawMessages = await threadService.getThreadMessages(threadId)
      if (checkStale()) return
      const fresh = await threadService.getThread(threadId)
      if (checkStale()) return

      clearTimer()
      if (isMountedRef.current) {
        setActiveWorkspace(workspacePath ? { name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace', path: workspacePath } : null)
        const loadedMsgs = (rawMessages || []).filter((m): m is ThreadMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant').map((m, idx) => {
          let blocks: StreamBlock[] | undefined
          try { blocks = m.data ? JSON.parse(m.data) : undefined } catch {}
          return { id: m.id ?? `msg-${idx}`, role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content), orderedBlocks: Array.isArray(blocks) ? blocks : undefined, timestamp: new Date(m.createdAt ?? Date.now()).getTime(), isStreaming: false }
        })
        setMessages(loadedMsgs)
        setSessionTokens(fresh?.accumulatedTokens ?? 0)
        resetThreadScopedPanels()
        setActiveThreadId(threadId)
        setIsThreadLoading(false)
      }
    } catch (err) {
      console.error('[useChat] Failed to load thread:', err)
      clearTimer()
      if (isMountedRef.current) setIsThreadLoading(false)
      throw err
    } finally { selectLockRef.current = false }
  }, [setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, setIsThreadLoading, setActiveWorkspace, setRunState])

  const newConversation = useCallback(async (workspacePath?: string | null) => {
    try {
      const { conversationId: newId } = await threadService.newConversation()
      setRunState('idle')
      const targetWsPath = workspacePath !== undefined ? workspacePath : activeWorkspace?.path
      if (targetWsPath) {
        await workspaceService.setActiveWorkspace(newId, targetWsPath)
      }
      setActiveThreadId(newId); setMessages([]); setSessionTokens(0); resetThreadScopedPanels(); await loadThreads(); return newId
    } catch (err) { console.error('[useChat] New conversation error:', err); throw err }
  }, [activeWorkspace, setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, setRunState, loadThreads])

  const deleteThread = useCallback(async (threadId: string) => {
    try {
      window.api.stopStream(threadId)
      await threadService.deleteThread(threadId); setThreads(prev => prev.filter(t => t.id !== threadId))
      const curId = activeThreadIdRef.current
      if (curId === threadId) {
        setRunState('idle'); setActiveThreadId(''); setMessages([]); setSessionTokens(0); setActiveWorkspace(null); resetThreadScopedPanels()
      }
    } catch (err) { console.error('[useChat] Delete thread error:', err); throw err }
  }, [setThreads, setActiveThreadId, setMessages, setSessionTokens, setActiveWorkspace, resetThreadScopedPanels, setRunState])

  const switchWorkspace = useCallback(async (path: string) => {
    try {
      let currentId = activeThreadIdRef.current
      if (!currentId) { const newId = await newConversation(); currentId = newId }
      const ctx = await workspaceService.setActiveWorkspace(currentId, path)
      if (ctx) { resetThreadScopedPanels(); setActiveWorkspace({ name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace', path: ctx.rootPath }); return ctx }
      return null
    } catch (err) { console.error('[useChat] Switch workspace error:', err); throw err }
  }, [newConversation, setActiveWorkspace, resetThreadScopedPanels])

  const closeAndDeleteWorkspace = useCallback(async (path: string) => {
    try {
      if (activeWorkspace?.path === path) {
        const curId = activeThreadIdRef.current
        if (curId) window.api.stopStream(curId)
        setRunState('idle'); setActiveWorkspace(null); setActiveThreadId(''); setMessages([]); setSessionTokens(0); resetThreadScopedPanels()
      }
      const success = await workspaceService.closeAndDeleteWorkspace(path)
      if (success) await loadThreads()
      return success
    } catch (err) { console.error('[useChat] Close & delete workspace error:', err); throw err }
  }, [activeWorkspace, setActiveWorkspace, loadThreads, setActiveThreadId, setMessages, setSessionTokens, resetThreadScopedPanels, setRunState])

  const openWorkspace = useCallback(async () => {
    try {
      let currentId = activeThreadIdRef.current
      if (!currentId) { const newId = await newConversation(); currentId = newId }
      const ctx = await workspaceService.selectWorkspace(currentId)
      if (ctx) { resetThreadScopedPanels(); setActiveWorkspace({ name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace', path: ctx.rootPath }); await loadThreads(); return ctx }
      return null
    } catch (err) { console.error('[useChat] Open workspace error:', err); throw err }
  }, [newConversation, setActiveWorkspace, loadThreads, resetThreadScopedPanels])

  const run = useCallback(async (promptText: string, _mode?: string, attachments?: StreamPayload['attachments'], forceThreadId?: string) => {
    if (runState !== 'idle') return
    if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null }
    // clear version map for new stream
    workerVersionRef.current.clear()
    isCompilingRef.current = false
    pendingCompileRef.current = null
    const resolvedThreadId = forceThreadId || activeThreadIdRef.current || `session-${crypto.randomUUID()}`
    const existingThread = threadsRef.current.find(t => t.id === resolvedThreadId)
    const isNewThread = !existingThread || existingThread.title === 'New Chat'
    activeStreamThreadIdRef.current = resolvedThreadId
    if (resolvedThreadId !== activeThreadIdRef.current && isMountedRef.current) setActiveThreadId(resolvedThreadId)
    if (isMountedRef.current) setRunState('thinking')
    if (isMountedRef.current) setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: promptText, data: attachments?.length ? JSON.stringify({ attachments }) : undefined, timestamp: Date.now() }])
    const assistantMsgId = crypto.randomUUID()
    workerRef.current?.postMessage({ type: 'clear-cache', targetId: assistantMsgId })
    if (isMountedRef.current) setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', orderedBlocks: [], timestamp: Date.now(), isStreaming: true }])

    let fullContent = ''
    const orderedBlocks: StreamBlock[] = []
    let currentReasoningStartMs = 0
    let assistantIsStreaming = true

    // Single RAF-based flush — batches all updates at display frame rate
    const pendingFlush = { scheduled: false }
    const scheduleFlush = () => {
      if (pendingFlush.scheduled) return
      pendingFlush.scheduled = true
      flushRafRef.current = requestAnimationFrame(() => {
        flushRafRef.current = null
        pendingFlush.scheduled = false
        if (!isMountedRef.current) return
        const snapshot = [...orderedBlocks]
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming } : m))
      })
    }
    const flushNow = () => {
      if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null }
      pendingFlush.scheduled = false
      if (!isMountedRef.current) return
      const snapshot = [...orderedBlocks]
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming } : m))
    }

    const processChunk = (chunk: StreamChunk) => {
      if (!isMountedRef.current) return
      if (!chunk || chunk.threadId !== resolvedThreadId) return
      // Guard: only update UI if this stream's thread is the active one
      if (resolvedThreadId !== activeStreamThreadIdRef.current) return
      const chunkType = chunk.type
      const chunkData = chunk.payload && typeof chunk.payload === 'object' ? (chunk.payload as Record<string, unknown>) : undefined
      const chunkText = typeof chunk.payload === 'string' ? chunk.payload : ''

      if (chunkType === 'reasoning-start') {
        currentReasoningStartMs = Date.now()
        orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0, isStreaming: true })
        flushNow()
      } else if (chunkType === 'reasoning-delta') {
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') {
          const newContent = last.content + chunkText
          orderedBlocks[orderedBlocks.length - 1] = { ...last, content: newContent, durationMs: Date.now() - currentReasoningStartMs }
          postToWorker(newContent, `streaming-reasoning-${assistantMsgId}-${orderedBlocks.length - 1}`)
        }
        scheduleFlush()
      } else if (chunkType === 'reasoning-end') {
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') {
          orderedBlocks[orderedBlocks.length - 1] = { ...last, durationMs: Date.now() - currentReasoningStartMs, isStreaming: false }
          postToWorker(last.content, `streaming-reasoning-${assistantMsgId}-${orderedBlocks.length - 1}`)
        }
        flushNow()
      } else if (chunkType === 'text-delta') {
        fullContent += chunkText
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') {
          orderedBlocks[orderedBlocks.length - 1] = { ...last, isStreaming: false }
          orderedBlocks.push({ type: 'text', content: chunkText })
          postToWorker(chunkText, `streaming-text-${assistantMsgId}-${orderedBlocks.length - 1}`)
          flushNow()
        } else if (!last || last.type !== 'text') {
          orderedBlocks.push({ type: 'text', content: chunkText })
          postToWorker(chunkText, `streaming-text-${assistantMsgId}-${orderedBlocks.length - 1}`)
          flushNow()
        } else {
          const newContent = last.content + chunkText
          orderedBlocks[orderedBlocks.length - 1] = { ...last, content: newContent }
          postToWorker(newContent, `streaming-text-${assistantMsgId}-${orderedBlocks.length - 1}`)
          scheduleFlush()
        }
      } else if (chunkType === 'tool-call-streaming-start') {
        setRunState('tool-calling')
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') orderedBlocks[orderedBlocks.length - 1] = { ...last, isStreaming: false }
        orderedBlocks.push({ type: 'tool', toolCallId: chunkData?.toolCallId as string ?? crypto.randomUUID(), toolName: chunkData?.toolName as string ?? 'unknown', args: {} as Record<string, unknown>, argsDelta: '', status: 'pending' })
        flushNow()
      } else if (chunkType === 'tool-call-delta') {
        const tcId = chunkData?.toolCallId as string
        const delta = chunkData?.delta as string ?? ''
        const idx = orderedBlocks.findIndex(b => b.type === 'tool' && b.toolCallId === tcId)
        if (idx !== -1) { const old = orderedBlocks[idx]; if (old.type === 'tool') orderedBlocks[idx] = { ...old, argsDelta: (old.argsDelta || '') + delta } }
        scheduleFlush()
      } else if (chunkType === 'tool-call') {
        setRunState('tool-calling')
        const tcId = chunkData?.toolCallId as string ?? crypto.randomUUID()
        const idx = orderedBlocks.findIndex(b => b.type === 'tool' && b.toolCallId === tcId)
        if (idx !== -1) { const old = orderedBlocks[idx]; if (old.type === 'tool') orderedBlocks[idx] = { ...old, args: (chunkData?.args ?? {}) as Record<string, unknown>, argsDelta: undefined } }
        else orderedBlocks.push({ type: 'tool', toolCallId: tcId, toolName: chunkData?.toolName as string ?? 'unknown', args: (chunkData?.args ?? {}) as Record<string, unknown>, status: 'pending' })
        flushNow()
      } else if (chunkType === 'tool-result') {
        const tcId = chunkData?.toolCallId as string
        const idx = orderedBlocks.findIndex(b => b.type === 'tool' && b.toolCallId === tcId)
        if (idx !== -1) { const old = orderedBlocks[idx]; if (old.type === 'tool') orderedBlocks[idx] = { ...old, result: chunkData?.result, status: isToolResultError(chunkData?.result) ? 'error' : 'complete', argsDelta: undefined } }
        flushNow()
        // Only change to streaming if there's actually more text expected (not between tool calls)
        // Keep tool-calling state until a text-delta or finish arrives
      } else if (chunkType === 'error') {
        assistantIsStreaming = false
        for (let i = 0; i < orderedBlocks.length; i++) { const b = orderedBlocks[i]; if (b.type === 'tool' && b.status === 'pending') orderedBlocks[i] = { ...b, status: 'error' } }
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'text') postToWorker(last.content, `streaming-text-${assistantMsgId}-${orderedBlocks.length - 1}`)
        else if (last?.type === 'reasoning') postToWorker(last.content, `streaming-reasoning-${assistantMsgId}-${orderedBlocks.length - 1}`)
        orderedBlocks.push({ type: 'error', message: cleanErrorMessage(chunk.payload) })
        flushNow(); setRunState('error')
      } else if (chunkType === 'step-limit') {
        orderedBlocks.push({ type: 'text', content: '\n\n> **⚠️ The model hit its context limit.** You can ask me to continue from where I left off.' })
        flushNow()
      } else if (chunkType === 'token-update') {
        const live = Number(chunkData?.accumulatedTokens ?? 0)
        if (live > 0 && isMountedRef.current) setSessionTokens(live)
      } else if (chunkType === 'finish') {
        assistantIsStreaming = false
        if (isMountedRef.current) setSessionTokens(Number(chunkData?.accumulatedTokens ?? 0))
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'text') postToWorker(last.content, `streaming-text-${assistantMsgId}-${orderedBlocks.length - 1}`)
        else if (last?.type === 'reasoning') postToWorker(last.content, `streaming-reasoning-${assistantMsgId}-${orderedBlocks.length - 1}`)
        flushNow()
        if (isMountedRef.current) setRunState('idle')
        if (isNewThread && (fullContent || orderedBlocks.length > 0)) {
          threadService.generateTitle(promptText.slice(0, 200) + ' ' + fullContent.slice(0, 200), resolvedThreadId)
            .then(async () => { try { const tList = await threadService.getThreads(); if (isMountedRef.current) setThreads(tList ?? []) } catch {} }).catch(console.error)
        }
      }
    }

    if (isMountedRef.current) setRunState('streaming')
    try {
      await window.api.stream({ promptText, threadId: resolvedThreadId, modelType: selectedModel, attachments }, processChunk)
    } catch (err: unknown) {
      if (!isMountedRef.current) return
      // Only show error if NOT already handled by the worker-crash useEffect
      // The crash event fires independently; if stream() rejects due to crash,
      // worker-crash useEffect already added the error block. So we skip duplicate.
      const errorMsg = err instanceof Error ? err.message : String(err)
      const isCrashError = errorMsg.includes('Utility worker')
      const isAbortError = err instanceof Error && err.name === 'AbortError'
      if (!isCrashError && !isAbortError) {
        console.error('[useChat] Invocation Error:', err)
        setMessages(prev => prev.map(m => {
          if (m.id !== assistantMsgId) return m
          return { ...m, isStreaming: false, orderedBlocks: [...(m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b), { type: 'error', message: cleanErrorMessage(errorMsg) }] }
        }))
        setRunState('error')
      } else if (isAbortError) {
        // User-initiated stop — just mark as idle, no error shown
        setMessages(prev => prev.map(m => !m.isStreaming ? m : {
          ...m, isStreaming: false,
          orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b)
        }))
        setRunState('idle')
      }
    }
  }, [selectedModel, setActiveThreadId, setMessages, setRunState, setThreads, setSessionTokens, postToWorker, runState])

  return { run, stop, loadThreads, selectThread, newConversation, deleteThread, openWorkspace, switchWorkspace, closeAndDeleteWorkspace }
}
