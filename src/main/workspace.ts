import { app } from 'electron'
import { join, extname, relative, resolve, normalize, sep, isAbsolute } from 'node:path'
import { promises as fs, existsSync, readFileSync } from 'node:fs'
import Bottleneck from 'bottleneck'
import ignore, { type Ignore } from 'ignore'
import mime from 'mime-types'

// Correct TypeScript/TSX mime types — override default MPEG-TS video mapping
mime.types['ts'] = 'application/typescript'
mime.types['tsx'] = 'application/typescript'

const traverseLimiter = new Bottleneck({ maxConcurrent: 20, minTime: 0 })

export interface WorkspaceContext {
  conversationId: string
  rootPath: string
  artifactsPath: string
  isUserWorkspace: boolean
}

const workspaceRegistry = new Map<string, WorkspaceContext>()
const initPromises = new Map<string, Promise<WorkspaceContext>>()

function validateConversationId(conversationId: string) {
  if (!conversationId || typeof conversationId !== 'string' || !/^[a-zA-Z0-9-_]+$/.test(conversationId)) {
    throw new Error(`Invalid conversationId format: ${conversationId}`)
  }
}

export async function getOrCreateWorkspaceContext(
  conversationId: string,
  userSelectedPath?: string
): Promise<WorkspaceContext> {
  validateConversationId(conversationId)
  if (workspaceRegistry.has(conversationId)) {
    return workspaceRegistry.get(conversationId)!
  }

  if (initPromises.has(conversationId)) {
    return initPromises.get(conversationId)!
  }

  const promise = (async () => {
    try {
      const isUserWorkspace = !!userSelectedPath
      const rootPath =
        userSelectedPath ?? join(app.getPath('userData'), 'conversations', conversationId)

      const artifactsPath = join(rootPath, '.orch-artifacts')

      await fs.mkdir(rootPath, { recursive: true })
      if (isUserWorkspace) {
        await fs.mkdir(artifactsPath, { recursive: true })
      }

      const ctx: WorkspaceContext = { conversationId, rootPath, artifactsPath, isUserWorkspace }
      workspaceRegistry.set(conversationId, ctx)
      return ctx
    } finally {
      initPromises.delete(conversationId)
    }
  })()

  initPromises.set(conversationId, promise)
  return promise
}

export function getWorkspaceContext(conversationId: string): WorkspaceContext | undefined {
  validateConversationId(conversationId)
  return workspaceRegistry.get(conversationId)
}

export async function updateWorkspacePath(
  conversationId: string,
  newPath: string
): Promise<WorkspaceContext> {
  validateConversationId(conversationId)
  const artifactsPath = join(newPath, '.orch-artifacts')

  await fs.mkdir(newPath, { recursive: true })
  await fs.mkdir(artifactsPath, { recursive: true })

  const ctx: WorkspaceContext = {
    conversationId,
    rootPath: newPath,
    artifactsPath,
    isUserWorkspace: true
  }
  workspaceRegistry.set(conversationId, ctx)
  return ctx
}

/**
 * Validates that targetPath is inside rootPath.
 * Handles both absolute paths and relative paths correctly on Windows and macOS.
 */
export function assertWithinWorkspace(
  rootPath: string,
  targetPath: string,
  _conversationId?: string
): string {
  // Resolve root to an absolute normalised path with trailing sep
  const normalizedRoot = normalize(resolve(rootPath)) + sep

  // If targetPath is already absolute, resolve it directly.
  // If it's relative (or has leading slash stripped), join with root first.
  const resolvedTarget = normalize(
    isAbsolute(targetPath) ? resolve(targetPath) : resolve(rootPath, targetPath)
  )

  const isWindows = process.platform === 'win32'
  const rootCompare = isWindows ? normalizedRoot.toLowerCase() : normalizedRoot
  const targetCompare = isWindows ? resolvedTarget.toLowerCase() : resolvedTarget

  // Allow exact match (target === root) or target is inside root
  const rootWithoutSep = rootCompare.slice(0, -1)
  if (targetCompare !== rootWithoutSep && !targetCompare.startsWith(rootCompare)) {
    throw new Error(
      `Path traversal blocked: "${targetPath}" resolves outside workspace root "${rootPath}".`
    )
  }

  return resolvedTarget
}

// ─── Binary File Detection (shared single source of truth) ───────────────────

const BINARY_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/octet-stream',
  'application/zip',
  'application/x-tar',
  'application/pdf'
]

const TEXT_MIME_PREFIXES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript'
]

export function getMimeType(filePath: string): string {
  return mime.lookup(filePath) || 'application/octet-stream'
}

export function isFileBinary(filePath: string, buf: Buffer): boolean {
  const detectedMime = getMimeType(filePath)
  if (TEXT_MIME_PREFIXES.some((p) => detectedMime.startsWith(p))) return false
  if (BINARY_MIME_PREFIXES.some((p) => detectedMime.startsWith(p))) return true
  // Fallback: null-byte scan for unknown mime types
  return buf.subarray(0, 512).includes(0x00)
}

// ─── HTML Escaping ────────────────────────────────────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Workspace File Tree ──────────────────────────────────────────────────────

const DEFAULT_IGNORED_DIRS = ['.git', '.orch-artifacts', '.gemini', 'node_modules']
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.mp4', '.zip', '.gz', '.tar', '.exe', '.dll',
  '.sqlite', '.db', '.bin', '.wasm'
])

interface TraverseOptions {
  onFile: (fullPath: string, name: string, sizeBytes: number) => Promise<void> | void
}

function buildIgnore(rootPath: string): Ignore {
  const ig = ignore().add(DEFAULT_IGNORED_DIRS)
  try {
    const gitignorePath = join(rootPath, '.gitignore')
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8')
      ig.add(content)
    }
  } catch {}
  return ig
}

async function traverseDir(
  dir: string,
  options: TraverseOptions,
  ig: Ignore,
  rootPath: string
): Promise<void> {
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  const promises: Promise<void>[] = []
  for (const entry of entries) {
    const name = entry.name
    const fullPath = join(dir, name)
    let relPath = relative(rootPath, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) relPath += '/'

    if (ig.ignores(relPath)) continue

    if (entry.isDirectory()) {
      promises.push(traverseDir(fullPath, options, ig, rootPath))
    } else if (entry.isFile()) {
      const ext = extname(name).toLowerCase()
      if (BINARY_EXTENSIONS.has(ext)) continue
      promises.push(
        traverseLimiter.schedule(async () => {
          try {
            const stat = await fs.stat(fullPath)
            await options.onFile(fullPath, name, stat.size)
          } catch {}
        })
      )
    }
  }
  await Promise.all(promises)
}

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = []
  const ig = buildIgnore(rootPath)

  await traverseDir(
    rootPath,
    {
      onFile: (fullPath) => {
        try {
          const relPath = relative(rootPath, fullPath).replace(/\\/g, '/')
          files.push(relPath)
        } catch {}
      }
    },
    ig,
    rootPath
  )

  files.sort((a, b) => a.localeCompare(b))
  return files
}
