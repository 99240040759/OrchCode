import 'dotenv/config'
import { tool } from 'ai'
import { z } from 'zod'
import { promises as fs } from 'fs'
import { join, relative, extname, dirname } from 'path'
import { execa } from 'execa'
import log from 'electron-log'
import { tavily } from '@tavily/core'
import {
  getWorkspaceContext,
  getOrCreateWorkspaceContext,
  getActiveConversationId,
  isBinaryBuffer,
  assertWithinWorkspace
} from './workspace'
import { app } from 'electron'
import { Worker } from 'worker_threads'
import { wrap } from 'comlink'

// ─── Workspace resolution ─────────────────────────────────────────────────

function resolveWorkspace(convId: string) {
  return getWorkspaceContext(convId) || getOrCreateWorkspaceContext(convId)
}

// ─── Security ─────────────────────────────────────────────────────────────

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+(-[rRf]+\s+)?[\/~]/,
  /\bsudo\b/,
  /\bcurl\b.*\|\s*(ba)?sh/,
  /\bwget\b.*\|\s*(ba)?sh/,
]

function isCommandBlocked(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

// ─── Web search ───────────────────────────────────────────────────────────

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY || '' })

// ─── MIME helpers ─────────────────────────────────────────────────────────

const getMimeType = (filePath: string) => {
  const ext = extname(filePath).toLowerCase()
  const mimes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
  }
  return mimes[ext] || 'application/octet-stream'
}

// ─── Tool factory ─────────────────────────────────────────────────────────
// Each tool receives the convId from the stream-request closure — no global
// state dependency, no conversationId leaking through model args (#15 fix).

