import React, { useState, useRef, useEffect, useActionState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useFormStatus } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { Plus, ChevronUp, ArrowRight, Square, Image, FileText, MessageSquarePlus, Mic, MicOff } from 'lucide-react'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import Dropdown, { DropdownItem } from './Dropdown'
import ApprovalCard from './ApprovalCard'
import { agentRunStateAtom, selectedModelAtom, availableModelsAtom, activeThreadIdAtom, activeWorkspaceAtom, isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, isDiffModeAtom, pendingApprovalAtom } from '../store/agentStore'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import Tooltip from './Tooltip'

import { workspaceService } from '../services/services'
import { toast } from 'sonner'

interface InputBarProps { onSubmit?: (val: string, attachments?: any[]) => void; onStop?: () => void }

const MAX_ATTACHMENTS = 8
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024

export const AutocompleteSuggestions: React.FC<{ showFileSuggestions: boolean, filteredFiles: string[], suggestionIndex: number, setSuggestionIndex: (idx: number) => void, selectFileSuggestion: (file: string) => void }> = ({ showFileSuggestions, filteredFiles, suggestionIndex, setSuggestionIndex, selectFileSuggestion }) => {
  if (!showFileSuggestions || filteredFiles.length === 0) return null
  return (
    <div className="input-file-suggestions">
      {filteredFiles.map((file, idx) => {
        const isSelected = idx === suggestionIndex
        const parts = file.split(/[/\\]/)
        const name = parts[parts.length - 1]
        const dir = parts.slice(0, -1).join('/')
        return (
          <div key={file} onClick={() => selectFileSuggestion(file)} onMouseEnter={() => setSuggestionIndex(idx)} className={`input-file-suggestion-item${isSelected ? ' input-file-suggestion-item-selected' : ''}`}>
            <SymbolsFileIcon fileName={name} autoAssign={true} width={14} height={14} className="input-file-icon" />
            <div className="input-file-details">
              <span className="input-file-name">{name}</span>
              {dir && <span className="input-file-dir">{dir}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const MediaPreview: React.FC<{ displayFile: { name: string; path: string; isBinary?: boolean; mimeType?: string; base64?: string } }> = ({ displayFile }) => {
  const { mimeType, base64, name } = displayFile
  const src = `data:${mimeType};base64,${base64}`
  return (
    <div className="media-preview-outer media-preview-container">
      {mimeType?.startsWith('image/') && <div className="media-image-wrapper"><img src={src} alt={name} className="media-preview-image" /></div>}
      {mimeType?.startsWith('video/') && <video controls autoPlay src={src} className="media-preview-video" />}
      {mimeType?.startsWith('audio/') && <div className="media-audio-wrapper"><span className="media-audio-label">{name}</span><audio controls autoPlay src={src} className="media-preview-audio" /></div>}
      {!mimeType?.startsWith('image/') && !mimeType?.startsWith('video/') && !mimeType?.startsWith('audio/') && <div className="media-unsupported">Unsupported preview format ({mimeType})</div>}
    </div>
  )
}

const SubmitButton: React.FC<{ isRunning: boolean; hasInput: boolean; handleStop: () => void; handleInject: () => void }> = ({ isRunning, hasInput, handleStop, handleInject }) => {
  const { pending } = useFormStatus()
  if (isRunning) {
    return (
      <>
        {hasInput && (
          <Tooltip content="Pause and inject message"><button className="toolbar-submit-btn inject" onClick={handleInject} type="button"><MessageSquarePlus size={13} strokeWidth={2} /></button></Tooltip>
        )}
        <Tooltip content="Stop generation"><button className="toolbar-submit-btn stop" onClick={handleStop} type="button"><Square size={11} strokeWidth={3} /></button></Tooltip>
      </>
    )
  }
  if (!hasInput) return null
  return (
    <Tooltip content="Submit"><button className="toolbar-submit-btn" type="submit" disabled={pending}><ArrowRight size={14} strokeWidth={2.5} /></button></Tooltip>
  )
}

const InputBar: React.FC<InputBarProps> = ({ onSubmit, onStop }) => {
  const [inputValue, setInputValue] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [isUploadDropdownOpen, setIsUploadDropdownOpen] = useState(false)
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [_, submitAction] = useActionState(async () => { handleSend() }, null)
  const runState = useAtomValue(agentRunStateAtom)
  const availableModels = useAtomValue(availableModelsAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const [attachments, setAttachments] = useState<Array<{ type: 'image' | 'document'; name: string; mimeType: string; base64: string }>>([])
  const supportsVision = !!availableModels[selectedModel]?.multimodal
  useHotkeys('ctrl+shift+u, cmd+shift+u', (e) => { e.preventDefault(); if (supportsVision) setIsUploadDropdownOpen(o => !o) }, { enableOnFormTags: true })
  useHotkeys('ctrl+m, cmd+m', (e) => { e.preventDefault(); if (Object.keys(availableModels).length > 0) setIsModelDropdownOpen(o => !o) }, { enableOnFormTags: true })
  const isPanelOpen = useAtomValue(isArtifactPanelOpenAtom), panelMode = useAtomValue(artifactPanelModeAtom), isBrowserActive = isPanelOpen && panelMode === 'browser'
  useEffect(() => {
    if (isBrowserActive && Object.keys(availableModels).length > 0 && !availableModels[selectedModel]?.multimodal) {
      const fv = Object.keys(availableModels).find(k => availableModels[k].multimodal); if (fv) setSelectedModel(fv)
    }
  }, [isBrowserActive, availableModels, selectedModel, setSelectedModel])
  useEffect(() => { if (!supportsVision && attachments.length > 0) setAttachments([]) }, [supportsVision])
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<any>(null)
  useEffect(() => {
    return () => { recognitionRef.current?.stop() }
  }, [])
  const toggleListening = () => {
    if (isListening) { recognitionRef.current?.stop(); return }
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRec) { toast.error("Speech recognition not supported"); return }
    const rec = new SpeechRec()
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'
    let finalTranscript = ''
    rec.onstart = () => setIsListening(true)
    rec.onresult = (e: any) => {
      let interimTranscript = ''
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript
        else interimTranscript += e.results[i][0].transcript
      }
      if (editorRef.current) {
        const text = finalTranscript + interimTranscript
        editorRef.current.innerText = text; setInputValue(text)
      }
    }
    rec.onerror = () => setIsListening(false)
    rec.onend = () => setIsListening(false)
    recognitionRef.current = rec; rec.start()
  }
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isRunning = runState !== 'idle' && runState !== 'error'
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const conversationId = useAtomValue(activeThreadIdAtom)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [showFileSuggestions, setShowFileSuggestions] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const setIsDiffMode = useSetAtom(isDiffModeAtom)
  const pendingApproval = useAtomValue(pendingApprovalAtom)

  const handleOpenFile = async (filePath: string) => {
    try {
      const fileData = await window.api.invoke('file:read', { filePath, conversationId }) as any
      if (fileData) { setIsDiffMode(false); setActiveEditorFile(fileData); setArtifactPanelMode('editor'); setArtifactPanelOpen(true) }
    } catch (err) { console.error('Failed to open file:', err); toast.error('Failed to open file') }
  }

  const handleEditorClick = (e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest('.file-mention-chip')
    if (chip) { e.preventDefault(); e.stopPropagation(); const path = chip.getAttribute('data-path'); if (path) handleOpenFile(path) }
  }

  const fetchWorkspaceFiles = async () => {
    if (!conversationId) return
    try { const files = await workspaceService.listWorkspaceFiles(conversationId); setWorkspaceFiles(files) }
    catch (err) { console.error('Failed to load workspace files:', err) }
  }

  useEffect(() => { fetchWorkspaceFiles() }, [activeWorkspace, conversationId])

  const filteredFiles = workspaceFiles.filter((f) => f.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 15)

  const checkSuggestions = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return setShowFileSuggestions(false)
    const range = selection.getRangeAt(0)
    if (!editorRef.current || !editorRef.current.contains(range.startContainer)) return setShowFileSuggestions(false)
    const container = range.startContainer
    if (container.nodeType !== Node.TEXT_NODE) return setShowFileSuggestions(false)
    const text = container.textContent || ''
    const offset = range.startOffset
    const textBeforeCursor = text.slice(0, offset)
    const lastAtIdx = textBeforeCursor.lastIndexOf('@')
    if (lastAtIdx !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIdx + 1)
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setSearchQuery(textAfterAt); setShowFileSuggestions(true); setSuggestionIndex(0)
        return
      }
    }
    setShowFileSuggestions(false)
  }

  const selectFileSuggestion = (selectedFile: string) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!editorRef.current || !editorRef.current.contains(range.startContainer)) return
    const container = range.startContainer
    if (container.nodeType !== Node.TEXT_NODE) return
    const name = selectedFile.split(/[/\\]/).pop() || selectedFile
    const text = container.textContent || ''
    const offset = range.startOffset
    const atIdx = text.slice(0, offset).lastIndexOf('@')
    if (atIdx === -1) return
    range.setStart(container, atIdx)
    range.setEnd(container, offset)
    range.deleteContents()
    const wsPath = activeWorkspace?.path ?? ''; const sep = wsPath.includes('\\') ? '\\' : '/'
    const normalizedSelectedFile = selectedFile.replace(/[/\\]/g, sep)
    const absolutePath = wsPath ? `${wsPath}${sep}${normalizedSelectedFile}` : `/${normalizedSelectedFile.replace(/[/\\]/g, '/')}`
    const iconHtml = renderToStaticMarkup(<SymbolsFileIcon fileName={name} autoAssign={true} width={13} height={13} />)
    const chip = document.createElement('span')
    chip.className = 'file-mention-chip'
    chip.setAttribute('contenteditable', 'false')
    chip.setAttribute('data-path', absolutePath)
    chip.setAttribute('data-name', name)
    chip.innerHTML = `<span style="display: inline-flex; align-items: center; vertical-align: middle; margin-right: 3px;">${iconHtml}</span><span style="font-size: 13px;">${name}</span>`
    range.insertNode(chip)
    const spaceNode = document.createTextNode('\u00A0')
    chip.parentNode?.insertBefore(spaceNode, chip.nextSibling)
    const newRange = document.createRange()
    newRange.setStartAfter(spaceNode)
    newRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(newRange)
    setShowFileSuggestions(false)
    if (editorRef.current) setInputValue(editorRef.current.innerText || '')
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
  }

  const handleSend = () => {
    if (!editorRef.current) return
    let val = ''
    const traverse = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { val += node.textContent }
      else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        if (el.classList.contains('file-mention-chip')) {
          const path = el.getAttribute('data-path') || ''
          const name = el.getAttribute('data-name') || el.textContent || ''
          val += `[${name}](file://${path})`
        } else if (el.tagName === 'BR') { val += '\n' }
        else if (el.tagName === 'DIV' || el.tagName === 'P') {
          if (val && !val.endsWith('\n')) val += '\n'
          Array.from(el.childNodes).forEach(traverse)
          if (!val.endsWith('\n')) val += '\n'
        } else { Array.from(el.childNodes).forEach(traverse) }
      }
    }
    Array.from(editorRef.current.childNodes).forEach(traverse)
    val = val.trim()
    if ((!val && attachments.length === 0) || isRunning) return
    onSubmit?.(val, attachments)
    editorRef.current.innerHTML = ''
    setInputValue('')
    setAttachments([])
  }

  const handleStop = () => onStop?.()

  const handleInject = () => {
    if (!editorRef.current || !conversationId) return
    let val = ''
    const traverse = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { val += node.textContent }
      else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        if (el.classList.contains('file-mention-chip')) {
          val += `[${el.getAttribute('data-name') || el.textContent || ''}](file://${el.getAttribute('data-path') || ''})`
        } else if (el.tagName === 'BR') { val += '\n' }
        else { Array.from(el.childNodes).forEach(traverse) }
      }
    }
    Array.from(editorRef.current.childNodes).forEach(traverse)
    val = val.trim()
    if (!val) return
    window.api.injectToStream(conversationId, val)
    editorRef.current.innerHTML = ''
    setInputValue('')
    setAttachments([])
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    range.insertNode(document.createTextNode(text))
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    if (editorRef.current) setInputValue(editorRef.current.innerText || '')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showFileSuggestions && filteredFiles.length > 0) {
      const len = filteredFiles.length
      if (e.key === 'ArrowDown') { e.preventDefault(); return setSuggestionIndex((prev) => (prev + 1) % len) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setSuggestionIndex((prev) => (prev - 1 + len) % len) }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return selectFileSuggestion(filteredFiles[suggestionIndex]) }
      if (e.key === 'Escape') { e.preventDefault(); return setShowFileSuggestions(false) }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); formRef.current?.requestSubmit() }
  }

  if (pendingApproval) return <ApprovalCard />
  return (
    <form ref={formRef} action={submitAction} className="input-bar-container">
      <AutocompleteSuggestions showFileSuggestions={showFileSuggestions} filteredFiles={filteredFiles} suggestionIndex={suggestionIndex} setSuggestionIndex={setSuggestionIndex} selectFileSuggestion={selectFileSuggestion} />
      <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden-input" />
      {attachments.length > 0 && (
        <div className="input-attachments-container">
          {attachments.map((att, idx) => (
            <Tooltip key={`att-${idx}`} content={att.name}>
              <div className="input-attachment-chip">
                {att.type === 'image' ? <img src={`data:${att.mimeType};base64,${att.base64}`} alt={att.name} className="input-attachment-chip-img" /> : (
                  <SymbolsFileIcon fileName={att.name.split('/').pop() || att.name} autoAssign={true} width={14} height={14} className="input-file-icon" />
                )}
                <span className="input-attachment-name">{att.name.split('/').pop() || att.name}</span>
                <button onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))} className="input-attachment-close">✕</button>
              </div>
            </Tooltip>
          ))}
        </div>
      )}
      <div className="input-bar-text-container-inner" onClick={() => editorRef.current?.focus()}>
        <div className="input-bar-editor-wrapper">
          {inputValue.trim().length === 0 && !editorRef.current?.querySelector('.file-mention-chip') && (
            <div className="input-bar-placeholder">
              Ask anything, @ to mention, / for actions
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            className="input-bar-text-area input-bar-text-area-override"
            onInput={() => { if (editorRef.current) { setInputValue(editorRef.current.innerText || ''); checkSuggestions() } }}
            onKeyDown={handleKeyDown}
            onKeyUp={checkSuggestions}
            onMouseUp={checkSuggestions}
            onPaste={handlePaste}
            onClick={handleEditorClick}
          />
        </div>
      </div>
      <div className="input-bar-toolbar">
        <style>{`
          @keyframes mic-pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.08); }
            100% { transform: scale(1); }
          }
        `}</style>
        <div className="input-bar-toolbar-left">
          {supportsVision && (
            <Dropdown open={isUploadDropdownOpen} onOpenChange={setIsUploadDropdownOpen} sideOffset={6} className="dropdown-menu-content-sm" trigger={
              <Tooltip content="Add file or image (Ctrl+Shift+U)"><button type="button" className="toolbar-icon-btn"><Plus size={16} /></button></Tooltip>
            }>
              <DropdownItem onSelect={() => triggerFileSelect('image')} className="app-dropdown-item"><Image size={14} /><span>Upload Image</span></DropdownItem>
              <DropdownItem onSelect={() => triggerFileSelect('document')} className="app-dropdown-item"><FileText size={14} /><span>Upload Document</span></DropdownItem>
            </Dropdown>
          )}
          <Dropdown open={isModelDropdownOpen} onOpenChange={setIsModelDropdownOpen} sideOffset={6} className="dropdown-menu-content-md" trigger={
            <Tooltip content={Object.keys(availableModels).length === 0 ? 'No models available' : 'Select model (Ctrl+M)'}>
              <button type="button" className="toolbar-selector" disabled={Object.keys(availableModels).length === 0}>
                <span>{Object.keys(availableModels).length === 0 ? 'No models' : availableModels[selectedModel]?.name || selectedModel || 'Select model'}</span>
                {availableModels[selectedModel]?.badge && <span className="model-badge">{availableModels[selectedModel].badge}</span>}
                <ChevronUp size={14} />
              </button>
            </Tooltip>
          }>
            {Object.entries(availableModels).filter(([_, model]) => !isBrowserActive || model.multimodal).map(([key, model]) => (
              <DropdownItem key={key} onSelect={() => setSelectedModel(key)} className={`app-dropdown-item${selectedModel === key ? ' selected' : ''}`}>
                <span className="font-medium">{model.name}</span>
                {model.badge && <span className="model-badge">{model.badge}</span>}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
        <div className="input-bar-toolbar-right">
          <Tooltip content={isListening ? "Stop voice input" : "Start voice input"}>
            <button
              type="button"
              onClick={toggleListening}
              className={`toolbar-icon-btn toolbar-voice-btn ${isListening ? 'listening' : ''}`}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          </Tooltip>
          <SubmitButton isRunning={isRunning} hasInput={!!(inputValue.trim() || attachments.length > 0)} handleStop={handleStop} handleInject={handleInject} />
        </div>
      </div>
    </form>
  )
}
export default InputBar
