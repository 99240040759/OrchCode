import { tool } from 'ai'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess, MessageChannelMain } from 'electron'
import { wrap, type Remote } from 'comlink'
import log from 'electron-log'
import WindowManager from '../windowManager'
import type { WorkerAPI } from '../browserWorker'
import { getConversationScreenshotsPath } from '../paths'

let workerProcess: Electron.UtilityProcess | null = null
let automatedBrowser: Remote<WorkerAPI> | null = null

function checkBrowserViewActive(): { success: boolean; error?: string } | null {
  const bv = WindowManager.getBrowserView()
  if (!bv) {
    return {
      success: false,
      error:
        'The Browser panel is not currently open in the Artifacts screen. Please click the Browser icon in the right side panel to open it before using browser tools.'
    }
  }
  return null
}

export function startBrowserAgentWorker(): Remote<WorkerAPI> | null {
  if (workerProcess) return automatedBrowser
  const mainWindow = WindowManager.getMainWindow()
  const mainWindowUrl = mainWindow?.webContents.getURL() || ''
  const debuggingPort = WindowManager.getDebuggingPort()
  const workerPath = join(__dirname, '../browserWorker.js')
  log.info(`[tools:browser] Spawning Playwright worker via utilityProcess: ${workerPath} port: ${debuggingPort}`)

  const { port1, port2 } = new MessageChannelMain()

  workerProcess = utilityProcess.fork(workerPath, [], { serviceName: 'playwright-worker' })
  // Send init data + port2 to the worker process
  workerProcess.postMessage({ mainWindowUrl, debuggingPort }, [port2])

  const comlinkEndpoint = {
    addEventListener: (t: string, l: any) => t === 'message' && port1.on('message', (e: any) => l({ data: e.data, ports: e.ports })),
    removeEventListener: (t: string, l: any) => t === 'message' && port1.off('message', l),
    postMessage: (m: any, tr?: any) => port1.postMessage(m, tr),
    start: () => port1.start(),
    close: () => port1.close()
  }

  // Wrap port1 via the adapter — utilityProcess MessagePortMain needs this translation layer
  automatedBrowser = wrap<WorkerAPI>(comlinkEndpoint as any)

  workerProcess.on('exit', (code) => {
    log.warn(`[tools:browser] Worker process exited with code ${code}`)
    workerProcess = null
    automatedBrowser = null
  })

  return automatedBrowser
}

export async function stopBrowserAgentWorker() {
  if (automatedBrowser) {
    try { await automatedBrowser.disconnect() } catch {}
    automatedBrowser = null
  }
  if (workerProcess) {
    workerProcess.kill()
    workerProcess = null
  }
}

export function browserTools(convId: string, modelSupportsVision = true) {
  const browserNavigate = tool({
    description: 'Navigates the active browser viewport to a specified URL.',
    inputSchema: z.object({ url: z.string().describe('The URL to navigate to.') }),
    execute: async ({ url }) => {
      log.info(`[tool:browserNavigate] url="${url}"`)
      const check = checkBrowserViewActive()
      if (check) return check
      const agent = startBrowserAgentWorker()
      if (!agent) return { success: false, error: 'Browser automation worker is unavailable.' }
      try {
        return await agent.navigate(url)
      } catch (err: any) {
        log.error('[tool:browserNavigate] worker error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const browserType = tool({
    description:
      'Types text into an input field on the active webpage. Supports piercing iframes via frameSelector.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of the input field.'),
      text: z.string().describe('The text to type.'),
      frameSelector: z
        .string()
        .optional()
        .describe('Optional CSS selector of the iframe containing the target input.')
    }),
    execute: async ({ selector, text, frameSelector }) => {
      log.info(`[tool:browserType] selector="${selector}"`)
      const check = checkBrowserViewActive()
      if (check) return check
      const agent = startBrowserAgentWorker()
      if (!agent) return { success: false, error: 'Browser automation worker is unavailable.' }
      try {
        return await agent.type(selector, text, frameSelector)
      } catch (err: any) {
        log.error('[tool:browserType] worker error:', err)
        return { success: false, error: err.message }
      }
    }
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
      const agent = startBrowserAgentWorker()
      if (!agent) return { success: false, error: 'Browser automation worker is unavailable.' }
      try {
        return await agent.scroll(direction, amount)
      } catch (err: any) {
        log.error('[tool:browserScroll] worker error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const browserScreenshot = tool({
    description: 'Captures a PNG screenshot of the active browser viewport.',
    inputSchema: z.object({}),
    execute: async () => {
      log.info('[tool:browserScreenshot] executing...')
      const check = checkBrowserViewActive()
      if (check) return check
      const agent = startBrowserAgentWorker()
      if (!agent) return { success: false, error: 'Browser automation worker is unavailable.' }
      try {
        const screenshotDir = getConversationScreenshotsPath(convId)
        await fs.mkdir(screenshotDir, { recursive: true })

        try {
          const existing = await fs.readdir(screenshotDir)
          const pngs = existing.filter((f) => f.endsWith('.png')).sort()
          for (const old of pngs.slice(0, Math.max(0, pngs.length - 9))) {
            await fs.rm(join(screenshotDir, old), { force: true })
          }
        } catch {}

        const filename = `screenshot_${Date.now()}.png`
        const screenshotPath = join(screenshotDir, filename)
        const res = await agent.screenshot(screenshotPath)
        if (res.success) {
          return {
            success: true,
            message: 'Screenshot captured.',
            filePath: `file://${screenshotPath}`,
            filename
          }
        }
        return res
      } catch (err: any) {
        log.error('[tool:browserScreenshot] worker error:', err)
        return { success: false, error: err.message }
      }
    },
    toModelOutput: async ({ output }: { output: any }) => {
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
          const cleanPath = output.filePath.replace('file://', '')
          const base64Image = (await fs.readFile(cleanPath)).toString('base64')
          return {
            type: 'content',
            value: [
              { type: 'image-data', data: base64Image, mediaType: 'image/png' },
              { type: 'text', text: `Screenshot captured: ${output.filePath}` }
            ]
          }
        } catch (err: any) {
          return {
            type: 'content',
            value: [{ type: 'text', text: `Failed to read screenshot: ${err.message}` }]
          }
        }
      }
      return {
        type: 'content',
        value: [{ type: 'text', text: output.error || 'Failed to capture screenshot' }]
      }
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
      const agent = startBrowserAgentWorker()
      if (!agent) return { success: false, error: 'Browser automation worker is unavailable.' }
      try {
        return await agent.mouseClickCoordinate(x, y, button)
      } catch (err: any) {
        log.error('[tool:browserMouseClickCoordinate] worker error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const browserGetPageContent = tool({
    description:
      'Extracts the page URL, title, visible text content, and interactive element definitions from the active browser viewport. Essential for text-only models that cannot see screenshots.',
    inputSchema: z.object({}),
    execute: async () => {
      log.info('[tool:browserGetPageContent] executing...')
      const check = checkBrowserViewActive()
      if (check) return check
      const agent = startBrowserAgentWorker()
      if (!agent) return { success: false, error: 'Browser automation worker is unavailable.' }
      try {
        return await agent.getPageContent()
      } catch (err: any) {
        log.error('[tool:browserGetPageContent] worker error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  return {
    browserNavigate,
    browserType,
    browserScroll,
    browserScreenshot,
    browserMouseClickCoordinate,
    browserGetPageContent
  }
}
