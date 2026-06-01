import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { debounce } from 'lodash-es'
import {
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
  BookOpen,
  ListTodo,
  PanelRightClose,
  Info,
  Package,
  FileCode,
  FileDiff,
  Copy
} from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom,
  activeWorkspaceAtom,
  globalPromptTriggerAtom,
  conversationIdAtom,
  openFilesAtom,
  artifactsAtom,
  filesChangedAtom,
  type EditorFile,
  type FileChangeEntry
} from '../store/agentStore'
import { toast } from 'sonner'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import MarkdownRenderer from './MarkdownRenderer'
import { FileIcon } from './ToolCallBlock'
import type { ArtifactEntry } from '../../../preload/index.d'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import { isAgentArtifact, getDisplayName } from '../lib/uiUtils'

const getArtifactIcon = (name: string) => {
  if (name === 'implementation_plan.md') {
    return <ClipboardList size={15} style={{ flexShrink: 0, color: 'var(--accent-purple)' }} />
  }
  if (name === 'walkthrough.md') {
    return <BookOpen size={15} style={{ flexShrink: 0, color: 'var(--accent-green)' }} />
  }
  return <FileText size={15} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
}

const getRelativeDirPath = (filePath: string, workspacePath?: string) => {
  let path = filePath
  if (workspacePath && path.startsWith(workspacePath)) {
    path = path.slice(workspacePath.length)
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    path = path.slice(1)
  }
  const parts = path.split(/[/\\]/)
  if (parts.length > 1) {
    return parts.slice(0, -1).join('/')
  }
  return ''
}

import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewHandle {
  fit: () => void
}

