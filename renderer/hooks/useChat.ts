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

async function initSharedBuffer() {
  if ((window as any).sharedBufferHeader) return
  try {
    const sab = await window.api.getSharedBuffer()
    ;(window as any).sharedBuffer = sab
    ;(window as any).sharedBufferHeader = new Int32Array(sab, 0, 16)
    ;(window as any).sharedBufferReasoning = new Uint8Array(sab, 64, 256 * 1024)
    ;(window as any).sharedBufferText = new Uint8Array(sab, 64 + 256 * 1024, 512 * 1024)
    ;(window as any).sharedBufferTool = new Uint8Array(sab, 64 + 256 * 1024 + 512 * 1024, 256 * 1024)
  } catch (err) { console.error('Failed to init SharedArrayBuffer in renderer:', err) }
}

const isToolResultError = (r: unknown): boolean => {
  if (!r || typeof r !== 'object') return false
  const obj = r as Record<string, unknown>
  return obj.success === false || (typeof obj.type === 'string' && (obj.type === 'error-text' || obj.type === 'error-json'))
}

export function useChat() {
  const [activeThreadId, setActiveThreadId] = useAtom(activeThreadIdAtom)
  const [runState, setRunState] = useAtom(agentRunStateAtom)
  const [messages, setMessages] = useAtom(chatMessagesAtom)
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
  const pendingCompileMap = useRef<Map<string, { content: string; version: number }>>(new Map())
  const isMountedRef = useRef(true)
  const isRunningRef = useRef(false)
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
  useEffect(() => { void initSharedBuffer() }, [])

  // Init markdown worker once
  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current.onmessage = (e) => {
      const { html, targetId, version } = e.data
      isCompilingRef.current = false
      if (pendingCompileMap.current.size > 0) {
        const entries = [...pendingCompileMap.current.entries()]
        pendingCompileMap.current.clear()
        isCompilingRef.current = true
        const [firstTargetId, first] = entries[0]
        for (const [tid, pending] of entries.slice(1)) {
          pendingCompileMap.current.set(tid, pending)
        }
        workerRef.current?.postMessage({ type: 'compile', content: first.content, targetId: firstTargetId, version: first.version })
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
    const version = (workerVersionRef.current.get(targetId) ?? 0) + 1
    workerVersionRef.current.set(targetId, version)
    if (isCompilingRef.current) {
      pendingCompileMap.current.set(targetId, { content, version })
      return
    }
    isCompilingRef.current = true
    workerRef.current.postMessage({ type: 'compile', content, targetId, version })
  }, [])
  useEffect(() => {
    ;(window as any).postToMarkdownWorker = postToWorker
  }, [postToWorker])

  const resetThreadScopedPanels = useCallback(() => {
    setOpenFiles([]); setActiveEditorFile(null); setArtifacts([]); setArtifactPanelMode('overview')
  }, [setOpenFiles, setActiveEditorFile, setArtifacts, setArtifactPanelMode])

  useEffect(() => { activeStreamThreadIdRef.current = activeThreadId }, [activeThreadId])

  // Worker crash: single handler here only (preload handles the reject; this just updates UI)
  useEffect(() => {
    const unsub = window.api.on('stream:worker-crashed', (payload: any) => {
      if (payload?.threadId !== activeStreamThreadIdRef.current) return
      if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null }
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
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId
    return () => {
      setMessages(prev => prev.map(m =>
        m.isStreaming
          ? { ...m, isStreaming: false, orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b) }
          : m
      ))
    }
  }, [activeThreadId, setMessages])

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
      const [workspacePath, rawMessages, fresh] = await Promise.all([
        threadService.getThreadWorkspace(threadId),
        threadService.getThreadMessages(threadId),
        threadService.getThread(threadId)
      ])
      if (checkStale()) return

      clearTimer()
      if (isMountedRef.current) {
        setActiveWorkspace(workspacePath ? { name: workspacePath.split(/[/\\]/).pop() ?? 'Workspace', path: workspacePath } : null)
        const loadedMsgs = (rawMessages || []).filter((m): m is ThreadMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant').map((m, idx) => {
          let blocks: StreamBlock[] | undefined
          try { blocks = m.data ? JSON.parse(m.data) : undefined } catch (e) { console.error('Failed to parse message blocks:', e) }
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
      const prevId = activeThreadIdRef.current; let currentId = prevId; let createdNew = false
      if (!currentId || messages.length > 0) { currentId = await newConversation(); createdNew = true }
      const ctx = await workspaceService.selectWorkspace(currentId)
      if (ctx) {
        resetThreadScopedPanels(); setActiveWorkspace({ name: ctx.rootPath.split(/[/\\]/).pop() ?? 'Workspace', path: ctx.rootPath })
        const tList = await threadService.getThreads(); if (isMountedRef.current) setThreads(tList ?? [])
        const wThreads = (tList ?? []).filter(t => t.workspacePath && t.workspacePath.toLowerCase().replace(/\\/g, '/') === ctx.rootPath.toLowerCase().replace(/\\/g, '/'))
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
  }, [newConversation, setActiveWorkspace, loadThreads, resetThreadScopedPanels, messages, selectThread, setActiveThreadId])

  const run = useCallback(async (promptText: string, attachments?: StreamPayload['attachments'], forceThreadId?: string) => {
    if (isRunningRef.current || runState !== 'idle') return
    isRunningRef.current = true
    try {
    if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null }
    // clear version map for new stream
    workerVersionRef.current.clear()
    isCompilingRef.current = false
    pendingCompileMap.current.clear()
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

    const flushNow = () => {
      if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null }
      if (!isMountedRef.current) return
      const snapshot = [...orderedBlocks]
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming } : m))
    }

    const processChunk = (chunk: StreamChunk) => {
      if (!isMountedRef.current) return
      if (!chunk || chunk.threadId !== resolvedThreadId) return
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
          last.content += chunkText
          last.durationMs = Date.now() - currentReasoningStartMs
        }
      } else if (chunkType === 'reasoning-end') {
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') {
          last.durationMs = Date.now() - currentReasoningStartMs
          last.isStreaming = false
          postToWorker(last.content, `streaming-reasoning-${assistantMsgId}-${orderedBlocks.length - 1}`)
        }
        flushNow()
      } else if (chunkType === 'text-delta') {
        fullContent += chunkText
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') {
          last.isStreaming = false
          orderedBlocks.push({ type: 'text', content: chunkText })
          flushNow()
        } else if (!last || last.type !== 'text') {
          orderedBlocks.push({ type: 'text', content: chunkText })
          flushNow()
        } else {
          last.content += chunkText
        }
      } else if (chunkType === 'tool-call-streaming-start') {
        setRunState('tool-calling')
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last?.type === 'reasoning') last.isStreaming = false
        orderedBlocks.push({ type: 'tool', toolCallId: chunkData?.toolCallId as string ?? crypto.randomUUID(), toolName: chunkData?.toolName as string ?? 'unknown', args: {} as Record<string, unknown>, argsDelta: '', status: 'pending' })
        flushNow()
      } else if (chunkType === 'tool-call-delta') {
        const tcId = chunkData?.toolCallId as string
        const delta = chunkData?.delta as string ?? ''
        const idx = orderedBlocks.findIndex(b => b.type === 'tool' && b.toolCallId === tcId)
        if (idx !== -1) {
          const old = orderedBlocks[idx]
          if (old.type === 'tool') {
            old.argsDelta = (old.argsDelta || '') + delta
          }
        }
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
      } else if (chunkType === 'error') {
        assistantIsStreaming = false
        const finalContent = chunkData?.content as string ?? fullContent
        const finalBlocks = chunkData?.orderedBlocks as StreamBlock[] ?? orderedBlocks
        for (let i = 0; i < finalBlocks.length; i++) { const b = finalBlocks[i]; if (b.type === 'tool' && b.status === 'pending') finalBlocks[i] = { ...b, status: 'error' } }
        const last = finalBlocks[finalBlocks.length - 1]
        if (last?.type === 'text') postToWorker(last.content, `streaming-text-${assistantMsgId}-${finalBlocks.length - 1}`)
        else if (last?.type === 'reasoning') postToWorker(last.content, `streaming-reasoning-${assistantMsgId}-${finalBlocks.length - 1}`)
        finalBlocks.push({ type: 'error', message: cleanErrorMessage(chunkData?.message ?? chunk.payload) })
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: finalContent, orderedBlocks: finalBlocks, isStreaming: false } : m))
        setRunState('error')
      } else if (chunkType === 'step-limit') {
        assistantIsStreaming = false
        orderedBlocks.push({ type: 'text', content: '\n\n> **⚠️ The model hit its context limit.** You can ask me to continue from where I left off.' })
        flushNow()
      } else if (chunkType === 'token-update') {
        const live = Number(chunkData?.accumulatedTokens ?? 0)
        if (live > 0 && isMountedRef.current) setSessionTokens(live)
      } else if (chunkType === 'finish') {
        assistantIsStreaming = false
        if (isMountedRef.current) setSessionTokens(Number(chunkData?.accumulatedTokens ?? 0))
        const finalContent = chunkData?.content as string ?? fullContent
        const finalBlocks = chunkData?.orderedBlocks as StreamBlock[] ?? orderedBlocks
        const last = finalBlocks[finalBlocks.length - 1]
        if (last?.type === 'text') postToWorker(last.content, `streaming-text-${assistantMsgId}-${finalBlocks.length - 1}`)
        else if (last?.type === 'reasoning') postToWorker(last.content, `streaming-reasoning-${assistantMsgId}-${finalBlocks.length - 1}`)
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: finalContent, orderedBlocks: finalBlocks, isStreaming: false } : m))
        if (isMountedRef.current) setRunState('idle')
        if (isNewThread && (finalContent || finalBlocks.length > 0)) {
          threadService.generateTitle(promptText.slice(0, 200) + ' ' + finalContent.slice(0, 200), resolvedThreadId)
            .then(async () => { try { const tList = await threadService.getThreads(); if (isMountedRef.current) setThreads(tList ?? []) } catch (e) { console.error('Failed to refresh threads:', e) } }).catch(console.error)
        }
      }
    }

    if (isMountedRef.current) setRunState('streaming')
    try {
      await window.api.stream({ promptText, threadId: resolvedThreadId, modelType: selectedModel, attachments }, processChunk)
    } catch (err: unknown) {
      if (!isMountedRef.current) return
      const isCur = resolvedThreadId === activeStreamThreadIdRef.current
      if (isCur && flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null }
      assistantIsStreaming = false
      const errorMsg = err instanceof Error ? err.message : String(err)
      const isCrashError = errorMsg.includes('Utility worker'), isAbortError = err instanceof Error && err.name === 'AbortError'
      if (!isCrashError && !isAbortError) {
        console.error('[useChat] Invocation Error:', err)
        if (isCur) {
          setMessages(prev => prev.map(m => m.id !== assistantMsgId ? m : { ...m, isStreaming: false, orderedBlocks: [...(m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b), { type: 'error', message: cleanErrorMessage(errorMsg) }] }))
          setRunState('error')
        }
      } else if (isAbortError && isCur) {
        setMessages(prev => prev.map(m => !m.isStreaming ? m : { ...m, isStreaming: false, orderedBlocks: (m.orderedBlocks ?? []).map(b => b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b) }))
        setRunState('idle')
      }
    }
    } finally {
      isRunningRef.current = false
    }
  }, [selectedModel, setActiveThreadId, setMessages, setRunState, setThreads, setSessionTokens, postToWorker, runState])

  return { run, stop, loadThreads, selectThread, newConversation, deleteThread, openWorkspace, closeAndDeleteWorkspace }
}
