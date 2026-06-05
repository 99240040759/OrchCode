import { useRef, useCallback } from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import {
  agentRunStateAtom,
  chatMessagesAtom,
  activeThreadIdAtom,
  threadListAtom,
  sessionTokensAtom,
  selectedModelAtom,
  type ChatMessage,
  type StreamBlock
} from '../store/agentStore'
import { cleanErrorMessage } from '../lib/cleanErrorMessage'
import type { StreamChunk } from '../../../preload/index.d'

// Inline: determine if a tool result represents an error
function isToolResultError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  if ('success' in r && r.success === false) return true
  if ('type' in r && typeof r.type === 'string') {
    if (r.type === 'error-text' || r.type === 'error-json') return true
  }
  return false
}

export function useAgentStream() {
  const [activeThreadId, setActiveThreadId] = useAtom(activeThreadIdAtom)
  const setRunState = useSetAtom(agentRunStateAtom)
  const setMessages = useSetAtom(chatMessagesAtom)
  const messages = useAtomValue(chatMessagesAtom)
  const setThreads = useSetAtom(threadListAtom)
  const setSessionTokens = useSetAtom(sessionTokensAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  const messagesLengthRef = useRef(messages.length)
  messagesLengthRef.current = messages.length

  const activeStreamThreadIdRef = useRef<string>('')
  const rafIdRef = useRef<number | null>(null)

  const run = useCallback(
    async (promptText: string, _mode?: string, attachments?: any[], forceThreadId?: string) => {
      const isNewThread = !activeThreadId || messagesLengthRef.current === 0
      const resolvedThreadId = forceThreadId || activeThreadId || `session-${crypto.randomUUID()}`
      activeStreamThreadIdRef.current = resolvedThreadId

      if (resolvedThreadId !== activeThreadId) setActiveThreadId(resolvedThreadId)

      setRunState('thinking')

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: promptText,
        data: attachments?.length ? JSON.stringify({ attachments }) : undefined,
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, userMsg])

      const assistantMsgId = crypto.randomUUID()
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: 'assistant', content: '', orderedBlocks: [], timestamp: Date.now(), isStreaming: true }
      ])

      let fullContent = ''
      const orderedBlocks: StreamBlock[] = []
      let currentReasoningStartMs = 0
      let assistantIsStreaming = true

      const scheduleFlush = () => {
        if (rafIdRef.current !== null) return
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          const snapshot = [...orderedBlocks]
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming }
                : m
            )
          )
        })
      }

      const flushNow = () => {
        if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
        const snapshot = [...orderedBlocks]
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: fullContent, orderedBlocks: snapshot, isStreaming: assistantIsStreaming }
              : m
          )
        )
      }

      const processChunk = (chunk: StreamChunk) => {
        if (!chunk || chunk.threadId !== resolvedThreadId) return

        const chunkType = chunk.type
        const chunkData = chunk.payload && typeof chunk.payload === 'object'
          ? (chunk.payload as Record<string, unknown>)
          : undefined
        const chunkText = typeof chunk.payload === 'string' ? chunk.payload : ''

        if (chunkType === 'reasoning-start') {
          currentReasoningStartMs = Date.now()
          orderedBlocks.push({ type: 'reasoning', content: '', durationMs: 0, isStreaming: true })
          scheduleFlush()
        } else if (chunkType === 'reasoning-delta') {
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (last?.type === 'reasoning') {
            orderedBlocks[orderedBlocks.length - 1] = {
              ...last, content: last.content + chunkText,
              durationMs: Date.now() - currentReasoningStartMs
            }
          }
          scheduleFlush()
        } else if (chunkType === 'reasoning-end') {
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (last?.type === 'reasoning') {
            orderedBlocks[orderedBlocks.length - 1] = { ...last, durationMs: Date.now() - currentReasoningStartMs, isStreaming: false }
          }
          scheduleFlush()
        } else if (chunkType === 'text-delta') {
          fullContent += chunkText
          const last = orderedBlocks[orderedBlocks.length - 1]
          if (!last || last.type !== 'text') orderedBlocks.push({ type: 'text', content: chunkText })
          else orderedBlocks[orderedBlocks.length - 1] = { ...last, content: last.content + chunkText }
          scheduleFlush()
        } else if (chunkType === 'tool-call-streaming-start') {
          setRunState('tool-calling')
          const tcId = (chunkData?.toolCallId as string) ?? crypto.randomUUID()
          const tcName = (chunkData?.toolName as string) ?? 'unknown'
          orderedBlocks.push({ type: 'tool', toolCallId: tcId, toolName: tcName, args: {}, argsDelta: '', status: 'pending' })
          scheduleFlush()
        } else if (chunkType === 'tool-call-delta') {
          const tcId = chunkData?.toolCallId as string
          const delta = (chunkData?.delta as string) ?? ''
          const idx = orderedBlocks.findIndex((b) => b.type === 'tool' && b.toolCallId === tcId)
          if (idx !== -1) {
            const old = orderedBlocks[idx] as Extract<StreamBlock, { type: 'tool' }>
            orderedBlocks[idx] = { ...old, argsDelta: (old.argsDelta || '') + delta }
          }
          scheduleFlush()
        } else if (chunkType === 'tool-call') {
          setRunState('tool-calling')
          const tcId = (chunkData?.toolCallId as string) ?? crypto.randomUUID()
          const tcName = (chunkData?.toolName as string) ?? 'unknown'
          const tcArgs = (chunkData?.args as Record<string, unknown>) ?? {}
          const idx = orderedBlocks.findIndex((b) => b.type === 'tool' && b.toolCallId === tcId)
          if (idx !== -1) {
            const old = orderedBlocks[idx] as Extract<StreamBlock, { type: 'tool' }>
            orderedBlocks[idx] = { ...old, args: tcArgs, argsDelta: undefined }
          } else {
            orderedBlocks.push({ type: 'tool', toolCallId: tcId, toolName: tcName, args: tcArgs, status: 'pending' })
          }
          scheduleFlush()
        } else if (chunkType === 'tool-result') {
          const tcId = chunkData?.toolCallId as string
          const idx = orderedBlocks.findIndex((b) => b.type === 'tool' && b.toolCallId === tcId)
          if (idx !== -1) {
            const old = orderedBlocks[idx] as Extract<StreamBlock, { type: 'tool' }>
            orderedBlocks[idx] = {
              ...old,
              result: chunkData?.result,
              status: isToolResultError(chunkData?.result) ? 'error' : 'complete',
              argsDelta: undefined
            }
          }
          scheduleFlush()
          setRunState('streaming')
        } else if (chunkType === 'error') {
          assistantIsStreaming = false
          for (let i = 0; i < orderedBlocks.length; i++) {
            if (orderedBlocks[i].type === 'tool' && (orderedBlocks[i] as any).status === 'pending') {
              orderedBlocks[i] = { ...orderedBlocks[i], status: 'error' } as StreamBlock
            }
          }
          orderedBlocks.push({ type: 'error', message: cleanErrorMessage(chunk.payload) })
          flushNow()
          setRunState('error')
        } else if (chunkType === 'step-limit') {
          orderedBlocks.push({ type: 'text', content: '\n\n> **⚠️ The model hit its context limit.** You can ask me to continue from where I left off.' })
          scheduleFlush()
        } else if (chunkType === 'token-update') {
          const liveTokens = Number((chunkData as any)?.accumulatedTokens ?? 0)
          if (liveTokens > 0) setSessionTokens(liveTokens)
        } else if (chunkType === 'finish') {
          assistantIsStreaming = false
          const accumulatedTokens = Number((chunkData as any)?.accumulatedTokens ?? 0)
          setSessionTokens(accumulatedTokens)
          flushNow()
          setRunState('idle')

          if (isNewThread && (fullContent || orderedBlocks.length > 0)) {
            const titleText = promptText.slice(0, 200) + ' ' + fullContent.slice(0, 200)
            window.api.invoke('thread:generate-title', { text: titleText, threadId: resolvedThreadId })
              .then(async () => {
                try {
                  const threads = await window.api.invoke('thread:list') as any[]
                  setThreads(threads ?? [])
                } catch {}
              })
              .catch(console.error)
          }
        }
      }

      setRunState('streaming')

      try {
        await window.api.stream(
          { promptText, threadId: resolvedThreadId, modelType: selectedModel, attachments },
          processChunk
        )
      } catch (err: any) {
        console.error('[useAgentStream] Invocation Error:', err)
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsgId) return m
            const updatedBlocks = (m.orderedBlocks ?? []).map((b) =>
              b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b
            )
            return {
              ...m, isStreaming: false,
              orderedBlocks: [...updatedBlocks, { type: 'error' as const, message: cleanErrorMessage(err?.message || err) }]
            }
          })
        )
        setRunState('error')
      }
    },
    [activeThreadId, selectedModel, setActiveThreadId, setMessages, setRunState, setThreads, setSessionTokens]
  )

  const stop = useCallback(() => {
    const tid = activeStreamThreadIdRef.current
    setRunState('idle')
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.isStreaming) return m
        return {
          ...m, isStreaming: false,
          orderedBlocks: (m.orderedBlocks ?? []).map((b) =>
            b.type === 'tool' && b.status === 'pending' ? { ...b, status: 'error' as const } : b
          )
        }
      })
    )
    window.api.invoke('agent:stop', { threadId: tid }).catch(console.error)
  }, [setRunState, setMessages])

  return { run, stop }
}
