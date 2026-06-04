import 'dotenv/config'
import crypto from 'node:crypto'
import { ipcMain, BrowserWindow, WebContentsView } from 'electron'
import log from 'electron-log'
import pty from 'node-pty'
import { getWorkspaceContext } from './workspace'
import { startBrowserAgentWorker, stopBrowserAgentWorker } from './tools'

export const activePtys = new Map<string, ReturnType<typeof pty.spawn>>()

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
      const workingDir =
        cwd || (convCtx?.isUserWorkspace ? convCtx.rootPath : undefined) || process.env.HOME || '/'

      log.info(`[terminal] Spawning ${shell} in ${workingDir} (${cols}x${rows})`)

      let ptyProcess: any
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

      let dataListener: any
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
      activePtys.get(id)?.write(data)
    } catch (err) {
      log.error(`[terminal:input] error writing to ${id}:`, err)
    }
  })

  ipcMain.handle(
    'terminal:resize',
    (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      try {
        const p = activePtys.get(id)
        if (p) p.resize(Math.max(cols, 10), Math.max(rows, 3))
      } catch (err) {
        log.error(`[terminal:resize] error resizing ${id}:`, err)
      }
    }
  )

  ipcMain.handle('terminal:close', (_event, { id }: { id: string }) => {
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
    }
  })

  ipcMain.handle(
    'browser:open',
    (
      event,
      {
        url,
        bounds
      }: { url: string; bounds: { x: number; y: number; width: number; height: number } }
    ) => {
      const mainWindow = (globalThis as unknown as { mainWindow?: BrowserWindow }).mainWindow
      if (!mainWindow) return

      let browserView = (globalThis as unknown as { browserView?: WebContentsView | null }).browserView

      if (browserView) {
        browserView.setBounds(bounds)
        browserView.webContents.loadURL(url || 'about:blank')
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
      ;(globalThis as unknown as { browserView?: WebContentsView }).browserView = browserView

      mainWindow.contentView.addChildView(browserView)
      browserView.setBounds(bounds)
      browserView.webContents.loadURL(url || 'https://google.com')

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
    const browserView = (globalThis as unknown as { browserView?: WebContentsView }).browserView
    if (browserView) browserView.webContents.loadURL(url.startsWith('http') ? url : `https://${url}`)
  })

  ipcMain.handle('browser:back', () => {
    const browserView = (globalThis as unknown as { browserView?: WebContentsView }).browserView
    if (browserView?.webContents.canGoBack()) browserView.webContents.goBack()
  })

  ipcMain.handle('browser:forward', () => {
    const browserView = (globalThis as unknown as { browserView?: WebContentsView }).browserView
    if (browserView?.webContents.canGoForward()) browserView.webContents.goForward()
  })

  ipcMain.handle('browser:reload', () => {
    const browserView = (globalThis as unknown as { browserView?: WebContentsView }).browserView
    browserView?.webContents.reload()
  })

  ipcMain.handle(
    'browser:resize',
    (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      const browserView = (globalThis as unknown as { browserView?: WebContentsView }).browserView
      browserView?.setBounds(bounds)
    }
  )

  ipcMain.handle('browser:close', () => {
    const mainWindow = (globalThis as unknown as { mainWindow?: BrowserWindow }).mainWindow
    let browserView = (globalThis as unknown as { browserView?: WebContentsView | null }).browserView

    if (browserView && mainWindow) {
      try {
        mainWindow.contentView.removeChildView(browserView)
        browserView.webContents.close()
      } catch {}
      ;(globalThis as unknown as { browserView?: WebContentsView | null }).browserView = null
      log.info('[browser] Closed')
      stopBrowserAgentWorker()
    }
  })
}
