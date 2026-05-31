import { parentPort } from 'worker_threads'
import { expose } from 'comlink'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

let browser: Browser | null = null
let context: BrowserContext | null = null
let page: Page | null = null
let intentionalPageUrl: string | null = null

function getTargetLocator(page: Page, selector: string, frameSelector?: string) {
  if (frameSelector) {
    return page.frameLocator(frameSelector).locator(selector)
  }
  return page.locator(selector)
}

function nodeAdapter(port: any): any {
  const listeners = new WeakMap()
  return {
    postMessage(message: any, transfer?: any[]) {
      port.postMessage(message, transfer)
    },
    addEventListener(type: string, eh: any) {
      if (type === 'message') {
        const l = (data: any) => {
          if (eh && typeof eh === 'object' && 'handleEvent' in eh) {
            eh.handleEvent({ data })
          } else {
            eh({ data })
          }
        }
        port.on('message', l)
        listeners.set(eh, l)
      }
    },
    removeEventListener(type: string, eh: any) {
      if (type === 'message') {
        const l = listeners.get(eh)
        if (l) {
          port.off('message', l)
          listeners.delete(eh)
        }
      }
    }
  }
}

const workerAPI = {
  async connect(url?: string) {
    try {
      if (browser) {
        try { await browser.close() } catch {}
      }
      browser = await chromium.connectOverCDP('http://localhost:9222')
      context = browser.contexts()[0]
      const pages = context.pages()

      if (url) {
        // Select the page that matches the explicitly opened URL
        intentionalPageUrl = url
        page = pages.find(p => {
          const u = p.url()
          return u === url || u.startsWith(url.split('?')[0])
        }) ?? pages[pages.length - 1] ?? pages[0]
      } else if (intentionalPageUrl) {
        // Re-select the stored intentional page URL after reconnect
        page = pages.find(p => {
          const u = p.url()
          return u === intentionalPageUrl || u.startsWith((intentionalPageUrl as string).split('?')[0])
        }) ?? pages[pages.length - 1] ?? pages[0]
      } else {
        // Last resort: pick the newest non-renderer page
        page = pages[pages.length - 1] ?? pages[0]
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async ensurePage(url?: string): Promise<{ ok: boolean; error?: string }> {
    // Validate current page is still alive before any operation
    if (page) {
      try {
        await page.evaluate(() => true)
        return { ok: true }
      } catch {
        page = null
      }
    }
    const res = await this.connect(url)
    return { ok: res.success, error: (res as any).error }
  },

  async navigate(url: string) {
    const ready = await this.ensurePage(url)
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      const target = url.startsWith('http') ? url : `https://${url}`
      intentionalPageUrl = target
      await page!.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
      return { success: true, url: page!.url() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async click(selector: string, frameSelector?: string) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      await getTargetLocator(page!, selector, frameSelector).click({ timeout: 15000 })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async type(selector: string, text: string, frameSelector?: string) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      await getTargetLocator(page!, selector, frameSelector).fill(text, { timeout: 15000 })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async hover(selector: string, frameSelector?: string) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      await getTargetLocator(page!, selector, frameSelector).hover({ timeout: 15000 })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async waitForSelector(selector: string, state?: 'attached' | 'detached' | 'visible' | 'hidden', frameSelector?: string) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      await getTargetLocator(page!, selector, frameSelector).waitFor({ state: state || 'visible', timeout: 15000 })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number) {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      const dist = amount || 400
      let x = 0, y = 0
      if (direction === 'up') y = -dist
      else if (direction === 'down') y = dist
      else if (direction === 'left') x = -dist
      else if (direction === 'right') x = dist

      await page!.evaluate(({ x, y }) => window.scrollBy(x, y), { x, y })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async pressKey(key: string) {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.keyboard.press(key)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async goBack() {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 })
      return { success: true, url: page!.url() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async goForward() {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 })
      return { success: true, url: page!.url() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async reload() {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
      return { success: true, url: page!.url() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async getHtml() {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      const html = await page!.content()
      return { success: true, html: html.slice(0, 80000) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async screenshot(filePath: string) {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.screenshot({ path: filePath })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async mouseMove(x: number, y: number) {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.mouse.move(x, y)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async mouseClickCoordinate(x: number, y: number, button?: 'left' | 'right' | 'middle') {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.mouse.click(x, y, { button: button || 'left' })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async mouseDrag(fromX: number, fromY: number, toX: number, toY: number) {
    if (!page) {
      const res = await this.connect()
      if (!res.success) return res
    }
    try {
      await page!.mouse.move(fromX, fromY)
      await page!.mouse.down()
      await page!.mouse.move(toX, toY, { steps: 10 })
      await page!.mouse.up()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async disconnect() {
    try {
      if (browser) {
        await browser.close()
        browser = null
        context = null
        page = null
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
}

if (parentPort) {
  expose(workerAPI, nodeAdapter(parentPort))
}

export type WorkerAPI = typeof workerAPI
