import { tool } from 'ai'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import WindowManager from './windowManager'
import { getConversationScreenshotsPath } from './paths'

interface ScreenshotOutput { success: boolean; message?: string; filePath?: string; filename?: string; error?: string }


function getBrowserWebContents() {
  const bv = WindowManager.getBrowserView()
  return bv ? bv.webContents : null
}

function checkBrowserViewActive() {
  if (!WindowManager.getBrowserView()) {
    return {
      success: false,
      error: 'The Browser panel is not currently open in the Artifacts screen. Please click the Browser icon in the right side panel to open it before using browser tools.'
    }
  }
  return null
}

export function browserTools(convId: string, modelSupportsVision = true) {
  const browserNavigate = tool({
    description: 'Navigates the active browser viewport to a specified URL.',
    inputSchema: z.object({ url: z.string().describe('The URL to navigate to.') }),
    execute: async ({ url }) => {
      log.info(`[tool:browserNavigate] url="${url}"`)
      const check = checkBrowserViewActive()
      if (check) return check
      const wc = getBrowserWebContents()!
      try {
        const target = url.startsWith('http') ? url : `https://${url}`
        await wc.loadURL(target)
        return { success: true, url: wc.getURL() }
      } catch (e: unknown) { log.error('[tool:browserNavigate] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully navigated to ${output.url}` }] })
  })

  const browserType = tool({
    description: 'Types text into an input field on the active webpage. Supports piercing iframes via frameSelector.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of the input field.'),
      text: z.string().describe('The text to type.'),
      frameSelector: z.string().optional().describe('Optional CSS selector of the iframe containing the target input.')
    }),
    execute: async ({ selector, text, frameSelector }) => {
      log.info(`[tool:browserType] selector="${selector}"`)
      const check = checkBrowserViewActive()
      if (check) return check
      const wc = getBrowserWebContents()!
      try {
        await wc.executeJavaScript(`
          (() => {
            const doc = ${frameSelector ? `document.querySelector(${JSON.stringify(frameSelector)}).contentDocument` : 'document'};
            const el = doc.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error('Element not found');
            el.focus();
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              el.value = ${JSON.stringify(text)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              el.textContent = ${JSON.stringify(text)};
            }
          })()
        `)
        return { success: true }
      } catch (e: unknown) { log.error('[tool:browserType] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully typed text into element` }] })
  })

  const browserScroll = tool({
    description: 'Scrolls the active webpage viewport.',
    inputSchema: z.object({
      direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction.'),
      amount: z.number().int().positive().optional().describe('Pixels to scroll (default 400).')
    }),
    execute: async ({ direction, amount }) => {
      log.info(`[tool:browserScroll] direction="${direction}" amount=${amount ?? 400}`)
      const check = checkBrowserViewActive()
      if (check) return check
      const wc = getBrowserWebContents()!
      try {
        const dist = amount || 400
        let x = 0, y = 0
        if (direction === 'up') y = -dist
        else if (direction === 'down') y = dist
        else if (direction === 'left') x = -dist
        else if (direction === 'right') x = dist
        await wc.executeJavaScript(`window.scrollBy(${x}, ${y})`)
        return { success: true }
      } catch (e: unknown) { log.error('[tool:browserScroll] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully scrolled viewport` }] })
  })

  const browserScreenshot = tool({
    description: 'Captures a PNG screenshot of the active browser viewport.',
    inputSchema: z.object({}),
    execute: async () => {
      log.info('[tool:browserScreenshot] executing...')
      const check = checkBrowserViewActive()
      if (check) return check
      const wc = getBrowserWebContents()!
      try {
        const screenshotDir = getConversationScreenshotsPath(convId)
        await fs.mkdir(screenshotDir, { recursive: true })
        try {
          const existing = await fs.readdir(screenshotDir)
          const pngs = existing.filter((f) => f.endsWith('.png')).sort()
          for (const old of pngs.slice(0, Math.max(0, pngs.length - 9))) {
            await fs.rm(join(screenshotDir, old), { force: true }).catch(() => {})
          }
        } catch {}
        const filename = `screenshot_${Date.now()}.png`, screenshotPath = join(screenshotDir, filename), nativeImage = await wc.capturePage(), png = nativeImage.toPNG()
        await fs.writeFile(screenshotPath, png)
        return { success: true, message: 'Screenshot captured.', filePath: `file://${screenshotPath}`, filename, buffer: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }
      } catch (e: unknown) { log.error('[tool:browserScreenshot] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
    toModelOutput: async ({ output }: { output: ScreenshotOutput & { buffer?: ArrayBuffer } }) => {
      if (output.success && output.filePath) {
        try {
          if (!modelSupportsVision) {
            return {
              type: 'content',
              value: [
                {
                  type: 'text',
                  text: `Screenshot captured and saved to ${output.filePath}. Image content omitted from tool output because this model does not support vision. Note: Rely on DOM analysis or text feedback.`
                }
              ]
            }
          }
          const base64Image = output.buffer ? Buffer.from(output.buffer).toString('base64') : (await fs.readFile(output.filePath.replace('file://', ''))).toString('base64')
          return {
            type: 'content',
            value: [
              { type: 'image-data', data: base64Image, mediaType: 'image/png' },
              { type: 'text', text: `Screenshot captured: ${output.filePath}` }
            ]
          }
        } catch (e: unknown) { return { type: 'content', value: [{ type: 'text', text: `Failed to read screenshot: ${e instanceof Error ? e.message : String(e)}` }] } }
      }
      return { type: 'content', value: [{ type: 'text', text: output.error || 'Failed to capture screenshot' }] }
    }
  })

  const browserMouseClickCoordinate = tool({
    description: 'Clicks at a specific pixel coordinate.',
    inputSchema: z.object({
      x: z.number().int().describe('X coordinate.'),
      y: z.number().int().describe('Y coordinate.'),
      button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button.')
    }),
    execute: async ({ x, y, button }) => {
      log.info(`[tool:browserMouseClickCoordinate] x=${x} y=${y} button="${button}"`)
      const check = checkBrowserViewActive()
      if (check) return check
      const wc = getBrowserWebContents()!
      try {
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: button || 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: button || 'left', clickCount: 1 })
        return { success: true }
      } catch (e: unknown) { log.error('[tool:browserMouseClickCoordinate] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully clicked coordinates` }] })
  })

  const browserGetPageContent = tool({
    description: 'Extracts the page URL, title, visible text content, and interactive element definitions from the active browser viewport. Essential for text-only models that cannot see screenshots.',
    inputSchema: z.object({}),
    execute: async () => {
      log.info('[tool:browserGetPageContent] executing...')
      const check = checkBrowserViewActive()
      if (check) return check
      const wc = getBrowserWebContents()!
      try {
        const result = await wc.executeJavaScript(`
          (() => {
            const text = document.body.innerText || '';
            const interactive = [];
            const elements = document.querySelectorAll('button, input, select, textarea, a, [role="button"]');
            for (const el of elements) {
              if (interactive.length >= 100) break;
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                interactive.push({
                  tagName: el.tagName.toLowerCase(), id: el.id || undefined, className: el.className || undefined,
                  text: (el.textContent || '').trim().slice(0, 80) || undefined, placeholder: el.placeholder || undefined,
                  name: el.name || undefined, type: el.type || undefined, value: el.value || undefined
                });
              }
            }
            return { url: window.location.href, title: document.title, text: text.slice(0, 15000), interactiveElements: interactive };
          })()
        `)
        const wrappedText = `[UNTRUSTED WEB PAGE CONTENT START]\nURL: ${result.url}\nTitle: ${result.title}\n\nVisible Page Text:\n${result.text}\n[UNTRUSTED WEB PAGE CONTENT END]`
        return { success: true, url: result.url, title: result.title, text: wrappedText, interactiveElements: result.interactiveElements }
      } catch (e: unknown) { log.error('[tool:browserGetPageContent] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `URL: ${output.url}\nTitle: ${output.title}\nContent:\n${output.text}\nInteractive elements:\n${JSON.stringify(output.interactiveElements, null, 2)}` }] })
  })

  const tools = {
    browserNavigate,
    browserType,
    browserScroll,
    browserScreenshot,
    browserMouseClickCoordinate,
    browserGetPageContent
  }
  if (process.type === 'utility') {
    const { callMainProcessTool } = require('./agentWorker')
    for (const [name, t] of Object.entries(tools)) {
      t.execute = async (args: any) => callMainProcessTool(name, args, convId)
    }
  }
  return tools
}
