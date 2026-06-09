import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Plus, ChevronDown, ArrowRight, Square, Image, FileText } from 'lucide-react'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { agentRunStateAtom, sessionTokensAtom, selectedModelAtom, availableModelsAtom, activeThreadIdAtom, activeWorkspaceAtom, isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom } from '../store/agentStore'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import AutocompleteSuggestions from './AutocompleteSuggestions'
import { workspaceService } from '../services/services'
import { TokenIndicator } from './TokenIndicator'
import { toast } from 'sonner'

interface InputBarProps { onSubmit?: (val: string, attachments?: any[]) => void; onStop?: () => void }

const MAX_TOKENS = 200_000
const MAX_ATTACHMENTS = 8
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024

const InputBar: React.FC<InputBarProps> = ({ onSubmit, onStop }) => {
  const [inputValue, setInputValue] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const chipRootsRef = useRef<ReturnType<typeof createRoot>[]>([])
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
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      const fileData = await window.api.invoke('file:read', { filePath, conversationId }) as any
      if (fileData) { setActiveEditorFile(fileData); setArtifactPanelMode('editor'); setArtifactPanelOpen(true) }
    } catch (err) { console.error('Failed to open file:', err); toast.error('Failed to open file') }
  }, [conversationId, setActiveEditorFile, setArtifactPanelMode, setArtifactPanelOpen])

  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest('.file-mention-chip')
    if (chip) { e.preventDefault(); e.stopPropagation(); const path = chip.getAttribute('data-path'); if (path) handleOpenFile(path) }
  }, [handleOpenFile])

  const fetchWorkspaceFiles = useCallback(async () => {
    if (!conversationId) return
    try { const files = await workspaceService.listWorkspaceFiles(conversationId); setWorkspaceFiles(files) }
    catch (err) { console.error('Failed to load workspace files:', err) }
  }, [conversationId])

  useEffect(() => { fetchWorkspaceFiles() }, [activeWorkspace, conversationId, fetchWorkspaceFiles])

  const filteredFiles = workspaceFiles.filter((f) => f.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 15)

  const checkSuggestions = useCallback(() => {
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
  }, [])

  const selectFileSuggestion = useCallback((selectedFile: string) => {
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
    const chip = document.createElement('span')
    chip.className = 'file-mention-chip'
    chip.setAttribute('contenteditable', 'false')
    chip.setAttribute('data-path', absolutePath)
    chip.setAttribute('data-name', name)
    chip.innerHTML = `<span class="react-icon-root" style="display: inline-flex; align-items: center; vertical-align: middle; margin-right: 3px;"></span><span style="font-size: 13px;">${name}</span>`
    range.insertNode(chip)
    const iconRoot = chip.querySelector('.react-icon-root')
    if (iconRoot) {
      const root = createRoot(iconRoot)
      root.render(<SymbolsFileIcon fileName={name} autoAssign={true} width={13} height={13} />)
      chipRootsRef.current.push(root)
    }
    const spaceNode = document.createTextNode('\u00A0')
    chip.parentNode?.insertBefore(spaceNode, chip.nextSibling)
    const newRange = document.createRange()
    newRange.setStartAfter(spaceNode)
    newRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(newRange)
    setShowFileSuggestions(false)
    if (editorRef.current) setInputValue(editorRef.current.innerText || '')
  }, [activeWorkspace])

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
    chipRootsRef.current.forEach((r) => { try { r.unmount() } catch (err) { console.debug('[InputBar] Unmount error:', err) } })
    chipRootsRef.current = []
    editorRef.current.innerHTML = ''
    setInputValue('')
    setAttachments([])
  }, [attachments, isRunning, onSubmit])

  const handleStop = useCallback(() => onStop?.(), [onStop])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
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
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showFileSuggestions && filteredFiles.length > 0) {
      const len = filteredFiles.length
      if (e.key === 'ArrowDown') { e.preventDefault(); return setSuggestionIndex((prev) => (prev + 1) % len) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setSuggestionIndex((prev) => (prev - 1 + len) % len) }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return selectFileSuggestion(filteredFiles[suggestionIndex]) }
      if (e.key === 'Escape') { e.preventDefault(); return setShowFileSuggestions(false) }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [showFileSuggestions, filteredFiles, suggestionIndex, selectFileSuggestion, handleSend])

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
      <div className="input-bar-text-container-inner" onClick={() => editorRef.current?.focus()} style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0, cursor: 'text' }}>
        <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
          {inputValue.trim().length === 0 && (
            <div style={{ position: 'absolute', left: 0, top: '2px', color: 'var(--text-secondary)', opacity: 0.4, pointerEvents: 'none', userSelect: 'none', fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-md-plus)' }}>
              Ask anything, @ to mention
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            className="input-bar-text-area input-bar-text-area-override"
            style={{ outline: 'none', minHeight: '24px', maxHeight: '180px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}
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
            <button className="toolbar-submit-btn" onClick={handleSend} title="Submit" disabled={!inputValue.trim() && attachments.length === 0}>
              <ArrowRight size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
export default InputBar
