import type { BrowserWindow, WebContentsView } from 'electron'

class WindowManager {
  private static mainWindow: BrowserWindow | null = null
  private static browserView: WebContentsView | null = null
  private static browserConversationId: string | null = null

  static setMainWindow(win: BrowserWindow | null) { this.mainWindow = win }
  static getMainWindow(): BrowserWindow | null { return this.mainWindow }
  static setBrowserView(view: WebContentsView | null) { this.browserView = view }
  static getBrowserView(): WebContentsView | null { return this.browserView }
  static setBrowserConversationId(id: string | null) { this.browserConversationId = id }
  static getBrowserConversationId(): string | null { return this.browserConversationId }
  static clear() { this.mainWindow = null; this.browserView = null; this.browserConversationId = null }
}

export default WindowManager
