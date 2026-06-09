import { join, extname, relative, resolve, normalize, sep, isAbsolute, dirname } from 'node:path'
import { promises as fs, existsSync, readFileSync, realpathSync } from 'node:fs'
import ignore, { type Ignore } from 'ignore'
import mime from 'mime-types'
import fg from 'fast-glob'
import { getConversationPath } from './paths'
import { getUserSkillsPath } from './skills'

Object.assign(mime.types, { ts: 'application/typescript', tsx: 'application/typescript', kt: 'text/x-kotlin', kts: 'text/x-kotlin', gradle: 'text/x-groovy', properties: 'text/x-properties', env: 'text/plain', gitignore: 'text/plain', editorconfig: 'text/plain' })

import type { WorkspaceContext } from '../preload/types'

const workspaceRegistry = new Map<string, WorkspaceContext>()
const initPromises = new Map<string, Promise<WorkspaceContext>>()

const validateConversationId = (id: string) => { if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9-_]+$/.test(id)) throw new Error(`Invalid id: ${id}`) }

export async function getOrCreateWorkspaceContext(conversationId: string, userSelectedPath?: string): Promise<WorkspaceContext> {
  validateConversationId(conversationId)
  if (workspaceRegistry.has(conversationId)) return workspaceRegistry.get(conversationId)!
  if (initPromises.has(conversationId)) return initPromises.get(conversationId)!
  const promise = (async () => {
    try {
      const isUserWorkspace = !!userSelectedPath, rootPath = userSelectedPath ?? getConversationPath(conversationId)
      const artifactsPath = join(getConversationPath(conversationId), 'artifacts')
      await fs.mkdir(rootPath, { recursive: true })
      await fs.mkdir(artifactsPath, { recursive: true })
      const ctx = { conversationId, rootPath, artifactsPath, isUserWorkspace }
      workspaceRegistry.set(conversationId, ctx); return ctx
    } finally { initPromises.delete(conversationId) }
  })()
  initPromises.set(conversationId, promise); return promise
}

export function getWorkspaceContext(conversationId: string): WorkspaceContext | undefined {
  validateConversationId(conversationId); return workspaceRegistry.get(conversationId)
}

export function clearWorkspaceContext(conversationId: string): WorkspaceContext | undefined {
  validateConversationId(conversationId)
  const context = workspaceRegistry.get(conversationId)
  workspaceRegistry.delete(conversationId); initPromises.delete(conversationId)
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

export function assertWithinWorkspace(rootPath: string, targetPath: string, conversationId?: string): string {
  let resolvedTarget = normalize(isAbsolute(targetPath) ? resolve(targetPath) : resolve(rootPath, targetPath))
  if (conversationId) {
    const segs = resolvedTarget.split(/[/\\]/), artIdx = segs.indexOf('artifacts')
    if (artIdx !== -1) resolvedTarget = normalize(join(getConversationPath(conversationId), 'artifacts', segs.slice(artIdx + 1).join(sep)))
  }
  const isAllowed = isWithin(rootPath, resolvedTarget) || isWithin(getUserSkillsPath(), resolvedTarget) || (conversationId ? isWithin(getConversationPath(conversationId), resolvedTarget) : false)
  if (!isAllowed) throw new Error(`Path traversal blocked: "${targetPath}" resolves outside workspace root "${rootPath}".`)
  let existingPath = resolvedTarget
  while (!existsSync(existingPath)) { const parent = dirname(existingPath); if (parent === existingPath) break; existingPath = parent }
  const realExisting = realpathSync(existingPath)
  const isRealAllowed = isWithin(realpathSync(resolve(rootPath)), realExisting) || isWithin(realpathSync(resolve(getUserSkillsPath())), realExisting) || (conversationId ? isWithin(realpathSync(resolve(getConversationPath(conversationId))), realExisting) : false)
  if (!isRealAllowed) throw new Error(`Symlink traversal blocked: "${targetPath}" resolves outside the workspace.`)
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

const workspaceFilesCache = new Map<string, { files: string[]; timestamp: number }>()

function getCacheKey(p: string) {
  const res = resolve(p)
  return process.platform === 'win32' ? res.toLowerCase() : res
}

export function invalidateWorkspaceFilesCache(rootPath: string): void { workspaceFilesCache.delete(getCacheKey(rootPath)) }
export function clearAllWorkspaceFilesCache(): void { workspaceFilesCache.clear() }

function buildIgnore(rootPath: string): Ignore {
  const ig = ignore()
  try {
    const gitignorePath = join(rootPath, '.gitignore')
    if (existsSync(gitignorePath)) ig.add(readFileSync(gitignorePath, 'utf8'))
  } catch {}
  return ig
}

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const resolved = resolve(rootPath), key = getCacheKey(rootPath), cached = workspaceFilesCache.get(key)
  if (cached && Date.now() - cached.timestamp < 10000) return cached.files
  const ig = buildIgnore(rootPath)
  const rawFiles = await fg('**/*', { cwd: resolved, onlyFiles: true, dot: true, ignore: DEFAULT_IGNORED_DIRS.map(d => `**/${d}/**`) })
  const files = rawFiles.filter(f => !BINARY_EXTENSIONS.has(extname(f).toLowerCase()) && !ig.ignores(f)).map(f => f.replace(/\\/g, '/'))
  files.sort((a, b) => a.localeCompare(b))
  workspaceFilesCache.set(key, { files, timestamp: Date.now() }); return files
}
