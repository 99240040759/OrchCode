import React, { useState, useRef, useEffect } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip'
import { cn } from '../lib/utils'
import {
  TbX,
  TbRefresh,
  TbFolderOpen,
  TbFolder,
  TbArrowLeft,
  TbArrowRight,
  TbSearch,
  TbLoader2,
  TbChevronDown,
  TbChevronRight
} from 'react-icons/tb'
import { IconButton } from './button'
import { FileTab } from './tabs'
import { useThreadStore } from '../lib/threadStore'
import { useShallow } from 'zustand/react/shallow'
import { Markdown } from './Markdown'
import { FileIcon } from './FileIcon'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import chromeLogo from '../assets/chrome.svg'
import { ScrollableTabBar } from './tabs'
import { getRelativePath, getAbsolutePath } from '../../shared/pathHelpers'
import { Tree, NodeRendererProps } from 'react-arborist'

type TreeNodeData = {
  id: string
  name: string
  children?: TreeNodeData[]
}

function buildTree(paths: string[], workspacePath: string): TreeNodeData[] {
  const root: TreeNodeData[] = []
  const levelMaps: Map<string, TreeNodeData>[] = [new Map()]
  for (const path of paths) {
    const rel = getRelativePath(path, workspacePath)
    if (!rel) continue
    const parts = rel.split('/')
    let currentLevel = root
    let currentMap = levelMaps[0]
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLeaf = i === parts.length - 1
      const id = parts.slice(0, i + 1).join('/')
      const absPath = getAbsolutePath(id, workspacePath)
      let existing = currentMap.get(part)
      if (!existing) {
        existing = { id: absPath, name: part, ...(isLeaf ? {} : { children: [] }) }
        currentLevel.push(existing)
        currentMap.set(part, existing)
      }
      if (!isLeaf) {
        if (!existing.children) existing.children = []
        if (!levelMaps[i + 1]) levelMaps[i + 1] = new Map()
        currentLevel = existing.children
        currentMap = levelMaps[i + 1]
      }
    }
  }
  const sortNodes = (nodes: TreeNodeData[]) => {
    nodes.sort((a, b) => {
      const aIsFolder = !!a.children
      const bIsFolder = !!b.children
      if (aIsFolder && !bIsFolder) return -1
      if (!aIsFolder && bIsFolder) return 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children) sortNodes(node.children)
    }
  }
  sortNodes(root)
  return root
}

const FileTreeNode = ({ node, style, dragHandle, tree }: NodeRendererProps<TreeNodeData>) => {
  const isActive = tree.props.selection === node.id || node.isSelected
  return (
    <div style={style} ref={dragHandle}>
      <div 
        onClick={(e) => {
          e.stopPropagation()
          node.isInternal ? node.toggle() : node.activate()
        }}
        style={{ paddingLeft: `${node.level * 6 + 6}px` }}
        className={cn('flex items-center w-full h-full text-left hover:bg-oc-hover transition-colors cursor-pointer text-[13px] py-1 pr-1.5 rounded-sm truncate leading-tight font-normal select-none', isActive ? 'bg-oc-active text-tx-bright' : 'text-tx-muted hover:text-tx-main')}
      >
        <FileIcon path={node.data.name} isFolder={node.isInternal} size={14} className="flex-shrink-0 mr-1.5 pointer-events-none" />
        <span className="truncate min-w-0 shrink text-left pointer-events-none">{node.data.name}</span>
        {node.isInternal && (
          <div className="w-4 h-4 flex items-center justify-center text-tx-dim ml-1 flex-shrink-0 pointer-events-none">
            {node.isOpen ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />}
          </div>
        )}
      </div>
    </div>
  )
}

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  py: 'python',
  go: 'go',
  rs: 'rust',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql',
  toml: 'toml',
  xml: 'xml',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  dart: 'dart'
}
function getLanguage(path: string): string {
  const ext = path.split('.').pop()
  return (ext && LANGUAGE_MAP[ext.toLowerCase()]) ?? 'plaintext'
}

