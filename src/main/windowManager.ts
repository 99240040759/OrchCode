import { BrowserWindow, WebContentsView } from 'electron'

class WindowManager {
  private static mainWindow: BrowserWindow | null = null
  private static browserView: WebContentsView | null = null

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

  static clear() {
    this.mainWindow = null
    this.browserView = null
  }
}

export default WindowManager
