
export interface StreamTool {
  toolCallId: string
  name: string
  input: Record<string, unknown>
  filePath?: string
  isFinished: boolean
  output?: string
  isError?: boolean
}
export interface StreamState {
  isLoading: boolean
  text: string
  reasoning: string
  tools: StreamTool[]
  statusNotice?: string
  error?: string
}
export interface WorkspaceFolder {
  path: string
  name: string
  associatedRemoteUrls?: string[]
  latestGitCommitHash?: string
  latestGitBranchName?: string
}
export function extractFilePath(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const inp = input as Record<string, unknown>
  const FILE_TOOLS = ['read_files', 'editor', 'apply_patch']
  const lowerName = toolName.toLowerCase()
  if (
    !FILE_TOOLS.some(
      (t) => lowerName === t || lowerName.endsWith(`_${t}`) || lowerName.startsWith(`${t}_`)
    )
  )
    return undefined

  const p = inp.path
  if (typeof p === 'string') return p

  if (Array.isArray(inp.files) && inp.files.length > 0) {
    const f0 = inp.files[0]
    if (typeof f0 === 'string') return f0
    if (f0 && typeof f0 === 'object' && typeof f0.path === 'string') return f0.path
  }
  return undefined
}
