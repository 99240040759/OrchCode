import { parentPort, workerData } from 'worker_threads'
import { expose } from 'comlink'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { nodeAdapter } from './nodeAdapter'

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

const workerAPI = {
  async connect(url?: string) {
    try {
      if (browser) {
        try {
          await browser.close()
        } catch {}
      }
      browser = await chromium.connectOverCDP('http://localhost:9222')
      context = browser.contexts()[0]
      const pages = context.pages()

      const mainWindowUrl = workerData?.mainWindowUrl
      const mainAppKeywords = ['chrome-extension://', 'app.html', 'index.html']
      if (mainWindowUrl) {
        const lowerUrl = mainWindowUrl.toLowerCase()
        mainAppKeywords.push(lowerUrl)
        if (lowerUrl.includes('localhost')) {
          mainAppKeywords.push(lowerUrl.replace('localhost', '127.0.0.1'))
        } else if (lowerUrl.includes('127.0.0.1')) {
          mainAppKeywords.push(lowerUrl.replace('127.0.0.1', 'localhost'))
        }
      }
      const browserPages = pages.filter((p) => {
        const u = p.url().toLowerCase()
        if (
          mainWindowUrl &&
          (u === mainWindowUrl.toLowerCase() || u.startsWith(mainWindowUrl.toLowerCase()))
        ) {
          return false
        }
        return !mainAppKeywords.some((kw) => u.startsWith(kw) || u.includes(kw))
      })

      if (browserPages.length > 0) {
        if (url) {
          intentionalPageUrl = url
          page =
            browserPages.find((p) => {
              const u = p.url()
              return u === url || u.startsWith(url.split('?')[0])
            }) ?? browserPages[0]
        } else if (intentionalPageUrl) {
          page =
            browserPages.find((p) => {
              const u = p.url()
              return (
                u === intentionalPageUrl ||
                u.startsWith((intentionalPageUrl as string).split('?')[0])
              )
            }) ?? browserPages[0]
        } else {
          page = browserPages[browserPages.length - 1] ?? browserPages[0]
        }
      } else {
        throw new Error(
          'Playwright could not locate the active Browser View page. Please verify the Browser panel is open in your Artifact screen.'
        )
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async ensurePage(url?: string): Promise<{ ok: boolean; error?: string }> {
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

  async syncUrl(url: string) {
    try {
      intentionalPageUrl = url
      if (page) {
        try {
          const pageUrl = page.url()
          if (pageUrl !== url && context) {
            const found = context.pages().find((p) => p.url() === url)
            if (found) page = found
          }
        } catch {
          page = null
        }
      }
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

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      const dist = amount || 400
      let x = 0,
        y = 0
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

  async screenshot(filePath: string) {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      await page!.screenshot({ path: filePath })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  async mouseClickCoordinate(x: number, y: number, button?: 'left' | 'right' | 'middle') {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      await page!.mouse.click(x, y, { button: button || 'left' })
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
