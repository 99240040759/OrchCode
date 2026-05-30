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
      for (const c of chunks) {
        if (c && typeof c === 'object') {
          if ('replacementContent' in c) additions += countLines(c.replacementContent)
          const s = (c as any).startLine
          const e = (c as any).endLine
          if (typeof s === 'number' && typeof e === 'number') deletions += e - s + 1
        }
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

  const run = async (promptText: string, mode?: string) => {
    cleanupActiveStream()

    const threadId = activeThreadId ?? conversationId
    threadIdRef.current = threadId

    if (!activeThreadId) {
      setActiveThreadId(conversationId)
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: promptText,
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
      let orderedBlocks: StreamBlock[] = []
      let currentReasoningStartMs = 0
      let assistantIsStreaming = true

      const flushAssistant = (force = false) => {
        const update = () => {
          setMessages((prev) => {
            const hasMsg = prev.some((m) => m.id === assistantMsgId)
            if (!hasMsg) {
              return [
                ...prev,
                {
                  id: assistantMsgId,
                  role: 'assistant' as const,
                  content: fullContent,
                  orderedBlocks: [...orderedBlocks],
                  timestamp: Date.now(),
                  isStreaming: assistantIsStreaming
                }
              ]
            }
            return prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: fullContent, orderedBlocks: [...orderedBlocks], isStreaming: assistantIsStreaming }
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
            orderedBlocks = [...orderedBlocks, { type: 'reasoning', content: '', durationMs: 0, isStreaming: true }]
            flushAssistant()
          } else if (chunkType === 'reasoning-delta') {
            const textDelta = typeof chunkData === 'string' ? chunkData : ''
            orderedBlocks = orderedBlocks.map((block) => {
              if (block.type === 'reasoning' && block.isStreaming) {
                return { ...block, content: block.content + textDelta, durationMs: Date.now() - currentReasoningStartMs }
              }
              return block
            })
            flushAssistant()
          } else if (chunkType === 'reasoning-end') {
            orderedBlocks = orderedBlocks.map((block) => {
              if (block.type === 'reasoning' && block.isStreaming) {
                return { ...block, durationMs: Date.now() - currentReasoningStartMs, isStreaming: false }
              }
              return block
            })
            flushAssistant()
          } else if (chunkType === 'text-delta') {
            const textDelta = typeof chunkData === 'string' ? chunkData : ''
            fullContent += textDelta

            orderedBlocks = orderedBlocks.map((block) => {
              if (block.type === 'reasoning' && block.isStreaming) {
                return { ...block, isStreaming: false, durationMs: Date.now() - currentReasoningStartMs }
              }
              return block
            })

            const last = orderedBlocks[orderedBlocks.length - 1]
            if (!last || last.type !== 'text') {
              orderedBlocks = [...orderedBlocks, { type: 'text', content: textDelta }]
            } else {
              orderedBlocks = orderedBlocks.map((block, idx) => {
                if (idx === orderedBlocks.length - 1 && block.type === 'text') {
                  return { ...block, content: block.content + textDelta }
                }
                return block
              })
            }
            flushAssistant()
          } else if (chunkType === 'tool-call') {
            setRunState('tool-calling')

            orderedBlocks = orderedBlocks.map((block) => {
              if (block.type === 'reasoning' && block.isStreaming) {
                return { ...block, isStreaming: false, durationMs: Date.now() - currentReasoningStartMs }
              }
              return block
            })

            const tcId = chunkData?.toolCallId ?? `tc-${Date.now()}`
            const tcName = chunkData?.toolName ?? 'unknown'
            const tcArgs = (chunkData?.args as Record<string, unknown>) ?? {}
            orderedBlocks = [...orderedBlocks, { type: 'tool', toolCallId: tcId, toolName: tcName, args: tcArgs, status: 'pending' }]
            flushAssistant()
          } else if (chunkType === 'tool-result') {
            const tcId = chunkData?.toolCallId

            orderedBlocks = orderedBlocks.map((block) => {
              if (block.type === 'tool' && block.toolCallId === tcId) {
                const fileChange = extractFileChange(block.toolName, block.args)
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
                const status = isErr ? ('error' as const) : ('complete' as const)
                return { ...block, result: chunkData?.result, status }
              }
              return block
            })

            flushAssistant()
            setRunState('streaming')
          } else if (chunkType === 'error') {
            console.error('[useAgentStream] Error chunk:', chunkData)
            fullContent += `\n\n[System Error: ${chunkData ?? 'Unknown Error'}]`
            assistantIsStreaming = false

            orderedBlocks = orderedBlocks.map((block) => {
              if (block.type === 'tool' && block.status === 'pending') {
                return { ...block, status: 'error' as const }
              }
              return block
            })

            flushAssistant(true)
            setRunState('error')
            if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }
          } else if (chunkType === 'finish') {
            assistantIsStreaming = false

            const accumulatedTokens = Number(chunkData?.accumulatedTokens ?? 0)
            const compactionTriggered = !!chunkData?.compactionTriggered

            setSessionTokens(accumulatedTokens)

            if (compactionTriggered) {
              if (!orderedBlocks.some((b) => b.type === 'compaction')) {
                orderedBlocks = [...orderedBlocks, { type: 'compaction' }]
              }
            }

            flushAssistant(true)
            setRunState('idle')

            if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }

            if (!activeThreadId && (fullContent || orderedBlocks.length > 0)) {
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

      const abortHandler = () => {
        cleanupActiveStream()
        window.api.stopAgentStream(threadIdRef.current).catch(console.error)
      }
      abortRef.current.signal.addEventListener('abort', abortHandler)

      await window.api.streamAgent(promptText, threadIdRef.current, mode, selectedModel)

      if (abortRef.current) {
        abortRef.current.signal.removeEventListener('abort', abortHandler)
      }
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
  }

  const stop = () => {
    cleanupActiveStream()
    setRunState('idle')
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)))
  }

  return { run, stop }
}
