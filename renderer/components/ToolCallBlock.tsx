import React from 'react'
import {
  Terminal, FolderOpen, Globe, AlertCircle, ClipboardList, BookOpen,
  MousePointerClick, Keyboard, Camera, ChevronsUpDown, FileText
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { useSetAtom, useAtomValue } from 'jotai'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom } from '../store/agentStore'
import type { ToolCallEntry } from '../store/types'
import type { FileReadResult } from '../../preload/index.d'

const FILE_WRITE_TOOLS = ['writeToFile', 'multiReplaceFileContent']

const FileIcon: React.FC<{ fileName: string; className?: string; size?: number }> = ({ fileName, className = '', size = 16 }) => (
  <SymbolsFileIcon fileName={fileName} autoAssign={true} width={size} height={size} className={`${className} file-icon-wrapper`} />
)

/**
 * Extract a string value from finalized args or streaming argsDelta JSON.
 * Handles Windows paths with escaped backslashes correctly.
 */
function getStreamingVal(args: Record<string, unknown> | undefined, argsDelta: string | undefined, key: string): string {
  if (args && args[key] !== undefined && args[key] !== null) return String(args[key])
  if (!argsDelta) return ''
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = argsDelta.match(new RegExp(`"${escapedKey}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(-?\\d+))`))
  if (!m) return ''
  if (m[2] !== undefined) return m[2]
  try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] }
}

