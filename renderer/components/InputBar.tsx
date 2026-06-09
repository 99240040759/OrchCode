import React, { useState, useRef, useEffect, useCallback } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { Plus, ChevronDown, ArrowRight, Square, Image, FileText } from 'lucide-react'
import { useAtomValue, useAtom } from 'jotai'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { agentRunStateAtom, sessionTokensAtom, selectedModelAtom, availableModelsAtom, activeThreadIdAtom, activeWorkspaceAtom } from '../store/agentStore'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import AutocompleteSuggestions from './AutocompleteSuggestions'
import { workspaceService } from '../services/services'
import { TokenIndicator } from './TokenIndicator'
import { toast } from 'sonner'

interface InputBarProps { onSubmit?: (val: string, mode?: string, attachments?: any[]) => void; onStop?: () => void }

const MAX_TOKENS = 200_000
const MAX_ATTACHMENTS = 8
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024

const InputBar: React.FC<InputBarProps> = ({ onSubmit, onStop }) => {
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runState = useAtomValue(agentRunStateAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const sessionTokens = useAtomValue(sessionTokensAtom)
  const availableModels = useAtomValue(availableModelsAtom)
  const [attachments, setAttachments] = useState<Array<{ type: 'image' | 'document'; name: string; mimeType: string; base64: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isRunning = runState !== 'idle' && runState !== 'error'
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const conversationId = useAtomValue(activeThreadIdAtom)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [showFileSuggestions, setShowFileSuggestions] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [triggerIndex, setTriggerIndex] = useState(-1)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [fileReferences, setFileReferences] = useState<Array<{ name: string; path: string }>>([])

  const fetchWorkspaceFiles = useCallback(async () => {
    if (!conversationId) return
    try { const files = await workspaceService.listWorkspaceFiles(conversationId); setWorkspaceFiles(files) }
    catch (err) { console.error('Failed to load workspace files:', err) }
  }, [conversationId])

  useEffect(() => { fetchWorkspaceFiles() }, [activeWorkspace, conversationId, fetchWorkspaceFiles])

  const filteredFiles = workspaceFiles.filter((f) => f.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 15)

  const selectFileSuggestion = useCallback((selectedFile: string) => {
    if (!textareaRef.current) return
    const currentEl = textareaRef.current
    setInputValue((prev) => { const selStart = currentEl.selectionStart || 0; return prev.slice(0, triggerIndex) + prev.slice(selStart) })
    setShowFileSuggestions(false)
    const wsPath = activeWorkspace?.path ?? ''
    const sep = wsPath.includes('\\') ? '\\' : '/'
    const normalizedSelectedFile = selectedFile.replace(/[/\\]/g, sep)
    const absolutePath = wsPath ? `${wsPath}${sep}${normalizedSelectedFile}` : `/${normalizedSelectedFile.replace(/[/\\]/g, '/')}`
    const name = selectedFile.split(/[/\\]/).pop() || selectedFile
    setFileReferences((prev) => prev.some((p) => p.path === absolutePath) ? prev : [...prev, { name, path: absolutePath }])
    setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(triggerIndex, triggerIndex) }, 0)
  }, [triggerIndex, activeWorkspace])


  const checkSuggestions = useCallback((val: string, selectionStart: number | null) => {
    if (selectionStart === null) return setShowFileSuggestions(false)
    const textBeforeCursor = val.slice(0, selectionStart)
    const lastAtIdx = textBeforeCursor.lastIndexOf('@')
    if (lastAtIdx !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIdx + 1)
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setTriggerIndex(lastAtIdx); setSearchQuery(textAfterAt); setShowFileSuggestions(true); setSuggestionIndex(0)
        return
      }
    }
    setShowFileSuggestions(false)
  }, [fetchWorkspaceFiles])

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
    const type = (fileInputRef.current?.getAttribute('data-upload-type') as 'image' | 'document') || 'document'
    const selectedFiles = Array.from(files)
    const existingBytes = attachments.reduce((total, att) => total + Math.ceil(att.base64.length * 0.75), 0)
    const accepted: File[] = []; let totalBytes = existingBytes
    for (const file of selectedFiles) {
      if (attachments.length + accepted.length >= MAX_ATTACHMENTS) { toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`); break }
      if (file.size > MAX_ATTACHMENT_BYTES) { toast.error(`${file.name} exceeds the 10 MB attachment limit.`); continue }
      if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) { toast.error('Attachments exceed the 25 MB total limit.'); break }
      accepted.push(file); totalBytes += file.size
    }
    accepted.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result as string
        const base64 = result.split(',')[1] || result
        setAttachments((prev) => [...prev, { type, name: file.name, mimeType: file.type || (type === 'image' ? 'image/png' : 'text/plain'), base64 }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }, [attachments])

  const handleSend = useCallback(() => {
    let val = inputValue.trim()
    if ((!val && attachments.length === 0 && fileReferences.length === 0) || isRunning) return
    if (fileReferences.length > 0) { const refsText = fileReferences.map((ref) => `[${ref.name}](file://${ref.path})`).join(' '); val = `${val} ${refsText}`.trim() }
    onSubmit?.(val, undefined, attachments)
    setInputValue(''); setAttachments([]); setFileReferences([])
  }, [inputValue, attachments, fileReferences, isRunning, onSubmit])

  const handleStop = useCallback(() => onStop?.(), [onStop])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showFileSuggestions && filteredFiles.length > 0) {
      const len = filteredFiles.length
      if (e.key === 'ArrowDown') { e.preventDefault(); return setSuggestionIndex((prev) => (prev + 1) % len) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setSuggestionIndex((prev) => (prev - 1 + len) % len) }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return selectFileSuggestion(filteredFiles[suggestionIndex]) }
      if (e.key === 'Escape') { e.preventDefault(); return setShowFileSuggestions(false) }
    }
    if (e.key === 'Backspace' && fileReferences.length > 0 && textareaRef.current?.selectionStart === 0) {
      e.preventDefault(); setFileReferences((prev) => prev.slice(0, -1))
    } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [showFileSuggestions, filteredFiles, suggestionIndex, selectFileSuggestion, fileReferences, handleSend])

  return (
    <div className="input-bar-container">
      <AutocompleteSuggestions showFileSuggestions={showFileSuggestions} filteredFiles={filteredFiles} suggestionIndex={suggestionIndex} setSuggestionIndex={setSuggestionIndex} selectFileSuggestion={selectFileSuggestion} />
      <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden-input" />
      {attachments.length > 0 && (
        <div className="input-attachments-container">
          {attachments.map((att, idx) => (
            <div key={`att-${idx}`} className="input-attachment-chip" title={att.name}>
              {att.type === 'image' ? <img src={`data:${att.mimeType};base64,${att.base64}`} alt={att.name} className="input-attachment-chip-img" /> : (
                <SymbolsFileIcon fileName={att.name.split('/').pop() || att.name} autoAssign={true} width={14} height={14} className="input-file-icon" />
              )}
              <span className="input-attachment-name">{att.name.split('/').pop() || att.name}</span>
              <button onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))} className="input-attachment-close">✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="input-bar-text-container-inner">
        {fileReferences.map((ref, idx) => (
          <div key={`ref-${idx}`} title={ref.path} className="input-file-reference">
            <SymbolsFileIcon fileName={ref.name} autoAssign={true} width={14} height={14} className="input-file-icon" />
            <span className="input-file-reference-name">{ref.name}</span>
            <button onClick={() => setFileReferences((prev) => prev.filter((_, i) => i !== idx))} className="input-attachment-close">✕</button>
          </div>
        ))}
        <TextareaAutosize ref={textareaRef} minRows={1} maxRows={8} className="input-bar-text-area input-bar-text-area-override"
          placeholder={attachments.length > 0 || fileReferences.length > 0 ? '' : 'Ask anything, @ to mention'} value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); checkSuggestions(e.target.value, e.target.selectionStart) }}
          onSelect={(e) => { const target = e.target as HTMLTextAreaElement; checkSuggestions(target.value, target.selectionStart) }}
          onKeyDown={handleKeyDown} />
      </div>
      <div className="input-bar-toolbar">
        <div className="input-bar-toolbar-left">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <div className="toolbar-icon-btn" title="Add file or image"><Plus size={16} /></div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content asChild sideOffset={6}>
                <div className="app-dropdown-panel dropdown-menu-content dropdown-menu-content-sm">
                  <DropdownMenu.Item onSelect={() => triggerFileSelect('image')} className="app-dropdown-item"><Image size={14} /><span>Upload Image</span></DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => triggerFileSelect('document')} className="app-dropdown-item"><FileText size={14} /><span>Upload Document</span></DropdownMenu.Item>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild disabled={Object.keys(availableModels).length === 0}>
              <div className="toolbar-selector" title={Object.keys(availableModels).length === 0 ? 'No models available' : 'Select model'}>
                <ChevronDown size={14} />
                <span>{Object.keys(availableModels).length === 0 ? 'No models' : availableModels[selectedModel]?.name || selectedModel || 'Select model'}</span>
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content asChild sideOffset={6}>
                <div className="app-dropdown-panel dropdown-menu-content dropdown-menu-content-md">
                  {Object.entries(availableModels).map(([key, model]) => (
                    <DropdownMenu.Item key={key} onSelect={() => setSelectedModel(key)} className={`app-dropdown-item${selectedModel === key ? ' selected' : ''}`}>
                      <span className="font-medium">{model.name}</span>
                    </DropdownMenu.Item>
                  ))}
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <div className="input-bar-toolbar-right">
          <TokenIndicator current={sessionTokens} max={MAX_TOKENS} />
          {isRunning ? (
            <button className="toolbar-submit-btn stop" onClick={handleStop} title="Stop generation"><Square size={11} strokeWidth={3} /></button>
          ) : (
            <button className="toolbar-submit-btn" onClick={handleSend} title="Submit" disabled={!inputValue.trim() && attachments.length === 0 && fileReferences.length === 0}>
              <ArrowRight size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default InputBar
