import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useThreadStore } from '../lib/threadStore'

import { InputBar } from './InputBar'
import type { StreamState } from '../lib/types'
import type {
  MessageWithMetadata,
  TextContent,
  ImageContent,
  FileContent,
  ToolResultContent,
  ToolUseContent
} from '@cline/sdk'
import { TbChevronDown, TbChevronRight, TbTrash, TbPencil, TbCheck, TbX } from 'react-icons/tb'
import { ToolCallDisplay } from './ToolCallDisplay'
import { FileTab } from './tabs'
import { FileIcon } from './FileIcon'
import { Markdown } from './Markdown'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './dialog'
import { cn } from '../lib/utils'
import { IconButton } from './button'
import { toast } from '../lib/toast'
import { getRelativePath, getAbsolutePath, normalizePath, MENTION_REGEX, TRAILING_PUNCT, LEADING_PUNCT } from '../../shared/pathHelpers'

function QueueList({
  queue,
  updateQueuePrompt,
  deleteQueuePrompt
}: {
  queue: { id: string; delivery: string; prompt?: string }[]
  updateQueuePrompt: (promptId: string, text: string, delivery: 'queue' | 'steer') => Promise<boolean>
  deleteQueuePrompt: (id: string) => void
}): React.JSX.Element | null {
  const [editingPromptId, setEditingPromptId] = useState<string | undefined>(undefined)
  const [editingText, setEditingText] = useState('')

  if (queue.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5 w-full max-w-chat mx-auto px-4 mb-2.5">
      <div className="text-3xs text-tx-muted font-bold tracking-wider uppercase mb-1">
        Next up in Queue ({queue.length} prompt{queue.length > 1 ? 's' : ''})
      </div>
      <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto no-scrollbar">
        {queue.map((item) => {
          const isEditing = editingPromptId === item.id
          return (
            <div
              key={item.id}
              className="group bg-oc-surface/40 hover:bg-oc-surface border border-oc-border rounded-lg p-2 flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={cn(
                    'text-3xs font-bold px-1.5 py-0.5 rounded border flex-shrink-0 uppercase tracking-wider select-none',
                    item.delivery === 'steer'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                      : 'bg-oc-active border-oc-border text-tx-sub'
                  )}
                >
                  {item.delivery}
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingText.trim()) {
                          void updateQueuePrompt(item.id, editingText, item.delivery as 'queue' | 'steer')
                          setEditingPromptId(undefined)
                        }
                      } else if (e.key === 'Escape') {
                        setEditingPromptId(undefined)
                      }
                    }}
                    className="flex-1 bg-oc-raised border border-oc-border rounded px-2 py-0.5 text-xs text-tx-main focus:outline-none focus:border-oc-active min-w-0"
                    autoFocus
                  />
                ) : (
                  <span className="text-xs text-tx-main truncate flex-1 leading-relaxed select-text">
                    {item.prompt}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isEditing ? (
                  <>
                    <IconButton
                      onClick={() => {
                        if (editingText.trim()) {
                          void updateQueuePrompt(item.id, editingText, item.delivery as 'queue' | 'steer')
                          setEditingPromptId(undefined)
                        }
                      }}
                      size="sm"
                      tooltip="Save edit"
                    >
                      <TbCheck size={14} />
                    </IconButton>
                    <IconButton
                      onClick={() => setEditingPromptId(undefined)}
                      size="sm"
                      tooltip="Cancel edit"
                      className="hover:text-destructive"
                    >
                      <TbX size={14} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton
                      onClick={() => {
                        setEditingPromptId(item.id)
                        setEditingText(item.prompt || '')
                      }}
                      size="sm"
                      tooltip="Edit prompt"
                      className="opacity-0 group-hover:opacity-100"
                    >
                      <TbPencil size={14} />
                    </IconButton>
                    <IconButton
                      onClick={() => void deleteQueuePrompt(item.id)}
                      size="sm"
                      tooltip="Cancel prompt"
                      className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                    >
                      <TbTrash size={14} />
                    </IconButton>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ThinkingBlock({ text, active }: { text: string; active: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(active)
  const cleanText = text ? text.trim() : ''
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active && containerRef.current)
      containerRef.current.scrollTop = containerRef.current.scrollHeight
  }, [cleanText, active])
  if (!cleanText) return <></>
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-tx-dim hover:text-tx-muted transition-colors cursor-pointer bg-transparent border-none outline-none select-none py-0.5"
      >
        <span>Thought</span>
        {open ? (
          <TbChevronDown size={14} className="opacity-70" />
        ) : (
          <TbChevronRight size={14} className="opacity-70" />
        )}
      </button>
      {open && (
        <div
          ref={containerRef}
          className="mt-2 text-sm text-tx-muted whitespace-pre-wrap pl-4 leading-relaxed select-text font-sans max-h-[130px] overflow-y-auto"
        >
          {cleanText}
        </div>
      )}
    </div>
  )
}


