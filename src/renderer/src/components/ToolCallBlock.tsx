import React from 'react'
import { Terminal, FolderOpen, Globe, AlertCircle, ClipboardList, ClipboardCheck, BookOpen } from 'lucide-react'
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
        lineRange = `#L${args.startLine}-${args.endLine}`
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
    default:
      operation = 'Ran'
      target = toolCall.toolName
  }

  if (isFile) {
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
            width: 10,
            height: 10,
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
      return <AlertCircle size={12} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
    }
    return null
  }

  const renderIcon = () => {
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
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12.5,
        color: 'var(--text-secondary)',
        marginBottom: 8,
        paddingLeft: 2,
        userSelect: 'none',
        height: 20,
        contain: 'strict',
        cursor: isFile ? 'pointer' : 'default',
        borderRadius: 4,
        transition: 'background 0.15s ease'
      }}
      onMouseEnter={(e) => {
        if (isFile) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={(e) => {
        if (isFile) e.currentTarget.style.background = 'transparent'
      }}
      title={isFile ? `Open ${fullPath}` : undefined}
    >
      <span style={{ color: '#9c9c9c', fontWeight: 400 }}>{operation}</span>

      <span style={{ display: 'flex', alignItems: 'center' }}>{renderIcon()}</span>

      <span
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          maxWidth: 380,
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
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            opacity: 0.6,
            marginLeft: -2
          }}
        >
          {lineRange}
        </span>
      )}

      {renderStatus()}

      {!isAgentArtifact(target) && (toolCall.toolName === 'writeToFile' || toolCall.toolName === 'replaceFileContent' || toolCall.toolName === 'multiReplaceFileContent') && (additions > 0 || deletions > 0) && (
        <div style={{ display: 'flex', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, marginLeft: 2 }}>
          {additions > 0 && <span style={{ color: 'var(--accent-green)' }}>+{additions}</span>}
          {deletions > 0 && <span style={{ color: 'var(--accent-red)' }}>-{deletions}</span>}
        </div>
      )}
    </div>
  )
}

export default ToolCallBlock
