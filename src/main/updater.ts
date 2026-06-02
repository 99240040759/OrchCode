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

function sendStatus(status: UpdateStatus) {
  currentStatus = status
  log.info(
    `[updater] Status transition: ${status.status} (version: ${status.version || 'unknown'}, progress: ${status.progress ?? 'N/A'})`
  )
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status-changed', status)
    }
  })
}

function checkWindowsUpdate() {
  sendStatus({ status: 'checking' })
  autoUpdater.checkForUpdates().catch((err) => {
    log.error('[updater] Windows update check error:', err)
  })
}

export function initUpdater() {
  ipcMain.handle('updater:get-status', () => currentStatus)
  ipcMain.handle('app:get-version', () => app.getVersion())

  if (!app.isPackaged) {
    log.info('[updater] Dev environment detected. Skipping update checks.')
    return
  }

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

  ipcMain.handle('updater:open-mac-release', async () => {
    log.info('[updater] Mac manual download redirection triggered')
    if (process.platform === 'darwin') {
      await shell.openExternal('https://github.com/sameer786ss/OrchCode/releases/latest')
      app.quit()
    }
  })

  if (process.platform === 'win32') {
    autoUpdater.logger = log
    autoUpdater.autoDownload = true

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

  setTimeout(() => {
    log.info('[updater] Initial background update check')
    if (process.platform === 'win32') {
      checkWindowsUpdate()
    }
  }, 6000)

  setInterval(
    () => {
      log.info('[updater] Scheduled background update check')
      if (process.platform === 'win32') {
        checkWindowsUpdate()
      }
    },
    3 * 60 * 60 * 1000
  )
}
