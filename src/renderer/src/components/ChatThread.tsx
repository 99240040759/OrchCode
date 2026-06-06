import React from 'react'
import { useAtomValue, useSetAtom, useAtom } from 'jotai'
import type { PrimitiveAtom } from 'jotai'
import {
  chatMessageAtomsAtom,
  agentRunStateAtom,
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom
} from '../store/agentStore'
import ToolCallBlock from './ToolCallBlock'
import type { ChatMessage } from '../store/types'
import { ChevronDown, AlertTriangle, Copy, Check } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'

const decodeBase64 = (base64Str: string): string => {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(base64Str), (c) => c.charCodeAt(0)))
  } catch {
    return 'Failed to decode content'
  }
}

const UserMessage = ({ message }: { message: ChatMessage }) => {
  let attachments: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }> = []
  if (message.data) {
    try {
      const dataObj = JSON.parse(message.data)
      if (dataObj && Array.isArray(dataObj.attachments)) attachments = dataObj.attachments
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
                setActiveEditorFile({ name: att.name || 'attachment', path: att.name || '', isBinary: false, mimeType: att.mimeType || 'text/plain', content: decodeBase64(att.base64) })
                setArtifactPanelMode('editor')
                setArtifactPanelOpen(true)
              }
              const handleOpenImg = () => {
                setActiveEditorFile({ name: att.name || 'attachment', path: att.name || '', isBinary: true, mimeType: att.mimeType || 'image/png', base64: att.base64 })
                setArtifactPanelMode('editor')
                setArtifactPanelOpen(true)
              }
              return (
                <div key={idx} className="message-attachment-chip" onClick={att.type === 'image' ? handleOpenImg : handleOpenDoc} title={att.name || 'attachment'}>
                  {att.type === 'image' ? (
                    <img src={`data:${att.mimeType || 'image/png'};base64,${att.base64}`} alt={att.name || 'attachment'} className="message-attachment-chip-img" />
                  ) : (
                    <SymbolsFileIcon fileName={att.name ? (att.name.split('/').pop() || att.name) : 'attachment'} autoAssign={true} width={14} height={14} className="chat-attachment-icon" />
                  )}
                  <span className="chat-attachment-name">{att.name ? (att.name.split('/').pop() || att.name) : 'attachment'}</span>
                </div>
              )
            })}
          </div>
        )}
        {message.content && <div><MarkdownRenderer content={message.content} /></div>}
      </div>
    </div>
  )
}
UserMessage.displayName = 'UserMessage'

const ReasoningBlock = React.memo(
  ({ content, durationMs, isStreaming }: { content: string; durationMs?: number; isStreaming?: boolean }) => {
    const [isOpen, setIsOpen] = React.useState(isStreaming ?? false)
    const [userToggled, setUserToggled] = React.useState(false)
    const scrollRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      if (isStreaming && !userToggled) setIsOpen(true)
      if (!isStreaming && !userToggled) setIsOpen(false)
    }, [isStreaming, userToggled])

    React.useEffect(() => {
      if (isStreaming && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }, [content, isStreaming])

    const seconds = durationMs ? Math.round(durationMs / 1000).toString() : ''
    const title = isStreaming ? `Thinking${seconds ? ` for ${seconds}s` : ''}` : `Thought for ${seconds}s`

    return (
      <details
        open={isOpen}
        onToggle={(e) => {
          const targetOpen = (e.target as HTMLDetailsElement).open
          if (targetOpen !== isOpen) { setUserToggled(true); setIsOpen(targetOpen) }
        }}
        className="chat-reasoning-details"
      >
        <summary className="chat-reasoning-summary">
          <span>{title}</span>
          <ChevronDown size={14} className="chat-reasoning-chevron" />
        </summary>
        <div ref={scrollRef} className="assistant-content chat-reasoning-body">
          <MarkdownRenderer content={content || 'Thinking...'} />
        </div>
      </details>
    )
  },
  (prev, next) => prev.content === next.content && prev.durationMs === next.durationMs && prev.isStreaming === next.isStreaming
)
ReasoningBlock.displayName = 'ReasoningBlock'

