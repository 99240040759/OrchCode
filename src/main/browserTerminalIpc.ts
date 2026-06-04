import 'dotenv/config'
import crypto from 'node:crypto'
import { ipcMain, WebContentsView } from 'electron'
import log from 'electron-log'
import pty from 'node-pty'
import { assertWithinWorkspace, getWorkspaceContext } from './workspace'
import { startBrowserAgentWorker, stopBrowserAgentWorker } from './tools'
import WindowManager from './windowManager'

const activePtys = new Map<string, ReturnType<typeof pty.spawn>>()
const activePtyOwners = new Map<string, number>()

function normalizeBrowserUrl(value: string): string {
  const candidate = value.trim()
  if (!candidate || candidate === 'about:blank') return 'about:blank'
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  const parsed = new URL(withProtocol)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported browser URL protocol: ${parsed.protocol}`)
  }
  return parsed.toString()
}

function normalizeBounds(bounds: { x: number; y: number; width: number; height: number }) {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!values.every(Number.isFinite)) throw new Error('Browser bounds must be finite numbers.')
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  }
}

export function cleanupAllPtys() {
  activePtys.forEach((p) => {
    try {
      if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT')
      else p.kill()
    } catch {
      try {
        p.kill()
      } catch {}
    }
  })
  activePtys.clear()
  activePtyOwners.clear()
}

export function registerBrowserTerminalIpc() {
  ipcMain.handle(
    'terminal:create',
    (
      event,
      {
        cols,
        rows,
        cwd,
        conversationId
      }: { cols: number; rows: number; cwd?: string; conversationId?: string }
    ) => {
      const id = `pty-${crypto.randomUUID()}`
      const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

      const convCtx = conversationId ? getWorkspaceContext(conversationId) : undefined
      const workingDir = convCtx
        ? cwd
          ? assertWithinWorkspace(convCtx.rootPath, cwd, conversationId)
          : convCtx.rootPath
        : process.env.HOME || process.cwd()

      log.info(`[terminal] Spawning ${shell} in ${workingDir} (${cols}x${rows})`)

      let ptyProcess: ReturnType<typeof pty.spawn>
      try {
        ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: Math.max(cols, 10),
          rows: Math.max(rows, 3),
          cwd: workingDir,
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        })
      } catch (err: any) {
        log.error('[terminal:create] Failed to spawn PTY shell:', err)
        throw new Error(`Failed to initialize shell process: ${err.message}`)
      }

      activePtys.set(id, ptyProcess)
      activePtyOwners.set(id, event.sender.id)

      let dataListener: ReturnType<ReturnType<typeof pty.spawn>['onData']> | undefined
      const destroyListener = () => {
        try {
          if (dataListener) dataListener.dispose()
          if (process.platform !== 'win32') process.kill(-ptyProcess.pid, 'SIGINT')
          else ptyProcess.kill()
        } catch {
          try {
            ptyProcess.kill()
          } catch {}
        }
        activePtys.delete(id)
        activePtyOwners.delete(id)
      }
      event.sender.once('destroyed', destroyListener)

      dataListener = ptyProcess.onData((data) => {
        if (event.sender.isDestroyed()) {
          destroyListener()
          event.sender.off('destroyed', destroyListener)
          return
        }
        try {
          event.sender.send('terminal:data', { id, data })
        } catch {}
      })

      ptyProcess.onExit(({ exitCode }) => {
        event.sender.off('destroyed', destroyListener)
        activePtys.delete(id)
        activePtyOwners.delete(id)
        try {
          event.sender.send('terminal:exit', { id, exitCode })
        } catch {}
        log.info(`[terminal] PTY ${id} exited with code ${exitCode}`)
      })

      return { id }
    }
  )

  ipcMain.handle('terminal:input', (_event, { id, data }: { id: string; data: string }) => {
    try {
      if (activePtyOwners.get(id) !== _event.sender.id) return
      if (data.length > 64 * 1024) throw new Error('Terminal input exceeds 64 KB.')
      activePtys.get(id)?.write(data)
    } catch (err) {
      log.error(`[terminal:input] error writing to ${id}:`, err)
    }
  })

  ipcMain.handle(
    'terminal:resize',
    (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      try {
        if (activePtyOwners.get(id) !== _event.sender.id) return
        const p = activePtys.get(id)
        if (p) p.resize(Math.max(cols, 10), Math.max(rows, 3))
      } catch (err) {
        log.error(`[terminal:resize] error resizing ${id}:`, err)
      }
    }
  )

  ipcMain.handle('terminal:close', (_event, { id }: { id: string }) => {
    if (activePtyOwners.get(id) !== _event.sender.id) return
    const p = activePtys.get(id)
    if (p) {
      try {
        if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT')
        else p.kill()
      } catch {
        try {
          p.kill()
        } catch {}
      }
      activePtys.delete(id)
      activePtyOwners.delete(id)
    }
  })

  ipcMain.handle(
    'browser:open',
    async (
      event,
      {
        url,
        bounds
      }: { url: string; bounds: { x: number; y: number; width: number; height: number } }
    ) => {
      const mainWindow = WindowManager.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('Main window is not available.')
      }

      let browserView = WindowManager.getBrowserView()

      if (browserView) {
        browserView.setBounds(normalizeBounds(bounds))
        await browserView.webContents.loadURL(normalizeBrowserUrl(url))
        return
      }

      browserView = new WebContentsView({
        webPreferences: {
          webSecurity: true,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })
      WindowManager.setBrowserView(browserView)

      mainWindow.contentView.addChildView(browserView)
      browserView.setBounds(normalizeBounds(bounds))
      await browserView.webContents.loadURL(normalizeBrowserUrl(url || 'https://google.com'))

      browserView.webContents.on('page-title-updated', (_e, title) => {
        try {
          event.sender.send('browser:title-updated', title)
        } catch {}
      })
      browserView.webContents.on('did-navigate', (_e, navUrl) => {
        try {
          event.sender.send('browser:url-changed', navUrl)
        } catch {}
        try {
          const worker = startBrowserAgentWorker()
          if (worker) worker.syncUrl(navUrl).catch(() => {})
        } catch {}
      })
      browserView.webContents.on('did-navigate-in-page', (_e, navUrl) => {
        try {
          event.sender.send('browser:url-changed', navUrl)
        } catch {}
        try {
          const worker = startBrowserAgentWorker()
          if (worker) worker.syncUrl(navUrl).catch(() => {})
        } catch {}
      })

      log.info(`[browser] Opened: ${url}`)
      startBrowserAgentWorker()
    }
  )

  ipcMain.handle('browser:navigate', (_event, url: string) => {
    const browserView = WindowManager.getBrowserView()
    if (!browserView) throw new Error('Browser panel is not open.')
    return browserView.webContents.loadURL(normalizeBrowserUrl(url))
  })

  ipcMain.handle('browser:back', () => {
    const browserView = WindowManager.getBrowserView()
    if (browserView?.webContents.canGoBack()) browserView.webContents.goBack()
  })

  ipcMain.handle('browser:forward', () => {
    const browserView = WindowManager.getBrowserView()
    if (browserView?.webContents.canGoForward()) browserView.webContents.goForward()
  })

  ipcMain.handle('browser:reload', () => {
    const browserView = WindowManager.getBrowserView()
    browserView?.webContents.reload()
  })

  ipcMain.handle(
    'browser:resize',
    (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      const browserView = WindowManager.getBrowserView()
      browserView?.setBounds(normalizeBounds(bounds))
    }
  )

  ipcMain.handle('browser:close', async () => {
    const mainWindow = WindowManager.getMainWindow()
    const browserView = WindowManager.getBrowserView()

    if (browserView && mainWindow) {
      try {
        mainWindow.contentView.removeChildView(browserView)
        browserView.webContents.close()
      } catch {}
    }
    WindowManager.setBrowserView(null)
    await stopBrowserAgentWorker()
    log.info('[browser] Closed')
  })
}
