import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import { getSessionPath } from './utils'

type AuthEventMap = {
  'open-main-and-close-onboarding': []
  'logged-out': []
}

class AuthEventEmitter extends EventEmitter {
  emit<K extends keyof AuthEventMap>(event: K, ...args: AuthEventMap[K]): boolean {
    return super.emit(event, ...args)
  }
  on<K extends keyof AuthEventMap>(event: K, listener: (...args: AuthEventMap[K]) => void): this {
    return super.on(event, listener)
  }
  once<K extends keyof AuthEventMap>(event: K, listener: (...args: AuthEventMap[K]) => void): this {
    return super.once(event, listener)
  }
}

export const authEvents = new AuthEventEmitter()

export interface UserProfile {
  uid: string
  name: string
  email: string
  photoUrl: string
}

export interface AuthSession {
  idToken: string
  refreshToken: string
  user: UserProfile
}

let sessionFilePath: string | null = null
function getSessionFilePath(): string {
  if (!sessionFilePath) sessionFilePath = getSessionPath()
  return sessionFilePath
}
let currentSession: AuthSession | null = null
let loginInProgress = false
let activeVerifier = ''
let pendingLoginResolve: ((user: UserProfile | null) => void) | null = null
let pendingLoginReject: ((reason: Error) => void) | null = null

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function sha256(str: string): Buffer {
  return crypto.createHash('sha256').update(str).digest()
}

function generatePKCE() {
  const verifier = base64URLEncode(crypto.randomBytes(32))
  const challenge = base64URLEncode(sha256(verifier))
  return { verifier, challenge }
}

export function getCurrentSession(): AuthSession | null {
  if (!currentSession && process.env.SUPABASE_SESSION_TOKEN) {
    return { idToken: process.env.SUPABASE_SESSION_TOKEN, refreshToken: '', user: { uid: 'worker', name: 'Worker', email: 'worker@orch.live', photoUrl: '' } }
  }
  return currentSession
}

export function requireAuthToken(): string {
  const session = getCurrentSession()
  const token = session?.idToken || process.env.SUPABASE_SESSION_TOKEN
  if (!token) throw new Error('Unauthenticated: Please sign in.')
  return token
}

async function loadSession(): Promise<AuthSession | null> {
  try {
    const { safeStorage } = require('electron')
    const data = await fs.readFile(getSessionFilePath())
    currentSession = JSON.parse(safeStorage.decryptString(data))
    return currentSession
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null
    log.error('[auth] Load session failed:', err)
    throw err
  }
}

async function saveSession(session: AuthSession | null) {
  if (!session) { await fs.rm(getSessionFilePath(), { force: true }); return }
  const { safeStorage } = require('electron')
  await fs.writeFile(getSessionFilePath(), safeStorage.encryptString(JSON.stringify(session)))
}

function broadcastUserStatus(user: UserProfile | null) {
  const { BrowserWindow } = require('electron')
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('auth:status-changed', user)
  })
}

export function getAuthUser(): UserProfile | null { return currentSession?.user ?? null }

export async function logoutUser(): Promise<boolean> {
  log.info('[auth] Logging user out...')
  currentSession = null
  await saveSession(null)
  broadcastUserStatus(null)
  authEvents.emit('logged-out')
  return true
}

export function startGoogleAuth(): Promise<UserProfile | null> {
  if (loginInProgress) return Promise.reject(new Error('Login already in progress.'))
  loginInProgress = true
  const promise = new Promise<UserProfile | null>((resolve, reject) => {
    log.info('[auth] Triggering Supabase Google Sign-in flow...')
    if (pendingLoginReject) { pendingLoginReject(new Error('Login cancelled')); pendingLoginReject = null; pendingLoginResolve = null }
    const { verifier, challenge } = generatePKCE()
    activeVerifier = verifier
    const supabaseUrl = process.env.SUPABASE_URL!
    pendingLoginResolve = resolve; pendingLoginReject = reject
    const redirectUrl = `${supabaseUrl}/auth/v1/authorize?` + new URLSearchParams({ provider: 'google', redirect_to: 'orch-code://auth-callback', code_challenge: challenge, code_challenge_method: 's256' }).toString()
    const { shell } = require('electron')
    void shell.openExternal(redirectUrl).catch((err) => { const r = pendingLoginReject; pendingLoginReject = null; pendingLoginResolve = null; r?.(err instanceof Error ? err : new Error(String(err))) })
  })
  return promise.finally(() => { loginInProgress = false })
}

export async function handleAuthCallback(code: string, _state: string, errorMsg?: string | null): Promise<void> {
  // Capture pending callbacks — may be null if deep-link arrives without a pending login (e.g. app restarted)
  const resolve = pendingLoginResolve
  const reject = pendingLoginReject
  pendingLoginResolve = null
  pendingLoginReject = null
  if (errorMsg) {
    reject?.(new Error(errorMsg))
    return
  }
  if (!code) return
  try {
    log.info('[auth] Exchanging Supabase auth code for tokens...')
    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({ code_verifier: activeVerifier, auth_code: code })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`)
    const user: UserProfile = {
      uid: data.user.id,
      name: data.user.user_metadata?.full_name || data.user.email || 'User',
      email: data.user.email || '',
      photoUrl: data.user.user_metadata?.avatar_url || ''
    }
    currentSession = { idToken: data.access_token, refreshToken: data.refresh_token, user }
    await saveSession(currentSession)
    log.info('[auth] Login completed:', user.email)
    broadcastUserStatus(user)
    resolve?.(user)
    // Always emit transition event as a guaranteed fallback — the renderer's auth:complete-onboarding
    // IPC call can race or fail if the window is being destroyed; this ensures main window always opens.
    authEvents.emit('open-main-and-close-onboarding')
  } catch (err: any) {
    log.error('[auth] Callback failed:', err)
    reject?.(err)
  }
}

function getJwtExpiry(token: string): number {
  try { const parts = token.split('.'); if (parts.length !== 3) return 0; return (JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8')).exp || 0) * 1000 }
  catch { return 0 }
}
async function refreshSessionIfNeeded(): Promise<void> {
  if (!currentSession?.refreshToken) return
  const exp = getJwtExpiry(currentSession.idToken)
  if (exp && exp - Date.now() > 5 * 60 * 1000) return
  log.info('[auth] Refreshing Supabase session token...')
  const res = await fetch(`${process.env.SUPABASE_URL!}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY! },
    body: JSON.stringify({ refresh_token: currentSession.refreshToken })
  })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      log.warn('[auth] Refresh failed with 400/401. Logging out.')
      await logoutUser()
    }
    throw new Error(`Refresh failed: ${res.status}`)
  }
  const data = await res.json()
  currentSession = { ...currentSession, idToken: data.access_token, refreshToken: data.refresh_token }
  await saveSession(currentSession)
  broadcastUserStatus(currentSession.user)
}
let refreshIntervalId: NodeJS.Timeout | null = null
export async function initAuth() {
  currentSession = await loadSession()
  if (currentSession) {
    log.info('[auth] Recovered session for:', currentSession.user.email)
    broadcastUserStatus(currentSession.user)
    await refreshSessionIfNeeded()
  }
  if (refreshIntervalId) clearInterval(refreshIntervalId)
  refreshIntervalId = setInterval(() => {
    if (currentSession) refreshSessionIfNeeded().catch(err => log.warn('[auth] Background refresh error:', err))
  }, 5 * 60 * 1000)
}
export function cleanupAuth() {
  if (refreshIntervalId) { clearInterval(refreshIntervalId); refreshIntervalId = null }
}
