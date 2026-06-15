import 'dotenv/config'
import { init as initSentry } from '@sentry/electron/main'
initSentry({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN, tracesSampleRate: 1.0 })
import { app, BrowserWindow, shell, nativeTheme, Menu } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initUpdater } from './updater'
import { initAuth, getCurrentSession, handleAuthCallback, cleanupAuth, authEvents } from './auth'
import windowStateKeeper from 'electron-window-state'
import log from 'electron-log'
import icon from '../resources/icon.png?asset'
import { checkpointDB } from './db'
import { registerAllIpc, cleanupAllPtys } from './commands'
import { registerStreamIpc } from './stream'
import { pool } from './workerPool'
import WindowManager, { APP_ID } from './utils'
import { initializeSkills } from './skills'
import { showSettingsWindow, closeSettingsWindow } from './settingsWindow'

app.commandLine.appendSwitch('remote-debugging-port', '9888')
process.env.REMOTE_DEBUGGING_PORT = '9888'
app.setName('Orch Code')
if (process.platform === 'darwin') {
  require('child_process').exec(`${process.env.SHELL || '/bin/zsh'} -l -c "echo \\$PATH"`, { encoding: 'utf8' }, (err, stdout) => {
    if (err) { log.error('[main] Failed to load macOS PATH:', err); return }
    const p = stdout.trim()
    if (p) process.env.PATH = p
  })
}


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
  app.exit(0)
}

function handleCommandLineArgs(argv: string[], win: BrowserWindow) {
  if (argv.includes('--new-conversation')) win.webContents.send('command:new-conversation')
  if (argv.includes('--open-workspace')) win.webContents.send('command:open-workspace')
}

app.on('second-instance', (_event, commandLine) => {
  log.info('[main] second-instance event received with commandLine:', commandLine)
  const mainWin = WindowManager.getMainWindow()
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
    handleCommandLineArgs(commandLine, mainWin)
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
    trafficLightPosition: { x: 10, y: 13 },
    backgroundColor: '#0d0d0d',
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      enableBlinkFeatures: 'SharedArrayBuffer'
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
    minWidth: 520,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hidden',
    trafficLightPosition: process.platform === 'darwin' ? { x: 10, y: 13 } : undefined,
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#161616',
      symbolColor: '#c8ccd4',
      height: 38
    } : undefined,
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      enableBlinkFeatures: 'SharedArrayBuffer'
    }
  })
  WindowManager.setMainWindow(mainWindow)
  mainWindowState.manage(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    log.info('[main] Window ready')
    handleCommandLineArgs(process.argv, mainWindow!)
  })
  mainWindow.on('closed', () => {
    WindowManager.clearAllSessions()
    cleanupAllPtys()
    closeSettingsWindow()
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
      { label: 'Open Project Folder...', click() { const win = WindowManager.getMainWindow(); if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('command:open-workspace') } } }
    ])
    app.dock.setMenu(dockMenu)
  } else if (process.platform === 'win32') {
    app.setUserTasks([
      { program: process.execPath, arguments: '--new-conversation', iconPath: process.execPath, iconIndex: 0, title: 'New Conversation', description: 'Start a new chat thread' },
      { program: process.execPath, arguments: '--open-workspace', iconPath: process.execPath, iconIndex: 0, title: 'Open Project Folder...', description: 'Select and open a project folder' }
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
      } catch (err) { log.debug('[main] Failed to handle window.open URL:', err) }
      return { action: 'deny' }
    })
  })

  log.info('[main] App ready — initializing modules')

  
  const sendToMain = (channel: string) => {
    const win = WindowManager.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel)
  }
  const appMenu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Conversation', accelerator: 'CmdOrCtrl+N', click: () => sendToMain('command:new-conversation') },
        { label: 'Open Project Folder...', accelerator: 'CmdOrCtrl+O', click: () => sendToMain('command:open-workspace') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => showSettingsWindow() },
        { type: 'separator' as const },
        process.platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+B', click: () => sendToMain('shortcut:toggle-sidebar') },
        { label: 'Toggle Artifact Panel', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendToMain('shortcut:toggle-artifacts') },
        { label: 'Focus Input', accelerator: 'CmdOrCtrl+L', click: () => sendToMain('shortcut:focus-input') },
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+`', click: () => sendToMain('shortcut:toggle-terminal') },
        { type: 'separator' as const },
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    }
  ])
  Menu.setApplicationMenu(appMenu)

  
  registerAllIpc()
  registerStreamIpc()
  pool.preWarm()

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

  authEvents.on('open-main-and-close-onboarding', () => {
    log.info('[main] Onboarding completed, transitioning to main window...')
    const main = createMainWindow()
    const closeOnboarding = () => {
      if (onboardingWindow && !onboardingWindow.isDestroyed()) { onboardingWindow.close(); onboardingWindow = null }
    }
    if (main.isVisible()) {
      main.focus()
      closeOnboarding()
    } else {
      main.once('ready-to-show', () => { main.show(); closeOnboarding() })
    }
  })
  authEvents.on('logged-out', () => {
    log.info('[main] User logged out, showing onboarding window...')
    closeSettingsWindow()
    createOnboardingWindow()
    if (mainWindow) {
      mainWindow.close()
      mainWindow = null
      WindowManager.setMainWindow(null)
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
    try { await pool.shutdown() } catch (err) { log.debug('[main] Pool shutdown error:', err) }
    try { await checkpointDB() } catch (err) { log.debug('[main] Checkpoint DB error:', err) }
    isQuitting = true
    app.quit()
  }
})
