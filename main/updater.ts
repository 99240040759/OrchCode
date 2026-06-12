import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}

let currentStatus: UpdateStatus = { status: 'idle' }

export function getCurrentUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function triggerUpdateCheck() {
  if (process.platform === 'win32') checkWindowsUpdate()
  else if (process.platform === 'darwin') checkMacUpdate()
}

export function triggerInstall() {
  if (process.platform === 'win32') autoUpdater.quitAndInstall()
}

function sendStatus(status: UpdateStatus) {
  currentStatus = status
  log.info(
    `[updater] Status: ${status.status} (version: ${status.version || 'unknown'}, progress: ${status.progress ?? 'N/A'})`
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

const isNewerVersion = (l: string, c: string): boolean => {
  const strip = (v: string) => v.replace(/^v/, '')
  const semver = (v: string) => strip(v).split('-')[0].split('.').map(Number)
  const preTag = (v: string) => { const parts = strip(v).split('-'); return parts.length > 1 ? parts.slice(1).join('-') : null }
  const [lM, lm, lP] = semver(l), [cM, cm, cP] = semver(c)
  if (isNaN(lM) || isNaN(cM)) return l !== c
  if (lM !== cM) return lM > cM
  if (lm !== cm) return lm > cm
  if (lP !== cP) return lP > cP
  // Same major.minor.patch — stable (no pre-release) > pre-release
  const lPre = preTag(l), cPre = preTag(c)
  if (!lPre && cPre) return true   // latest is stable, current is pre-release → newer
  if (lPre && !cPre) return false  // latest is pre-release, current is stable → not newer
  if (lPre && cPre) return lPre > cPre // both pre-release — lexicographic compare
  return false // both stable, same version
}

async function checkMacUpdate() {
  sendStatus({ status: 'checking' })
  try {
    const currentVersion = app.getVersion()
    const res = await fetch('https://api.github.com/repos/sameer786ss/OrchCode/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) sendStatus({ status: 'error', error: 'Rate limited by GitHub. Try again later.' })
      else sendStatus({ status: 'idle' })
      return
    }
    const data = await res.json()
    const latestVersion: string = data.tag_name?.replace(/^v/, '') ?? ''
    const hasUpdate = !!latestVersion && isNewerVersion(latestVersion, currentVersion)
    sendStatus(hasUpdate ? { status: 'available', version: latestVersion } : { status: 'idle', version: latestVersion })
  } catch (err: any) {
    sendStatus({ status: 'error', error: err.message })
  }
}

export function initUpdater() {
  if (!app.isPackaged) {
    log.info('[updater] Dev environment detected. Skipping update checks.')
    return
  }

  if (process.platform === 'win32') {
    autoUpdater.logger = log
    autoUpdater.autoDownload = true

    autoUpdater.on('checking-for-update', () => sendStatus({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => sendStatus({ status: 'available', version: info.version }))
    autoUpdater.on('update-not-available', (info) => sendStatus({ status: 'idle', version: info.version }))
    autoUpdater.on('download-progress', (progressObj) => sendStatus({
      status: 'downloading',
      version: currentStatus.version || 'latest',
      progress: Math.round(progressObj.percent)
    }))
    autoUpdater.on('update-downloaded', (info) => sendStatus({ status: 'downloaded', version: info.version }))
    autoUpdater.on('error', (err) => {
      log.error('[updater] electron-updater error:', err)
      sendStatus({ status: 'error', error: err.message })
    })
  }

  setTimeout(() => {
    log.info('[updater] Initial background update check')
    if (process.platform === 'win32') checkWindowsUpdate()
    else checkMacUpdate()
  }, 6000)

  setInterval(() => {
    log.info('[updater] Scheduled background update check')
    if (process.platform === 'win32') checkWindowsUpdate()
    else checkMacUpdate()
  }, 3 * 60 * 60 * 1000)
}
