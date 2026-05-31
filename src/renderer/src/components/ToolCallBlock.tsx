import React from 'react'
import { Terminal, FolderOpen, Globe, AlertCircle, ClipboardList, ClipboardCheck, BookOpen, MousePointerClick, Keyboard, Camera, ChevronsUpDown } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { useSetAtom } from 'jotai'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom } from '../store/agentStore'
import type { ToolCallEntry } from '../store/agentStore'

const isAgentArtifact = (fileName: string) => {
  return fileName === 'implementation_plan.md' || fileName === 'task.md' || fileName === 'walkthrough.md'
}

interface FileIconProps {
  fileName: string
  className?: string
  size?: number
}

export const FileIcon: React.FC<FileIconProps> = ({ fileName, className = '', size = 16 }) => {
  return (
    <SymbolsFileIcon
      fileName={fileName}
      autoAssign={true}
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  )
}

interface ToolCallBlockProps {
  toolCall: ToolCallEntry
}

function getToolDetails(toolCall: ToolCallEntry) {
  let operation = 'Ran'
  let target = 'tool'
  let fullPath = ''
  let isFile = false
  let additions = 0
  let deletions = 0
  let lineRange = ''

  const args = (toolCall.args ?? {}) as any
  const result = (toolCall.result ?? {}) as any

  switch (toolCall.toolName) {
    case 'viewFile':
      operation = 'Analyzed'
      fullPath = (args.absolutePath as string) ?? ''
      isFile = true
      if (args.startLine !== undefined && args.endLine !== undefined) {
        lineRange = `#L${args.startLine}-${args.endLine}`
      } else if (result.readStart !== undefined && result.readEnd !== undefined) {
        lineRange = `#L${result.readStart}-${result.readEnd}`
      } else if (result.totalLines !== undefined) {
        lineRange = `#L1-${result.totalLines}`
      }
      break
    case 'writeToFile':
      operation = 'Created'
      fullPath = (args.targetFile as string) ?? ''
      isFile = true
      if (args.codeContent) additions = (args.codeContent as string).split('\n').length
      break
    case 'replaceFileContent':
      operation = 'Edited'
      fullPath = (args.targetFile as string) ?? ''
      isFile = true
      if (args.startLine !== undefined && args.endLine !== undefined) {
        deletions = (args.endLine as number) - (args.startLine as number) + 1
      }
      if (args.replacementContent) additions = (args.replacementContent as string).split('\n').length
      break
    case 'multiReplaceFileContent':
      operation = 'Edited chunks in'
      fullPath = (args.targetFile as string) ?? ''
      isFile = true
      if (args.replacementChunks && Array.isArray(args.replacementChunks)) {
        additions = args.replacementChunks.reduce((acc: number, c: any) => acc + (c.replacementContent ? c.replacementContent.split('\n').length : 0), 0)
        deletions = args.replacementChunks.reduce((acc: number, c: any) => acc + ((c.endLine || 0) - (c.startLine || 0) + 1), 0)
      }
      break
    case 'runCommand':
      operation = 'Ran command'
      target = (args.commandLine as string) ?? ''
      break
    case 'searchWeb':
      operation = 'Searched web'
      target = (args.query as string) ?? ''
      break
    case 'listDir':
      operation = 'Listed'
      target = (args.directoryPath as string) || 'workspace root'
      break
    case 'browserNavigate':
      operation = 'Navigated browser to'
      target = (args.url as string) ?? ''
      break
    case 'browserType':
      operation = 'Typed in browser'
      const typeLabel = args.selector && args.text ? `${args.selector} ➔ "${args.text}"` : (args.selector ?? '')
      target = args.frameSelector ? `[Frame: ${args.frameSelector}] ${typeLabel}` : typeLabel
      break
    case 'browserScroll':
      operation = 'Scrolled browser'
      target = `${args.direction} by ${args.amount || 400}px`
      break
    case 'browserMouseClickCoordinate':
      operation = 'Clicked coordinate'
      target = `(${args.x}, ${args.y}) using ${args.button || 'left'}`
      break
    case 'browserScreenshot':
      operation = 'Captured screenshot'
      target = result.filename ?? 'viewport'
      if (result.filePath) {
        fullPath = result.filePath.replace('file://', '')
        isFile = true
      }
      break
    default:
      operation = 'Ran'
      target = toolCall.toolName
  }

  if (isFile && toolCall.toolName !== 'browserScreenshot') {
    target = fullPath.split(/[/\\]/).pop() ?? fullPath
  }

  return { operation, target, fullPath, isFile, additions, deletions, lineRange }
}

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ toolCall }) => {
  const { operation, target, fullPath, isFile, additions, deletions, lineRange } = getToolDetails(toolCall)
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

  const handleClick = async () => {
    if (!isFile || !fullPath) return
    try {
      const fileData = await window.api.readFile(fullPath)
      if (fileData) {
        setActiveEditorFile(fileData)
        setArtifactPanelMode('editor')
        setArtifactPanelOpen(true)
      }
    } catch (err) {
      console.error('[ToolCallBlock] Failed to open file:', err)
    }
  }

  const renderStatus = () => {
    if (toolCall.status === 'pending') {
      return (
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '1.5px solid var(--text-secondary)',
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
            flexShrink: 0
          }}
        />
      )
    }
    if (toolCall.status === 'error') {
      return <AlertCircle size={14} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
    }
    return null
  }

  const renderIcon = () => {
    if (toolCall.toolName === 'browserScreenshot') {
      return <Camera size={15} style={{ color: '#38bdf8', flexShrink: 0 }} />
    }
    if (isFile) {
      if (target === 'implementation_plan.md') {
        return <ClipboardList size={15} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
      }
      if (target === 'task.md') {
        return <ClipboardCheck size={15} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
      }
      if (target === 'walkthrough.md') {
        return <BookOpen size={15} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
      }
      return <FileIcon fileName={target} size={16} />
    }
    switch (toolCall.toolName) {
      case 'browserNavigate':
        return <Globe size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />
      case 'browserType':
        return <Keyboard size={15} style={{ color: '#34d399', flexShrink: 0 }} />
      case 'browserScroll':
        return <ChevronsUpDown size={15} style={{ color: '#94a3b8', flexShrink: 0 }} />
      case 'browserMouseClickCoordinate':
        return <MousePointerClick size={15} style={{ color: '#f472b6', flexShrink: 0 }} />
      case 'runCommand':
        return <Terminal size={15} style={{ color: '#4ade80', flexShrink: 0 }} />
      case 'listDir':
        return <FolderOpen size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
      case 'searchWeb':
        return <Globe size={15} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
      default:
        return <Terminal size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
    }
  }

  return (
    <div
      onClick={isFile ? handleClick : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--font-size-xs)',
        color: 'var(--text-secondary)',
        marginBottom: 0,
        padding: '2px 6px',
        userSelect: 'none',
        height: 22,
        contain: 'layout paint',
        cursor: isFile ? 'pointer' : 'default',
        borderRadius: 4,
        backgroundColor: 'transparent',
        transition: 'all 0.15s ease',
        maxWidth: '100%',
        boxSizing: 'border-box'
      }}
      onMouseEnter={(e) => {
        if (isFile) {
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
        }
      }}
      onMouseLeave={(e) => {
        if (isFile) {
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.backgroundColor = 'transparent'
        }
      }}
      title={isFile ? `Open ${fullPath}` : undefined}
    >
      <span style={{ color: 'var(--text-muted)', fontWeight: 400, whiteSpace: 'nowrap' }}>{operation}</span>
 
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.8 }}>{renderIcon()}</span>
 
      <span
        style={{
          color: 'var(--text-secondary)',
          fontWeight: 500,
          fontFamily: 'var(--font-mono)',
          fontSize: '11.5px',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: 'none'
        }}
      >
        {target}
      </span>
 
      {lineRange && (
        <span
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: '10.5px',
            opacity: 0.7,
            marginLeft: -2,
            whiteSpace: 'nowrap'
          }}
        >
          {lineRange}
        </span>
      )}
 
      {renderStatus()}
 
      {!isAgentArtifact(target) && (toolCall.toolName === 'writeToFile' || toolCall.toolName === 'replaceFileContent' || toolCall.toolName === 'multiReplaceFileContent') && (additions > 0 || deletions > 0) && (
        <div style={{ display: 'flex', gap: 3, fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 600, marginLeft: 2, flexShrink: 0 }}>
          {additions > 0 && <span style={{ color: 'var(--accent-green)' }}>+{additions}</span>}
          {deletions > 0 && <span style={{ color: 'var(--accent-red)' }}>-{deletions}</span>}
        </div>
      )}
    </div>
  )
}

export default ToolCallBlock