const TerminalView = React.forwardRef<TerminalViewHandle, { workspacePath?: string }>(({ workspacePath }, ref) => {
  const conversationId = useAtomValue(conversationIdAtom)
  const termContainerRef = useRef<HTMLDivElement>(null)

  const fitAddonRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const unsubDataRef = useRef<(() => void) | null>(null)
  const unsubExitRef = useRef<(() => void) | null>(null)

  React.useImperativeHandle(ref, () => ({
    fit: () => {
      try {
        if (termContainerRef.current && termContainerRef.current.clientWidth > 0) {
          fitAddonRef.current?.fit()
        }
      } catch {}
    }
  }))

  useEffect(() => {
    if (!termContainerRef.current) return
    let active = true
    let fitTimeout: NodeJS.Timeout | null = null

    const rootStyle = getComputedStyle(document.documentElement)
    const bgEditor = rootStyle.getPropertyValue('--bg-editor').trim()
    const textPrimary = rootStyle.getPropertyValue('--text-primary').trim()
    const textMuted = rootStyle.getPropertyValue('--text-muted').trim()
    const accentBlue = rootStyle.getPropertyValue('--accent-blue').trim()
    const accentGreen = rootStyle.getPropertyValue('--accent-green').trim()
    const accentOrange = rootStyle.getPropertyValue('--accent-orange').trim()
    const accentPurple = rootStyle.getPropertyValue('--accent-purple').trim()
    const accentRed = rootStyle.getPropertyValue('--accent-red').trim()

    const term = new XTerm({
      theme: {
        background: bgEditor,
        foreground: textPrimary,
        cursor: textPrimary,
        selectionBackground: 'rgba(255, 255, 255, 0.1)',
        black: '#1c1c1c',
        brightBlack: textMuted,
        red: accentRed,
        brightRed: accentRed,
        green: accentGreen,
        brightGreen: accentGreen,
        yellow: accentOrange,
        brightYellow: accentOrange,
        blue: accentBlue,
        brightBlue: accentBlue,
        magenta: accentPurple,
        brightMagenta: accentPurple,
        cyan: '#06b6d4',
        brightCyan: '#22d3ee',
        white: textPrimary,
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
    window.api.createTerminal({ cols, rows, cwd: workspacePath, conversationId }).then(({ id }) => {
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

    const debouncedResize = debounce(() => {
      if (active && termContainerRef.current && termContainerRef.current.clientWidth > 0) {
        try { fitAddon.fit() } catch {}
        if (ptyIdRef.current) {
          window.api.terminalResize({ id: ptyIdRef.current, cols: term.cols, rows: term.rows }).catch(() => {})
        }
      }
    }, 100)

    const resizeObs = new ResizeObserver(() => {
      debouncedResize()
    })
    resizeObs.observe(termContainerRef.current)

    return () => {
      active = false
      if (fitTimeout) clearTimeout(fitTimeout)
      debouncedResize.cancel()
      resizeObs.disconnect()
      if (unsubDataRef.current) unsubDataRef.current()
      if (unsubExitRef.current) unsubExitRef.current()
      if (ptyIdRef.current) {
        window.api.closeTerminal({ id: ptyIdRef.current }).catch(() => {})
        ptyIdRef.current = null
      }
      term.dispose()
    }
  }, [workspacePath, conversationId])

  return (
    <div
      ref={termContainerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-sidebar)',
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
  const isLoadedRef = useRef(false)
  const panelMode = useAtomValue(artifactPanelModeAtom)
  const isOpen = useAtomValue(isArtifactPanelOpenAtom)

  const panelModeRef = useRef(panelMode)
  const isOpenRef = useRef(isOpen)

  useEffect(() => {
    panelModeRef.current = panelMode
  }, [panelMode])

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const getBounds = useCallback((): { x: number; y: number; width: number; height: number } => {
    if (!containerRef.current || panelModeRef.current !== 'browser' || !isOpenRef.current) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
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
      window.api.openBrowser({ url: urlInput, bounds }).then(() => {
        if (active) {
          setIsLoaded(true)
          isLoadedRef.current = true
        }
      }).catch(console.error)
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
      if (active && isLoadedRef.current) {
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
      setIsLoaded(false)
      isLoadedRef.current = false
    }
  }, [getBounds])

  useEffect(() => {
    if (isLoadedRef.current) {
      const bounds = getBounds()
      window.api.resizeBrowser(bounds).catch(() => {})
    }
  }, [panelMode, isOpen, getBounds])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          backgroundColor: 'var(--bg-sidebar)',
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
              fontSize: 'var(--font-size-xxs)',
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Loading browser...
          </div>
        )}
      </div>
    </div>
  )
}

const OverviewPanel: React.FC<{
  activeConvId: string
  artifacts: ArtifactEntry[]
  userFiles: FileChangeEntry[]
  loading: boolean
  handleArtifactClick: (art: ArtifactEntry) => void
  handleFileChangeClick: (fc: FileChangeEntry) => void
}> = ({
  artifacts,
  userFiles,
  loading,
  handleArtifactClick,
  handleFileChangeClick
}) => {
  return (
    <ScrollArea.Root className="ScrollAreaRoot">
      <ScrollArea.Viewport className="ScrollAreaViewport">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            padding: '24px 32px',
            backgroundColor: 'var(--bg-sidebar)',
            minHeight: '100%'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Info size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-display)' }}>Session Overview</h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '24px',
              alignItems: 'start'
            }}
          >
            {/* Artifacts Card */}
            <div
              style={{
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                gap: '12px',
                minHeight: '260px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  paddingBottom: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Package size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>Artifacts</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
                {loading ? (
                  <Skeleton count={3} height={28} baseColor="#262626" highlightColor="#333333" style={{ marginBottom: 6, borderRadius: 4 }} />
                ) : artifacts.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', padding: '8px 4px' }}>
                    No artifacts created yet.
                  </div>
                ) : (
                  artifacts.map((art) => (
                    <div
                      key={art.name}
                      onClick={() => handleArtifactClick(art)}
                      className="overview-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-primary)',
                        transition: 'background-color 0.15s ease'
                      }}
                    >
                      {getArtifactIcon(art.name)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getDisplayName(art.name)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Files Changed Card */}
            <div
              style={{
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                gap: '12px',
                minHeight: '260px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  paddingBottom: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileCode size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>Files Changed</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
                {userFiles.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', padding: '8px 4px' }}>
                    No workspace files modified.
                  </div>
                ) : (
                  userFiles.map((fc) => (
                    <div
                      key={fc.path}
                      onClick={() => handleFileChangeClick(fc)}
                      className="overview-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-primary)',
                        transition: 'background-color 0.15s ease'
                      }}
                    >
                      <FileIcon fileName={fc.name} size={13} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{fc.name}</span>
                      {fc.lineRange && (
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', flexShrink: 0, marginRight: '4px' }}>
                          {fc.lineRange}
                        </span>
                      )}
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {fc.additions > 0 && (
                          <span style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', fontWeight: 700 }}>
                            +{fc.additions}
                          </span>
                        )}
                        {fc.deletions > 0 && (
                          <span style={{ color: 'var(--accent-red)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', fontWeight: 700 }}>
                            -{fc.deletions}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="ScrollAreaScrollbar" orientation="vertical">
        <ScrollArea.Thumb className="ScrollAreaThumb" />
      </ScrollArea.Scrollbar>
      <ScrollArea.Corner className="ScrollAreaCorner" />
    </ScrollArea.Root>
  )
}



let monacoInitialized = false

const ArtifactPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isArtifactPanelOpenAtom)
  const [activeFile, setActiveFile] = useAtom(activeEditorFileAtom)
  const [panelMode, setPanelMode] = useAtom(artifactPanelModeAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const setGlobalPrompt = useSetAtom(globalPromptTriggerAtom)
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

  // Overview-related states and effects
  const [loading, setLoading] = useState(false)
  const [artifacts, setArtifacts] = useAtom(artifactsAtom)
  const convId = useAtomValue(conversationIdAtom)
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

  const terminalRef = useRef<{ fit: () => void } | null>(null)
  // #17 fix: only call closeBrowser when it was actually opened — track with ref
  const browserWasOpenedRef = useRef(false)

  const displayFile = activeFile
  const isMarkdown = displayFile?.name.endsWith('.md') ?? false

  useEffect(() => {
    if (monacoInitialized) {
      setThemeLoaded(true)
      return
    }

    const rootStyle = getComputedStyle(document.documentElement)
    const textPrimary = rootStyle.getPropertyValue('--text-primary').trim() || '#f3f3f3'
    const accentBlue = (rootStyle.getPropertyValue('--accent-blue').trim() || '#3b82f6').replace('#', '')
    const accentGreen = (rootStyle.getPropertyValue('--accent-green').trim() || '#10b981').replace('#', '')
    const accentOrange = (rootStyle.getPropertyValue('--accent-orange').trim() || '#f59e0b').replace('#', '')
    const accentPurple = (rootStyle.getPropertyValue('--accent-purple').trim() || '#8b5cf6').replace('#', '')
    const accentRed = (rootStyle.getPropertyValue('--accent-red').trim() || '#ef4444').replace('#', '')
    const textSecondary = (rootStyle.getPropertyValue('--text-secondary').trim() || '#a1a1aa').replace('#', '')
    const textMuted = (rootStyle.getPropertyValue('--text-muted').trim() || '#71717a').replace('#', '')

    import('@monaco-editor/react').then(({ loader }) => {
      loader.init().then((monaco) => {
        // Disable validation/diagnostics for all built-in languages to avoid red squiggly lines
        if (monaco.languages.typescript) {
          try {
            // Set compiler options to natively support JSX (Preserve = 1) and disable diagnostics
            const compilerOptions = {
              jsx: 1, // JsxEmit.Preserve
              allowNonTsExtensions: true,
              target: 99, // ScriptTarget.Latest
              allowJs: true,
              checkJs: false
            };
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
            monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);

            monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
              noSemanticValidation: true,
              noSyntaxValidation: true
            });
            monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
              noSemanticValidation: true,
              noSyntaxValidation: true
            });
          } catch (e) {
            console.warn('[Monaco] TS/JS diagnostics or compiler options configuration failed:', e);
          }
        }
        if (monaco.languages.json) {
          try {
            if (typeof monaco.languages.json.jsonDefaults?.setDiagnosticsOptions === 'function') {
              monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false })
            } else if (typeof monaco.languages.json.jsonDefaults?.setOptions === 'function') {
              monaco.languages.json.jsonDefaults.setOptions({ validate: false })
            }
          } catch (e) {
            console.warn('[Monaco] JSON diagnostics configuration failed:', e)
          }
        }
        if (monaco.languages.html) {
          try {
            if (typeof monaco.languages.html.htmlDefaults?.setDiagnosticsOptions === 'function') {
              monaco.languages.html.htmlDefaults.setDiagnosticsOptions({ validate: false })
            } else if (typeof monaco.languages.html.htmlDefaults?.setOptions === 'function') {
              monaco.languages.html.htmlDefaults.setOptions({ validate: false })
            }
          } catch (e) {
            console.warn('[Monaco] HTML diagnostics configuration failed:', e)
          }
        }
        if (monaco.languages.css) {
          try {
            if (typeof monaco.languages.css.cssDefaults?.setDiagnosticsOptions === 'function') {
              monaco.languages.css.cssDefaults.setDiagnosticsOptions({ validate: false })
            } else if (typeof monaco.languages.css.cssDefaults?.setOptions === 'function') {
              monaco.languages.css.cssDefaults.setOptions({ validate: false })
            }
          } catch (e) {
            console.warn('[Monaco] CSS diagnostics configuration failed:', e)
          }
        }

        monaco.editor.defineTheme('orch-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'keyword', foreground: accentPurple }, // import, from, const, export, function, etc.
            { token: 'keyword.js', foreground: accentPurple },
            { token: 'keyword.ts', foreground: accentPurple },
            { token: 'keyword.tsx', foreground: accentPurple },
            { token: 'string', foreground: accentGreen }, // strings
            { token: 'string.js', foreground: accentGreen },
            { token: 'string.ts', foreground: accentGreen },
            { token: 'string.tsx', foreground: accentGreen },
            { token: 'comment', foreground: textMuted, fontStyle: 'italic' }, // comments
            { token: 'number', foreground: accentOrange }, // numbers
            { token: 'regexp', foreground: accentRed },
            { token: 'type', foreground: accentOrange },
            { token: 'class', foreground: accentOrange },
            { token: 'function', foreground: accentBlue }, // functions
            { token: 'function.js', foreground: accentBlue },
            { token: 'function.ts', foreground: accentBlue },
            { token: 'function.tsx', foreground: accentBlue },
            { token: 'variable', foreground: textSecondary },
            { token: 'variable.predefined', foreground: accentRed },
            { token: 'identifier', foreground: textSecondary }
          ],
          colors: {
            'editor.background': '#0f0f11',
            'editor.foreground': textPrimary,
            'editorLineNumber.foreground': '#4b5263',
            'editorLineNumber.activeForeground': '#c8ccd4',
            'editor.lineHighlightBackground': '#ffffff08',
            'editor.selectionBackground': '#ffffff1a',
            'editor.inactiveSelectionBackground': '#ffffff0d',
            'editorWidget.background': '#0f0f11',
            'editorWidget.border': '#ffffff0f',
            'editorHoverWidget.background': '#0f0f11',
            'editorHoverWidget.border': '#ffffff0f',
            'scrollbarSlider.background': '#ffffff0f',
            'scrollbarSlider.hoverBackground': '#ffffff1a',
            'scrollbarSlider.activeBackground': '#ffffff26',
            // Hide overview ruler border and decorations (errors, warnings)
            'editorOverviewRuler.border': '#00000000',
            'editorOverviewRuler.background': '#0f0f11',
            'editorOverviewRuler.addedForeground': '#00000000',
            'editorOverviewRuler.modifiedForeground': '#00000000',
            'editorOverviewRuler.deletedForeground': '#00000000',
            'editorOverviewRuler.errorForeground': '#00000000',
            'editorOverviewRuler.warningForeground': '#00000000',
            'editorOverviewRuler.infoForeground': '#00000000',
            // Hide all inline validation squigglies and error line overlays
            'editorError.foreground': '#00000000',
            'editorError.background': '#00000000',
            'editorError.border': '#00000000',
            'editorWarning.foreground': '#00000000',
            'editorWarning.background': '#00000000',
            'editorWarning.border': '#00000000',
            'editorInfo.foreground': '#00000000',
            'editorInfo.background': '#00000000',
            'editorInfo.border': '#00000000'
          }
        })
        monacoInitialized = true
        setThemeLoaded(true)
      })
    })
  }, [])

  useEffect(() => {
    if (activeFile && isDiffMode) {
      window.api.readOriginalFile(activeFile.path, convId)
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
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [convId, setArtifacts])

  useEffect(() => {
    const unsub = window.api.onArtifactsChanged((data) => {
      setArtifacts(data ?? [])
    })
    return unsub
  }, [setArtifacts])

  const handleOpenFile = useCallback((fileData: EditorFile) => {
    setOpenFiles((prev) => {
      const exists = prev.find((f) => f.path === fileData.path)
      if (!exists) return [...prev, fileData]
      return prev
    })
    setActiveFile(fileData)
    setPanelMode('editor')
  }, [setOpenFiles, setActiveFile, setPanelMode])

  const handleArtifactClick = useCallback(async (artifact: ArtifactEntry) => {
    try {
      const fileData = await window.api.readFile(artifact.path, convId)
      if (fileData) {
        setIsDiffMode(false)
        handleOpenFile(fileData)
      }
    } catch (err) {
      console.error('[ArtifactPanel] Failed to open artifact:', err)
    }
  }, [convId, handleOpenFile])

  const handleFileChangeClick = useCallback(async (fc: FileChangeEntry) => {
    try {
      const fileData = await window.api.readFile(fc.path, convId)
      if (fileData) {
        setIsDiffMode(true)
        handleOpenFile(fileData)
      }
    } catch (err) {
      console.error('[ArtifactPanel] Failed to open changed file:', err)
    }
  }, [convId, handleOpenFile])

  const handleCloseFile = useCallback((fileToClose: EditorFile, e: React.MouseEvent) => {
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
  }, [openFiles, activeFile, setOpenFiles, setActiveFile, setPanelMode])


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
    // Only close the browser if it was actually opened (mode was set to browser)
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

  const handleTabChange = useCallback((val: string) => {
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
  }, [openFiles, setPanelMode, setActiveFile])

  return (
    <Tabs.Root
      value={activeTabValue}
      onValueChange={handleTabChange}
      className="artifact-pane"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', borderLeft: 'none' }}
    >
      {/* Custom Tabs Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '38px',
          backgroundColor: 'var(--bg-sidebar)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
          paddingRight: '12px',
          overflowX: 'auto',
          scrollbarWidth: 'none'
        }}
      >
        <Tabs.List style={{ display: 'flex', alignItems: 'center', height: '100%', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {/* Overview Tab */}
          <Tabs.Trigger
            value="overview"
            className="tab-trigger"
          >
            <ListTodo size={14} style={{ color: panelMode === 'overview' ? 'var(--accent-purple)' : 'var(--text-secondary)' }} />
            <span>Overview</span>
          </Tabs.Trigger>

          {/* Terminal Tab */}
          <Tabs.Trigger
            value="terminal"
            className="tab-trigger"
          >
            <TerminalSquare size={14} style={{ color: panelMode === 'terminal' ? 'var(--accent-green)' : 'var(--text-secondary)' }} />
            <span>Terminal</span>
          </Tabs.Trigger>

          {/* Browser Tab */}
          <Tabs.Trigger
            value="browser"
            className="tab-trigger"
          >
            <Globe size={14} style={{ color: panelMode === 'browser' ? 'var(--accent-blue)' : 'var(--text-secondary)' }} />
            <span>Browser</span>
          </Tabs.Trigger>

          {/* Open Files Tabs */}
          {openFiles.map((file) => {
            const isHovered = hoveredTabPath === file.path
            const isCloseVisible = isHovered
            return (
              <Tabs.Trigger
                key={file.path}
                value={file.path}
                className="tab-trigger"
                onMouseEnter={() => setHoveredTabPath(file.path)}
                onMouseLeave={() => setHoveredTabPath(null)}
              >
                {/* Left side icon space */}
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    position: 'relative'
                  }}
                >
                  {isCloseVisible ? (
                    <span
                      onClick={(e) => handleCloseFile(file, e)}
                      className="tab-close-btn"
                    >
                      <X size={10} />
                    </span>
                  ) : (
                    isAgentArtifact(file.name) ? (
                      getArtifactIcon(file.name)
                    ) : (
                      <SymbolsFileIcon
                        fileName={file.name}
                        autoAssign={true}
                        width={16}
                        height={16}
                        style={{ flexShrink: 0 }}
                      />
                    )
                  )}
                </div>

                <span>
                  {getDisplayName(file.name)}
                </span>
              </Tabs.Trigger>
            )
          })}
        </Tabs.List>

        {/* Right side: Collapse Button */}
        <div
          onClick={handleClose}
          title="Collapse Panel"
          className="artifact-panel-close-btn"
        >
          <PanelRightClose size={16} strokeWidth={1.5} color="var(--text-secondary)" />
        </div>
      </div>

      {/* Panels Viewport */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        {/* Overview Tab Content */}
        <Tabs.Content value="overview" style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
          <OverviewPanel
            activeConvId={convId}
            artifacts={artifacts}
            userFiles={userFiles}
            loading={loading}
            handleArtifactClick={handleArtifactClick}
            handleFileChangeClick={handleFileChangeClick}
          />
        </Tabs.Content>

        {/* Terminal Tab Content */}
        <Tabs.Content value="terminal" style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
          <TerminalView ref={terminalRef} workspacePath={activeWorkspace?.path} />
        </Tabs.Content>

        {/* Browser Tab Content */}
        {panelMode === 'browser' && (
          <Tabs.Content value="browser" style={{ height: '100%', width: '100%' }}>
            <BrowserView />
          </Tabs.Content>
        )}

        {/* Editor Tab Content */}
        <div style={{ display: panelMode === 'editor' ? 'block' : 'none', height: '100%', width: '100%' }}>
          {!displayFile ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px', color: 'var(--text-secondary)', textAlign: 'center', backgroundColor: 'var(--bg-app)' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px', filter: 'grayscale(0.3) contrast(1.2)' }}>📂</div>
              <h3 style={{ fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '6px', fontFamily: 'var(--font-display)' }}>No File Open</h3>
              <p style={{ fontSize: 'var(--font-size-xs-plus)', maxWidth: '300px', lineHeight: 1.5, color: 'var(--text-secondary)', margin: 0 }}>Select a file from the sidebar or ask the agent to edit or create a code file.</p>
            </div>
          ) : displayFile.isBinary ? (
            <div
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', backgroundColor: 'var(--bg-app)', padding: '24px' }}
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 32, borderRadius: 8, backgroundColor: 'var(--bg-sidebar)', border: '1px solid var(--border-color)' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-mono)' }}>{displayFile.name}</span>
                  <audio controls autoPlay src={`data:${displayFile.mimeType};base64,${displayFile.base64}`} style={{ width: '320px' }} />
                </div>
              )}
              {!displayFile.mimeType?.startsWith('image/') && !displayFile.mimeType?.startsWith('video/') && !displayFile.mimeType?.startsWith('audio/') && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  Unsupported preview format ({displayFile.mimeType})
                </div>
              )}
            </div>
          ) : isMarkdown ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: '34px',
                  padding: '0 16px',
                  backgroundColor: 'var(--bg-sidebar)',
                  borderBottom: '1px solid var(--border-color)',
                  flexShrink: 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  {isAgentArtifact(displayFile.name) ? (
                    getArtifactIcon(displayFile.name)
                  ) : (
                    <SymbolsFileIcon
                      fileName={displayFile.name}
                      autoAssign={true}
                      width={16}
                      height={16}
                      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
                    />
                  )}
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap' }}>
                    {getDisplayName(displayFile.name)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', marginLeft: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {getRelativeDirPath(displayFile.path, activeWorkspace?.path)}
                  </span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  {displayFile.name === 'implementation_plan.md' && (
                    <div style={{ display: 'flex', gap: 6, marginRight: '8px' }}>
                      <button
                        className="btn"
                        style={{ padding: '2px 8px', fontSize: 'var(--font-size-xxs)', height: '22px', border: '1px solid rgba(255,255,255,0.12)' }}
                        onClick={() => {
                          setGlobalPrompt({ prompt: 'I reject the implementation plan. Please make modifications based on my requirements.' })
                          toast.info('Rejected implementation plan. Agent notified.')
                        }}
                      >
                        Reject
                      </button>
                      <button
                        className="btn primary"
                        style={{ padding: '2px 8px', fontSize: 'var(--font-size-xxs)', height: '22px' }}
                        onClick={() => {
                          setGlobalPrompt({ prompt: 'I approve the implementation plan. Please proceed with execution.' })
                          toast.success('Approved plan. Proceeding with execution.')
                        }}
                      >
                        Proceed
                      </button>
                    </div>
                  )}
                  
                  <div
                    title="Copy file content"
                    onClick={() => {
                      navigator.clipboard.writeText(displayFile.content ?? '')
                      toast.success('File content copied!')
                    }}
                    className="editor-toolbar-action"
                  >
                    <Copy size={13} />
                  </div>
                </div>
              </div>

              <div
                style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', backgroundColor: 'var(--bg-sidebar)', color: 'var(--text-primary)', lineHeight: 1.6, fontSize: 'var(--font-size-md-plus)', userSelect: 'text' }}
                className="assistant-content markdown-body"
              >
                <MarkdownRenderer isArtifact={true} content={displayFile.content ?? ''} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: '34px',
                  padding: '0 16px',
                  backgroundColor: 'var(--bg-sidebar)',
                  borderBottom: '1px solid var(--border-color)',
                  flexShrink: 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <SymbolsFileIcon
                    fileName={displayFile.name}
                    autoAssign={true}
                    width={16}
                    height={16}
                    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
                  />
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap' }}>
                    {getDisplayName(displayFile.name)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', marginLeft: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {getRelativeDirPath(displayFile.path, activeWorkspace?.path)}
                  </span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  <div
                    title={isDiffMode ? "Show Code Editor" : "Show File Diff (vs git HEAD)"}
                    onClick={() => setIsDiffMode(!isDiffMode)}
                    className={isDiffMode ? "editor-toolbar-action active" : "editor-toolbar-action"}
                  >
                    <FileDiff size={13} />
                  </div>
                  <div
                    title="Find in file (native)"
                    onClick={handleSearchClick}
                    className="editor-toolbar-action"
                  >
                    <Search size={13} />
                  </div>
                  <div
                    title="Copy file content"
                    onClick={() => {
                      navigator.clipboard.writeText(displayFile.content ?? '')
                      toast.success('File content copied!')
                    }}
                    className="editor-toolbar-action"
                  >
                    <Copy size={13} />
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg-sidebar)' }}>
                {themeLoaded ? (
                  isDiffMode ? (
                    <DiffEditor
                      height="100%"
                      language={displayFile.language}
                      theme="orch-dark"
                      original={originalContent ?? ''}
                      modified={displayFile.content ?? ''}
                      onMount={handleDiffEditorMount}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        renderSideBySide: true,
                        scrollbar: {
                          vertical: 'visible',
                          horizontal: 'visible',
                          useShadows: false,
                          verticalScrollbarSize: 8,
                          horizontalScrollbarSize: 8
                        }
                      }}
                    />
                  ) : (
                    <Editor
                      height="100%"
                      language={displayFile.language}
                      theme="orch-dark"
                      path={displayFile.path}
                      value={displayFile.content ?? ''}
                      onMount={handleEditorMount}
                      options={{
                        minimap: { enabled: false },
                        renderValidationDecorations: 'off',
                        fontSize: 13,
                        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, Menlo, Consolas, monospace',
                        lineHeight: 1.6,
                        padding: { top: 16 },
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        readOnly: true,
                        lineNumbersMinChars: 3,
                        lineDecorationsWidth: 6,
                        folding: false,
                        automaticLayout: true,
                        cursorBlinking: 'blink',
                        cursorSmoothCaretAnimation: 'on',
                        smoothScrolling: true,
                        contextmenu: true,
                        overviewRulerBorder: false,
                        overviewRulerLanes: 0,
                        scrollbar: {
                          vertical: 'visible',
                          horizontal: 'visible',
                          useShadows: false,
                          verticalScrollbarSize: 8,
                          horizontalScrollbarSize: 8
                        }
                      }}
                    />
                  )
                ) : (
                  <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--bg-sidebar)' }} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Tabs.Root>
  )
}

export default ArtifactPanel
