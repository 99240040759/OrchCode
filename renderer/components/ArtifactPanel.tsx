import React, { useState, useEffect, useRef } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { X, Globe, TerminalSquare, ListTodo, Loader } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import {
  isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom,
  activeWorkspaceAtom, activeThreadIdAtom, openFilesAtom, artifactsAtom,
  updateThreadArtifactsAtom, isDiffModeAtom,
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
import { OfficePreview } from './OfficePreview'
const CodeEditorView = React.lazy(() => import('./CodeEditorView'))
interface HeaderProps {
  panelMode: string; openFiles: EditorFile[]; hoveredTabPath: string | null
  setHoveredTabPath: (p: string | null) => void; handleCloseFile: (file: EditorFile, e: React.MouseEvent) => void
}
const PanelHeader: React.FC<HeaderProps> = ({ openFiles, hoveredTabPath, setHoveredTabPath, handleCloseFile }) => {
  const trigger = (val: string, label: string, icon: React.ReactNode) => (
    <Tabs.Trigger value={val} className="artifact-tab-trigger">{icon}<span>{label}</span></Tabs.Trigger>
  )
  return (
    <div className="artifact-panel-header">
      <Tabs.List className="artifact-panel-tabs-list">
        {trigger('overview', 'Overview', <ListTodo size={14} />)}
        {trigger('terminal', 'Terminal', <TerminalSquare size={14} />)}
        {trigger('browser', 'Browser', <Globe size={14} />)}
        {openFiles.map((f) => {
          const hovered = hoveredTabPath === f.path
          const baseName = f.name.split(/[/\\]/).pop() ?? f.name
          return (
            <Tabs.Trigger key={f.path} value={f.path} className="artifact-tab-trigger" onMouseEnter={() => setHoveredTabPath(f.path)} onMouseLeave={() => setHoveredTabPath(null)}>
              <div className="tab-icon-wrapper">
                {hovered ? (
                  <span onClick={(e) => handleCloseFile(f, e)} className="tab-close-btn"><X size={10} /></span>
                ) : (
                  isAgentArtifact(f.name) ? getArtifactIcon(f.name) : <SymbolsFileIcon fileName={baseName} autoAssign width={16} height={16} className="flex-shrink-0" />
                )}
              </div>
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
  const [isDiffMode, setIsDiffMode] = useAtom(isDiffModeAtom)
  const [originalContent, setOriginalContent] = useState<string | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const terminalRef = useRef<TerminalViewHandle | null>(null)
  const browserWasOpenedRef = useRef(false)
  const convIdRef = useRef(convId)
  convIdRef.current = convId
  const [lastActiveFile, setLastActiveFile] = useState<EditorFile | null>(null)
  useEffect(() => { if (activeFile) setLastActiveFile(activeFile) }, [activeFile])

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor) => { editorRef.current = editor }
  const handleDiffEditorMount = (editor: editor.IStandaloneDiffEditor) => { diffEditorRef.current = editor }
  const handleSearchClick = () => {
    const ed = isDiffMode ? diffEditorRef.current?.getModifiedEditor() : editorRef.current
    if (ed) { ed.focus(); ed.trigger('actions', 'actions.find', null) }
  }

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

  const updateThreadArtifacts = useSetAtom(updateThreadArtifactsAtom)

  useEffect(() => {
    return window.api.on('artifacts:changed', (payload: unknown) => {
      const p = payload as { conversationId: string; artifacts?: ArtifactEntry[] } | undefined
      if (p?.conversationId) {
        if (p.conversationId === convIdRef.current) lastArtifactsUpdateRef.current = Date.now()
        updateThreadArtifacts({ threadId: p.conversationId, artifacts: p.artifacts ?? [] })
      }
    })
  }, [updateThreadArtifacts])

  const handleOpenFile = (fileData: EditorFile) => {
    setActiveFile(fileData); setPanelMode('editor')
  }

  const handleArtifactClick = async (art: ArtifactEntry) => {
    try {
      setFileLoading(true)
      const fileData = await window.api.invoke('file:read', { filePath: art.path, conversationId: convId }) as FileReadResult
      if (fileData) { setIsDiffMode(false); handleOpenFile(fileData) }
    } catch (err) { console.error(err) } finally { setFileLoading(false) }
  }

  const handleCloseFile = (fileToClose: EditorFile, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = openFiles.filter(f => f.path !== fileToClose.path)
    setOpenFiles(next)
    if (activeFile?.path === fileToClose.path) {
      if (next.length > 0) { setActiveFile(next[next.length - 1]); setPanelMode('editor') }
      else { setActiveFile(null); setPanelMode('overview') }
    }
  }

  useEffect(() => {
    if (panelMode === 'browser') browserWasOpenedRef.current = true
    if (panelMode === 'terminal') requestAnimationFrame(() => terminalRef.current?.fit())
  }, [panelMode])

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

  const handleTabChange = (val: string) => {
    if (['overview', 'terminal', 'browser'].includes(val)) { setPanelMode(val as ArtifactPanelMode); setActiveFile(null) }
    else { const file = openFiles.find(f => f.path === val); if (file) { setIsDiffMode(false); setActiveFile(file); setPanelMode('editor') } }
  }
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
        <div className={`artifact-panel-tab-content ${panelMode === 'editor' ? 'tab-content-visible' : 'tab-content-hidden'}`}>
          {fileLoading && (
            <div className="editor-panel-loading-overlay">
              <Loader className="animate-spin" size={24} />
              <span>Loading file...</span>
            </div>
          )}
          <div className={`editor-panel-empty-state-wrapper ${(!fileLoading && !activeFile) ? '' : 'tab-content-hidden'}`}>
            <EmptyState icon="📂" title="No File Open" description="Select a file from the sidebar or ask the agent to edit or create a code file." />
          </div>
          <div className={`editor-panel-active-file-wrapper ${(!fileLoading && activeFile && lastActiveFile) ? '' : 'tab-content-hidden'}`}>
            {lastActiveFile && (
              (/\.(docx|xlsx|pptx|pdf)$/i).test(lastActiveFile.name) ? <OfficePreview displayFile={lastActiveFile} /> :
              lastActiveFile.isBinary ? <MediaPreview displayFile={lastActiveFile} /> :
              lastActiveFile.name.endsWith('.md') ? <MarkdownView displayFile={lastActiveFile} activeWorkspace={activeWorkspace} /> :
              <React.Suspense fallback={<div className="editor-loading"><Loader className="animate-spin mr-2" size={16} />Loading editor...</div>}>
                <CodeEditorView displayFile={lastActiveFile} activeWorkspace={activeWorkspace} themeLoaded={themeLoaded} isDiffMode={isDiffMode} setIsDiffMode={setIsDiffMode} originalContent={originalContent} handleDiffEditorMount={handleDiffEditorMount} handleEditorMount={handleEditorMount} handleSearchClick={handleSearchClick} />
              </React.Suspense>
            )}
          </div>
        </div>
      </div>
    </Tabs.Root>
  )
}

export default ArtifactPanel