function HistoryMessage({
  msg,
  toolResultMap,
  onFileClick,
  workspacePath
}: {
  msg: MessageWithMetadata
  toolResultMap: Map<string, ToolResultContent>
  onFileClick: (p: string) => void
  workspacePath: string | undefined
}): React.JSX.Element | null {
  if (msg.role === 'user') {
    if (Array.isArray(msg.content) && msg.content.every((c) => c.type === 'tool_result'))
      return null
    const textBlocks = Array.isArray(msg.content)
      ? (msg.content.filter((p) => p.type === 'text') as TextContent[])
      : []
    const imageAttachments = Array.isArray(msg.content)
      ? (msg.content.filter((p) => p.type === 'image') as ImageContent[])
      : []
    const fileAttachments = Array.isArray(msg.content)
      ? (msg.content.filter((p) => p.type === 'file') as FileContent[])
      : []
    const rawText =
      typeof msg.content === 'string' ? msg.content : textBlocks.map((t) => t.text).join('\n')
    const uniqueFiles = (() => {
      const seen = new Set<string>()
      const mentions = rawText?.match(MENTION_REGEX) ?? []
      return fileAttachments.filter((a) => {
        const key = normalizePath(a.path).toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return !mentions.some((m) => {
          let typed = m.slice(1)
          if (typed.startsWith('[') && typed.endsWith(']')) typed = typed.slice(1, -1)
          typed = normalizePath(typed).toLowerCase()
          return key === typed || key.endsWith('/' + typed)
        })
      })
    })()
    const hasVisibleAttachments = imageAttachments.length > 0 || uniqueFiles.length > 0
    const renderText = (): React.ReactNode => {
      if (!rawText) return null
      const parts = rawText.split(MENTION_REGEX)
      return parts.map((part, i) => {
        if (part.startsWith('@')) {
          let rawFilePath = part.slice(1)
          if (rawFilePath.startsWith('[') && rawFilePath.endsWith(']')) rawFilePath = rawFilePath.slice(1, -1)
          const filePath = rawFilePath.replace(TRAILING_PUNCT, '').replace(LEADING_PUNCT, '')
          const idx = rawFilePath.indexOf(filePath)
          const leading = idx > 0 ? rawFilePath.substring(0, idx) : ''
          const trailing = idx >= 0 ? rawFilePath.substring(idx + filePath.length) : ''
          const absolutePath = getAbsolutePath(filePath, workspacePath)
          return (
            <React.Fragment key={i}>
              {leading}
              <FileTab
                name={normalizePath(filePath)}
                path={absolutePath}
                active={true}
                onClick={() => onFileClick(absolutePath)}
                className="mx-1 align-middle"
                maxWidth="max-w-[200px]"
              />
              {trailing}
            </React.Fragment>
          )
        }
        return <span key={i}>{part}</span>
      })
    }
    const getImgSrc = (att: ImageContent): string => {
      if (att.data?.startsWith('data:')) return att.data
      if (att.data) return `data:${att.mediaType || 'image/png'};base64,${att.data}`
      return ''
    }
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-full w-full bg-oc-raised border border-oc-border rounded-xl px-4 py-2.5 text-tx-bright whitespace-pre-wrap break-words leading-relaxed text-base select-text flex flex-col gap-2.5">
          {hasVisibleAttachments && (
            <div className="flex flex-col gap-2">
              {imageAttachments.map((att, i) => {
                const src = getImgSrc(att)
                return src ? (
                  <img
                    key={i}
                    src={src}
                    alt={'Attachment'}
                    className="max-w-xs max-h-48 object-cover rounded-lg border border-oc-border bg-oc-base shadow-sm"
                  />
                ) : null
              })}
              {uniqueFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {uniqueFiles.map((att, i) => {
                    const relativePath = getRelativePath(att.path, workspacePath)
                    return (
                      <Tooltip key={i}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onFileClick(getAbsolutePath(att.path, workspacePath))}
                            className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-oc-raised border border-oc-border hover:border-oc-active text-tx-bright text-xs font-semibold transition-colors cursor-pointer select-text shadow-sm"
                          >
                            <FileIcon path={att.path} size={12} />
                            <span>{relativePath}</span>
                          </button>
                        </TooltipTrigger>
                        {att.path && <TooltipContent>{att.path}</TooltipContent>}
                      </Tooltip>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          <span>{renderText()}</span>
        </div>
      </div>
    )
  }

  const blocks = Array.isArray(msg.content)
    ? msg.content
    : [{ type: 'text', text: msg.content } as TextContent]
  return (
    <div className="flex w-full justify-start">
      <div className="text-tx-main text-left w-full flex flex-col gap-3">
        {blocks.map((part, i) => {
          if (part.type === 'text' && part.text)
            return <Markdown key={i} content={part.text} />
          if (part.type === 'thinking')
            return <ThinkingBlock key={i} text={part.thinking} active={false} />
          if (part.type === 'redacted_thinking')
            return <ThinkingBlock key={i} text={part.data} active={false} />
          if (part.type === 'tool_use') {
            const toolResult = toolResultMap.get((part as ToolUseContent).id ?? '')
            return (
              <ToolCallDisplay
                key={i}
                toolUse={part as ToolUseContent}
                toolResult={toolResult}
                onFileClick={onFileClick}
              />
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

function StreamingTools({
  tools,
  onFileClick
}: {
  tools: StreamState['tools']
  onFileClick: (p: string) => void
}): React.JSX.Element {
  return (
    <>
      {tools.map((tool) => {
        const toolUse = {
          type: 'tool_use' as const,
          id: tool.toolCallId,
          name: tool.name,
          input: tool.input as Record<string, unknown>
        }
        return <ToolCallDisplay key={tool.toolCallId} toolUse={toolUse} onFileClick={onFileClick} />
      })}
    </>
  )
}

const StreamingAssistant = React.memo(function StreamingAssistant({
  stream,
  onFileClick
}: {
  stream: StreamState
  onFileClick: (p: string) => void
}): React.JSX.Element {
  const hasContent =
    stream.text ||
    stream.reasoning ||
    stream.tools.length > 0 ||
    stream.statusNotice ||
    stream.error
  if (!hasContent && stream.isLoading) {
    return (
      <div className="flex w-full justify-start">
        <div className="text-sm font-medium animate-text-shimmer select-none">Thinking</div>
      </div>
    )
  }
  if (!hasContent) return <></>
  return (
    <div className="flex w-full justify-start">
      <div className="text-tx-main text-left w-full flex flex-col gap-3">
        {stream.error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 select-text">
            {stream.error}
          </div>
        )}
        {stream.reasoning && (
          <ThinkingBlock text={stream.reasoning} active={stream.isLoading && !stream.text} />
        )}
        {stream.statusNotice && !stream.text && (
          <div className="text-xs text-tx-dim italic">{stream.statusNotice}</div>
        )}
        <StreamingTools tools={stream.tools} onFileClick={onFileClick} />
        {stream.text && <Markdown content={stream.text} />}
      </div>
    </div>
  )
})
StreamingAssistant.displayName = 'StreamingAssistant'

export function ChatPanel(): React.JSX.Element {
  const {
    currentSessionId,
    messagesMap,
    streamStates,
    sendMessage,
    abortSession,
    setActiveFile,
    activeQuestion,
    submitAnswer,
    sessions,
    activeFolderPath,
    queuesMap,
    updateQueuePrompt,
    deleteQueuePrompt,
    createSession
  } = useThreadStore(
    useShallow((s) => ({
      currentSessionId: s.currentSessionId,
      messagesMap: s.messagesMap,
      streamStates: s.streamStates,
      sendMessage: s.sendMessage,
      abortSession: s.abortSession,
      setActiveFile: s.setActiveFile,
      activeQuestion: s.activeQuestion,
      submitAnswer: s.submitAnswer,
      sessions: s.sessions,
      activeFolderPath: s.activeFolderPath,
      queuesMap: s.queuesMap,
      updateQueuePrompt: s.updateQueuePrompt,
      deleteQueuePrompt: s.deleteQueuePrompt,
      createSession: s.createSession
    }))
  )
  const [text, setText] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messages = useMemo(
    () => (currentSessionId ? (messagesMap[currentSessionId] ?? []) : []),
    [currentSessionId, messagesMap]
  )
  const contextTokens = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      const t = m.metrics?.inputTokens ?? m.metadata?.inputTokens ?? (m as any).meta?.inputTokens
      if (typeof t === 'number' && t > 0) return t
    }
    return 0
  }, [messages])
  const stream = currentSessionId ? streamStates[currentSessionId] : undefined
  const queue = currentSessionId ? (queuesMap[currentSessionId] ?? []) : []
  const isLoading = !!stream?.isLoading
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId)
  const workspacePath = currentSession?.workspaceRoot || currentSession?.cwd || activeFolderPath

  const lastMsgCountRef = useRef(messages.length)
  const userWasAtBottomRef = useRef(true)
  const handleScroll = React.useCallback((): void => {
    const el = containerRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    userWasAtBottomRef.current = isAtBottom
  }, [])
  useEffect(() => {
    const msgCountChanged = messages.length !== lastMsgCountRef.current
    lastMsgCountRef.current = messages.length
    const lastMsgIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user'

    if ((msgCountChanged && lastMsgIsUser) || userWasAtBottomRef.current) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth' })
      })
    }
  }, [messages, stream?.text, stream?.tools.length, isLoading])

  const toolResultMap = useMemo(() => {
    const map = new Map<string, ToolResultContent>()
    let anonIndex = 0
    for (const m of messages) {
      if (m.role === 'user' && Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === 'tool_result') {
            map.set(c.tool_use_id || `anon_${anonIndex++}`, c as ToolResultContent)
          }
        }
      }
    }
    return map
  }, [messages])

  const groupedMessages = useMemo(() => {
    const grouped: (MessageWithMetadata & { key: string })[] = []
    for (const msg of messages) {
      if (
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.every((c) => c.type === 'tool_result')
      )
        continue
      const last = grouped[grouped.length - 1]
      const msgKey = msg.id || (msg.ts ? String(msg.ts) : '') || Math.random().toString()
      if (last && last.role === 'assistant' && msg.role === 'assistant') {
        const lastContent = Array.isArray(last.content)
          ? [...last.content]
          : [{ type: 'text', text: String(last.content) } as TextContent]
        const newContent = Array.isArray(msg.content)
          ? [...msg.content]
          : [{ type: 'text', text: String(msg.content) } as TextContent]
        grouped[grouped.length - 1] = {
          ...last,
          content: [...lastContent, ...newContent],
          key: last.key + '_' + msgKey
        }
      } else {
        grouped.push({
          ...msg,
          content: Array.isArray(msg.content)
            ? [...msg.content]
            : [{ type: 'text', text: String(msg.content) } as TextContent],
          key: msgKey
        })
      }
    }
    return grouped
  }, [messages])

  const handleSend = async (
    userImages?: string[],
    userFiles?: string[],
    textOverride?: string
  ): Promise<boolean> => {
    const sendText = textOverride !== undefined ? textOverride : text
    if (!sendText.trim() && !userImages?.length && !userFiles?.length) return false
    if (!useThreadStore.getState().currentSessionId) {
      const idx = useThreadStore.getState().sessions.length + 1
      const ws = useThreadStore.getState().activeFolderPath
      const created = await createSession(`Chat ${idx}`, ws || undefined)
      if (!created) return false
    }
    const delivery = isLoading ? 'queue' : 'steer'
    const sent = await sendMessage(sendText, userImages, userFiles, delivery)
    if (sent) {
      if (textOverride === undefined) setText('')
      if (delivery === 'queue') toast.info('Message added to queue')
    }
    return sent
  }

  const handleFileClick = (fp: string): void => {
    if (fp) void setActiveFile(fp)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-oc-base">
      <Dialog open={!!activeQuestion}>
        <DialogContent
          className="max-w-md"
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="gap-1">
            <DialogTitle className="text-base font-bold text-tx-bright">
              Clarification Required
            </DialogTitle>
            <DialogDescription className="text-sm text-tx-muted mt-2 whitespace-pre-wrap">
              {activeQuestion?.question}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-4">
            {activeQuestion?.options.map((opt) => (
              <button
                key={opt}
                onClick={() => submitAnswer(opt)}
                className="w-full text-left bg-oc-raised border border-oc-border hover:border-oc-active rounded-lg px-4 py-2.5 text-sm text-tx-main hover:text-tx-bright hover:bg-oc-hover transition-colors font-medium cursor-pointer outline-none"
              >
                {opt}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {messages.length > 0 ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto py-4 flex flex-col transform-gpu will-change-scroll"
          >
            <div className="flex flex-col gap-6">
              {groupedMessages.map((msg) => (
                <div
                  key={msg.key}
                  className="w-full max-w-chat mx-auto pl-4 pr-2 select-text"
                >
                  <HistoryMessage
                    msg={msg}
                    toolResultMap={toolResultMap}
                    onFileClick={handleFileClick}
                    workspacePath={workspacePath}
                  />
                </div>
              ))}
              {stream &&
                (stream.isLoading ||
                  stream.text ||
                  stream.reasoning ||
                  stream.error ||
                  stream.statusNotice ||
                  stream.tools.length > 0) && (
                  <div className="w-full max-w-chat mx-auto pl-4 pr-2 select-text">
                    <StreamingAssistant stream={stream} onFileClick={handleFileClick} />
                  </div>
                )}
            </div>

            <div className="h-[100px] flex-shrink-0 pointer-events-none" />
            <div ref={bottomRef} className="h-px flex-shrink-0" />
          </div>
          <div className="px-3 pb-2 pt-1 flex-shrink-0">
            <div className="w-full mx-auto flex flex-col gap-1.5">
              <QueueList
                queue={queue}
                updateQueuePrompt={updateQueuePrompt}
                deleteQueuePrompt={deleteQueuePrompt}
              />
              <InputBar
                value={text}
                onChange={setText}
                onSubmit={handleSend}
                loading={isLoading}
                onCancel={() => currentSessionId && abortSession(currentSessionId)}
                contextTokens={contextTokens}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="max-w-[700px] w-full flex flex-col gap-4 px-3 mx-auto">
            <QueueList
              queue={queue}
              updateQueuePrompt={updateQueuePrompt}
              deleteQueuePrompt={deleteQueuePrompt}
            />
            <InputBar
              value={text}
              onChange={setText}
              onSubmit={handleSend}
              loading={isLoading}
              onCancel={() => currentSessionId && abortSession(currentSessionId)}
              contextTokens={contextTokens}
            />
            <div className="flex flex-wrap gap-2">
              {[
                'Explain this codebase',
                'Fix bugs in my code',
                'Write unit tests',
                'Refactor this module'
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => void handleSend(undefined, undefined, s)}
                  className="px-3 py-1.5 rounded-full border border-oc-border bg-transparent hover:bg-oc-hover text-xs text-tx-sub hover:text-tx-main transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
