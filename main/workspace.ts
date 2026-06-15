import { join, extname, relative, resolve, normalize, sep, isAbsolute, dirname, basename } from 'node:path'
import { promises as fs, existsSync, readFileSync, realpathSync } from 'node:fs'
import ignore, { type Ignore } from 'ignore'
import mime from 'mime-types'
import fg from 'fast-glob'
import { getConversationPath } from './utils'

Object.assign(mime.types, { ts: 'application/typescript', tsx: 'application/typescript', kt: 'text/x-kotlin', kts: 'text/x-kotlin', gradle: 'text/x-groovy', properties: 'text/x-properties', env: 'text/plain', gitignore: 'text/plain', editorconfig: 'text/plain' })

import type { WorkspaceContext } from '../preload/types'

const workspaceRegistry = new Map<string, WorkspaceContext>()
const initPromises = new Map<string, Promise<WorkspaceContext>>()
const workspaceLastAccess = new Map<string, number>()
const activeStreams = new Set<string>()
const MAX_WORKSPACES = 10
export function markWorkspaceActive(conversationId: string): void { activeStreams.add(conversationId) }
export function markWorkspaceIdle(conversationId: string): void { activeStreams.delete(conversationId) }

const validateConversationId = (id: string) => { if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9-_]+$/.test(id)) throw new Error(`Invalid id: ${id}`) }



function evictOldestWorkspace(): void {
  if (workspaceRegistry.size <= MAX_WORKSPACES) return
  const inactive = Array.from(workspaceLastAccess.entries()).filter(([id]) => !activeStreams.has(id)).sort((a, b) => a[1] - b[1])
  if (inactive.length > 0) {
    const [oldestId] = inactive[0]
    workspaceRegistry.delete(oldestId)
    workspaceLastAccess.delete(oldestId)
    initPromises.delete(oldestId)
  }
}
export async function getOrCreateWorkspaceContext(conversationId: string, userSelectedPath?: string): Promise<WorkspaceContext> {
  validateConversationId(conversationId)
  if (workspaceRegistry.has(conversationId)) { workspaceLastAccess.set(conversationId, Date.now()); return workspaceRegistry.get(conversationId)! }
  if (initPromises.has(conversationId)) return initPromises.get(conversationId)!
  evictOldestWorkspace()
  const promise = (async () => {
    const isUserWorkspace = !!userSelectedPath, rootPath = userSelectedPath ?? getConversationPath(conversationId)
    const artifactsPath = join(getConversationPath(conversationId), 'artifacts')
    await fs.mkdir(rootPath, { recursive: true })
    await fs.mkdir(artifactsPath, { recursive: true })
    const ctx = { conversationId, rootPath, artifactsPath, isUserWorkspace }
    workspaceRegistry.set(conversationId, ctx)
    workspaceLastAccess.set(conversationId, Date.now())
    initPromises.delete(conversationId)
    return ctx
  })()
  initPromises.set(conversationId, promise)
  return promise
}

export function getWorkspaceContext(conversationId: string): WorkspaceContext | undefined {
  validateConversationId(conversationId)
  if (workspaceRegistry.has(conversationId)) workspaceLastAccess.set(conversationId, Date.now())
  return workspaceRegistry.get(conversationId)
}

export function clearWorkspaceContext(conversationId: string): WorkspaceContext | undefined {
  validateConversationId(conversationId)
  const context = workspaceRegistry.get(conversationId)
  workspaceRegistry.delete(conversationId); initPromises.delete(conversationId); workspaceLastAccess.delete(conversationId)
  return context
}

export async function updateWorkspacePath(conversationId: string, newPath: string): Promise<WorkspaceContext> {
  validateConversationId(conversationId)
  if (!isAbsolute(newPath)) throw new Error('Workspace path must be absolute.')
  const stat = await fs.stat(newPath)
  if (!stat.isDirectory()) throw new Error('Workspace path must point to a directory.')
  const artifactsPath = join(getConversationPath(conversationId), 'artifacts')
  await fs.mkdir(artifactsPath, { recursive: true })
  const ctx = { conversationId, rootPath: newPath, artifactsPath, isUserWorkspace: true }
  workspaceRegistry.set(conversationId, ctx); return ctx
}

