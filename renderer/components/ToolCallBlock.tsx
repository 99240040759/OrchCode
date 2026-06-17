import React from 'react'
import { FolderOpen, AlertCircle, ClipboardList, BookOpen, MousePointerClick, Keyboard, Camera, Loader, Search, CheckCircle, TerminalSquare, GlobeCheck } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { useSetAtom, useAtomValue } from 'jotai'
import { jsonrepair } from 'jsonrepair'
import { parse as parsePartial } from 'partial-json'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom, isDiffModeAtom } from '../store/agentStore'
import type { ToolCallEntry } from '../store/types'
import type { FileReadResult } from '../../preload/index.d'
import { getBasename } from '../lib/pathUtils'
import { workspaceService } from '../services/services'
import Tooltip from './Tooltip'
import { formatTokens } from '../lib/sharedUtils'

const FILE_WRITE_TOOLS = ['write_to_file', 'multi_replace_file_content']

const FileIcon: React.FC<{ fileName: string; className?: string; size?: number }> = ({ fileName, className = '', size = 15 }) => (
  <SymbolsFileIcon fileName={fileName} autoAssign={true} width={size} height={size} className={`${className} file-icon-wrapper`} />
)

function parsePartialJson(jsonStr: string | undefined): any {
  if (!jsonStr) return null
  try { return parsePartial(jsonStr) } catch {
    try { return JSON.parse(jsonrepair(jsonStr)) } catch { return null }
  }
}

function getStreamingVal(args: Record<string, unknown> | undefined, argsDelta: string | undefined, key: string): string {
  const hasArgs = args && Object.keys(args).length > 0
  const parsed = (hasArgs ? args : null) || parsePartialJson(argsDelta) || {}
  return parsed[key] !== undefined && parsed[key] !== null ? String(parsed[key]) : ''
}

function getDiffStats(toolName: string, args: Record<string, unknown> | undefined, argsDelta: string | undefined): { added: number; removed: number } {
  let added = 0, removed = 0
  const hasArgs = args && Object.keys(args).length > 0
  const parsedArgs = (hasArgs ? args : null) || parsePartialJson(argsDelta) || {}
  if (toolName === 'write_to_file') {
    const codeContent = parsedArgs.code_content || parsedArgs.content || parsedArgs.code || parsedArgs.text || parsedArgs.data
    added = codeContent ? String(codeContent).split(/\r?\n/).length : 0
  } else if (FILE_WRITE_TOOLS.includes(toolName)) {
    const chunks = parsedArgs.replacement_chunks
    if (chunks && Array.isArray(chunks)) {
      for (const c of chunks) {
        if (c.target_content !== undefined && c.target_content !== null) removed += String(c.target_content) === '' ? 0 : String(c.target_content).split(/\r?\n/).length
        if (c.replacement_content !== undefined && c.replacement_content !== null) added += String(c.replacement_content) === '' ? 0 : String(c.replacement_content).split(/\r?\n/).length
      }
    }
  }
  return { added, removed }
}

