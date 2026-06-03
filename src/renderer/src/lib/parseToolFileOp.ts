/**
 * Shared utility for parsing tool call arguments into display metadata.
 * Single source of truth used by both useAgentStream.ts (for FileChangeEntry)
 * and ToolCallBlock.tsx (for display rendering).
 */

export interface ToolFileOp {
  operation: string
  target: string
  fullPath: string
  isFile: boolean
  additions: number
  deletions: number
  lineRange: string
}

export function parseToolFileOp(
  toolName: string,
  args: Record<string, unknown> | undefined | null,
  result?: unknown
): ToolFileOp {
  const a = (args ?? {}) as {
    absolutePath?: string
    startLine?: number
    endLine?: number
    targetFile?: string
    codeContent?: string
    replacementContent?: string
    replacementChunks?: Array<{ startLine?: number; endLine?: number; replacementContent?: string }>
    commandLine?: string
    query?: string
    directoryPath?: string
    url?: string
    selector?: string
    text?: string
    frameSelector?: string
    direction?: string
    amount?: number
    x?: number
    y?: number
    button?: string
  }
  const r = (result ?? {}) as {
    readStart?: number
    readEnd?: number
    totalLines?: number
    truncated?: boolean
    filename?: string
    filePath?: string
  }

  let operation = 'Ran'
  let target = 'tool'
  let fullPath = ''
  let isFile = false
  let additions = 0
  let deletions = 0
  let lineRange = ''

  // Streaming-start phase — args haven't arrived yet (args is still {})
  // Return a meaningful label so the UI can show the tool name while waiting
  const hasArgs = a && Object.keys(a).length > 0
  if (!hasArgs) {
    return {
      operation: getDefaultOperation(toolName),
      target: getDefaultTarget(toolName),
      fullPath: '',
      isFile: false,
      additions: 0,
      deletions: 0,
      lineRange: ''
    }
  }

  switch (toolName) {
    case 'viewFile':
      operation = 'Analyzed'
      fullPath = (a.absolutePath as string) ?? ''
      isFile = true
      if (a.startLine !== undefined && a.endLine !== undefined) {
        lineRange = `#L${a.startLine}-${a.endLine}`
      } else if (r.readStart !== undefined && r.readEnd !== undefined) {
        lineRange = `#L${r.readStart}-${r.readEnd}`
      } else if (r.totalLines !== undefined) {
        if (r.truncated) {
          lineRange = `#L1-800 (truncated)`
        } else {
          lineRange = `#L1-${r.totalLines}`
        }
      }
      break

    case 'writeToFile':
      operation = 'Created'
      fullPath = (a.targetFile as string) ?? ''
      isFile = true
      if (a.codeContent) additions = (a.codeContent as string).split('\n').length
      break

    case 'replaceFileContent':
      operation = 'Edited'
      fullPath = (a.targetFile as string) ?? ''
      isFile = true
      if (a.startLine !== undefined && a.endLine !== undefined) {
        deletions = (a.endLine as number) - (a.startLine as number) + 1
      }
      if (a.replacementContent) additions = (a.replacementContent as string).split('\n').length
      break

    case 'multiReplaceFileContent':
      operation = 'Edited chunks in'
      fullPath = (a.targetFile as string) ?? ''
      isFile = true
      if (a.replacementChunks && Array.isArray(a.replacementChunks)) {
        additions = a.replacementChunks.reduce(
          (acc: number, c) =>
            acc + (c.replacementContent ? c.replacementContent.split('\n').length : 0),
          0
        )
        deletions = a.replacementChunks.reduce(
          (acc: number, c) => acc + ((c.endLine || 0) - (c.startLine || 0) + 1),
          0
        )
      }
      break

    case 'runCommand':
      operation = 'Ran command'
      target = (a.commandLine as string) ?? ''
      break

    case 'searchWeb':
      operation = 'Searched web'
      target = (a.query as string) ?? ''
      break

    case 'searchWorkspace':
      operation = 'Searched workspace for'
      target = (a.query as string) ?? ''
      break

    case 'listDir':
      operation = 'Listed'
      target = (a.directoryPath as string) || 'workspace root'
      break

    case 'browserNavigate':
      operation = 'Navigated browser to'
      target = (a.url as string) ?? ''
      break

    case 'browserType': {
      operation = 'Typed in browser'
      const typeLabel =
        a.selector && a.text ? `${a.selector} ➔ "${a.text}"` : (a.selector ?? '')
      target = a.frameSelector ? `[Frame: ${a.frameSelector}] ${typeLabel}` : typeLabel
      break
    }

    case 'browserScroll':
      operation = 'Scrolled browser'
      target = `${a.direction} by ${a.amount || 400}px`
      break

    case 'browserMouseClickCoordinate':
      operation = 'Clicked coordinate'
      target = `(${a.x}, ${a.y}) using ${a.button || 'left'}`
      break

    case 'browserScreenshot':
      operation = 'Captured screenshot'
      target = r.filename ?? 'viewport'
      if (r.filePath) {
        fullPath = r.filePath.replace('file://', '')
        isFile = true
      }
      break

    default:
      operation = 'Ran'
      target = toolName
  }

  // For file ops (except screenshots), derive display target from file name
  if (isFile && toolName !== 'browserScreenshot') {
    target = fullPath.split(/[/\\]/).pop() ?? fullPath
  }

  return { operation, target, fullPath, isFile, additions, deletions, lineRange }
}

/** Human-readable operation label for a tool name (before args arrive) */
function getDefaultOperation(toolName: string): string {
  const MAP: Record<string, string> = {
    viewFile: 'Reading',
    writeToFile: 'Writing',
    replaceFileContent: 'Editing',
    multiReplaceFileContent: 'Editing',
    runCommand: 'Running command',
    searchWeb: 'Searching web',
    searchWorkspace: 'Searching workspace',
    listDir: 'Listing directory',
    browserNavigate: 'Navigating to',
    browserType: 'Typing in browser',
    browserScroll: 'Scrolling browser',
    browserMouseClickCoordinate: 'Clicking',
    browserScreenshot: 'Taking screenshot'
  }
  return MAP[toolName] ?? 'Running'
}

/** Human-readable target label for a tool name (before args arrive) */
function getDefaultTarget(toolName: string): string {
  const MAP: Record<string, string> = {
    viewFile: 'file…',
    writeToFile: 'file…',
    replaceFileContent: 'file…',
    multiReplaceFileContent: 'file…',
    runCommand: 'command…',
    searchWeb: 'web…',
    searchWorkspace: 'workspace…',
    listDir: 'directory…',
    browserNavigate: 'page…',
    browserType: 'element…',
    browserScroll: 'page…',
    browserMouseClickCoordinate: 'coordinate…',
    browserScreenshot: 'viewport'
  }
  return MAP[toolName] ?? toolName
}
/**
 * Determines whether a tool result represents an error condition.
 * Checks multiple common error shapes to avoid silent failures.
 */
export function isToolResultError(result: unknown): boolean {
  if (result == null) return false

  if (typeof result === 'string') {
    const lower = result.toLowerCase()
    return (
      lower.startsWith('error') ||
      lower.includes('error:') ||
      lower.includes('failed:') ||
      lower.includes('traversal blocked') ||
      lower.includes('exception:')
    )
  }

  if (typeof result === 'object' && result !== null) {
    const r = result as { error?: unknown; success?: boolean; type?: string; message?: string }
    if ('error' in r && r.error) return true
    if (r.success === false) return true
    if (r.type === 'error-text' || r.type === 'error-json') return true
    if (typeof r.message === 'string' && r.message.toLowerCase().startsWith('error')) return true
  }

  return false
}
