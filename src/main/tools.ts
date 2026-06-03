import 'dotenv/config'
import { tool } from 'ai'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { join, relative, extname, dirname } from 'node:path'
import { execa } from 'execa'
import log from 'electron-log'
import { rgPath } from '@vscode/ripgrep'
import { tavilyLimiter } from './limiters'
import { getWorkspaceContext, assertWithinWorkspace } from './workspace'
import { nodeAdapter } from './nodeAdapter'
import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { wrap } from 'comlink'
import mime from 'mime-types'

// Natively register TypeScript extension mapping in the mime-types registry to override default MPEG-TS video mapping
mime.types['ts'] = 'application/typescript'
mime.types['tsx'] = 'application/typescript'

function resolveWorkspace(convId: string) {
  const ctx = getWorkspaceContext(convId)
  if (!ctx)
    throw new Error(
      `No workspace context for conversation ${convId}. Workspace must be initialized before tool execution.`
    )
  return ctx
}

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+(-[rRf]+\s+)?[\/~]/,
  /\bsudo\b/,
  /\bcurl\b.*\|\s*(ba)?sh/,
  /\bwget\b.*\|\s*(ba)?sh/
]

function isCommandBlocked(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

const getMimeType = (filePath: string) => {
  return mime.lookup(filePath) || 'application/octet-stream'
}

const BINARY_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/octet-stream',
  'application/zip',
  'application/x-tar',
  'application/pdf'
]
const TEXT_MIME_PREFIXES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript'
]

function isFileBinary(filePath: string, buf: Buffer): boolean {
  const detectedMime = getMimeType(filePath)

  if (TEXT_MIME_PREFIXES.some((p) => detectedMime.startsWith(p))) return false

  if (BINARY_MIME_PREFIXES.some((p) => detectedMime.startsWith(p))) return true

  return buf.subarray(0, 512).includes(0x00)
}

