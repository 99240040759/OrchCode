import { join, extname, relative, resolve, normalize, sep, isAbsolute, dirname } from 'node:path'
import { promises as fs, existsSync, readFileSync, realpathSync } from 'node:fs'
import ignore, { type Ignore } from 'ignore'
import mime from 'mime-types'
import { getConversationPath } from './paths'
import { getUserSkillsPath } from './skills'

Object.assign(mime.types, { ts: 'application/typescript', tsx: 'application/typescript', kt: 'text/x-kotlin', kts: 'text/x-kotlin', gradle: 'text/x-groovy', properties: 'text/x-properties', env: 'text/plain', gitignore: 'text/plain', editorconfig: 'text/plain' })

export interface WorkspaceContext {
  conversationId: string; rootPath: string; artifactsPath: string; isUserWorkspace: boolean
}

const workspaceRegistry = new Map<string, WorkspaceContext>()
const initPromises = new Map<string, Promise<WorkspaceContext>>()

const validateConversationId = (id: string) => { if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9-_]+$/.test(id)) throw new Error(`Invalid id: ${id}`) }

export async function getOrCreateWorkspaceContext(conversationId: string, userSelectedPath?: string): Promise<WorkspaceContext> {
  validateConversationId(conversationId)
  if (workspaceRegistry.has(conversationId)) return workspaceRegistry.get(conversationId)!
  if (initPromises.has(conversationId)) return initPromises.get(conversationId)!
  const promise = (async () => {
    try {
      const isUserWorkspace = !!userSelectedPath, rootPath = userSelectedPath ?? getConversationPath(conversationId), artifactsPath = join(rootPath, '.orch-artifacts')
      await fs.mkdir(rootPath, { recursive: true })
      if (isUserWorkspace) await fs.mkdir(artifactsPath, { recursive: true })
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
  const artifactsPath = join(newPath, '.orch-artifacts')
  await fs.mkdir(artifactsPath, { recursive: true })
  const ctx = { conversationId, rootPath: newPath, artifactsPath, isUserWorkspace: true }
  workspaceRegistry.set(conversationId, ctx); return ctx
}

const isWithin = (base: string, target: string, isWindows: boolean) => {
  try {
    const b = normalize(resolve(base)) + sep, t = normalize(resolve(target))
    const cb = isWindows ? b.toLowerCase() : b, ct = isWindows ? t.toLowerCase() : t
    return ct === cb.slice(0, -1) || ct.startsWith(cb)
  } catch { return false }
}

export function assertWithinWorkspace(rootPath: string, targetPath: string, _conversationId?: string): string {
  const resolvedTarget = normalize(isAbsolute(targetPath) ? resolve(targetPath) : resolve(rootPath, targetPath))
  const isWindows = process.platform === 'win32'
  if (!isWithin(rootPath, resolvedTarget, isWindows) && !isWithin(getUserSkillsPath(), resolvedTarget, isWindows)) {
    throw new Error(`Path traversal blocked: "${targetPath}" resolves outside workspace root "${rootPath}".`)
  }
  let existingPath = resolvedTarget
  while (!existsSync(existingPath)) {
    const parent = dirname(existingPath)
    if (parent === existingPath) break
    existingPath = parent
  }
  const realExisting = realpathSync(existingPath)
  if (!isWithin(realpathSync(resolve(rootPath)), realExisting, isWindows) && !isWithin(realpathSync(resolve(getUserSkillsPath())), realExisting, isWindows)) {
    throw new Error(`Symlink traversal blocked: "${targetPath}" resolves outside the workspace.`)
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

const DEFAULT_IGNORED_DIRS = ['.git', '.orch-artifacts', '.gemini', 'node_modules']
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp4', '.zip', '.gz', '.tar', '.exe', '.dll', '.sqlite', '.db', '.bin', '.wasm'])

interface TraverseOptions { onFile: (fullPath: string, name: string, sizeBytes: number) => Promise<void> | void }
interface TraverseState { count: number; max: number }

const workspaceFilesCache = new Map<string, { files: string[]; timestamp: number }>()

export function invalidateWorkspaceFilesCache(rootPath: string): void { workspaceFilesCache.delete(resolve(rootPath)) }

function buildIgnore(rootPath: string): Ignore {
  const ig = ignore().add(DEFAULT_IGNORED_DIRS)
  try {
    const gitignorePath = join(rootPath, '.gitignore')
    if (existsSync(gitignorePath)) ig.add(readFileSync(gitignorePath, 'utf8'))
  } catch {}
  return ig
}

async function traverseDir(dir: string, options: TraverseOptions, ig: Ignore, rootPath: string, state: TraverseState): Promise<void> {
  if (state.count >= state.max) return
  let entries: import('node:fs').Dirent[] = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  const promises: Promise<void>[] = []
  for (const entry of entries) {
    if (state.count >= state.max) break
    const name = entry.name, fullPath = join(dir, name)
    let relPath = relative(rootPath, fullPath).replace(/\\/g, '/') + (entry.isDirectory() ? '/' : '')
    if (ig.ignores(relPath)) continue
    if (entry.isDirectory()) promises.push(traverseDir(fullPath, options, ig, rootPath, state))
    else if (entry.isFile() && !BINARY_EXTENSIONS.has(extname(name).toLowerCase())) {
      state.count++
      try { options.onFile(fullPath, name, 0) } catch {}
    }
  }
  await Promise.all(promises)
}

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const resolved = resolve(rootPath), cached = workspaceFilesCache.get(resolved)
  if (cached && Date.now() - cached.timestamp < 10000) return cached.files
  const files: string[] = [], ig = buildIgnore(rootPath), state = { count: 0, max: 5000 }
  await traverseDir(rootPath, { onFile: (fp) => { try { files.push(relative(rootPath, fp).replace(/\\/g, '/')) } catch {} } }, ig, rootPath, state)
  files.sort((a, b) => a.localeCompare(b))
  workspaceFilesCache.set(resolved, { files, timestamp: Date.now() }); return files
}
