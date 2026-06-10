import React from 'react'

import { useAtomValue, useSetAtom, useAtom } from 'jotai'
import type { PrimitiveAtom } from 'jotai'
import {
  chatMessageAtomsAtom,
  chatMessagesAtom,
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom
} from '../store/agentStore'
import ToolCallBlock from './ToolCallBlock'
import type { ChatMessage, StreamBlock, ToolCallEntry } from '../store/agentStore'
import { ChevronDown, AlertTriangle, Copy, Check, Loader } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { decodeBase64Utf8 } from '../lib/sharedUtils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── StreamingMarkdown ────────────────────────────────────────────────────────

const StreamingMarkdown = ({ content, targetId, isStreaming }: { content: string; targetId: string; isStreaming: boolean }) => {
  return <MarkdownRenderer id={targetId} content={content} isStreaming={isStreaming} />
}

// ─── ReasoningBlock ──────────────────────────────────────────────────────────

const ReasoningBlock = ({ content, durationMs, isStreaming, targetId }: { content: string; durationMs?: number; isStreaming?: boolean; targetId: string }) => {
  const [isOpen, setIsOpen] = React.useState(!!isStreaming)
  const [userToggled, setUserToggled] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!userToggled) setIsOpen(!!isStreaming)
  }, [isStreaming, userToggled])

  React.useEffect(() => {
    let cb: (() => void) | undefined
    if (isStreaming) {
      const raf = requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
      cb = () => cancelAnimationFrame(raf)
    }
    return cb
  }, [content, isStreaming])

  const seconds = durationMs ? Math.round(durationMs / 1000).toString() : ''
  const title = isStreaming ? `Thinking${seconds ? ` for ${seconds}s` : ''}` : `Thought for ${seconds}s`

  return (
    <details
      open={isOpen}
      onToggle={(e) => {
        const open = (e.target as HTMLDetailsElement).open
        if (open !== isOpen) { setUserToggled(true); setIsOpen(open) }
      }}
      className="chat-reasoning-details"
    >
      <summary className="chat-reasoning-summary">
        <span>{title}</span>
        <ChevronDown size={14} className="chat-reasoning-chevron" />
      </summary>
      <div ref={scrollRef} className="assistant-content chat-reasoning-body">
        <StreamingMarkdown content={content || 'Thinking...'} targetId={targetId} isStreaming={!!isStreaming} />
      </div>
    </details>
  )
}

// ─── ToolGroupBlock ──────────────────────────────────────────────────────────

