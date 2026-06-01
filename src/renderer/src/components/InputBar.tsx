import React, { useState, useRef, useEffect, useCallback } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { Plus, ChevronDown, ArrowRight, Square, Image, FileText } from 'lucide-react'
import { useAtomValue, useAtom } from 'jotai'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  agentRunStateAtom,
  sessionTokensAtom,
  selectedModelAtom,
  availableModelsAtom,
  conversationIdAtom,
  activeWorkspaceAtom
} from '../store/agentStore'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'

interface InputBarProps {
  onSubmit?: (val: string, mode?: string, attachments?: any[]) => void
  onStop?: () => void
}

const PLANNING_MODES = ['Planning', 'Code', 'Debug', 'Explain'] as const
type PlanningMode = (typeof PLANNING_MODES)[number]

const MAX_TOKENS = 200_000
const RING_RADIUS = 9
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function ringColor(fraction: number): string {
  if (fraction >= 0.95) return '#ef4444'
  if (fraction >= 0.80) return '#f59e0b'
  if (fraction >= 0.50) return '#10b981'
  return '#5e5e5e'
}

const getDropdownStyle = (minWidth: number): React.CSSProperties => ({
  background: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  padding: '4px 0',
  minWidth,
  zIndex: 1000,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  transformOrigin: 'top left'
})

