import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { useAtom, useAtomValue } from 'jotai'
import {
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom,
  activeWorkspaceAtom,
  activeThreadIdAtom,
  openFilesAtom,
  artifactsAtom,
  filesChangedAtom,
  type EditorFile,
  type FileChangeEntry
} from '../store/agentStore'
import type { ArtifactEntry } from '../../../preload/index.d'
import { isAgentArtifact, getDisplayName } from '../lib/uiUtils'
import { setupMonaco } from '../lib/monacoConfig'

import type { TerminalViewHandle } from './TerminalView'
import ArtifactPanelHeader from './ArtifactPanelHeader'
import ArtifactPanelContent from './ArtifactPanelContent'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

const ArtifactPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isArtifactPanelOpenAtom)
  const [activeFile, setActiveFile] = useAtom(activeEditorFileAtom)
  const [panelMode, setPanelMode] = useAtom(artifactPanelModeAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const [openFiles, setOpenFiles] = useAtom(openFilesAtom)

  useEffect(() => {
    if (activeFile) {
      setOpenFiles((prev) => {
        if (prev.some((f) => f.path === activeFile.path)) return prev
        return [...prev, activeFile]
      })
    }
  }, [activeFile, setOpenFiles])

  const [hoveredTabPath, setHoveredTabPath] = useState<string | null>(null)
  const [themeLoaded, setThemeLoaded] = useState(false)

  const [loading, setLoading] = useState(false)
  const [artifacts, setArtifacts] = useAtom(artifactsAtom)
  const convId = useAtomValue(activeThreadIdAtom)
  const filesChanged = useAtomValue(filesChangedAtom)
  const userFiles = filesChanged.filter((fc) => !isAgentArtifact(fc.name))

  const [isDiffMode, setIsDiffMode] = useState(false)
  const [originalContent, setOriginalContent] = useState<string | null>(null)

  const editorRef = useRef<any>(null)
  const diffEditorRef = useRef<any>(null)

  const handleEditorMount = useCallback((editor: any) => {
    editorRef.current = editor
  }, [])

  const handleDiffEditorMount = useCallback((editor: any) => {
    diffEditorRef.current = editor
  }, [])

  const handleSearchClick = () => {
    if (isDiffMode) {
      const modifiedEditor = diffEditorRef.current?.getModifiedEditor()
      modifiedEditor?.focus()
      modifiedEditor?.trigger('actions', 'actions.find', null)
    } else {
      editorRef.current?.focus()
      editorRef.current?.trigger('actions', 'actions.find', null)
    }
  }

  const terminalRef = useRef<TerminalViewHandle | null>(null)

  const browserWasOpenedRef = useRef(false)

  const displayFile = activeFile

  useEffect(() => {
    setupMonaco().then(() => {
      setThemeLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (activeFile && isDiffMode) {
      setOriginalContent(null)
      window.api
        .readOriginalFile(activeFile.path, convId)
        .then((res) => {
          setOriginalContent(res?.content ?? '')
        })
        .catch((err) => {
          console.error('[ArtifactPanel] Failed to read original file:', err)
          setOriginalContent('')
        })
    } else {
      setOriginalContent(null)
    }
  }, [activeFile?.path, isDiffMode, convId])

  useEffect(() => {
    if (!convId) return
    let active = true
    setLoading(true)
    window.api
      .listArtifacts(convId)
      .then((data) => {
        if (active) {
          setArtifacts(data ?? [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [convId, setArtifacts])

  useEffect(() => {
    const unsub = window.api.onArtifactsChanged(({ conversationId, artifacts }) => {
      if (conversationId === convId) {
        setArtifacts(artifacts ?? [])
      }
    })
    return unsub
  }, [convId, setArtifacts])

  const handleOpenFile = useCallback(
    (fileData: EditorFile) => {
      setOpenFiles((prev) => {
        const exists = prev.find((f) => f.path === fileData.path)
        if (!exists) return [...prev, fileData]
        return prev
      })
      setActiveFile(fileData)
      setPanelMode('editor')
    },
    [setOpenFiles, setActiveFile, setPanelMode]
  )

  const handleArtifactClick = useCallback(
    async (artifact: ArtifactEntry) => {
      try {
        const fileData = await window.api.readFile(artifact.path, convId)
        if (fileData) {
          setIsDiffMode(false)
          handleOpenFile(fileData)
        }
      } catch (err) {
        console.error('[ArtifactPanel] Failed to open artifact:', err)
      }
    },
    [convId, handleOpenFile]
  )

  const handleFileChangeClick = useCallback(
    async (fc: FileChangeEntry) => {
      try {
        const fileData = await window.api.readFile(fc.path, convId)
        if (fileData) {
          setIsDiffMode(true)
          handleOpenFile(fileData)
        }
      } catch (err) {
        console.error('[ArtifactPanel] Failed to open changed file:', err)
      }
    },
    [convId, handleOpenFile]
  )

  const handleCloseFile = useCallback(
    (fileToClose: EditorFile, e: React.MouseEvent) => {
      e.stopPropagation()
      const updatedFiles = openFiles.filter((f) => f.path !== fileToClose.path)
      setOpenFiles(updatedFiles)

      if (activeFile?.path === fileToClose.path) {
        if (updatedFiles.length > 0) {
          const nextFile = updatedFiles[updatedFiles.length - 1]
          setActiveFile(nextFile)
          setPanelMode('editor')
        } else {
          setActiveFile(null)
          setPanelMode('overview')
        }
      }
    },
    [openFiles, activeFile, setOpenFiles, setActiveFile, setPanelMode]
  )

  useEffect(() => {
    if (panelMode === 'browser') {
      browserWasOpenedRef.current = true
    }
    if (panelMode === 'terminal') {
      requestAnimationFrame(() => {
        terminalRef.current?.fit()
      })
    }
  }, [panelMode])

  useEffect(() => {
    if (!isOpen && browserWasOpenedRef.current) {
      window.api.closeBrowser().catch(() => {})
      browserWasOpenedRef.current = false
    }
  }, [isOpen])

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [setIsOpen])

  if (!isOpen) return null

  const activeTabValue = panelMode === 'editor' ? (activeFile?.path ?? '') : panelMode

  const handleTabChange = useCallback(
    (val: string) => {
      if (val === 'overview') {
        setPanelMode('overview')
        setActiveFile(null)
      } else if (val === 'terminal') {
        setPanelMode('terminal')
        setActiveFile(null)
      } else if (val === 'browser') {
        setPanelMode('browser')
        setActiveFile(null)
      } else {
        const file = openFiles.find((f) => f.path === val)
        if (file) {
          setIsDiffMode(false)
          setActiveFile(file)
          setPanelMode('editor')
        }
      }
    },
    [openFiles, setPanelMode, setActiveFile]
  )

  return (
    <Tabs.Root
      value={activeTabValue}
      onValueChange={handleTabChange}
      className="artifact-pane"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        borderLeft: 'none'
      }}
    >
      <ArtifactPanelHeader
        panelMode={panelMode}
        openFiles={openFiles}
        hoveredTabPath={hoveredTabPath}
        setHoveredTabPath={setHoveredTabPath}
        handleCloseFile={handleCloseFile}
        handleClose={handleClose}
        isMac={isMac}
        isAgentArtifact={isAgentArtifact}
        getDisplayName={getDisplayName}
      />
      <ArtifactPanelContent
        panelMode={panelMode}
        displayFile={displayFile}
        artifacts={artifacts}
        userFiles={userFiles}
        loading={loading}
        handleArtifactClick={handleArtifactClick}
        handleFileChangeClick={handleFileChangeClick}
        terminalRef={terminalRef}
        activeWorkspace={activeWorkspace}
        themeLoaded={themeLoaded}
        isDiffMode={isDiffMode}
        setIsDiffMode={setIsDiffMode}
        originalContent={originalContent}
        handleDiffEditorMount={handleDiffEditorMount}
        handleEditorMount={handleEditorMount}
        handleSearchClick={handleSearchClick}
        isAgentArtifact={isAgentArtifact}
        getDisplayName={getDisplayName}
      />
    </Tabs.Root>
  )
}

export default ArtifactPanel
