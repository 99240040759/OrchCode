import { useRef, useEffect } from 'react'
import { useStore } from 'jotai'
import {
  chatMessagesAtom, activeThreadIdAtom, threadListAtom,
  selectedModelAtom, activeWorkspaceAtom, isThreadLoadingAtom,
  openFilesAtom, activeEditorFileAtom, artifactsAtom, artifactPanelModeAtom, runningThreadsAtom,
  updateThreadMessagesAtom, updateThreadRunStateAtom, updateThreadTokensAtom, updateThreadWorkspaceAtom,
  updateThreadArtifactsAtom, updateThreadOpenFilesAtom, updateThreadActiveEditorFileAtom,
  updatePendingApprovalAtom, type StreamBlock
} from '../store/agentStore'
import { cleanErrorMessage } from '../lib/cleanErrorMessage'
import { getWorkspaceName, normalizeSeparators } from '../lib/pathUtils'
import type { StreamChunk, ThreadMessage, StreamPayload } from '../../preload/index.d'
import { threadService, workspaceService } from '../services/services'
import { toast } from 'sonner'

const isToolResultError = (r: unknown): boolean => {
  if (!r || typeof r !== 'object') return false
  const obj = r as Record<string, unknown>
  return obj.success === false || (typeof obj.type === 'string' && (obj.type === 'error-text' || obj.type === 'error-json'))
}
const markPendingToolCallsAsError = (blocks: StreamBlock[]): StreamBlock[] =>
  blocks.map(b => b.type === 'tool_call' && b.status === 'pending' ? { ...b, status: 'error' as const } : b)
const makeWorkspace = (path: string) => ({ name: getWorkspaceName(path), path })

