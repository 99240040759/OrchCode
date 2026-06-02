import { app, ipcMain, shell, BrowserWindow, safeStorage } from 'electron'
import http from 'http'
import crypto from 'crypto'
import https from 'https'
import { join } from 'path'
import { promises as fs } from 'fs'
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

function postHttpsRequest(
  urlStr: string,
  rawBody: string,
  contentType: string,
  parseError: (parsed: any, statusCode: number) => string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(rawBody)
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(parseError(parsed, res.statusCode)))
            } else {
              resolve(parsed)
            }
          } catch {
            reject(new Error(`Failed to parse response: ${data}`))
          }
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.write(rawBody)
    req.end()
  })
}

function postFormRequest(urlStr: string, formParams: Record<string, string>): Promise<any> {
  const rawBody = new URLSearchParams(formParams).toString()
  return postHttpsRequest(
    urlStr,
    rawBody,
    'application/x-www-form-urlencoded',
    (parsed, statusCode) => parsed.error_description || parsed.error || `HTTP ${statusCode}`
  )
}

function postJsonRequest(urlStr: string, bodyObj: any): Promise<any> {
  const rawBody = JSON.stringify(bodyObj)
  return postHttpsRequest(
    urlStr,
    rawBody,
    'application/json',
    (parsed, statusCode) => parsed.error?.message || `HTTP ${statusCode}`
  )
}

export function getCurrentSession(): AuthSession | null {
  return currentSession
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
        '[auth] SECURITY WARNING: OS encryption is unavailable. Session tokens are stored as plaintext on disk.'
      )
      currentSession = JSON.parse(encrypted.toString('utf-8'))
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
        '[auth] SECURITY WARNING: OS encryption is unavailable. Storing session tokens as plaintext. This is insecure on shared/compromised machines.'
      )
      await fs.writeFile(sessionFilePath, rawString, 'utf-8')
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

export async function initAuth() {
  currentSession = await loadSession()
  if (currentSession) {
    log.info('[auth] Recovered session for:', currentSession.user.email)
  }

  ipcMain.handle('auth:get-user', () => {
    return currentSession ? currentSession.user : null
  })

  ipcMain.handle('auth:login', async () => {
    log.info('[auth] Triggering Google Sign-in flow...')

    if (pendingLoginReject) {
      pendingLoginReject(new Error('Login cancelled: new login initiated'))
      pendingLoginReject = null
    }
    if (tempServer) {
      try {
        tempServer.close()
      } catch {}
      tempServer = null
    }

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

    return new Promise((resolve, reject) => {
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
            if (tempServer) {
              tempServer.close()
              tempServer = null
            }
            pendingLoginReject = null
            reject(new Error(`Auth cancelled: ${reason}`))
            return
          }

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="font-family: sans-serif; background-color:#1e1e1e; color:#f3f3f3; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="background:#161616; padding:30px; border-radius:8px; border:1px solid #272727; text-align:center; max-width:400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"><h1 style="color:#10b981; font-size:24px; margin-bottom:10px;">Login Successful</h1><p style="color:#9c9c9c; font-size:14px; margin-bottom:20px;">You have successfully signed in. You can close this tab and return to your app.</p></div></body></html>'
          )

          if (tempServer) {
            tempServer.close()
            tempServer = null
          }

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
          if (tempServer) {
            tempServer.close()
            tempServer = null
          }
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
        if (tempServer) {
          try {
            tempServer.close()
          } catch {}
          tempServer = null
        }
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
