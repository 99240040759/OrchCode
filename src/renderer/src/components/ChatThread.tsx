import React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  chatMessagesAtom,
  agentRunStateAtom,
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom
} from '../store/agentStore'
import ToolCallBlock from './ToolCallBlock'
import type { ChatMessage } from '../store/agentStore'
import { ChevronDown } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import './ChatThread.css'

const decodeBase64 = (base64Str: string): string => {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(base64Str), (c) => c.charCodeAt(0)))
  } catch {
    return 'Failed to decode content'
  }
}

const UserMessage = React.memo(
  ({ message }: { message: ChatMessage }) => {
    let attachments: Array<{
      type: 'image' | 'document'
      name: string
      mimeType?: string
      base64: string
    }> = []
    if (message.data) {
      try {
        const dataObj = JSON.parse(message.data)
        if (dataObj && Array.isArray(dataObj.attachments)) {
          attachments = dataObj.attachments
        }
      } catch {}
    }

    const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
    const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
    const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

    return (
      <div className="chat-message-user-container">
        <div className="chat-message-user chat-message-user-content">
          {attachments.length > 0 && (
            <div className="message-attachments">
              {attachments.map((att, idx) => {
                const handleOpenDoc = () => {
                  setActiveEditorFile({
                    name: att.name,
                    path: att.name,
                    isBinary: false,
                    mimeType: att.mimeType || 'text/plain',
                    content: decodeBase64(att.base64)
                  })
                  setArtifactPanelMode('editor')
                  setArtifactPanelOpen(true)
                }
                const handleOpenImg = () => {
                  setActiveEditorFile({
                    name: att.name,
                    path: att.name,
                    isBinary: true,
                    mimeType: att.mimeType || 'image/png',
                    base64: att.base64
                  })
                  setArtifactPanelMode('editor')
                  setArtifactPanelOpen(true)
                }

                return (
                  <div
                    key={idx}
                    className="message-attachment-chip"
                    onClick={att.type === 'image' ? handleOpenImg : handleOpenDoc}
                    title={att.name}
                  >
                    {att.type === 'image' ? (
                      <img
                        src={`data:${att.mimeType || 'image/png'};base64,${att.base64}`}
                        alt={att.name}
                      />
                    ) : (
                      <SymbolsFileIcon
                        fileName={att.name.split('/').pop() || att.name}
                        autoAssign={true}
                        width={14}
                        height={14}
                        className="chat-attachment-icon"
                      />
                    )}
                    <span className="chat-attachment-name">
                      {att.name.split('/').pop() || att.name}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {message.content && (
            <div>
              <MarkdownRenderer content={message.content} />
            </div>
          )}
        </div>
      </div>
    )
  },
  (prev, next) => {
    return (
      prev.message.id === next.message.id &&
      prev.message.content === next.message.content &&
      prev.message.data === next.message.data
    )
  }
)
UserMessage.displayName = 'UserMessage'

const ReasoningBlock = React.memo(
  ({
    content,
    durationMs,
    isStreaming
  }: {
    content: string
    durationMs?: number
    isStreaming?: boolean
  }) => {
    const [isOpen, setIsOpen] = React.useState(isStreaming ?? false)
    const [userToggled, setUserToggled] = React.useState(false)
    const scrollRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      if (isStreaming && !userToggled) setIsOpen(true)
      if (!isStreaming && !userToggled) setIsOpen(false)
    }, [isStreaming, userToggled])

    React.useEffect(() => {
      if (isStreaming && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    }, [content, isStreaming])

    const seconds = durationMs ? Math.round(durationMs / 1000).toString() : ''
    const title = isStreaming
      ? `Thinking${seconds ? ` for ${seconds}s` : ''}`
      : `Thought for ${seconds}s`

    return (
      <details
        open={isOpen}
        onToggle={(e) => {
          const targetOpen = (e.target as HTMLDetailsElement).open
          if (targetOpen !== isOpen) {
            setUserToggled(true)
            setIsOpen(targetOpen)
          }
        }}
        className="chat-reasoning-details"
      >
        <summary className="chat-reasoning-summary chat-reasoning-summary-content">
          <span>{title}</span>
          <ChevronDown size={14} className="chat-reasoning-chevron" />
        </summary>

        <div ref={scrollRef} className="assistant-content chat-reasoning-body">
          <MarkdownRenderer content={content || 'Thinking...'} />
        </div>
      </details>
    )
  },
  (prev, next) => {
    return (
      prev.content === next.content &&
      prev.durationMs === next.durationMs &&
      prev.isStreaming === next.isStreaming
    )
  }
)
ReasoningBlock.displayName = 'ReasoningBlock'

const AssistantMessage = React.memo(
  ({ message }: { message: ChatMessage }) => (
    <div className="chat-message-assistant-container">
      {message.orderedBlocks?.map((block: any, i: number) => {
        if (block.type === 'reasoning') {
          return (
            <ReasoningBlock
              key={`reasoning-${i}`}
              content={block.content}
              durationMs={block.durationMs}
              isStreaming={block.isStreaming}
            />
          )
        }
        if (block.type === 'tool') {
          const toolCall = {
            id: block.toolCallId,
            toolName: block.toolName,
            args: block.args,
            result: block.result,
            status: block.status
          }
          return (
            <div key={`tool-${i}`}>
              <ToolCallBlock toolCall={toolCall as any} />
            </div>
          )
        }
        if (block.type === 'text') {
          return (
            <div key={`text-${i}`} className="assistant-content chat-message-assistant">
              <MarkdownRenderer content={block.content} />
              {message.isStreaming && i === (message.orderedBlocks?.length ?? 0) - 1 && (
                <div className="chat-message-generating-container">
                  <span className="shimmer-text chat-message-generating-text">Generating</span>
                </div>
              )}
            </div>
          )
        }
        if (block.type === 'compaction') {
          return (
            <div key={`compaction-${i}`} className="chat-compaction-container">
              <div className="chat-compaction-line" />
              <span className="chat-compaction-label">
                — conversation compacted above this point —
              </span>
              <div className="chat-compaction-line" />
            </div>
          )
        }
        return null
      })}

      {!message.orderedBlocks && (
        <>
          {message.content && (
            <div className="assistant-content chat-message-assistant">
              <MarkdownRenderer content={message.content} />
            </div>
          )}
        </>
      )}

      {message.isStreaming && (!message.orderedBlocks || message.orderedBlocks.length === 0) && (
        <div className="chat-message-generating-container">
          <span className="shimmer-text chat-message-generating-text">Thinking</span>
        </div>
      )}
    </div>
  ),
  (prev, next) => {
    if (prev.message.id !== next.message.id) return false
    if (next.message.isStreaming) return false
    if (prev.message.isStreaming !== next.message.isStreaming) return false
    if (prev.message.content !== next.message.content) return false
    const pb = prev.message.orderedBlocks
    const nb = next.message.orderedBlocks
    if (pb?.length !== nb?.length) return false
    if (pb && nb && pb.length > 0) {
      for (let i = 0; i < pb.length; i++) {
        const p = pb[i]
        const n = nb[i]
        if (p.type !== n.type) return false
        if (p.type === 'text' && n.type === 'text' && p.content !== n.content) return false
        if (p.type === 'reasoning' && n.type === 'reasoning') {
          if (p.content !== n.content || p.isStreaming !== n.isStreaming) return false
        }
        if (p.type === 'tool' && n.type === 'tool') {
          if (p.status !== n.status || p.result !== n.result) return false
        }
      }
    }
    return true
  }
)
AssistantMessage.displayName = 'AssistantMessage'

const ChatThread: React.FC = () => {
  const messages = useAtomValue(chatMessagesAtom)
  const runState = useAtomValue(agentRunStateAtom)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const isAtBottomRef = React.useRef(true)
  const prevLengthRef = React.useRef(messages.length)
  const prevRunStateRef = React.useRef(runState)

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 80
  }

  React.useEffect(() => {
    if (!containerRef.current) return
    const isStreaming = runState !== 'idle' && runState !== 'error'
    const wasStreaming = prevRunStateRef.current !== 'idle' && prevRunStateRef.current !== 'error'
    const hasNewMessage = messages.length > prevLengthRef.current

    prevLengthRef.current = messages.length
    prevRunStateRef.current = runState

    if (hasNewMessage || (isStreaming && !wasStreaming)) {
      const performScroll = () => {
        if (!containerRef.current) return
        const { scrollHeight, clientHeight } = containerRef.current
        if (isAtBottomRef.current) {
          containerRef.current.scrollTo({
            top: scrollHeight - clientHeight,
            behavior: isStreaming ? 'auto' : 'smooth'
          })
        }
      }
      const rafId = requestAnimationFrame(performScroll)
      return () => cancelAnimationFrame(rafId)
    }
    return undefined
  }, [messages, runState])

  if (messages.length === 0) return null

  return (
    <div ref={containerRef} onScroll={handleScroll} className="chat-thread-container">
      <div className="chat-thread-spacer-top" />
      {messages.map((message) => (
        <div key={message.id} className="chat-thread-message-wrapper">
          {message.role === 'user' ? (
            <UserMessage message={message} />
          ) : (
            <AssistantMessage message={message} />
          )}
        </div>
      ))}
      <div className="chat-thread-spacer-bottom" />
      <div className="chat-thread-anchor" />
    </div>
  )
}

export default ChatThread