export function useChat() {
  const store = useStore()

  const latestSelectRequestThreadIdRef = useRef('')
  const flushRafsRef = useRef<Record<string, number | null>>({})
  const isMountedRef = useRef(true)
  const isRunningMapRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      Object.values(flushRafsRef.current).forEach(id => { if (id !== null && id !== undefined) cancelAnimationFrame(id) })
    }
  }, [])

  const resetThreadScopedPanels = () => {
    store.set(openFilesAtom, [])
    store.set(activeEditorFileAtom, null)
    store.set(artifactsAtom, [])
    store.set(artifactPanelModeAtom, 'overview')
  }

  const cancelFlush = (tid: string) => {
    const rafId = flushRafsRef.current[tid]; if (rafId) { cancelAnimationFrame(rafId); flushRafsRef.current[tid] = null }
  }

  const removeFromRunning = (tid: string) => {
    store.set(runningThreadsAtom, prev => { const n = new Set(prev); n.delete(tid); return n })
  }

  useEffect(() => {
    const unsub = window.api.on('stream:worker-crashed', (payload: any) => {
      const crashedId = payload?.threadId; if (!crashedId) return
      cancelFlush(crashedId)
      store.set(updateThreadRunStateAtom, { threadId: crashedId, state: 'error' })
      store.set(updateThreadMessagesAtom, {
        threadId: crashedId,
        update: prev => {
          const lastMsg = prev[prev.length - 1]; if (!lastMsg?.isStreaming) return prev
          return prev.map(m => m.id !== lastMsg.id ? m : {
            ...m, isStreaming: false,
            orderedBlocks: [
              ...markPendingToolCallsAsError(m.orderedBlocks ?? []),
              { type: 'error', message: `Utility worker crashed (Exit code: ${payload.code ?? 'unknown'})` }
            ]
          })
        }
      })
    })
    return () => unsub()
  }, [store])

  const loadThreads = async () => {
    try { store.set(threadListAtom, (await threadService.getThreads()) ?? []) }
    catch (err) { console.error('[useChat] Failed to load threads:', err); throw err }
  }

  const stop = (threadId?: string) => {
    const tid = threadId ?? store.get(activeThreadIdAtom)
    window.api.stopStream(tid)
    store.set(updateThreadRunStateAtom, { threadId: tid, state: 'idle' })
    removeFromRunning(tid)
    cancelFlush(tid)
    store.set(updateThreadMessagesAtom, { threadId: tid, update: prev => prev.map(m => !m.isStreaming ? m : {
      ...m, isStreaming: false, orderedBlocks: markPendingToolCallsAsError(m.orderedBlocks ?? [])
    }) })
  }

  useEffect(() => {
    return () => {
      const curId = store.get(activeThreadIdAtom)
      if (curId) {
        store.set(chatMessagesAtom, prev => prev.map(m =>
          m.isStreaming ? { ...m, isStreaming: false, orderedBlocks: markPendingToolCallsAsError(m.orderedBlocks ?? []) } : m
        ))
      }
    }
  }, [store])

  const selectThread = async (threadId: string) => {
    if (!threadId) return
    const runningThreads = store.get(runningThreadsAtom)
    if (!runningThreads.has(threadId)) store.set(updateThreadRunStateAtom, { threadId, state: 'idle' })
    latestSelectRequestThreadIdRef.current = threadId
    store.set(isThreadLoadingAtom, true)
    const checkStale = () => {
      if (latestSelectRequestThreadIdRef.current !== threadId) return true
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
      if (isMountedRef.current) {
        const workspace = workspacePath ? makeWorkspace(workspacePath) : null
        const loadedMsgs = (rawMessages || []).filter((m): m is ThreadMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant').map((m, idx) => {
          let blocks: StreamBlock[] | undefined
          try { blocks = m.data ? JSON.parse(m.data) : undefined } catch (e) { console.error('Failed to parse message blocks:', e) }
          return { id: m.id ?? `msg-${idx}`, role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content), orderedBlocks: Array.isArray(blocks) ? blocks : undefined, timestamp: new Date(m.createdAt ?? Date.now()).getTime(), isStreaming: false }
        })
        store.set(updateThreadWorkspaceAtom, { threadId, workspace })
        store.set(updateThreadMessagesAtom, {
          threadId,
          update: prev => {
            const liveStreaming = prev.filter(m => m.isStreaming)
            if (!liveStreaming.length) return loadedMsgs
            const liveIds = new Set(liveStreaming.map(m => m.id))
            return [...loadedMsgs.filter(m => !liveIds.has(m.id)), ...liveStreaming]
          }
        })
        store.set(updateThreadTokensAtom, { threadId, session: fresh?.accumulatedTokens ?? 0, lifetime: fresh?.lifetimeTokens ?? 0 })
        store.set(activeThreadIdAtom, threadId)
        store.set(isThreadLoadingAtom, false)
      }
    } catch (err) {
      console.error('[useChat] Failed to load thread:', err)
      if (!checkStale() && isMountedRef.current) store.set(isThreadLoadingAtom, false)
      throw err
    }
  }

  const newConversation = async (workspacePath?: string | null) => {
    try {
      const activeWorkspace = store.get(activeWorkspaceAtom)
      const targetWsPath = workspacePath !== undefined ? workspacePath : (activeWorkspace?.path || null)
      const { conversationId: newId } = await threadService.newConversation(targetWsPath)
      const workspace = targetWsPath ? makeWorkspace(targetWsPath) : null
      store.set(updateThreadWorkspaceAtom, { threadId: newId, workspace })
      store.set(updateThreadRunStateAtom, { threadId: newId, state: 'idle' })
      store.set(updateThreadMessagesAtom, { threadId: newId, update: [] })
      store.set(updateThreadTokensAtom, { threadId: newId, session: 0, lifetime: 0 })
      store.set(updateThreadOpenFilesAtom, { threadId: newId, openFiles: [] })
      store.set(updateThreadActiveEditorFileAtom, { threadId: newId, file: null })
      store.set(updateThreadArtifactsAtom, { threadId: newId, artifacts: [] })
      if (targetWsPath) await workspaceService.setActiveWorkspace(newId, targetWsPath)
      store.set(activeThreadIdAtom, newId); resetThreadScopedPanels(); await loadThreads(); return newId
    } catch (err) { console.error('[useChat] New conversation error:', err); throw err }
  }

  const deleteThread = async (threadId: string) => {
    try {
      window.api.stopStream(threadId)
      removeFromRunning(threadId)
      await threadService.deleteThread(threadId); store.set(threadListAtom, prev => prev.filter(t => t.id !== threadId))
      if (store.get(activeThreadIdAtom) === threadId) {
        store.set(activeThreadIdAtom, ''); resetThreadScopedPanels()
      }
    } catch (err) { console.error('[useChat] Delete thread error:', err); throw err }
  }

  const closeAndDeleteWorkspace = async (path: string) => {
    try {
      const activeWorkspace = store.get(activeWorkspaceAtom)
      if (activeWorkspace?.path === path) {
        const curId = store.get(activeThreadIdAtom); if (curId) window.api.stopStream(curId)
        store.set(activeThreadIdAtom, ''); resetThreadScopedPanels()
      }
      const success = await workspaceService.closeAndDeleteWorkspace(path)
      if (success) await loadThreads()
      return success
    } catch (err) { console.error('[useChat] Close & delete workspace error:', err); throw err }
  }

  const openWorkspace = async () => {
    try {
      const prevId = store.get(activeThreadIdAtom); let currentId = prevId; let createdNew = false
      const messages = store.get(chatMessagesAtom)
      if (!currentId || messages.length > 0) { currentId = await newConversation(); createdNew = true }
      const ctx = await workspaceService.selectWorkspace(currentId)
      if (ctx) {
        resetThreadScopedPanels()
        store.set(updateThreadWorkspaceAtom, { threadId: currentId, workspace: makeWorkspace(ctx.rootPath) })
        const tList = await threadService.getThreads(); if (isMountedRef.current) store.set(threadListAtom, tList ?? [])
        const wThreads = (tList ?? []).filter(t => t.id !== currentId && t.workspacePath && normalizeSeparators(t.workspacePath) === normalizeSeparators(ctx.rootPath))
        if (wThreads.length > 0) {
          wThreads.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
          if (createdNew) await threadService.deleteThread(currentId)
          await selectThread(wThreads[0].id)
        } else { await selectThread(currentId) }
        await loadThreads(); return ctx
      } else if (createdNew) {
        await threadService.deleteThread(currentId); if (prevId) await selectThread(prevId); else store.set(activeThreadIdAtom, '')
        await loadThreads()
      }
      return null
    } catch (err) { console.error('[useChat] Open workspace error:', err); throw err }
  }

  const run = async (promptText: string, attachments?: StreamPayload['attachments'], forceThreadId?: string) => {
    const activeThreadId = store.get(activeThreadIdAtom)
    const resolvedThreadId = forceThreadId || activeThreadId || `session-${window.crypto.randomUUID()}`
    if (isRunningMapRef.current[resolvedThreadId]) return
    isRunningMapRef.current[resolvedThreadId] = true
    try {
      cancelFlush(resolvedThreadId)
      const threads = store.get(threadListAtom)
      const existingThread = threads.find(t => t.id === resolvedThreadId)
      const isNewThread = !existingThread || existingThread.title === 'New Chat'
      if (resolvedThreadId !== activeThreadId && isMountedRef.current) store.set(activeThreadIdAtom, resolvedThreadId)
      store.set(updateThreadRunStateAtom, { threadId: resolvedThreadId, state: 'thinking' })
      store.set(runningThreadsAtom, prev => new Set(prev).add(resolvedThreadId))
      const startTimeVal = Date.now()
      const userMsgId = window.crypto.randomUUID()
      const assistantMsgId = window.crypto.randomUUID()
      store.set(updateThreadMessagesAtom, { threadId: resolvedThreadId, update: prev => [...prev, { id: userMsgId, role: 'user', content: promptText, data: attachments?.length ? JSON.stringify({ attachments }) : undefined, timestamp: startTimeVal }] })
      store.set(updateThreadMessagesAtom, { threadId: resolvedThreadId, update: prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', orderedBlocks: [], timestamp: startTimeVal, isStreaming: true }] })
      if (isNewThread) {
        threadService.generateTitle(promptText.slice(0, 400), resolvedThreadId)
          .then(async () => { try { const tList = await threadService.getThreads(); if (isMountedRef.current) store.set(threadListAtom, tList ?? []) } catch (e) { console.error(e) } })
          .catch((err) => { console.error('[useChat] Title generation failed:', err); toast.error('Failed to generate thread title') })
      }
      let fullContent = ''
      const orderedBlocks: StreamBlock[] = []
      let assistantIsStreaming = true
      const flushNow = () => {
        cancelFlush(resolvedThreadId)
        if (!isMountedRef.current) return
        const snapshot = [...orderedBlocks]
        store.set(updateThreadMessagesAtom, { threadId: resolvedThreadId, update: prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming } : m) })
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
          else { orderedBlocks[orderedBlocks.length - 1] = { ...last, content: last.content + chunkText }; scheduleFlush() }
        } else if (chunkType === 'tool_call_start') {
          store.set(updateThreadRunStateAtom, { threadId: resolvedThreadId, state: 'tool-calling' })
          orderedBlocks.push({ type: 'tool_call', tool_call_id: chunkData?.tool_call_id as string ?? window.crypto.randomUUID(), tool_name: chunkData?.tool_name as string ?? 'unknown', args: {} as Record<string, unknown>, args_delta: '', status: 'pending' })
          flushNow()
        } else if (chunkType === 'tool_call_delta') {
          const tcId = chunkData?.tool_call_id as string, delta = chunkData?.delta as string ?? ''
          const idx = orderedBlocks.findIndex(b => b.type === 'tool_call' && b.tool_call_id === tcId)
          if (idx !== -1) { const old = orderedBlocks[idx]; if (old.type === 'tool_call') { orderedBlocks[idx] = { ...old, args_delta: (old.args_delta || '') + delta }; scheduleFlush() } }
        } else if (chunkType === 'tool_call') {
          store.set(updateThreadRunStateAtom, { threadId: resolvedThreadId, state: 'tool-calling' })
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
          const tcId = chunkData?.tool_call_id as string
          const idx = orderedBlocks.findIndex(b => b.type === 'tool_call' && b.tool_call_id === tcId)
          if (idx !== -1) scheduleFlush()
        } else if (chunkType === 'summarize') {
          orderedBlocks.push({ type: 'summarize', savedTokens: Number(chunkData?.savedTokens ?? 0), totalTokens: Number(chunkData?.totalTokens ?? 0) })
          flushNow()
        } else if (chunkType === 'error') {
          cancelFlush(resolvedThreadId)
          assistantIsStreaming = false
          const finalContent = chunkData?.content as string ?? fullContent
          const finalBlocks = markPendingToolCallsAsError(chunkData?.orderedBlocks as StreamBlock[] ?? orderedBlocks)
          finalBlocks.push({ type: 'error', message: cleanErrorMessage(chunkData?.message ?? chunk.payload) })
          store.set(updateThreadMessagesAtom, { threadId: resolvedThreadId, update: prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: finalContent, orderedBlocks: finalBlocks, isStreaming: false } : m) })
          store.set(updateThreadRunStateAtom, { threadId: resolvedThreadId, state: 'error' })
        } else if (chunkType === 'inject_queued') {
          if (chunkText) {
            flushNow()
            store.set(updateThreadMessagesAtom, {
              threadId: resolvedThreadId,
              update: prev => [
                ...prev,
                { id: window.crypto.randomUUID(), role: 'user', content: chunkText, timestamp: Date.now() }
              ]
            })
          }
        } else if (chunkType === 'token_update') {
          if (chunkData?.accumulatedTokens !== undefined || chunkData?.lifetimeTokens !== undefined) {
            store.set(updateThreadTokensAtom, {
              threadId: resolvedThreadId,
              session: chunkData.accumulatedTokens !== undefined ? Number(chunkData.accumulatedTokens) : undefined,
              lifetime: chunkData.lifetimeTokens !== undefined ? Number(chunkData.lifetimeTokens) : undefined
            })
          }
        } else if (chunkType === 'approval_request') {
          store.set(updatePendingApprovalAtom, { threadId: resolvedThreadId, approval: chunkData ? { toolCallId: chunkData.toolCallId as string, toolName: chunkData.toolName as string, args: (chunkData.args ?? {}) as Record<string, any> } : null })
        } else if (chunkType === 'finish') {
          cancelFlush(resolvedThreadId)
          assistantIsStreaming = false
          const finalContent = chunkData?.content as string ?? fullContent
          store.set(updateThreadMessagesAtom, { threadId: resolvedThreadId, update: prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: finalContent, orderedBlocks: m.orderedBlocks ?? orderedBlocks, isStreaming: false } : m) })
          store.set(updateThreadTokensAtom, { threadId: resolvedThreadId, session: Number(chunkData?.accumulatedTokens ?? 0), lifetime: chunkData?.lifetimeTokens !== undefined ? Number(chunkData.lifetimeTokens) : undefined })
          store.set(updateThreadRunStateAtom, { threadId: resolvedThreadId, state: 'idle' })
          removeFromRunning(resolvedThreadId)
        }
      }
      try {
        const selectedModel = store.get(selectedModelAtom)
        await window.api.stream({ promptText, threadId: resolvedThreadId, modelType: selectedModel, attachments, startTime: startTimeVal, userMsgId, assistantMsgId }, processChunk)
      } catch (err: unknown) {
        if (!isMountedRef.current) return
        cancelFlush(resolvedThreadId)
        assistantIsStreaming = false
        const errorMsg = err instanceof Error ? err.message : String(err)
        const isCrashError = errorMsg.includes('Utility worker'), isAbortError = (err instanceof Error && err.name === 'AbortError') || errorMsg === 'terminated' || errorMsg.includes('aborted')
        if (!isCrashError && !isAbortError) {
          console.error('[useChat] Invocation Error:', err)
          store.set(updateThreadMessagesAtom, { threadId: resolvedThreadId, update: prev => prev.map(m => m.id !== assistantMsgId ? m : { ...m, isStreaming: false, orderedBlocks: [...markPendingToolCallsAsError(m.orderedBlocks ?? []), { type: 'error', message: cleanErrorMessage(errorMsg) }] }) })
          store.set(updateThreadRunStateAtom, { threadId: resolvedThreadId, state: 'error' })
        } else if (isAbortError) {
          store.set(updateThreadMessagesAtom, { threadId: resolvedThreadId, update: prev => prev.map(m => !m.isStreaming ? m : { ...m, isStreaming: false, orderedBlocks: markPendingToolCallsAsError(m.orderedBlocks ?? []) }) })
          store.set(updateThreadRunStateAtom, { threadId: resolvedThreadId, state: 'idle' })
        }
      }
    } finally {
      isRunningMapRef.current[resolvedThreadId] = false
      removeFromRunning(resolvedThreadId)
    }
  }

  return { run, stop, loadThreads, selectThread, newConversation, deleteThread, openWorkspace, closeAndDeleteWorkspace }
}
