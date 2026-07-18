import { webContents } from 'electron'
import type { WebContents } from 'electron'
import type { AgentTool, ContentBlock } from '@cline/shared'
import { serviceUrl } from './utils/fs'
interface TavilyResult { title: string; url: string; content: string }
interface ImageArtifact { base64?: string }
const browserContents = new Map<string, number>()
export function registerBrowserWebContents(sessionId: string, webContentsId: number): boolean {
  const contents = webContents.fromId(webContentsId)
  if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') return false
  browserContents.set(sessionId, webContentsId)
  return true
}
export function unregisterBrowserWebContents(sessionId: string, webContentsId?: number): void {
  if (webContentsId === undefined || browserContents.get(sessionId) === webContentsId) browserContents.delete(sessionId)
}
function getBrowserWebContents(sessionId: string): WebContents {
  const id = browserContents.get(sessionId)
  const contents = id === undefined ? undefined : webContents.fromId(id)
  if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') {
    browserContents.delete(sessionId)
    throw new Error('Open the browser panel for this session before using browser tools.')
  }
  return contents
}
async function withDebugger<T>(
  contents: WebContents,
  run: (send: (method: string, commandParams?: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>
): Promise<T> {
  const debuggerInstance = contents.debugger
  const attachedHere = !debuggerInstance.isAttached()
  if (attachedHere) debuggerInstance.attach('1.3')
  try {
    return await run((method, commandParams) => debuggerInstance.sendCommand(method, commandParams))
  } finally {
    if (attachedHere && debuggerInstance.isAttached()) debuggerInstance.detach()
  }
}
interface CDPExceptionDetails { text: string }
interface CDPResult { value?: unknown }
interface CDPEvaluateResponse { exceptionDetails?: CDPExceptionDetails; result?: CDPResult }
async function evaluateBrowser(sessionId: string, expression: string): Promise<string> {
  const contents = getBrowserWebContents(sessionId)
  return withDebugger(contents, async (send) => {
    const result = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as CDPEvaluateResponse
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser script failed.')
    const value = result.result?.value
    return value === undefined ? 'undefined' : JSON.stringify(value, null, 2)
  })
}
function boundedNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(256, Math.min(2_048, Math.floor(value))) : fallback
}
function stringValue(value: unknown, name: string, limit: number): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw new Error(`${name} is required.`)
  return result.slice(0, limit)
}
export function getExtraTools(sessionToken: string, sessionId: string): AgentTool[] {
  return [
    {
      name: 'search_web',
      description: 'Search the web using Tavily. Returns titles, URLs, and text snippets.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'] },
      execute: async (args: unknown) => {
        const query = stringValue((args as { query?: unknown })?.query, 'A search query', 2_000)
        const tavilyUrl = serviceUrl('tavily')
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!tavilyUrl || !anonKey || !sessionToken) throw new Error('Auth or server config missing.')
        const response = await fetch(tavilyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${sessionToken}` },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(30_000)
        })
        if (!response.ok) throw new Error(`Search failed: ${response.statusText}`)
        const data = (await response.json()) as { results?: TavilyResult[] }
        const formatted = (data.results ?? []).slice(0, 10).map((result) => `[${result.title.slice(0, 500)}](${result.url.slice(0, 2_000)})\n${result.content.slice(0, 4_000)}`).join('\n\n')
        return formatted.slice(0, 30_000) || 'No results found.'
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
      execute: async (args: unknown) => {
        const values = args as { prompt?: unknown; width?: unknown; height?: unknown }
        const prompt = stringValue(values?.prompt, 'An image prompt', 4_000)
        const width = boundedNumber(values?.width, 1024)
        const height = boundedNumber(values?.height, 1024)
        const imageUrl = serviceUrl('generate-image')
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!imageUrl || !anonKey || !sessionToken) throw new Error('Auth or server config missing.')
        const response = await fetch(imageUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${sessionToken}` },
          body: JSON.stringify({ prompt, width, height }),
          signal: AbortSignal.timeout(60_000)
        })
        if (!response.ok) throw new Error(`Image generation failed: ${response.statusText}`)
        const data = (await response.json()) as { artifacts?: ImageArtifact[] }
        const base64 = data.artifacts?.[0]?.base64 ?? ''
        if (!base64 || base64.length > 20 * 1024 * 1024) throw new Error('No valid image data returned.')
        return [
          { type: 'text', text: `Generated image for: "${prompt}"` },
          { type: 'image', data: base64, mediaType: 'image/png' }
        ] as ContentBlock[]
      }
    },
    {
      name: 'playwright_navigate',
      description: 'Navigate the embedded browser to a URL.',
      inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The URL to navigate to' } }, required: ['url'] },
      execute: async (args: unknown) => {
        const url = stringValue((args as { url?: unknown })?.url, 'URL', 8_192)
        const contents = getBrowserWebContents(sessionId)
        await withDebugger(contents, async (send) => {
          await send('Page.enable')
          await send('Page.navigate', { url })
        })
        return `Navigated to ${url}`
      }
    },
    {
      name: 'playwright_click',
      description: 'Click an element in the embedded browser.',
      inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector to click' } }, required: ['selector'] },
      execute: async (args: unknown) => {
        const selector = stringValue((args as { selector?: unknown })?.selector, 'selector', 2_000)
        await evaluateBrowser(sessionId, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Element not found'); (el instanceof HTMLElement ? el : el.parentElement)?.click(); return true })()`)
        return `Clicked ${selector}`
      }
    },
    {
      name: 'playwright_fill',
      description: 'Fill a text input in the embedded browser.',
      inputSchema: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector to fill' }, value: { type: 'string', description: 'Text to type' } },
        required: ['selector', 'value']
      },
      execute: async (args: unknown) => {
        const values = args as { selector?: unknown; value?: unknown }
        const selector = stringValue(values?.selector, 'selector', 2_000)
        const value = typeof values?.value === 'string' ? values.value.slice(0, 20_000) : ''
        await evaluateBrowser(sessionId, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('Editable element not found'); el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
        return `Filled ${selector}`
      }
    },
    {
      name: 'playwright_evaluate',
      description: 'Evaluate JavaScript in the embedded browser and return the result.',
      inputSchema: { type: 'object', properties: { script: { type: 'string', description: 'JavaScript expression or statements that return a serializable value' } }, required: ['script'] },
      execute: async (args: unknown) => {
        const script = stringValue((args as { script?: unknown })?.script, 'script', 40_000)
        return evaluateBrowser(sessionId, `(async () => { ${script} })()`)
      }
    },
    {
      name: 'playwright_screenshot',
      description: 'Take a screenshot of the embedded browser.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const contents = getBrowserWebContents(sessionId)
        const result = await withDebugger(contents, (send) => send('Page.captureScreenshot', { format: 'jpeg', quality: 75 }))
        const data = typeof result.data === 'string' ? result.data : ''
        if (!data) throw new Error('Screenshot capture failed.')
        return [{ type: 'image', data, mediaType: 'image/jpeg' }] as ContentBlock[]
      }
    }
  ]
}
