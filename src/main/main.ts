import 'dotenv/config'
import { init as initSentry } from '@sentry/electron'
import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initUpdater } from './updater'
import { initAuth, getCurrentSession, handleAuthCallback } from './auth'
import windowStateKeeper from 'electron-window-state'
import log from 'electron-log'
import icon from '../../resources/icon.png?asset'
import { checkpointDB } from './db'
import { registerAllIpc, cleanupAllPtys } from './ipc/commands'
import { registerStreamIpc } from './agent/stream'
import { pool } from './agent/workerPool'
import WindowManager from './windowManager'
import { APP_ID } from './paths'
import { initializeSkills } from './skills'

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
  const mainWin = WindowManager.getMainWindow()
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
  }
  const onboardingWin = onboardingWindow
  if (onboardingWin) {
    if (onboardingWin.isMinimized()) onboardingWin.restore()
    onboardingWin.focus()
  }
  const url = commandLine.pop()
  if (url && url.startsWith('orch-code://')) {
    handleAuthUrl(url)
  }
})

function handleAuthUrl(urlStr: string) {
  try {
    const parsed = new URL(urlStr)
    if (parsed.hostname === 'auth-callback') {
      const code = parsed.searchParams.get('code')
      if (code) {
        log.info('[main] Forwarding auth callback code to auth module')
        void handleAuthCallback(code)
      }
    }
  } catch (err: any) {
    log.error('[main] Failed to parse auth redirect URL:', err)
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('orch-code://')) {
    handleAuthUrl(url)
  }
})

initSentry({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN && (app.isPackaged || process.env.NODE_ENV === 'production'),
  tracesSampleRate: 0.1
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

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          void shell.openExternal(parsed.toString())
        }
      } catch {}
      return { action: 'deny' }
    })
  })

  log.info('[main] App ready — initializing modules')

  // Single unified IPC surface: one invoke router + one stream handler
  registerAllIpc()
  registerStreamIpc()

  await initializeSkills()
  initUpdater()
  await initAuth()
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

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    cleanupAllPtys()
    log.info('[main] Cleaned up — quitting')
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanupAllPtys()
  checkpointDB()
  void pool.shutdown()
})
