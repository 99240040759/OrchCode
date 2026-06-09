import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { useAtom, useAtomValue } from 'jotai'
import { X, Globe, TerminalSquare, ListTodo, Loader } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import {
  isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom,
  activeWorkspaceAtom, activeThreadIdAtom, openFilesAtom, artifactsAtom,
  type EditorFile, type ArtifactPanelMode
} from '../store/agentStore'
import type { editor } from 'monaco-editor'
import type { ArtifactEntry, FileReadResult } from '../../preload/index.d'
import { isAgentArtifact, getArtifactIcon, getDisplayName } from '../lib/uiUtils'
import { setupMonaco } from '../lib/monacoConfig'
import type { TerminalViewHandle } from './TerminalView'
import OverviewPanel from './OverviewPanel'
import TerminalView from './TerminalView'
import BrowserView from './BrowserView'
import { MediaPreview } from './InputBar'
import { MarkdownView } from './MarkdownRenderer'
import { EmptyState } from '../lib/uiUtils'

const CodeEditorView = React.lazy(() => import('./CodeEditorView'))
import { isMac } from '../lib/sharedUtils'

interface HeaderProps {
  panelMode: string; openFiles: EditorFile[]; hoveredTabPath: string | null
  setHoveredTabPath: (p: string | null) => void; handleCloseFile: (file: EditorFile, e: React.MouseEvent) => void
}