interface FileTreeProps {
  nodes: string[]
  activePath: string | undefined
  onSelect: (path: string) => void
  workspacePath?: string | undefined
}
function FileTree({ nodes, activePath, onSelect, workspacePath }: FileTreeProps): React.JSX.Element {
  if (!workspacePath) return (
    <div className="h-full flex items-center justify-center p-4 text-center">
      <div>
        <FileIcon path="folder" isFolder size={32} className="text-tx-dim mx-auto mb-2" />
        <p className="text-sm text-tx-dim">No workspace<br />selected for this thread</p>
      </div>
    </div>
  )
  const data = React.useMemo(() => buildTree(nodes, workspacePath), [nodes, workspacePath])
  const [ref, size] = useElementSize()
  const activeAbsPath = activePath ? getAbsolutePath(activePath, workspacePath) : undefined

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden select-none" ref={ref}>
        {nodes.length === 0 ? <p className="text-xs text-tx-dim text-center py-4">Empty directory</p> : (
          <Tree
            className="!overflow-x-hidden"
            data={data}
            selection={activeAbsPath}
            width={size.width}
            height={size.height}
            rowHeight={24}
            indent={6}
            openByDefault={false}
            disableDrag
            disableDrop
            onActivate={(node) => {
              if (node.isLeaf) onSelect(node.id)
              else node.toggle()
            }}
          >
            {FileTreeNode}
          </Tree>
        )}
      </div>
    </div>
  )
}

type WebviewEl = HTMLElement & {
  loadURL: (url: string) => void
  reload: () => void
  stop: () => void
  goBack: () => void
  goForward: () => void
}