const AssistantMessage = React.memo(({ message }: { message: ChatMessage }) => (
  <div className="chat-message-assistant-container">
    {message.orderedBlocks?.map((block: any, i: number) => {
      if (block.type === 'reasoning') {
        return <ReasoningBlock key={`reasoning-${i}`} content={block.content} durationMs={block.durationMs} isStreaming={block.isStreaming} />
      }
      if (block.type === 'tool') {
        const toolCall = { id: block.toolCallId, toolName: block.toolName, args: block.args, result: block.result, status: block.status }
        const isPendingTool = block.status === 'pending'
        const isLastBlock = i === (message.orderedBlocks?.length ?? 0) - 1
        return (
          <div key={`tool-${i}`}>
            <ToolCallBlock toolCall={toolCall} />
            {message.isStreaming && isLastBlock && isPendingTool && (
              <div className="chat-message-generating-container">
                <span className="shimmer-text chat-message-generating-text">Working</span>
              </div>
            )}
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
      if (block.type === 'error') {
        return (
          <div key={`error-${i}`} className="chat-error-container">
            <AlertTriangle size={15} className="chat-error-icon" />
            <span className="chat-error-message">{block.message}</span>
          </div>
        )
      }
      return null
    })}

    {!message.orderedBlocks && message.content && (
      <div className="assistant-content chat-message-assistant">
        <MarkdownRenderer content={message.content} />
      </div>
    )}

    {message.isStreaming && (!message.orderedBlocks || message.orderedBlocks.length === 0) && (
      <div className="chat-message-generating-container">
        <span className="shimmer-text chat-message-generating-text">Thinking</span>
      </div>
    )}
  </div>
), (prev, next) => {
  if (prev.message.isStreaming !== next.message.isStreaming) return false
  if (prev.message.orderedBlocks !== next.message.orderedBlocks) return false
  if (prev.message.content !== next.message.content) return false
  return true
})
AssistantMessage.displayName = 'AssistantMessage'

const atomKeyMap = new WeakMap<object, string>()
let atomKeyCounter = 0
const getAtomKey = (a: object) => { let k = atomKeyMap.get(a); if (!k) atomKeyMap.set(a, k = `msg-${atomKeyCounter++}`); return k }

const ChatThread: React.FC = () => {
  const messageAtoms = useAtomValue(chatMessageAtomsAtom)
  const runState = useAtomValue(agentRunStateAtom)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const isAtBottomRef = React.useRef(true)
  const prevLengthRef = React.useRef(messageAtoms.length)
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
    const hasNewMessage = messageAtoms.length > prevLengthRef.current
    prevLengthRef.current = messageAtoms.length
    prevRunStateRef.current = runState
    if (hasNewMessage || (isStreaming && !wasStreaming)) {
      const performScroll = () => {
        if (!containerRef.current) return
        const { scrollHeight, clientHeight } = containerRef.current
        if (isAtBottomRef.current) containerRef.current.scrollTo({ top: scrollHeight - clientHeight, behavior: isStreaming ? 'auto' : 'smooth' })
      }
      const rafId = requestAnimationFrame(performScroll)
      return () => cancelAnimationFrame(rafId)
    }
    return undefined
  }, [messageAtoms, runState])

  if (messageAtoms.length === 0) return null

  return (
    <div ref={containerRef} onScroll={handleScroll} className="chat-thread-container">
      <div className="chat-thread-spacer-top" />
      {messageAtoms.map((messageAtom) => (
        <MessageWrapper key={getAtomKey(messageAtom)} messageAtom={messageAtom} />
      ))}
      <div className="chat-thread-spacer-bottom" />
      <div className="chat-thread-anchor" />
    </div>
  )
}

const MessageWrapper = React.memo(({ messageAtom }: { messageAtom: PrimitiveAtom<ChatMessage> }) => {
  const [message] = useAtom(messageAtom)
  const [copied, setCopied] = React.useState(false)

  const getMessageText = () => {
    if (message.content) return message.content
    if (message.orderedBlocks) {
      return message.orderedBlocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.content)
        .join('')
    }
    return ''
  }

  const textToCopy = getMessageText()

  const handleCopy = () => {
    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatTime = (ts: number) => {
    if (!ts) return ''
    const date = new Date(ts)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className={`chat-thread-message-wrapper message-${message.role}`}>
      <div className="message-bubble-wrapper">
        {message.role === 'user' ? <UserMessage message={message} /> : <AssistantMessage message={message} />}
        {!message.isStreaming && (
          <div className="message-meta-actions">
            <span className="message-timestamp">{formatTime(message.timestamp)}</span>
            {!!textToCopy && (
              <button className="message-copy-btn" onClick={handleCopy} title="Copy message text">
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
MessageWrapper.displayName = 'MessageWrapper'

export default ChatThread
