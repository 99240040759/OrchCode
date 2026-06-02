import { useRef, useEffect, useCallback } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  agentRunStateAtom,
  chatMessagesAtom,
  activeThreadIdAtom,
  conversationIdAtom,
  threadListAtom,
  filesChangedAtom,
  sessionTokensAtom,
  selectedModelAtom,
  type ChatMessage,
  type StreamBlock,
  type FileChangeEntry
} from '../store/agentStore'

function countLines(content: unknown): number {
  if (typeof content !== 'string') return 0
  return content.split('\n').length
}

function extractFileChange(toolName: string, args: Record<string, unknown>): FileChangeEntry | null {
  const fileTools = ['writeToFile', 'replaceFileContent', 'multiReplaceFileContent']
  if (!fileTools.includes(toolName)) return null

  let path = ''
  let additions = 0
  let deletions = 0
  let lineRange = ''

  const targetFile = args.targetFile
  if (typeof targetFile === 'string') path = targetFile

  if (toolName === 'writeToFile') {
    if ('codeContent' in args) additions = countLines(args.codeContent)
  } else if (toolName === 'replaceFileContent') {
    const startLine = args.startLine
    const endLine = args.endLine
    if (typeof startLine === 'number' && typeof endLine === 'number') {
      lineRange = `L${startLine}-${endLine}`
      deletions = endLine - startLine + 1
    }
    if ('replacementContent' in args) additions = countLines(args.replacementContent)
  } else if (toolName === 'multiReplaceFileContent') {
    const chunks = args.replacementChunks
    if (Array.isArray(chunks)) {
      let minLine = Infinity
      let maxLine = -Infinity
      for (const c of chunks) {
        if (c && typeof c === 'object') {
          if ('replacementContent' in c) additions += countLines(c.replacementContent)
          const s = (c as any).startLine
          const e = (c as any).endLine
          if (typeof s === 'number' && typeof e === 'number') {
            deletions += e - s + 1
            if (s < minLine) minLine = s
            if (e > maxLine) maxLine = e
          }
        }
      }
      if (minLine !== Infinity && maxLine !== -Infinity) {
        lineRange = `L${minLine}-${maxLine}`
      }
    }
  }

  if (!path) return null
  const name = path.split(/[/\\]/).pop() ?? path
  return { path, name, toolName, additions, deletions, lineRange, timestamp: Date.now() }
}