function sliceLines(allLines: string[], startLine: number, endLine: number) {
  const start = Math.max(1, startLine)
  const end = Math.min(allLines.length, endLine)
  const beforeLines = allLines.slice(0, start - 1)
  const rangeLines = allLines.slice(start - 1, end)
  const afterLines = allLines.slice(end)
  const rangeText = rangeLines.join('\n')
  return { start, end, beforeLines, rangeLines, afterLines, rangeText }
}

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
              try {
                numChildren = (await fs.readdir(fullPath)).length
              } catch {}
            } else {
              try {
                sizeBytes = (await fs.stat(fullPath)).size
              } catch {}
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

        if (isFileBinary(safePath, rawBuffer)) {
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

        return {
          content: numberedContent,
          rawContent: targetLines.join('\n'),
          absolutePath: safePath,
          totalLines,
          readStart: start,
          readEnd: end,
          truncated: wasTruncated
        }
      } catch (err: any) {
        log.error('[tool:viewFile] error:', err)
        return { success: false, error: err.message }
      }
    },
    toModelOutput: ({ output }: { output: any }) => {
      if (output.isBinary && output.mimeType?.startsWith('image/') && output.base64Content) {
        return {
          type: 'content',
          value: [
            { type: 'image-data', data: output.base64Content, mediaType: output.mimeType },
            { type: 'text', text: `Successfully analyzed binary image: ${output.absolutePath}` }
          ]
        }
      }
      return {
        type: 'content',
        value: [{ type: 'text', text: output.content || output.error || 'No content' }]
      }
    }
  })

  const writeToFile = tool({
    description:
      'Create a new file (or overwrite an existing one) within the workspace. Parent directories are created automatically. Set overwrite=true to replace an existing file.',
    inputSchema: z.object({
      targetFile: z
        .string()
        .describe('Absolute path for the file to create. Must be within the workspace root.'),
      codeContent: z.string().describe('Full file content to write.'),
      overwrite: z
        .boolean()
        .default(false)
        .describe('If true, overwrite an existing file. Defaults to false.')
    }),
    execute: async ({ targetFile, codeContent, overwrite }) => {
      try {
        const safePath = safe(targetFile)

        let exists = false
        try {
          await fs.stat(safePath)
          exists = true
        } catch {}

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
      'Edit a SINGLE contiguous block in an existing file. Replaces the content in the line range [startLine, endLine] with ReplacementContent.',
    inputSchema: z.object({
      targetFile: z
        .string()
        .describe('Absolute path to the file to edit. Must be within the workspace root.'),
      replacementContent: z.string().describe('Replacement content for the line block.'),
      startLine: z
        .number()
        .int()
        .min(1)
        .describe('Start of the line range to replace (1-indexed).'),
      endLine: z
        .number()
        .int()
        .min(1)
        .describe('End of the line range to replace (1-indexed, inclusive).')
    }),
    execute: async ({ targetFile, replacementContent, startLine, endLine }) => {
      try {
        const safePath = safe(targetFile)
        const raw = await fs.readFile(safePath, 'utf-8')
        const isCrlf = raw.includes('\r\n')
        const normalizedRaw = raw.replace(/\r\n/g, '\n')
        const allLines = normalizedRaw.split('\n')

        const { beforeLines, afterLines } = sliceLines(allLines, startLine, endLine)

        const newLines = [...beforeLines, ...replacementContent.split('\n'), ...afterLines]
        const finalContent = isCrlf ? newLines.join('\r\n') : newLines.join('\n')

        await fs.writeFile(safePath, finalContent, 'utf-8')
        log.info(`[tool:replaceFileContent] edited ${safePath} (lines: ${startLine}-${endLine})`)
        return { success: true, absolutePath: safePath }
      } catch (err: any) {
        log.error('[tool:replaceFileContent] error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  const ReplacementChunkSchema = z.object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    replacementContent: z.string()
  })

  const multiReplaceFileContent = tool({
    description:
      'Edit MULTIPLE non-contiguous blocks in an existing file in a single call. Chunks are applied in reverse line order to preserve line numbers.',
    inputSchema: z.object({
      targetFile: z
        .string()
        .describe('Absolute path to the file to edit. Must be within the workspace root.'),
      instruction: z
        .string()
        .describe('Human-readable description of what changes are being made.'),
      replacementChunks: z
        .array(ReplacementChunkSchema)
        .min(1)
        .describe('Array of replacement chunks to apply.')
    }),
    execute: async ({ targetFile, instruction, replacementChunks }) => {
      try {
        const safePath = safe(targetFile)
        log.info(
          `[tool:multiReplaceFileContent] ${safePath} — ${instruction} (${replacementChunks.length} chunks)`
        )

        const raw = await fs.readFile(safePath, 'utf-8')
        const isCrlf = raw.includes('\r\n')
        let normalizedRaw = raw.replace(/\r\n/g, '\n')

        const sorted = [...replacementChunks].sort((a, b) => b.startLine - a.startLine)
        const results: { startLine: number; endLine: number }[] = []

        for (const chunk of sorted) {
          const allLines = normalizedRaw.split('\n')
          const { start, end, beforeLines, afterLines } = sliceLines(
            allLines,
            chunk.startLine,
            chunk.endLine
          )

          normalizedRaw = [
            ...beforeLines,
            ...chunk.replacementContent.split('\n'),
            ...afterLines
          ].join('\n')
          results.push({ startLine: start, endLine: end })
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
      cwd: z
        .string()
        .optional()
        .describe(
          'Absolute path to run the command in. Must be within workspace root. Defaults to workspace root.'
        ),
      waitMsBeforeAsync: z
        .number()
        .int()
        .min(0)
        .max(180000)
        .optional()
        .default(60000)
        .describe('Timeout in milliseconds (max 180000). Defaults to 60000.')
    }),
    execute: async ({ commandLine, cwd, waitMsBeforeAsync }) => {
      try {
        const ctx = wctx()
        const runDir = cwd ? assertWithinWorkspace(ctx.rootPath, cwd, convId) : ctx.rootPath

        if (isCommandBlocked(commandLine)) {
          return {
            stdout: '',
            stderr: `Command blocked for security: "${commandLine}"`,
            exitCode: 1,
            success: false
          }
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

  const searchWorkspace = tool({
    description:
      'Searches the workspace for files containing a specific regex pattern using ripgrep. Use to find where functions/variables are defined or used.',
    inputSchema: z.object({
      query: z.string().describe('The regex query to search for.'),
      includes: z
        .array(z.string())
        .optional()
        .describe('Optional array of glob patterns to filter files (e.g. ["*.ts", "*.tsx"]).')
    }),
    execute: async ({ query, includes }) => {
      try {
        const ctx = wctx()
        const runDir = ctx.rootPath

        const args = ['-n', '-I', '--smart-case']
        if (includes && includes.length > 0) {
          for (const glob of includes) {
            args.push('-g', glob)
          }
        }
        args.push('--', query, runDir)

        const result = await execa(rgPath, args, {
          shell: false,
          cwd: runDir,
          reject: false,
          timeout: 10000
        })

        if (result.exitCode !== 0 && result.stdout.trim() === '') {
          // Exit code 1 = no matches (not an error), exit code 2+ = actual error
          if (result.exitCode === 1) return { success: true, results: 'No matches found.' }
          if ((result as { code?: string }).code === 'ENOENT' || result.stderr?.includes('not found') || result.stderr?.includes('No such file')) {
            return { success: false, error: 'ripgrep (rg) not found. Install it via: winget install BurntSushi.ripgrep.MSVC or scoop install ripgrep' }
          }
          return { success: true, results: 'No matches found.' }
        }

        const output = result.stdout.trim()
        // Strip the leading rootPath prefix from each match line for cleaner output
        const rootPrefix = runDir.replace(/\\/g, '/') + '/'
        const cleaned = output
          .split('\n')
          .map((line) => {
            const normalized = line.replace(/\\/g, '/')
            return normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized
          })
          .join('\n')

        const lines = cleaned.split('\n')
        if (lines.length > 200) {
          return {
            success: true,
            results:
              lines.slice(0, 200).join('\n') +
              `\n\n... (truncated ${lines.length - 200} more matches. Refine your query or add glob filters.)`
          }
        }

        return { success: true, results: cleaned }
      } catch (err: any) {
        log.error('[tool:searchWorkspace] error:', err)
        if (err.code === 'ENOENT') {
          return { success: false, error: 'ripgrep (rg) not found in PATH. Install it via: winget install BurntSushi.ripgrep.MSVC' }
        }
        return { success: false, error: err.message }
      }
    }
  })

  const searchWeb = tool({
    description:
      'Search the web using the Tavily API and return a summary of relevant results with URL citations.',
    inputSchema: z.object({
      query: z.string().describe('The search query.'),
      domain: z.string().optional().describe('Optional domain to prioritize in results.'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(5)
        .describe('Max number of results (1–10, default 5).')
    }),
    execute: async ({ query, domain, maxResults }) => {
      return tavilyLimiter.schedule(async () => {
        log.info(`[tool:searchWeb] query="${query}" domain=${domain ?? 'any'}`)
        try {
          const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/tavily`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
              apikey: process.env.SUPABASE_ANON_KEY || '',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, domain, maxResults })
          })
          if (!response.ok) throw new Error(`Proxy error: HTTP ${response.status}`)
          const data = await response.json()
          const results = (data.results ?? []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
            score: r.score
          }))
          return { query, answer: data.answer ?? null, results, totalResults: results.length }
        } catch (err: any) {
          log.error('[tool:searchWeb] Tavily error:', err)
          return { success: false, error: `Web search failed: ${err.message}` }
        }
      })
    }
  })

  return {
    listDir,
    viewFile,
    writeToFile,
    replaceFileContent,
    multiReplaceFileContent,
    runCommand,
    searchWorkspace,
    searchWeb
  }
}

let workerInstance: Worker | null = null
let automatedBrowser: any = null

function checkBrowserViewActive(): { success: boolean; error?: string } | null {
  const bv = (globalThis as unknown as { browserView?: Electron.WebContentsView }).browserView
  if (!bv) {
    return {
      success: false,
      error:
        'The Browser panel is not currently open in the Artifacts screen. Please click the Browser icon in the right side panel to open it before using browser tools.'
    }
  }
  return null
}

export function startBrowserAgentWorker() {
  if (workerInstance) return automatedBrowser
  const mainWindow = (globalThis as unknown as { mainWindow?: Electron.BrowserWindow }).mainWindow
  const mainWindowUrl = mainWindow?.webContents.getURL() || ''
  const workerPath = join(__dirname, 'browserWorker.js')
  log.info(`[tools] Spawning Playwright background worker at: ${workerPath}`)
  workerInstance = new Worker(workerPath, { workerData: { mainWindowUrl } })
  automatedBrowser = wrap(nodeAdapter(workerInstance))
  return automatedBrowser
}

export async function stopBrowserAgentWorker() {
  if (automatedBrowser) {
    try {
      await automatedBrowser.disconnect()
    } catch {}
    automatedBrowser = null
  }
  if (workerInstance) {
    await workerInstance.terminate()
    workerInstance = null
  }
}

export function browserTools(convId: string) {
  const browserNavigate = tool({
    description: 'Navigates the active browser viewport to a specified URL.',
    inputSchema: z.object({ url: z.string().describe('The URL to navigate to.') }),
    execute: async ({ url }) => {
      log.info(`[tool:browserNavigate] url="${url}"`)
      const check = checkBrowserViewActive()
      if (check) return check
      const agent = startBrowserAgentWorker()
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
      try {
        const screenshotDir = join(app.getPath('userData'), 'conversations', convId, 'screenshots')
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
      try {
        return await agent.mouseClickCoordinate(x, y, button)
      } catch (err: any) {
        log.error('[tool:browserMouseClickCoordinate] worker error:', err)
        return { success: false, error: err.message }
      }
    }
  })

  return {
    browserNavigate,
    browserType,
    browserScroll,
    browserScreenshot,
    browserMouseClickCoordinate
  }
}
