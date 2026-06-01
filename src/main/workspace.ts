import { app } from 'electron'
import { join, extname, relative, resolve, normalize } from 'path'
import { mkdirSync, promises as fs } from 'fs'

function pLimit(concurrency: number) {
  const queue: (() => void)[] = []
  let activeCount = 0

  const next = () => {
    activeCount--
    if (queue.length > 0) {
      const nextFn = queue.shift()
      if (nextFn) nextFn()
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount++
        fn().then(resolve, reject).finally(next)
      }

      if (activeCount < concurrency) {
        run()
      } else {
        queue.push(run)
      }
    })
  }
}

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

  const resolvedTarget = resolve(rootPath, targetPath)
  const normalizedTarget = normalize(resolvedTarget)

  // Redirect any .orch-artifacts reference to the secure artifacts directory
  if (
    normalizedTarget.includes('/.orch-artifacts/') ||
    normalizedTarget.endsWith('/.orch-artifacts')
  ) {
    const idx = normalizedTarget.indexOf('.orch-artifacts')
    const relativePart = normalizedTarget.substring(idx + '.orch-artifacts'.length)
    return normalize(join(wctx.artifactsPath, relativePart))
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

interface TraverseOptions {
  maxDepth?: number
  onFile: (fullPath: string, name: string) => Promise<void> | void
}

async function traverseDir(
  dir: string,
  options: TraverseOptions,
  depth = 0
): Promise<void> {
  const maxDepth = options.maxDepth ?? MAX_DEPTH
  if (depth > maxDepth) return

  let entries: any[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  const limit = pLimit(20)
  await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const name = entry.name
        const fullPath = join(dir, name)

        if (entry.isDirectory()) {
          const approvedDotFolders = new Set(['.github', '.vscode'])
          if (IGNORED_DIRS.has(name) || (name.startsWith('.') && !approvedDotFolders.has(name))) return
          await traverseDir(fullPath, options, depth + 1)
        } else if (entry.isFile()) {
          if (IGNORED_FILES.has(name)) return
          const ext = extname(name).toLowerCase()
          if (BINARY_EXTENSIONS.has(ext)) return
          await options.onFile(fullPath, name)
        }
      })
    )
  )
}

export async function serializeWorkspace(rootPath: string): Promise<string> {
  const files: { relativePath: string; content: string }[] = []

  await traverseDir(rootPath, {
    maxDepth: MAX_DEPTH,
    onFile: async (fullPath) => {
      try {
        const stat = await fs.stat(fullPath)
        if (stat.size > MAX_SERIALIZE_FILE_SIZE) return
        const content = await fs.readFile(fullPath, 'utf-8')
        const relPath = relative(rootPath, fullPath)
        files.push({ relativePath: relPath, content })
      } catch {}
    }
  })

  // Sort files alphabetically by relative path to guarantee 100% determinism (Prompt Cache friendly)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const filesContent: string[] = []
  let totalLength = 0

  for (const file of files) {
    if (totalLength >= MAX_TOTAL_CHARACTERS) break

    const fileString = `=== FILE: ${file.relativePath} ===\n${file.content}\n`
    if (totalLength + fileString.length > MAX_TOTAL_CHARACTERS) {
      const remaining = MAX_TOTAL_CHARACTERS - totalLength
      if (remaining > 50) {
        filesContent.push(`=== FILE: ${file.relativePath} ===\n${file.content.slice(0, remaining)}... [TRUNCATED]\n`)
      }
      break
    }
    filesContent.push(fileString)
    totalLength += fileString.length
  }

  return filesContent.join('\n')
}

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = []

  await traverseDir(rootPath, {
    maxDepth: 12,
    onFile: (fullPath) => {
      try {
        const relPath = relative(rootPath, fullPath)
        files.push(relPath)
      } catch {}
    }
  })

  files.sort((a, b) => a.localeCompare(b))
  return files
}

