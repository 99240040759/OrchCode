import * as Sentry from '@sentry/electron/main';
Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN });
import dotenv from 'dotenv';
dotenv.config();
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerHandlers, setMainWindow } from './ipc/handlers';
import { getDb } from './db/db';
import { initUpdater, quitAndInstall, openReleasesPage, checkForUpdate } from './updater';
export { quitAndInstall, openReleasesPage, checkForUpdate };

if (started) app.quit();
app.setPath('userData', path.join(app.getPath('appData'), 'OrchCode'));
let mainWindow: BrowserWindow | null = null;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
}
const createWindow = () => {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, title: 'Orch Code', titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 15, y: 11 } } : { titleBarOverlay: { color: '#00000000', symbolColor: '#737373', height: 36 } }),
    backgroundColor: '#1e1e1e', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false, contextIsolation: true, nodeIntegration: false, webviewTag: true },
  });
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
app.on('ready', () => { getDb(); registerHandlers(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
