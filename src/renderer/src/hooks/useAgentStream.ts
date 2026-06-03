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

// ─── Error Message Cleanup ────────────────────────────────────────────────────

function cleanErrorMessage(rawErr: unknown): string {
  if (!rawErr) return 'An unknown error occurred while processing the request.'

  // If it's an object, extract message directly
  if (typeof rawErr === 'object' && rawErr !== null) {
    const e = rawErr as any
    if (typeof e.message === 'string') return cleanErrorMessage(e.message)
    if (typeof e.error === 'string') return e.error
    if (typeof e.msg === 'string') return e.msg
  }

  const errorStr = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr)

  // Try JSON parse for nested error objects
  if (typeof rawErr === 'string') {
    try {
      const parsed = JSON.parse(rawErr)
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.message === 'string') return parsed.message
        if (typeof parsed.error === 'string') return parsed.error
        if (parsed.error?.message) return parsed.error.message
        if (typeof parsed.msg === 'string') return parsed.msg
        if (typeof parsed.description === 'string') return parsed.description
      }
    } catch {
      // not json, fall through
    }
  }

  if (
    errorStr.includes('apikey') ||
    errorStr.includes('Invalid API Key') ||
    errorStr.includes('Unauthorized') ||
    errorStr.includes('auth') ||
    errorStr.includes('API key')
  ) {
    return 'Authentication failed. Please check your account settings or sign in again.'
  }
  if (errorStr.includes('Failed to fetch') || errorStr.includes('fetch failed')) {
    return 'Unable to connect to the server. Please check your network connection and try again.'
  }
  if (errorStr.includes('model_not_found') || errorStr.includes('does not exist')) {
    return 'The selected AI model is temporarily unavailable. Please select another model.'
  }
  if (errorStr.includes('rate limit') || errorStr.includes('429')) {
    return 'Request limit reached. Please wait a moment before trying again.'
  }
  if (errorStr.includes('timeout') || errorStr.includes('504')) {
    return 'The request took too long to respond. Please try again in a few moments.'
  }

  // If it looks like a raw JSON blob, give a generic message
  if (errorStr.startsWith('{') && errorStr.endsWith('}')) {
    return 'An unexpected error occurred. Please try again.'
  }

  return errorStr
}

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
  const setThreads = useSetAtom(threadListAtom)
  const setFilesChanged = useSetAtom(filesChangedAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

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
      // otherwise fall back to the current atom value. This avoids async atom-read races.
      const resolvedThreadId = forceThreadId ?? activeThreadId
      const isNewThread = !activeThreadId && !forceThreadId

      activeStreamThreadIdRef.current = resolvedThreadId

      if (resolvedThreadId && resolvedThreadId !== activeThreadId) {
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

        unsubscribeRef.current = window.api.onAgentChunk((chunk) => {
          try {
            if (!chunk) return
            if (chunk.threadId && chunk.threadId !== streamThreadId) return

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
                ;(last as Extract<StreamBlock, { type: 'text' }>).content += textDelta
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
              orderedBlocks.push({
                type: 'tool',
                toolCallId: tcId,
                toolName: tcName,
                args: tcArgs,
                status: 'pending'
              })
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
                toolBlock.result = res
                toolBlock.status = isToolResultError(res) ? 'error' : 'complete'
                // Clear argsDelta once result arrives
                toolBlock.argsDelta = undefined
              }

              flushAssistant()
              setRunState('streaming')
            } else if (chunkType === 'error') {
              console.error('[useAgentStream] Error chunk:', chunkData)
              assistantIsStreaming = false

              // Mark all pending tool blocks as errored
              for (const block of orderedBlocks) {
                if (block.type === 'tool' && block.status === 'pending') {
                  block.status = 'error'
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
                window.api
                  .generateTitle(titleText, streamThreadId)
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
    window.api.stopAgentStream(tid).catch(console.error)
  }, [cleanupActiveStream, setRunState, setMessages])

  return { run, stop }
}
