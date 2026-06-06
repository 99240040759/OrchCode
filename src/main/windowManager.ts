class WindowManager {
  private static mainWindow: any = null
  private static browserView: any = null
  private static debuggingPort = 9222
  static setMainWindow(win: any) { this.mainWindow = win }
  static getMainWindow(): any { return this.mainWindow }
  static setBrowserView(view: any) { this.browserView = view }
  static getBrowserView(): any { return this.browserView }
  static setDebuggingPort(port: number) { this.debuggingPort = port }
  static getDebuggingPort(): number { return this.debuggingPort }
  static clear() { this.mainWindow = null; this.browserView = null }
}
export default WindowManager