const ToolGroupBlock = ({ tools, isStreaming, isLast }: { tools: ToolCallEntry[]; isStreaming?: boolean; isLast: boolean }) => {
  const isPending = tools.some(t => t.status === 'pending')
  const [isOpen, setIsOpen] = React.useState(isPending || (isLast && !!isStreaming))
  const [userToggled, setUserToggled] = React.useState(false)
  const prevToolCountRef = React.useRef(tools.length)
  React.useEffect(() => {
    if (tools.length > prevToolCountRef.current) {
      setUserToggled(false)
      setIsOpen(true)
    }
    prevToolCountRef.current = tools.length
  }, [tools.length])
  React.useEffect(() => { if (!userToggled) setIsOpen(isPending || (isLast && !!isStreaming)) }, [isPending, isStreaming, isLast, userToggled])
  const completeCount = tools.filter(t => t.status === 'complete').length
  const errorCount = tools.filter(t => t.status === 'error').length
  const label = isPending
    ? `Running operation${tools.length > 1 ? 's' : ''} (${completeCount}/${tools.length})`
    : `Executed ${tools.length} operation${tools.length > 1 ? 's' : ''}${errorCount > 0 ? ` (${errorCount} failed)` : ''}`
  return (
    <details open={isOpen} onToggle={(e) => { const open = (e.target as HTMLDetailsElement).open; if (open !== isOpen) { setUserToggled(true); setIsOpen(open) } }} className="chat-reasoning-details chat-tool-group-details">
      <summary className="chat-reasoning-summary">
        <span>{label}</span>
        <ChevronDown size={14} className="chat-reasoning-chevron" />
      </summary>
      <div className="chat-tool-group-body" style={{ marginTop: 8, paddingLeft: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tools.map((t, idx) => <div key={t.id || idx}><ToolCallBlock toolCall={t} /></div>)}
      </div>
    </details>
  )
}

// ─── AssistantMessage ─────────────────────────────────────────────────────────

const AssistantMessage = ({ message }: { message: ChatMessage }) => {
  const statusText = (() => {
    if (!message.orderedBlocks?.length) return 'Thinking'
    const last = message.orderedBlocks[message.orderedBlocks.length - 1]
    if (last.type === 'tool' && last.status === 'pending') return 'Working'
    if (last.type === 'text') return 'Generating'
    if (last.type === 'reasoning') return 'Thinking'
    return 'Thinking'
  })()
  const segments = (() => {
    type Seg =
      | { type: 'reasoning'; block: StreamBlock & { type: 'reasoning' }; blockIndex: number }
      | { type: 'text'; block: StreamBlock & { type: 'text' }; blockIndex: number }
      | { type: 'error'; block: StreamBlock & { type: 'error' }; blockIndex: number }
      | { type: 'tool-group'; tools: ToolCallEntry[]; key: string }
    const result: Seg[] = []
    let currentGroup: ToolCallEntry[] = []
    let groupStartIdx = -1
    const flush = () => {
      if (currentGroup.length > 0) {
        result.push({ type: 'tool-group', tools: currentGroup, key: `tool-group-${groupStartIdx}` })
        currentGroup = []; groupStartIdx = -1
      }
    }
    message.orderedBlocks?.forEach((b, idx) => {
      if (b.type === 'tool') {
        if (groupStartIdx === -1) groupStartIdx = idx
        currentGroup.push({ id: b.toolCallId, toolName: b.toolName, args: b.args, argsDelta: b.argsDelta, result: b.result, status: b.status })
      } else {
        flush()
        if (b.type === 'reasoning') result.push({ type: 'reasoning', block: b, blockIndex: idx })
        else if (b.type === 'text') { if (b.content.trim() || message.isStreaming) result.push({ type: 'text', block: b, blockIndex: idx }) }
        else if (b.type === 'error') result.push({ type: 'error', block: b, blockIndex: idx })
      }
    })
    flush()
    return result
  })()

  return (
    <div className="chat-message-assistant-container">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1
        if (seg.type === 'reasoning') return (
          <ReasoningBlock
            key={`reasoning-${seg.blockIndex}`}
            content={seg.block.content}
            durationMs={seg.block.durationMs}
            isStreaming={seg.block.isStreaming}
            targetId={`streaming-reasoning-${message.id}-${seg.blockIndex}`}
          />
        )
        if (seg.type === 'tool-group') return <ToolGroupBlock key={seg.key} tools={seg.tools} isStreaming={message.isStreaming} isLast={isLast} />
        if (seg.type === 'text') return (
          <div key={`text-${seg.blockIndex}`} className="assistant-content chat-message-assistant">
            <StreamingMarkdown
              content={seg.block.content}
              targetId={`streaming-text-${message.id}-${seg.blockIndex}`}
              isStreaming={!!message.isStreaming}
            />
          </div>
        )
        if (seg.type === 'error') return (
          <div key={`error-${seg.blockIndex}`} className="chat-error-container">
            <AlertTriangle size={15} className="chat-error-icon" />
            <span className="chat-error-message">{seg.block.message}</span>
          </div>
        )
        return null
      })}
      {!message.orderedBlocks && message.content && (
        <div className="assistant-content chat-message-assistant"><MarkdownRenderer content={message.content} /></div>
      )}
      {message.isStreaming && (
        <div className="chat-message-generating-container" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Loader size={14} className="animate-spin" style={{ color: 'var(--accent-blue)' }} />
          <span className="shimmer-text chat-message-generating-text">{statusText}</span>
        </div>
      )}
    </div>
  )
}

// ─── UserMessage ─────────────────────────────────────────────────────────────