export function ArtifactPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const {
    activeFilePath,
    activeFileContent,
    fileTree,
    setActiveFile,
    loadFileTree,
    sessions,
    currentSessionId,
    showBrowser,
    setShowBrowser,
    openFiles,
    closeFile
  } = useThreadStore(
    useShallow((s) => ({
      activeFilePath: s.activeFilePath,
      activeFileContent: s.activeFileContent,
      fileTree: s.fileTree,
      setActiveFile: s.setActiveFile,
      loadFileTree: s.loadFileTree,
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      showBrowser: s.showBrowser,
      setShowBrowser: s.setShowBrowser,
      openFiles: s.openFiles,
      closeFile: s.closeFile
    }))
  )
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId)
  const workspacePath = currentSession?.workspaceRoot || currentSession?.cwd
  const [showTree, setShowTree] = useState(() => localStorage.getItem('ap:showTree') !== 'false')
  const [browserUrl, setBrowserUrl] = useState('https://google.com')
  const [inputUrl, setInputUrl] = useState('https://google.com')
  const [isLoading, setIsLoading] = useState(false)
  const webviewRef = useRef<WebviewEl | null>(null)
  const handleFileSelect = (fp: string): void => {
    void setActiveFile(fp)
  }
  const handleRefreshAll = async (): Promise<void> => {
    if (workspacePath) await loadFileTree(workspacePath)
    if (activeFilePath) await setActiveFile(activeFilePath)
  }

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !showBrowser) return
    const handleNavigate = (event: Event): void => {
      const url = (event as CustomEvent & { url?: string }).url
      if (typeof url === 'string' && url) setInputUrl(url)
    }
    const handleStart = () => setIsLoading(true)
    const handleStop = () => setIsLoading(false)
    wv.addEventListener('did-navigate', handleNavigate)
    wv.addEventListener('did-navigate-in-page', handleNavigate)
    wv.addEventListener('did-start-loading', handleStart)
    wv.addEventListener('did-stop-loading', handleStop)
    wv.addEventListener('did-fail-load', handleStop)
    return () => {
      wv.removeEventListener('did-navigate', handleNavigate)
      wv.removeEventListener('did-navigate-in-page', handleNavigate)
      wv.removeEventListener('did-start-loading', handleStart)
      wv.removeEventListener('did-stop-loading', handleStop)
      wv.removeEventListener('did-fail-load', handleStop)
    }
  }, [showBrowser])

  const navigateBrowser = (url: string): void => {
    let finalUrl = url.trim()
    if (finalUrl.toLowerCase().startsWith('javascript:')) return
    try {
      const parsed = new URL(finalUrl)
      if (parsed.protocol === 'javascript:') return
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        finalUrl = 'https://google.com/search?q=' + encodeURIComponent(finalUrl)
      }
    } catch {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) finalUrl = 'https://' + finalUrl
      else finalUrl = 'https://google.com/search?q=' + encodeURIComponent(finalUrl)
    }
    setInputUrl(finalUrl)
    setBrowserUrl(finalUrl)
  }

  const isMac = window.api.platform === 'darwin'

  return (
    <div className="flex flex-col h-full min-w-artifact flex-1 bg-oc-base overflow-hidden">
      <div className="h-titlebar w-full flex-shrink-0 z-10 app-region-no-drag border-b border-oc-border bg-oc-base">
        <ScrollableTabBar
          leftNode={
            <FileTab
              active={showBrowser}
              onClick={() => setShowBrowser(true)}
              onClose={() => setShowBrowser(false)}
              name="Browser"
              iconType="browser"
              browserIcon={<img src={chromeLogo} alt="Chrome" className="w-[16px] h-[16px]" />}
              maxWidth="max-w-[150px]"
            />
          }
          rightNode={
            <div className={cn('h-full flex-shrink-0', isMac ? 'w-[36px]' : 'w-[140px]')} />
          }
        >
          {openFiles.map((fp) => {
            const fName = fp.split(/[/\\]/).pop()
            return (
              <Tooltip key={fp}>
                <TooltipTrigger asChild>
                  <FileTab
                    active={!showBrowser && activeFilePath === fp}
                    onClick={() => {
                      setShowBrowser(false)
                      handleFileSelect(fp)
                    }}
                    onClose={() => closeFile(fp)}
                    name={fName || ''}
                    path={fp}
                    maxWidth="max-w-[150px]"
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <span className="font-mono text-xs">{fp}</span>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </ScrollableTabBar>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 border-b border-oc-border bg-oc-base flex-shrink-0 min-h-[36px]">
        {showBrowser ? (
          <div className="flex items-center gap-1 w-full">
            <IconButton size="sm" onClick={() => webviewRef.current?.goBack()}>
              <TbArrowLeft size={16} className="text-tx-sub hover:text-tx-bright" />
            </IconButton>
            <IconButton size="sm" onClick={() => webviewRef.current?.goForward()}>
              <TbArrowRight size={16} className="text-tx-sub hover:text-tx-bright" />
            </IconButton>
            <IconButton size="sm" onClick={() => isLoading ? webviewRef.current?.stop() : webviewRef.current?.reload()}>
              {isLoading ? (
                <TbX size={16} className="text-tx-sub hover:text-tx-bright" />
              ) : (
                <TbRefresh size={16} className="text-tx-sub hover:text-tx-bright" />
              )}
            </IconButton>
            <div className="flex-1 ml-2 bg-oc-surface border border-oc-border rounded-md px-3 py-1 flex items-center gap-2 overflow-hidden shadow-sm">
              {isLoading ? (
                <TbLoader2 size={14} className="text-tx-dim flex-shrink-0 animate-spin" />
              ) : (
                <TbSearch size={14} className="text-tx-dim flex-shrink-0" />
              )}
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-xs text-tx-main font-mono placeholder:font-sans placeholder:text-tx-dim"
                placeholder="Search or enter web address"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigateBrowser(e.currentTarget.value)
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 w-full overflow-hidden text-xs text-tx-dim font-mono">
            <span className="truncate">{activeFilePath ? getRelativePath(activeFilePath, workspacePath) : 'No file selected'}</span>
          </div>
        )}
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          <IconButton
            size="sm"
            onClick={() => {
              const next = !showTree
              setShowTree(next)
              localStorage.setItem('ap:showTree', String(next))
            }}
            tooltip={showTree ? 'Hide File Tree' : 'Show File Tree'}
            tooltipSide="bottom"
          >
            {showTree ? (
              <TbFolderOpen size={15} className="text-tx-sub" />
            ) : (
              <TbFolder size={15} className="text-tx-sub" />
            )}
          </IconButton>
          {!showBrowser && (
            <IconButton size="sm" onClick={handleRefreshAll} tooltip="Refresh" tooltipSide="bottom">
              <TbRefresh size={15} className="text-tx-sub" />
            </IconButton>
          )}
          <IconButton size="sm" onClick={onClose} tooltip="Close Panel" tooltipSide="bottom">
            <TbX size={17} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden min-w-0 flex flex-col bg-oc-base">
          <webview
            ref={webviewRef as React.LegacyRef<HTMLElement>}
            src={browserUrl}
            className={cn('w-full h-full flex-1 border-none', showBrowser ? 'flex' : 'hidden')}
            partition="persist:browser"
            webpreferences="contextIsolation=yes,javascript=yes,webgl=yes,backgroundThrottling=no"
            allowpopups={"true" as any}
          />
          <div className={cn('w-full flex-1 min-h-0 bg-oc-base', showBrowser ? 'hidden' : 'block')}>
            {activeFilePath ? (
              activeFileContent !== undefined ? (
                activeFilePath.toLowerCase().endsWith('.md') ? (
                  <div className="h-full overflow-y-auto pl-3 pr-1.5 py-3 bg-oc-base select-text">
                    <Markdown content={activeFileContent} />
                  </div>
                ) : (
                  <SyntaxHighlighter
                    language={getLanguage(activeFilePath)}
                    style={vscDarkPlus}
                    showLineNumbers={false} /* Disabled buggy native logic, using CSS counters */
                    wrapLines={true}
                    wrapLongLines={false}
                    customStyle={{
                      margin: 0,
                      padding: '12px 8px 12px 5px',
                      background: 'transparent',
                      fontSize: '13px',
                      tabSize: 2,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                    lineProps={{
                      className: 'code-line-with-counter',
                      style: {
                        display: 'block',
                        position: 'relative',
                        paddingLeft: '45px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }
                    }}
                    codeTagProps={{
                      style: {
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        paddingLeft: '0px',
                        marginLeft: '0px',
                        tabSize: 2,
                        counterReset: 'line'
                      }
                    }}
                    className="h-full overflow-y-auto overflow-x-hidden font-mono tab-size-2 leading-relaxed"
                  >
                    {activeFileContent}
                  </SyntaxHighlighter>
                )
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <TbLoader2 size={32} className="text-tx-sub animate-spin" />
                  <span className="text-sm text-tx-muted font-medium">Loading content...</span>
                </div>
              )
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center p-6">
                  <div className="w-12 h-12 rounded-xl bg-oc-raised border border-oc-border flex items-center justify-center mx-auto mb-3">
                    <svg
                      className="w-6 h-6 text-tx-dim"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                      />
                    </svg>
                  </div>
                  <p className="text-sm text-tx-dim font-semibold">No file open</p>
                  <p className="text-xs text-tx-dim mt-1 opacity-60">
                    Click a file in the tree or a file tool in chat
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        {showTree && (
          <div className="w-[180px] flex-shrink-0 flex flex-col border-l border-oc-border bg-oc-surface overflow-hidden pl-1 py-1 pr-0">
            <FileTree
              nodes={fileTree ?? []}
              activePath={activeFilePath}
              onSelect={handleFileSelect}
              workspacePath={workspacePath}
            />
          </div>
        )}
      </div>
    </div>
  )
}