function getToolDisplay(toolName: string, args: Record<string, unknown> | undefined, status?: 'pending' | 'complete' | 'error', argsDelta?: string, result?: unknown): {
  operation: string; target: string; suffix?: React.ReactNode; fullPath: string | null; isFile: boolean
} {
  const isErr = status === 'error', isComp = status === 'complete'
  if (FILE_WRITE_TOOLS.includes(toolName)) {
    const path = getStreamingVal(args, argsDelta, 'target_file') || getStreamingVal(args, argsDelta, 'path') || getStreamingVal(args, argsDelta, 'file_path') || getStreamingVal(args, argsDelta, 'absolute_path')
    const { added, removed } = status !== 'pending' ? getDiffStats(toolName, args, argsDelta) : { added: 0, removed: 0 }
    const targetName = getBasename(path)
    const op = toolName === 'write_to_file' ? (isComp ? 'Created' : isErr ? 'Failed to create' : 'Creating') : (isComp ? 'Edited' : isErr ? 'Failed to edit' : 'Editing')
    const suffix = (added || removed) ? (
      <span className="diff-stats">
        {added > 0 && <span className="diff-add">+{added}</span>}
        {removed > 0 && <span className="diff-sub">-{removed}</span>}
      </span>
    ) : undefined
    return { operation: op, target: targetName, suffix, fullPath: path || null, isFile: true }
  }
  if (toolName === 'view_file') {
    const path = getStreamingVal(args, argsDelta, 'absolute_path') || getStreamingVal(args, argsDelta, 'path') || getStreamingVal(args, argsDelta, 'file_path') || getStreamingVal(args, argsDelta, 'target_file')
    const startArg = getStreamingVal(args, argsDelta, 'start_line')
    const endArg = getStreamingVal(args, argsDelta, 'end_line')
    let res = result as any
    if (typeof res === 'string') { try { res = JSON.parse(res) } catch {} }
    let textOutput = typeof res?.content === 'string' ? res.content : (res?.value?.find((v: any) => v.type === 'text')?.text || (typeof res === 'string' ? res : ''))
    const isBinary = res?.isBinary || textOutput.startsWith('[Binary File') || textOutput.startsWith('Binary image') || textOutput.startsWith('Successfully analyzed binary image')
    let extractedStart = res?.readStart !== undefined ? String(res.readStart) : ''
    let extractedEnd = res?.readEnd !== undefined ? String(res.readEnd) : ''
    if (textOutput) {
      const metaMatch = textOutput.match(/^\[METADATA: readStart=(\d+),\s*readEnd=(\d+)\]/)
      if (metaMatch) {
        if (!extractedStart) extractedStart = metaMatch[1]
        if (!extractedEnd) extractedEnd = metaMatch[2]
      }
    }
    if (!extractedStart && !extractedEnd && textOutput && !isBinary) {
      const trimmed = textOutput.trim()
      const firstLineMatch = trimmed.match(/^(\d+):/)
      if (firstLineMatch) extractedStart = firstLineMatch[1]
      const lines = trimmed.split('\n')
      const lastLineMatch = lines[lines.length - 1]?.trim().match(/^(\d+):/)
      if (lastLineMatch) extractedEnd = lastLineMatch[1]
    }
    const start = startArg || extractedStart
    const end = endArg || extractedEnd
    const lineSuffix = !isBinary && (start || end) ? `#L${start || '1'}${end ? `-${end}` : ''}` : ''
    const suffix = lineSuffix ? <span className="tool-call-suffix">{lineSuffix}</span> : undefined
    const targetName = getBasename(path)
    return { operation: isComp ? 'Viewed' : isErr ? 'Failed to view' : 'Viewing', target: targetName, suffix, fullPath: path || null, isFile: true }
  }
  if (toolName === 'list_dir') {
    const path = getStreamingVal(args, argsDelta, 'directory_path') || getStreamingVal(args, argsDelta, 'path')
    return { operation: isComp ? 'Listed' : isErr ? 'Failed to list' : 'Listing', target: getBasename(path), fullPath: null, isFile: false }
  }

  if (toolName === 'search_workspace') return { operation: isComp ? 'Searched' : isErr ? 'Failed to search' : 'Searching', target: getStreamingVal(args, argsDelta, 'query').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'search_web') return { operation: isComp ? 'Searched web' : isErr ? 'Failed to search web' : 'Searching web', target: getStreamingVal(args, argsDelta, 'query').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'browser_navigate') return { operation: isComp ? 'Navigated' : isErr ? 'Failed to navigate' : 'Navigating', target: getStreamingVal(args, argsDelta, 'url').replace(/^https?:\/\//, '').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'browser_screenshot') return { operation: isComp ? 'Captured' : isErr ? 'Failed to capture' : 'Capturing', target: 'screenshot', fullPath: null, isFile: false }
  if (toolName === 'browser_type') return { operation: isComp ? 'Typed' : isErr ? 'Failed to type' : 'Typing', target: getStreamingVal(args, argsDelta, 'selector').slice(0, 30), fullPath: null, isFile: false }
  if (toolName === 'browser_click') return { operation: isComp ? 'Clicked' : isErr ? 'Failed to click' : 'Clicking', target: (getStreamingVal(args, argsDelta, 'selector') || `${getStreamingVal(args, argsDelta, 'x')}, ${getStreamingVal(args, argsDelta, 'y')}`).slice(0, 30), fullPath: null, isFile: false }
  if (toolName === 'browser_keyboard_press') return { operation: isComp ? 'Pressed key' : isErr ? 'Failed to press key' : 'Pressing key', target: getStreamingVal(args, argsDelta, 'key'), fullPath: null, isFile: false }

  if (toolName === 'generate_image') {
    const prompt = getStreamingVal(args, argsDelta, 'prompt')
    const imgResult = result as { success: boolean; filePath: string } | undefined
    const path = isComp && imgResult?.success ? imgResult.filePath : null
    return { operation: isComp ? 'Generated image' : isErr ? 'Failed to generate image' : 'Generating image', target: prompt.length > 30 ? prompt.slice(0, 30) + '...' : prompt, fullPath: path || null, isFile: !!path }
  }
  return { operation: toolName, target: '', fullPath: null, isFile: false }
}

function renderToolIcon(toolName: string, isFile: boolean, target: string) {
  if (toolName === 'generate_image') return <Camera size={15} className="icon-blue" />
  if (toolName === 'browser_screenshot') return <Camera size={15} className="icon-blue" />
  if (toolName === 'list_dir') return <FolderOpen size={15} className="text-accent-brass flex-shrink-0" />
  if (isFile) {
    const cleanName = target.split(' ')[0]
    if (cleanName === 'implementation_plan.md') return <ClipboardList size={15} className="text-accent-purple flex-shrink-0" />
    if (cleanName === 'walkthrough.md') return <BookOpen size={15} className="text-accent-green flex-shrink-0" />
    return <FileIcon fileName={cleanName} size={15} />
  }
  switch (toolName) {
    case 'browser_navigate': return <GlobeIcon />
    case 'browser_get_page_content': return <GlobeCheck size={15} className="text-accent-purple flex-shrink-0" />
    case 'browser_type': return <Keyboard size={15} className="icon-teal" />
    case 'browser_click': return <MousePointerClick size={15} className="icon-pink" />
    case 'browser_keyboard_press': return <Keyboard size={15} className="icon-teal" />
    case 'search_workspace': return <Search size={15} className="icon-secondary" />
    case 'search_web': return <GlobeIcon />
    default: return <TerminalSquare size={15} className="icon-secondary" />
  }
}

const GlobeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-purple flex-shrink-0">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    <path d="M2 12h20" />
  </svg>
)
const ToolCallBlock: React.FC<{ toolCall: ToolCallEntry }> = ({ toolCall }) => {
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const setIsDiffMode = useSetAtom(isDiffModeAtom)

  if (toolCall.tool_name === 'summarize') {
    const saved = toolCall.args?.savedTokens as number || 0
    const total = toolCall.args?.totalTokens as number || 0
    return (
      <div className="summarize-card">
        <CheckCircle size={14} className="icon-purple" />
        <span className="summarize-title">Context Compacted</span>
        <span className="summarize-info">
          (saved {formatTokens(saved)} tokens, session: {formatTokens(total)})
        </span>
      </div>
    )
  }

  if (toolCall.tool_name === 'run_command') {
    const command = getStreamingVal(toolCall.args, toolCall.args_delta, 'command_line')
    const isPending = toolCall.status === 'pending'
    const isErr = toolCall.status === 'error'
    const isComp = toolCall.status === 'complete'

    let res = toolCall.result as any
    if (typeof res === 'string') { try { res = JSON.parse(res) } catch {} }
    let stdout = res?.stdout || ''
    let stderr = res?.stderr || res?.error || ''

    return (
      <div className="terminal-card">
        <div className="terminal-card-header">
          <TerminalSquare size={14} className="text-accent-green flex-shrink-0" />
          <span className="terminal-card-title">
            <span>{isPending ? 'Running command:' : isErr ? 'Failed to run:' : 'Ran command:'}</span>
            <code className="tool-call-command-code">{command}</code>
          </span>
          {isPending && <Loader className="animate-spin text-accent-green flex-shrink-0" size={13} />}
          {isErr && <AlertCircle size={13} className="text-accent-red flex-shrink-0" />}
        </div>
        {isPending && (
          <pre className="terminal-pre">
            {stdout || stderr || 'Executing...'}
          </pre>
        )}
        {(isComp || isErr) && (stdout || stderr) && (
          <details className="terminal-details">
            <summary className="terminal-summary">
              View terminal output
            </summary>
            <pre className={`terminal-output-pre ${isErr ? 'error' : ''}`}>
              {stdout || stderr}
            </pre>
          </details>
        )}
      </div>
    )
  }

  const { operation, target, suffix, fullPath, isFile } = getToolDisplay(toolCall.tool_name, toolCall.args, toolCall.status, toolCall.args_delta, toolCall.result)
  const isInteractive = isFile && toolCall.status === 'complete'
  const handleClick = async () => {
    if (!isInteractive || !fullPath) return
    const clickThreadId = activeThreadId
    try {
      const fileData = await workspaceService.readFile(fullPath, clickThreadId) as FileReadResult
      if (fileData && clickThreadId === activeThreadId) {
        setIsDiffMode(FILE_WRITE_TOOLS.includes(toolCall.tool_name))
        setActiveEditorFile(fileData); setArtifactPanelMode('editor'); setArtifactPanelOpen(true)
      }
    } catch (err) { console.error('[ToolCallBlock] Failed to open file:', err) }
  }

  const Component = (isInteractive ? 'button' : 'div') as React.ElementType
  return (
    <div className="tool-call-block-container">
      <Tooltip content={isInteractive ? `Open ${fullPath}` : undefined}>
        <Component
          onClick={isInteractive ? handleClick : undefined}
          className={`tool-call-wrapper ${isInteractive ? 'tool-call-interactive' : 'tool-call-non-interactive'}`}
        >
          <span className="muted-text">{operation}</span>
          <span className="icon-wrapper tool-call-icon-wrapper">
            {renderToolIcon(toolCall.tool_name, isFile, target)}
          </span>
          <span className="target-text tool-call-target-text">
            {target}
            {suffix}
          </span>
          {toolCall.status === 'pending' && <Loader className="animate-spin text-secondary" size={11} />}
          {toolCall.status === 'error' && <AlertCircle size={12} className="text-accent-red flex-shrink-0" />}
          {toolCall.status === 'complete' && toolCall.result && typeof toolCall.result === 'object' && Array.isArray((toolCall.result as any).syntaxErrors) && (toolCall.result as any).syntaxErrors.length > 0 && (
            <Tooltip content={`File contains ${(toolCall.result as any).syntaxErrors.length} syntax warnings`}>
              <span className="syntax-warning-badge">
                <AlertCircle size={12} className="text-accent-brass flex-shrink-0" />
              </span>
            </Tooltip>
          )}
        </Component>
      </Tooltip>
    </div>
  )
}

export default ToolCallBlock