const UserMessage = ({ message, metaActions }: { message: ChatMessage; metaActions?: React.ReactNode }) => {
  let attachments: Array<{ type: 'image' | 'document'; name: string; mimeType?: string; base64: string }> = []
  if (message.data) {
    try { const d = JSON.parse(message.data); if (d?.attachments) attachments = d.attachments } catch (err) { console.error('[ChatThread] Error parsing attachments:', err) }
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
              const openDoc = () => { setActiveEditorFile({ name: att.name || 'attachment', path: att.name || '', isBinary: false, mimeType: att.mimeType || 'text/plain', content: decodeBase64Utf8(att.base64) }); setArtifactPanelMode('editor'); setArtifactPanelOpen(true) }
              const openImg = () => { setActiveEditorFile({ name: att.name || 'attachment', path: att.name || '', isBinary: true, mimeType: att.mimeType || 'image/png', base64: att.base64 }); setArtifactPanelMode('editor'); setArtifactPanelOpen(true) }
              return (
                <div key={idx} className="message-attachment-chip" onClick={att.type === 'image' ? openImg : openDoc} title={att.name || 'attachment'}>
                  {att.type === 'image'
                    ? <img src={`data:${att.mimeType || 'image/png'};base64,${att.base64}`} alt={att.name || 'attachment'} className="message-attachment-chip-img" />
                    : <SymbolsFileIcon fileName={att.name ? (att.name.split('/').pop() || att.name) : 'attachment'} autoAssign={true} width={14} height={14} className="chat-attachment-icon" />}
                  <span className="chat-attachment-name">{att.name ? (att.name.split('/').pop() || att.name) : 'attachment'}</span>
                </div>
              )
            })}
          </div>
        )}
        {message.content && <div><MarkdownRenderer content={message.content} /></div>}
        {metaActions}
      </div>
    </div>
  )
}
UserMessage.displayName = 'UserMessage'



const ChatThread: React.FC = () => {
  const messageAtoms = useAtomValue(chatMessageAtomsAtom)
  const messages = useAtomValue(chatMessagesAtom)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const isAtBottomRef = React.useRef(true)

  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop } = scrollRef.current
    isAtBottomRef.current = Math.abs(scrollTop) < 15
  }
  React.useLayoutEffect(() => {
    if (scrollRef.current && isAtBottomRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [messageAtoms.length])

  const messageGroups = (() => {
    const groups: Array<{ key: string; userAtom: any; assistantAtoms: Array<{ atom: any; id: string }> }> = []
    let currentGroup: { key: string; userAtom: any; assistantAtoms: Array<{ atom: any; id: string }> } | null = null
    messageAtoms.forEach((atom, idx) => {
      const msg = messages[idx]
      if (!msg) return
      if (msg.role === 'user') {
        currentGroup = { key: `group-${msg.id}`, userAtom: atom, assistantAtoms: [] }
        groups.push(currentGroup)
      } else {
        const item = { atom, id: msg.id }
        if (currentGroup) currentGroup.assistantAtoms.push(item)
        else groups.push({ key: `group-init-${msg.id}`, userAtom: null, assistantAtoms: [item] })
      }
    })
    return groups
  })()

  if (messageAtoms.length === 0) return null

  return (
    <div className="chat-thread-container" ref={scrollRef} onScroll={handleScroll} style={{ flexDirection: 'column-reverse' }}>
      <div className="chat-thread-spacer-bottom" style={{ flexShrink: 0 }} />
      <div className="chat-thread-anchor" style={{ flexShrink: 0 }} />
      {messageGroups.slice().reverse().map((group) => (
        <div key={group.key} className="chat-section" style={{ display: 'flex', flexDirection: 'column' }}>
          {group.userAtom && <MessageWrapper messageAtom={group.userAtom} />}
          {group.assistantAtoms.map(({ atom, id }) => (
            <MessageWrapper key={id} messageAtom={atom} />
          ))}
        </div>
      ))}
      <div className="chat-thread-spacer-top" style={{ flexShrink: 0 }} />
    </div>
  )
}

// ─── MessageWrapper ───────────────────────────────────────────────────────────

const MessageWrapper = ({ messageAtom }: { messageAtom: PrimitiveAtom<ChatMessage> }) => {
  const [message] = useAtom(messageAtom)
  const [copied, setCopied] = React.useState(false)

  const textToCopy = message.content || (message.orderedBlocks?.filter((b): b is StreamBlock & { type: 'text' } => b.type === 'text').map(b => b.content).join('') ?? '')

  const handleCopy = () => {
    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const timeStr = message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className={`chat-thread-message-wrapper message-${message.role}`}>
      <div className="message-bubble-wrapper">
        {message.role === 'user' ? (
          <UserMessage
            message={message}
            metaActions={
              !message.isStreaming && (
                <div className="message-meta-actions">
                  <span className="message-timestamp">{timeStr}</span>
                  {!!textToCopy && (
                    <button className="message-copy-btn" onClick={handleCopy} title="Copy message text">
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  )}
                </div>
              )
            }
          />
        ) : (
          <>
            <AssistantMessage message={message} />
            {!message.isStreaming && (
              <div className="message-meta-actions">
                <span className="message-timestamp">{timeStr}</span>
                {!!textToCopy && (
                  <button className="message-copy-btn" onClick={handleCopy} title="Copy message text">
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default ChatThread
