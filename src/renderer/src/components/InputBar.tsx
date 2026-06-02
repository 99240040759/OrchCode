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
import './InputBar.css'

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

  const selectFileSuggestion = useCallback((selectedFile: string) => {
    if (!textareaRef.current) return
    const selectionStart = textareaRef.current.selectionStart || 0
    setInputValue((prev) => prev.slice(0, triggerIndex) + prev.slice(selectionStart))
    setShowFileSuggestions(false)

    const wsPath = activeWorkspace?.path ?? ''
    // Cross-platform safe: join workspace root with the relative file path
    // using the platform separator detected from the workspace path itself.
    const sep = wsPath.includes('\\') ? '\\' : '/'
    const absolutePath = wsPath ? `${wsPath}${sep}${selectedFile}` : `/${selectedFile}`
    const name = selectedFile.split(/[/\\]/).pop() || selectedFile

    setFileReferences((prev) =>
      prev.some((p) => p.path === absolutePath) ? prev : [...prev, { name, path: absolutePath }]
    )

    setTimeout(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(triggerIndex, triggerIndex)
    }, 0)
  }, [triggerIndex, activeWorkspace])

  const checkSuggestions = useCallback((val: string, selectionStart: number | null) => {
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
  }, [showFileSuggestions, fetchWorkspaceFiles])

  const triggerFileSelect = useCallback((type: 'image' | 'document') => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'image' ? 'image/*' : '.txt,.pdf,.json,.ts,.js,.tsx,.jsx,.html,.css,.md,.py,.rs,.go'
      fileInputRef.current.setAttribute('data-upload-type', type)
      fileInputRef.current.click()
    }
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [])

  const displayTotal = sessionTokens
  const fraction = Math.min(displayTotal / MAX_TOKENS, 1)
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction)
  const color = ringColor(fraction)
  const formattedTokens = displayTotal >= 1000
    ? `${(displayTotal / 1000).toFixed(1)}k`
    : String(displayTotal)

  const handleSend = useCallback(() => {
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
  }, [inputValue, attachments, fileReferences, isRunning, planningMode, onSubmit])

  const handleStop = useCallback(() => onStop?.(), [onStop])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
  }, [showFileSuggestions, filteredFiles, suggestionIndex, selectFileSuggestion, fileReferences, handleSend])

  return (
    <div className="input-bar-container" style={{ position: 'relative' }}>
      {showFileSuggestions && filteredFiles.length > 0 && (
        <div className="input-file-suggestions">
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
                className={`input-file-suggestion-item ${isSelected ? 'selected' : ''}`}
              >
                <SymbolsFileIcon
                  fileName={name}
                  autoAssign={true}
                  width={14}
                  height={14}
                  className="input-file-icon"
                />
                <div className="input-file-details">
                  <span className="input-file-name">
                    {name}
                  </span>
                  {dir && (
                    <span className="input-file-dir">
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
                  className="input-file-icon"
                />
              )}
              <span className="input-attachment-name">
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
      <div className="input-bar-text-container input-bar-text-container-inner">
        {fileReferences.map((ref, idx) => (
          <div
            key={`ref-${idx}`}
            title={ref.path}
            className="input-file-reference"
          >
            <SymbolsFileIcon
              fileName={ref.name}
              autoAssign={true}
              width={14}
              height={14}
              className="input-file-icon"
            />
            <span className="input-file-reference-name">
              {ref.name}
            </span>
          </div>
        ))}

        <TextareaAutosize
          ref={textareaRef}
          minRows={1}
          maxRows={8}
          className="input-bar-text-area input-bar-text-area-override"
          placeholder={(attachments.length > 0 || fileReferences.length > 0) ? '' : 'Ask anything, @ to mention'}
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
          style={{ opacity: isRunning ? 0.7 : 1 } as any}
        />
      </div>

      <div className="input-bar-toolbar">
        <div className="input-bar-toolbar-left">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <div className="toolbar-icon-btn" title="Add file or image">
                <Plus size={16} />
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
                >
                  <Image size={14} />
                  <span>Upload Image</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => triggerFileSelect('document')}
                  className="profile-dropdown-item"
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
              <div className="toolbar-selector" title="Select mode">
                <ChevronDown size={14} />
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
                    className={`profile-dropdown-item ${mode === planningMode ? 'selected' : ''}`}
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
              <div className="toolbar-selector" title="Select model">
                <ChevronDown size={14} />
                <span>
                  {availableModels[selectedModel]?.name || selectedModel}
                </span>
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content asChild sideOffset={6}>
                <div
                  className="native-dropdown-content"
                  style={getDropdownStyle(200)}
                >
                {Object.entries(availableModels).map(([key, model]) => (
                  <DropdownMenu.Item
                    key={key}
                    onSelect={() => setSelectedModel(key)}
                    className={`profile-dropdown-item ${selectedModel === key ? 'selected' : ''}`}
                  >
                    <span style={{ fontWeight: 500 }}>{model.name}</span>
                  </DropdownMenu.Item>
                ))}
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
              className="token-ring-svg"
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
                className="token-ring-circle"
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
              disabled={!inputValue.trim() && attachments.length === 0 && fileReferences.length === 0}
              style={{ opacity: (inputValue.trim() || attachments.length > 0 || fileReferences.length > 0) ? 1 : 0.4 }}
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
