import React, { useRef, useEffect, useState } from 'react'
import { TbPlus, TbMicrophone, TbArrowUp, TbX, TbChevronDown, TbHome, TbFolderFilled, TbBrain } from 'react-icons/tb'
import { IconButton } from './button'
import { FileTab } from './tabs'
import { cn } from '../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
} from './dropdownMenu'
import { useThreadStore } from '../lib/threadStore'
import { useShallow } from 'zustand/react/shallow'
import { FileIcon } from './FileIcon'
import * as Sentry from '@sentry/electron/renderer'
import { toast } from '../lib/toast'
import { getAbsolutePath, normalizePath, MENTION_REGEX, TRAILING_PUNCT, LEADING_PUNCT, MAX_ATTACHMENTS } from '../../shared/pathHelpers'

const MAX_INPUT_HEIGHT = 200
const CIRCLE_RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS
const WHITESPACE_RE = /\s/

interface InputBarProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  onSubmit?: (userImages?: string[], userFiles?: string[]) => void | Promise<boolean>
  loading?: boolean
  onCancel?: () => void
  contextTokens?: number
}
interface Attachment {
  type: string
  name: string
  path?: string
  data?: string
  mediaType?: string
  dataUrl?: string
}

function InlineError({
  message,
  onDismiss
}: {
  message: string
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
      <span>{message}</span>
      <IconButton
        onClick={onDismiss}
        className="w-5 h-5 bg-transparent hover:bg-transparent text-destructive hover:text-destructive/80 focus-visible:ring-offset-destructive/10"
      >
        <TbX size={11} />
      </IconButton>
    </div>
  )
}

