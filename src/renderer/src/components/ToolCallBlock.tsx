import React from 'react'
import {
  Terminal, FolderOpen, Globe, AlertCircle, ClipboardList, BookOpen,
  MousePointerClick, Keyboard, Camera, ChevronsUpDown, FileText
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { useSetAtom, useAtomValue } from 'jotai'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom } from '../store/agentStore'
import type { ToolCallEntry } from '../store/types'
import type { FileReadResult } from '../../../preload/index.d'

export const FileIcon: React.FC<{ fileName: string; className?: string; size?: number }> = ({ fileName, className = '', size = 16 }) => (
  <SymbolsFileIcon fileName={fileName} autoAssign={true} width={size} height={size} className={`${className} file-icon-wrapper`} />
)

// Derive a human-readable label and target from the tool name + args natively
function getToolDisplay(toolName: string, args: Record<string, unknown>): {
  operation: string
  target: string
  fullPath: string | null
  isFile: boolean
} {
  const fileWriteTools = ['writeToFile', 'replaceFileContent', 'multiReplaceFileContent']

  if (fileWriteTools.includes(toolName)) {
    const path = (args.targetFile as string) ?? ''
    const name = path.split(/[/\\]/).pop() ?? path
    return { operation: toolName === 'writeToFile' ? 'Writing' : 'Editing', target: name, fullPath: path || null, isFile: true }
  }
  if (toolName === 'viewFile') {
    const path = (args.absolutePath as string) ?? ''
    return { operation: 'Viewing', target: path.split(/[/\\]/).pop() ?? path, fullPath: path || null, isFile: true }
  }
  if (toolName === 'listDir') {
    const path = (args.directoryPath as string) ?? ''
    return { operation: 'Listing', target: path.split(/[/\\]/).pop() ?? path, fullPath: null, isFile: false }
  }
  if (toolName === 'searchWorkspace') {
    return { operation: 'Searching', target: String(args.query ?? '').slice(0, 40), fullPath: null, isFile: false }
  }
  if (toolName === 'runCommand') {
    return { operation: 'Running', target: String(args.commandLine ?? '').slice(0, 40), fullPath: null, isFile: false }
  }
  if (toolName === 'browserNavigate') {
    return { operation: 'Navigating', target: String(args.url ?? '').replace(/^https?:\/\//, '').slice(0, 40), fullPath: null, isFile: false }
  }
  if (toolName === 'browserScreenshot') {
    return { operation: 'Capturing', target: 'screenshot', fullPath: null, isFile: false }
  }
  if (toolName === 'browserType') {
    return { operation: 'Typing', target: String(args.selector ?? '').slice(0, 30), fullPath: null, isFile: false }
  }
  if (toolName === 'browserScroll') {
    return { operation: 'Scrolling', target: String(args.direction ?? ''), fullPath: null, isFile: false }
  }
  if (toolName === 'browserMouseClickCoordinate') {
    return { operation: 'Clicking', target: `(${args.x}, ${args.y})`, fullPath: null, isFile: false }
  }
  if (toolName === 'searchWeb') {
    return { operation: 'Searching web', target: String(args.query ?? '').slice(0, 40), fullPath: null, isFile: false }
  }
  // Default: just show tool name
  return { operation: toolName, target: '', fullPath: null, isFile: false }
}

function renderToolIcon(toolName: string, isFile: boolean, target: string) {
  if (toolName === 'browserScreenshot') return <Camera size={15} className="icon-blue" />
  if (isFile) {
    if (target === 'implementation_plan.md') return <ClipboardList size={15} className="icon-purple" />
    if (target === 'walkthrough.md') return <BookOpen size={15} className="icon-green" />
    return <FileIcon fileName={target} size={16} />
  }
  switch (toolName) {
    case 'browserNavigate': return <Globe size={15} className="icon-light-blue" />
    case 'browserType': return <Keyboard size={15} className="icon-teal" />
    case 'browserScroll': return <ChevronsUpDown size={15} className="icon-slate" />
    case 'browserMouseClickCoordinate': return <MousePointerClick size={15} className="icon-pink" />
    case 'runCommand': return <Terminal size={15} className="icon-lime" />
    case 'listDir': return <FolderOpen size={15} className="icon-secondary" />
    case 'searchWorkspace': return <FileText size={15} className="icon-secondary" />
    case 'searchWeb': return <Globe size={15} className="icon-purple" />
    default: return <Terminal size={15} className="icon-secondary" />
  }
}

const ToolCallBlock: React.FC<{ toolCall: ToolCallEntry }> = ({ toolCall }) => {
  const { operation, target, fullPath, isFile } = getToolDisplay(toolCall.toolName, toolCall.args)
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)

  const handleClick = async () => {
    if (!isFile || !fullPath) return
    try {
      const fileData = await window.api.invoke('file:read', { filePath: fullPath, conversationId: activeThreadId }) as FileReadResult
      if (fileData) { setActiveEditorFile(fileData); setArtifactPanelMode('editor'); setArtifactPanelOpen(true) }
    } catch (err) { console.error('[ToolCallBlock] Failed to open file:', err) }
  }

  const Component = (isFile ? 'button' : 'div') as React.ElementType
  return (
    <Component
      onClick={isFile ? handleClick : undefined}
      className={`tool-call-wrapper ${isFile ? 'tool-call-interactive' : 'tool-call-non-interactive'}`}
      title={isFile ? `Open ${fullPath}` : undefined}
    >
      <span className="muted-text">{operation}</span>
      <span className="icon-wrapper">{renderToolIcon(toolCall.toolName, isFile, target)}</span>
      <span className="target-text">{target}</span>
      {toolCall.status === 'pending' && <div className="tool-call-spinner" />}
      {toolCall.status === 'error' && <AlertCircle size={14} className="icon-red" />}
    </Component>
  )
}

export default React.memo(ToolCallBlock, (prev, next) =>
  prev.toolCall.id === next.toolCall.id &&
  prev.toolCall.status === next.toolCall.status &&
  prev.toolCall.result === next.toolCall.result &&
  prev.toolCall.args === next.toolCall.args
)
