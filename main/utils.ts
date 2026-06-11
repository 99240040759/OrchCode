import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import Bottleneck from 'bottleneck'
import type { BrowserWindow, WebContentsView } from 'electron'
import { getWorkspaceContext } from './workspace'

// --- Paths ---
export const APP_ID = 'com.orchcode.app'
export function getUserData(): string { return process.env.USER_DATA_PATH || require('electron').app.getPath('userData') }
export function getDatabasePath(): string { return join(getUserData(), 'orch_db.sqlite') }
export function getSessionPath(): string { return join(getUserData(), 'session.bin') }
export function getConversationsPath(): string { return join(getUserData(), 'conversations') }
export function getConversationPath(id: string): string { return join(getConversationsPath(), id) }
export function getConversationScreenshotsPath(id: string): string { return join(getConversationPath(id), 'screenshots') }
export function getApiBaseUrl(): string {
  if (process.env.GCP_FUNCTIONS_URL) return process.env.GCP_FUNCTIONS_URL.replace(/\/$/, '')
  return `${process.env.SUPABASE_URL}/functions/v1/api`
}

// --- Limiters ---
export const tavilyLimiter = new Bottleneck({ maxConcurrent: 2, minTime: 200 })
export const globalApiLimiter = new Bottleneck({ maxConcurrent: 10, minTime: 10000 })

// --- Window Manager ---
export class WindowManager {
  private static mainWindow: BrowserWindow | null = null
  private static browserViews = new Map<string, WebContentsView>()
  private static activeBrowserConversationId: string | null = null
  static setMainWindow(win: BrowserWindow | null) { this.mainWindow = win }
  static getMainWindow(): BrowserWindow | null { return this.mainWindow }
  static getBrowserViewForConversation(id: string): WebContentsView | undefined { return this.browserViews.get(id) }
  static setBrowserViewForConversation(id: string, view: WebContentsView | null) {
    if (view) this.browserViews.set(id, view)
    else { const existing = this.browserViews.get(id); if (existing) { try { existing.webContents.close() } catch {} }; this.browserViews.delete(id) }
  }
  static setBrowserConversationId(id: string | null) { this.activeBrowserConversationId = id }
  static getBrowserConversationId(): string | null { return this.activeBrowserConversationId }
  static getBrowserView(): WebContentsView | null { return this.activeBrowserConversationId ? (this.browserViews.get(this.activeBrowserConversationId) ?? null) : null }
  static getAllBrowserViews(): Map<string, WebContentsView> { return this.browserViews }
  static clearAllBrowserViews() { this.browserViews.forEach(bv => { try { bv.webContents.close() } catch {} }); this.browserViews.clear(); this.activeBrowserConversationId = null }
  static clear() { this.mainWindow = null; this.clearAllBrowserViews() }
}
export default WindowManager

// --- Artifacts ---
export interface ArtifactEntry {
  name: string
  path: string
  size: number
  modified: string
}

async function readArtifacts(dir: string): Promise<ArtifactEntry[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return Promise.all(entries.filter(e => e.isFile()).map(async e => {
      const p = join(dir, e.name), stat = await fs.stat(p)
      return { name: e.name, path: p, size: stat.size, modified: stat.mtime.toISOString() }
    }))
  } catch (err: any) { if (err.code === 'ENOENT') return []; throw err }
}

export async function pushArtifactsChanged(conversationId: string): Promise<void> {
  const mainWindow = WindowManager.getMainWindow(), ctx = getWorkspaceContext(conversationId)
  if (mainWindow && ctx) {
    const artifacts = await readArtifacts(ctx.artifactsPath)
    mainWindow.webContents.send('artifacts:changed', { conversationId, artifacts })
  }
}

export async function listArtifacts(conversationId: string): Promise<ArtifactEntry[]> {
  const ctx = getWorkspaceContext(conversationId)
  return ctx ? readArtifacts(ctx.artifactsPath) : []
}
