import { app } from 'electron'
import { join, extname, relative, resolve, normalize, dirname } from 'path'
import { mkdirSync, promises as fs, realpathSync } from 'fs'
import log from 'electron-log'

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

// ─── Shared path security ──────────────────────────────────────────────────

function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const dir = dirname(filePath)
      try {
        const resolvedDir = realpathSync(dir)
        return join(resolvedDir, filePath.split(/[/\\]/).pop() ?? '')
      } catch {
        return filePath
      }
    }
    throw err
  }
}

/**
 * Validates that targetPath resolves within rootPath (or permitted system dirs).
 * Exported and shared by both index.ts and tools.ts — single implementation.
 * Throws on traversal. Returns the safe, normalised absolute path.
 */
export function assertWithinWorkspace(
  rootPath: string,
  targetPath: string,
  conversationId?: string
): string {
  const cid = conversationId || activeConversationId
  const wctx = getWorkspaceContext(cid) || getOrCreateWorkspaceContext(cid)

  const resolvedRoot = safeRealpathSync(resolve(rootPath))
  const resolvedTarget = safeRealpathSync(resolve(targetPath))
  const normalizedTarget = normalize(resolvedTarget)

  // Allow access into the conversations data dir (artifacts, screenshots, etc.)
  try {
    const conversationsRoot = join(app.getPath('userData'), 'conversations')
    const resolvedConversationsRoot = safeRealpathSync(resolve(conversationsRoot))
    if (
      normalizedTarget.startsWith(resolvedConversationsRoot + '/') ||
      normalizedTarget === resolvedConversationsRoot
    ) {
      return normalizedTarget
    }
  } catch {}

  // Redirect any .orch-artifacts reference to the secure artifacts directory
  if (
    normalizedTarget.includes('/.orch-artifacts/') ||
    normalizedTarget.endsWith('/.orch-artifacts')
  ) {
    const idx = normalizedTarget.indexOf('.orch-artifacts')
    const relativePart = normalizedTarget.substring(idx + '.orch-artifacts'.length)
    const secureRedirect = normalize(join(wctx.artifactsPath, relativePart))
    // Secondary traversal check: the redirect must land within artifactsPath (#14)
    if (
      !secureRedirect.startsWith(wctx.artifactsPath + '/') &&
      secureRedirect !== wctx.artifactsPath
    ) {
      const err = `Path traversal blocked in artifact redirect: "${targetPath}"`
      log.error(`[security] ${err}`)
      throw new Error(err)
    }
    return secureRedirect
  }

  if (!normalizedTarget.startsWith(resolvedRoot + '/') && normalizedTarget !== resolvedRoot) {
    const errorMsg = `Path traversal blocked: "${targetPath}" resolves outside workspace root: "${resolvedRoot}"`
    log.error(`[security] ${errorMsg}`)
    throw new Error(errorMsg)
  }
  return normalizedTarget
}

// ─── Workspace serialisation ──────────────────────────────────────────────

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
  let truncated = false

  async function traverse(dir: string, depth: number): Promise<void> {
    if (truncated || totalLength >= MAX_TOTAL_CHARACTERS || depth > MAX_DEPTH) return

    let entries: any[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Process all entries at this depth level concurrently (#8 fix)
    await Promise.all(
      entries.map(async (entry) => {
        if (truncated || totalLength >= MAX_TOTAL_CHARACTERS) return

        const name = entry.name
        const fullPath = join(dir, name)

        if (entry.isDirectory()) {
          const approvedDotFolders = new Set(['.github', '.vscode'])
          if (IGNORED_DIRS.has(name) || (name.startsWith('.') && !approvedDotFolders.has(name))) return
          await traverse(fullPath, depth + 1)
        } else if (entry.isFile()) {
          if (IGNORED_FILES.has(name)) return
          const ext = extname(name).toLowerCase()
          if (BINARY_EXTENSIONS.has(ext)) return

          try {
            const stat = await fs.stat(fullPath)
            if (stat.size > MAX_SERIALIZE_FILE_SIZE) return
            const content = await fs.readFile(fullPath, 'utf-8')
            const relPath = relative(rootPath, fullPath)
            const fileString = `=== FILE: ${relPath} ===\n${content}\n`

            if (totalLength + fileString.length > MAX_TOTAL_CHARACTERS) {
              const remaining = MAX_TOTAL_CHARACTERS - totalLength
              if (remaining > 50) {
                filesContent.push(`=== FILE: ${relPath} ===\n${content.slice(0, remaining)}... [TRUNCATED]\n`)
                totalLength = MAX_TOTAL_CHARACTERS
                truncated = true
              }
              return
            }

            filesContent.push(fileString)
            totalLength += fileString.length
          } catch {}
        }
      })
    )
  }

  await traverse(rootPath, 0)
  return filesContent.join('\n')
}
