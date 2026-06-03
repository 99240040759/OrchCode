import React from 'react'
import {
  Terminal,
  FolderOpen,
  Globe,
  AlertCircle,
  ClipboardList,
  BookOpen,
  MousePointerClick,
  Keyboard,
  Camera,
  ChevronsUpDown
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { useSetAtom, useAtomValue } from 'jotai'
import {
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom,
  activeThreadIdAtom
} from '../store/agentStore'
import type { ToolCallEntry } from '../store/types'
import * as styles from './ToolCallBlock.css'
import { isAgentArtifact } from '../lib/uiUtils'
import { parseToolFileOp } from '../lib/parseToolFileOp'

// ─── File Icon ────────────────────────────────────────────────────────────────

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

// ─── Tool Icons ───────────────────────────────────────────────────────────────

interface ToolCallBlockProps {
  toolCall: ToolCallEntry
}

function renderToolIcon(toolName: string, isFile: boolean, target: string) {
  if (toolName === 'browserScreenshot') {
    return <Camera size={15} style={{ color: '#38bdf8', flexShrink: 0 }} />
  }
  if (isFile) {
    if (target === 'implementation_plan.md') {
      return <ClipboardList size={15} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
    }
    if (target === 'walkthrough.md') {
      return <BookOpen size={15} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
    }
    return <FileIcon fileName={target} size={16} />
  }
  switch (toolName) {
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

// ─── ToolCallBlock ────────────────────────────────────────────────────────────

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ toolCall }) => {
  const { operation, target, fullPath, isFile, additions, deletions, lineRange } = parseToolFileOp(
    toolCall.toolName,
    toolCall.args,
    toolCall.result
  )

  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)

  const handleClick = async () => {
    if (!isFile || !fullPath) return
    try {
      const fileData = await window.api.readFile(fullPath, activeThreadId)
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
        <div className={styles.spinner} />
      )
    }
    if (toolCall.status === 'error') {
      return <AlertCircle size={14} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
    }
    return null
  }

  const Component = (isFile ? 'button' : 'div') as React.ElementType
  return (
    <Component
      onClick={isFile ? handleClick : undefined}
      className={`${styles.toolCallWrapper} ${isFile ? styles.interactive : styles.nonInteractive}`}
      title={isFile ? `Open ${fullPath}` : undefined}
    >
      <span style={{ color: 'var(--text-muted)', fontWeight: 400, whiteSpace: 'nowrap' }}>
        {operation}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.8 }}>
        {renderToolIcon(toolCall.toolName, isFile, target)}
      </span>

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

      {!isAgentArtifact(target) &&
        (toolCall.toolName === 'writeToFile' ||
          toolCall.toolName === 'replaceFileContent' ||
          toolCall.toolName === 'multiReplaceFileContent') &&
        (additions > 0 || deletions > 0) && (
          <div
            style={{
              display: 'flex',
              gap: 3,
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              marginLeft: 2,
              flexShrink: 0
            }}
          >
            {additions > 0 && <span style={{ color: 'var(--accent-green)' }}>+{additions}</span>}
            {deletions > 0 && <span style={{ color: 'var(--accent-red)' }}>-{deletions}</span>}
          </div>
        )}
    </Component>
  )
}

export default React.memo(ToolCallBlock, (prev, next) => {
  return (
    prev.toolCall.id === next.toolCall.id &&
    prev.toolCall.status === next.toolCall.status &&
    prev.toolCall.result === next.toolCall.result &&
    // Must re-render when args arrive during streaming (streaming-start → tool-call)
    prev.toolCall.args === next.toolCall.args
  )
})
