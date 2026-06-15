import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import Bottleneck from 'bottleneck'
import type { BrowserWindow, WebContentsView } from 'electron'
import type { Page } from 'playwright-core'
import { getWorkspaceContext } from './workspace'


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

 
export function getAppEnv(): { isPackaged: boolean; resourcesPath: string; appPath: string; userData: string } {
  if (process.env.USER_DATA_PATH) {
    return { isPackaged: process.env.IS_PACKAGED === 'true', resourcesPath: process.env.RESOURCES_PATH || '', appPath: process.env.APP_PATH || '', userData: process.env.USER_DATA_PATH }
  }
  const { app } = require('electron')
  return { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), userData: app.getPath('userData') }
}

 
export function resolveWorkerPath(name: string): string {
  const { existsSync } = require('node:fs'), { join: j } = require('node:path')
  const primary = j(__dirname, `${name}.js`)
  return existsSync(primary) ? primary : j(__dirname, '..', `${name}.js`)
}


export const tavilyLimiter = new Bottleneck({ maxConcurrent: 2, minTime: 200 })
// STRICT RULE: This is implemented as per the user's wish. Avoid modifying this.
export const globalApiLimiter = new Bottleneck({ maxConcurrent: 10, minTime: 10000 })


export interface BrowserSession {
  view: WebContentsView
  partition: string
   
  page?: Page
   
  queue: Promise<any>
}


export class WindowManager {
  private static mainWindow: BrowserWindow | null = null
   
  private static sessions = new Map<string, BrowserSession>()
   
  private static activeConvId: string | null = null

  static setMainWindow(win: BrowserWindow | null) { this.mainWindow = win }
  static getMainWindow(): BrowserWindow | null { return this.mainWindow }

   
  static getSession(convId: string): BrowserSession | undefined { return this.sessions.get(convId) }

   
  static getActiveConvId(): string | null { return this.activeConvId }

   
  static getOrCreateSession(convId: string, partition?: string): BrowserSession {
    let s = this.sessions.get(convId)
    if (!s) {
      const { WebContentsView } = require('electron') as typeof import('electron')
      const p = partition ?? `persist:conversation_${convId}`
      const view = new WebContentsView({
        webPreferences: { webSecurity: true, nodeIntegration: false, contextIsolation: true, sandbox: true, partition: p }
      }) as WebContentsView
      view.setBounds({ x: 0, y: 0, width: 1024, height: 768 })
      s = { view, partition: p, queue: Promise.resolve() }
      this.sessions.set(convId, s)
    }
    return s
  }

   
  static showSession(convId: string, bounds: { x: number; y: number; width: number; height: number }) {
    const win = this.mainWindow
    if (!win || win.isDestroyed()) return
    const s = this.sessions.get(convId)
    if (!s) return
    for (const [id, sess] of this.sessions) {
      if (id !== convId) { try { win.contentView.removeChildView(sess.view) } catch {} }
    }
    s.view.setBounds(bounds)
    try { win.contentView.addChildView(s.view) } catch {}
    this.activeConvId = convId
  }

   
  static hideSession(convId: string) {
    const win = this.mainWindow
    const s = this.sessions.get(convId)
    if (!s) return
    if (win && !win.isDestroyed()) { try { win.contentView.removeChildView(s.view) } catch {} }
    if (this.activeConvId === convId) this.activeConvId = null
  }

   
  static destroySession(convId: string) {
    const win = this.mainWindow
    const s = this.sessions.get(convId)
    if (!s) return
    if (win && !win.isDestroyed()) { try { win.contentView.removeChildView(s.view) } catch {} }
    if (s.page && !s.page.isClosed()) s.page.close().catch(() => {})
    try { s.view.webContents.close() } catch {}
    this.sessions.delete(convId)
    if (this.activeConvId === convId) this.activeConvId = null
  }

   
  static getActiveSession(): BrowserSession | null {
    return this.activeConvId ? (this.sessions.get(this.activeConvId) ?? null) : null
  }

   
  static clearAllSessions() {
    const win = this.mainWindow
    for (const [, s] of this.sessions) {
      if (win && !win.isDestroyed()) { try { win.contentView.removeChildView(s.view) } catch {} }
      if (s.page && !s.page.isClosed()) s.page.close().catch(() => {})
      try { s.view.webContents.close() } catch {}
    }
    this.sessions.clear()
    this.activeConvId = null
  }



  static getBrowserView(): WebContentsView | null { return this.getActiveSession()?.view ?? null }
  static getBrowserConversationId(): string | null { return this.activeConvId }
}
export default WindowManager


export interface ArtifactEntry { name: string; path: string; size: number; modified: string }

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
