import { app } from 'electron'
import { join, extname, relative, resolve, normalize, sep } from 'path'
import { promises as fs, existsSync, readFileSync } from 'fs'
import Bottleneck from 'bottleneck'
import ignore, { Ignore } from 'ignore'

const traverseLimiter = new Bottleneck({ maxConcurrent: 20, minTime: 0 })

// ─── Workspace Context ────────────────────────────────────────────────────

export interface WorkspaceContext {
  conversationId: string
  rootPath: string
  artifactsPath: string
  isUserWorkspace: boolean
}

const workspaceRegistry = new Map<string, WorkspaceContext>()

/**
 * Gets or creates a workspace context for a conversation.
 * MED-7: If a user workspace is provided, artifacts live inside it at `.orch-artifacts/`.
 * If no workspace is open, there is no artifact system — only chat.
 */
export async function getOrCreateWorkspaceContext(
  conversationId: string,
  userSelectedPath?: string
): Promise<WorkspaceContext> {
  if (workspaceRegistry.has(conversationId)) {
    return workspaceRegistry.get(conversationId)!
  }

  const isUserWorkspace = !!userSelectedPath
  const rootPath = userSelectedPath ?? join(app.getPath('userData'), 'conversations', conversationId)

  // MED-7: Artifacts always live inside the user's workspace, not in userData.
  // When no workspace is selected, artifactsPath points inside the fallback rootPath
  // but the agent system prompt won't expose it (no workspace → no artifact tools).
  const artifactsPath = join(rootPath, '.orch-artifacts')

  // CRIT-8: Use async mkdir — avoids blocking the Electron main process event loop
  await fs.mkdir(rootPath, { recursive: true })
  if (isUserWorkspace) {
    await fs.mkdir(artifactsPath, { recursive: true })
  }

  const ctx: WorkspaceContext = { conversationId, rootPath, artifactsPath, isUserWorkspace }
  workspaceRegistry.set(conversationId, ctx)
  return ctx
}

/** Synchronous lookup — never creates or blocks. */
export function getWorkspaceContext(conversationId: string): WorkspaceContext | undefined {
  return workspaceRegistry.get(conversationId)
}

/**
 * Updates the workspace path for an existing conversation context.
 * MED-7: Artifacts folder is always `.orch-artifacts` inside the new workspace root.
 * CRIT-8: Both mkdir calls are now async.
 */
export async function updateWorkspacePath(conversationId: string, newPath: string): Promise<WorkspaceContext> {
  const artifactsPath = join(newPath, '.orch-artifacts')
  // CRIT-8: Async mkdir — no longer blocks main process event loop
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

// ─── Path Security ────────────────────────────────────────────────────────

export function assertWithinWorkspace(
  rootPath: string,
  targetPath: string,
  _conversationId?: string
): string {
  const normalizedRoot = normalize(resolve(rootPath)) + sep
  const resolvedTarget = resolve(rootPath, targetPath)
  const normalizedTarget = normalize(resolvedTarget)

  // MED-7 + MED-8: The old artifact redirect block (lines 76-87 in original) is removed.
  // Since artifactsPath is now INSIDE rootPath (rootPath/.orch-artifacts/), the standard
  // workspace boundary check already covers it — no special redirect needed.
  // The Windows path-join bug (join(artifactsPath, '\relativePart') stripping base) is gone.
  if (normalizedTarget !== normalize(resolve(rootPath)) && !normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error(
      `Path traversal blocked: "${targetPath}" resolves outside workspace root "${rootPath}".`
    )
  }

  return normalizedTarget
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Workspace file tree ─────────────────────────────────────────────────

const DEFAULT_IGNORED_DIRS = ['.git', '.orch-artifacts', '.gemini', 'node_modules']
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp4', '.zip',
  '.gz', '.tar', '.exe', '.dll', '.sqlite', '.db', '.bin', '.wasm'
])

export function isBinaryBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 512).includes(0x00)
}

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
  let entries: any[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  const promises: Promise<void>[] = []
  for (const entry of entries) {
    promises.push(
      traverseLimiter.schedule(async () => {
        const name = entry.name
        const fullPath = join(dir, name)
        let relPath = relative(rootPath, fullPath).replace(/\\/g, '/')
        if (entry.isDirectory()) { relPath += '/' }

        if (ig.ignores(relPath)) return

        if (entry.isDirectory()) {
          await traverseDir(fullPath, options, ig, rootPath)
        } else if (entry.isFile()) {
          const ext = extname(name).toLowerCase()
          if (BINARY_EXTENSIONS.has(ext)) return
          try {
            const stat = await fs.stat(fullPath)
            await options.onFile(fullPath, name, stat.size)
          } catch {}
        }
      })
    )
  }
  await Promise.all(promises)
}

export async function buildWorkspaceIndex(rootPath: string): Promise<string> {
  const entries: { relativePath: string; sizeBytes: number }[] = []
  const ig = buildIgnore(rootPath)

  await traverseDir(rootPath, {
    onFile: async (fullPath, _name, sizeBytes) => {
      const relPath = relative(rootPath, fullPath).replace(/\\/g, '/')
      entries.push({ relativePath: relPath, sizeBytes })
    }
  }, ig, rootPath)

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  if (entries.length === 0) {
    return 'Workspace is empty. No files found.'
  }

  const lines = entries.map((e) => {
    const sizeStr = e.sizeBytes >= 1024
      ? `${(e.sizeBytes / 1024).toFixed(1)}KB`
      : `${e.sizeBytes}B`
    return `  ${e.relativePath} (${sizeStr})`
  })

  return `Workspace file tree (${entries.length} files):\n${lines.join('\n')}\n\nUse viewFile(absolutePath) or listDir(directoryPath) to read specific files.`
}

export async function serializeWorkspace(rootPath: string): Promise<string> {
  return buildWorkspaceIndex(rootPath)
}

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = []
  const ig = buildIgnore(rootPath)

  await traverseDir(rootPath, {
    onFile: (fullPath) => {
      try {
        const relPath = relative(rootPath, fullPath).replace(/\\/g, '/')
        files.push(relPath)
      } catch {}
    }
  }, ig, rootPath)

  files.sort((a, b) => a.localeCompare(b))
  return files
}