export function createCoreTools(convId: string) {
  const wctx = () => resolveWorkspace(convId)
  const safe = (p: string) => assertWithinWorkspace(wctx().rootPath, p, convId)

  const listDir = tool({
    description:
      'List the contents of a directory within the active workspace — shows all files and subdirectories with their sizes, types, and child counts.',
    inputSchema: z.object({
      directoryPath: z
        .string()
        .describe('Absolute path to the directory to list. Must be within the workspace root.')
    }),
    execute: async ({ directoryPath }) => {
      try {
        const ctx = wctx()
        const safePath = safe(directoryPath)
        const rawEntries = await fs.readdir(safePath, { withFileTypes: true })

        const entries = await Promise.all(
          rawEntries.map(async (entry) => {
            const fullPath = join(safePath, entry.name)
            const relativePath = relative(ctx.rootPath, fullPath)
            const isDirectory = entry.isDirectory()
            let sizeBytes: number | undefined
            let numChildren: number | undefined

            if (isDirectory) {
              try { numChildren = (await fs.readdir(fullPath)).length } catch {}
            } else {
              try { sizeBytes = (await fs.stat(fullPath)).size } catch {}
            }

            return {
              name: entry.name,
              relativePath,
              absolutePath: fullPath,
              isDirectory,
              extension: isDirectory ? undefined : extname(entry.name),
              sizeBytes,
              numChildren
            }
          })
        )

        entries.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name)
        })

        return { entries, dirPath: safePath, rootPath: ctx.rootPath }
      } catch (err: any) {
        log.error('[tool:listDir] error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const viewFile = tool({
    description:
      'Read the content of a file within the workspace. Returns the file contents between startLine and endLine (1-indexed, inclusive). Max 800 lines per read. For binary images/video the base64 content and mimeType are returned.',
    inputSchema: z.object({
      absolutePath: z
        .string()
        .describe('Absolute path to the file. Must be within the workspace root.'),
      startLine: z.number().int().min(1).optional().describe('1-indexed start line (inclusive).'),
      endLine: z.number().int().min(1).optional().describe('1-indexed end line (inclusive).')
    }),
    execute: async ({ absolutePath, startLine, endLine }) => {
      try {
        const safePath = safe(absolutePath)
        const stat = await fs.stat(safePath)
        if (!stat.isFile()) throw new Error(`Not a file: "${safePath}"`)

        const rawBuffer = await fs.readFile(safePath)

        if (isBinaryBuffer(rawBuffer)) {
          const mimeType = getMimeType(safePath)
          return {
            content: `[Binary File: ${mimeType}] Base64 encoded data included.`,
            base64Content: rawBuffer.toString('base64'),
            mimeType,
            absolutePath: safePath,
            isBinary: true,
            sizeBytes: stat.size
          }
        }

        const content = rawBuffer.toString('utf-8')
        const allLines = content.split('\n')
        const totalLines = allLines.length

        const start = Math.max(1, startLine ?? 1)
        const maxEnd = start + 799
        const requestedEnd = endLine ?? maxEnd
        const end = Math.min(totalLines, Math.min(requestedEnd, maxEnd))
        const wasTruncated = requestedEnd > maxEnd && totalLines > maxEnd

        const targetLines = allLines.slice(start - 1, end)
        const numberedContent = targetLines.map((line, i) => `${start + i}: ${line}`).join('\n')

        return { content: numberedContent, rawContent: targetLines.join('\n'), absolutePath: safePath, totalLines, readStart: start, readEnd: end, truncated: wasTruncated }
      } catch (err: any) {
        log.error('[tool:viewFile] error:', err)
        return { success: false, error: err.message }
      }
    },
    toModelOutput: (result: any) => {
      if (result.isBinary && result.mimeType?.startsWith('image/') && result.base64Content) {
        return {
          type: 'content',
          value: [
            { type: 'image-data', data: result.base64Content, mediaType: result.mimeType },
            { type: 'text', text: `Successfully analyzed binary image: ${result.absolutePath}` }
          ]
        }
      }
      return { type: 'content', value: [{ type: 'text', text: result.content || result.error || 'No content' }] }
    }
  })

  const writeToFile = tool({
    description:
      'Create a new file (or overwrite an existing one) within the workspace. Parent directories are created automatically. Set overwrite=true to replace an existing file.',
    inputSchema: z.object({
      targetFile: z.string().describe('Absolute path for the file to create. Must be within the workspace root.'),
      codeContent: z.string().describe('Full file content to write.'),
      overwrite: z.boolean().default(false).describe('If true, overwrite an existing file. Defaults to false.')
    }),
    execute: async ({ targetFile, codeContent, overwrite }) => {
      try {
        const safePath = safe(targetFile)

        let exists = false
        try { await fs.stat(safePath); exists = true } catch {}

        if (exists && !overwrite) {
          throw new Error(`File already exists: "${safePath}". Set overwrite=true to replace it.`)
        }

        await fs.mkdir(dirname(safePath), { recursive: true })
        await fs.writeFile(safePath, codeContent, 'utf-8')
        log.info(`[tool:writeToFile] wrote ${safePath} (overwrite=${overwrite})`)
        return { success: true, absolutePath: safePath, created: !exists }
      } catch (err: any) {
        log.error('[tool:writeToFile] error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const replaceFileContent = tool({
    description:
      'Edit a SINGLE contiguous block in an existing file. Searches for TargetContent within the line range [startLine, endLine] and replaces it with ReplacementContent.',
    inputSchema: z.object({
      targetFile: z.string().describe('Absolute path to the file to edit. Must be within the workspace root.'),
      targetContent: z.string().describe('Exact string to find and replace. Must match exactly.'),
      replacementContent: z.string().describe('Replacement content for the target string.'),
      startLine: z.number().int().min(1).describe('Start of the search range (1-indexed).'),
      endLine: z.number().int().min(1).describe('End of the search range (1-indexed, inclusive).'),
      allowMultiple: z.boolean().default(false).describe('If true, replace all occurrences in the range.')
    }),
    execute: async ({ targetFile, targetContent, replacementContent, startLine, endLine, allowMultiple }) => {
      try {
        const safePath = safe(targetFile)
        const raw = await fs.readFile(safePath, 'utf-8')
        const isCrlf = raw.includes('\r\n')
        const normalizedRaw = raw.replace(/\r\n/g, '\n')
        const allLines = normalizedRaw.split('\n')

        const start = Math.max(1, startLine)
        const end = Math.min(allLines.length, endLine)

        const beforeLines = allLines.slice(0, start - 1)
        const rangeLines = allLines.slice(start - 1, end)
        const afterLines = allLines.slice(end)
        const rangeText = rangeLines.join('\n')

        const occurrences = rangeText.split(targetContent).length - 1
        if (occurrences === 0) {
          throw new Error(`TargetContent not found in lines ${start}–${end} of "${safePath}".\nSearched for:\n${targetContent}`)
        }
        if (occurrences > 1 && !allowMultiple) {
          throw new Error(`Multiple occurrences (${occurrences}) of TargetContent found in lines ${start}–${end}. Set allowMultiple=true to replace all.`)
        }

        const newRangeText = allowMultiple
          ? rangeText.split(targetContent).join(replacementContent)
          : rangeText.replace(targetContent, () => replacementContent)

        const newLines = [...beforeLines, ...newRangeText.split('\n'), ...afterLines]
        const finalContent = isCrlf ? newLines.join('\r\n') : newLines.join('\n')

        await fs.writeFile(safePath, finalContent, 'utf-8')
        log.info(`[tool:replaceFileContent] edited ${safePath} (occurrences: ${occurrences})`)
        return { success: true, absolutePath: safePath, occurrencesReplaced: occurrences }
      } catch (err: any) {
        log.error('[tool:replaceFileContent] error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const ReplacementChunkSchema = z.object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    targetContent: z.string(),
    replacementContent: z.string(),
    allowMultiple: z.boolean().default(false)
  })

  const multiReplaceFileContent = tool({
    description:
      'Edit MULTIPLE non-contiguous blocks in an existing file in a single call. Chunks are applied in reverse line order to preserve line numbers.',
    inputSchema: z.object({
      targetFile: z.string().describe('Absolute path to the file to edit. Must be within the workspace root.'),
      instruction: z.string().describe('Human-readable description of what changes are being made.'),
      replacementChunks: z.array(ReplacementChunkSchema).min(1).describe('Array of replacement chunks to apply.')
    }),
    execute: async ({ targetFile, instruction, replacementChunks }) => {
      try {
        const safePath = safe(targetFile)
        log.info(`[tool:multiReplaceFileContent] ${safePath} — ${instruction} (${replacementChunks.length} chunks)`)

        const raw = await fs.readFile(safePath, 'utf-8')
        const isCrlf = raw.includes('\r\n')
        let normalizedRaw = raw.replace(/\r\n/g, '\n')

        const sorted = [...replacementChunks].sort((a, b) => b.startLine - a.startLine)
        const results: { startLine: number; endLine: number; occurrencesReplaced: number }[] = []

        for (const chunk of sorted) {
          const allLines = normalizedRaw.split('\n')
          const start = Math.max(1, chunk.startLine)
          const end = Math.min(allLines.length, chunk.endLine)

          const beforeLines = allLines.slice(0, start - 1)
          const rangeLines = allLines.slice(start - 1, end)
          const afterLines = allLines.slice(end)
          const rangeText = rangeLines.join('\n')

          const occurrences = rangeText.split(chunk.targetContent).length - 1
          if (occurrences === 0) {
            throw new Error(`Chunk [lines ${start}–${end}]: TargetContent not found in "${safePath}".\nSearched for:\n${chunk.targetContent}`)
          }
          if (occurrences > 1 && !chunk.allowMultiple) {
            throw new Error(`Chunk [lines ${start}–${end}]: Multiple occurrences (${occurrences}) found. Set allowMultiple=true to replace all.`)
          }

          const newRangeText = chunk.allowMultiple
            ? rangeText.split(chunk.targetContent).join(chunk.replacementContent)
            : rangeText.replace(chunk.targetContent, () => chunk.replacementContent)

          normalizedRaw = [...beforeLines, ...newRangeText.split('\n'), ...afterLines].join('\n')
          results.push({ startLine: start, endLine: end, occurrencesReplaced: occurrences })
        }

        const finalContent = isCrlf ? normalizedRaw.replace(/\n/g, '\r\n') : normalizedRaw
        await fs.writeFile(safePath, finalContent, 'utf-8')
        log.info(`[tool:multiReplaceFileContent] done — ${results.length} chunks applied`)
        return { success: true, absolutePath: safePath, chunksApplied: results.length, results }
      } catch (err: any) {
        log.error('[tool:multiReplaceFileContent] error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const runCommand = tool({
    description:
      'Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code. Dangerous commands (sudo, rm -rf /, curl|sh) are blocked. Timeout defaults to 30s.',
    inputSchema: z.object({
      commandLine: z.string().describe('The exact shell command to execute.'),
      cwd: z.string().optional().describe('Absolute path to run the command in. Must be within workspace root. Defaults to workspace root.'),
      waitMsBeforeAsync: z.number().int().min(0).max(60000).optional().default(30000).describe('Timeout in milliseconds (max 60000).')
    }),
    execute: async ({ commandLine, cwd, waitMsBeforeAsync }) => {
      try {
        const ctx = wctx()
        const runDir = cwd ? assertWithinWorkspace(ctx.rootPath, cwd, convId) : ctx.rootPath

        if (isCommandBlocked(commandLine)) {
          return { stdout: '', stderr: `Command blocked for security: "${commandLine}"`, exitCode: 1, success: false }
        }

        log.info(`[tool:runCommand] cwd=${runDir} cmd=${commandLine}`)
        const result = await execa(commandLine, {
          shell: true,
          cwd: runDir,
          timeout: waitMsBeforeAsync ?? 30000,
          reject: false,
          env: { ...process.env, FORCE_COLOR: '1', PAGER: 'cat' }
        })
        return {
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: result.exitCode ?? 0,
          success: result.exitCode === 0,
          cwd: runDir
        }
      } catch (err: any) {
        log.error('[tool:runCommand] error:', err)
        return { success: false, error: err.message, stdout: '', stderr: err.message, exitCode: 1 }
      }
    }
  })

  const searchWeb = tool({
    description:
      'Search the web using the Tavily API and return a summary of relevant results with URL citations.',
    inputSchema: z.object({
      query: z.string().describe('The search query.'),
      domain: z.string().optional().describe('Optional domain to prioritize in results.'),
      maxResults: z.number().int().min(1).max(10).optional().default(5).describe('Max number of results (1–10, default 5).')
    }),
    execute: async ({ query, domain, maxResults }) => {
      log.info(`[tool:searchWeb] query="${query}" domain=${domain ?? 'any'}`)
      try {
        const response = await tavilyClient.search(query, {
          maxResults: maxResults ?? 5,
          includeDomains: domain ? [domain] : undefined,
          includeAnswer: true
        })
        const results = (response.results ?? []).map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
          score: r.score
        }))
        return { query, answer: response.answer ?? null, results, totalResults: results.length }
      } catch (err: any) {
        log.error('[tool:searchWeb] Tavily error:', err)
        return { success: false, error: `Web search failed: ${err.message}` }
      }
    }
  })

  return { listDir, viewFile, writeToFile, replaceFileContent, multiReplaceFileContent, runCommand, searchWeb }
}

// ─── Browser automation worker ───────────────────────────────────────────

let workerInstance: Worker | null = null
let automatedBrowser: any = null

function customNodeAdapter(port: any): any {
  const listeners = new WeakMap()
  return {
    postMessage(message: any, transfer?: any[]) { port.postMessage(message, transfer) },
    addEventListener(type: string, eh: any) {
      if (type === 'message') {
        const l = (data: any) => {
          if (eh && typeof eh === 'object' && 'handleEvent' in eh) eh.handleEvent({ data })
          else eh({ data })
        }
        port.on('message', l)
        listeners.set(eh, l)
      }
    },
    removeEventListener(type: string, eh: any) {
      if (type === 'message') {
        const l = listeners.get(eh)
        if (l) { port.off('message', l); listeners.delete(eh) }
      }
    }
  }
}

export function startBrowserAgentWorker() {
  if (workerInstance) return automatedBrowser
  const workerPath = join(__dirname, 'browserWorker.js')
  log.info(`[tools] Spawning Playwright background worker at: ${workerPath}`)
  workerInstance = new Worker(workerPath)
  automatedBrowser = wrap(customNodeAdapter(workerInstance))
  return automatedBrowser
}

export async function stopBrowserAgentWorker() {
  if (automatedBrowser) {
    try { await automatedBrowser.disconnect() } catch {}
    automatedBrowser = null
  }
  if (workerInstance) {
    await workerInstance.terminate()
    workerInstance = null
  }
}

// ─── Browser tools (stateless — no convId needed) ────────────────────────

export const browserNavigate = tool({
  description: 'Navigates the active browser viewport to a specified URL.',
  inputSchema: z.object({ url: z.string().describe('The URL to navigate to.') }),
  execute: async ({ url }) => {
    log.info(`[tool:browserNavigate] url="${url}"`)
    const agent = startBrowserAgentWorker()
    try { return await agent.navigate(url) }
    catch (err: any) { log.error('[tool:browserNavigate] worker error:', err); return { success: false, error: err.message } }
  }
})

export const browserType = tool({
  description: 'Types text into an input field on the active webpage. Supports piercing iframes via frameSelector.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the input field.'),
    text: z.string().describe('The text to type.'),
    frameSelector: z.string().optional().describe('Optional CSS selector of the iframe containing the target input.')
  }),
  execute: async ({ selector, text, frameSelector }) => {
    log.info(`[tool:browserType] selector="${selector}"`)
    const agent = startBrowserAgentWorker()
    try { return await agent.type(selector, text, frameSelector) }
    catch (err: any) { log.error('[tool:browserType] worker error:', err); return { success: false, error: err.message } }
  }
})

export const browserScroll = tool({
  description: 'Scrolls the active webpage viewport.',
  inputSchema: z.object({
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction.'),
    amount: z.number().int().positive().optional().describe('Pixels to scroll (default 400).')
  }),
  execute: async ({ direction, amount }) => {
    log.info(`[tool:browserScroll] direction="${direction}" amount=${amount ?? 400}`)
    const agent = startBrowserAgentWorker()
    try { return await agent.scroll(direction, amount) }
    catch (err: any) { log.error('[tool:browserScroll] worker error:', err); return { success: false, error: err.message } }
  }
})

export const browserScreenshot = tool({
  description: 'Captures a PNG screenshot of the active browser viewport.',
  inputSchema: z.object({}),
  execute: async () => {
    log.info('[tool:browserScreenshot] executing...')
    const agent = startBrowserAgentWorker()
    try {
      const cid = getActiveConversationId()
      const screenshotDir = join(app.getPath('userData'), 'conversations', cid, 'screenshots')
      await fs.mkdir(screenshotDir, { recursive: true })

      // Rotate: keep only the last 10 screenshots
      try {
        const existing = await fs.readdir(screenshotDir)
        const pngs = existing.filter(f => f.endsWith('.png')).sort()
        for (const old of pngs.slice(0, Math.max(0, pngs.length - 9))) {
          await fs.rm(join(screenshotDir, old), { force: true })
        }
      } catch {}

      const filename = `screenshot_${Date.now()}.png`
      const screenshotPath = join(screenshotDir, filename)
      const res = await agent.screenshot(screenshotPath)
      if (res.success) {
        return { success: true, message: 'Screenshot captured.', filePath: `file://${screenshotPath}`, filename }
      }
      return res
    } catch (err: any) {
      log.error('[tool:browserScreenshot] worker error:', err)
      return { success: false, error: err.message }
    }
  },
  toModelOutput: async (result: any) => {
    if (result.success && result.filePath) {
      try {
        const cleanPath = result.filePath.replace('file://', '')
        const base64Image = (await fs.readFile(cleanPath)).toString('base64')
        return {
          type: 'content',
          value: [
            { type: 'image-data', data: base64Image, mediaType: 'image/png' },
            { type: 'text', text: `Screenshot captured: ${result.filePath}` }
          ]
        }
      } catch (err: any) {
        return { type: 'content', value: [{ type: 'text', text: `Failed to read screenshot: ${err.message}` }] }
      }
    }
    return { type: 'content', value: [{ type: 'text', text: result.error || 'Failed to capture screenshot' }] }
  }
})

export const browserMouseClickCoordinate = tool({
  description: 'Clicks at a specific pixel coordinate.',
  inputSchema: z.object({
    x: z.number().int().describe('X coordinate.'),
    y: z.number().int().describe('Y coordinate.'),
    button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button.')
  }),
  execute: async ({ x, y, button }) => {
    log.info(`[tool:browserMouseClickCoordinate] x=${x} y=${y} button="${button}"`)
    const agent = startBrowserAgentWorker()
    try { return await agent.mouseClickCoordinate(x, y, button) }
    catch (err: any) { log.error('[tool:browserMouseClickCoordinate] worker error:', err); return { success: false, error: err.message } }
  }
})

export const browserTools = {
  browserNavigate,
  browserType,
  browserScroll,
  browserScreenshot,
  browserMouseClickCoordinate
}
