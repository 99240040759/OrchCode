import { app, autoUpdater, shell, net } from 'electron';
const RELEASES_REPO = 'sameer786ss/OrchCode';
const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases/latest`;
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';
let _send: ((status: UpdateStatus, info?: string) => void) | null = null;
export function initUpdater(send: (status: UpdateStatus, info?: string) => void) {
  _send = send;
  if (app.isPackaged) {
    // Delay first check to not block startup
    setTimeout(() => checkForUpdate(), 8000);
    // Check every 4 hours
    setInterval(() => checkForUpdate(), 4 * 60 * 60 * 1000);
  }
}
export function checkForUpdate() {
  if (process.platform === 'win32') checkWindows();
  else checkMac();
}
export function quitAndInstall() {
  autoUpdater.quitAndInstall();
}
// ─── Windows — Squirrel via update.electronjs.org ─────────────────────────
function checkWindows() {
  const feedUrl = `https://update.electronjs.org/${RELEASES_REPO}/win32/${process.arch}/${app.getVersion()}`;
  try {
    autoUpdater.setFeedURL({ url: feedUrl });
  } catch { return; }
  autoUpdater.removeAllListeners();
  autoUpdater.on('checking-for-update', () => _send?.('checking'));
  autoUpdater.on('update-not-available', () => _send?.('up-to-date'));
  autoUpdater.on('update-available', () => _send?.('downloading'));
  autoUpdater.on('update-downloaded', (_e, _notes, name) => _send?.('ready', name));
  autoUpdater.on('error', (err) => { console.error('[Updater]', err.message); _send?.('error', err.message); });
  try { autoUpdater.checkForUpdates(); } catch (e: any) { console.error('[Updater] checkForUpdates failed:', e.message); }
}

function checkMac() {
  _send?.('checking');
  const req = net.request({ url: `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, headers: { 'User-Agent': `OrchCode/${app.getVersion()}` } });
  req.on('response', (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        const latest = (data.tag_name || '').replace(/^v/, '');
        const current = app.getVersion();
        if (latest && latest !== current && isNewer(latest, current)) _send?.('available', latest);
        else _send?.('up-to-date');
      } catch { _send?.('idle'); }
    });
  });
  req.on('error', (err) => { console.error('[Updater] Mac check failed:', err.message); _send?.('idle'); });
  req.end();
}
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
export function openReleasesPage() { shell.openExternal(RELEASES_URL); }
