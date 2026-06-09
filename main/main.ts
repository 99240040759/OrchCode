import 'dotenv/config'
import { init as initSentry } from '@sentry/electron'
initSentry({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN, tracesSampleRate: 1.0 })
import { app, BrowserWindow, shell, nativeTheme, dialog, Menu } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initUpdater } from './updater'
import { initAuth, getCurrentSession, handleAuthCallback, cleanupAuth } from './auth'
import windowStateKeeper from 'electron-window-state'
import log from 'electron-log'
import icon from '../resources/icon.png?asset'
import { checkpointDB } from './db'
import { registerAllIpc, cleanupAllPtys } from './commands'
import { registerStreamIpc } from './stream'
import { pool } from './workerPool'
import WindowManager from './windowManager'
import { APP_ID } from './paths'
import { initializeSkills } from './skills'
import { clearAllWorkspaceFilesCache } from './workspace'

app.setName('Orch Code')

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('orch-code', process.execPath, [join(__dirname, '../../')])
  }
} else {
  app.setAsDefaultProtocolClient('orch-code')
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  log.info('[main] Another instance is running. Quitting.')
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, commandLine) => {
  log.info('[main] second-instance event received with commandLine:', commandLine)
  const mainWin = WindowManager.getMainWindow()
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
    if (commandLine.includes('--new-conversation')) mainWin.webContents.send('command:new-conversation')
    if (commandLine.includes('--open-workspace')) mainWin.webContents.send('command:open-workspace')
    if (commandLine.includes('--clear-cache')) {
      clearAllWorkspaceFilesCache()
      dialog.showMessageBox(mainWin, { type: 'info', message: 'Workspace Cache Cleared', detail: 'The cached lists of project files have been successfully reset.' })
    }
  }
  const onboardingWin = onboardingWindow
  if (onboardingWin) {
    if (onboardingWin.isMinimized()) onboardingWin.restore()
    onboardingWin.focus()
  }
  const url = commandLine.find((arg) => arg.toLowerCase().includes('orch-code://'))
  if (url) handleAuthUrl(url)
})

function handleAuthUrl(urlStr: string) {
  try {
    const cleanedUrl = urlStr.replace(/^"+|"+$/g, '').trim()
    log.info('[main] Handling auth redirect URL:', cleanedUrl)
    const parsed = new URL(cleanedUrl)
    if (parsed.hostname === 'auth-callback') {
      const code = parsed.searchParams.get('code')
      const state = parsed.searchParams.get('state')
      const errorMsg = parsed.searchParams.get('error_description') || parsed.searchParams.get('error')
      if (code || errorMsg) {
        log.info('[main] Forwarding auth callback to auth module')
        void handleAuthCallback(code || '', state || '', errorMsg).catch(err => log.error('[main] Auth callback failed:', err))
      }
    }
  } catch (err: any) {
    log.error('[main] Failed to parse auth redirect URL:', err)
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.toLowerCase().includes('orch-code://')) {
    handleAuthUrl(url)
  }
})

log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.info('[main] Orch-Code starting...')

if (app.isPackaged) {
  log.warn('[main] Running in production mode.')
}
let mainWindow: BrowserWindow | null = null
let onboardingWindow: BrowserWindow | null = null