export function InputBar({
  value,
  onChange,
  placeholder = 'Plan, build, debug... (Enter to send, Shift+Enter for newline)',
  onSubmit,
  loading,
  onCancel,
  contextTokens
}: InputBarProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [inlineError, setInlineError] = useState<string | undefined>(undefined)
  const {
    activeFolderPath,
    openFolders,
    setActiveFolderPath,
    models,
    selectedModelKey,
    changeSessionModel,
    sessions,
    currentSessionId,
    changeSessionReasoning,
    fileTree
  } = useThreadStore(
    useShallow((s) => ({
      activeFolderPath: s.activeFolderPath,
      openFolders: s.openFolders,
      setActiveFolderPath: s.setActiveFolderPath,
      models: s.models,
      selectedModelKey: s.selectedModelKey,
      changeSessionModel: s.changeSessionModel,
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      changeSessionReasoning: s.changeSessionReasoning,
      fileTree: s.fileTree
    }))
  )
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [filteredFiles, setFilteredFiles] = useState<string[]>([])
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0)
  const [mentionStartIdx, setMentionStartIdx] = useState(-1)
  const [isListening, setIsListening] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | undefined>(undefined)
  const streamRef = useRef<MediaStream | undefined>(undefined)
  const audioChunksRef = useRef<BlobPart[]>([])
  const isMountedRef = useRef(true)
  const valueRef = useRef(value)
  const recordingStateRef = useRef<'idle' | 'starting' | 'recording'>('idle')

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop()
        } catch (err: unknown) {
          Sentry.captureException(err)
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  const toggleSpeech = async (): Promise<void> => {
    if (recordingStateRef.current === 'recording' || recordingStateRef.current === 'starting') {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive')
        mediaRecorderRef.current.stop()
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      recordingStateRef.current = 'idle'
      setIsListening(false)
      return
    }
    recordingStateRef.current = 'starting'
    let stream: MediaStream | undefined = undefined
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      if (!isMountedRef.current || (recordingStateRef.current as string) === 'idle') {
        stream.getTracks().forEach((track) => track.stop())
        recordingStateRef.current = 'idle'
        return
      }
      const recordingStream = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')
          ? 'audio/ogg'
          : undefined
      const mediaRecorder = mimeType
        ? new MediaRecorder(recordingStream, { mimeType })
        : new MediaRecorder(recordingStream)
      audioChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      mediaRecorder.onstart = () => {
        recordingStateRef.current = 'recording'
        if (isMountedRef.current) setIsListening(true)
      }
      mediaRecorder.onstop = () => {
        recordingStream.getTracks().forEach((t) => t.stop())
        mediaRecorderRef.current = undefined
        recordingStateRef.current = 'idle'
        if (!isMountedRef.current) return
        setIsListening(false)
        if (audioChunksRef.current.length === 0) return
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        if (audioBlob.size > 15 * 1024 * 1024) {
          setInlineError('Audio recording is too large.')
          return
        }
        void audioBlob
          .arrayBuffer()
          .then(async (buf) => {
            if (!isMountedRef.current) return
            try {
              const transcribed = await window.api.audioTranscribe({ buffer: new Uint8Array(buf) })
              if (!isMountedRef.current) return
              if (transcribed) {
                const currentValue = valueRef.current
                const space = currentValue ? (currentValue.endsWith(' ') ? '' : ' ') : ''
                onChange(currentValue + space + transcribed)
              }
            } catch (err: unknown) {
              Sentry.captureException(err)
              if (isMountedRef.current) setInlineError(err instanceof Error ? err.message : 'Transcription failed. Please try again.')
            }
          })
          .catch((err: unknown) => {
            Sentry.captureException(err)
            if (isMountedRef.current) setInlineError('Transcription failed. Please try again.')
          })
      }
      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start(250)
    } catch (err: unknown) {
      toast.error('Failed to start voice recording. Please check microphone permissions.', err)
      stream?.getTracks().forEach((track) => track.stop())
      setInlineError('Failed to access microphone. Please check system permissions.')
      if (isMountedRef.current) setIsListening(false)
      recordingStateRef.current = 'idle'
    }
  }

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 48), MAX_INPUT_HEIGHT)}px`
  }, [value, loading])



  const getMentionQuery = (text: string, cursorIndex: number): string | undefined => {
    const pre = text.slice(0, cursorIndex)
    const lastAt = pre.lastIndexOf('@')
    if (lastAt === -1) return undefined
    const part = pre.slice(lastAt)
    if (part.startsWith('@[') && !part.includes(']')) return part.slice(2)
    if (!part.startsWith('@[') && !WHITESPACE_RE.test(part)) return part.slice(1)
    return undefined
  }

  const handleTextChange = (val: string): void => {
    onChange(val)
    const ta = textareaRef.current
    if (!ta) return
    const cursorIdx = ta.selectionStart
    const query = getMentionQuery(val, cursorIdx)
    if (query !== undefined) {
      setMentionStartIdx(val.slice(0, cursorIdx).lastIndexOf('@'))
      let suggestions: string[] = []
      const files = fileTree ?? []
      if (!query) {
        suggestions = files.slice(0, 15)
      } else {
        const lowerQ = query.toLowerCase()
        for (let i = 0; i < files.length; i++) {
          if (files[i].toLowerCase().includes(lowerQ)) {
            suggestions.push(files[i])
            if (suggestions.length >= 15) break
          }
        }
      }
      setFilteredFiles(suggestions)
      setShowSuggestions(true)
      setActiveSuggestionIdx(0)
    } else {
      setShowSuggestions(false)
    }
  }

  const selectFile = (file: string): void => {
    const ta = textareaRef.current
    if (!ta) return
    const cursorIdx = ta.selectionStart
    const beforeCursor = value.slice(0, cursorIdx)
    const mentionStart = beforeCursor.lastIndexOf('@')
    const actualStart = mentionStart !== -1 ? mentionStart : mentionStartIdx
    const before = value.slice(0, actualStart)
    const after = value.slice(cursorIdx)
    const wrap = file.includes(' ') || file.includes('[') || file.includes(']')
    const mentionText = wrap ? `@[${file}]` : `@${file}`
    const newVal = `${before}${mentionText} ${after}`
    onChange(newVal)
    setShowSuggestions(false)
    ta.focus()
    const newPos = before.length + mentionText.length + 1
    if (textareaRef.current) {
      requestAnimationFrame(() => {
        if (isMountedRef.current) ta.setSelectionRange(newPos, newPos)
      })
    }
  }

  const triggerSubmit = async (): Promise<void> => {
    if (!onSubmit) return
    const userImages = attachments.flatMap((a) =>
      a.type === 'image' && a.dataUrl ? [a.dataUrl] : []
    )
    const userFiles = attachments.flatMap((a) => (a.type === 'file' && a.path ? [a.path] : []))
    const matches = Array.from(value.matchAll(MENTION_REGEX)) ?? []
    const normalize = (p: string): string => normalizePath(p).toLowerCase()
    matches.forEach((m) => {
      const rawPath = m[1] || m[2]
      if (rawPath) {
        const cleanPath = rawPath.replace(TRAILING_PUNCT, '').replace(LEADING_PUNCT, '')
        if (cleanPath) {
          const absPath = getAbsolutePath(cleanPath, activeFolderPath)
          if (!userFiles.some((uf) => normalize(uf) === normalize(absPath))) userFiles.push(absPath)
        }
      }
    })
    const submitted = await onSubmit(userImages, userFiles)
    if (submitted !== false) setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showSuggestions && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSuggestionIdx((p) => (p + 1) % filteredFiles.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSuggestionIdx((p) => (p - 1 + filteredFiles.length) % filteredFiles.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectFile(filteredFiles[activeSuggestionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSuggestions(false)
        return
      }
    }
    if (e.key === 'Backspace') {
      const ta = e.currentTarget
      const start = ta.selectionStart
      if (start === ta.selectionEnd && start > 0) {
        const match = value.slice(0, start).match(/@([^\s]+)\s?$/)
        if (match) {
          e.preventDefault()
          const deleteLen = match[0].length
          const newVal = value.slice(0, start - deleteLen) + value.slice(start)
          onChange(newVal)
          const newPos = start - deleteLen
          requestAnimationFrame(() => {
            ta.setSelectionRange(newPos, newPos)
          })
          return
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() || attachments.length > 0) void triggerSubmit()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, MAX_ATTACHMENTS - attachments.length)
    e.target.value = ''
    void Promise.allSettled(
      Array.from(files).map(
        async (f) =>
          new Promise<Attachment>((resolve, reject) => {
            const maxBytes = f.type.startsWith('image/') ? 10 * 1024 * 1024 : 15 * 1024 * 1024
            if (f.size > maxBytes) {
              reject(new Error(`${f.name} is too large to attach.`))
              return
            }
            if (f.type.startsWith('image/')) {
              const reader = new FileReader()
              reader.onload = (ev) =>
                resolve({ type: 'image', name: f.name, dataUrl: ev.target?.result as string })
              reader.onerror = () => reject(new Error(`Could not read ${f.name}.`))
              reader.readAsDataURL(f)
            } else {
              const path = window.api.getFilePath(f)
              if (!path) reject(new Error(`Could not access ${f.name}.`))
              else resolve({ type: 'file', name: f.name, path })
            }
          })
      )
    ).then((results) => {
      if (!isMountedRef.current) return
      const successful: Attachment[] = []
      const errors: string[] = []
      for (const result of results) {
        if (result.status === 'fulfilled') successful.push(result.value)
        else
          errors.push(
            result.reason instanceof Error ? result.reason.message : 'Could not add attachment.'
          )
      }
      if (successful.length > 0) setAttachments((prev) => [...prev, ...successful])
      if (errors.length > 0) setInlineError(errors.join('\n'))
    })
  }

  const removeAttachment = (idx: number): void =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  const selectedModel = selectedModelKey ? models[selectedModelKey] : undefined
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId)
  const activeReasoningEffort = (currentSession?.metadata?.reasoningEffort as string | null) ?? null
  const supportsReasoning = selectedModel?.capabilities?.includes('reasoning') ?? false
  const supportsReasoningEffort = selectedModel?.capabilities?.includes('reasoning-effort') ?? false
  const supportsVision = selectedModel?.capabilities?.includes('images') ?? false
  const tokenLimit = selectedModel?.contextWindow !== undefined ? selectedModel.contextWindow : 200000
  const pct = tokenLimit > 0 && contextTokens !== undefined ? Math.min((contextTokens / tokenLimit) * 100, 100) : 0
  const pctString = pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`

  return (
    <div className="bg-oc-surface rounded-lg border border-oc-border focus-within:border-oc-active transition-colors flex flex-col relative max-w-[700px] w-full mx-auto shadow-md">
      {showSuggestions && filteredFiles.length > 0 && (
        <div className="absolute bottom-full left-0 w-full bg-oc-surface border border-oc-border rounded-md shadow-xl max-h-48 overflow-y-auto mb-1.5 z-50 flex flex-col p-1">
          {filteredFiles.map((file, idx) => (
            <button
              key={file}
              type="button"
              onClick={() => selectFile(file)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer text-left border-none bg-transparent',
                idx === activeSuggestionIdx
                  ? 'bg-oc-hover text-tx-bright'
                  : 'text-tx-sub hover:bg-oc-hover hover:text-tx-main'
              )}
            >
              <FileIcon path={file} size={16} className="text-tx-muted flex-shrink-0" />
              <span className="truncate">{file}</span>
            </button>
          ))}
        </div>
      )}
      {inlineError && (
        <div className="px-3 pt-2">
          <InlineError message={inlineError} onDismiss={() => setInlineError(undefined)} />
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1 border-b border-oc-border/50 bg-oc-surface">
          {attachments.map((att, i) => (
            <FileTab
              key={i}
              name={att.name}
              path={att.path || att.name}
              iconType={att.type === 'image' ? 'image' : 'file'}
              active={true}
              onClose={() => removeAttachment(i)}
              maxWidth="max-w-[120px]"
            />
          ))}
        </div>
      )}
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2 relative bg-oc-surface rounded-b-lg">
        <div className="relative w-full text-base leading-relaxed overflow-hidden">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={loading ? 'Agent is working... (Type to queue)' : placeholder}
            rows={1}
            className="w-full bg-transparent border-none outline-none resize-none text-base text-tx-main placeholder:text-tx-muted leading-relaxed disabled:opacity-50 p-0 m-0 relative z-10 max-h-input min-h-[48px] overflow-y-auto"
          />
        </div>
      </div>
      <div className="px-3 py-2 bg-oc-base border-t border-oc-border rounded-b-lg flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label className={cn(supportsVision ? 'cursor-pointer' : 'cursor-not-allowed')} title={!supportsVision ? 'This model does not support file attachments' : undefined}>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={!supportsVision}
              aria-label="Add files or images"
            />
            <span className={cn(
              "flex items-center justify-center transition-colors rounded-full flex-shrink-0 w-6 h-6",
              supportsVision 
                ? "cursor-pointer bg-oc-hover hover:bg-oc-active text-tx-sub hover:text-tx-bright" 
                : "cursor-not-allowed opacity-40 bg-transparent text-tx-muted pointer-events-none"
            )}>
              <TbPlus size={16} strokeWidth={2.5} />
            </span>
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 bg-oc-hover hover:bg-oc-active data-[state=open]:bg-oc-active text-tx-sub hover:text-tx-bright data-[state=open]:text-tx-bright text-xs border border-oc-border outline-none rounded-md px-2 py-1 font-sans font-semibold cursor-pointer transition-colors select-none max-w-[120px]">
                {activeFolderPath ? (
                  <TbFolderFilled size={13} className="flex-shrink-0 text-amber-400" />
                ) : (
                  <TbHome size={13} className="flex-shrink-0" />
                )}
                <span className="truncate">
                  {activeFolderPath
                  ? normalizePath(activeFolderPath).split('/').filter(Boolean).pop() || 'Workspace'
                  : 'Home'}
                </span>
                <TbChevronDown size={12} className="opacity-70 flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px] z-[60]">
              <DropdownMenuItem
                onClick={() => setActiveFolderPath(undefined)}
                className={cn(!activeFolderPath && 'bg-oc-hover text-tx-bright font-semibold')}
              >
                <TbHome size={14} className="flex-shrink-0" />
                <span className="truncate flex-1">Home</span>
              </DropdownMenuItem>
              {openFolders.map((folder) => (
                <DropdownMenuItem
                  key={folder.path}
                  onClick={() => setActiveFolderPath(folder.path)}
                  className={cn(activeFolderPath === folder.path && 'bg-oc-hover text-tx-bright font-semibold')}
                >
                  <TbFolderFilled size={14} className="flex-shrink-0 text-amber-400" />
                  <span className="truncate flex-1">
                    {folder.name || normalizePath(folder.path).split('/').filter(Boolean).pop()}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {models && Object.keys(models).length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 bg-oc-hover hover:bg-oc-active data-[state=open]:bg-oc-active text-tx-sub hover:text-tx-bright data-[state=open]:text-tx-bright text-xs border border-oc-border outline-none rounded-md px-2 py-1 font-sans font-semibold cursor-pointer transition-colors select-none">
                  <span className="truncate max-w-[120px]">
                    {selectedModelKey
                      ? models[selectedModelKey]?.name || selectedModelKey
                      : 'Select Model'}
                  </span>
                  {selectedModelKey && (activeReasoningEffort || models[selectedModelKey]?.reasoningEffort) ? (
                    <span className="text-3xs px-1 py-0.5 bg-oc-active text-tx-bright rounded font-bold uppercase tracking-wide flex items-center gap-0.5">
                      <TbBrain size={9} />
                      <span>{activeReasoningEffort || models[selectedModelKey]?.reasoningEffort}</span>
                    </span>
                  ) : selectedModelKey && models[selectedModelKey]?.badge ? (
                    <span className="text-3xs px-1 py-0.5 bg-oc-surface text-tx-main rounded font-bold uppercase tracking-wide border border-oc-border">
                      {models[selectedModelKey].badge}
                    </span>
                  ) : (
                    <></>
                  )}
                  <TbChevronDown size={14} className="opacity-70 flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[190px] z-[60]">
                {Object.keys(models).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => changeSessionModel(key)}
                    className={cn(
                      key === selectedModelKey && 'bg-oc-hover text-tx-bright font-semibold'
                    )}
                  >
                    <span className="truncate flex-1">{models[key].name || key}</span>
                    {models[key].reasoningEffort ? (
                      <span className="text-3xs px-1 bg-oc-active text-tx-bright rounded font-bold uppercase tracking-wide flex-shrink-0">
                        {models[key].reasoningEffort}
                      </span>
                    ) : models[key].badge ? (
                      <span className="text-3xs px-1 bg-oc-surface text-tx-main rounded font-bold uppercase tracking-wide border border-oc-border flex-shrink-0">
                        {models[key].badge}
                      </span>
                    ) : (
                      <></>
                    )}
                  </DropdownMenuItem>
                ))}
                {supportsReasoning && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <TbBrain size={14} className="flex-shrink-0" />
                        <span>Reasoning ({activeReasoningEffort ? activeReasoningEffort : 'Disabled'})</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-[150px] z-[60]">
                        {supportsReasoningEffort ? (
                          <>
                            <DropdownMenuItem onClick={() => changeSessionReasoning(null)} className={cn(!activeReasoningEffort && 'bg-oc-hover text-tx-bright font-semibold')}>
                              <span>Disabled</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => changeSessionReasoning('low')} className={cn(activeReasoningEffort === 'low' && 'bg-oc-hover text-tx-bright font-semibold')}>
                              <span>Low</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => changeSessionReasoning('medium')} className={cn(activeReasoningEffort === 'medium' && 'bg-oc-hover text-tx-bright font-semibold')}>
                              <span>Medium</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => changeSessionReasoning('high')} className={cn(activeReasoningEffort === 'high' && 'bg-oc-hover text-tx-bright font-semibold')}>
                              <span>High</span>
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem onClick={() => changeSessionReasoning(activeReasoningEffort ? null : 'high')}>
                            <span>{activeReasoningEffort ? 'Disable' : 'Enable'}</span>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {contextTokens !== undefined && contextTokens > 0 && (
            <div className="relative group flex items-center gap-1 select-none cursor-pointer z-20">
              <span className="text-2xs font-bold text-tx-sub font-mono transition-colors group-hover:text-tx-bright">
                {pctString}
              </span>
              <div className="relative flex items-center justify-center w-6 h-6">
                <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
                  <circle
                    cx="9"
                    cy="9"
                    r={CIRCLE_RADIUS}
                    stroke="var(--oc-border)"
                    strokeWidth="2"
                    fill="transparent"
                    className="transition-colors group-hover:stroke-oc-active"
                  />
                  <circle
                    cx="9"
                    cy="9"
                    r={CIRCLE_RADIUS}
                    stroke="var(--tx-sub)"
                    strokeWidth="2"
                    fill="transparent"
                    strokeDasharray={CIRCUMFERENCE.toFixed(2)}
                    strokeDashoffset={(CIRCUMFERENCE * (1 - pct / 100)).toFixed(2)}
                    strokeLinecap="round"
                    className="transition-all duration-300 group-hover:stroke-tx-bright"
                  />
                </svg>
              </div>
              <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-oc-raised border border-oc-border rounded-lg p-2.5 shadow-xl pointer-events-none text-2xs z-50 min-w-[190px] flex flex-col gap-1.5 font-sans">
                <div className="font-bold text-tx-bright border-b border-oc-border pb-1">
                  Context Window Usage
                </div>
                <div className="flex justify-between gap-4 font-semibold">
                  <span className="text-tx-sub">Current:</span>
                  <span className="text-tx-bright font-mono">
                    {contextTokens.toLocaleString()} / {tokenLimit.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
          {loading ? (
            <IconButton
              onClick={onCancel}
              className="rounded-full bg-destructive text-white hover:bg-destructive/90 w-7 h-7 flex items-center justify-center flex-shrink-0 z-20"
            >
              <span className="w-2.5 h-2.5 bg-white rounded-xs" />
            </IconButton>
          ) : (
            <IconButton
              aria-label={
                isListening
                  ? 'Stop recording'
                  : value.trim() || attachments.length > 0
                    ? 'Send message'
                    : 'Start voice recording'
              }
              onClick={() => {
                if (!value.trim() && attachments.length === 0) void toggleSpeech()
                else void triggerSubmit()
              }}
              size="md"
              className={cn(
                'rounded-full w-7 h-7 flex items-center justify-center transition-all duration-200 flex-shrink-0 z-20',
                isListening
                  ? 'bg-destructive text-white animate-pulse cursor-pointer'
                  : value.trim() || attachments.length > 0
                    ? 'bg-tx-bright text-oc-base hover:opacity-90 cursor-pointer'
                    : 'bg-oc-hover text-tx-sub hover:text-tx-bright cursor-pointer'
              )}
            >
              {isListening ? (
                <span className="w-2.5 h-2.5 bg-white rounded-xs" />
              ) : value.trim() || attachments.length > 0 ? (
                <TbArrowUp size={16} strokeWidth={2.5} />
              ) : (
                <TbMicrophone size={16} strokeWidth={2.5} />
              )}
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
