import * as Sentry from '@sentry/electron/main';
Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN });
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

// --- Visual & Performance Optimizations ---
// Force high DPI support and advanced GPU rasterization for crisp 4K/Retina displays
app.commandLine.appendSwitch('enable-features', 'HighDPISupport');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // Ensures hardware acceleration kicks in on all 4K monitors

import started from 'electron-squirrel-startup';
import { registerHandlers, setMainWindow } from './ipc/handlers';
import { getDb } from './db/db';
import { initUpdater, quitAndInstall, openReleasesPage, checkForUpdate } from './updater';
export { quitAndInstall, openReleasesPage, checkForUpdate };

if (started) { app.quit(); process.exit(0); }
app.name = 'Orch Code';
app.setAppUserModelId('Orch Code');
app.setPath('userData', path.join(app.getPath('appData'), 'OrchCode'));
let mainWindow: BrowserWindow | null = null;
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
else { app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } }); }
const createWindow = () => {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, title: 'Orch Code', titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'logo.png'),
    ...(isMac ? { trafficLightPosition: { x: 15, y: 11 } } : { titleBarOverlay: { color: '#00000000', symbolColor: '#737373', height: 36 } }),
    backgroundColor: '#1e1e1e', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
  });
  mainWindow.webContents.on('will-navigate', (e, u) => { 
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL && u.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
    e.preventDefault(); shell.openExternal(u); 
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    setMainWindow(mainWindow!);
    initUpdater((status, info) => mainWindow?.webContents.send('update:status', status, info));
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
};
app.on('ready', () => { try { getDb(); registerHandlers(); createWindow(); } catch { app.quit(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
