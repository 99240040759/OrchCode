import type { AgentTool } from '@cline/shared'
import puppeteer from 'puppeteer-core'
import { serviceUrl } from './utils/fs'

let browserCache: import('puppeteer-core').Browser | undefined = undefined
let connectPromise: Promise<import('puppeteer-core').Browser> | undefined = undefined

function onBrowserDisconnected(): void {
  browserCache = undefined
  connectPromise = undefined
}

async function getOrConnectBrowser(): Promise<import('puppeteer-core').Browser> {
  if (browserCache?.connected) return browserCache
  if (!connectPromise) {
    connectPromise = puppeteer
      .connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
      .then((b) => {
        browserCache = b
        b.once('disconnected', onBrowserDisconnected)
        return b
      })
      .catch((err: unknown) => {
        connectPromise = undefined
        browserCache = undefined
        throw err
      })
  }
  return connectPromise
}

async function getWebviewPage(): Promise<import('puppeteer-core').Page> {
  let browser: import('puppeteer-core').Browser
  try {
    browser = await getOrConnectBrowser()
  } catch {
    throw new Error('Electron IDE CDP not available. Is the app running with remote debugging?')
  }
  const targets = browser.targets()
  const webviewTargets = targets.filter((t) => t.type() === 'webview')
  const webviewTarget = webviewTargets[webviewTargets.length - 1]
  if (!webviewTarget)
    throw new Error('No ArtifactPanel webview found. The user must open the browser panel first.')
  const page = await webviewTarget.page()
  if (!page) throw new Error('Failed to attach to the webview page.')
  return page
}


function boundedNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(256, Math.min(2_048, Math.floor(value)))
    : fallback
}

export function getExtraTools(sessionToken: string): AgentTool[] {
  return [
    {
      name: 'search_web',
      description: 'Search the web using Tavily. Returns titles, URLs, and text snippets.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query']
      },
      execute: async (args: any) => {
        const query = typeof args.query === 'string' ? args.query.trim().slice(0, 2_000) : ''
        if (!query) throw new Error('A search query is required.')
        const tavilyUrl = serviceUrl('tavily')
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!tavilyUrl || !anonKey || !sessionToken) throw new Error('Auth or server config missing.')

        const response = await fetch(tavilyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${sessionToken}`
          },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(30000)
        })
        if (!response.ok) throw new Error(`Search failed: ${response.statusText}`)
        interface TavilyResult {
          title: string
          url: string
          content: string
        }
        const data = (await response.json()) as { results?: TavilyResult[] }
        const formatted = (data.results ?? [])
          .map((r: TavilyResult) => `[${r.title}](${r.url})\n${r.content}`)
          .join('\n\n')
        return formatted || 'No results found.'
      }
    },
    {
      name: 'generate_image',
      description: 'Generate an image from a text prompt using NVIDIA FLUX.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Description of the image to generate' },
          width: { type: 'number', description: 'Optional width. Default 1024' },
          height: { type: 'number', description: 'Optional height. Default 1024' }
        },
        required: ['prompt']
      },
      execute: async (args: any) => {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim().slice(0, 4_000) : ''
        if (!prompt) throw new Error('An image prompt is required.')
        const width = boundedNumber(args.width, 1024)
        const height = boundedNumber(args.height, 1024)
        const imageUrl = serviceUrl('generate-image')
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!imageUrl || !anonKey || !sessionToken) throw new Error('Auth or server config missing.')

        const response = await fetch(imageUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${sessionToken}`
          },
          body: JSON.stringify({ prompt, width, height }),
          signal: AbortSignal.timeout(30000)
        })
        if (!response.ok) throw new Error(`Image generation failed: ${response.statusText}`)
        interface ImageArtifact {
          base64?: string
        }
        const data = (await response.json()) as { artifacts?: ImageArtifact[] }
        const b64 = data.artifacts?.[0]?.base64 ?? ''
        if (!b64) throw new Error('No image data returned.')
        return [
          { type: 'text', text: `Generated image for: "${prompt}"` },
          { type: 'image', data: b64, mediaType: 'image/png' }
        ] as any
      }
    },
    {
      name: 'playwright_navigate',
      description: 'Navigate the embedded browser to a URL.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The URL to navigate to' } },
        required: ['url']
      },
      execute: async (args: any) => {
        const url = typeof args.url === 'string' ? args.url.trim() : ''
        if (!url) throw new Error('URL is required.')
        const page = await getWebviewPage()
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
        } catch (err: any) {
          const msg = err?.message || String(err)
          if (!msg.toLowerCase().includes('timeout')) throw new Error(`Navigation failed: ${msg}`)
        }
        return `Navigated to ${url}`
      }
    },
    {
      name: 'playwright_click',
      description: 'Click an element in the embedded browser.',
      inputSchema: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector to click' } },
        required: ['selector']
      },
      execute: async (args: any) => {
        const selector = typeof args.selector === 'string' ? args.selector : ''
        if (!selector) throw new Error('selector is required.')
        const page = await getWebviewPage()
        await page.waitForSelector(selector, { visible: true, timeout: 5000 }).catch(() => {
          // Ignore timeout, let click attempt fail with standard error if still missing
        })
        await page.click(selector)
        return `Clicked ${selector}`
      }
    },
    {
      name: 'playwright_fill',
      description: 'Fill a text input in the embedded browser.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to fill' },
          value: { type: 'string', description: 'Text to type' }
        },
        required: ['selector', 'value']
      },
      execute: async (args: any) => {
        const selector = typeof args.selector === 'string' ? args.selector : ''
        const value = typeof args.value === 'string' ? args.value : ''
        if (!selector) throw new Error('selector is required.')
        const page = await getWebviewPage()
        await page.waitForSelector(selector, { visible: true, timeout: 5000 }).catch(() => {})
        await page.click(selector)
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement
          if (el) {
            el.focus()
            el.value = ''
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }, selector)
        await page.type(selector, value, { delay: 10 })
        return `Filled ${selector}`
      }
    },
    {
      name: 'playwright_evaluate',
      description: 'Evaluate JS in the embedded browser and return the result.',
      inputSchema: {
        type: 'object',
        properties: {
          script: {
            type: 'string',
            description: 'JS expression to evaluate (must return a serializable value)'
          }
        },
        required: ['script']
      },
      execute: async (args: any) => {
        const script = typeof args.script === 'string' ? args.script.trim() : ''
        if (!script) throw new Error('script is required.')
        const page = await getWebviewPage()
        let timer: NodeJS.Timeout | undefined
        const timeoutPromise = new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error('Evaluation timed out')), 15000)
        })
        try {
          const res = await Promise.race([
            page.evaluate(async (scriptToRun) => {
              try {
                let res;
                try {
                  const fnExpr = new Function(`return (async () => { return (${scriptToRun}); })()`);
                  res = await fnExpr();
                } catch {
                  const fnStmt = new Function(`return (async () => { ${scriptToRun} })()`);
                  res = await fnStmt();
                }
                return JSON.stringify(res, null, 2);
              } catch (err: any) {
                return JSON.stringify({ error: err.message || String(err) })
              }
            }, script),
            timeoutPromise
          ])
          return res !== undefined ? String(res) : 'undefined'
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
    },
    {
      name: 'playwright_screenshot',
      description: 'Take a screenshot of the embedded browser.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const page = await getWebviewPage()
        const b64 = (await page.screenshot({
          type: 'jpeg',
          quality: 75,
          encoding: 'base64'
        })) as string
        return [
          { type: 'image', data: b64, mediaType: 'image/jpeg' }
        ] as any
      }
    }
  ]
}
