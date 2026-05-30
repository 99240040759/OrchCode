import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Editor } from '@monaco-editor/react'
import {
  Edit2,
  Search,
  X,
  Globe,
  TerminalSquare,
  FileText,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  ClipboardList,
  ClipboardCheck,
  BookOpen
} from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom,
  activeWorkspaceAtom,
  globalPromptTriggerAtom,
  type ArtifactPanelMode,
  type EditorFile
} from '../store/agentStore'
import { toast } from 'sonner'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import MarkdownRenderer from './MarkdownRenderer'

const isAgentArtifact = (fileName: string) => {
  return fileName === 'implementation_plan.md' || fileName === 'task.md' || fileName === 'walkthrough.md'
}

import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewHandle {
  fit: () => void
}

const TerminalView = React.forwardRef<TerminalViewHandle, { workspacePath?: string }>(({ workspacePath }, ref) => {
  const termContainerRef = useRef<HTMLDivElement>(null)

  const fitAddonRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const unsubDataRef = useRef<(() => void) | null>(null)
  const unsubExitRef = useRef<(() => void) | null>(null)

  React.useImperativeHandle(ref, () => ({
    fit: () => {
      try { fitAddonRef.current?.fit() } catch {}
    }
  }))

  useEffect(() => {
    if (!termContainerRef.current) return
    let active = true
    let fitTimeout: NodeJS.Timeout | null = null

    const term = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#f3f3f3',
        cursor: '#f3f3f3',
        selectionBackground: 'rgba(255,255,255,0.15)',
        black: '#1e1e1e',
        brightBlack: '#3e3e3e',
        red: '#ef4444',
        brightRed: '#f87171',
        green: '#10b981',
        brightGreen: '#34d399',
        yellow: '#f59e0b',
        brightYellow: '#fbbf24',
        blue: '#3b82f6',
        brightBlue: '#60a5fa',
        magenta: '#8b5cf6',
        brightMagenta: '#a78bfa',
        cyan: '#06b6d4',
        brightCyan: '#22d3ee',
        white: '#d4d4d4',
        brightWhite: '#ffffff'
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: false,
      convertEol: true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(termContainerRef.current)

    fitTimeout = setTimeout(() => {
      if (active) {
        try { fitAddon.fit() } catch {}
      }
    }, 50)

    fitAddonRef.current = fitAddon

    const { cols, rows } = term
    window.api.createTerminal({ cols, rows, cwd: workspacePath }).then(({ id }) => {
      if (!active) {
        window.api.closeTerminal({ id }).catch(console.error)
        return
      }
      ptyIdRef.current = id

      unsubDataRef.current = window.api.onTerminalData(({ id: dataId, data }) => {
        if (dataId === id) term.write(data)
      })

      unsubExitRef.current = window.api.onTerminalExit(({ id: exitId }) => {
        if (exitId === id) {
          term.write('\r\n\x1b[2m[Process exited]\x1b[0m\r\n')
          ptyIdRef.current = null
        }
      })

      term.onData((data) => {
        if (ptyIdRef.current) window.api.terminalInput({ id: ptyIdRef.current, data })
      })
    }).catch((err) => {
      if (active) term.write(`\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`)
    })

    const resizeObs = new ResizeObserver(() => {
      if (active) {
        try { fitAddon.fit() } catch {}
        if (ptyIdRef.current) {
          window.api.terminalResize({ id: ptyIdRef.current, cols: term.cols, rows: term.rows }).catch(() => {})
        }
      }
    })
    resizeObs.observe(termContainerRef.current)

    return () => {
      active = false
      if (fitTimeout) clearTimeout(fitTimeout)
      resizeObs.disconnect()
      if (unsubDataRef.current) unsubDataRef.current()
      if (unsubExitRef.current) unsubExitRef.current()
      if (ptyIdRef.current) {
        window.api.closeTerminal({ id: ptyIdRef.current }).catch(() => {})
        ptyIdRef.current = null
      }
      term.dispose()
    }
  }, [workspacePath])

  return (
    <div
      ref={termContainerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e1e',
        padding: '16px 20px'
      }}
    />
  )
})
TerminalView.displayName = 'TerminalView'

