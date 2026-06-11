export function tool<T extends z.ZodTypeAny, R>(spec: { description?: string; inputSchema: T; execute: (args: z.infer<T>, options?: any) => Promise<R>; toModelOutput?: (options: { output: R }) => any }) { return spec }
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { join, relative, extname, dirname, basename } from 'node:path'
import { execa } from 'execa'
import { rgPath } from '@vscode/ripgrep'
import { parse } from 'shell-quote'
import log from 'electron-log'
import {
  getWorkspaceContext, assertWithinWorkspace, isFileBinary, getMimeType, invalidateWorkspaceFilesCache, getOrCreateWorkspaceContext
} from './workspace'
import WindowManager, { getConversationScreenshotsPath, tavilyLimiter, getApiBaseUrl } from './utils'
import { requireAuthToken } from './auth'
import { getParserForExtension, getTokens, findSyntaxErrors, getFileOutline } from './astParser'



export const MAX_FILE_READ_BYTES = 25 * 1024 * 1024

const wctx = (convId: string) => {
  const ctx = getWorkspaceContext(convId)
  if (!ctx) throw new Error(`No workspace context for conversation ${convId}.`)
  return ctx
}

async function applyEditsToFile(filePath: string, edits: { targetContent: string; replacementContent: string }[]): Promise<void> {
  let raw = await fs.readFile(filePath, 'utf-8')
  const isCrlf = raw.includes('\r\n')
  if (isCrlf) raw = raw.replace(/\r\n/g, '\n')
  const ext = extname(filePath), parser = await getParserForExtension(ext)
  for (const edit of edits) {
    let replaced = false
    if (parser) {
      try {
        const fileTree = parser.parse(raw), targetTree = parser.parse(edit.targetContent)
        if (fileTree && targetTree) {
          const fileTokens = getTokens(fileTree.rootNode).filter(t => t.text.trim().length > 0)
          const targetTokens = getTokens(targetTree.rootNode).filter(t => t.text.trim().length > 0)
          if (targetTokens.length > 0 && fileTokens.length >= targetTokens.length) {
            const matches: { startIndex: number; endIndex: number; score: number }[] = []
            const fuzzyThreshold = 0.85
            for (let i = 0; i <= fileTokens.length - targetTokens.length; i++) {
              let exactMatches = 0, tolerantMatches = 0
              for (let j = 0; j < targetTokens.length; j++) {
                const fToken = fileTokens[i + j].text, tToken = targetTokens[j].text
                if (fToken === tToken) { exactMatches++; tolerantMatches++ }
                else if (fToken.replace(/\s+/g, '') === tToken.replace(/\s+/g, '')) tolerantMatches++
                else if (fToken.replace(/['"]/g, '') === tToken.replace(/['"]/g, '')) tolerantMatches++
              }
              const score = tolerantMatches / targetTokens.length
              if (exactMatches === targetTokens.length) {
                matches.push({ startIndex: fileTokens[i].startIndex, endIndex: fileTokens[i + targetTokens.length - 1].endIndex, score: 1.0 })
              } else if (score >= fuzzyThreshold) {
                matches.push({ startIndex: fileTokens[i].startIndex, endIndex: fileTokens[i + targetTokens.length - 1].endIndex, score })
              }
            }
            matches.sort((a, b) => b.score - a.score)
            if (matches.length === 1 || (matches.length > 1 && matches[0].score > matches[1].score + 0.1)) {
              const m = matches[0]
              raw = raw.slice(0, m.startIndex) + edit.replacementContent + raw.slice(m.endIndex)
              replaced = true
            } else if (matches.length > 1) {
              throw new Error(`AST Token matching found ${matches.length} similar blocks (scores: ${matches.slice(0, 3).map(m => m.score.toFixed(2)).join(', ')}). Provide more context to uniquely identify the section.`)
            }
          }
        }
      } catch (err) {
        log.warn(`[AST Patch] Failed for ${filePath}:`, err)
      }
    }
    if (!replaced) {
      if (!raw.includes(edit.targetContent)) {
        const normalized = edit.targetContent.replace(/\s+/g, ' ').trim()
        const rawNormalized = raw.replace(/\s+/g, ' ')
        if (rawNormalized.includes(normalized)) {
          throw new Error(`Target content found with different whitespace. AST matching failed. Ensure exact whitespace/formatting matches file:\n${edit.targetContent.slice(0, 100)}...`)
        }
        throw new Error(`Target content not found in file. Ensure exact whitespace matching for:\n${edit.targetContent.slice(0, 100)}...`)
      }
      const occurrences = raw.split(edit.targetContent).length - 1
      if (occurrences > 1) {
        throw new Error(`Target content occurs ${occurrences} times in the file. Please provide a larger block of code to uniquely identify the section to replace.`)
      }
      raw = raw.replace(edit.targetContent, edit.replacementContent)
    }
  }
  await fs.writeFile(filePath, isCrlf ? raw.replace(/\n/g, '\r\n') : raw, 'utf-8')
}

// --- Shell Tools Helpers ---
const BLOCKED_EXECUTABLES = new Set([
  'shutdown', 'reboot', 'init',
  'mkfs', 'fdisk', 'format', 'dd',
  'passwd', 'chroot',
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'ash', 'csh', 'tcsh'
])
const WRAPPERS = new Set(['env', 'npx', 'pnpx', 'yarn', 'npm', 'pnpm', 'bun', 'sudo', 'su', 'runas', 'gksudo'])

function checkBlocklist(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith('-') || t.includes('=')) continue
    const base = basename(t).toLowerCase()
    if (BLOCKED_EXECUTABLES.has(base) || BLOCKED_EXECUTABLES.has(t.toLowerCase())) return t
    if (WRAPPERS.has(base)) {
      if ((base === 'npm' || base === 'yarn' || base === 'pnpm' || base === 'bun') && tokens[i+1] === 'run') i++
      continue
    }
    break
  }
  return null
}

function tokenizeCommand(commandLine: string): string[] {
  return parse(commandLine).map(t => typeof t === 'string' ? t : ('pattern' in t ? t.pattern : ('op' in t ? t.op : ''))).filter(Boolean)
}

function resolveWorkspace(convId: string) {
  const ctx = getWorkspaceContext(convId)
  if (!ctx) throw new Error(`No workspace context for conversation ${convId}. Workspace must be initialized before tool execution.`)
  return ctx
}

// --- Browser Tools Helpers ---
function getOrCreateBrowserWebContents(convId: string) {
  let bv = WindowManager.getBrowserViewForConversation(convId)
  if (!bv) {
    const { WebContentsView } = require('electron')
    const partition = `persist:conversation_${convId}`
    const newBv = new WebContentsView({ webPreferences: { webSecurity: true, nodeIntegration: false, contextIsolation: true, sandbox: true, partition } }) as import('electron').WebContentsView
    newBv.setBounds({ x: 0, y: 0, width: 1024, height: 768 })
    WindowManager.setBrowserViewForConversation(convId, newBv)
    bv = newBv
  }
  return bv!.webContents
}

function checkBrowserViewActive(convId?: string) {
  if (convId) getOrCreateBrowserWebContents(convId)
  return null
}

export function createCoreTools(convId: string, modelSupportsVision = true) {
  const resolve = () => wctx(convId)
  const safe = (p: string) => assertWithinWorkspace(resolve().rootPath, p, convId)

  // -- FILE TOOLS --
  const listDir = tool({
    description: 'Lists all files, subdirectories, and their metadata directly inside a directory within the active workspace. Useful for understanding project layout, checking folder structures, and locating files. Returns file sizes and sub-item counts.',
    inputSchema: z.object({ directoryPath: z.string().describe('The absolute, fully-qualified system path of the directory to list. Must reside within the workspace boundaries.') }),
    execute: async (args: any) => {
      try {
        const directoryPath = args.directoryPath || args.path
        if (!directoryPath) throw new Error('directoryPath parameter is required')
        const ctx = resolve(), safePath = safe(directoryPath)
        const rawEntries = await fs.readdir(safePath, { withFileTypes: true })
        const entries = await Promise.all(rawEntries.map(async (entry) => {
          const fullPath = join(safePath, entry.name), relativePath = relative(ctx.rootPath, fullPath), isDirectory = entry.isDirectory()
          let sizeBytes: number | undefined, numChildren: number | undefined
          if (isDirectory) { try { numChildren = (await fs.readdir(fullPath)).length } catch (err) { log.debug('[fileTools] Error reading dir children:', err) } }
          else { try { sizeBytes = (await fs.stat(fullPath)).size } catch (err) { log.debug('[fileTools] Error stat file size:', err) } }
          return { name: entry.name, relativePath, absolutePath: fullPath, isDirectory, extension: isDirectory ? undefined : extname(entry.name), sizeBytes, numChildren }
        }))
        entries.sort((a, b) => (a.isDirectory && !b.isDirectory) ? -1 : (!a.isDirectory && b.isDirectory) ? 1 : a.name.localeCompare(b.name))
        return { entries, dirPath: safePath, rootPath: ctx.rootPath }
      } catch (err: any) { log.error('[tool:listDir] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.success === false) return { type: 'content', value: [{ type: 'text', text: `Error: ${output.error}` }] }
      const text = output.entries.map((e: any) => e.isDirectory ? `[DIR] ${e.name}/ (${e.numChildren ?? '?'} items)` : `[FILE] ${e.name} (${e.sizeBytes ?? '?'} bytes)`).join('\n')
      return { type: 'content', value: [{ type: 'text', text: text || 'Empty directory' }] }
    }
  })

  const viewFile = tool({
    description: 'Reads the text or binary content of a file within the workspace. For text files, returns a line-numbered block range. Reading is capped at 800 lines per call to optimize model context—use startLine/endLine pagination to read larger files. Automatically parses binary content (like images) and returns base64 content if vision is supported.',
    inputSchema: z.object({
      absolutePath: z.string().describe('The absolute, fully-qualified system path of the target file to read.'),
      startLine: z.number().int().min(1).optional().describe('The 1-indexed line number to start reading from (inclusive). Defaults to 1.'),
      endLine: z.number().int().min(1).optional().describe('The 1-indexed line number to stop reading at (inclusive). Range cannot exceed 800 lines. Defaults to startLine + 799.')
    }),
    execute: async (args: any) => {
      try {
        const absolutePath = args.absolutePath || args.path || args.filePath || args.targetFile
        if (!absolutePath) throw new Error('absolutePath parameter is required')
        const { startLine, endLine } = args
        const safePath = safe(absolutePath), stat = await fs.stat(safePath)
        if (!stat.isFile()) throw new Error(`Not a file: "${safePath}"`)
        if (stat.size > MAX_FILE_READ_BYTES) throw new Error('File exceeds 25 MB read limit.')
        const rawBuffer = await fs.readFile(safePath)
        if (isFileBinary(safePath, rawBuffer)) {
          const mimeType = getMimeType(safePath)
          return { content: `[Binary File: ${mimeType}] Base64 data included.`, base64Content: rawBuffer.toString('base64'), mimeType, absolutePath: safePath, isBinary: true, sizeBytes: stat.size }
        }
        const content = rawBuffer.toString('utf-8'), allLines = content.split('\n'), totalLines = allLines.length
        const start = startLine !== undefined ? Math.max(1, startLine) : 1
        if (start > totalLines) throw new Error(`Invalid startLine: file only has ${totalLines} lines.`)
        const end = endLine !== undefined ? Math.min(totalLines, endLine) : Math.min(totalLines, start + 799)
        if (end < start) throw new Error('Invalid line range: endLine cannot be less than startLine.')
        if (end - start + 1 > 800) throw new Error('Line range limit exceeded: cannot read more than 800 lines at a time.')
        const targetLines = allLines.slice(start - 1, end), contentChunk = targetLines.join('\n')
        return { content: contentChunk, absolutePath: safePath, totalLines, readStart: start, readEnd: end, truncated: end < totalLines }
      } catch (err: any) { log.error('[tool:viewFile] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.isBinary && output.mimeType?.startsWith('image/') && output.base64Content) {
        if (!modelSupportsVision) return { type: 'content', value: [{ type: 'text', text: `Binary image file: ${output.absolutePath} (${output.sizeBytes} bytes). Vision not supported.` }], isBinary: true }
        return { type: 'image-data', data: output.base64Content, mediaType: output.mimeType }
      }
      const text = `[METADATA: readStart=${output.readStart}, readEnd=${output.readEnd}]\n` + (output.content || output.error || 'No content')
      return { type: 'content', value: [{ type: 'text', text }], isBinary: output.isBinary }
    }
  })
 
  const writeToFile = tool({
    description: 'Creates a new file in the workspace or overwrites an existing one if the overwrite flag is true. Automatically creates any parent directories if they do not exist.',
    inputSchema: z.object({ targetFile: z.string().describe('The absolute, fully-qualified system path where the file should be created.'), codeContent: z.string().describe('The complete string content to write into the file.'), overwrite: z.boolean().default(false).describe('Set to true to explicitly overwrite the file if it already exists; otherwise, will error.') }),
    execute: async (args: any) => {
      try {
        const targetFile = args.targetFile || args.path || args.filePath || args.absolutePath
        if (!targetFile) throw new Error('targetFile parameter is required')
        const codeContent = args.codeContent ?? args.content ?? args.code ?? args.text ?? args.data
        if (codeContent === undefined) throw new Error('codeContent parameter is required')
        const overwrite = !!(args.overwrite ?? false)
        const ctx = resolve(), safePath = safe(targetFile)
        let exists = false
        try { await fs.stat(safePath); exists = true } catch (err) { log.debug('[fileTools] File existence check failed:', err) }
        if (exists && !overwrite) throw new Error(`File already exists: "${safePath}". Set overwrite=true.`)
        await fs.mkdir(dirname(safePath), { recursive: true })
        await fs.writeFile(safePath, codeContent, 'utf-8')
        invalidateWorkspaceFilesCache(ctx.rootPath)
        let syntaxErrors: any[] = []
        try {
          const ext = extname(safePath), parser = await getParserForExtension(ext)
          if (parser) {
            const tree = parser.parse(codeContent)
            if (tree.rootNode.hasError()) syntaxErrors = findSyntaxErrors(tree.rootNode)
          }
        } catch (e) { log.warn('[writeToFile syntax check] failed:', e) }
        return { success: true, absolutePath: safePath, created: !exists, syntaxErrors }
      } catch (err: any) { log.error('[tool:writeToFile] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.success === false) return { type: 'content', value: [{ type: 'text', text: `Error: ${output.error}` }] }
      let msg = `Successfully wrote to file ${output.absolutePath}.`
      if (output.syntaxErrors?.length) {
        msg += `\n⚠️ WARNING: File contains syntax errors:\n` + output.syntaxErrors.map((e: any) => `Line ${e.line}, Col ${e.column}: ${e.text}`).join('\n')
      }
      return { type: 'content', value: [{ type: 'text', text: msg }] }
    }
  })
 
  const multiReplaceFileContent = tool({
    description: 'Surgically edits one or more non-contiguous text blocks in an existing file. Uses Abstract Syntax Tree (AST) token matching for supported source code files (which is resilient to minor spacing, indentation, and quote changes), and falls back to exact string replacement for plain text or unsupported formats. Each chunk\'s targetContent must match exactly a unique section in the file.',
    inputSchema: z.object({
      targetFile: z.string().describe('The absolute, fully-qualified system path of the file to modify.'),
      instruction: z.string().describe('A high-level explanation describing the purpose of these edits or what bug is being fixed.'),
      replacementChunks: z.array(z.object({
        targetContent: z.string().describe('The exact string block to be replaced. Must match exactly, including indentation and whitespace.'),
        replacementContent: z.string().describe('The new content to insert in place of the targetContent.')
      })).min(1).describe('The list of separate, non-adjacent edit chunks to apply.')
    }),
    execute: async (args: any) => {
      try {
        const targetFile = args.targetFile || args.path || args.filePath || args.absolutePath
        if (!targetFile) throw new Error('targetFile parameter is required')
        const rawChunks = args.replacementChunks || args.chunks || args.edits || args.replacements
        if (!rawChunks || !Array.isArray(rawChunks)) throw new Error('replacementChunks parameter is required and must be an array')
        const replacementChunks = rawChunks.map((c: any) => ({
          targetContent: c.targetContent ?? c.oldText ?? c.find ?? c.search ?? '',
          replacementContent: c.replacementContent ?? c.newText ?? c.replace ?? ''
        }))
        const safePath = safe(targetFile), ctx = resolve()
        await applyEditsToFile(safePath, replacementChunks)
        invalidateWorkspaceFilesCache(ctx.rootPath)
        let syntaxErrors: any[] = []
        try {
          const content = await fs.readFile(safePath, 'utf-8')
          const ext = extname(safePath), parser = await getParserForExtension(ext)
          if (parser) {
            const tree = parser.parse(content)
            if (tree.rootNode.hasError()) syntaxErrors = findSyntaxErrors(tree.rootNode)
          }
        } catch (e) { log.warn('[multiReplaceFileContent syntax check] failed:', e) }
        return { success: true, absolutePath: safePath, chunksApplied: replacementChunks.length, syntaxErrors }
      } catch (err: any) { const errMsg = err?.message || String(err || 'Unknown error'); log.error('[tool:multiReplaceFileContent] error:', errMsg); return { success: false, error: errMsg } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.success === false) return { type: 'content', value: [{ type: 'text', text: `Error: ${output.error}` }] }
      let msg = `Successfully applied ${output.chunksApplied} edits to file ${output.absolutePath}.`
      if (output.syntaxErrors?.length) {
        msg += `\n⚠️ WARNING: File contains syntax errors:\n` + output.syntaxErrors.map((e: any) => `Line ${e.line}, Col ${e.column}: ${e.text}`).join('\n')
      }
      return { type: 'content', value: [{ type: 'text', text: msg }] }
    }
  })

  const searchWorkspace = tool({
    description: 'Performs a fast, parallel regular expression search (using Ripgrep) across all files in the active workspace. Useful for finding code symbols, function definitions, classes, or references.',
    inputSchema: z.object({ query: z.string().describe('The regular expression query or literal string to search for across files.'), includes: z.array(z.string()).optional().describe('Optional glob patterns to filter files to search (e.g. ["src/**/*.ts", "package.json"]).') }),
    execute: async ({ query, includes }) => {
      try {
        const ctx = resolve(), runDir = ctx.rootPath, args = ['-n', '-I', '--smart-case']
        if (includes) includes.forEach(g => args.push('-g', g))
        args.push('--', query, runDir)
        const result = await execa(rgPath.replace('app.asar', 'app.asar.unpacked'), args, { shell: false, cwd: runDir, reject: false, timeout: 10000 })
        if (result.exitCode !== 0 && result.stdout.trim() === '') {
          if (result.exitCode === 1) return { success: true, results: 'No matches found.' }
          if ((result as any).code === 'ENOENT' || result.stderr?.includes('not found') || result.stderr?.includes('No such file')) return { success: false, error: 'ripgrep not found.' }
          return { success: false, error: result.stderr || `failed with exit code ${result.exitCode}` }
        }
        const output = result.stdout.trim(), rootPrefix = runDir.replace(/\\/g, '/') + '/'
        const cleaned = output.split('\n').map(line => {
          const norm = line.replace(/\\/g, '/')
          return norm.startsWith(rootPrefix) ? norm.slice(rootPrefix.length) : norm
        }).join('\n')
        const lines = cleaned.split('\n')
        if (lines.length > 200) return { success: true, results: lines.slice(0, 200).join('\n') + `\n\n... (truncated ${lines.length - 200} matches)` }
        return { success: true, results: cleaned }
      } catch (err: any) {
        log.error('[tool:searchWorkspace] error:', err.message)
        return { success: false, error: err.code === 'ENOENT' ? 'ripgrep not found.' : err.message }
      }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : output.results }] })
  })



  // -- SHELL TOOLS --
  const runCommand = tool({
    description: 'Executes a command-line script in the workspace directory. Returns stdout, stderr, and the integer exit code. Blocks destructive or dangerous commands (like sudo, shutdown, passwd, mkfs, and cmd/powershell/bash shells directly). Execution is run with PAGER=cat and FORCE_COLOR=1.',
    inputSchema: z.object({
      commandLine: z.string().max(4096).describe('The command string to execute in the terminal (e.g. "npm run test").'),
      cwd: z.string().optional().describe('Optional absolute path to run the command in. Must be within the workspace root.'),
      waitMsBeforeAsync: z.number().int().min(0).max(180000).optional().default(60000).describe('Timeout in milliseconds before the process is killed or sent to background (max 180000, defaults to 60000).')
    }),
    execute: async (args: any) => {
      try {
        const commandLine = args.commandLine || args.command || args.cmd
        if (!commandLine) return { success: false, stdout: '', stderr: 'commandLine parameter is required.', exitCode: 1 }
        const ctx = resolveWorkspace(convId), runDir = args.cwd ? assertWithinWorkspace(ctx.rootPath, args.cwd, convId) : ctx.rootPath
        const tokens = tokenizeCommand(commandLine.trim()), executable = tokens[0], runArgs = tokens.slice(1)
        if (!executable) return { success: false, stdout: '', stderr: 'Empty command.', exitCode: 1 }
        const blockedCmd = checkBlocklist(tokens)
        if (blockedCmd) return { success: false, stdout: '', stderr: `Command blocked: '${blockedCmd}' is not permitted.`, exitCode: 1 }
        log.info(`[tool:runCommand] cwd=${runDir} exe=${executable} args=${JSON.stringify(runArgs)}`)
        const result = await execa(executable, runArgs, { shell: false, cwd: runDir, timeout: args.waitMsBeforeAsync ?? 60000, reject: false, env: { ...process.env, FORCE_COLOR: '1', PAGER: 'cat' } })
        return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.exitCode ?? 0, success: result.exitCode === 0, cwd: runDir }
      } catch (err: any) {
        log.error('[tool:runCommand] error:', err.message)
        return { success: false, error: err.message, stdout: '', stderr: err.message, exitCode: 1 }
      } finally {
        try { invalidateWorkspaceFilesCache(resolveWorkspace(convId).rootPath) } catch {}
      }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false && output.error ? `Error: ${output.error}` : `Command finished with exit code ${output.exitCode}.\nCwd: ${output.cwd}\nStdout:\n${output.stdout}\nStderr:\n${output.stderr}` }] })
  })

  // -- WEB TOOLS --
  const searchWeb = tool({
    description: 'Searches the web using the Tavily API and returns a synthesized summary along with list of relevant results containing URL citations.',
    inputSchema: z.object({
      query: z.string().describe('The web search query string.'),
      domain: z.string().optional().describe('Optional domain to prioritize in the search results (e.g. "github.com").'),
      maxResults: z.number().int().min(1).max(10).optional().default(5).describe('Maximum number of search results to return (1-10, default 5).'),
      searchDepth: z.enum(['basic', 'advanced']).optional().default('basic').describe('Search depth: basic or advanced.'),
      topic: z.enum(['general', 'news']).optional().default('general').describe('Topic category: general or news.'),
      includeImages: z.boolean().optional().default(false).describe('Whether to retrieve relevant images.')
    }),
    execute: async ({ query, domain, maxResults, searchDepth, topic, includeImages }) => {
      return tavilyLimiter.schedule(async () => {
        log.info(`[tool:searchWeb] query="${query}" domain=${domain ?? 'any'} depth=${searchDepth} topic=${topic}`)
        try {
          const token = requireAuthToken()
          const anonKey = process.env.SUPABASE_ANON_KEY
          if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')

          const response = await fetch(`${getApiBaseUrl()}/tavily`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, domain, maxResults, searchDepth, topic, includeImages })
          })
          if (!response.ok) throw new Error(`Proxy error: HTTP ${response.status}`)
          const data = await response.json()
          const results = (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content, score: r.score }))
          const images = (data.images ?? []).map((img: any) => typeof img === 'string' ? img : img.url || img)
          return { query, answer: data.answer ?? null, results, images, totalResults: results.length }
        } catch (err: any) {
          log.error('[tool:searchWeb] Tavily error:', err.message)
          return { success: false, error: `Web search failed: ${err.message}` }
        }
      })
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Answer: ${output.answer || 'N/A'}\nResults:\n${JSON.stringify(output.results, null, 2)}${output.images?.length ? `\nImages:\n${JSON.stringify(output.images, null, 2)}` : ''}` }] })
  })

  const generateImage = tool({
    description: 'Generates a new image based on a detailed text prompt using the FLUX.2-klein-4b model and saves it as a PNG file directly to the workspace artifacts directory.',
    inputSchema: z.object({
      prompt: z.string().describe('The detailed text prompt describing the image to generate (elements, style, colors, composition).'),
      width: z.number().int().min(512).max(1568).optional().default(1024).describe('Image width in pixels (must be a multiple of 16 between 512 and 1568).'),
      height: z.number().int().min(512).max(1568).optional().default(1024).describe('Image height in pixels (must be a multiple of 16 between 512 and 1568).'),
      seed: z.number().int().optional().default(0).describe('Seed for deterministic generation.'),
      steps: z.number().int().min(1).max(50).optional().default(4).describe('Denoising steps (1-50, default: 4).')
    }),
    execute: async ({ prompt, width, height, seed, steps }) => {
      const snap = (v: number) => Math.min(Math.max(Math.round(v / 16) * 16, 512), 1568);
      const sw = snap(width), sh = snap(height);
      log.info(`[tool:generateImage] prompt="${prompt}" size=${sw}x${sh} seed=${seed} steps=${steps}`)
      try {
        if (!convId) throw new Error('No active conversation ID provided. Image generation cannot resolve workspace.')
        const ctx = getWorkspaceContext(convId) || (await getOrCreateWorkspaceContext(convId))
        const token = requireAuthToken()
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')
        const response = await fetch(`${getApiBaseUrl()}/generate-image`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, width: sw, height: sh, seed, steps })
        })
        if (!response.ok) { const errText = await response.text(); throw new Error(`Proxy error (HTTP ${response.status}): ${errText}`) }
        const data = await response.json()
        let base64Data: string | undefined
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const item = data.data[0]
          if (item.b64_json) { base64Data = item.b64_json }
          else if (item.url) {
            const imgRes = await fetch(item.url)
            if (imgRes.ok) { const buf = await imgRes.arrayBuffer(); base64Data = Buffer.from(buf).toString('base64') }
          }
        }
        if (!base64Data && data.artifacts && Array.isArray(data.artifacts) && data.artifacts.length > 0) {
          const item = data.artifacts[0]
          if (item.base64) { base64Data = item.base64 }
        }
        if (!base64Data) throw new Error(`No image data returned in API response: ${JSON.stringify(data)}`)
        const fileName = `img-${Date.now()}.png`, targetPath = join(ctx.artifactsPath, fileName)
        await fs.mkdir(ctx.artifactsPath, { recursive: true })
        await fs.writeFile(targetPath, Buffer.from(base64Data, 'base64'))
        log.info(`[tool:generateImage] saved image to ${targetPath}`)
        return { success: true, filePath: targetPath, message: `Image generated successfully and saved to ${targetPath}` }
      } catch (err: any) { log.error('[tool:generateImage] Error:', err.message); return { success: false, error: `Image generation failed: ${err.message}` } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : output.message }] })
  })

  const getFileOutlineTool = tool({
    description: 'Extracts a structural outline of a source code file (classes, interfaces, functions, methods, and types) with their start/end line numbers. Extremely token-efficient for understanding large files without reading their full contents.',
    inputSchema: z.object({ absolutePath: z.string().describe('The absolute, fully-qualified system path of the target file to analyze.') }),
    execute: async (args: any) => {
      try {
        const absolutePath = args.absolutePath || args.path || args.filePath || args.absolutePath
        if (!absolutePath) throw new Error('absolutePath parameter is required')
        const safePath = safe(absolutePath), content = await fs.readFile(safePath, 'utf-8')
        const ext = extname(safePath), parser = await getParserForExtension(ext)
        if (!parser) throw new Error(`Unsupported file type for code outlining: "${ext}"`)
        const tree = parser.parse(content), symbols = getFileOutline(tree.rootNode), syntaxErrors = findSyntaxErrors(tree.rootNode)
        return { success: true, absolutePath: safePath, symbols, syntaxErrors }
      } catch (err: any) { log.error('[tool:getFileOutline] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.success === false) return { type: 'content', value: [{ type: 'text', text: `Error: ${output.error}` }] }
      let msg = `Structural outline of ${output.absolutePath}:\n`
      if (!output.symbols?.length) msg += 'No classes or functions defined.\n'
      else msg += output.symbols.map((s: any) => `[${s.type.toUpperCase()}] ${s.name} (Lines ${s.startLine}-${s.endLine})`).join('\n') + '\n'
      if (output.syntaxErrors?.length) {
        msg += `\n⚠️ WARNING: File contains syntax errors:\n` + output.syntaxErrors.map((e: any) => `Line ${e.line}, Col ${e.column}: ${e.text}`).join('\n')
      }
      return { type: 'content', value: [{ type: 'text', text: msg }] }
    }
  })

  return {
    listDir, viewFile, writeToFile, multiReplaceFileContent, searchWorkspace,
    runCommand,
    searchWeb, generateImage, getFileOutline: getFileOutlineTool
  }
}

export function browserTools(convId: string, modelSupportsVision = true) {
  const runOnMain = async (toolName: string, args: any, localFn: () => Promise<any>) => {
    const runner = (globalThis as any).callMainProcessTool
    if (runner) return runner(toolName, args, convId)
    return localFn()
  }

  const waitForPageLoad = (wc: any) => {
    return new Promise((resolve) => {
      if (!wc.isLoading()) return resolve(true)
      const onLoad = () => {
        wc.off('did-stop-loading', onLoad)
        wc.off('did-fail-load', onLoad)
        resolve(true)
      }
      wc.once('did-stop-loading', onLoad)
      wc.once('did-fail-load', onLoad)
    })
  }

  const browserNavigate = tool({
    description: 'Navigates the active browser viewport to a specified URL and blocks until the page load completes.',
    inputSchema: z.object({ url: z.string().describe('The URL to navigate to.') }),
    execute: async ({ url }) => runOnMain('browserNavigate', { url }, async () => {
      log.info(`[tool:browserNavigate] url="${url}"`)
      const check = checkBrowserViewActive(convId)
      if (check) return check
      const wc = getOrCreateBrowserWebContents(convId)!
      try {
        const target = (url.startsWith('http') || url.startsWith('file:')) ? url : (/^[a-zA-Z]:[/\\]/.test(url) ? `file:///${url.replace(/\\/g, '/')}` : (url.startsWith('/') ? `file://${url}` : `https://${url}`))
        await wc.loadURL(target)
        await waitForPageLoad(wc)
        return { success: true, url: wc.getURL() }
      } catch (e: unknown) { log.error('[tool:browserNavigate] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    }),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully navigated to ${output.url}` }] })
  })

  const browserType = tool({
    description: 'Types text into an input field on the active webpage. Supports CSS selectors, agentId values, and piercing iframes.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of the input field or the integer agentId value (e.g. "1").'),
      text: z.string().describe('The text to type.'),
      frameSelector: z.string().optional().describe('Optional CSS selector of the iframe containing the target input.')
    }),
    execute: async ({ selector, text, frameSelector }) => runOnMain('browserType', { selector, text, frameSelector }, async () => {
      log.info(`[tool:browserType] selector="${selector}"`)
      const check = checkBrowserViewActive(convId)
      if (check) return check
      const wc = getOrCreateBrowserWebContents(convId)!
      try {
        await wc.executeJavaScript(`
          (() => {
            const doc = ${frameSelector ? `(() => { const f = document.querySelector(${JSON.stringify(frameSelector)}); return f ? f.contentDocument : document })()` : 'document'};
            if (!doc) throw new Error('Frame not found');
            let el = doc.querySelector(${JSON.stringify(selector)});
            if (!el && /^[\\d]+$/.test(${JSON.stringify(selector)})) {
              el = doc.querySelector('[data-agent-id="' + ${JSON.stringify(selector)} + '"]');
            }
            if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
            el.focus();
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
              || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && nativeInputValueSetter) {
              nativeInputValueSetter.call(el, ${JSON.stringify(text)});
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              el.value = ${JSON.stringify(text)};
            } else {
              el.textContent = ${JSON.stringify(text)};
            }
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })()
        `)
        await waitForPageLoad(wc)
        return { success: true }
      } catch (e: unknown) { log.error('[tool:browserType] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    }),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully typed text into element` }] })
  })

  const browserScroll = tool({
    description: 'Scrolls the active webpage viewport.',
    inputSchema: z.object({ direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction.'), amount: z.number().int().positive().optional().describe('Pixels to scroll (default 400).') }),
    execute: async ({ direction, amount }) => runOnMain('browserScroll', { direction, amount }, async () => {
      log.info(`[tool:browserScroll] direction="${direction}" amount=${amount ?? 400}`)
      const check = checkBrowserViewActive(convId)
      if (check) return check
      const wc = getOrCreateBrowserWebContents(convId)!
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
    }),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully scrolled viewport` }] })
  })

  const browserScreenshot = tool({
    description: 'Captures a PNG screenshot of the active browser viewport.',
    inputSchema: z.object({}),
    execute: async () => runOnMain('browserScreenshot', {}, async () => {
      log.info('[tool:browserScreenshot] executing...')
      const check = checkBrowserViewActive(convId)
      if (check) return check
      const wc = getOrCreateBrowserWebContents(convId)!
      try {
        const screenshotDir = getConversationScreenshotsPath(convId)
        await fs.mkdir(screenshotDir, { recursive: true })
        try {
          const existing = await fs.readdir(screenshotDir)
          const pngs = existing.filter((f) => f.endsWith('.png')).sort()
          for (const old of pngs.slice(0, Math.max(0, pngs.length - 9))) { await fs.rm(join(screenshotDir, old), { force: true }).catch(() => {}) }
        } catch {}
        const filename = `screenshot_${Date.now()}.png`, screenshotPath = join(screenshotDir, filename), nativeImage = await wc.capturePage(), png = nativeImage.toPNG()
        await fs.writeFile(screenshotPath, png)
        return { success: true, message: 'Screenshot captured.', filePath: `file://${screenshotPath}`, filename, buffer: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer }
      } catch (e: unknown) { log.error('[tool:browserScreenshot] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    }),
    toModelOutput: async ({ output }: any) => {
      if (output.success && output.filePath) {
        try {
          if (!modelSupportsVision) { return { type: 'content', value: [{ type: 'text', text: `Screenshot captured and saved to ${output.filePath}. Image content omitted from tool output because this model does not support vision. Note: Rely on DOM analysis or text feedback.` }] } }
          const base64Image = output.buffer ? Buffer.from(output.buffer).toString('base64') : (await fs.readFile(output.filePath.replace('file://', ''))).toString('base64')
          return { type: 'content', value: [{ type: 'image-data', data: base64Image, mediaType: 'image/png' }, { type: 'text', text: `Screenshot captured: ${output.filePath}` }] }
        } catch (e: unknown) { return { type: 'content', value: [{ type: 'text', text: `Failed to read screenshot: ${e instanceof Error ? e.message : String(e)}` }] } }
      }
      return { type: 'content', value: [{ type: 'text', text: output.error || 'Failed to capture screenshot' }] }
    }
  })

  const browserClickSelector = tool({
    description: 'Clicks an element on the active webpage using a CSS selector or the integer agentId value returned from browserGetPageContent.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of the element to click, or the integer agentId value (e.g. "1").'),
      frameSelector: z.string().optional().describe('Optional CSS selector of the iframe containing the target element.')
    }),
    execute: async ({ selector, frameSelector }) => runOnMain('browserClickSelector', { selector, frameSelector }, async () => {
      log.info(`[tool:browserClickSelector] selector="${selector}"`)
      const check = checkBrowserViewActive(convId)
      if (check) return check
      const wc = getOrCreateBrowserWebContents(convId)!
      try {
        await wc.executeJavaScript(`
          (() => {
            const doc = ${frameSelector ? `(() => { const f = document.querySelector(${JSON.stringify(frameSelector)}); return f ? f.contentDocument : document })()` : 'document'};
            if (!doc) throw new Error('Frame not found');
            let target = doc.querySelector(${JSON.stringify(selector)});
            if (!target && /^[\\d]+$/.test(${JSON.stringify(selector)})) {
              target = doc.querySelector('[data-agent-id="' + ${JSON.stringify(selector)} + '"]');
            }
            if (!target) throw new Error('Element not found for selector: ' + ${JSON.stringify(selector)});
            target.click();
          })()
        `)
        await waitForPageLoad(wc)
        return { success: true }
      } catch (e: unknown) { log.error('[tool:browserClickSelector] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    }),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully clicked element` }] })
  })

  const browserGetPageContent = tool({
    description: 'Extracts the page URL, title, visible text content, and interactive element definitions with agentId labels from the active browser viewport. Interactive elements will render numeric badges directly on screenshots matching these agentId labels.',
    inputSchema: z.object({}),
    execute: async () => runOnMain('browserGetPageContent', {}, async () => {
      log.info('[tool:browserGetPageContent] executing...')
      const check = checkBrowserViewActive(convId)
      if (check) return check
      const wc = getOrCreateBrowserWebContents(convId)!
      try {
        const result = await wc.executeJavaScript(`
          (() => {
            document.querySelectorAll('.agent-overlay-badge').forEach(el => el.remove());
            const text = document.body.innerText || '';
            const interactive = [];
            const elements = document.querySelectorAll('button, input, select, textarea, a, [role="button"], [role="link"]');
            let index = 1;
            for (const el of elements) {
              if (interactive.length >= 100) break;
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0) {
                el.setAttribute('data-agent-id', String(index));
                
                const badge = document.createElement('div');
                badge.className = 'agent-overlay-badge';
                badge.innerText = String(index);
                Object.assign(badge.style, {
                  position: 'absolute',
                  left: (window.scrollX + rect.left) + 'px',
                  top: (window.scrollY + rect.top) + 'px',
                  background: '#df9a44',
                  color: '#ffffff',
                  border: '1px solid #ffffff',
                  borderRadius: '3px',
                  padding: '1px 3px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  zIndex: '2147483647',
                  pointerEvents: 'none',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                });
                document.body.appendChild(badge);

                interactive.push({
                  agentId: index,
                  tagName: el.tagName.toLowerCase(),
                  id: el.id || undefined,
                  className: el.className || undefined,
                  text: (el.textContent || '').trim().slice(0, 80) || undefined,
                  placeholder: el.placeholder || undefined,
                  name: el.name || undefined,
                  value: el.value || undefined
                });
                index++;
              }
            }
            return { url: window.location.href, title: document.title, text: text.slice(0, 15000), interactiveElements: interactive };
          })()
        `)
        const wrappedText = `[UNTRUSTED WEB PAGE CONTENT START]\nURL: ${result.url}\nTitle: ${result.title}\n\nVisible Page Text:\n${result.text}\n[UNTRUSTED WEB PAGE CONTENT END]`
        return { success: true, url: result.url, title: result.title, text: wrappedText, interactiveElements: result.interactiveElements }
      } catch (e: unknown) { log.error('[tool:browserGetPageContent] error:', e instanceof Error ? e.message : String(e)); return { success: false, error: e instanceof Error ? e.message : String(e) } }
    }),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `URL: ${output.url}\nTitle: ${output.title}\nContent:\n${output.text}\nInteractive elements:\n${JSON.stringify(output.interactiveElements, null, 2)}` }] })
  })

  return { browserNavigate, browserType, browserScroll, browserScreenshot, browserClickSelector, browserGetPageContent }
}
