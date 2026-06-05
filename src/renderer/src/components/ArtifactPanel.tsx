import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { useAtom, useAtomValue } from 'jotai'
import { X, Globe, TerminalSquare, ListTodo, PanelRightClose } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import {
  isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom,
  activeWorkspaceAtom, activeThreadIdAtom, openFilesAtom, artifactsAtom,
  type EditorFile
} from '../store/agentStore'
import type { ArtifactEntry, FileReadResult } from '../../../preload/index.d'
import { isAgentArtifact, getArtifactIcon, getDisplayName } from '../lib/uiUtils'
import { setupMonaco } from '../lib/monacoConfig'
import type { TerminalViewHandle } from './TerminalView'
import OverviewPanel from './OverviewPanel'
import TerminalView from './TerminalView'
import BrowserView from './BrowserView'
import MediaPreview from './MediaPreview'
import MarkdownView from './MarkdownView'
import { EmptyState } from './Primitives'

const CodeEditorView = React.lazy(() => import('./CodeEditorView'))
const isMac = window.api.platform === 'darwin'

// ─── Header (inline) ─────────────────────────────────────────────────────────

interface HeaderProps {
  panelMode: string
  openFiles: EditorFile[]
  hoveredTabPath: string | null
  setHoveredTabPath: (p: string | null) => void
  handleCloseFile: (file: EditorFile, e: React.MouseEvent) => void
  handleClose: () => void
}

const PanelHeader: React.FC<HeaderProps> = ({ panelMode, openFiles, hoveredTabPath, setHoveredTabPath, handleCloseFile, handleClose }) => (
  <div className={`artifact-panel-header ${isMac ? 'artifact-panel-header-mac' : 'artifact-panel-header-win'}`}>
    <Tabs.List className="artifact-panel-tabs-list">
      <Tabs.Trigger value="overview" className="artifact-tab-trigger">
        <ListTodo size={14} style={{ color: panelMode === 'overview' ? 'var(--accent-purple)' : 'var(--text-secondary)' }} />
        <span>Overview</span>
      </Tabs.Trigger>
      <Tabs.Trigger value="terminal" className="artifact-tab-trigger">
        <TerminalSquare size={14} style={{ color: panelMode === 'terminal' ? 'var(--accent-green)' : 'var(--text-secondary)' }} />
        <span>Terminal</span>
      </Tabs.Trigger>
      <Tabs.Trigger value="browser" className="artifact-tab-trigger">
        <Globe size={14} style={{ color: panelMode === 'browser' ? 'var(--accent-blue)' : 'var(--text-secondary)' }} />
        <span>Browser</span>
      </Tabs.Trigger>
      {openFiles.map((file) => {
        const isHovered = hoveredTabPath === file.path
        return (
          <Tabs.Trigger key={file.path} value={file.path} className="artifact-tab-trigger" onMouseEnter={() => setHoveredTabPath(file.path)} onMouseLeave={() => setHoveredTabPath(null)}>
            <div className="tab-icon-wrapper">
              {isHovered ? (
                <span onClick={(e) => handleCloseFile(file, e)} className="tab-close-btn"><X size={10} /></span>
              ) : isAgentArtifact(file.name) ? getArtifactIcon(file.name) : (
                <SymbolsFileIcon fileName={file.name} autoAssign={true} width={16} height={16} style={{ flexShrink: 0 }} />
              )}
            </div>
            <span>{getDisplayName(file.name)}</span>
          </Tabs.Trigger>
        )
      })}
    </Tabs.List>
    <div onClick={handleClose} title="Collapse Panel" className="artifact-panel-close-btn">
      <PanelRightClose size={16} strokeWidth={1.5} color="var(--text-secondary)" />
    </div>
  </div>
)

// ─── ArtifactPanel ────────────────────────────────────────────────────────────

const ArtifactPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isArtifactPanelOpenAtom)
  const [activeFile, setActiveFile] = useAtom(activeEditorFileAtom)
  const [panelMode, setPanelMode] = useAtom(artifactPanelModeAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const [openFiles, setOpenFiles] = useAtom(openFilesAtom)

  useEffect(() => {
    if (activeFile) {
      setOpenFiles((prev) => {
        const existingIndex = prev.findIndex((f) => f.path === activeFile.path)
        if (existingIndex === -1) return [...prev, activeFile]
        const next = [...prev]; next[existingIndex] = activeFile; return next
      })
    }
  }, [activeFile, setOpenFiles])

  const [hoveredTabPath, setHoveredTabPath] = useState<string | null>(null)
  const [themeLoaded, setThemeLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [artifacts, setArtifacts] = useAtom(artifactsAtom)
  const convId = useAtomValue(activeThreadIdAtom)
  const [isDiffMode, setIsDiffMode] = useState(false)
  const [originalContent, setOriginalContent] = useState<string | null>(null)
  const editorRef = useRef<any>(null)
  const diffEditorRef = useRef<any>(null)
  const terminalRef = useRef<TerminalViewHandle | null>(null)
  const browserWasOpenedRef = useRef(false)

  const handleEditorMount = useCallback((editor: any) => { editorRef.current = editor }, [])
  const handleDiffEditorMount = useCallback((editor: any) => { diffEditorRef.current = editor }, [])
  const handleSearchClick = useCallback(() => {
    if (isDiffMode) { const m = diffEditorRef.current?.getModifiedEditor(); m?.focus(); m?.trigger('actions', 'actions.find', null) }
    else { editorRef.current?.focus(); editorRef.current?.trigger('actions', 'actions.find', null) }
  }, [isDiffMode])

  useEffect(() => { setupMonaco().then(() => setThemeLoaded(true)) }, [])

  useEffect(() => {
    if (activeFile && isDiffMode) {
      setOriginalContent(null)
      window.api.invoke('file:read-original', { filePath: activeFile.path, conversationId: convId })
        .then((res) => setOriginalContent((res as any)?.content ?? ''))
        .catch((err) => { console.error('[ArtifactPanel] Failed to read original file:', err); setOriginalContent('') })
    } else { setOriginalContent(null) }
  }, [activeFile?.path, isDiffMode, convId])

  useEffect(() => {
    if (!convId) return
    let active = true
    setLoading(true)
    window.api.invoke('artifacts:list', { conversationId: convId })
      .then((data) => { if (active) { setArtifacts((data ?? []) as ArtifactEntry[]); setLoading(false) } })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [convId, setArtifacts])

  useEffect(() => {
    const unsub = window.api.on('artifacts:changed', (payload) => {
      const { conversationId, artifacts: arts } = payload as { conversationId: string; artifacts: ArtifactEntry[] }
      if (conversationId === convId) setArtifacts(arts ?? [])
    })
    return unsub
  }, [convId, setArtifacts])

  const handleOpenFile = useCallback((fileData: EditorFile) => {
    setOpenFiles((prev) => { const idx = prev.findIndex((f) => f.path === fileData.path); if (idx === -1) return [...prev, fileData]; const next = [...prev]; next[idx] = fileData; return next })
    setActiveFile(fileData); setPanelMode('editor')
  }, [setOpenFiles, setActiveFile, setPanelMode])

  const handleArtifactClick = useCallback(async (artifact: ArtifactEntry) => {
    try {
      const fileData = await window.api.invoke('file:read', { filePath: artifact.path, conversationId: convId }) as FileReadResult
      if (fileData) { setIsDiffMode(false); handleOpenFile(fileData) }
    } catch (err) { console.error('[ArtifactPanel] Failed to open artifact:', err) }
  }, [convId, handleOpenFile])

  const handleCloseFile = useCallback((fileToClose: EditorFile, e: React.MouseEvent) => {
    e.stopPropagation()
    const updatedFiles = openFiles.filter((f) => f.path !== fileToClose.path)
    setOpenFiles(updatedFiles)
    if (activeFile?.path === fileToClose.path) {
      if (updatedFiles.length > 0) { const nextFile = updatedFiles[updatedFiles.length - 1]; setActiveFile(nextFile); setPanelMode('editor') }
      else { setActiveFile(null); setPanelMode('overview') }
    }
  }, [openFiles, activeFile, setOpenFiles, setActiveFile, setPanelMode])

  useEffect(() => {
    if (panelMode === 'browser') browserWasOpenedRef.current = true
    if (panelMode === 'terminal') requestAnimationFrame(() => terminalRef.current?.fit())
  }, [panelMode])

  useEffect(() => {
    if (!isOpen && browserWasOpenedRef.current) {
      window.api.invoke('browser:close').catch(() => {})
      browserWasOpenedRef.current = false
    }
  }, [isOpen])

  const handleClose = useCallback(() => setIsOpen(false), [setIsOpen])
  if (!isOpen) return null

  const activeTabValue = panelMode === 'editor' ? (activeFile?.path ?? '') : panelMode
  const handleTabChange = useCallback((val: string) => {
    if (val === 'overview') { setPanelMode('overview'); setActiveFile(null) }
    else if (val === 'terminal') { setPanelMode('terminal'); setActiveFile(null) }
    else if (val === 'browser') { setPanelMode('browser'); setActiveFile(null) }
    else { const file = openFiles.find((f) => f.path === val); if (file) { setIsDiffMode(false); setActiveFile(file); setPanelMode('editor') } }
  }, [openFiles, setPanelMode, setActiveFile])

  const isMarkdown = activeFile?.name.endsWith('.md') ?? false

  return (
    <Tabs.Root value={activeTabValue} onValueChange={handleTabChange} className="artifact-pane">
      <PanelHeader panelMode={panelMode} openFiles={openFiles} hoveredTabPath={hoveredTabPath} setHoveredTabPath={setHoveredTabPath} handleCloseFile={handleCloseFile} handleClose={handleClose} />

      <div className="artifact-panel-content">
        <Tabs.Content value="overview" className="artifact-panel-tab-content">
          <OverviewPanel artifacts={artifacts} loading={loading} handleArtifactClick={handleArtifactClick} />
        </Tabs.Content>

        <Tabs.Content value="terminal" className={`artifact-panel-tab-content ${panelMode === 'terminal' ? 'tab-content-visible' : 'tab-content-hidden'}`}>
          {panelMode === 'terminal' && <TerminalView ref={terminalRef} workspacePath={activeWorkspace?.path} />}
        </Tabs.Content>

        <Tabs.Content value="browser" forceMount className={`artifact-panel-tab-content ${panelMode === 'browser' ? 'tab-content-visible' : 'tab-content-hidden'}`}>
          <BrowserView />
        </Tabs.Content>

        <Tabs.Content value="editor" forceMount className={`artifact-panel-tab-content ${panelMode === 'editor' ? 'tab-content-visible' : 'tab-content-hidden'}`}>
          {!activeFile ? (
            <EmptyState icon="📂" title="No File Open" description="Select a file from the sidebar or ask the agent to edit or create a code file." />
          ) : activeFile.isBinary ? (
            <MediaPreview displayFile={activeFile} />
          ) : isMarkdown ? (
            <MarkdownView displayFile={activeFile} activeWorkspace={activeWorkspace} />
          ) : (
            <React.Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
              <CodeEditorView displayFile={activeFile} activeWorkspace={activeWorkspace} themeLoaded={themeLoaded} isDiffMode={isDiffMode} setIsDiffMode={setIsDiffMode} originalContent={originalContent} handleDiffEditorMount={handleDiffEditorMount} handleEditorMount={handleEditorMount} handleSearchClick={handleSearchClick} />
            </React.Suspense>
          )}
        </Tabs.Content>
      </div>
    </Tabs.Root>
  )
}

export default ArtifactPanel
