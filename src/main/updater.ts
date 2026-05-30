import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}

let currentStatus: UpdateStatus = { status: 'idle' }
let mainWin: BrowserWindow | null = null

function sendStatus(status: UpdateStatus) {
  currentStatus = status
  log.info(`[updater] Status transition: ${status.status} (version: ${status.version || 'unknown'}, progress: ${status.progress ?? 'N/A'})`)
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('updater:status-changed', status)
  }
}

function checkWindowsUpdate() {
  sendStatus({ status: 'checking' })
  autoUpdater.checkForUpdates().catch((err) => {
    log.error('[updater] Windows update check error:', err)
    sendStatus({ status: 'error', error: `Check failed: ${err.message}` })
  })
}

export function initUpdater(window: BrowserWindow) {
  mainWin = window

  // Bind IPC listeners
  ipcMain.handle('updater:get-status', () => currentStatus)
  ipcMain.handle('app:get-version', () => app.getVersion())

  ipcMain.handle('updater:check', () => {
    log.info('[updater] Manual check requested')
    if (process.platform === 'win32') {
      checkWindowsUpdate()
    }
  })

  ipcMain.handle('updater:install', () => {
    log.info('[updater] Windows install requested')
    if (process.platform === 'win32') {
      autoUpdater.quitAndInstall()
    }
  })

  ipcMain.handle('updater:open-mac-release', () => {
    log.info('[updater] Mac manual download redirection triggered')
    if (process.platform === 'darwin') {
      shell.openExternal('https://github.com/sameer786ss/OrchCode/releases/latest')
      app.quit()
    }
  })

  // Windows Auto-Updater configurations & event handlers
  if (process.platform === 'win32') {
    autoUpdater.logger = log
    autoUpdater.autoDownload = true // Automatically download update in background

    autoUpdater.on('checking-for-update', () => {
      sendStatus({ status: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      sendStatus({ status: 'available', version: info.version })
    })

    autoUpdater.on('update-not-available', (info) => {
      sendStatus({ status: 'idle', version: info.version })
    })

    autoUpdater.on('download-progress', (progressObj) => {
      sendStatus({
        status: 'downloading',
        version: currentStatus.version || 'latest',
        progress: Math.round(progressObj.percent)
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      sendStatus({ status: 'downloaded', version: info.version })
    })

    autoUpdater.on('error', (err) => {
      log.error('[updater] electron-updater error:', err)
      sendStatus({ status: 'error', error: err.message })
    })
  }

  // Run initial check after 6 seconds (Windows only)
  setTimeout(() => {
    log.info('[updater] Initial background update check')
    if (process.platform === 'win32') {
      checkWindowsUpdate()
    }
  }, 6000)

  // Recurrent update check (every 3 hours)
  setInterval(() => {
    log.info('[updater] Scheduled background update check')
    if (process.platform === 'win32') {
      checkWindowsUpdate()
    }
  }, 3 * 60 * 60 * 1000)
}
