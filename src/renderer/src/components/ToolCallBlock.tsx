import React from 'react'
import {
  Terminal, FolderOpen, Globe, AlertCircle, ClipboardList, BookOpen,
  MousePointerClick, Keyboard, Camera, ChevronsUpDown
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { useSetAtom, useAtomValue } from 'jotai'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom } from '../store/agentStore'
import type { ToolCallEntry } from '../store/types'
import { isAgentArtifact } from '../lib/uiUtils'
import { parseToolFileOp } from '../lib/parseToolFileOp'

export const FileIcon: React.FC<{ fileName: string; className?: string; size?: number }> = ({ fileName, className = '', size = 16 }) => (
  <SymbolsFileIcon fileName={fileName} autoAssign={true} width={size} height={size} className={`${className} file-icon-wrapper`} />
)

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
    case 'searchWeb': return <Globe size={15} className="icon-purple" />
    default: return <Terminal size={15} className="icon-secondary" />
  }
}

const ToolCallBlock: React.FC<{ toolCall: ToolCallEntry }> = ({ toolCall }) => {
  const { operation, target, fullPath, isFile, additions, deletions, lineRange } = parseToolFileOp(toolCall.toolName, toolCall.args, toolCall.result)
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)

  const handleClick = async () => {
    if (!isFile || !fullPath) return
    try {
      const fileData = await window.workspaceBridge.readFile(fullPath, activeThreadId)
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
      {lineRange && <span className="line-range-text">{lineRange}</span>}
      {toolCall.status === 'pending' && <div className="tool-call-spinner" />}
      {toolCall.status === 'error' && <AlertCircle size={14} className="icon-red" />}
      {!isAgentArtifact(target) &&
        (toolCall.toolName === 'writeToFile' || toolCall.toolName === 'replaceFileContent' || toolCall.toolName === 'multiReplaceFileContent') &&
        (additions > 0 || deletions > 0) && (
          <div className="diff-stats">
            {additions > 0 && <span className="diff-add">+{additions}</span>}
            {deletions > 0 && <span className="diff-sub">-{deletions}</span>}
          </div>
        )}
    </Component>
  )
}

export default React.memo(ToolCallBlock, (prev, next) =>
  prev.toolCall.id === next.toolCall.id &&
  prev.toolCall.status === next.toolCall.status &&
  prev.toolCall.result === next.toolCall.result &&
  prev.toolCall.args === next.toolCall.args
)
