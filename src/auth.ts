import { app, ipcMain, shell, BrowserWindow } from 'electron';
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
  fs.writeFileSync(sessionPath(), JSON.stringify(s), 'utf-8');
}
export async function loadSession(): Promise<StoredSession | null> {
  try { return JSON.parse(fs.readFileSync(sessionPath(), 'utf-8')); } catch { return null; }
}
export async function clearSession(): Promise<void> { try { fs.unlinkSync(sessionPath()); } catch {} }
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const a = s.address() as { port: number }; s.close(() => resolve(a.port)); });
    s.on('error', reject);
  });
}
async function refreshIfExpired(stored: StoredSession): Promise<StoredSession | null> {
  if (stored.expiresAt - Math.floor(Date.now() / 1000) > 60) return stored;
  console.log('[Auth] Refreshing expired token...');
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: stored.refreshToken });
  if (error || !data.session) { await clearSession(); return null; }
  console.log('[Auth] Token refreshed OK');
  const fresh: StoredSession = { ...stored, accessToken: data.session.access_token, refreshToken: data.session.refresh_token!, expiresAt: data.session.expires_at! };
  await saveSession(fresh); return fresh;
}
export function registerAuthHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('auth:loadSession', async () => { const s = await loadSession(); return s ? refreshIfExpired(s) : null; });
  ipcMain.handle('auth:saveSession', (_, s: StoredSession) => saveSession(s));
  ipcMain.handle('auth:clearSession', () => clearSession());
  ipcMain.handle('auth:startOAuth', async () => {
    const port = await getFreePort();
    const redirectUri = `http://localhost:${port}/callback`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUri, skipBrowserRedirect: true, queryParams: { access_type: 'offline', prompt: 'select_account' } },
    });
    if (error || !data.url) throw new Error(error?.message || 'Failed to get OAuth URL');
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { server.close(); reject(new Error('OAuth timed out after 3 minutes')); }, 180_000);
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith('/callback')) { res.end(); return; }
        const parsed = new URL(req.url, `http://localhost:${port}`);
        const code = parsed.searchParams.get('code');
        const oauthError = parsed.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><style>*{margin:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f0f;font-family:system-ui;color:#e5e5e5;flex-direction:column;gap:8px}</style></head><body><b style="color:#f97316">Orch Code</b><p style="color:#888;font-size:13px">${oauthError ? 'Sign in failed' : 'Signed in — you can close this tab'}</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`);
        clearTimeout(timeout); server.close();
        if (oauthError) { reject(new Error(parsed.searchParams.get('error_description') || oauthError)); return; }
        if (!code) { reject(new Error('No code in callback')); return; }
        try {
          const { data: ex, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr || !ex.session) { reject(new Error(exErr?.message || 'No session returned')); return; }
          console.log('[Auth] ✓ Session obtained! User:', ex.user?.email);
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
      server.listen(port, () => shell.openExternal(data.url!));
      server.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
  });
  ipcMain.handle('auth:signOut', async () => {
    await supabase.auth.signOut().catch(() => {});
    await clearSession();
    getMainWindow()?.close();
  });
}