const BrowserView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [urlInput, setUrlInput] = useState('https://google.com')
  const [displayUrl, setDisplayUrl] = useState('')
  const [title, setTitle] = useState('Browser')
  const [isLoaded, setIsLoaded] = useState(false)

  const getBounds = useCallback((): { x: number; y: number; width: number; height: number } => {
    if (!containerRef.current) return { x: 0, y: 0, width: 800, height: 600 }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(Math.round(rect.width), 100),
      height: Math.max(Math.round(rect.height), 100)
    }
  }, [])

  const navigate = useCallback((url: string) => {
    const target = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    window.api.navigateBrowser(target)
    setUrlInput(target)
  }, [])

  useEffect(() => {
    let active = true
    const rafId = requestAnimationFrame(() => {
      if (!active) return
      const bounds = getBounds()
      window.api.openBrowser({ url: urlInput, bounds })
      setIsLoaded(true)
    })

    const unsubTitle = window.api.onBrowserTitleUpdated((t) => {
      if (active) setTitle(t)
    })
    const unsubUrl = window.api.onBrowserUrlChanged((u) => {
      if (active) {
        setDisplayUrl(u)
        setUrlInput(u)
      }
    })

    const resizeObs = new ResizeObserver(() => {
      if (active) {
        window.api.resizeBrowser(getBounds()).catch(() => {})
      }
    })
    if (containerRef.current) resizeObs.observe(containerRef.current)

    return () => {
      active = false
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      unsubTitle()
      unsubUrl()
      window.api.closeBrowser().catch(() => {})
    }
  }, [getBounds])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          backgroundColor: '#161616',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className="browser-nav-btn"
            onClick={() => window.api.browserBack()}
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className="browser-nav-btn"
            onClick={() => window.api.browserForward()}
            title="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button
            className="browser-nav-btn"
            onClick={() => window.api.browserReload()}
            title="Reload"
          >
            <RotateCw size={13} />
          </button>
        </div>

        <input
          className="browser-url-bar"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(urlInput)
          }}
          spellCheck={false}
          placeholder="Enter URL or search..."
        />

        <button
          className="browser-nav-btn"
          onClick={() => navigate(urlInput)}
          title="Go"
          style={{ color: 'var(--accent-blue)' }}
        >
          <ExternalLink size={13} />
        </button>

        {title && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 180,
              marginLeft: 'auto',
              paddingLeft: 8
            }}
            title={displayUrl || urlInput}
          >
            {title}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          backgroundColor: 'transparent',
          position: 'relative'
        }}
      >
        {!isLoaded && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: 13 }}>
            Loading browser...
          </div>
        )}
      </div>
    </div>
  )
}

const ArtifactPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isArtifactPanelOpenAtom)
  const [activeFile, setActiveFile] = useAtom(activeEditorFileAtom)
  const [panelMode, setPanelMode] = useAtom(artifactPanelModeAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const setGlobalPrompt = useSetAtom(globalPromptTriggerAtom)
  const [isReadOnly, setIsReadOnly] = useState(true)
  const [editedContent, setEditedContent] = useState('')

  const terminalRef = useRef<{ fit: () => void } | null>(null)

  const displayFile = activeFile
  const isMarkdown = displayFile?.name.endsWith('.md') ?? false

  const lastFileRef = useRef<EditorFile | null>(null)
  const dirtyContentRef = useRef<string>('')
  const isReadOnlyRef = useRef<boolean>(isReadOnly)

  useEffect(() => {
    dirtyContentRef.current = editedContent
  }, [editedContent])

  useEffect(() => {
    isReadOnlyRef.current = isReadOnly
  }, [isReadOnly])

  const handleSaveDirect = async (fileToSave: EditorFile, contentToSave: string) => {
    if (!fileToSave || !fileToSave.path) return
    try {
      const success = await window.api.writeFile(fileToSave.path, contentToSave)
      if (success) {
        toast.success(`Saved ${fileToSave.name}`)
        setActiveFile({ ...fileToSave, content: contentToSave })
      } else {
        toast.error(`Failed to save ${fileToSave.name}`)
      }
    } catch (err: any) {
      toast.error(`Save error: ${err.message}`)
    }
  }

  useEffect(() => {
    const checkAndPrompt = async () => {
      const prevFile = lastFileRef.current
      const wasDirty = prevFile && !isReadOnlyRef.current && dirtyContentRef.current !== prevFile.content

      if (wasDirty && activeFile?.path !== prevFile.path) {
        setActiveFile(prevFile)

        const response = await window.api.showConfirmDialog({
          message: `Save changes to ${prevFile.name}?`,
          detail: "Your changes will be lost if you don't save them.",
          buttons: ['Save', "Don't Save", 'Cancel'],
          defaultId: 0,
          cancelId: 2
        })

        if (response === 0) {
          await handleSaveDirect(prevFile, dirtyContentRef.current)
          lastFileRef.current = activeFile
          setActiveFile(activeFile)
          setIsReadOnly(true)
          setEditedContent(activeFile?.content ?? '')
        } else if (response === 1) {
          lastFileRef.current = activeFile
          setActiveFile(activeFile)
          setIsReadOnly(true)
          setEditedContent(activeFile?.content ?? '')
        }
      } else {
        lastFileRef.current = activeFile
        setIsReadOnly(true)
        setEditedContent(activeFile?.content ?? '')
      }
    }

    checkAndPrompt()
  }, [activeFile])

  useEffect(() => {
    if (panelMode !== 'browser') {
      window.api.closeBrowser().catch(() => {})
    }
    if (panelMode === 'terminal') {
      requestAnimationFrame(() => {
        terminalRef.current?.fit()
      })
    }
  }, [panelMode])

  useEffect(() => {
    if (!isOpen) {
      window.api.closeBrowser().catch(() => {})
    }
  }, [isOpen])

  const handleSave = async (contentToSave: string) => {
    if (!displayFile) return
    await handleSaveDirect(displayFile, contentToSave)
  }

  const handleSaveRef = useRef<((val: string) => Promise<void>) | null>(null)
  useEffect(() => {
    handleSaveRef.current = handleSave
  }, [handleSave])

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const model = editor.getModel()
      if (model && handleSaveRef.current) {
        handleSaveRef.current(model.getValue())
      }
    })
  }

  const handleClose = async () => {
    const isDirty = displayFile && !isReadOnly && editedContent !== displayFile.content
    if (isDirty) {
      const response = await window.api.showConfirmDialog({
        message: `Save changes to ${displayFile.name}?`,
        detail: "Your changes will be lost if you don't save them.",
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2
      })

      if (response === 0) {
        await handleSave(editedContent)
      } else if (response === 2) {
        return
      }
    }
    setIsOpen(false)
    setPanelMode('editor')
    setActiveFile(null)
  }

  if (!isOpen) return null

  return (
    <div className="artifact-pane">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          height: '38px',
          padding: '0 16px',
          backgroundColor: '#1e1e1e',
          borderBottom: '1px solid var(--border-color)',
          marginLeft: '-1px',
          position: 'relative',
          zIndex: 2,
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[
            { mode: 'editor', icon: <FileText size={15} />, title: 'Editor' },
            { mode: 'terminal', icon: <TerminalSquare size={15} />, title: 'Terminal' },
            { mode: 'browser', icon: <Globe size={15} />, title: 'Browser' }
          ].map(({ mode, icon, title }) => (
            <button
              key={mode}
              onClick={() => setPanelMode(mode as ArtifactPanelMode)}
              title={title}
              style={{
                width: 26,
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: panelMode === mode ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: panelMode === mode 
                  ? (mode === 'browser' ? 'var(--accent-blue)' : mode === 'terminal' ? 'var(--accent-green)' : 'var(--text-primary)')
                  : '#9c9c9c',
                transition: 'all 0.15s ease'
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {panelMode === 'editor' && displayFile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '38px',
            padding: '0 16px',
            gap: '12px',
            backgroundColor: '#1e1e1e',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#161616',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              height: '28px',
              padding: '0 10px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              {isAgentArtifact(displayFile.name) ? (
                displayFile.name === 'implementation_plan.md' ? (
                  <ClipboardList size={16} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                ) : displayFile.name === 'task.md' ? (
                  <ClipboardCheck size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                ) : (
                  <BookOpen size={16} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                )
              ) : isMarkdown ? (
                <FileText size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              ) : (
                <SymbolsFileIcon
                  fileName={displayFile.name}
                  autoAssign={true}
                  width={16}
                  height={16}
                  style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
                />
              )}
              <span style={{ color: '#f3f3f3', fontWeight: 500, fontSize: '13px', whiteSpace: 'nowrap' }}>
                {displayFile.name === 'implementation_plan.md'
                  ? 'Implementation Plan'
                  : displayFile.name === 'task.md'
                  ? 'Task List'
                  : displayFile.name === 'walkthrough.md'
                  ? 'Walkthrough'
                  : displayFile.name}
              </span>
              {!isAgentArtifact(displayFile.name) && (
                <span style={{ color: '#9c9c9c', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayFile.path}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              {displayFile.name === 'implementation_plan.md' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    style={{ padding: '2px 8px', fontSize: '11px', height: '22px', border: '1px solid rgba(255,255,255,0.12)' }}
                    onClick={() => {
                      setGlobalPrompt({ prompt: 'I reject the implementation plan. Please make modifications based on my requirements.' })
                      toast.info('Rejected implementation plan. Agent notified.')
                    }}
                  >
                    Reject
                  </button>
                  <button
                    className="btn primary"
                    style={{ padding: '2px 8px', fontSize: '11px', height: '22px' }}
                    onClick={() => {
                      setGlobalPrompt({ prompt: 'I approve the implementation plan. Please proceed with execution.' })
                      toast.success('Approved plan. Proceeding with execution.')
                    }}
                  >
                    Proceed
                  </button>
                </div>
              ) : !isAgentArtifact(displayFile.name) ? (
                <>
                  {!isMarkdown && (
                    <div
                      className="panel-header-action"
                      style={{
                        padding: '2px',
                        color: !isReadOnly ? 'var(--accent-green)' : '#9c9c9c',
                        cursor: displayFile.isBinary ? 'default' : 'pointer',
                        opacity: displayFile.isBinary ? 0.4 : 1,
                        transition: 'color 0.2s ease'
                      }}
                      onClick={() => {
                        if (displayFile.isBinary) return
                        setIsReadOnly(!isReadOnly)
                        if (isReadOnly) {
                          toast.info('Edit Mode. Cmd+S to save.', { duration: 2500 })
                        }
                      }}
                      title={displayFile.isBinary ? 'Binary File' : isReadOnly ? 'Edit File' : 'Lock (Read-Only)'}
                    >
                      <Edit2 size={14} />
                    </div>
                  )}
                  <div className="panel-header-action" style={{ padding: '2px', color: '#9c9c9c' }}>
                    <Search size={14} />
                  </div>
                  <div
                    className="panel-header-action"
                    style={{ padding: '2px', color: '#9c9c9c' }}
                    onClick={handleClose}
                  >
                    <X size={14} />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {panelMode === 'terminal' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '38px',
            padding: '0 16px',
            backgroundColor: '#1e1e1e',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TerminalSquare size={14} style={{ color: 'var(--accent-green)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {activeWorkspace?.name ? `${activeWorkspace.name} — zsh` : 'Terminal'}
            </span>
          </div>
          <div className="panel-header-action" style={{ padding: '2px', color: '#9c9c9c' }} onClick={handleClose}>
            <X size={14} />
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: panelMode === 'terminal' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
          <TerminalView ref={terminalRef} workspacePath={activeWorkspace?.path} />
        </div>

        {panelMode === 'browser' && (
          <BrowserView />
        )}

        {panelMode === 'editor' && (
          !displayFile ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px', color: 'var(--text-secondary)', textAlign: 'center', backgroundColor: '#161616' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px', filter: 'grayscale(0.3) contrast(1.2)' }}>📂</div>
              <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '6px', fontFamily: 'var(--font-display)' }}>No File Open</h3>
              <p style={{ fontSize: '12.5px', maxWidth: '300px', lineHeight: 1.5, color: 'var(--text-secondary)', margin: 0 }}>Select a file from the sidebar or ask the agent to edit or create a code file.</p>
            </div>
          ) : displayFile.isBinary ? (
            <div
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', backgroundColor: '#161616', padding: '24px' }}
              className="media-preview-container"
            >
              {displayFile.mimeType?.startsWith('image/') && (
                <div className="media-image-wrapper">
                  <img
                    src={`data:${displayFile.mimeType};base64,${displayFile.base64}`}
                    alt={displayFile.name}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                  />
                </div>
              )}
              {displayFile.mimeType?.startsWith('video/') && (
                <video
                  controls
                  autoPlay
                  src={`data:${displayFile.mimeType};base64,${displayFile.base64}`}
                  style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                />
              )}
              {displayFile.mimeType?.startsWith('audio/') && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 32, borderRadius: 8, backgroundColor: '#1e1e1e', border: '1px solid var(--border-color)' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{displayFile.name}</span>
                  <audio controls autoPlay src={`data:${displayFile.mimeType};base64,${displayFile.base64}`} style={{ width: '320px' }} />
                </div>
              )}
              {!displayFile.mimeType?.startsWith('image/') && !displayFile.mimeType?.startsWith('video/') && !displayFile.mimeType?.startsWith('audio/') && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  Unsupported preview format ({displayFile.mimeType})
                </div>
              )}
            </div>
          ) : isMarkdown ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', flex: 1 }}>
              <div
                style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', backgroundColor: '#1e1e1e', color: 'var(--text-primary)', lineHeight: 1.6, fontSize: 14.5, userSelect: 'text' }}
                className="assistant-content markdown-body"
              >
                <MarkdownRenderer isArtifact={true} content={displayFile.content ?? ''} />
              </div>
            </div>
          ) : (
            <Editor
              height="100%"
              language={displayFile.language}
              theme="vs-dark"
              value={isReadOnly ? (displayFile.content ?? '') : editedContent}
              onChange={(val) => { if (!isReadOnly) setEditedContent(val || '') }}
              onMount={handleEditorDidMount}
              options={{
                minimap: { enabled: true, showSlider: 'mouseover' },
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                readOnly: isReadOnly,
                lineNumbersMinChars: 4,
                automaticLayout: true,
                cursorBlinking: 'blink',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                folding: true,
                foldingHighlight: true,
                contextmenu: true,
                suggestOnTriggerCharacters: true,
                quickSuggestions: { other: true, comments: true, strings: true },
                formatOnType: true,
                formatOnPaste: true,
                parameterHints: { enabled: true }
              }}
            />
          )
        )}
      </div>
    </div>
  )
}

export default ArtifactPanel
