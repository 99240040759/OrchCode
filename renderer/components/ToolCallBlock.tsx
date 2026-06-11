import React from 'react'
import {
  Terminal, FolderOpen, AlertCircle, ClipboardList, BookOpen,
  MousePointerClick, Keyboard, Camera, ChevronsUpDown, Loader, Search, CheckCircle
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { useSetAtom, useAtomValue } from 'jotai'
import { jsonrepair } from 'jsonrepair'
import { parse as parsePartial } from 'partial-json'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom, isDiffModeAtom } from '../store/agentStore'
import type { ToolCallEntry } from '../store/types'
import type { FileReadResult } from '../../preload/index.d'

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
    const { added, removed } = getDiffStats(toolName, args, argsDelta)
    const targetName = path.split(/[/\\]/).pop() ?? path
    const op = toolName === 'write_to_file' ? (isComp ? 'Created' : isErr ? 'Failed to create' : 'Creating') : (isComp ? 'Edited' : isErr ? 'Failed to edit' : 'Editing')
    const suffix = (added || removed) ? (
      <span className="diff-stats" style={{ display: 'inline-flex', gap: '3px', marginLeft: '6px', fontSize: '10.5px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {added > 0 && <span className="diff-add" style={{ color: 'var(--accent-green)' }}>+{added}</span>}
        {removed > 0 && <span className="diff-sub" style={{ color: 'var(--accent-red)' }}>-{removed}</span>}
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
    const targetName = path.split(/[/\\]/).pop() ?? path
    return { operation: isComp ? 'Viewed' : isErr ? 'Failed to view' : 'Viewing', target: targetName, suffix, fullPath: path || null, isFile: true }
  }
  if (toolName === 'list_dir') {
    const path = getStreamingVal(args, argsDelta, 'directory_path') || getStreamingVal(args, argsDelta, 'path')
    return { operation: isComp ? 'Listed' : isErr ? 'Failed to list' : 'Listing', target: path.split(/[/\\]/).pop() ?? path, fullPath: null, isFile: false }
  }

  if (toolName === 'search_workspace') return { operation: isComp ? 'Searched' : isErr ? 'Failed to search' : 'Searching', target: getStreamingVal(args, argsDelta, 'query').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'search_web') return { operation: isComp ? 'Searched web' : isErr ? 'Failed to search web' : 'Searching web', target: getStreamingVal(args, argsDelta, 'query').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'browser_navigate') return { operation: isComp ? 'Navigated' : isErr ? 'Failed to navigate' : 'Navigating', target: getStreamingVal(args, argsDelta, 'url').replace(/^https?:\/\//, '').slice(0, 40), fullPath: null, isFile: false }
  if (toolName === 'browser_screenshot') return { operation: isComp ? 'Captured' : isErr ? 'Failed to capture' : 'Capturing', target: 'screenshot', fullPath: null, isFile: false }
  if (toolName === 'browser_type') return { operation: isComp ? 'Typed' : isErr ? 'Failed to type' : 'Typing', target: getStreamingVal(args, argsDelta, 'selector').slice(0, 30), fullPath: null, isFile: false }
  if (toolName === 'browser_scroll') return { operation: isComp ? 'Scrolled' : isErr ? 'Failed to scroll' : 'Scrolling', target: getStreamingVal(args, argsDelta, 'direction'), fullPath: null, isFile: false }
  if (toolName === 'browser_click_selector') return { operation: isComp ? 'Clicked' : isErr ? 'Failed to click' : 'Clicking', target: getStreamingVal(args, argsDelta, 'selector').slice(0, 30), fullPath: null, isFile: false }
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
  if (toolName === 'list_dir') return <FolderOpen size={15} style={{ color: '#e2b473' }} />
  if (isFile) {
    const cleanName = target.split(' ')[0]
    if (cleanName === 'implementation_plan.md') return <ClipboardList size={15} className="icon-purple" />
    if (cleanName === 'walkthrough.md') return <BookOpen size={15} className="icon-green" />
    return <FileIcon fileName={cleanName} size={15} />
  }
  switch (toolName) {
    case 'browser_navigate': return <GlobeIcon />
    case 'browser_type': return <Keyboard size={15} className="icon-teal" />
    case 'browser_scroll': return <ChevronsUpDown size={15} className="icon-slate" />
    case 'browser_click_selector': return <MousePointerClick size={15} className="icon-pink" />
    case 'list_dir': return <FolderOpen size={15} className="icon-secondary" />
    case 'search_workspace': return <Search size={15} className="icon-secondary" />
    case 'search_web': return <GlobeIcon />
    case 'generate_image': return <Camera size={15} className="icon-blue" />
    default: return <Terminal size={15} className="icon-secondary" />
  }
}

const GlobeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="icon-purple" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    <path d="M2 12h20" />
  </svg>
)

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

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
      <div className="terminal-card" style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        padding: '8px 12px',
        backgroundColor: 'var(--bg-sidebar)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        margin: '6px 0',
        fontSize: '11.5px',
        boxSizing: 'border-box'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0 }}>
          <Terminal size={14} style={{ color: '#4ade80', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span>{isPending ? 'Running command:' : isErr ? 'Failed to run:' : 'Ran command:'}</span>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: '#e2b473', background: 'rgba(255,255,255,0.02)', padding: '2px 4px', borderRadius: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{command}</code>
          </span>
          {isPending && <Loader className="animate-spin" size={13} style={{ color: '#4ade80', flexShrink: 0 }} />}
          {isErr && <AlertCircle size={13} className="icon-red" style={{ flexShrink: 0 }} />}
        </div>
        {isPending && (
          <pre style={{
            backgroundColor: '#0a0a0a',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: '6px',
            padding: '8px',
            fontSize: '10.5px',
            fontFamily: 'var(--font-mono)',
            color: '#4ade80',
            overflowX: 'auto',
            maxHeight: '150px',
            margin: '8px 0 0 0'
          }}>
            {stdout || stderr || 'Executing...'}
          </pre>
        )}
        {(isComp || isErr) && (stdout || stderr) && (
          <details style={{ marginTop: '6px', width: '100%' }}>
            <summary style={{ cursor: 'pointer', fontSize: '10.5px', color: 'var(--text-muted)', userSelect: 'none', outline: 'none' }}>
              View terminal output
            </summary>
            <pre style={{
              backgroundColor: '#0a0a0a',
              border: '1px solid rgba(255, 255, 255, 0.04)',
              borderRadius: '6px',
              padding: '8px',
              fontSize: '10.5px',
              fontFamily: 'var(--font-mono)',
              color: isErr ? '#ef4444' : 'var(--text-primary)',
              overflowX: 'auto',
              maxHeight: '200px',
              margin: '4px 0 0 0'
            }}>
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
      const fileData = await window.api.invoke('file:read', { filePath: fullPath, conversationId: clickThreadId }) as FileReadResult
      if (fileData && clickThreadId === activeThreadId) {
        setIsDiffMode(FILE_WRITE_TOOLS.includes(toolCall.tool_name))
        setActiveEditorFile(fileData); setArtifactPanelMode('editor'); setArtifactPanelOpen(true)
      }
    } catch (err) { console.error('[ToolCallBlock] Failed to open file:', err) }
  }

  const Component = (isInteractive ? 'button' : 'div') as React.ElementType
  return (
    <div className="tool-call-block-container" style={{ display: 'inline-flex', margin: '2px' }}>
      <Component
        onClick={isInteractive ? handleClick : undefined}
        className={`tool-call-wrapper ${isInteractive ? 'tool-call-interactive' : 'tool-call-non-interactive'}`}
        title={isInteractive ? `Open ${fullPath}` : undefined}
      >
        <span className="muted-text" style={{ fontSize: '11px', opacity: 0.8 }}>{operation}</span>
        <span className="icon-wrapper" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {renderToolIcon(toolCall.tool_name, isFile, target)}
        </span>
        <span className="target-text" style={{ fontWeight: 500, fontSize: '11px', display: 'flex', alignItems: 'center' }}>
          {target}
          {suffix}
        </span>
        {toolCall.status === 'pending' && !FILE_WRITE_TOOLS.includes(toolCall.tool_name) && <Loader className="animate-spin text-secondary" size={11} />}
        {toolCall.status === 'error' && <AlertCircle size={12} className="icon-red" />}
        {toolCall.status === 'complete' && toolCall.result && typeof toolCall.result === 'object' && Array.isArray((toolCall.result as any).syntaxErrors) && (toolCall.result as any).syntaxErrors.length > 0 && (
          <span title={`File contains ${(toolCall.result as any).syntaxErrors.length} syntax warnings`} style={{ display: 'inline-flex', marginLeft: '4px' }}>
            <AlertCircle size={12} style={{ color: '#e2b473' }} />
          </span>
        )}
      </Component>
    </div>
  )
}

export default ToolCallBlock
