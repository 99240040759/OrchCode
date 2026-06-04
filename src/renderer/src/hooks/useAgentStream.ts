import { useRef, useEffect, useCallback } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  agentRunStateAtom,
  chatMessagesAtom,
  activeThreadIdAtom,
  threadListAtom,
  filesChangedAtom,
  sessionTokensAtom,
  selectedModelAtom,
  type ChatMessage,
  type StreamBlock,
  type FileChangeEntry
} from '../store/agentStore'
import { parseToolFileOp, isToolResultError } from '../lib/parseToolFileOp'
import { cleanErrorMessage } from '../lib/cleanErrorMessage'

// ─── File Change Extractor (uses shared parseToolFileOp) ─────────────────────

function extractFileChange(
  toolName: string,
  args: Record<string, unknown>
): FileChangeEntry | null {
  const fileTools = ['writeToFile', 'replaceFileContent', 'multiReplaceFileContent']
  if (!fileTools.includes(toolName)) return null

  const op = parseToolFileOp(toolName, args)
  if (!op.fullPath) return null

  const name = op.fullPath.split(/[/\\]/).pop() ?? op.fullPath
  return {
    path: op.fullPath,
    name,
    toolName,
    additions: op.additions,
    deletions: op.deletions,
    lineRange: op.lineRange,
    timestamp: Date.now()
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgentStream() {
  // Single unified thread ID atom (conversationIdAtom is now the same atom)
  const [activeThreadId, setActiveThreadId] = useAtom(activeThreadIdAtom)
  const setRunState = useSetAtom(agentRunStateAtom)
  const setMessages = useSetAtom(chatMessagesAtom)
  const messages = useAtomValue(chatMessagesAtom)
  const setThreads = useSetAtom(threadListAtom)
  const setFilesChanged = useSetAtom(filesChangedAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  // Ref to capture current messages.length without adding messages to run's dep array
  // (messages in deps would recreate run() on every streaming update → re-subscription races)
  const messagesLengthRef = useRef(messages.length)
  messagesLengthRef.current = messages.length

  // Removed: abortRef — the abort controller was wired to nothing (streamAgent doesn't
  // accept a signal through the IPC bridge). Stop is handled exclusively via stopAgentStream IPC.
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const activeStreamThreadIdRef = useRef<string>('')

  const currentReasoningBlockRef = useRef<Extract<StreamBlock, { type: 'reasoning' }> | null>(null)

  const cleanupActiveStream = useCallback(() => {
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
    return () => {
      cleanupActiveStream()
    }
  }, [cleanupActiveStream])

  const run = useCallback(
    async (promptText: string, mode?: string, attachments?: any[], forceThreadId?: string) => {
      cleanupActiveStream()

      // Use explicit forceThreadId if provided (from newConversation or selectThread),
      // otherwise fall back to the current atom value.
      // If neither exists, generate a UUID now so the IPC call always has a valid thread ID.
      // Determine if this is a new thread:
      // - No existing active thread (first ever message), OR
      // - The conversation currently has no messages (freshly created thread)
      const isNewThread = !activeThreadId || messagesLengthRef.current === 0
      const resolvedThreadId =
        forceThreadId ?? activeThreadId ?? `session-${crypto.randomUUID()}`

      activeStreamThreadIdRef.current = resolvedThreadId

      if (resolvedThreadId !== activeThreadId) {
        setActiveThreadId(resolvedThreadId)
      }

      // Reset file changes for this run
      setFilesChanged([])

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
                  ? {
                      ...m,
                      content: fullContent,
                      orderedBlocks: snapshot,
                      isStreaming: assistantIsStreaming
                    }
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

        const streamThreadId = resolvedThreadId

        if (unsubscribeRef.current) {
          unsubscribeRef.current()
          unsubscribeRef.current = null
        }

        unsubscribeRef.current = window.agentBridge.onAgentChunk((chunk) => {
          try {
            if (!chunk || chunk.threadId !== streamThreadId) return

            const chunkType = chunk.type
            const chunkData = chunk.payload

            if (chunkType === 'reasoning-start') {
              currentReasoningStartMs = Date.now()
              const block: Extract<StreamBlock, { type: 'reasoning' }> = {
                type: 'reasoning',
                content: '',
                durationMs: 0,
                isStreaming: true
              }
              orderedBlocks.push(block)
              currentReasoningBlockRef.current = block
              flushAssistant()
            } else if (chunkType === 'reasoning-delta') {
              const textDelta = typeof chunkData === 'string' ? chunkData : ''
              const lastIdx = orderedBlocks.length - 1
              if (lastIdx >= 0 && orderedBlocks[lastIdx].type === 'reasoning') {
                const old = orderedBlocks[lastIdx] as Extract<StreamBlock, { type: 'reasoning' }>
                const updated = {
                  ...old,
                  content: old.content + textDelta,
                  durationMs: Date.now() - currentReasoningStartMs
                }
                orderedBlocks[lastIdx] = updated
                currentReasoningBlockRef.current = updated
              }
              flushAssistant()
            } else if (chunkType === 'reasoning-end') {
              const lastIdx = orderedBlocks.length - 1
              if (lastIdx >= 0 && orderedBlocks[lastIdx].type === 'reasoning') {
                const old = orderedBlocks[lastIdx] as Extract<StreamBlock, { type: 'reasoning' }>
                orderedBlocks[lastIdx] = {
                  ...old,
                  durationMs: Date.now() - currentReasoningStartMs,
                  isStreaming: false
                }
              }
              currentReasoningBlockRef.current = null
              flushAssistant()
            } else if (chunkType === 'text-delta') {
              const textDelta = typeof chunkData === 'string' ? chunkData : ''
              fullContent += textDelta

              const lastIdx = orderedBlocks.length - 1
              if (lastIdx >= 0 && orderedBlocks[lastIdx].type === 'reasoning') {
                const old = orderedBlocks[lastIdx] as Extract<StreamBlock, { type: 'reasoning' }>
                orderedBlocks[lastIdx] = {
                  ...old,
                  isStreaming: false,
                  durationMs: Date.now() - currentReasoningStartMs
                }
              }
              currentReasoningBlockRef.current = null

              const newLastIdx = orderedBlocks.length - 1
              const last = newLastIdx >= 0 ? orderedBlocks[newLastIdx] : null
              if (!last || last.type !== 'text') {
                orderedBlocks.push({ type: 'text', content: textDelta })
              } else {
                orderedBlocks[newLastIdx] = {
                  ...last,
                  content: last.content + textDelta
                }
              }
              flushAssistant()
            } else if (chunkType === 'tool-call-streaming-start') {
              setRunState('tool-calling')

              const lastIdx = orderedBlocks.length - 1
              if (lastIdx >= 0 && orderedBlocks[lastIdx].type === 'reasoning') {
                const old = orderedBlocks[lastIdx] as Extract<StreamBlock, { type: 'reasoning' }>
                orderedBlocks[lastIdx] = {
                  ...old,
                  isStreaming: false,
                  durationMs: Date.now() - currentReasoningStartMs
                }
              }
              currentReasoningBlockRef.current = null

              const tcId = chunkData?.toolCallId ?? crypto.randomUUID()
              const tcName = chunkData?.toolName ?? 'unknown'
              orderedBlocks.push({
                type: 'tool',
                toolCallId: tcId,
                toolName: tcName,
                args: {},
                argsDelta: '',
                status: 'pending'
              })
              flushAssistant()
            } else if (chunkType === 'tool-call-delta') {
              const tcId = chunkData?.toolCallId
              const delta = chunkData?.delta ?? ''
              const idx = orderedBlocks.findIndex(
                (b) => b.type === 'tool' && b.toolCallId === tcId
              )
              if (idx !== -1) {
                const oldBlock = orderedBlocks[idx] as Extract<StreamBlock, { type: 'tool' }>
                orderedBlocks[idx] = {
                  ...oldBlock,
                  argsDelta: (oldBlock.argsDelta || '') + delta
                }
              }
              flushAssistant()
            } else if (chunkType === 'tool-call') {
              setRunState('tool-calling')

              const lastIdx = orderedBlocks.length - 1
              if (lastIdx >= 0 && orderedBlocks[lastIdx].type === 'reasoning') {
                const old = orderedBlocks[lastIdx] as Extract<StreamBlock, { type: 'reasoning' }>
                orderedBlocks[lastIdx] = {
                  ...old,
                  isStreaming: false,
                  durationMs: Date.now() - currentReasoningStartMs
                }
              }
              currentReasoningBlockRef.current = null

              const tcId = chunkData?.toolCallId ?? crypto.randomUUID()
              const tcName = chunkData?.toolName ?? 'unknown'
              const tcArgs = (chunkData?.args as Record<string, unknown>) ?? {}
              const idx = orderedBlocks.findIndex(
                (b) => b.type === 'tool' && b.toolCallId === tcId
              )
              if (idx !== -1) {
                const oldBlock = orderedBlocks[idx] as Extract<StreamBlock, { type: 'tool' }>
                orderedBlocks[idx] = {
                  ...oldBlock,
                  args: tcArgs,
                  argsDelta: undefined
                }
              } else {
                orderedBlocks.push({
                  type: 'tool',
                  toolCallId: tcId,
                  toolName: tcName,
                  args: tcArgs,
                  status: 'pending'
                })
              }
              flushAssistant()
            } else if (chunkType === 'tool-result') {
              const tcId = chunkData?.toolCallId
              const idx = orderedBlocks.findIndex(
                (b) => b.type === 'tool' && b.toolCallId === tcId
              )

              if (idx !== -1) {
                const toolBlock = orderedBlocks[idx] as Extract<StreamBlock, { type: 'tool' }>
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
                orderedBlocks[idx] = {
                  ...toolBlock,
                  result: res,
                  status: isToolResultError(res) ? 'error' : 'complete',
                  argsDelta: undefined
                }
              }

              flushAssistant()
              setRunState('streaming')
            } else if (chunkType === 'error') {
              console.error('[useAgentStream] Error chunk:', chunkData)
              assistantIsStreaming = false

              // Mark all pending tool blocks as errored
              for (let i = 0; i < orderedBlocks.length; i++) {
                const block = orderedBlocks[i]
                if (block.type === 'tool' && block.status === 'pending') {
                  orderedBlocks[i] = {
                    ...block,
                    status: 'error'
                  }
                }
              }

              orderedBlocks.push({
                type: 'error',
                message: cleanErrorMessage(chunkData)
              })

              flushAssistant(true)
              setRunState('error')
              if (unsubscribeRef.current) {
                unsubscribeRef.current()
                unsubscribeRef.current = null
              }
            } else if (chunkType === 'step-limit') {
              // Only fires if model hits token length limit (our step limit is removed)
              orderedBlocks.push({
                type: 'text',
                content:
                  '\n\n> **⚠️ The model hit its context limit.** You can ask me to continue from where I left off.'
              })
              flushAssistant()
            } else if (chunkType === 'token-update') {
              // Live update between agent steps — keeps the token ring accurate during streaming
              const liveTokens = Number(chunkData?.accumulatedTokens ?? 0)
              if (liveTokens > 0) setSessionTokens(liveTokens)
            } else if (chunkType === 'finish') {
              assistantIsStreaming = false
              currentReasoningBlockRef.current = null

              const accumulatedTokens = Number(chunkData?.accumulatedTokens ?? 0)
              setSessionTokens(accumulatedTokens)

              flushAssistant(true)
              setRunState('idle')

              if (unsubscribeRef.current) {
                unsubscribeRef.current()
                unsubscribeRef.current = null
              }

              // Generate title for new threads
              if (isNewThread && (fullContent || orderedBlocks.length > 0)) {
                const titleText = promptText.slice(0, 200) + ' ' + fullContent.slice(0, 200)
                window.threadsBridge
                  .generateTitle(titleText, streamThreadId)
                  .then(async () => {
                    try {
                      const threads = await window.threadsBridge.getThreads()
                      setThreads(threads ?? [])
                    } catch (err) {
                      console.error('[useAgentStream] Failed to refresh threads after title generation:', err)
                    }
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

        await window.agentBridge.streamAgent(promptText, resolvedThreadId, mode, selectedModel, attachments)
      } catch (err: any) {
        // IPC-level error (not stream error)
        console.error('[useAgentStream] Invocation Error:', err)
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === assistantMsgId) {
              const updatedBlocks = (m.orderedBlocks ?? []).map((b) =>
                b.type === 'tool' && b.status === 'pending'
                  ? { ...b, status: 'error' as const }
                  : b
              )
              return {
                ...m,
                isStreaming: false,
                orderedBlocks: [
                  ...updatedBlocks,
                  {
                    type: 'error' as const,
                    message: cleanErrorMessage(err?.message || err)
                  }
                ]
              }
            }
            return m
          })
        )
        setRunState('error')
        cleanupActiveStream()
      }
    },
    [
      activeThreadId,
      selectedModel,
      setActiveThreadId,
      setMessages,
      setRunState,
      setThreads,
      setFilesChanged,
      setSessionTokens,
      cleanupActiveStream
    ]
  )

  const stop = useCallback(() => {
    const tid = activeStreamThreadIdRef.current
    cleanupActiveStream()
    setRunState('idle')
    // Mark all pending tool blocks as error so they don't spin forever
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.isStreaming) return m
        return {
          ...m,
          isStreaming: false,
          orderedBlocks: (m.orderedBlocks ?? []).map((b) =>
            b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b
          )
        }
      })
    )
    window.agentBridge.stopAgentStream(tid).catch(console.error)
  }, [cleanupActiveStream, setRunState, setMessages])

  return { run, stop }
}
