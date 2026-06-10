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

// --- Limiters ---
export const tavilyLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 500 })
export const globalApiLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 1000 })

// --- Window Manager ---
export class WindowManager {
  private static mainWindow: BrowserWindow | null = null
  private static browserView: WebContentsView | null = null
  private static browserConversationId: string | null = null
  static setMainWindow(win: BrowserWindow | null) { this.mainWindow = win }
  static getMainWindow(): BrowserWindow | null { return this.mainWindow }
  static setBrowserView(view: WebContentsView | null) { this.browserView = view }
  static getBrowserView(): WebContentsView | null { return this.browserView }
  static setBrowserConversationId(id: string | null) { this.browserConversationId = id }
  static getBrowserConversationId(): string | null { return this.browserConversationId }
  static clear() { this.mainWindow = null; this.browserView = null; this.browserConversationId = null }
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
