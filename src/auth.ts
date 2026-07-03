import { app, ipcMain, shell, BrowserWindow, safeStorage } from 'electron';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
export interface AuthUser { id: string; email: string; avatarUrl?: string; }
export interface StoredSession { accessToken: string; refreshToken: string; expiresAt: number; user: AuthUser; }
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const memStore = new Map<string, string>();
const nodeStorage = {
  getItem: (k: string): string | null => memStore.get(k) ?? null,
  setItem: (k: string, v: string): void => { memStore.set(k, v); },
  removeItem: (k: string): void => { memStore.delete(k); },
};
const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
  auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false, storage: nodeStorage, detectSessionInUrl: false },
});
const sessionPath = () => path.join(app.getPath('userData'), '.session');
export async function saveSession(s: StoredSession): Promise<void> {
  console.log('[Auth] Saving session for:', s.user.email);
  const d = JSON.stringify(s);
  fs.writeFileSync(sessionPath(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(d).toString('base64') : d, 'utf-8');
}
export async function loadSession(): Promise<StoredSession | null> {
  try {
    const r = fs.readFileSync(sessionPath(), 'utf-8');
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(r, 'base64')) : r);
  } catch { return null; }
}
export async function clearSession(): Promise<void> { try { fs.unlinkSync(sessionPath()); } catch {} }
let refreshPromise: Promise<StoredSession | null> | null = null;
let activeOAuthServer: ReturnType<typeof http.createServer> | null = null;
async function refreshIfExpired(stored: StoredSession): Promise<StoredSession | null> {
  if (stored.expiresAt - Math.floor(Date.now() / 1000) > 60) return stored;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      console.log('[Auth] Refreshing expired token...');
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: stored.refreshToken });
      if (error || !data.session) { await clearSession(); return null; }
      console.log('[Auth] Token refreshed OK');
      const fresh: StoredSession = { ...stored, accessToken: data.session.access_token, refreshToken: data.session.refresh_token!, expiresAt: data.session.expires_at! };
      await saveSession(fresh); return fresh;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
export function registerAuthHandlers(getMainWindow: () => BrowserWindow | null): void {
  
  const checkOrigin = (wc: Electron.WebContents) => {
    const u = wc.getURL(), devUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : '';
    if (!u.startsWith('file://') && (!devUrl || !u.startsWith(devUrl))) throw new Error('Unauthorized IPC');
  };
  const safe = (ch: string, fn: (e: Electron.IpcMainInvokeEvent, ...a: any[]) => any) => ipcMain.handle(ch, (e, ...a) => { checkOrigin(e.sender); return fn(e, ...a); });
  safe('auth:loadSession', async () => { const s = await loadSession(); return s ? refreshIfExpired(s) : null; });
  safe('auth:saveSession', (_, s: StoredSession) => saveSession(s));
  safe('auth:clearSession', () => clearSession());
  safe('auth:startOAuth', async () => {
    return new Promise<void>((resolve, reject) => {
      if (activeOAuthServer) { try { activeOAuthServer.close(); } catch {} activeOAuthServer = null; }
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith('/callback')) { res.end(); return; }
        const port = (server.address() as any).port;
        const parsed = new URL(req.url, `http://localhost:${port}`);
        const code = parsed.searchParams.get('code'), oauthError = parsed.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><style>*{margin:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f0f;font-family:system-ui;color:#e5e5e5;flex-direction:column;gap:8px}</style></head><body><b style="color:orange">Orch Code</b><p style="opacity:0.6;font-size:small">${oauthError ? 'Sign in failed' : 'Signed in — you can close this tab'}</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`);
        clearTimeout(timeout); server.close(); activeOAuthServer = null;
        if (oauthError) { reject(new Error(parsed.searchParams.get('error_description') || oauthError)); return; }
        if (!code) { reject(new Error('No code in callback')); return; }
        try {
          const { data: ex, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr || !ex.session) { reject(new Error(exErr?.message || 'No session returned')); return; }
          const session: StoredSession = {
            accessToken: ex.session.access_token, refreshToken: ex.session.refresh_token!,
            expiresAt: ex.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
            user: { id: ex.user.id, email: ex.user.email!, avatarUrl: ex.user.user_metadata?.avatar_url || ex.user.user_metadata?.picture },
          };
          await saveSession(session);
          getMainWindow()?.webContents.send('auth:sessionReceived', session);
          resolve();
        } catch (e: any) { reject(e); }
      });
      const timeout = setTimeout(() => { server.close(); activeOAuthServer = null; reject(new Error('OAuth timed out')); }, 60_000);
      activeOAuthServer = server;
      server.listen(0, '127.0.0.1', async () => {
        const port = (server.address() as any).port;
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `http://localhost:${port}/callback`, skipBrowserRedirect: true, queryParams: { access_type: 'offline', prompt: 'select_account' } },
        });
        if (error || !data.url) { clearTimeout(timeout); server.close(); reject(new Error(error?.message || 'Failed OAuth URL')); }
        else { shell.openExternal(data.url); }
      });
      server.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
  });
  safe('auth:signOut', async () => {
    await supabase.auth.signOut().catch(() => {});
    await clearSession();
  });
}
