import { app } from 'electron'
import { join, extname, relative } from 'path'
import { mkdirSync, promises as fs } from 'fs'

let activeConversationId: string = ''

export function setActiveConversationId(id: string) {
  activeConversationId = id
}

export function getActiveConversationId(): string {
  return activeConversationId
}

export interface WorkspaceContext {
  conversationId: string
  rootPath: string
  artifactsPath: string
  isUserWorkspace: boolean
}

const workspaceRegistry = new Map<string, WorkspaceContext>()

export function getOrCreateWorkspaceContext(
  conversationId: string,
  userSelectedPath?: string
): WorkspaceContext {
  if (workspaceRegistry.has(conversationId)) {
    return workspaceRegistry.get(conversationId)!
  }

  const isUserWorkspace = !!userSelectedPath
  const rootPath = userSelectedPath ?? join(app.getPath('userData'), 'conversations', conversationId)
  const artifactsPath = join(app.getPath('userData'), 'conversations', conversationId, '.orch-artifacts')

  mkdirSync(rootPath, { recursive: true })
  mkdirSync(artifactsPath, { recursive: true })

  const ctx: WorkspaceContext = { conversationId, rootPath, artifactsPath, isUserWorkspace }
  workspaceRegistry.set(conversationId, ctx)
  return ctx
}

export function getWorkspaceContext(conversationId: string): WorkspaceContext | undefined {
  return workspaceRegistry.get(conversationId)
}

export function updateWorkspacePath(conversationId: string, newPath: string): WorkspaceContext {
  const artifactsPath = join(app.getPath('userData'), 'conversations', conversationId, '.orch-artifacts')
  mkdirSync(newPath, { recursive: true })
  mkdirSync(artifactsPath, { recursive: true })

  const ctx: WorkspaceContext = {
    conversationId,
    rootPath: newPath,
    artifactsPath,
    isUserWorkspace: true
  }
  workspaceRegistry.set(conversationId, ctx)
  return ctx
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', '.orch-artifacts', 'build', '.next', '.nuxt', '.cache',
  '__pycache__', 'venv', '.venv', 'target', 'vendor', '.svelte-kit', 'coverage', '.nyc_output',
  'storybook-static', '.gemini'
])
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp4', '.zip',
  '.gz', '.tar', '.exe', '.dll', '.sqlite', '.db'
])
const IGNORED_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'])
const MAX_SERIALIZE_FILE_SIZE = 100 * 1024
const MAX_TOTAL_CHARACTERS = 400_000
const MAX_DEPTH = 6

export function isBinaryBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 512).includes(0x00)
}

export async function serializeWorkspace(rootPath: string): Promise<string> {
  const filesContent: string[] = []
  let totalLength = 0

  async function traverse(dir: string, depth: number) {
    if (totalLength >= MAX_TOTAL_CHARACTERS || depth > MAX_DEPTH) return

    let entries: any[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (totalLength >= MAX_TOTAL_CHARACTERS) break

      const name = entry.name
      const fullPath = join(dir, name)

      if (entry.isDirectory()) {
        const approvedDotFolders = new Set(['.github', '.vscode'])
        if (IGNORED_DIRS.has(name) || (name.startsWith('.') && !approvedDotFolders.has(name))) continue
        await traverse(fullPath, depth + 1)
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(name)) continue

        const ext = extname(name).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) continue

        try {
          const stat = await fs.stat(fullPath)
          if (stat.size > MAX_SERIALIZE_FILE_SIZE) continue

          const content = await fs.readFile(fullPath, 'utf-8')
          const relPath = relative(rootPath, fullPath)
          const fileString = `=== FILE: ${relPath} ===\n${content}\n`

          if (totalLength + fileString.length > MAX_TOTAL_CHARACTERS) {
            const remaining = MAX_TOTAL_CHARACTERS - totalLength
            if (remaining > 50) {
              filesContent.push(`=== FILE: ${relPath} ===\n${content.slice(0, remaining)}... [TRUNCATED]\n`)
              totalLength = MAX_TOTAL_CHARACTERS
            }
            break
          }

          filesContent.push(fileString)
          totalLength += fileString.length
        } catch {
        }
      }
    }
  }

  try {
    await traverse(rootPath, 0)
  } catch {
  }

  return filesContent.join('\n')
}