const PanelHeader: React.FC<HeaderProps> = ({ panelMode, openFiles, hoveredTabPath, setHoveredTabPath, handleCloseFile }) => {
  const trigger = (val: string, label: string, icon: React.ReactNode) => (
    <Tabs.Trigger value={val} className="artifact-tab-trigger">{icon}<span>{label}</span></Tabs.Trigger>
  )
  return (
    <div className={`artifact-panel-header ${isMac ? 'artifact-panel-header-mac' : 'artifact-panel-header-win'}`}>
      <Tabs.List className="artifact-panel-tabs-list">
        {trigger('overview', 'Overview', <ListTodo size={14} color={panelMode === 'overview' ? 'var(--accent-purple)' : 'var(--text-secondary)'} />)}
        {trigger('terminal', 'Terminal', <TerminalSquare size={14} color={panelMode === 'terminal' ? 'var(--accent-green)' : 'var(--text-secondary)'} />)}
        {trigger('browser', 'Browser', <Globe size={14} color={panelMode === 'browser' ? 'var(--accent-blue)' : 'var(--text-secondary)'} />)}
        {openFiles.map((f) => {
          const hovered = hoveredTabPath === f.path
          const baseName = f.name.split(/[/\\]/).pop() ?? f.name
          return (
            <Tabs.Trigger key={f.path} value={f.path} className="artifact-tab-trigger" onMouseEnter={() => setHoveredTabPath(f.path)} onMouseLeave={() => setHoveredTabPath(null)}>
              <div className="tab-icon-wrapper">{hovered ? <span onClick={(e) => handleCloseFile(f, e)} className="tab-close-btn"><X size={10} /></span> : isAgentArtifact(f.name) ? getArtifactIcon(f.name) : <SymbolsFileIcon fileName={baseName} autoAssign width={16} height={16} className="flex-shrink-0" />}</div>
              <span>{getDisplayName(f.name)}</span>
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>
    </div>
  )
}

const ArtifactPanel: React.FC = () => {
  const isOpen = useAtomValue(isArtifactPanelOpenAtom)
  const [activeFile, setActiveFile] = useAtom(activeEditorFileAtom)
  const [panelMode, setPanelMode] = useAtom(artifactPanelModeAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const [openFiles, setOpenFiles] = useAtom(openFilesAtom)
  const [hoveredTabPath, setHoveredTabPath] = useState<string | null>(null)
  const [themeLoaded, setThemeLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [artifacts, setArtifacts] = useAtom(artifactsAtom)
  const convId = useAtomValue(activeThreadIdAtom)
  const [isDiffMode, setIsDiffMode] = useState(false)
  const [originalContent, setOriginalContent] = useState<string | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const terminalRef = useRef<TerminalViewHandle | null>(null)
  const browserWasOpenedRef = useRef(false)
  const convIdRef = useRef(convId)
  convIdRef.current = convId

  const handleEditorMount = useCallback((editor: editor.IStandaloneCodeEditor) => { editorRef.current = editor }, [])
  const handleDiffEditorMount = useCallback((editor: editor.IStandaloneDiffEditor) => { diffEditorRef.current = editor }, [])
  const handleSearchClick = useCallback(() => {
    const ed = isDiffMode ? diffEditorRef.current?.getModifiedEditor() : editorRef.current
    if (ed) { ed.focus(); ed.trigger('actions', 'actions.find', null) }
  }, [isDiffMode])

  useEffect(() => { setupMonaco().then(() => setThemeLoaded(true)) }, [])

  useEffect(() => {
    if (activeFile && isDiffMode) {
      setOriginalContent(null)
      window.api.invoke('file:read-original', { filePath: activeFile.path, conversationId: convId })
        .then((res) => setOriginalContent((res as { content?: string })?.content ?? ''))
        .catch(() => { setOriginalContent(null); setIsDiffMode(false) })
    } else setOriginalContent(null)
  }, [activeFile?.path, activeFile?.content, isDiffMode, convId])

  const lastArtifactsUpdateRef = useRef(0)

  useEffect(() => {
    if (!convId) return
    let active = true; setLoading(true)
    const fetchTime = Date.now()
    window.api.invoke('artifacts:list', { conversationId: convId })
      .then((data) => { if (active && fetchTime >= lastArtifactsUpdateRef.current) { setArtifacts(data as ArtifactEntry[]); setLoading(false) } })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [convId, setArtifacts])

  useEffect(() => {
    return window.api.on('artifacts:changed', (payload: unknown) => {
      const p = payload as { conversationId: string; artifacts?: ArtifactEntry[] } | undefined
      if (p?.conversationId === convIdRef.current) {
        lastArtifactsUpdateRef.current = Date.now()
        setArtifacts(p.artifacts ?? [])
      }
    })
  }, [setArtifacts])

  const handleOpenFile = useCallback((fileData: EditorFile) => {
    setActiveFile(fileData); setPanelMode('editor')
  }, [setActiveFile, setPanelMode])

  const handleArtifactClick = useCallback(async (art: ArtifactEntry) => {
    try {
      setFileLoading(true)
      const fileData = await window.api.invoke('file:read', { filePath: art.path, conversationId: convId }) as FileReadResult
      if (fileData) { setIsDiffMode(false); handleOpenFile(fileData) }
    } catch (err) { console.error(err) } finally { setFileLoading(false) }
  }, [convId, handleOpenFile])

  const handleCloseFile = useCallback((fileToClose: EditorFile, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = openFiles.filter(f => f.path !== fileToClose.path)
    setOpenFiles(next)
    if (activeFile?.path === fileToClose.path) {
      if (next.length > 0) { setActiveFile(next[next.length - 1]); setPanelMode('editor') }
      else { setActiveFile(null); setPanelMode('overview') }
    }
  }, [openFiles, activeFile, setOpenFiles, setActiveFile, setPanelMode])

  useEffect(() => {
    if (panelMode === 'browser') browserWasOpenedRef.current = true
    if (panelMode === 'terminal') requestAnimationFrame(() => terminalRef.current?.fit())
  }, [panelMode])

  useEffect(() => { setIsDiffMode(false) }, [activeFile?.path])

  useEffect(() => {
    if (!isOpen && browserWasOpenedRef.current) { window.api.invoke('browser:close').catch(() => {}); browserWasOpenedRef.current = false }
  }, [isOpen])

  useEffect(() => {
    const handleLayout = () => { try { editorRef.current?.layout(); diffEditorRef.current?.layout() } catch (err) { console.debug('[ArtifactPanel] Layout error:', err) } }
    window.addEventListener('resize', handleLayout)
    const panelEl = document.querySelector('.artifact-pane-wrapper')
    let rafId: number
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(handleLayout)
    })
    if (panelEl) obs.observe(panelEl)
    return () => { window.removeEventListener('resize', handleLayout); cancelAnimationFrame(rafId); obs.disconnect() }
  }, [])

  const handleTabChange = useCallback((val: string) => {
    if (['overview', 'terminal', 'browser'].includes(val)) { setPanelMode(val as ArtifactPanelMode); setActiveFile(null) }
    else { const file = openFiles.find(f => f.path === val); if (file) { setIsDiffMode(false); setActiveFile(file); setPanelMode('editor') } }
  }, [openFiles, setPanelMode, setActiveFile])

  const tabsValue = panelMode === 'editor' ? (activeFile?.path ?? 'overview') : panelMode

  return (
    <Tabs.Root value={tabsValue} onValueChange={handleTabChange} className="artifact-pane">
      <PanelHeader panelMode={panelMode} openFiles={openFiles} hoveredTabPath={hoveredTabPath} setHoveredTabPath={setHoveredTabPath} handleCloseFile={handleCloseFile} />
      <div className="artifact-panel-content">
        <Tabs.Content value="overview" className="artifact-panel-tab-content">
          <OverviewPanel artifacts={artifacts} loading={loading} handleArtifactClick={handleArtifactClick} />
        </Tabs.Content>
        <Tabs.Content value="terminal" forceMount className={`artifact-panel-tab-content ${panelMode === 'terminal' ? 'tab-content-visible' : 'tab-content-hidden'}`}>
          <TerminalView ref={terminalRef} workspacePath={activeWorkspace?.path} />
        </Tabs.Content>
        <Tabs.Content value="browser" forceMount className={`artifact-panel-tab-content ${panelMode === 'browser' ? 'tab-content-visible' : 'tab-content-hidden'}`}>
          <BrowserView />
        </Tabs.Content>
        <Tabs.Content value={activeFile?.path ?? ''} className="artifact-panel-tab-content">
          {fileLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '100%', color: 'var(--text-secondary)' }}>
              <Loader className="animate-spin" size={24} />
              <span>Loading file...</span>
            </div>
          ) : !activeFile ? <EmptyState icon="📂" title="No File Open" description="Select a file from the sidebar or ask the agent to edit or create a code file." /> :
            activeFile.isBinary ? <MediaPreview displayFile={activeFile} /> :
            activeFile.name.endsWith('.md') ? <MarkdownView displayFile={activeFile} activeWorkspace={activeWorkspace} /> :
            <React.Suspense fallback={<div className="editor-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}><Loader className="animate-spin mr-2" size={16} />Loading editor...</div>}>
              <CodeEditorView displayFile={activeFile} activeWorkspace={activeWorkspace} themeLoaded={themeLoaded} isDiffMode={isDiffMode} setIsDiffMode={setIsDiffMode} originalContent={originalContent} handleDiffEditorMount={handleDiffEditorMount} handleEditorMount={handleEditorMount} handleSearchClick={handleSearchClick} />
            </React.Suspense>}
        </Tabs.Content>
      </div>
    </Tabs.Root>
  )
}

export default ArtifactPanel
