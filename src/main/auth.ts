import { app, ipcMain, shell, BrowserWindow, safeStorage } from 'electron'
import http from 'http'
import crypto from 'crypto'
import https from 'https'
import { join } from 'path'
import { promises as fs } from 'fs'
import log from 'electron-log'

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
let mainWin: BrowserWindow | null = null
let tempServer: http.Server | null = null

// Helper for PKCE encoding
function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function sha256(str: string): Buffer {
  return crypto.createHash('sha256').update(str).digest()
}

// Generate code verifier and challenge
function generatePKCE() {
  const verifier = base64URLEncode(crypto.randomBytes(32))
  const challenge = base64URLEncode(sha256(verifier))
  return { verifier, challenge }
}

// Direct form request to Google
function postFormRequest(urlStr: string, formParams: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const rawBody = new URLSearchParams(formParams).toString()
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(rawBody)
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.error_description || parsed.error || `HTTP ${res.statusCode}`))
          } else {
            resolve(parsed)
          }
        } catch {
          reject(new Error(`Failed to parse google token response: ${data}`))
        }
      })
    })
    req.on('error', (err) => reject(err))
    req.write(rawBody)
    req.end()
  })
}

// Direct JSON request to Firebase
function postJsonRequest(urlStr: string, bodyObj: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const rawBody = JSON.stringify(bodyObj)
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody)
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`))
          } else {
            resolve(parsed)
          }
        } catch {
          reject(new Error(`Failed to parse firebase response: ${data}`))
        }
      })
    })
    req.on('error', (err) => reject(err))
    req.write(rawBody)
    req.end()
  })
}

// Decrypt persistent session from disk
async function loadSession(): Promise<AuthSession | null> {
  try {
    const exists = await fs.stat(sessionFilePath).then(() => true).catch(() => false)
    if (!exists) return null

    const encrypted = await fs.readFile(sessionFilePath)
    if (safeStorage.isEncryptionAvailable()) {
      const rawString = safeStorage.decryptString(encrypted)
      return JSON.parse(rawString)
    } else {
      return JSON.parse(encrypted.toString('utf-8'))
    }
  } catch (err) {
    log.error('[auth] Load session failed:', err)
    return null
  }
}

// Encrypt and persist session on disk
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
      await fs.writeFile(sessionFilePath, rawString, 'utf-8')
    }
  } catch (err) {
    log.error('[auth] Save session failed:', err)
  }
}

// Trigger state updates inside Renderer
function broadcastUserStatus(user: UserProfile | null) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('auth:status-changed', user)
  }
}

export async function initAuth(window: BrowserWindow) {
  mainWin = window

  // Load active session at startup
  currentSession = await loadSession()
  if (currentSession) {
    log.info('[auth] Recovered session for:', currentSession.user.email)
  }

  // Register IPC Handlers
  ipcMain.handle('auth:get-user', () => {
    return currentSession ? currentSession.user : null
  })

  ipcMain.handle('auth:login', async () => {
    log.info('[auth] Triggering Google Sign-in flow...')
    
    // Close existing redirect server if running
    if (tempServer) {
      try { tempServer.close() } catch {}
    }

    const { verifier, challenge } = generatePKCE()
    const port = 9005
    const clientId = process.env.GOOGLE_CLIENT_ID
    const firebaseKey = process.env.FIREBASE_API_KEY

    if (!clientId || !firebaseKey) {
      log.error('[auth] Missing required GOOGLE_CLIENT_ID or FIREBASE_API_KEY environment variables.')
      throw new Error('Authentication service configuration is missing.')
    }

    return new Promise((resolve, reject) => {
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

          // Render Success landing page
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body style="font-family: sans-serif; background-color:#1e1e1e; color:#f3f3f3; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="background:#161616; padding:30px; border-radius:8px; border:1px solid #272727; text-align:center; max-width:400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"><h1 style="color:#10b981; font-size:24px; margin-bottom:10px;">Login Successful</h1><p style="color:#9c9c9c; font-size:14px; margin-bottom:20px;">You have successfully signed in. You can close this tab and return to your app.</p></div></body></html>')
          
          if (tempServer) {
            tempServer.close()
            tempServer = null
          }

          if (!authCode) {
            throw new Error('Authorization code not returned by Google')
          }

          log.info('[auth] Received Google auth code, exchanging for tokens...')

          // 1. Exchange Auth Code for Google Tokens
          const googleTokens = await postFormRequest('https://oauth2.googleapis.com/token', {
            client_id: clientId,
            code: authCode,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: `http://localhost:${port}/callback`
          })

          const googleIdToken = googleTokens.id_token
          if (!googleIdToken) {
            throw new Error('Google did not return an id_token')
          }

          log.info('[auth] Exchanging Google token with Firebase REST API...')

          // 2. Exchange Google ID Token with Firebase REST Auth
          const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${firebaseKey}`
          const firebaseSession = await postJsonRequest(firebaseAuthUrl, {
            postBody: `id_token=${googleIdToken}&providerId=google.com`,
            requestUri: 'http://localhost',
            returnIdpCredential: true,
            returnSecureToken: true
          })

          // 3. Compile session profile
          const user: UserProfile = {
            uid: firebaseSession.localId,
            name: firebaseSession.displayName || 'Google User',
            email: firebaseSession.email,
            photoUrl: firebaseSession.photoUrl || ''
          }

          currentSession = {
            idToken: firebaseSession.idToken,
            refreshToken: firebaseSession.refreshToken,
            user
          }

          // 4. Secure session natively on OS Keychain
          await saveSession(currentSession)
          log.info('[auth] Login completed. Authenticated user:', user.email)
          
          broadcastUserStatus(user)
          resolve(user)

        } catch (err: any) {
          log.error('[auth] Login flow failed:', err)
          if (tempServer) {
            tempServer.close()
            tempServer = null
          }
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<html><body style="font-family: sans-serif; background-color:#1e1e1e; color:#f3f3f3; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="background:#161616; padding:30px; border-radius:8px; border:1px solid #ef4444; text-align:center; max-width:400px;"><h1 style="color:#ef4444; font-size:24px; margin-bottom:10px;">Authentication Failed</h1><p style="color:#9c9c9c; font-size:14px;">Error: ' + err.message + '</p></div></body></html>')
          reject(err)
        }
      })

      tempServer.listen(port, '127.0.0.1', () => {
        // Open consent flow in default browser
        const redirectUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
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
    return true
  })
}
