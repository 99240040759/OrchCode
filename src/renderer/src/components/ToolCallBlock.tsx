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
import * as styles from './chat.css'
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
      className={`${className} ${styles.fileIconWrapper}`}
    />
  )
}

// ─── Tool Icons ───────────────────────────────────────────────────────────────

interface ToolCallBlockProps {
  toolCall: ToolCallEntry
}

function renderToolIcon(toolName: string, isFile: boolean, target: string) {
  if (toolName === 'browserScreenshot') {
    return <Camera size={15} className={styles.iconBlue} />
  }
  if (isFile) {
    if (target === 'implementation_plan.md') {
      return <ClipboardList size={15} className={styles.iconPurple} />
    }
    if (target === 'walkthrough.md') {
      return <BookOpen size={15} className={styles.iconGreen} />
    }
    return <FileIcon fileName={target} size={16} />
  }
  switch (toolName) {
    case 'browserNavigate':
      return <Globe size={15} className={styles.iconLightBlue} />
    case 'browserType':
      return <Keyboard size={15} className={styles.iconTeal} />
    case 'browserScroll':
      return <ChevronsUpDown size={15} className={styles.iconSlate} />
    case 'browserMouseClickCoordinate':
      return <MousePointerClick size={15} className={styles.iconPink} />
    case 'runCommand':
      return <Terminal size={15} className={styles.iconLime} />
    case 'listDir':
      return <FolderOpen size={15} className={styles.iconSecondary} />
    case 'searchWeb':
      return <Globe size={15} className={styles.iconPurple} />
    default:
      return <Terminal size={15} className={styles.iconSecondary} />
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
      const fileData = await window.workspaceBridge.readFile(fullPath, activeThreadId)
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
      return <AlertCircle size={14} className={styles.iconRed} />
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
      <span className={styles.mutedText}>
        {operation}
      </span>

      <span className={styles.iconWrapper}>
        {renderToolIcon(toolCall.toolName, isFile, target)}
      </span>

      <span className={styles.targetText}>
        {target}
      </span>

      {lineRange && (
        <span className={styles.lineRangeText}>
          {lineRange}
        </span>
      )}

      {renderStatus()}

      {!isAgentArtifact(target) &&
        (toolCall.toolName === 'writeToFile' ||
          toolCall.toolName === 'replaceFileContent' ||
          toolCall.toolName === 'multiReplaceFileContent') &&
        (additions > 0 || deletions > 0) && (
          <div className={styles.diffStats}>
            {additions > 0 && <span className={styles.diffAdd}>+{additions}</span>}
            {deletions > 0 && <span className={styles.diffSub}>-{deletions}</span>}
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