export function useAgentStream() {
  const conversationId = useAtomValue(conversationIdAtom)
  const [activeThreadId, setActiveThreadId] = useAtom(activeThreadIdAtom)
  const setRunState = useSetAtom(agentRunStateAtom)
  const setMessages = useSetAtom(chatMessagesAtom)
  const setThreads = useSetAtom(threadListAtom)
  const setFilesChanged = useSetAtom(filesChangedAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  const abortRef = useRef<AbortController | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const rafIdRef = useRef<number | null>(null)
  // Tracks the threadId of the currently active stream — immutable once set per invocation.
  // Used inside the chunk listener closure to reject chunks from prior streams.
  const activeStreamThreadIdRef = useRef<string>('')

  // O(1) direct pointer to the current streaming reasoning block — avoids O(n) backward scan per chunk
  const currentReasoningBlockRef = useRef<Extract<StreamBlock, { type: 'reasoning' }> | null>(null)

  const cleanupActiveStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    currentReasoningBlockRef.current = null
    activeStreamThreadIdRef.current = ''
  }, [])

  useEffect(() => {
    return () => { cleanupActiveStream() }
  }, [cleanupActiveStream])

  const run = useCallback(async (promptText: string, mode?: string, attachments?: any[]) => {
    cleanupActiveStream()

    const resolvedThreadId = activeThreadId ?? conversationId
    const isNewThread = !activeThreadId
    activeStreamThreadIdRef.current = resolvedThreadId

    if (isNewThread) {
      setActiveThreadId(conversationId)
    }

    // UI-11: Set 'thinking' state IMMEDIATELY when run() is called — before the
    // IPC call. This ensures the stop button is visible and spinning during the
    // 10-second chatStreamLimiter queue wait, so users know their message was received.
    setRunState('thinking')

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: promptText,
      data: attachments && attachments.length > 0 ? JSON.stringify({ attachments }) : undefined,
      timestamp: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])

    const assistantMsgId = crypto.randomUUID()
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      orderedBlocks: [],
      timestamp: Date.now(),
      isStreaming: true
    }
    setMessages((prev) => [...prev, assistantMsg])
    setRunState('thinking')

    abortRef.current = new AbortController()

    try {
      let fullContent = ''
      const orderedBlocks: StreamBlock[] = []
      let currentReasoningStartMs = 0
      let assistantIsStreaming = true

      const flushAssistant = (force = false) => {
        const update = () => {
          const snapshot = [...orderedBlocks]
          setMessages((prev) => {
            const hasMsg = prev.some((m) => m.id === assistantMsgId)
            if (!hasMsg) {
              return [
                ...prev,
                {
                  id: assistantMsgId,
                  role: 'assistant' as const,
                  content: fullContent,
                  orderedBlocks: snapshot,
                  timestamp: Date.now(),
                  isStreaming: assistantIsStreaming
                }
              ]
            }
            return prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming }
                : m
            )
          })
        }
        if (force) {
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current)
            rafIdRef.current = null
          }
          update()
          return
        }
        if (rafIdRef.current !== null) return
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          update()
        })
      }

      setRunState('streaming')

      // Capture the stream's threadId at subscription time — the closure holds this
      // immutable value. Chunks from any prior or future stream are rejected.
      const streamThreadId = resolvedThreadId

      // CRIT-9: Assign unsubscribeRef before the IPC call so cleanup always works.
      // Defensive guard: if the subscription somehow fails, we don't leak the old ref.
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      unsubscribeRef.current = window.api.onAgentChunk((chunk) => {
        try {
          if (!chunk) return
          // Reject chunks that don't belong to this specific stream invocation
          if (chunk.threadId && chunk.threadId !== streamThreadId) return
          const chunkType = chunk.type
          const chunkData = chunk.payload

          if (chunkType === 'reasoning-start') {
            currentReasoningStartMs = Date.now()
            const block: Extract<StreamBlock, { type: 'reasoning' }> = {
              type: 'reasoning', content: '', durationMs: 0, isStreaming: true
            }
            orderedBlocks.push(block)
            currentReasoningBlockRef.current = block
            flushAssistant()
          } else if (chunkType === 'reasoning-delta') {
            const textDelta = typeof chunkData === 'string' ? chunkData : ''
            const rb = currentReasoningBlockRef.current
            if (rb) {
              rb.content += textDelta
              rb.durationMs = Date.now() - currentReasoningStartMs
            }
            flushAssistant()
          } else if (chunkType === 'reasoning-end') {
            const rb = currentReasoningBlockRef.current
            if (rb) {
              rb.durationMs = Date.now() - currentReasoningStartMs
              rb.isStreaming = false
            }
            currentReasoningBlockRef.current = null
            flushAssistant()
          } else if (chunkType === 'text-delta') {
            const textDelta = typeof chunkData === 'string' ? chunkData : ''
            fullContent += textDelta

            const rb = currentReasoningBlockRef.current
            if (rb) {
              rb.isStreaming = false
              rb.durationMs = Date.now() - currentReasoningStartMs
              currentReasoningBlockRef.current = null
            }

            const last = orderedBlocks[orderedBlocks.length - 1]
            if (!last || last.type !== 'text') {
              orderedBlocks.push({ type: 'text', content: textDelta })
            } else {
              (last as Extract<StreamBlock, { type: 'text' }>).content += textDelta
            }
            flushAssistant()
          } else if (chunkType === 'tool-call') {
            setRunState('tool-calling')

            const rb = currentReasoningBlockRef.current
            if (rb) {
              rb.isStreaming = false
              rb.durationMs = Date.now() - currentReasoningStartMs
              currentReasoningBlockRef.current = null
            }

            const tcId = chunkData?.toolCallId ?? crypto.randomUUID()
            const tcName = chunkData?.toolName ?? 'unknown'
            const tcArgs = (chunkData?.args as Record<string, unknown>) ?? {}
            orderedBlocks.push({ type: 'tool', toolCallId: tcId, toolName: tcName, args: tcArgs, status: 'pending' })
            flushAssistant()

          } else if (chunkType === 'tool-result') {
            const tcId = chunkData?.toolCallId

            const toolBlock = orderedBlocks.find(
              (b): b is Extract<StreamBlock, { type: 'tool' }> =>
                b.type === 'tool' && b.toolCallId === tcId
            )

            if (toolBlock) {
              const fileChange = extractFileChange(toolBlock.toolName, toolBlock.args)
              if (fileChange) {
                setFilesChanged((prev) => {
                  const existingIdx = prev.findIndex((fc) => fc.path === fileChange.path)
                  if (existingIdx >= 0) {
                    const updated = [...prev]
                    const existing = prev[existingIdx]
                    updated[existingIdx] = {
                      ...fileChange,
                      additions: existing.additions + fileChange.additions,
                      deletions: existing.deletions + fileChange.deletions,
                      lineRange: fileChange.lineRange || existing.lineRange
                    }
                    return updated
                  }
                  return [...prev, fileChange]
                })
              }
              const res = chunkData?.result
              const isErr = res && (
                (typeof res === 'string' && (res.toLowerCase().includes('error:') || res.toLowerCase().includes('failed:') || res.toLowerCase().includes('traversal blocked'))) ||
                (typeof res === 'object' && ('error' in res || (res as any).success === false))
              )
              toolBlock.result = chunkData?.result
              toolBlock.status = isErr ? 'error' : 'complete'
            }

            flushAssistant()
            setRunState('streaming')
          } else if (chunkType === 'error') {
            console.error('[useAgentStream] Error chunk:', chunkData)
            assistantIsStreaming = false

            for (const block of orderedBlocks) {
              if (block.type === 'tool' && block.status === 'pending') {
                block.status = 'error'
              }
            }

            orderedBlocks.push({
              type: 'text',
              content: `\n\n[System Error: ${chunkData ?? 'Unknown Error'}]`
            })

            flushAssistant(true)
            setRunState('error')
            if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }
          } else if (chunkType === 'step-limit') {
            // MED-3: Agent hit the 50-step limit. Show a notification so users know
            // the agent stopped mid-task and they can ask it to continue.
            orderedBlocks.push({
              type: 'text',
              content: '\n\n> **⚠️ Agent reached the 50-step limit.** The task may be incomplete. Ask me to continue if needed.'
            })
            flushAssistant()
          } else if (chunkType === 'compaction-failed') {
            // MED-6: Compaction failed — silently note it, no UI disruption needed
            console.warn('[useAgentStream] Compaction failed for thread:', streamThreadId)
          } else if (chunkType === 'finish') {
            assistantIsStreaming = false
            currentReasoningBlockRef.current = null

            const accumulatedTokens = Number(chunkData?.accumulatedTokens ?? 0)
            const compactionTriggered = !!chunkData?.compactionTriggered

            setSessionTokens(accumulatedTokens)

            if (compactionTriggered && !orderedBlocks.some((b) => b.type === 'compaction')) {
              orderedBlocks.push({ type: 'compaction' })
            }

            flushAssistant(true)
            setRunState('idle')

            if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }

            if (isNewThread && (fullContent || orderedBlocks.length > 0)) {
              const titleText = promptText.slice(0, 200) + ' ' + fullContent.slice(0, 200)
              window.api.generateTitle(titleText, streamThreadId)
                .then(async () => {
                  try {
                    const threads = await window.api.getThreads()
                    setThreads(threads ?? [])
                  } catch {}
                })
                .catch(console.error)
            }
          }
        } catch (innerErr) {
          console.error('[useAgentStream] Uncaught error inside chunk processor:', innerErr)
          setRunState('error')
          cleanupActiveStream()
        }
      })

      await window.api.streamAgent(promptText, resolvedThreadId, mode, selectedModel, attachments)

    } catch (err: any) {
      if (err.name === 'AbortError') {
        setRunState('idle')
      } else {
        console.error('[useAgentStream] Invocation Error:', err)
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === assistantMsgId) {
              const updatedBlocks = (m.orderedBlocks ?? []).map((b) =>
                b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b
              )
              return {
                ...m,
                content: `Error: ${err.message || 'Unknown stream invocation error'}`,
                orderedBlocks: updatedBlocks,
                isStreaming: false
              }
            }
            return m
          })
        )
        setRunState('error')
      }
      cleanupActiveStream()
    }
  }, [activeThreadId, conversationId, selectedModel, setActiveThreadId, setMessages, setRunState,
      setThreads, setFilesChanged, setSessionTokens, cleanupActiveStream])

  const stop = useCallback(() => {
    const tid = activeStreamThreadIdRef.current
    cleanupActiveStream()
    setRunState('idle')
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)))
    window.api.stopAgentStream(tid).catch(console.error)
  }, [cleanupActiveStream, setRunState, setMessages])

  return { run, stop }
}
