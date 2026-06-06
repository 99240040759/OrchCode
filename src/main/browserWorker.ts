import { expose } from 'comlink'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

let mainWindowUrl: string | undefined
let debuggingPort: number | undefined

process.parentPort.once('message', ({ data, ports }) => {
  mainWindowUrl = data.mainWindowUrl
  debuggingPort = data.debuggingPort
  const port = ports[0]
  const comlinkEndpoint = {
    addEventListener: (t: string, l: any) => t === 'message' && port.on('message', (e: any) => l({ data: e.data, ports: e.ports })),
    removeEventListener: (t: string, l: any) => t === 'message' && port.off('message', l),
    postMessage: (m: any, tr?: any) => port.postMessage(m, tr),
    start: () => port.start(),
    close: () => port.close()
  }
  expose(workerAPI, comlinkEndpoint as any)
  port.start()
})

let browser: Browser | null = null
let context: BrowserContext | null = null
let page: Page | null = null
let intentionalPageUrl: string | null = null

const getTargetLocator = (p: Page, sel: string, f?: string) => f ? p.frameLocator(f).locator(sel) : p.locator(sel)

const workerAPI = {
  async connect(url?: string) {
    try {
      browser = null; context = null; page = null
      browser = await chromium.connectOverCDP(`http://localhost:${debuggingPort || 9222}`)
      context = browser.contexts()[0]
      const pages = context.pages()

      const browserPages = pages.filter((p) => {
        const u = p.url(), lowerUrl = u.toLowerCase()
        if (mainWindowUrl) {
          const mainUrlLower = mainWindowUrl.toLowerCase()
          if (lowerUrl === mainUrlLower || lowerUrl.startsWith(mainUrlLower)) return false
          if (mainUrlLower.includes('localhost') && lowerUrl.startsWith(mainUrlLower.replace('localhost', '127.0.0.1'))) return false
          if (mainUrlLower.includes('127.0.0.1') && lowerUrl.startsWith(mainUrlLower.replace('127.0.0.1', 'localhost'))) return false
        }
        if (lowerUrl.startsWith('chrome-extension://') || lowerUrl.startsWith('devtools://')) return false
        if (u.startsWith('file://')) {
          const filename = u.split(/[/\\]/).pop() || ''
          if (['index.html', 'app.html'].includes(filename.toLowerCase()) || u.includes('/out/renderer/')) return false
        }
        return true
      })

      if (browserPages.length > 0) {
        const urlMatch = (p: Page, matchUrl: string) => p.url() === matchUrl || p.url().startsWith(matchUrl.split('?')[0])
        if (url) { intentionalPageUrl = url; page = browserPages.find(p => urlMatch(p, url)) ?? browserPages[0] }
        else if (intentionalPageUrl) { page = browserPages.find(p => urlMatch(p, intentionalPageUrl!)) ?? browserPages[0] }
        else { page = browserPages[browserPages.length - 1] ?? browserPages[0] }
      } else throw new Error('No active Browser View page found.')

      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  },

  async ensurePage(url?: string): Promise<{ ok: boolean; error?: string }> {
    if (page && context) {
      try {
        if (!page.isClosed()) {
          await page.url()
          if (url && page.url() !== url && !page.url().startsWith(url.split('?')[0])) {
            const found = context.pages().find(p => p.url() === url || p.url().startsWith(url.split('?')[0]))
            if (found) page = found
          }
          return { ok: true }
        }
      } catch {}
      page = null; context = null
    }
    const res = await this.connect(url)
    return { ok: res.success, error: res.error }
  },

  async navigate(url: string) {
    const ready = await this.ensurePage(url)
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      const target = url.startsWith('http') ? url : `https://${url}`
      intentionalPageUrl = target
      await page!.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
      return { success: true, url: page!.url() }
    } catch (err: any) { return { success: false, error: err.message } }
  },

  async syncUrl(url: string) {
    try {
      intentionalPageUrl = url
      if (page) {
        try {
          if (page.url() !== url && context) {
            const found = context.pages().find(p => p.url() === url)
            if (found) page = found
          }
        } catch { page = null }
      }
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  },

  async type(selector: string, text: string, frameSelector?: string) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      const locator = getTargetLocator(page!, selector, frameSelector)
      await locator.waitFor({ state: 'visible', timeout: 15000 })
      await locator.fill(text, { timeout: 15000 })
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  },

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      const dist = amount || 400
      let x = 0, y = 0
      if (direction === 'up') y = -dist
      else if (direction === 'down') y = dist
      else if (direction === 'left') x = -dist
      else if (direction === 'right') x = dist
      await page!.evaluate(({ x, y }) => window.scrollBy(x, y), { x, y })
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  },

  async screenshot(filePath: string) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try { await page!.screenshot({ path: filePath }); return { success: true } }
    catch (err: any) { return { success: false, error: err.message } }
  },

  async mouseClickCoordinate(x: number, y: number, button?: 'left' | 'right' | 'middle') {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try { await page!.mouse.click(x, y, { button: button || 'left' }); return { success: true } }
    catch (err: any) { return { success: false, error: err.message } }
  },

  async getPageContent() {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      const url = page!.url(), title = await page!.title(), text = await page!.evaluate(() => document.body.innerText || '')
      const elements = await page!.evaluate(() => {
        const interactive: any[] = []
        document.querySelectorAll('button, input, select, textarea, a, [role="button"]').forEach((el) => {
          if (interactive.length >= 100) return
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            interactive.push({
              tagName: el.tagName.toLowerCase(), id: el.id || undefined, className: el.className || undefined,
              text: (el.textContent || '').trim().slice(0, 80) || undefined, placeholder: (el as any).placeholder || undefined,
              name: (el as any).name || undefined, type: (el as any).type || undefined, value: (el as any).value || undefined
            })
          }
        })
        return interactive
      })
      return { success: true, url, title, text: text.slice(0, 15000), interactiveElements: elements }
    } catch (err: any) { return { success: false, error: err.message } }
  },

  async disconnect() {
    try { browser = null; context = null; page = null; return { success: true } }
    catch (err: any) { return { success: false, error: err.message } }
  }
}

export type WorkerAPI = typeof workerAPI
