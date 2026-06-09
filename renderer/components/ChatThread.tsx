import React from 'react'

import { useAtomValue, useSetAtom, useAtom } from 'jotai'
import type { PrimitiveAtom } from 'jotai'
import { Virtuoso } from 'react-virtuoso'
import {
  chatMessageAtomsAtom,
  chatMessagesAtom,
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom
} from '../store/agentStore'
import ToolCallBlock from './ToolCallBlock'
import type { ChatMessage, StreamBlock, ToolCallEntry } from '../store/agentStore'
import { ChevronDown, AlertTriangle, Copy, Check } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { decodeBase64Utf8 } from '../lib/sharedUtils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── StreamingMarkdown — worker-patched, no ReactMarkdown during streaming ────

/**
 * During streaming: the worker posts compiled HTML via stream:html-update.
 * We morph the DOM directly — no React re-render needed per token.
 * After streaming (isStreaming=false): fall through to MarkdownRenderer for
 * final static render. This eliminates the dual-pipeline fight.
 */
const StreamingMarkdown = React.memo(
  ({ content, targetId, isStreaming }: { content: string; targetId: string; isStreaming: boolean }) => {
    return <MarkdownRenderer id={targetId} content={content} isStreaming={isStreaming} />
  }
)
StreamingMarkdown.displayName = 'StreamingMarkdown'

// ─── ReasoningBlock ──────────────────────────────────────────────────────────

const ReasoningBlock = React.memo(
  ({ content, durationMs, isStreaming, targetId }: { content: string; durationMs?: number; isStreaming?: boolean; targetId: string }) => {
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
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.durationMs === next.durationMs &&
    prev.isStreaming === next.isStreaming &&
    prev.targetId === next.targetId
)
ReasoningBlock.displayName = 'ReasoningBlock'

// ─── ToolGroupBlock ──────────────────────────────────────────────────────────

const ToolGroupBlock = React.memo(({ tools, isStreaming, isLast }: { tools: ToolCallEntry[]; isStreaming?: boolean; isLast: boolean }) => {
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
})
ToolGroupBlock.displayName = 'ToolGroupBlock'

// ─── AssistantMessage ─────────────────────────────────────────────────────────

const AssistantMessage = React.memo(({ message }: { message: ChatMessage }) => {
  const statusText = React.useMemo(() => {
    if (!message.orderedBlocks?.length) return 'Thinking'
    const last = message.orderedBlocks[message.orderedBlocks.length - 1]
    if (last.type === 'tool' && last.status === 'pending') return 'Working'
    if (last.type === 'text') return 'Generating'
    return 'Thinking'
  }, [message.orderedBlocks])

  // Build segments with stable tool-group keys
  const segments = React.useMemo(() => {
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
  }, [message.orderedBlocks])

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
            // Use stable blockIndex so targetId is consistent regardless of other blocks
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
        <div className="chat-message-generating-container">
          <span className="shimmer-text chat-message-generating-text">{statusText}</span>
        </div>
      )}
    </div>
  )
}, (prev, next) =>
  prev.message.isStreaming === next.message.isStreaming &&
  prev.message.orderedBlocks === next.message.orderedBlocks &&
  prev.message.content === next.message.content
)
AssistantMessage.displayName = 'AssistantMessage'

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

// Removed custom atom key generator since Jotai atoms have stable toString()
const Scroller = React.forwardRef<HTMLDivElement, any>((props, ref) => <div {...props} ref={ref} className="chat-thread-container" />)
Scroller.displayName = 'Scroller'

const ChatThread: React.FC = () => {
  const messageAtoms = useAtomValue(chatMessageAtomsAtom)
  const messages = useAtomValue(chatMessagesAtom)

  const messageGroups = React.useMemo(() => {
    const groups: Array<{ key: string; userAtom: any; assistantAtoms: any[] }> = []
    let currentGroup: { key: string; userAtom: any; assistantAtoms: any[] } | null = null
    messageAtoms.forEach((atom, idx) => {
      const msg = messages[idx]
      if (!msg) return
      if (msg.role === 'user') {
        currentGroup = { key: `group-${msg.id}`, userAtom: atom, assistantAtoms: [] }
        groups.push(currentGroup)
      } else {
        if (currentGroup) currentGroup.assistantAtoms.push(atom)
        else groups.push({ key: `group-init-${msg.id}`, userAtom: null, assistantAtoms: [atom] })
      }
    })
    return groups
  }, [messageAtoms, messages])

  if (messageAtoms.length === 0) return null

  return (
    <Virtuoso
      style={{ height: '100%', width: '100%' }}
      data={messageGroups}
      followOutput="auto"
      components={{
        Scroller,
        Header: () => <div className="chat-thread-spacer-top" />,
        Footer: () => <div className="chat-thread-spacer-bottom" />
      }}
      itemContent={(_, group) => (
        <div className="chat-section">
          {group.userAtom && <MessageWrapper messageAtom={group.userAtom} />}
          {group.assistantAtoms.map((assistantAtom) => (
            <MessageWrapper key={`${assistantAtom}`} messageAtom={assistantAtom} />
          ))}
        </div>
      )}
    />
  )
}

// ─── MessageWrapper ───────────────────────────────────────────────────────────

const MessageWrapper = React.memo(({ messageAtom }: { messageAtom: PrimitiveAtom<ChatMessage> }) => {
  const [message] = useAtom(messageAtom)
  const [copied, setCopied] = React.useState(false)

  const textToCopy = React.useMemo(() => {
    if (message.content) return message.content
    return message.orderedBlocks?.filter((b): b is StreamBlock & { type: 'text' } => b.type === 'text').map(b => b.content).join('') ?? ''
  }, [message.content, message.orderedBlocks])

  const handleCopy = React.useCallback(() => {
    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [textToCopy])

  const timeStr = React.useMemo(() => {
    if (!message.timestamp) return ''
    return new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [message.timestamp])

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
})
MessageWrapper.displayName = 'MessageWrapper'

export default ChatThread