function getDiffStats(toolName: string, args: Record<string, unknown> | undefined, argsDelta: string | undefined): string {
  let added = 0, removed = 0
  if (FILE_WRITE_TOOLS.includes(toolName) && toolName !== 'writeToFile') {
    const chunks = args?.replacementChunks as Array<{ startLine?: number | string; endLine?: number | string; replacementContent?: string }> | undefined
    if (chunks && Array.isArray(chunks)) {
      for (const c of chunks) {
        if (c.startLine !== undefined && c.endLine !== undefined) {
          const s = Number(c.startLine), e = Number(c.endLine)
          if (!isNaN(s) && !isNaN(e) && s > 0 && e >= s) removed += (e - s + 1)
        }
        if (c.replacementContent !== undefined && c.replacementContent !== null) {
          const content = String(c.replacementContent)
          added += content === '' ? 0 : content.split(/\r?\n/).length
        }
      }
    } else if (argsDelta) {
      const startMatches = [...argsDelta.matchAll(/"startLine"\s*:\s*(-?\d+)/g)]
      const endMatches = [...argsDelta.matchAll(/"endLine"\s*:\s*(-?\d+)/g)]
      for (let i = 0; i < Math.min(startMatches.length, endMatches.length); i++) {
        const s = Number(startMatches[i][1]), e = Number(endMatches[i][1])
        if (s > 0 && e >= s) removed += (e - s + 1)
      }
      const repMatches = [...argsDelta.matchAll(/"replacementContent"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
      for (const m of repMatches) {
        added += (m[1].match(/\\n/g) ?? []).length + (m[1].match(/\n/g) ?? []).length + 1
      }
    }
  }
  return (added || removed) ? ` +${added}-${removed}` : ''
}

function getToolDisplay(toolName: string, args: Record<string, unknown> | undefined, status?: 'pending' | 'complete' | 'error', argsDelta?: string, result?: unknown): {
  operation: string; target: string; fullPath: string | null; isFile: boolean
} {
  const isErr = status === 'error', isComp = status === 'complete'
  if (FILE_WRITE_TOOLS.includes(toolName)) {
    const path = getStreamingVal(args, argsDelta, 'targetFile')
    const suffix = toolName !== 'writeToFile' ? getDiffStats(toolName, args, argsDelta) : ''
    const targetName = (path.split(/[/\\]/).pop() ?? path) + suffix
    const op = toolName === 'writeToFile'
      ? (isComp ? 'Wrote' : isErr ? 'Failed to write' : 'Writing')
      : (isComp ? 'Edited' : isErr ? 'Failed to edit' : 'Editing')
    return { operation: op, target: targetName, fullPath: path || null, isFile: true }
  }
  if (toolName === 'viewFile') {
    const path = getStreamingVal(args, argsDelta, 'absolutePath')
    const start = getStreamingVal(args, argsDelta, 'startLine'), end = getStreamingVal(args, argsDelta, 'endLine')
    const suffix = start || end ? ` #L${start || '1'}${end ? `-${end}` : ''}` : ''
    return { operation: isComp ? 'Viewed' : isErr ? 'Failed to view' : 'Viewing', target: (path.split(/[/\\]/).pop() ?? path) + suffix, fullPath: path || null, isFile: true }
  }
  if (toolName === 'listDir') {
    const path = getStreamingVal(args, argsDelta, 'directoryPath')
    return { operation: isComp ? 'Listed' : isErr ? 'Failed to list' : 'Listing', target: path.split(/[/\\]/).pop() ?? path, fullPath: null, isFile: false }
  }
  if (toolName === 'searchWorkspace') return { operation: isComp ? 'Searched' : isErr ? 'Failed to search' : 'Searching', target: getStreamingVal(args, argsDelta, 'query').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'runCommand') return { operation: isComp ? 'Ran' : isErr ? 'Failed to run' : 'Running', target: getStreamingVal(args, argsDelta, 'commandLine').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'browserNavigate') return { operation: isComp ? 'Navigated' : isErr ? 'Failed to navigate' : 'Navigating', target: getStreamingVal(args, argsDelta, 'url').replace(/^https?:\/\//, '').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'browserScreenshot') return { operation: isComp ? 'Captured' : isErr ? 'Failed to capture' : 'Capturing', target: 'screenshot', fullPath: null, isFile: false }
  if (toolName === 'browserType') return { operation: isComp ? 'Typed' : isErr ? 'Failed to type' : 'Typing', target: getStreamingVal(args, argsDelta, 'selector').slice(0, 30), fullPath: null, isFile: false }
  if (toolName === 'browserScroll') return { operation: isComp ? 'Scrolled' : isErr ? 'Failed to scroll' : 'Scrolling', target: getStreamingVal(args, argsDelta, 'direction'), fullPath: null, isFile: false }
  if (toolName === 'browserMouseClickCoordinate') return { operation: isComp ? 'Clicked' : isErr ? 'Failed to click' : 'Clicking', target: `(${getStreamingVal(args, argsDelta, 'x')}, ${getStreamingVal(args, argsDelta, 'y')})`, fullPath: null, isFile: false }
  if (toolName === 'searchWeb') return { operation: isComp ? 'Searched web' : isErr ? 'Failed to search web' : 'Searching web', target: getStreamingVal(args, argsDelta, 'query').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'generateImage') {
    const prompt = getStreamingVal(args, argsDelta, 'prompt')
    const imgResult = result as { success: boolean; filePath: string } | undefined
    const path = isComp && imgResult?.success ? imgResult.filePath : null
    return { operation: isComp ? 'Generated image' : isErr ? 'Failed to generate image' : 'Generating image', target: prompt.length > 30 ? prompt.slice(0, 30) + '...' : prompt, fullPath: path || null, isFile: !!path }
  }
  return { operation: toolName, target: '', fullPath: null, isFile: false }
}

function renderToolIcon(toolName: string, isFile: boolean, target: string) {
  if (toolName === 'browserScreenshot') return <Camera size={15} className="icon-blue" />
  if (isFile) {
    const cleanName = target.split(' ')[0]
    if (cleanName === 'implementation_plan.md') return <ClipboardList size={15} className="icon-purple" />
    if (cleanName === 'walkthrough.md') return <BookOpen size={15} className="icon-green" />
    return <FileIcon fileName={cleanName} size={16} />
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
    case 'generateImage': return <Camera size={15} className="icon-blue" />
    default: return <Terminal size={15} className="icon-secondary" />
  }
}

const ToolCallBlock: React.FC<{ toolCall: ToolCallEntry }> = ({ toolCall }) => {
  const { operation, target, fullPath, isFile } = getToolDisplay(toolCall.toolName, toolCall.args, toolCall.status, toolCall.argsDelta, toolCall.result)
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
    <div className="tool-call-block-container">
      <Component onClick={isFile ? handleClick : undefined} className={`tool-call-wrapper ${isFile ? 'tool-call-interactive' : 'tool-call-non-interactive'}`} title={isFile ? `Open ${fullPath}` : undefined}>
        <span className="muted-text">{operation}</span>
        <span className="icon-wrapper">{renderToolIcon(toolCall.toolName, isFile, target)}</span>
        <span className="target-text">{target}</span>
        {toolCall.status === 'pending' && <div className="tool-call-spinner" />}
        {toolCall.status === 'error' && <AlertCircle size={14} className="icon-red" />}
      </Component>
    </div>
  )
}

export default React.memo(ToolCallBlock, (prev, next) =>
  prev.toolCall.id === next.toolCall.id &&
  prev.toolCall.status === next.toolCall.status &&
  prev.toolCall.result === next.toolCall.result &&
  prev.toolCall.args === next.toolCall.args &&
  prev.toolCall.argsDelta === next.toolCall.argsDelta  // FIXED: was missing, blocked live updates
)
