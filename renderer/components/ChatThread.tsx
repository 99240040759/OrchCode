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
import { AlertTriangle } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { decodeBase64Utf8 } from '../lib/sharedUtils'
import logoImg from '../assets/logo.png'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── StreamingMarkdown ────────────────────────────────────────────────────────

const StreamingMarkdown = ({ content, targetId, isStreaming }: { content: string; targetId: string; isStreaming: boolean }) => {
  return <MarkdownRenderer id={targetId} content={content} isStreaming={isStreaming} />
}

// ─── ToolGroupBlock ──────────────────────────────────────────────────────────

const ToolGroupBlock = ({ tools }: { tools: ToolCallEntry[] }) => {
  if (tools.length === 1) {
    const isBlock = tools[0].tool_name === 'runCommand'
    return <div style={{ display: isBlock ? 'block' : 'inline-flex', width: isBlock ? '100%' : undefined, margin: isBlock ? '6px 0' : 0, alignItems: 'center' }}><ToolCallBlock toolCall={tools[0]} /></div>
  }
  return (
    <div className="chat-tool-group-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: 0, alignItems: 'center', width: '100%' }}>
      {tools.map((t, idx) => {
        const isBlock = t.tool_name === 'runCommand'
        return <div key={t.id || idx} style={{ display: isBlock ? 'block' : 'inline-flex', width: isBlock ? '100%' : undefined }}><ToolCallBlock toolCall={t} /></div>
      })}
    </div>
  )
}

// ─── ActiveGeneratingSpinner ──────────────────────────────────────────────────

const ActiveGeneratingSpinner = ({ startTime }: { startTime?: number }) => {
  const [elapsed, setElapsed] = React.useState(0)
  const startRef = React.useRef(startTime || Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100)
    return () => clearInterval(timer)
  }, [startTime])
  return (
    <div className="chat-message-generating-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
      <img src={logoImg} style={{ width: '14px', height: '14px', objectFit: 'contain' }} alt="logo" />
      <span className="chat-message-generating-text">Working for {Math.round(elapsed)}s</span>
    </div>
  )
}

// ─── AssistantMessage ─────────────────────────────────────────────────────────

const AssistantMessage = ({ message }: { message: ChatMessage }) => {
  const segments = (() => {
    type Seg =
      | { type: 'text'; block: StreamBlock & { type: 'text' }; blockIndex: number }
      | { type: 'error'; block: StreamBlock & { type: 'error' }; blockIndex: number }
      | { type: 'summarize'; block: StreamBlock & { type: 'summarize' }; blockIndex: number }
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
      if (b.type === 'tool_call') {
        if (groupStartIdx === -1) groupStartIdx = idx
        currentGroup.push({ id: b.tool_call_id, tool_name: b.tool_name, args: b.args, args_delta: b.args_delta, result: b.result, status: b.status })
      } else {
        if (b.type === 'text' && !b.content.trim()) return
        if (b.type === 'duration') return
        flush()
        if (b.type === 'summarize') { result.push({ type: 'summarize', block: b, blockIndex: idx }) }
        else if (b.type === 'text') { result.push({ type: 'text', block: b, blockIndex: idx }) }
        else if (b.type === 'error') { result.push({ type: 'error', block: b, blockIndex: idx }) }
      }
    })
    flush()
    return result
  })()

  const durationBlock = message.orderedBlocks?.find((b: any) => b.type === 'duration')
  const showActiveSpinner = message.isStreaming && !durationBlock

  return (
    <div className="chat-message-assistant-container">
      {segments.map((seg) => {
        if (seg.type === 'tool-group') return <ToolGroupBlock key={seg.key} tools={seg.tools} />
        if (seg.type === 'text') return (
          <div key={`text-${seg.blockIndex}`} className="assistant-content chat-message-assistant">
            <StreamingMarkdown content={seg.block.content} targetId={`streaming-text-${message.id}-${seg.blockIndex}`} isStreaming={!!message.isStreaming} />
          </div>
        )
        if (seg.type === 'error') return (
          <div key={`error-${seg.blockIndex}`} className="chat-error-container">
            <AlertTriangle size={15} className="chat-error-icon" />
            <span className="chat-error-message">{seg.block.message}</span>
          </div>
        )
        if (seg.type === 'summarize') return (
          <div key={`summarize-${seg.blockIndex}`} style={{ margin: '6px 0', width: '100%' }}>
            <ToolCallBlock toolCall={{ id: `summarize-${seg.blockIndex}`, tool_name: 'summarize', args: { savedTokens: (seg.block as any).savedTokens, totalTokens: (seg.block as any).totalTokens }, status: 'complete' }} />
          </div>
        )
        return null
      })}
      {!message.orderedBlocks && message.content && (
        <div className="assistant-content chat-message-assistant"><MarkdownRenderer content={message.content} /></div>
      )}
      {durationBlock && (
        <div className="chat-message-generating-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
          <img src={logoImg} style={{ width: '14px', height: '14px', objectFit: 'contain', opacity: 0.8 }} alt="logo" />
          <span className="chat-message-generating-text">Worked for {Math.round((durationBlock as any).durationSeconds)}s</span>
        </div>
      )}
      {showActiveSpinner && <ActiveGeneratingSpinner startTime={message.timestamp} />}
    </div>
  )
}

// ─── UserMessage ─────────────────────────────────────────────────────────────

const UserMessage = ({ message }: { message: ChatMessage }) => {
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
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    isAtBottomRef.current = (scrollHeight - scrollTop - clientHeight) < 25
  }

  const lastMsg = messages[messages.length - 1]
  const lastMsgContent = lastMsg?.content || ''
  const lastMsgBlocksLength = lastMsg?.orderedBlocks?.length || 0
  const lastMsgIsStreaming = lastMsg?.isStreaming || false

  React.useLayoutEffect(() => {
    if (scrollRef.current && isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messageAtoms.length, lastMsgContent, lastMsgBlocksLength, lastMsgIsStreaming])

  const messageGroups = (() => {
    const groups: Array<{ key: string; userAtom: any; assistantAtoms: Array<{ atom: any; id: string }> }> = []
    let currentGroup: { key: string; userAtom: any; assistantAtoms: Array<{ atom: any; id: string }> } | null = null
    messageAtoms.forEach((atom, idx) => {
      const msg = messages[idx]; if (!msg) return
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
    <div className="chat-thread-container" ref={scrollRef} onScroll={handleScroll}>
      <div className="chat-thread-spacer-top" style={{ flexShrink: 0 }} />
      {messageGroups.map((group) => (
        <div key={group.key} className="chat-section" style={{ display: 'flex', flexDirection: 'column' }}>
          {group.userAtom && <MessageWrapper messageAtom={group.userAtom} />}
          {group.assistantAtoms.map(({ atom, id }) => (
            <MessageWrapper key={id} messageAtom={atom} />
          ))}
        </div>
      ))}
      <div className="chat-thread-anchor" style={{ flexShrink: 0 }} />
      <div className="chat-thread-spacer-bottom" style={{ flexShrink: 0 }} />
    </div>
  )
}

// ─── MessageWrapper ───────────────────────────────────────────────────────────

const MessageWrapper = ({ messageAtom }: { messageAtom: PrimitiveAtom<ChatMessage> }) => {
  const [message] = useAtom(messageAtom)
  return (
    <div className={`chat-thread-message-wrapper message-${message.role}`}>
      <div className="message-bubble-wrapper">
        {message.role === 'user' ? <UserMessage message={message} /> : <AssistantMessage message={message} />}
      </div>
    </div>
  )
}

export default ChatThread
