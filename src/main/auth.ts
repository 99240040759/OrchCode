import { app, ipcMain, shell, BrowserWindow, safeStorage } from 'electron'
import http from 'node:http'
import crypto from 'node:crypto'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import { escapeHtml } from './workspace'

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

const sessionFilePath = join(app.getPath('userData'), 'session.bin')
let currentSession: AuthSession | null = null
let tempServer: http.Server | null = null
let pendingLoginReject: ((reason: Error) => void) | null = null
let loginInProgress = false

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

async function postFormRequest(urlStr: string, formParams: Record<string, string>): Promise<any> {
  const response = await fetch(urlStr, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(formParams).toString()
  })
  const parsed = await response.json()
  if (!response.ok) {
    throw new Error(parsed.error_description || parsed.error || `HTTP ${response.status}`)
  }
  return parsed
}

async function postJsonRequest(urlStr: string, bodyObj: any): Promise<any> {
  const response = await fetch(urlStr, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyObj)
  })
  const parsed = await response.json()
  if (!response.ok) {
    throw new Error(parsed.error?.message || `HTTP ${response.status}`)
  }
  return parsed
}

export function getCurrentSession(): AuthSession | null {
  return currentSession
}

async function getFallbackEncryptionKey(): Promise<Buffer> {
  const keyPath = join(app.getPath('userData'), '.key')
  try {
    const key = await fs.readFile(keyPath)
    if (key.length === 32) return key
  } catch {}
  const newKey = crypto.randomBytes(32)
  await fs.writeFile(keyPath, newKey, { mode: 0o600 })
  return newKey
}

async function fallbackEncrypt(text: string): Promise<Buffer> {
  const key = await getFallbackEncryptionKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted])
}

async function fallbackDecrypt(buf: Buffer): Promise<string> {
  if (buf.length < 32) throw new Error('Invalid fallback buffer length')
  const key = await getFallbackEncryptionKey()
  const iv = buf.subarray(0, 16)
  const tag = buf.subarray(16, 32)
  const encrypted = buf.subarray(32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const exists = await fs
      .stat(sessionFilePath)
      .then(() => true)
      .catch(() => false)
    if (!exists) return null

    const encrypted = await fs.readFile(sessionFilePath)
    if (safeStorage.isEncryptionAvailable()) {
      const rawString = safeStorage.decryptString(encrypted)
      currentSession = JSON.parse(rawString)
      return currentSession
    } else {
      log.warn(
        '[auth] SECURITY WARNING: OS encryption is unavailable. Using AES-256-GCM encryption with local key file fallback.'
      )
      const rawString = await fallbackDecrypt(encrypted)
      currentSession = JSON.parse(rawString)
      return currentSession
    }
  } catch (err) {
    log.error('[auth] Load session failed:', err)
    return null
  }
}

async function saveSession(session: AuthSession | null) {
  try {
    if (!session) {
      await fs.rm(sessionFilePath, { force: true })
      return
    }

    const rawString = JSON.stringify(session)
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(rawString)
      await fs.writeFile(sessionFilePath, encrypted)
    } else {
      log.warn(
        '[auth] SECURITY WARNING: OS encryption is unavailable. Encrypting session file using local AES-256-GCM key file.'
      )
      const encrypted = await fallbackEncrypt(rawString)
      await fs.writeFile(sessionFilePath, encrypted)
    }
  } catch (err) {
    log.error('[auth] Save session failed:', err)
  }
}

function broadcastUserStatus(user: UserProfile | null) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('auth:status-changed', user)
    }
  })
}

async function closeTempServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!tempServer) {
      resolve()
      return
    }
    const s = tempServer
    tempServer = null
    s.close(() => {
      resolve()
    })
  })
}

