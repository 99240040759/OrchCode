import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'

let settingsWindow: BrowserWindow | null = null

export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  settingsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#161616',
      symbolColor: '#c8ccd4',
      height: 38
    } : undefined,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  settingsWindow.on('ready-to-show', () => {
    settingsWindow!.show()
    log.info('[main] Settings Window ready')
  })
  settingsWindow.on('closed', () => { settingsWindow = null })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?view=settings')
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'settings' } })
  }
  return settingsWindow
}

export function showSettingsWindow(): void { createSettingsWindow() }
export function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close()
}
export function getSettingsWindow(): BrowserWindow | null { return settingsWindow }
