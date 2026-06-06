import { app, shell, BrowserWindow, safeStorage } from 'electron'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import { getSessionPath } from './paths'

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

const sessionFilePath = getSessionPath()
let currentSession: AuthSession | null = null
let loginInProgress = false
let loginTimeout: NodeJS.Timeout | null = null
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

async function loadSession(): Promise<AuthSession | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    log.error('[auth] safeStorage unavailable — cannot restore session. Re-authentication required.')
    return null
  }
  try {
    const exists = await fs.stat(sessionFilePath).then(() => true).catch(() => false)
    if (!exists) return null
    currentSession = JSON.parse(safeStorage.decryptString(await fs.readFile(sessionFilePath)))
    return currentSession
  } catch (err) {
    log.error('[auth] Load session failed:', err)
    return null
  }
}

async function saveSession(session: AuthSession | null) {
  if (!session) {
    await fs.rm(sessionFilePath, { force: true }).catch(() => {})
    return
  }
  if (!safeStorage.isEncryptionAvailable()) return
  try {
    await fs.writeFile(sessionFilePath, safeStorage.encryptString(JSON.stringify(session)))
  } catch (err) {
    log.error('[auth] Save session failed:', err)
  }
}

function broadcastUserStatus(user: UserProfile | null) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('auth:status-changed', user)
  })
}

export function getAuthUser(): UserProfile | null {
  return currentSession ? currentSession.user : null
}

export async function logoutUser(): Promise<boolean> {
  log.info('[auth] Logging user out...')
  currentSession = null
  await saveSession(null)
  broadcastUserStatus(null)
  app.emit('auth:logged-out')
  return true
}

export async function startGoogleAuth(): Promise<UserProfile | null> {
  if (loginInProgress) throw new Error('Login already in progress.')
  loginInProgress = true
  try {
    log.info('[auth] Triggering Supabase Google Sign-in flow...')
    if (pendingLoginReject) {
      pendingLoginReject(new Error('Login cancelled'))
      pendingLoginReject = null
      pendingLoginResolve = null
    }
    const { verifier, challenge } = generatePKCE()
    activeVerifier = verifier

    const supabaseUrl = process.env.SUPABASE_URL
    if (!supabaseUrl) throw new Error('SUPABASE_URL config is missing.')

    return await new Promise<UserProfile | null>((resolve, reject) => {
      pendingLoginResolve = resolve
      pendingLoginReject = reject

      const redirectUrl = `${supabaseUrl}/auth/v1/authorize?` + new URLSearchParams({
        provider: 'google',
        redirect_to: 'orch-code://auth-callback',
        code_challenge: challenge,
        code_challenge_method: 's256'
      }).toString()

      loginTimeout = setTimeout(() => {
        const rejectPending = pendingLoginReject
        pendingLoginReject = null
        pendingLoginResolve = null
        rejectPending?.(new Error('Sign-in timed out.'))
      }, 5 * 60 * 1000)

      void shell.openExternal(redirectUrl).catch((err) => {
        const rejectPending = pendingLoginReject
        pendingLoginReject = null
        pendingLoginResolve = null
        rejectPending?.(err instanceof Error ? err : new Error(String(err)))
      })
    })
  } finally {
    loginInProgress = false
  }
}

export async function handleAuthCallback(code: string): Promise<void> {
  if (!pendingLoginResolve || !pendingLoginReject) return
  if (loginTimeout) { clearTimeout(loginTimeout); loginTimeout = null }
  const resolve = pendingLoginResolve
  const reject = pendingLoginReject
  pendingLoginResolve = null
  pendingLoginReject = null

  try {
    log.info('[auth] Exchanging Supabase auth code for tokens...')
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey!,
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
    resolve(user)
  } catch (err: any) {
    log.error('[auth] Callback failed:', err)
    reject(err)
  }
}

function getJwtExpiry(token: string): number {
  try { const parts = token.split('.'); if (parts.length !== 3) return 0; return (JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8')).exp || 0) * 1000 }
  catch { return 0 }
}
export async function refreshSessionIfNeeded(): Promise<boolean> {
  if (!currentSession?.refreshToken) return false
  const exp = getJwtExpiry(currentSession.idToken)
  if (exp && exp - Date.now() > 5 * 60 * 1000) return true
  try {
    log.info('[auth] Refreshing Supabase session token...')
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY! },
      body: JSON.stringify({ refresh_token: currentSession.refreshToken })
    })
    if (!res.ok) return false
    const data = await res.json()
    if (!data.access_token || !data.refresh_token) return false
    currentSession = { ...currentSession, idToken: data.access_token, refreshToken: data.refresh_token }
    await saveSession(currentSession); broadcastUserStatus(currentSession.user)
    return true
  } catch (err) { log.error('[auth] Token refresh failed:', err); return false }
}
export async function initAuth() {
  currentSession = await loadSession()
  if (currentSession) { log.info('[auth] Recovered session for:', currentSession.user.email); broadcastUserStatus(currentSession.user); void refreshSessionIfNeeded() }
  setInterval(() => { void refreshSessionIfNeeded() }, 5 * 60 * 1000)
}
