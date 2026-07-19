import React from 'react'
import type { ToolUseContent, ToolResultContent } from '@cline/sdk'
import { useThreadStore } from '../lib/threadStore'
import { useShallow } from 'zustand/react/shallow'
import { TbTerminal, TbBolt, TbSearch, TbGlobe, TbHelpCircle, TbDatabase, TbFolderOpen, TbPhoto } from 'react-icons/tb'
import { FileIcon } from './FileIcon'
import { getRelativePath, getAbsolutePath } from '../../shared/pathHelpers'
function FileLinkButton({ file, displayPath, rangeSuffix = '', onFileClick, workspacePath }: { file: string; displayPath: string; rangeSuffix?: React.ReactNode; onFileClick?: (p: string) => void; workspacePath?: string }): React.JSX.Element {
  return (
    <button type="button" onClick={() => onFileClick?.(getAbsolutePath(file, workspacePath))} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors text-[13px] border border-border/40 font-medium cursor-pointer">
      <FileIcon path={file} size={14} className="flex-shrink-0 text-muted-foreground" />
      <span className="truncate max-w-[150px]">{displayPath.split(/[/\\]/).pop() || displayPath}</span>{rangeSuffix}
    </button>
  )
}
interface ToolInput {
  path?: string; paths?: string | string[]; files?: (string | { path: string; startLine?: number; endLine?: number; start_line?: number; end_line?: number; StartLine?: number; EndLine?: number })[]; commands?: (string | Record<string, unknown>)[]; query?: string; url?: string; question?: string; options?: string[]; selector?: string; owner?: string; repo?: string; pull_number?: number; issue_number?: number; element?: string; target?: string; prompt?: string; task?: string; StartLine?: number; EndLine?: number; startLine?: number; endLine?: number; start_line?: number; end_line?: number; ReplacementChunks?: Record<string, unknown>[]; old_text?: string; new_text?: string; insert_line?: number; patch?: string; input?: string
}
const FILE_READ_TOOLS = new Set(['read_files'])
const FILE_WRITE_TOOLS = new Set(['apply_patch'])
function useWorkspacePath(): string | undefined {
  return useThreadStore(useShallow((s) => {
    const session = s.sessions.find((sess) => sess.sessionId === s.currentSessionId)
    return session ? session.workspaceRoot || session.cwd || undefined : s.activeFolderPath || undefined
  }))
}
export function ToolCallDisplay({ toolUse, toolResult, filePath, onFileClick, isError: propIsError, isFinished: propIsFinished }: { toolUse: ToolUseContent; toolResult?: ToolResultContent; filePath?: string; onFileClick?: (p: string) => void; isError?: boolean; isFinished?: boolean }): React.ReactElement {
  const workspacePath = useWorkspacePath()
  const name = toolUse.name
  const n = name.toLowerCase().replace(/^[^_]+__/, '')
  const inp = toolUse.input && typeof toolUse.input === 'object' ? (toolUse.input as ToolInput) : {}
  const isFinished = propIsFinished ?? !!toolResult
  const isError = propIsError ?? !!(toolResult as ToolResultContent & { is_error?: boolean })?.is_error
  let actionText = 'Executed', isBlock = false
  let detailNode: React.ReactNode = <span className="text-foreground font-semibold">{name}</span>
  let icon: React.ReactNode = <TbBolt size={15} />
  if (n.startsWith('browser_') || n.startsWith('playwright_')) {
    actionText = 'Browser'; icon = <TbGlobe size={15} />
    const actionName = n.replace('browser_', '').replace('playwright_', '').replace(/_/g, ' ')
    if (n === 'browser_navigate' || n === 'playwright_navigate') detailNode = <span>Navigate to <span className="text-foreground font-mono font-semibold select-text">{inp.url || 'URL'}</span></span>
    else if (inp.element || inp.target || inp.selector) detailNode = <span>{actionName} <span className="text-foreground font-semibold">"{inp.element || inp.target || inp.selector}"</span></span>
    else detailNode = <span className="capitalize">{actionName}</span>
  } else if (n === 'search_web') {
    actionText = 'Searched Web'; icon = <TbGlobe size={15} />
    detailNode = <span>for <span className="text-foreground font-semibold">"{inp.query}"</span></span>
  } else if (n === 'generate_image') {
    actionText = 'Generated Image'; icon = <TbPhoto size={15} />
    detailNode = <span>with prompt <span className="text-foreground font-semibold">"{inp.prompt}"</span></span>
  } else if (FILE_READ_TOOLS.has(n) || FILE_WRITE_TOOLS.has(n)) {
    actionText = FILE_WRITE_TOOLS.has(n) ? 'Edited' : 'Read'; icon = undefined
    const files = Array.isArray(inp.files) ? inp.files : inp.path ? [inp.path] : filePath ? [filePath] : []
    if (files.length > 1) {
      isBlock = true
      detailNode = (
        <div className="flex flex-wrap gap-1.5 w-full mt-1.5">
          {files.map((f, idx) => {
            const file = typeof f === 'string' ? f : f && typeof f === 'object' ? f.path : ''
            return file ? <FileLinkButton key={idx} file={file} displayPath={getRelativePath(file, workspacePath)} onFileClick={onFileClick} workspacePath={workspacePath} /> : <React.Fragment key={idx} />
          })}
        </div>
      )
    } else {
      const f0 = files[0]
      const file = f0 ? (typeof f0 === 'string' ? f0 : f0 && typeof f0 === 'object' ? f0.path : '') : ''
      detailNode = file ? <FileLinkButton file={file} displayPath={getRelativePath(file, workspacePath)} onFileClick={onFileClick} workspacePath={workspacePath} /> : <span className="font-mono">file</span>
    }
  } else if (n === 'list_dir') {
    actionText = 'Listed Directory'; icon = <TbFolderOpen size={15} />
    detailNode = <span className="font-mono text-foreground font-semibold">{getRelativePath(inp.path ?? '', workspacePath)}</span>
  } else if (n === 'grep_search' || n === 'search_codebase') {
    actionText = 'Searched Codebase'; icon = <TbSearch size={15} />
    detailNode = <span>for <span className="text-foreground font-semibold">"{inp.query}"</span></span>
  } else if (n === 'fetch_web_content') {
    actionText = 'Fetched Web'; icon = <TbGlobe size={15} />
    detailNode = <span>url <span className="text-foreground font-semibold select-text">{inp.url}</span></span>
  } else if (n === 'skills') {
    actionText = 'Run Skill'; icon = <TbBolt size={15} />
    detailNode = <span className="text-foreground font-semibold">{inp.prompt}</span>
  } else if (n === 'run_commands') {
    actionText = 'Ran Command'; icon = <TbTerminal size={15} />
    const firstCmd = Array.isArray(inp.commands) ? inp.commands[0] : undefined
    const rawCmd = typeof firstCmd === 'string' ? firstCmd : firstCmd && typeof firstCmd === 'object' ? (firstCmd as Record<string, unknown>).command : ''
    const cmd = rawCmd ? String(rawCmd) : ''
    detailNode = <span className="text-foreground font-mono font-semibold">{cmd ? (cmd.length > 50 ? `${cmd.substring(0, 50)}...` : cmd) : 'command'}</span>
  } else if (n === 'ask_question' || n === 'ask_permission') {
    actionText = 'Asked User'; isBlock = true; icon = <TbHelpCircle size={15} />
    const options = Array.isArray(inp.options) ? inp.options : []
    detailNode = (
      <div className="flex flex-col gap-2 mt-1 w-full max-w-chat">
        <span className="text-foreground font-semibold text-sm leading-relaxed whitespace-pre-wrap select-text">{inp.question}</span>
        {!isFinished && options.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {options.map((opt, i) => <span key={i} className="px-3 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground text-xs font-semibold select-text">{opt}</span>)}
          </div>
        )}
      </div>
    )
  } else if (n.includes('sqlite') || n.includes('postgres') || n.includes('database') || n.includes('sql') || n.includes('db')) {
    actionText = 'Database'; icon = <TbDatabase size={15} />
    detailNode = <span className="text-foreground font-semibold">{name}</span>
  } else if (n === 'compact') {
    actionText = 'Compacting'; icon = <TbBolt size={15} />
    detailNode = <span>context...</span>
  }
  const spinner = !isFinished && <span className="inline-block w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin ml-1" />
  const failBadge = isFinished && isError && <span className="text-destructive font-semibold ml-1">(failed)</span>
  return isBlock ? (
    <div className={`flex flex-col gap-1 py-1.5 text-xs text-muted-foreground select-none ${!isFinished ? 'opacity-80' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span>{actionText}</span>{icon && <span className="flex-shrink-0 text-muted-foreground flex items-center">{icon}</span>}{spinner}{failBadge}
      </div>
      <div className="pl-4">{detailNode}</div>
    </div>
  ) : (
    <div className={`flex items-center gap-1.5 text-xs text-muted-foreground py-0.5 select-none ${!isFinished ? 'opacity-80' : ''}`}>
      <span>{actionText}</span>{icon && <span className="flex-shrink-0 text-muted-foreground flex items-center">{icon}</span>}{detailNode}{spinner}{failBadge}
    </div>
  )
}
