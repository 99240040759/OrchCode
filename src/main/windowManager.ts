import { BrowserWindow, WebContentsView } from 'electron'

class WindowManager {
  private static mainWindow: BrowserWindow | null = null
  private static browserView: WebContentsView | null = null
  private static debuggingPort = 9222

  static setMainWindow(win: BrowserWindow | null) {
    this.mainWindow = win
  }

  static getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  static setBrowserView(view: WebContentsView | null) {
    this.browserView = view
  }

  static getBrowserView(): WebContentsView | null {
    return this.browserView
  }

  static setDebuggingPort(port: number) {
    this.debuggingPort = port
  }

  static getDebuggingPort(): number {
    return this.debuggingPort
  }

  static clear() {
    this.mainWindow = null
    this.browserView = null
  }
}

export default WindowManager