const isWithin = (base: string, target: string) => {
  const b = resolve(base), t = resolve(target), win = process.platform === 'win32'
  const rel = relative(win ? b.toLowerCase() : b, win ? t.toLowerCase() : t)
  return !isAbsolute(rel) && !rel.startsWith('..' + sep) && rel !== '..'
}

export function assertWithinWorkspace(rootPath: string, targetPath: string): string {
  const normalizedTarget = normalize(isAbsolute(targetPath) ? targetPath : join(rootPath, targetPath))
  let resolvedTarget: string
  try { resolvedTarget = realpathSync(normalizedTarget) }
  catch (err) {
    let testPath = normalizedTarget, unresolvedSuffix = ''
    while (!existsSync(testPath)) {
      const parent = dirname(testPath)
      if (parent === testPath) { resolvedTarget = normalizedTarget; break }
      unresolvedSuffix = join(basename(testPath), unresolvedSuffix)
      testPath = parent
    }
    resolvedTarget = existsSync(testPath) ? normalize(join(realpathSync(testPath), unresolvedSuffix)) : normalizedTarget
  }
  const resolvedRoot = realpathSync(resolve(rootPath))
  if (!isWithin(resolvedRoot, resolvedTarget)) {
    throw new Error(`Path traversal blocked: "${targetPath}" resolves to "${resolvedTarget}" which is outside directory "${rootPath}".`)
  }
  return resolvedTarget
}

const BINARY_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'application/zip', 'application/x-tar', 'application/pdf']
const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript']

export function getMimeType(filePath: string): string { return mime.lookup(filePath) || 'application/octet-stream' }

export function isFileBinary(filePath: string, buf: Buffer): boolean {
  const m = getMimeType(filePath)
  if (TEXT_MIME_PREFIXES.some(p => m.startsWith(p))) return false
  if (BINARY_MIME_PREFIXES.some(p => m.startsWith(p))) return true
  return buf.subarray(0, 512).includes(0x00)
}

const DEFAULT_IGNORED_DIRS = ['.git', '.gemini', 'node_modules', 'dist', 'out', 'build', 'target', 'coverage', '.cache', '.idea', '.vscode', '.next', '.nuxt', '.venv', 'venv', 'env', '__pycache__']
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp4', '.zip', '.gz', '.tar', '.exe', '.dll', '.sqlite', '.db', '.bin', '.wasm'])

const workspaceFilesCache = new Map<string, { files: string[]; time: number }>()
const CACHE_TTL_MS = 60_000
function getCacheKey(p: string) {
  const res = resolve(p)
  return process.platform === 'win32' ? res.toLowerCase() : res
}
export function invalidateWorkspaceFilesCache(rootPath: string): void { workspaceFilesCache.delete(getCacheKey(rootPath)) }
export function clearAllWorkspaceFilesCache(): void { workspaceFilesCache.clear() }

function buildIgnore(rootPath: string): Ignore {
  const ig = ignore()
  const gitignorePath = join(rootPath, '.gitignore')
  if (existsSync(gitignorePath)) ig.add(readFileSync(gitignorePath, 'utf8'))
  return ig
}

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const resolved = resolve(rootPath), key = getCacheKey(rootPath)
  const entry = workspaceFilesCache.get(key)
  if (entry && Date.now() - entry.time < CACHE_TTL_MS) return entry.files
  workspaceFilesCache.delete(key)
  const ig = buildIgnore(rootPath)
  const rawFiles = await fg('**/*', { cwd: resolved, onlyFiles: true, dot: true, followSymbolicLinks: false, ignore: DEFAULT_IGNORED_DIRS.map(d => `**/${d}/**`) })
  const files = rawFiles.filter(f => !BINARY_EXTENSIONS.has(extname(f).toLowerCase()) && !ig.ignores(f)).map(f => f.replace(/\\/g, '/'))
  files.sort((a, b) => a.localeCompare(b))
  workspaceFilesCache.set(key, { files, time: Date.now() })
  return files
}
