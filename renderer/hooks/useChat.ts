import { useRef, useEffect } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  chatMessagesAtom, activeThreadIdAtom, threadListAtom,
  selectedModelAtom, activeWorkspaceAtom, isThreadLoadingAtom,
  openFilesAtom, activeEditorFileAtom, artifactsAtom, artifactPanelModeAtom, runningThreadsAtom,
  updateThreadMessagesAtom, updateThreadRunStateAtom, updateThreadTokensAtom, updateThreadWorkspaceAtom,
  updateThreadArtifactsAtom, updateThreadOpenFilesAtom, updateThreadActiveEditorFileAtom,
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
  const [messages, setMessages] = useAtom(chatMessagesAtom)
  const [threads, setThreads] = useAtom(threadListAtom)
  const [runningThreads, setRunningThreads] = useAtom(runningThreadsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const setIsThreadLoading = useSetAtom(isThreadLoadingAtom)
  const setOpenFiles = useSetAtom(openFilesAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifacts = useSetAtom(artifactsAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

  // Specific-thread update actions
  const updateThreadMessages = useSetAtom(updateThreadMessagesAtom)
  const updateThreadRunState = useSetAtom(updateThreadRunStateAtom)
  const updateThreadTokens = useSetAtom(updateThreadTokensAtom)
  const updateThreadWorkspace = useSetAtom(updateThreadWorkspaceAtom)
  const updateThreadArtifacts = useSetAtom(updateThreadArtifactsAtom)
  const updateThreadOpenFiles = useSetAtom(updateThreadOpenFilesAtom)
  const updateThreadActiveEditorFile = useSetAtom(updateThreadActiveEditorFileAtom)

  const activeStreamThreadIdRef = useRef('')
  const activeRunIdRef = useRef<string | null>(null)
  const flushRafsRef = useRef<Record<string, number | null>>({})
  const isMountedRef = useRef(true)
  const isRunningMapRef = useRef<Record<string, boolean>>({})
  const threadsRef = useRef(threads)
  const selectLockRef = useRef(false)

  useEffect(() => { threadsRef.current = threads }, [threads])
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      Object.values(flushRafsRef.current).forEach(id => { if (id !== null && id !== undefined) cancelAnimationFrame(id) })
    }
  }, [])

  const resetThreadScopedPanels = () => {
    setOpenFiles([]); setActiveEditorFile(null); setArtifacts([]); setArtifactPanelMode('overview')
  }

  useEffect(() => { activeStreamThreadIdRef.current = activeThreadId }, [activeThreadId])

  // Worker crash: single handler here only (preload handles the reject; this just updates UI)
  useEffect(() => {
    const unsub = window.api.on('stream:worker-crashed', (payload: any) => {
      const crashedId = payload?.threadId; if (!crashedId) return
      const rafId = flushRafsRef.current[crashedId]; if (rafId) { cancelAnimationFrame(rafId); flushRafsRef.current[crashedId] = null }
      updateThreadRunState({ threadId: crashedId, state: 'error' })
      updateThreadMessages({
        threadId: crashedId,
        update: prev => {
          const lastMsg = prev[prev.length - 1]; if (!lastMsg?.isStreaming) return prev
          return prev.map(m => m.id !== lastMsg.id ? m : {
            ...m, isStreaming: false,
            orderedBlocks: [
              ...(m.orderedBlocks ?? []).map(b => b.type === 'tool_call' && b.status === 'pending' ? { ...b, status: 'error' as const } : b),
              { type: 'error', message: `Utility worker crashed (Exit code: ${payload.code ?? 'unknown'})` }
            ]
          })
        }
      })
    })
    return () => unsub()
  }, [updateThreadRunState, updateThreadMessages])

  const loadThreads = async () => {
    try { setThreads((await threadService.getThreads()) ?? []) }
    catch (err) { console.error('[useChat] Failed to load threads:', err); throw err }
  }

  const stop = () => {
    const tid = activeStreamThreadIdRef.current
    window.api.stopStream(tid)
    updateThreadRunState({ threadId: tid, state: 'idle' })
    setRunningThreads(prev => { const n = new Set(prev); n.delete(tid); return n })
    const rafId = flushRafsRef.current[tid]; if (rafId) { cancelAnimationFrame(rafId); flushRafsRef.current[tid] = null }
    updateThreadMessages({ threadId: tid, update: prev => prev.map(m => !m.isStreaming ? m : {
      ...m, isStreaming: false,
      orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool_call' && b.status === 'pending' ? { ...b, status: 'error' as const } : b)
    }) })
  }

  const activeThreadIdRef = useRef(activeThreadId)
  const messagesRef = useRef(messages)
  useEffect(() => { activeThreadIdRef.current = activeThreadId }, [activeThreadId])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Only clean up isStreaming on unmount — NOT on every thread switch.
  // Thread switches must preserve streaming state of background threads.
  useEffect(() => {
    return () => {
      const curId = activeThreadIdRef.current
      if (curId) {
        setMessages(prev => prev.map(m =>
          m.isStreaming
            ? { ...m, isStreaming: false, orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool_call' && b.status === 'pending' ? { ...b, status: 'error' as const } : b) }
            : m
        ))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectThread = async (threadId: string) => {
    if (!threadId || selectLockRef.current) return
    selectLockRef.current = true
    // Only reset to idle if this thread isn't actively running in the background
    if (!runningThreads.has(threadId)) updateThreadRunState({ threadId, state: 'idle' })
    const requestId = Math.random().toString(36).substring(2)
    const requestIdRef = { current: requestId }
    activeStreamThreadIdRef.current = threadId
    setIsThreadLoading(true)
    const checkStale = () => {
      if (activeStreamThreadIdRef.current !== threadId || requestIdRef.current !== requestId) { if (isMountedRef.current) setIsThreadLoading(false); return true }
      return false
    }
    try {
      await threadService.setActiveSession(threadId)
      if (checkStale()) return
      const [workspacePath, rawMessages, fresh] = await Promise.all([threadService.getThreadWorkspace(threadId), threadService.getThreadMessages(threadId), threadService.getThread(threadId)])
      if (checkStale()) return
      if (isMountedRef.current && requestIdRef.current === requestId) {
        const workspace = workspacePath ? { name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace', path: workspacePath } : null
        const loadedMsgs = (rawMessages || []).filter((m): m is ThreadMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant').map((m, idx) => {
          let blocks: StreamBlock[] | undefined
          try { blocks = m.data ? JSON.parse(m.data) : undefined } catch (e) { console.error('Failed to parse message blocks:', e) }
          return { id: m.id ?? `msg-${idx}`, role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content), orderedBlocks: Array.isArray(blocks) ? blocks : undefined, timestamp: new Date(m.createdAt ?? Date.now()).getTime(), isStreaming: false }
        })
        updateThreadWorkspace({ threadId, workspace })
        updateThreadMessages({ threadId, update: loadedMsgs })
        updateThreadTokens({ threadId, session: fresh?.accumulatedTokens ?? 0, lifetime: fresh?.lifetimeTokens ?? 0 })
        setActiveThreadId(threadId)
        setIsThreadLoading(false)
      }
    } catch (err) { console.error('[useChat] Failed to load thread:', err); if (isMountedRef.current && requestIdRef.current === requestId) setIsThreadLoading(false); throw err }
    finally { selectLockRef.current = false }
  }

  const newConversation = async (workspacePath?: string | null) => {
    try {
      const targetWsPath = workspacePath !== undefined ? workspacePath : (activeWorkspace?.path || null)
      const { conversationId: newId } = await threadService.newConversation(targetWsPath)
      const workspace = targetWsPath ? { name: targetWsPath.split(/[/\\]/).pop() ?? 'Workspace', path: targetWsPath } : null
      updateThreadWorkspace({ threadId: newId, workspace })
      updateThreadRunState({ threadId: newId, state: 'idle' })
      updateThreadMessages({ threadId: newId, update: [] })
      updateThreadTokens({ threadId: newId, session: 0, lifetime: 0 })
      updateThreadOpenFiles({ threadId: newId, openFiles: [] })
      updateThreadActiveEditorFile({ threadId: newId, file: null })
      updateThreadArtifacts({ threadId: newId, artifacts: [] })
      if (targetWsPath) await workspaceService.setActiveWorkspace(newId, targetWsPath)
      setActiveThreadId(newId); resetThreadScopedPanels(); await loadThreads(); return newId
    } catch (err) { console.error('[useChat] New conversation error:', err); throw err }
  }

  const deleteThread = async (threadId: string) => {
    try {
      window.api.stopStream(threadId)
      setRunningThreads(prev => { const n = new Set(prev); n.delete(threadId); return n })
      await threadService.deleteThread(threadId); setThreads(prev => prev.filter(t => t.id !== threadId))
      if (activeThreadIdRef.current === threadId) {
        setActiveThreadId(''); resetThreadScopedPanels()
      }
    } catch (err) { console.error('[useChat] Delete thread error:', err); throw err }
  }

  const closeAndDeleteWorkspace = async (path: string) => {
    try {
      if (activeWorkspace?.path === path) {
        const curId = activeThreadIdRef.current; if (curId) window.api.stopStream(curId)
        setActiveThreadId(''); resetThreadScopedPanels()
      }
      const success = await workspaceService.closeAndDeleteWorkspace(path)
      if (success) await loadThreads()
      return success
    } catch (err) { console.error('[useChat] Close & delete workspace error:', err); throw err }
  }

  const openWorkspace = async () => {
    try {
      const prevId = activeThreadIdRef.current; let currentId = prevId; let createdNew = false
      if (!currentId || messagesRef.current.length > 0) { currentId = await newConversation(); createdNew = true }
      const ctx = await workspaceService.selectWorkspace(currentId)
      if (ctx) {
        resetThreadScopedPanels(); const workspace = { name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace', path: ctx.rootPath }
        updateThreadWorkspace({ threadId: currentId, workspace })
        const tList = await threadService.getThreads(); if (isMountedRef.current) setThreads(tList ?? [])
        const wThreads = (tList ?? []).filter(t => t.id !== currentId && t.workspacePath && t.workspacePath.toLowerCase().replace(/\\/g, '/') === ctx.rootPath.toLowerCase().replace(/\\/g, '/'))
        if (wThreads.length > 0) {
          wThreads.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
          if (createdNew) await threadService.deleteThread(currentId)
          await selectThread(wThreads[0].id)
        } else { await selectThread(currentId) }
        await loadThreads(); return ctx
      } else if (createdNew) {
        await threadService.deleteThread(currentId); if (prevId) await selectThread(prevId); else setActiveThreadId('')
        await loadThreads()
      }
      return null
    } catch (err) { console.error('[useChat] Open workspace error:', err); throw err }
  }

  const run = async (promptText: string, attachments?: StreamPayload['attachments'], forceThreadId?: string) => {
    const resolvedThreadId = forceThreadId || activeThreadIdRef.current || `session-${window.crypto.randomUUID()}`
    if (isRunningMapRef.current[resolvedThreadId]) return
    if (runningThreads.has(resolvedThreadId)) return
    isRunningMapRef.current[resolvedThreadId] = true
    const runId = Math.random().toString(36).substring(2)
    activeRunIdRef.current = runId
    try {
      const rafId = flushRafsRef.current[resolvedThreadId]; if (rafId) { cancelAnimationFrame(rafId); flushRafsRef.current[resolvedThreadId] = null }
      const existingThread = threadsRef.current.find(t => t.id === resolvedThreadId)
      const isNewThread = !existingThread || existingThread.title === 'New Chat'
      activeStreamThreadIdRef.current = resolvedThreadId
      if (resolvedThreadId !== activeThreadIdRef.current && isMountedRef.current) setActiveThreadId(resolvedThreadId)
      updateThreadRunState({ threadId: resolvedThreadId, state: 'thinking' })
      setRunningThreads(prev => new Set(prev).add(resolvedThreadId))
      const startTimeVal = Date.now()
      updateThreadMessages({ threadId: resolvedThreadId, update: prev => [...prev, { id: window.crypto.randomUUID(), role: 'user', content: promptText, data: attachments?.length ? JSON.stringify({ attachments }) : undefined, timestamp: startTimeVal }] })
      const assistantMsgId = window.crypto.randomUUID()
      updateThreadMessages({ threadId: resolvedThreadId, update: prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', orderedBlocks: [], timestamp: startTimeVal, isStreaming: true }] })
      if (isNewThread) {
        threadService.generateTitle(promptText.slice(0, 400), resolvedThreadId)
          .then(async () => { try { const tList = await threadService.getThreads(); if (isMountedRef.current) setThreads(tList ?? []) } catch (e) { console.error(e) } }).catch(console.error)
      }

      let fullContent = ''
      const orderedBlocks: StreamBlock[] = []
      let assistantIsStreaming = true

      const flushNow = () => {
        const rafId = flushRafsRef.current[resolvedThreadId]; if (rafId) { cancelAnimationFrame(rafId); flushRafsRef.current[resolvedThreadId] = null }
        if (!isMountedRef.current) return
        const snapshot = [...orderedBlocks]
        updateThreadMessages({ threadId: resolvedThreadId, update: prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming } : m) })
      }
      const scheduleFlush = () => {
        if (!flushRafsRef.current[resolvedThreadId]) {
          flushRafsRef.current[resolvedThreadId] = requestAnimationFrame(() => { flushRafsRef.current[resolvedThreadId] = null; flushNow() })
        }
      }

      const processChunk = (chunk: StreamChunk) => {
        if (!isMountedRef.current || !chunk || chunk.threadId !== resolvedThreadId) return
        const chunkType = chunk.type
        const chunkData = chunk.payload && typeof chunk.payload === 'object' ? (chunk.payload as Record<string, unknown>) : undefined
        const chunkText = typeof chunk.payload === 'string' ? chunk.payload : ''

        if (chunkType === 'text_delta') {
          fullContent += chunkText
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (!last || last.type !== 'text') { orderedBlocks.push({ type: 'text', content: chunkText }); flushNow() }
          else { last.content += chunkText; scheduleFlush() }
        } else if (chunkType === 'tool_call_start') {
          updateThreadRunState({ threadId: resolvedThreadId, state: 'tool-calling' })
          orderedBlocks.push({ type: 'tool_call', tool_call_id: chunkData?.tool_call_id as string ?? window.crypto.randomUUID(), tool_name: chunkData?.tool_name as string ?? 'unknown', args: {} as Record<string, unknown>, args_delta: '', status: 'pending' })
          flushNow()
        } else if (chunkType === 'tool_call_delta') {
          const tcId = chunkData?.tool_call_id as string, delta = chunkData?.delta as string ?? ''
          const idx = orderedBlocks.findIndex(b => b.type === 'tool_call' && b.tool_call_id === tcId)
          if (idx !== -1) { const old = orderedBlocks[idx]; if (old.type === 'tool_call') { old.args_delta = (old.args_delta || '') + delta; scheduleFlush() } }
        } else if (chunkType === 'tool_call') {
          updateThreadRunState({ threadId: resolvedThreadId, state: 'tool-calling' })
          const tcId = chunkData?.tool_call_id as string ?? window.crypto.randomUUID()
          const idx = orderedBlocks.findIndex(b => b.type === 'tool_call' && b.tool_call_id === tcId)
          if (idx !== -1) { const old = orderedBlocks[idx]; if (old.type === 'tool_call') orderedBlocks[idx] = { ...old, args: (chunkData?.args ?? {}) as Record<string, unknown>, args_delta: undefined } }
          else orderedBlocks.push({ type: 'tool_call', tool_call_id: tcId, tool_name: chunkData?.tool_name as string ?? 'unknown', args: (chunkData?.args ?? {}) as Record<string, unknown>, status: 'pending' })
          flushNow()
        } else if (chunkType === 'tool_result') {
          const tcId = chunkData?.tool_call_id as string
          const idx = orderedBlocks.findIndex(b => b.type === 'tool_call' && b.tool_call_id === tcId)
          if (idx !== -1) { const old = orderedBlocks[idx]; if (old.type === 'tool_call') orderedBlocks[idx] = { ...old, result: chunkData?.result, status: isToolResultError(chunkData?.result) ? 'error' : 'complete', args_delta: undefined } }
          flushNow()
        } else if (chunkType === 'tool_result_pending') {
          // Server signals tool is executing — mark block as actively running (already pending, just UI feedback)
          const tcId = chunkData?.tool_call_id as string
          const idx = orderedBlocks.findIndex(b => b.type === 'tool_call' && b.tool_call_id === tcId)
          if (idx !== -1) scheduleFlush()
        } else if (chunkType === 'summarize') {
          orderedBlocks.push({ type: 'summarize', savedTokens: Number(chunkData?.savedTokens ?? 0), totalTokens: Number(chunkData?.totalTokens ?? 0) })
          flushNow()
        } else if (chunkType === 'error') {
          assistantIsStreaming = false
          const finalContent = chunkData?.content as string ?? fullContent
          const finalBlocks = chunkData?.orderedBlocks as StreamBlock[] ?? orderedBlocks
          for (let i = 0; i < finalBlocks.length; i++) { const b = finalBlocks[i]; if (b.type === 'tool_call' && b.status === 'pending') finalBlocks[i] = { ...b, status: 'error' } }
          finalBlocks.push({ type: 'error', message: cleanErrorMessage(chunkData?.message ?? chunk.payload) })
          updateThreadMessages({ threadId: resolvedThreadId, update: prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: finalContent, orderedBlocks: finalBlocks, isStreaming: false } : m) })
          updateThreadRunState({ threadId: resolvedThreadId, state: 'error' })
        } else if (chunkType === 'inject_queued') {
          // Inject queued server-side — no restart needed, loop continues
          console.debug('[useChat] inject queued:', chunkText)
        } else if (chunkType === 'token_update') {
          if (chunkData?.accumulatedTokens !== undefined || chunkData?.lifetimeTokens !== undefined) {
            updateThreadTokens({
              threadId: resolvedThreadId,
              session: chunkData.accumulatedTokens !== undefined ? Number(chunkData.accumulatedTokens) : undefined,
              lifetime: chunkData.lifetimeTokens !== undefined ? Number(chunkData.lifetimeTokens) : undefined
            })
          }
        } else if (chunkType === 'finish') {
          assistantIsStreaming = false
          updateThreadTokens({
            threadId: resolvedThreadId,
            session: Number(chunkData?.accumulatedTokens ?? 0),
            lifetime: chunkData?.lifetimeTokens !== undefined ? Number(chunkData.lifetimeTokens) : undefined
          })
          const finalContent = chunkData?.content as string ?? fullContent
          const finalBlocks = chunkData?.orderedBlocks as StreamBlock[] ?? orderedBlocks
          updateThreadMessages({ threadId: resolvedThreadId, update: prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: finalContent, orderedBlocks: finalBlocks, isStreaming: false } : m) })
          updateThreadRunState({ threadId: resolvedThreadId, state: 'idle' })
          setRunningThreads(prev => { const n = new Set(prev); n.delete(resolvedThreadId); return n })
        }
      }

      // State already set to 'thinking' on line 235 — do not re-set here to avoid trampling 'tool-calling' state
      try {
        await window.api.stream({ promptText, threadId: resolvedThreadId, modelType: selectedModel, attachments, startTime: startTimeVal }, processChunk)
      } catch (err: unknown) {
        if (!isMountedRef.current) return
        const rafId = flushRafsRef.current[resolvedThreadId]; if (rafId) { cancelAnimationFrame(rafId); flushRafsRef.current[resolvedThreadId] = null }
        assistantIsStreaming = false
        const errorMsg = err instanceof Error ? err.message : String(err)
        const isCrashError = errorMsg.includes('Utility worker'), isAbortError = (err instanceof Error && err.name === 'AbortError') || errorMsg === 'terminated' || errorMsg.includes('aborted')
        if (!isCrashError && !isAbortError) {
          console.error('[useChat] Invocation Error:', err)
          updateThreadMessages({ threadId: resolvedThreadId, update: prev => prev.map(m => m.id !== assistantMsgId ? m : { ...m, isStreaming: false, orderedBlocks: [...(m.orderedBlocks ?? []).map(b => b.type === 'tool_call' && b.status === 'pending' ? { ...b, status: 'error' as const } : b), { type: 'error', message: cleanErrorMessage(errorMsg) }] }) })
          updateThreadRunState({ threadId: resolvedThreadId, state: 'error' })
        } else if (isAbortError) {
          updateThreadMessages({ threadId: resolvedThreadId, update: prev => prev.map(m => !m.isStreaming ? m : { ...m, isStreaming: false, orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool_call' && b.status === 'pending' ? { ...b, status: 'error' as const } : b) }) })
          updateThreadRunState({ threadId: resolvedThreadId, state: 'idle' })
        }
      }
    } finally {
      isRunningMapRef.current[resolvedThreadId] = false
      if (activeRunIdRef.current === runId) {
        setRunningThreads(prev => { const n = new Set(prev); n.delete(resolvedThreadId); return n })
      }
    }
  }

  return { run, stop, loadThreads, selectThread, newConversation, deleteThread, openWorkspace, closeAndDeleteWorkspace }
}