const InputBar: React.FC<InputBarProps> = ({ onSubmit, onStop }) => {
  const [inputValue, setInputValue] = useState('')
  const [planningMode, setPlanningMode] = useState<PlanningMode>('Planning')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runState = useAtomValue(agentRunStateAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)

  const sessionTokens = useAtomValue(sessionTokensAtom)
  const availableModels = useAtomValue(availableModelsAtom)

  const [attachments, setAttachments] = useState<Array<{ type: 'image' | 'document'; name: string; mimeType: string; base64: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isRunning = runState !== 'idle' && runState !== 'error'

  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const conversationId = useAtomValue(conversationIdAtom)

  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [showFileSuggestions, setShowFileSuggestions] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [triggerIndex, setTriggerIndex] = useState(-1)
  const [suggestionIndex, setSuggestionIndex] = useState(0)

  const [fileReferences, setFileReferences] = useState<Array<{ name: string; path: string }>>([])

  const fetchWorkspaceFiles = useCallback(async () => {
    if (!conversationId) return
    try {
      const files = await window.api.listWorkspaceFiles(conversationId)
      setWorkspaceFiles(files)
    } catch (err) {
      console.error('Failed to load workspace files:', err)
    }
  }, [conversationId])

  useEffect(() => {
    fetchWorkspaceFiles()
  }, [activeWorkspace, conversationId, fetchWorkspaceFiles])

  // Filter files based on query
  const filteredFiles = workspaceFiles.filter((f) =>
    f.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 15)

  const selectFileSuggestion = (selectedFile: string) => {
    if (!textareaRef.current) return
    const selectionStart = textareaRef.current.selectionStart || 0
    setInputValue(inputValue.slice(0, triggerIndex) + inputValue.slice(selectionStart))
    setShowFileSuggestions(false)

    const wsPath = activeWorkspace?.path || ''
    const absolutePath = `${wsPath.startsWith('/') ? wsPath : '/' + wsPath}/${selectedFile}`
    const name = selectedFile.split('/').pop() || selectedFile

    setFileReferences((prev) =>
      prev.some((p) => p.path === absolutePath) ? prev : [...prev, { name, path: absolutePath }]
    )

    setTimeout(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(triggerIndex, triggerIndex)
    }, 0)
  }

  const checkSuggestions = (val: string, selectionStart: number | null) => {
    if (selectionStart === null) return setShowFileSuggestions(false)
    const textBeforeCursor = val.slice(0, selectionStart)
    const lastAtIdx = textBeforeCursor.lastIndexOf('@')

    if (lastAtIdx !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIdx + 1)
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        if (!showFileSuggestions) fetchWorkspaceFiles()
        setTriggerIndex(lastAtIdx)
        setSearchQuery(textAfterAt)
        setShowFileSuggestions(true)
        setSuggestionIndex(0)
        return
      }
    }
    setShowFileSuggestions(false)
  }

  const triggerFileSelect = (type: 'image' | 'document') => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'image' ? 'image/*' : '.txt,.pdf,.json,.ts,.js,.tsx,.jsx,.html,.css,.md,.py,.rs,.go'
      fileInputRef.current.setAttribute('data-upload-type', type)
      fileInputRef.current.click()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const type = fileInputRef.current?.getAttribute('data-upload-type') as 'image' | 'document' || 'document'

    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result as string
        const base64 = result.split(',')[1] || result
        setAttachments((prev) => [
          ...prev,
          {
            type,
            name: file.name,
            mimeType: file.type || (type === 'image' ? 'image/png' : 'text/plain'),
            base64
          }
        ])
      }
      reader.readAsDataURL(file)
    })

    e.target.value = ''
  }

  const displayTotal = sessionTokens
  const fraction = Math.min(displayTotal / MAX_TOKENS, 1)
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction)
  const color = ringColor(fraction)
  const formattedTokens = displayTotal >= 1000
    ? `${(displayTotal / 1000).toFixed(1)}k`
    : String(displayTotal)



  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showFileSuggestions && filteredFiles.length > 0) {
      const len = filteredFiles.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        return setSuggestionIndex((prev) => (prev + 1) % len)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        return setSuggestionIndex((prev) => (prev - 1 + len) % len)
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return selectFileSuggestion(filteredFiles[suggestionIndex])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return setShowFileSuggestions(false)
      }
    }

    if (e.key === 'Backspace' && fileReferences.length > 0 && textareaRef.current?.selectionStart === 0) {
      e.preventDefault()
      setFileReferences((prev) => prev.slice(0, -1))
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    let val = inputValue.trim()
    if ((!val && attachments.length === 0 && fileReferences.length === 0) || isRunning) return

    if (fileReferences.length > 0) {
      const refsText = fileReferences
        .map((ref) => `[${ref.name}](file://${ref.path})`)
        .join(' ')
      val = `${val} ${refsText}`.trim()
    }

    onSubmit?.(val, planningMode, attachments)
    setInputValue('')
    setAttachments([])
    setFileReferences([])
  }

  const handleStop = () => onStop?.()

  return (
    <div className="input-bar-container" style={{ position: 'relative' }}>
      {showFileSuggestions && filteredFiles.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            maxHeight: '220px',
            overflowY: 'auto',
            backgroundColor: 'var(--bg-sidebar)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            zIndex: 1000,
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            backdropFilter: 'blur(8px)',
            color: 'var(--text-primary)'
          }}
        >
          {filteredFiles.map((file, idx) => {
            const isSelected = idx === suggestionIndex
            const parts = file.split('/')
            const name = parts[parts.length - 1]
            const dir = parts.slice(0, -1).join('/')

            return (
              <div
                key={file}
                onClick={() => selectFileSuggestion(file)}
                onMouseEnter={() => setSuggestionIndex(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'rgba(255,255,255,0.08)' : 'transparent',
                  transition: 'background-color 0.15s ease'
                }}
              >
                <SymbolsFileIcon
                  fileName={name}
                  autoAssign={true}
                  width={14}
                  height={14}
                  style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                  {dir && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dir}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        style={{ display: 'none' }}
      />
      {attachments.length > 0 && (
        <div className="input-attachments-container">
          {attachments.map((att, idx) => (
            <div key={`att-${idx}`} className="input-attachment-chip" title={att.name}>
              {att.type === 'image' ? (
                <img
                  src={`data:${att.mimeType};base64,${att.base64}`}
                  alt={att.name}
                />
              ) : (
                <SymbolsFileIcon
                  fileName={att.name.split('/').pop() || att.name}
                  autoAssign={true}
                  width={14}
                  height={14}
                  style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
                />
              )}
              <span
                style={{
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {att.name.split('/').pop() || att.name}
              </span>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                className="input-attachment-close"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="input-bar-text-container"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px 4px 16px',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        {fileReferences.map((ref, idx) => (
          <div
            key={`ref-${idx}`}
            title={ref.path}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              userSelect: 'none',
              cursor: 'default',
              margin: '0 2px',
              verticalAlign: 'middle'
            }}
          >
            <SymbolsFileIcon
              fileName={ref.name}
              autoAssign={true}
              width={14}
              height={14}
              style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
            />
            <span
              style={{
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '13px'
              }}
            >
              {ref.name}
            </span>
          </div>
        ))}

        <TextareaAutosize
          ref={textareaRef}
          minRows={1}
          maxRows={8}
          className="input-bar-text-area"
          placeholder={(attachments.length > 0 || fileReferences.length > 0) ? "" : "Ask anything, @ to mention"}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            checkSuggestions(e.target.value, e.target.selectionStart)
          }}
          onSelect={(e) => {
            const target = e.target as HTMLTextAreaElement
            checkSuggestions(target.value, target.selectionStart)
          }}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          style={{
            flex: 1,
            minWidth: '150px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            padding: '2px 0',
            margin: 0,
            lineHeight: 1.5,
            opacity: isRunning ? 0.7 : 1,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--font-size-md-plus)'
          } as any}
        />
      </div>

      <div className="input-bar-toolbar">
        <div className="input-bar-toolbar-left">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <div className="toolbar-icon-btn" title="Add file or image" style={{ cursor: 'pointer' }}>
                <Plus size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content asChild sideOffset={6}>
                <div
                  className="native-dropdown-content"
                  style={getDropdownStyle(160)}
                >
                <DropdownMenu.Item
                  onSelect={() => triggerFileSelect('image')}
                  className="profile-dropdown-item"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Image size={14} />
                  <span>Upload Image</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => triggerFileSelect('document')}
                  className="profile-dropdown-item"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <FileText size={14} />
                  <span>Upload Document</span>
                </DropdownMenu.Item>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <div className="toolbar-selector" title="Select mode" style={{ cursor: 'pointer' }}>
                <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                <span>{planningMode}</span>
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content asChild sideOffset={6}>
                <div
                  className="native-dropdown-content"
                  style={getDropdownStyle(140)}
                >
                {PLANNING_MODES.map((mode) => (
                  <DropdownMenu.Item
                    key={mode}
                    onSelect={() => setPlanningMode(mode)}
                    className="profile-dropdown-item"
                    style={{
                      background: mode === planningMode ? 'rgba(255,255,255,0.05)' : 'transparent',
                      color: mode === planningMode ? 'var(--text-primary)' : 'var(--text-secondary)'
                    }}
                  >
                    {mode}
                  </DropdownMenu.Item>
                ))}
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <div className="toolbar-selector" title="Select model" style={{ cursor: 'pointer' }}>
                <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                <span>
                  {selectedModel === 'gemini' 
                    ? availableModels.gemini?.name 
                    : availableModels.gemma?.name
                  }
                </span>
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content asChild sideOffset={6}>
                <div
                  className="native-dropdown-content"
                  style={getDropdownStyle(200)}
                >
                <DropdownMenu.Item
                  onSelect={() => setSelectedModel('gemini')}
                  className="profile-dropdown-item"
                  style={{
                    background: selectedModel === 'gemini' ? 'rgba(255,255,255,0.05)' : 'transparent',
                    color: selectedModel === 'gemini' ? 'var(--text-primary)' : 'var(--text-secondary)'
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{availableModels.gemini?.name || 'Gemini 3.1 Flash Lite'}</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setSelectedModel('gemma')}
                  className="profile-dropdown-item"
                  style={{
                    background: selectedModel === 'gemma' ? 'rgba(255,255,255,0.05)' : 'transparent',
                    color: selectedModel === 'gemma' ? 'var(--text-primary)' : 'var(--text-secondary)'
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{availableModels.gemma?.name || 'Gemma 4'}</span>
                </DropdownMenu.Item>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="input-bar-toolbar-right">
          <div
            className="token-ring-wrapper"
            title={`${displayTotal.toLocaleString()} / ${MAX_TOKENS.toLocaleString()} tokens\n(${(fraction * 100).toFixed(1)}% context filled)`}
          >
            <svg
              width={RING_RADIUS * 2 + 4}
              height={RING_RADIUS * 2 + 4}
              viewBox={`0 0 ${RING_RADIUS * 2 + 4} ${RING_RADIUS * 2 + 4}`}
              style={{ transform: 'rotate(-90deg)' }}
            >
              <circle
                cx={RING_RADIUS + 2}
                cy={RING_RADIUS + 2}
                r={RING_RADIUS}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={2}
              />
              <circle
                cx={RING_RADIUS + 2}
                cy={RING_RADIUS + 2}
                r={RING_RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
              />
            </svg>
            {fraction > 0.05 && (
              <span className="token-ring-label" style={{ color }}>
                {formattedTokens}
              </span>
            )}
          </div>

          {isRunning ? (
            <button
              className="toolbar-submit-btn"
              onClick={handleStop}
              title="Stop generation"
              style={{ background: '#3a3a3a' }}
            >
              <Square size={11} strokeWidth={3} style={{ color: 'var(--text-primary)' }} />
            </button>
          ) : (
            <button
              className="toolbar-submit-btn"
              onClick={handleSend}
              title="Submit"
              disabled={!inputValue.trim() && attachments.length === 0}
              style={{ opacity: (inputValue.trim() || attachments.length > 0) ? 1 : 0.4 }}
            >
              <ArrowRight size={14} strokeWidth={2.5} style={{ color: 'var(--text-primary)' }} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default InputBar
