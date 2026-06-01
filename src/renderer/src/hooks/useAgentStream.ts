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
  const threadIdRef = useRef<string>(conversationId)

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
  }, [])

  useEffect(() => {
    return () => { cleanupActiveStream() }
  }, [cleanupActiveStream])

  // #1 fix: run is stable with useCallback — deps are exactly the values it reads
  // #2 fix: capture isNewThread at call time before any async work or atom mutation
  const run = useCallback(async (promptText: string, mode?: string, attachments?: any[]) => {
    cleanupActiveStream()

    // #2 fix: capture current thread identity at invocation time — not from closure captures
    const resolvedThreadId = activeThreadId ?? conversationId
    const isNewThread = !activeThreadId  // #3 fix: capture before setActiveThreadId
    threadIdRef.current = resolvedThreadId

    if (isNewThread) {
      setActiveThreadId(conversationId)
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: promptText,
      data: attachments && attachments.length > 0 ? JSON.stringify({ attachments }) : undefined,
      timestamp: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])

    const assistantMsgId = `assistant-${Date.now()}`
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
      // #20 fix: orderedBlocks is mutated directly during streaming — it's a local
      // variable committed to state only via flushAssistant(). No immutability needed here.
      const orderedBlocks: StreamBlock[] = []
      let currentReasoningStartMs = 0
      let assistantIsStreaming = true

      const flushAssistant = (force = false) => {
        const update = () => {
          // Take a snapshot of orderedBlocks at flush time
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

      unsubscribeRef.current = window.api.onAgentChunk((chunk) => {
        try {
          if (!chunk) return
          const chunkType = chunk.type
          const chunkData = chunk.payload

          if (chunkType === 'reasoning-start') {
            currentReasoningStartMs = Date.now()
            orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0, isStreaming: true })
            flushAssistant()
          } else if (chunkType === 'reasoning-delta') {
            const textDelta = typeof chunkData === 'string' ? chunkData : ''
            // Find the last streaming reasoning block using a backward loop — O(1), no array allocation
            let streamingReasoning: Extract<StreamBlock, { type: 'reasoning' }> | undefined
            for (let i = orderedBlocks.length - 1; i >= 0; i--) {
              const b = orderedBlocks[i]
              if (b.type === 'reasoning' && b.isStreaming) { streamingReasoning = b as Extract<StreamBlock, { type: 'reasoning' }>; break }
            }
            if (streamingReasoning) {
              streamingReasoning.content += textDelta
              streamingReasoning.durationMs = Date.now() - currentReasoningStartMs
            }
            flushAssistant()
          } else if (chunkType === 'reasoning-end') {
            let streamingReasoning: Extract<StreamBlock, { type: 'reasoning' }> | undefined
            for (let i = orderedBlocks.length - 1; i >= 0; i--) {
              const b = orderedBlocks[i]
              if (b.type === 'reasoning' && b.isStreaming) { streamingReasoning = b as Extract<StreamBlock, { type: 'reasoning' }>; break }
            }
            if (streamingReasoning) {
              streamingReasoning.durationMs = Date.now() - currentReasoningStartMs
              streamingReasoning.isStreaming = false
            }
            flushAssistant()
          } else if (chunkType === 'text-delta') {
            const textDelta = typeof chunkData === 'string' ? chunkData : ''
            fullContent += textDelta

            // Close any streaming reasoning block
            let streamingReasoning: Extract<StreamBlock, { type: 'reasoning' }> | undefined
            for (let i = orderedBlocks.length - 1; i >= 0; i--) {
              const b = orderedBlocks[i]
              if (b.type === 'reasoning' && b.isStreaming) { streamingReasoning = b as Extract<StreamBlock, { type: 'reasoning' }>; break }
            }
            if (streamingReasoning) {
              streamingReasoning.isStreaming = false
              streamingReasoning.durationMs = Date.now() - currentReasoningStartMs
            }

            // Mutate last text block or push new one
            const last = orderedBlocks[orderedBlocks.length - 1]
            if (!last || last.type !== 'text') {
              orderedBlocks.push({ type: 'text', content: textDelta })
            } else {
              (last as Extract<StreamBlock, { type: 'text' }>).content += textDelta
            }
            flushAssistant()
          } else if (chunkType === 'tool-call') {
            setRunState('tool-calling')

            // Close streaming reasoning if open
            let streamingReasoning: Extract<StreamBlock, { type: 'reasoning' }> | undefined
            for (let i = orderedBlocks.length - 1; i >= 0; i--) {
              const b = orderedBlocks[i]
              if (b.type === 'reasoning' && b.isStreaming) { streamingReasoning = b as Extract<StreamBlock, { type: 'reasoning' }>; break }
            }
            if (streamingReasoning) {
              streamingReasoning.isStreaming = false
              streamingReasoning.durationMs = Date.now() - currentReasoningStartMs
            }

            const tcId = chunkData?.toolCallId ?? `tc-${Date.now()}`
            const tcName = chunkData?.toolName ?? 'unknown'
            const tcArgs = (chunkData?.args as Record<string, unknown>) ?? {}
            orderedBlocks.push({ type: 'tool', toolCallId: tcId, toolName: tcName, args: tcArgs, status: 'pending' })
            flushAssistant()

          } else if (chunkType === 'tool-result') {
            const tcId = chunkData?.toolCallId

            const toolBlock = orderedBlocks.find(
              (b) => b.type === 'tool' && (b as any).toolCallId === tcId
            ) as Extract<StreamBlock, { type: 'tool' }> | undefined

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
            fullContent += `\n\n[System Error: ${chunkData ?? 'Unknown Error'}]`
            assistantIsStreaming = false

            for (const block of orderedBlocks) {
              if (block.type === 'tool' && block.status === 'pending') {
                block.status = 'error'
              }
            }

            // Explicitly push a text block containing the error so ChatThread's block map renders it
            orderedBlocks.push({
              type: 'text',
              content: `\n\n[System Error: ${chunkData ?? 'Unknown Error'}]`
            })

            flushAssistant(true)
            setRunState('error')
            if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }
          } else if (chunkType === 'finish') {
            assistantIsStreaming = false

            const accumulatedTokens = Number(chunkData?.accumulatedTokens ?? 0)
            const compactionTriggered = !!chunkData?.compactionTriggered

            setSessionTokens(accumulatedTokens)

            if (compactionTriggered && !orderedBlocks.some((b) => b.type === 'compaction')) {
              orderedBlocks.push({ type: 'compaction' })
            }

            flushAssistant(true)
            setRunState('idle')

            if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }

            // #3 fix: use isNewThread captured at call-start, not the stale atom value
            if (isNewThread && (fullContent || orderedBlocks.length > 0)) {
              const titleText = promptText.slice(0, 200) + ' ' + fullContent.slice(0, 200)
              window.api.generateTitle(titleText, threadIdRef.current)
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

  // #18 fix: stop() explicitly calls stopAgentStream — no reliance on abort event chain
  const stop = useCallback(() => {
    const tid = threadIdRef.current
    cleanupActiveStream()
    setRunState('idle')
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)))
    window.api.stopAgentStream(tid).catch(console.error)
  }, [cleanupActiveStream, setRunState, setMessages])

  return { run, stop }
}