function createOnboardingWindow(): BrowserWindow {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show()
    onboardingWindow.focus()
    return onboardingWindow
  }
  onboardingWindow = new BrowserWindow({
    width: 480,
    height: 480,
    minWidth: 480,
    minHeight: 480,
    maxWidth: 480,
    maxHeight: 480,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: '#121212',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  onboardingWindow.on('ready-to-show', () => {
    onboardingWindow!.show()
    log.info('[main] Onboarding Window ready')
  })
  onboardingWindow.on('closed', () => {
    onboardingWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    onboardingWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?view=onboarding')
  } else {
    onboardingWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view: 'onboarding' }
    })
  }
  return onboardingWindow
}

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }
  const mainWindowState = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 800 })

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: '#1a1a1a',
            symbolColor: '#b4b4b4',
            height: 40
          }
        : false,
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: '#121212',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  WindowManager.setMainWindow(mainWindow)
  mainWindowState.manage(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    log.info('[main] Window ready')
    if (process.argv.includes('--new-conversation')) mainWindow!.webContents.send('command:new-conversation')
    if (process.argv.includes('--open-workspace')) mainWindow!.webContents.send('command:open-workspace')
    if (process.argv.includes('--clear-cache')) {
      clearAllWorkspaceFilesCache()
      dialog.showMessageBox(mainWindow!, { type: 'info', message: 'Workspace Cache Cleared', detail: 'The cached lists of project files have been successfully reset.' })
    }
  })
  mainWindow.on('closed', () => {
    const browserView = WindowManager.getBrowserView()
    if (browserView) {
      try {
        browserView.webContents.close()
      } catch {}
      WindowManager.setBrowserView(null)
    }
    cleanupAllPtys()
    mainWindow = null
    WindowManager.setMainWindow(null)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  electronApp.setAppUserModelId(APP_ID)

  if (process.platform === 'darwin' && app.dock) {
    const dockMenu = Menu.buildFromTemplate([
      { label: 'New Conversation', click() { const win = WindowManager.getMainWindow(); if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('command:new-conversation') } } },
      { label: 'Open Project Folder...', click() { const win = WindowManager.getMainWindow(); if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('command:open-workspace') } } },
      { label: 'Clear Workspace Cache', click() { clearAllWorkspaceFilesCache(); const win = WindowManager.getMainWindow(); if (win && !win.isDestroyed()) dialog.showMessageBox(win, { type: 'info', message: 'Workspace Cache Cleared', detail: 'The cached lists of project files have been successfully reset.' }) } }
    ])
    app.dock.setMenu(dockMenu)
  } else if (process.platform === 'win32') {
    app.setUserTasks([
      { program: process.execPath, arguments: '--new-conversation', iconPath: process.execPath, iconIndex: 0, title: 'New Conversation', description: 'Start a new chat thread' },
      { program: process.execPath, arguments: '--open-workspace', iconPath: process.execPath, iconIndex: 0, title: 'Open Project Folder...', description: 'Select and open a project folder' },
      { program: process.execPath, arguments: '--clear-cache', iconPath: process.execPath, iconIndex: 0, title: 'Clear Workspace Cache', description: 'Reset cached project files list' }
    ])
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          shell.openExternal(parsed.toString()).catch(err => log.error('[main] Failed to open external URL:', err))
        }
      } catch {}
      return { action: 'deny' }
    })
  })

  log.info('[main] App ready — initializing modules')

  // Single unified IPC surface: one invoke router + one stream handler
  registerAllIpc()
  registerStreamIpc()

  void initializeSkills().catch((err) => log.error('[main] Failed to initialize skills asynchronously:', err))
  initUpdater()
  await initAuth()
  const startupUrl = process.argv.find((arg) => arg.toLowerCase().includes('orch-code://'))
  if (startupUrl) {
    handleAuthUrl(startupUrl)
  }
  const authSession = getCurrentSession()
  if (authSession) {
    createMainWindow()
  } else {
    createOnboardingWindow()
  }

  ;(app as Electron.App).on('auth:open-main-and-close-onboarding' as never, () => {
    log.info('[main] Onboarding completed, transitioning to main window...')
    const main = createMainWindow()
    main.once('ready-to-show', () => {
      main.show()
      if (onboardingWindow) {
        onboardingWindow.close()
        onboardingWindow = null
      }
    })
  })
  ;(app as Electron.App).on('auth:logged-out' as never, () => {
    log.info('[main] User logged out, showing onboarding window...')
    createOnboardingWindow()
    if (mainWindow) {
      mainWindow.close()
      mainWindow = null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (getCurrentSession()) createMainWindow()
      else createOnboardingWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAllPtys()
    log.info('[main] Cleaned up — quitting')
    app.quit()
  }
})

let isQuitting = false
app.on('before-quit', async (e) => {
  if (!isQuitting) {
    e.preventDefault()
    cleanupAuth()
    cleanupAllPtys()
    try { await pool.shutdown() } catch {}
    try { checkpointDB() } catch {}
    isQuitting = true
    app.quit()
  }
})
