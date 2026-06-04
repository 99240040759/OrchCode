import { parentPort, workerData } from 'node:worker_threads'
import { expose } from 'comlink'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { nodeAdapter } from './nodeAdapter'

const { mainWindowUrl, debuggingPort } = (workerData || {}) as { mainWindowUrl?: string; debuggingPort?: number }

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
      const port = debuggingPort || 9222
      browser = await chromium.connectOverCDP(`http://localhost:${port}`)
      context = browser.contexts()[0]
      const pages = context.pages()

      const browserPages = pages.filter((p) => {
        const u = p.url()
        const lowerUrl = u.toLowerCase()
        
        // Exclude the main app window if we know its exact URL (including local ports / hosts)
        if (mainWindowUrl) {
          const mainUrlLower = mainWindowUrl.toLowerCase()
          if (lowerUrl === mainUrlLower || lowerUrl.startsWith(mainUrlLower)) {
            return false
          }
          // Handle localhost / 127.0.0.1 variations
          if (mainUrlLower.includes('localhost') && lowerUrl.startsWith(mainUrlLower.replace('localhost', '127.0.0.1'))) {
            return false
          }
          if (mainUrlLower.includes('127.0.0.1') && lowerUrl.startsWith(mainUrlLower.replace('127.0.0.1', 'localhost'))) {
            return false
          }
        }

        // Exclude Chrome extensions and local DevTools / onboarding/etc. inside the Electron sandbox itself
        if (lowerUrl.startsWith('chrome-extension://') || lowerUrl.startsWith('devtools://')) {
          return false
        }

        // Only exclude local files of the app (loaded from package directory)
        // If it starts with file:// and points to our built files or index.html/app.html locally, block it.
        // But do not block public internet URLs that contain index.html or app.html!
        if (u.startsWith('file://')) {
          const filename = u.split(/[/\\]/).pop() || ''
          if (['index.html', 'app.html'].includes(filename.toLowerCase()) || u.includes('/out/renderer/')) {
            return false
          }
        }

        return true
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
    if (page && context) {
      try {
        if (!page.isClosed()) {
          await page.url() // Verify connectivity
          if (url) {
            const currentUrl = page.url()
            if (currentUrl !== url && !currentUrl.startsWith(url.split('?')[0])) {
              const pages = context.pages()
              const found = pages.find((p) => {
                const u = p.url()
                return u === url || u.startsWith(url.split('?')[0])
              })
              if (found) {
                page = found
              }
            }
          }
          return { ok: true }
        } else {
          page = null
          context = null
        }
      } catch {
        page = null
        context = null
      }
    }
    const res: { success: boolean; error?: string } = await this.connect(url)
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
      const locator = getTargetLocator(page!, selector, frameSelector)
      await locator.waitFor({ state: 'visible', timeout: 15000 })
      await locator.fill(text, { timeout: 15000 })
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

  async getPageContent() {
    const ready = await this.ensurePage()
    if (!ready.ok) return { success: false, error: ready.error }
    try {
      const url = page!.url()
      const title = await page!.title()
      const text = await page!.evaluate(() => document.body.innerText || '')

      const elements = await page!.evaluate(() => {
        const interactive: any[] = []
        const select = document.querySelectorAll('button, input, select, textarea, a, [role="button"]')
        select.forEach((el) => {
          if (interactive.length >= 100) return

          const rect = el.getBoundingClientRect()
          const isVisible = rect.width > 0 && rect.height > 0
          if (!isVisible) return

          const tagName = el.tagName.toLowerCase()
          const textContent = (el.textContent || '').trim().slice(0, 80)

          interactive.push({
            tagName,
            id: el.id || undefined,
            className: el.className || undefined,
            text: textContent || undefined,
            placeholder: (el as any).placeholder || undefined,
            name: (el as any).name || undefined,
            type: (el as any).type || undefined,
            value: (el as any).value || undefined
          })
        })
        return interactive
      })

      return {
        success: true,
        url,
        title,
        text: text.slice(0, 15000),
        interactiveElements: elements
      }
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