export async function initAuth() {
  currentSession = await loadSession()
  if (currentSession) {
    log.info('[auth] Recovered session for:', currentSession.user.email)
  }

  ipcMain.handle('auth:get-user', () => {
    return currentSession ? currentSession.user : null
  })

  ipcMain.handle('auth:login', async () => {
    if (loginInProgress) {
      throw new Error('Login already in progress. Please wait or try again later.')
    }
    loginInProgress = true
    try {
      log.info('[auth] Triggering Google Sign-in flow...')

      if (pendingLoginReject) {
        pendingLoginReject(new Error('Login cancelled: new login initiated'))
        pendingLoginReject = null
      }
      await closeTempServer()

      const { verifier, challenge } = generatePKCE()
      const port = 9005
      const clientId = process.env.GOOGLE_CLIENT_ID
      const firebaseKey = process.env.FIREBASE_API_KEY

      if (!clientId || !firebaseKey) {
        log.error(
          '[auth] Missing required GOOGLE_CLIENT_ID or FIREBASE_API_KEY environment variables.'
        )
        throw new Error('Authentication service configuration is missing.')
      }

      return await new Promise((resolve, reject) => {
        pendingLoginReject = reject
        tempServer = http.createServer(async (req, res) => {
          try {
            const reqUrl = req.url || ''
            if (!reqUrl.includes('/callback')) {
              res.writeHead(404)
              res.end('Not Found')
              return
            }

            const urlParams = new URLSearchParams(reqUrl.split('?')[1])
            const authCode = urlParams.get('code')
            const authError = urlParams.get('error')

            if (!authCode || authError) {
              const reason = authError || 'No authorization code returned'
              log.warn(`[auth] Auth callback received without code: ${reason}`)
              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end(
                `<html><body style="font-family: sans-serif; background-color:#1e1e1e; color:#f3f3f3; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="background:#161616; padding:30px; border-radius:8px; border:1px solid #ef4444; text-align:center; max-width:400px;"><h1 style="color:#ef4444; font-size:24px; margin-bottom:10px;">Sign In Cancelled</h1><p style="color:#9c9c9c; font-size:14px;">Reason: ${escapeHtml(reason)}. You can close this tab and try again.</p></div></body></html>`
              )
              closeTempServer()
              pendingLoginReject = null
              reject(new Error(`Auth cancelled: ${reason}`))
              return
            }

            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body style="font-family: sans-serif; background-color:#1e1e1e; color:#f3f3f3; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="background:#161616; padding:30px; border-radius:8px; border:1px solid #272727; text-align:center; max-width:400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"><h1 style="color:#10b981; font-size:24px; margin-bottom:10px;">Login Successful</h1><p style="color:#9c9c9c; font-size:14px; margin-bottom:20px;">You have successfully signed in. You can close this tab and return to your app.</p></div></body></html>'
            )

            closeTempServer()

            log.info('[auth] Received Google auth code, exchanging for tokens...')

            const googleTokenParams: Record<string, string> = {
              client_id: clientId,
              code: authCode,
              code_verifier: verifier,
              grant_type: 'authorization_code',
              redirect_uri: `http://localhost:${port}/callback`
            }

            if (process.env.GOOGLE_CLIENT_SECRET) {
              googleTokenParams.client_secret = process.env.GOOGLE_CLIENT_SECRET
            }

            const googleTokens = await postFormRequest(
              'https://oauth2.googleapis.com/token',
              googleTokenParams
            )

            const googleIdToken = googleTokens.id_token
            if (!googleIdToken) {
              throw new Error('Google did not return an id_token')
            }

            log.info('[auth] Exchanging Google token with Firebase REST API...')

            const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${firebaseKey}`
            const firebaseSession = await postJsonRequest(firebaseAuthUrl, {
              postBody: `id_token=${googleIdToken}&providerId=google.com`,
              requestUri: 'http://localhost',
              returnIdpCredential: true,
              returnSecureToken: true
            })

            const user: UserProfile = {
              uid: firebaseSession.localId,
              name: firebaseSession.displayName,
              email: firebaseSession.email,
              photoUrl: firebaseSession.photoUrl
            }

            currentSession = {
              idToken: firebaseSession.idToken,
              refreshToken: firebaseSession.refreshToken,
              user
            }

            await saveSession(currentSession)
            log.info('[auth] Login completed. Authenticated user:', user.email)

            pendingLoginReject = null
            broadcastUserStatus(user)
            resolve(user)
          } catch (err: any) {
            log.error('[auth] Login flow failed:', err)
            closeTempServer()
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/html' })
              res.end(
                '<html><body style="font-family: sans-serif; background-color:#1e1e1e; color:#f3f3f3; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="background:#161616; padding:30px; border-radius:8px; border:1px solid #ef4444; text-align:center; max-width:400px;"><h1 style="color:#ef4444; font-size:24px; margin-bottom:10px;">Authentication Failed</h1><p style="color:#9c9c9c; font-size:14px;">Error: ' +
                  escapeHtml(err.message) +
                  '</p></div></body></html>'
              )
            }
            pendingLoginReject = null
            reject(err)
          }
        })

        tempServer.on('error', (err: any) => {
          log.error('[auth] Redirect server socket error:', err)
          closeTempServer()
          pendingLoginReject = null
          reject(new Error(`Local authentication server error: ${err.message}`))
        })

        tempServer.listen(port, '127.0.0.1', () => {
          const redirectUrl =
            'https://accounts.google.com/o/oauth2/v2/auth?' +
            new URLSearchParams({
              client_id: clientId,
              redirect_uri: `http://localhost:${port}/callback`,
              response_type: 'code',
              scope: 'openid email profile',
              code_challenge: challenge,
              code_challenge_method: 'S256'
            }).toString()

          shell.openExternal(redirectUrl)
        })
      })
    } finally {
      loginInProgress = false
    }
  })

  ipcMain.handle('auth:logout', async () => {
    log.info('[auth] Logging user out...')
    currentSession = null
    await saveSession(null)
    broadcastUserStatus(null)
    app.emit('auth:logged-out')
    return true
  })

  ipcMain.handle('auth:open-main-and-close-onboarding', () => {
    app.emit('auth:open-main-and-close-onboarding')
    return true
  })
}
