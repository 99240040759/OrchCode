import React, { useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { chatMessagesAtom, agentRunStateAtom } from '../store/agentStore'
import ToolCallBlock from './ToolCallBlock'
import type { ChatMessage } from '../store/agentStore'
import { ChevronDown } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'

const renderMarkdown = (text: string) => <MarkdownRenderer content={text} />

const UserMessage = ({ message }: { message: ChatMessage }) => {
  let attachments: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }> = []
  if (message.data) {
    try {
      const dataObj = JSON.parse(message.data)
      if (dataObj && Array.isArray(dataObj.attachments)) {
        attachments = dataObj.attachments
      }
    } catch {}
  }

  return (
    <div className="chat-message-user-container">
      <div className="chat-message-user" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {attachments.length > 0 && (
          <div className="message-attachments">
            {attachments.map((att, idx) => (
              <div key={idx} className="message-attachment-chip">
                {att.type === 'image' ? (
                  <img
                    src={`data:${att.mimeType || 'image/png'};base64,${att.base64}`}
                    alt={att.name}
                    onClick={() => {
                      const win = window.open()
                      if (win) {
                        win.document.write(`<img src="data:${att.mimeType || 'image/png'};base64,${att.base64}" style="max-width:100%; max-height:100%; display:block; margin:auto;" />`)
                      }
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 13 }}>📄</span>
                )}
                <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.name}
                </span>
              </div>
            ))}
          </div>
        )}
        {message.content && <div>{message.content}</div>}
      </div>
    </div>
  )
}

const ReasoningBlock: React.FC<{ content: string; durationMs?: number; isStreaming?: boolean }> = ({ content, durationMs, isStreaming }) => {
  const [isOpen, setIsOpen] = useState(isStreaming ?? false)
  const [userToggled, setUserToggled] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isStreaming && !userToggled) setIsOpen(true)
    if (!isStreaming && !userToggled) setIsOpen(false)
  }, [isStreaming, userToggled])

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming])

  const seconds = durationMs ? Math.round(durationMs / 1000).toString() : ''
  const title = isStreaming ? `Thinking${seconds ? ` for ${seconds}s` : ''}` : `Thought for ${seconds}s`

  return (
    <details
      open={isOpen}
      onToggle={(e) => {
        setIsOpen((e.target as HTMLDetailsElement).open)
      }}
      className="chat-reasoning-details"
    >
      <summary
        onClick={() => setUserToggled(true)}
        className="chat-reasoning-summary"
      >
        {title}
        <ChevronDown
          size={14}
          className="chat-reasoning-chevron"
          style={{
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'
          }}
        />
      </summary>

      <div
        ref={scrollRef}
        className="assistant-content chat-reasoning-body"
      >
        {renderMarkdown(content || 'Thinking...')}
      </div>
    </details>
  )
}

const AssistantMessage = ({ message }: { message: ChatMessage }) => (
  <div className="chat-message-assistant-container">
    {message.orderedBlocks?.map((block: any, i: number) => {
      if (block.type === 'reasoning') {
        return <ReasoningBlock key={`reasoning-${i}`} content={block.content} durationMs={block.durationMs} isStreaming={block.isStreaming} />
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
          <div key={`tool-${i}`} style={{ marginBottom: '2px' }}>
            <ToolCallBlock toolCall={toolCall as any} />
          </div>
        )
      }
      if (block.type === 'text') {
        return (
          <div
            key={`text-${i}`}
            className="assistant-content chat-message-assistant"
          >
            {renderMarkdown(block.content)}
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
          <div
            key={`compaction-${i}`}
            className="chat-compaction-container"
          >
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
          <div
            className="assistant-content chat-message-assistant"
          >
            {renderMarkdown(message.content)}
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
)

const ChatThread: React.FC = () => {
  const messages = useAtomValue(chatMessagesAtom)
  const runState = useAtomValue(agentRunStateAtom)
  const containerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevLengthRef = useRef(messages.length)

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 80  // #39 fix: tighter threshold
    isAtBottomRef.current = isAtBottom
  }

  useEffect(() => {
    if (!containerRef.current) return
    const { scrollHeight, clientHeight } = containerRef.current
    // #19 fix: derive isStreaming from runState atom — O(1) vs O(n) message scan
    const isStreaming = runState !== 'idle' && runState !== 'error'
    const hasNewMessage = messages.length > prevLengthRef.current
    prevLengthRef.current = messages.length

    if (isStreaming) {
      if (isAtBottomRef.current) {
        containerRef.current.scrollTo({
          top: scrollHeight - clientHeight,
          behavior: 'auto'
        })
      }
    } else if (hasNewMessage) {
      containerRef.current.scrollTo({
        top: scrollHeight - clientHeight,
        behavior: 'smooth'
      })
    }
  }, [messages, runState])

  if (messages.length === 0) return null

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="sidebar-body chat-thread-container"
    >
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
    </div>
  )
}

export default ChatThread
