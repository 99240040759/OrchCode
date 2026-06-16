import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { chromium } from 'playwright-core'
import type { Page, Browser } from 'playwright-core'
import { join, relative, extname, dirname, basename, isAbsolute, resolve as resolvePath } from 'node:path'
import { execa } from 'execa'
import { rgPath } from '@vscode/ripgrep'
import { parse } from 'shell-quote'
import log from 'electron-log'
import {
  getWorkspaceContext, assertWithinWorkspace, isFileBinary, getMimeType, invalidateWorkspaceFilesCache, getOrCreateWorkspaceContext
} from './workspace'
import WindowManager, { getConversationScreenshotsPath, tavilyLimiter, getApiBaseUrl } from './utils'
import { requireAuthToken } from './auth'
import { getParserForExtension, getTokens, findSyntaxErrors } from './astParser'
import { getUserSkillsPath } from './skills'
import { saveMemory as saveMemoryFn } from './memory'

export function tool<T extends z.ZodTypeAny, R>(spec: { description?: string; inputSchema: T; execute: (args: z.infer<T>, options?: any) => Promise<R>; toModelOutput?: (options: { output: R }) => any }) { return spec }

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
  let tree: any = null, tokens: any[] = [], isTreeDirty = true
  try {
    for (const edit of edits) {
      let replaced = false
      if (parser) {
        try {
          if (isTreeDirty || !tree) {
            if (tree) tree.delete()
            tree = parser.parse(raw)
            tokens = getTokens(tree.rootNode).filter(t => t.text.trim().length > 0)
            isTreeDirty = false
          }
          const targetTree = parser.parse(edit.targetContent)
          if (tree && targetTree) {
            try {
              const fileTokens = tokens, targetTokens = getTokens(targetTree.rootNode).filter(t => t.text.trim().length > 0)
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
                  const m = matches[0], lineStart = Math.max(0, raw.lastIndexOf('\n', m.startIndex) + 1), isAtLineStart = /^[ \t]*$/.test(raw.slice(lineStart, m.startIndex))
                  raw = raw.slice(0, isAtLineStart ? lineStart : m.startIndex) + edit.replacementContent + raw.slice(m.endIndex)
                  replaced = true; isTreeDirty = true
                } else if (matches.length > 1) {
                  throw new Error(`AST Token matching found ${matches.length} similar blocks (scores: ${matches.slice(0, 3).map(m => m.score.toFixed(2)).join(', ')}). Provide more context to uniquely identify the section.`)
                }
              }
            } finally { targetTree.delete() }
          }
        } catch (err) { log.warn(`[AST Patch] Failed for ${filePath}:`, err) }
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
        isTreeDirty = true
      }
    }
  } finally { if (tree) tree.delete() }
  await fs.writeFile(filePath, isCrlf ? raw.replace(/\n/g, '\r\n') : raw, 'utf-8')
}


// STRICT RULE: This is implemented as per the user's wish. Avoid modifying this.
const BLOCKED_EXECUTABLES = new Set([
  'shutdown', 'reboot', 'init',
  'mkfs', 'fdisk', 'format', 'dd',
  'passwd', 'chroot',
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'ash', 'csh', 'tcsh',
  'nslookup', 'dig', 'netstat', 'whoami', 'curl', 'wget'
])
const WRAPPERS = new Set(['env', 'npx', 'pnpx', 'yarn', 'npm', 'pnpm', 'bun', 'sudo', 'su', 'runas', 'gksudo'])

const SHELL_OPERATORS = new Set(['&&', '||', ';', '|', '&', '>', '>>', '<', '$(', '`'])

function checkBlocklist(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    
    if (SHELL_OPERATORS.has(t)) return t
    if (t.startsWith('-') || t.includes('=')) continue
    const base = basename(t).toLowerCase()
    if (BLOCKED_EXECUTABLES.has(base) || BLOCKED_EXECUTABLES.has(t.toLowerCase())) return t
    if (WRAPPERS.has(base)) {
      if ((base === 'npm' || base === 'yarn' || base === 'pnpm' || base === 'bun') && tokens[i + 1] === 'run') i++
      
    }
    
  }
  return null
}

function tokenizeCommand(commandLine: string): string[] {
  return (parse(commandLine) as Array<string | { op: string }>)
    .map(t => typeof t === 'string' ? t : t.op)
    .filter(Boolean)
}

export function createCoreTools(convId: string, multimodal = true) {
  const resolve = () => wctx(convId)
  const resolveRelativePath = (p: string): string => {
    const ctx = resolve()
    const norm = p.replace(/\\/g, '/')
    
    const absPath = isAbsolute(p) ? resolvePath(p) : resolvePath(ctx.rootPath, p)
    const normAbs = absPath.replace(/\\/g, '/')
    const skillsPath = getUserSkillsPath().replace(/\\/g, '/')
    const artifactsPath = ctx.artifactsPath.replace(/\\/g, '/')

    if (normAbs.startsWith(skillsPath)) return assertWithinWorkspace(getUserSkillsPath(), relative(getUserSkillsPath(), absPath))
    if (normAbs.startsWith(artifactsPath)) return assertWithinWorkspace(ctx.artifactsPath, relative(ctx.artifactsPath, absPath))

    
    if (isAbsolute(p) && normAbs.startsWith(ctx.rootPath.replace(/\\/g, '/'))) {
      return assertWithinWorkspace(ctx.rootPath, absPath)
    }

    
    const clean = (norm.startsWith('/') && !norm.match(/^\/[a-zA-Z]:/)) ? norm.slice(1) : norm
    if (clean.startsWith('artifacts/') || clean.startsWith('./artifacts/')) return assertWithinWorkspace(ctx.artifactsPath, clean.replace(/^\.?\/?artifacts\//, ''))
    if (clean.startsWith('.gemini/skills/') || clean.startsWith('./.gemini/skills/')) return assertWithinWorkspace(getUserSkillsPath(), clean.replace(/^\.?\/?\..gemini\/skills\//, ''))

    
    
    
    if (isAbsolute(p)) {
      
      const relFromRoot = relative(ctx.rootPath, absPath)
      if (!relFromRoot.startsWith('..') && !isAbsolute(relFromRoot)) {
        return assertWithinWorkspace(ctx.rootPath, relFromRoot)
      }
      
      const stripped = norm.replace(/^\/[a-zA-Z]:\//, '').replace(/^[a-zA-Z]:\//, '').replace(/^\//, '')
      return assertWithinWorkspace(ctx.rootPath, stripped)
    }

    return assertWithinWorkspace(ctx.rootPath, p)
  }

  const list_dir = tool({
    description: 'Lists all files, subdirectories, and their metadata directly inside a directory within the active workspace. Useful for understanding project layout, checking folder structures, and locating files. Returns file sizes and sub-item counts.',
    inputSchema: z.object({ directory_path: z.string().describe('The path of the directory to list (relative to the workspace root).') }),
    execute: async (args: any) => {
      try {
        const directory_path = args.directory_path || ''
        const ctx = resolve(), safePath = resolveRelativePath(directory_path)
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
      } catch (err: any) { log.error('[tool:list_dir] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.success === false) return { type: 'content', value: [{ type: 'text', text: `Error: ${output.error}` }] }
      const text = output.entries.map((e: any) => e.isDirectory ? `[DIR] ${e.name}/ (${e.numChildren ?? '?'} items)` : `[FILE] ${e.name} (${e.sizeBytes ?? '?'} bytes)`).join('\n')
      return { type: 'content', value: [{ type: 'text', text: text || 'Empty directory' }] }
    }
  })

  const view_file = tool({
    description: 'Reads the text or binary content of a file within the workspace. For text files and office documents (PDF, DOCX, XLSX, PPTX), returns their parsed plain text content. Reading is capped at 800 lines per call—use pagination to read larger files. Automatically handles images if vision is supported.',
    inputSchema: z.object({
      absolute_path: z.string().describe('The path of the target file to read (relative to the workspace root).'),
      start_line: z.number().int().min(1).optional().describe('The 1-indexed line number to start reading from (inclusive). Defaults to 1.'),
      end_line: z.number().int().min(1).optional().describe('The 1-indexed line number to stop reading at (inclusive). Range cannot exceed 800 lines. Defaults to start_line + 799.')
    }),
    execute: async (args: any) => {
      try {
        const absolute_path = args.absolute_path
        if (!absolute_path) throw new Error('absolute_path parameter is required')
        const start_line = args.start_line
        const end_line = args.end_line
        const safePath = resolveRelativePath(absolute_path), stat = await fs.stat(safePath)
        if (!stat.isFile()) throw new Error(`Not a file: "${safePath}"`)
        if (stat.size > MAX_FILE_READ_BYTES) throw new Error('File exceeds 25 MB read limit.')
        const rawBuffer = await fs.readFile(safePath)
        if (isFileBinary(safePath, rawBuffer)) {
          const mimeType = getMimeType(safePath), ext = extname(safePath).toLowerCase()
          const isOffice = mimeType === 'application/pdf' || ext === '.pdf' || mimeType.includes('spreadsheet') || mimeType.includes('excel') || ext === '.xlsx' || ext === '.xls' || mimeType.includes('word') || ext === '.docx' || mimeType.includes('presentation') || ext === '.pptx'
          if (isOffice) {
            const { extractTextFromBinaryAttachment } = require('./schema')
            const text = await extractTextFromBinaryAttachment(basename(safePath), mimeType, rawBuffer.toString('base64'))
            return { content: text, absolutePath: safePath, isBinary: false, sizeBytes: stat.size, readStart: 1, readEnd: text.split('\n').length }
          }
          return { content: `[Binary File: ${mimeType}] Base64 data included.`, base64Content: rawBuffer.toString('base64'), mimeType, absolutePath: safePath, isBinary: true, sizeBytes: stat.size }
        }
        const content = rawBuffer.toString('utf-8'), allLines = content.split('\n'), totalLines = allLines.length
        const start = start_line !== undefined ? Math.max(1, start_line) : 1
        if (start > totalLines) throw new Error(`Invalid start_line: file only has ${totalLines} lines.`)
        const end = end_line !== undefined ? Math.min(totalLines, end_line) : Math.min(totalLines, start + 799)
        if (end < start) throw new Error('Invalid line range: end_line cannot be less than start_line.')
        if (end - start + 1 > 800) throw new Error('Line range limit exceeded: cannot read more than 800 lines at a time.')
        const targetLines = allLines.slice(start - 1, end), contentChunk = targetLines.join('\n')
        return { content: contentChunk, absolutePath: safePath, totalLines, readStart: start, readEnd: end, truncated: end < totalLines }
      } catch (err: any) { log.error('[tool:view_file] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.isBinary && output.mimeType?.startsWith('image/') && output.base64Content) {
        if (!multimodal) return { type: 'content', value: [{ type: 'text', text: `Binary image file: ${output.absolutePath} (${output.sizeBytes} bytes). Vision not supported.` }], isBinary: true }
        return { type: 'image-data', data: output.base64Content, mediaType: output.mimeType }
      }
      const text = `[METADATA: readStart=${output.readStart}, readEnd=${output.readEnd}]\n` + (output.content || output.error || 'No content')
      return { type: 'content', value: [{ type: 'text', text }], isBinary: output.isBinary }
    }
  })

  const write_to_file = tool({
    description: 'Creates a new file in the workspace or overwrites an existing one if the overwrite flag is true. Automatically creates any parent directories if they do not exist.',
    inputSchema: z.object({ target_file: z.string().describe('The path where the file should be created (relative to the workspace root).'), code_content: z.string().describe('The complete string content to write into the file.'), overwrite: z.boolean().default(false).describe('Set to true to explicitly overwrite the file if it already exists; otherwise, will error.') }),
    execute: async (args: any) => {
      try {
        const target_file = args.target_file
        if (!target_file) throw new Error('target_file parameter is required')
        const code_content = args.code_content
        if (code_content === undefined) throw new Error('code_content parameter is required')
        const overwrite = !!(args.overwrite ?? false)
        const ctx = resolve(), safePath = resolveRelativePath(target_file)
        let exists = false
        try { await fs.stat(safePath); exists = true } catch (err) { log.debug('[fileTools] File existence check failed:', err) }
        if (exists && !overwrite) throw new Error(`File already exists: "${safePath}". Set overwrite=true.`)
        await fs.mkdir(dirname(safePath), { recursive: true })
        await fs.writeFile(safePath, code_content, 'utf-8')
        invalidateWorkspaceFilesCache(ctx.rootPath)
        let syntaxErrors: any[] = []
        try {
          const ext = extname(safePath), parser = await getParserForExtension(ext)
          if (parser) {
            const tree = parser.parse(code_content)
            if (tree.rootNode.hasError()) syntaxErrors = findSyntaxErrors(tree.rootNode)
          }
        } catch (e) { log.warn('[write_to_file syntax check] failed:', e) }
        return { success: true, absolutePath: safePath, created: !exists, syntaxErrors }
      } catch (err: any) { log.error('[tool:write_to_file] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.success === false) return { type: 'content', value: [{ type: 'text', text: `Error: ${output.error}` }] }
      return { type: 'content', value: [{ type: 'text', text: `Successfully wrote to file ${output.absolutePath}.` }] }
    }
  })

  const multi_replace_file_content = tool({
    description: 'Surgically edits one or more non-contiguous text blocks in an existing file. Uses Abstract Syntax Tree (AST) token matching for supported source code files (which is resilient to minor spacing, indentation, and quote changes), and falls back to exact string replacement for plain text or unsupported formats. Each chunk\'s targetContent must match exactly a unique section in the file.',
    inputSchema: z.object({
      target_file: z.string().describe('The path of the file to modify (relative to the workspace root).'),
      instruction: z.string().describe('A high-level explanation describing the purpose of these edits or what bug is being fixed.'),
      replacement_chunks: z.array(z.object({
        target_content: z.string().describe('The exact string block to be replaced. Must match exactly, including indentation and whitespace.'),
        replacement_content: z.string().describe('The new content to insert in place of the target_content.')
      })).min(1).describe('The list of separate, non-adjacent edit chunks to apply.')
    }),
    execute: async (args: any) => {
      try {
        const target_file = args.target_file
        if (!target_file) throw new Error('target_file parameter is required')
        const rawChunks = args.replacement_chunks
        if (!rawChunks || !Array.isArray(rawChunks)) throw new Error('replacement_chunks parameter is required and must be an array')
        const replacement_chunks = rawChunks.map((c: any) => ({
          targetContent: c.target_content ?? '',
          replacementContent: c.replacement_content ?? ''
        }))
        const safePath = resolveRelativePath(target_file), ctx = resolve()
        await applyEditsToFile(safePath, replacement_chunks)
        invalidateWorkspaceFilesCache(ctx.rootPath)
        let syntaxErrors: any[] = []
        try {
          const content = await fs.readFile(safePath, 'utf-8')
          const ext = extname(safePath), parser = await getParserForExtension(ext)
          if (parser) {
            const tree = parser.parse(content)
            if (tree.rootNode.hasError()) syntaxErrors = findSyntaxErrors(tree.rootNode)
          }
        } catch (e) { log.warn('[multi_replace_file_content syntax check] failed:', e) }
        return { success: true, absolutePath: safePath, chunksApplied: replacement_chunks.length, syntaxErrors }
      } catch (err: any) { const errMsg = err?.message || String(err || 'Unknown error'); log.error('[tool:multi_replace_file_content] error:', errMsg); return { success: false, error: errMsg } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.success === false) return { type: 'content', value: [{ type: 'text', text: `Error: ${output.error}` }] }
      return { type: 'content', value: [{ type: 'text', text: `Successfully applied ${output.chunksApplied} edits to file ${output.absolutePath}.` }] }
    }
  })

  const search_workspace = tool({
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
        log.error('[tool:search_workspace] error:', err.message)
        return { success: false, error: err.code === 'ENOENT' ? 'ripgrep not found.' : err.message }
      }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : output.results }] })
  })

  const run_command = tool({
    description: 'Executes a command-line script in the workspace directory. Returns stdout, stderr, and the integer exit code. Blocks destructive or dangerous commands (like sudo, shutdown, passwd, mkfs, and cmd/powershell/bash shells directly). Execution is run with PAGER=cat and FORCE_COLOR=1.',
    inputSchema: z.object({
      command_line: z.string().max(4096).describe('The command string to execute in the terminal (e.g. "npm run test").'),
      cwd: z.string().optional().describe('Optional absolute path to run the command in. Must be within the workspace root.'),
      wait_ms_before_async: z.number().int().min(0).max(180000).optional().default(60000).describe('Timeout in milliseconds before the process is killed or sent to background (max 180000, defaults to 60000).')
    }),
    execute: async (args: any, options?: any) => {
      try {
        const command_line = args.command_line
        if (!command_line) return { success: false, stdout: '', stderr: 'command_line parameter is required.', exitCode: 1 }
        const ctx = wctx(convId), runDir = args.cwd ? assertWithinWorkspace(ctx.rootPath, args.cwd) : ctx.rootPath
        const tokens = tokenizeCommand(command_line.trim()), executable = tokens[0], runArgs = tokens.slice(1)
        if (!executable) return { success: false, stdout: '', stderr: 'Empty command.', exitCode: 1 }
        const blockedCmd = checkBlocklist(tokens)
        if (blockedCmd) return { success: false, stdout: '', stderr: `Command blocked: '${blockedCmd}' is not permitted.`, exitCode: 1 }
        log.info(`[tool:run_command] cwd=${runDir} exe=${executable} args=${JSON.stringify(runArgs)}`)
        
        
        const timeout = args.wait_ms_before_async ?? 60000
        const env = { ...process.env, FORCE_COLOR: '1', PAGER: 'cat' }
        
        
        const result = await execa(executable, runArgs, { shell: false, cwd: runDir, timeout, reject: false, cancelSignal: options?.signal, env })
        return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.exitCode ?? 0, success: result.exitCode === 0, cwd: runDir }
      } catch (err: any) {
        log.error('[tool:run_command] error:', err.message)
        return { success: false, error: err.message, stdout: '', stderr: err.message, exitCode: 1 }
      } finally {
        try { invalidateWorkspaceFilesCache(wctx(convId).rootPath) } catch {}
      }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false && output.error ? `Error: ${output.error}` : `Command finished with exit code ${output.exitCode}.\nCwd: ${output.cwd}\nStdout:\n${output.stdout}\nStderr:\n${output.stderr}` }] })
  })

  const search_web = tool({
    description: 'Searches the web using the Tavily API and returns a synthesized summary along with list of relevant results containing URL citations.',
    inputSchema: z.object({
      query: z.string().describe('The web search query string.'),
      domain: z.string().optional().describe('Optional domain to prioritize in the search results (e.g. "github.com").'),
      max_results: z.number().int().min(1).max(10).optional().default(5).describe('Maximum number of search results to return (1-10, default 5).'),
      search_depth: z.enum(['basic', 'advanced']).optional().default('basic').describe('Search depth: basic or advanced.'),
      topic: z.enum(['general', 'news']).optional().default('general').describe('Topic category: general or news.'),
      include_images: z.boolean().optional().default(false).describe('Whether to retrieve relevant images.')
    }),
    execute: async ({ query, domain, max_results, search_depth, topic, include_images }) => {
      return tavilyLimiter.schedule(async () => {
        log.info(`[tool:search_web] query="${query}" domain=${domain ?? 'any'} depth=${search_depth} topic=${topic}`)
        try {
          const token = requireAuthToken()
          const anonKey = process.env.SUPABASE_ANON_KEY
          if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')
          const response = await fetch(`${getApiBaseUrl()}/tavily`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, domain, maxResults: max_results, searchDepth: search_depth, topic, includeImages: include_images })
          })
          if (!response.ok) throw new Error(`Proxy error: HTTP ${response.status}`)
          const data = await response.json()
          const results = (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content, score: r.score }))
          const images = (data.images ?? []).map((img: any) => typeof img === 'string' ? img : img.url || img)
          return { query, answer: data.answer ?? null, results, images, totalResults: results.length }
        } catch (err: any) {
          log.error('[tool:search_web] Tavily error:', err.message)
          return { success: false, error: `Web search failed: ${err.message}` }
        }
      })
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Answer: ${output.answer || 'N/A'}\nResults:\n${JSON.stringify(output.results, null, 2)}${output.images?.length ? `\nImages:\n${JSON.stringify(output.images, null, 2)}` : ''}` }] })
  })

  const generate_image = tool({
    description: 'Generates a new image based on a detailed text prompt using the FLUX.2-klein-4b model and saves it as a PNG file directly to the workspace artifacts directory.',
    inputSchema: z.object({
      prompt: z.string().describe('The detailed text prompt describing the image to generate (elements, style, colors, composition).'),
      width: z.number().int().min(512).max(1568).optional().default(1024).describe('Image width in pixels (must be a multiple of 16 between 512 and 1568).'),
      height: z.number().int().min(512).max(1568).optional().default(1024).describe('Image height in pixels (must be a multiple of 16 between 512 and 1568).'),
      seed: z.number().int().optional().default(0).describe('Seed for deterministic generation.'),
      steps: z.number().int().min(1).max(50).optional().default(4).describe('Denoising steps (1-50, default: 4).')
    }),
    execute: async ({ prompt, width, height, seed, steps }) => {
      const snap = (v: number) => Math.min(Math.max(Math.round(v / 16) * 16, 512), 1568)
      const sw = snap(width), sh = snap(height)
      log.info(`[tool:generate_image] prompt="${prompt}" size=${sw}x${sh} seed=${seed} steps=${steps}`)
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
        log.info(`[tool:generate_image] saved image to ${targetPath}`)
        return { success: true, filePath: targetPath, message: `Image generated successfully and saved to ${targetPath}` }
      } catch (err: any) { log.error('[tool:generate_image] Error:', err.message); return { success: false, error: `Image generation failed: ${err.message}` } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : output.message }] })
  })

  const save_memory = tool({
    description: 'Save a piece of information to persistent memory. Use this to remember user preferences, project conventions, important decisions, or anything that should be recalled in future conversations.',
    inputSchema: z.object({
      content: z.string().describe('The information to remember.'),
      category: z.enum(['general', 'preference', 'codebase', 'workflow']).describe('Category of the memory.')
    }),
    execute: async (args: any) => {
      try {
        const wsPath = resolve().rootPath
        const id = await saveMemoryFn(args.content, args.category, wsPath)
        return { success: true, id, message: `Memory saved: "${args.content.slice(0, 80)}..."` }
      } catch (err: any) { return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : output.message }] })
  })

  return {
    list_dir, view_file, write_to_file, multi_replace_file_content, search_workspace,
    run_command,
    search_web, generate_image, save_memory
  }
}



let playwrightBrowser: Browser | null = null

 
async function getOrAttachPlaywrightPage(convId: string): Promise<Page> {
  const session = WindowManager.getSession(convId)
  if (!session) throw new Error(`No browser session for conversation ${convId}. Open the browser first.`)
  if (session.page && !session.page.isClosed()) return session.page

  
  if (!playwrightBrowser || !playwrightBrowser.isConnected()) {
    playwrightBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.REMOTE_DEBUGGING_PORT || '9888'}`)
  }

  const pwCtx = playwrightBrowser.contexts()[0]
  if (!pwCtx) throw new Error('No Playwright browser context available.')

  const wc = session.view.webContents

  
  let targetId: string | undefined
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    const info = await wc.debugger.sendCommand('Target.getTargetInfo', {}) as any
    targetId = info?.targetInfo?.targetId
    try { wc.debugger.detach() } catch {}
  } catch {   }

  if (targetId) {
    for (const p of pwCtx.pages()) {
      if (p.isClosed()) continue
      try {
        const cdp = await p.context().newCDPSession(p)
        try {
          const info = await cdp.send('Target.getTargetInfo', {}) as any
          if (info?.targetInfo?.targetId === targetId) { await cdp.detach().catch(() => {}); session.page = p; return p }
        } finally { await cdp.detach().catch(() => {}) }
      } catch {   }
    }
  }

  
  for (const p of pwCtx.pages()) {
    if (p.isClosed()) continue
    try {
      const id = await p.evaluate(() => (window as any).__orchConversationId).catch(() => null)
      if (id === convId) { session.page = p; return p }
    } catch {   }
  }

  
  const wcUrl = wc.getURL()
  if (wcUrl && wcUrl !== 'about:blank') {
    const matches = pwCtx.pages().filter(p => !p.isClosed() && p.url() === wcUrl)
    if (matches.length === 1) { session.page = matches[0]; return matches[0] }
  }

  throw new Error(`Could not attach Playwright to browser session for ${convId}. No matching CDP target found.`)
}

 
function enqueue<T>(convId: string, fn: () => Promise<T>): Promise<T> {
  const s = WindowManager.getSession(convId)
  if (!s) return fn()
  const next = s.queue.then(() => fn(), () => fn()) as Promise<T>
  
  s.queue = (next as Promise<any>).then(() => {}, () => {})
  return next
}

 
function runOnMain(toolName: string, args: any, convId: string, localFn: () => Promise<any>): Promise<any> {
  const runner = (globalThis as any).callMainProcessTool
  if (runner) return runner(toolName, args, convId)
  return localFn()
}

 
export function browserTools(convId: string, multimodal = true) {
  const browser_navigate = tool({
    description: 'Navigates the active browser viewport to a specified URL and waits for the page to finish loading.',
    inputSchema: z.object({
      url: z.string().describe('The URL to navigate to.'),
      timeout: z.number().int().nonnegative().optional().describe('Maximum navigation time in milliseconds (default 30000).')
    }),
    execute: ({ url, timeout }) => runOnMain('browser_navigate', { url, timeout }, convId, () =>
      enqueue(convId, async () => {
        log.info(`[tool:browser_navigate] convId=${convId} url="${url}"`)
        let s = WindowManager.getSession(convId)
        if (!s || !s.view?.webContents || s.view.webContents.isDestroyed()) {
          WindowManager.destroySession(convId)
          s = WindowManager.getOrCreateSession(convId)
        }
        const target = url.startsWith('http') || url.startsWith('file:') ? url
          : /^[a-zA-Z]:[/\\]/.test(url) ? `file:///${url.replace(/\\/g, '/')}`
          : url.startsWith('/') ? `file://${url}` : `https://${url}`
        const timeoutMs = timeout ?? 30000
        let timer: any
        const navPromise = s.view.webContents.loadURL(target)
        const timeoutPromise = new Promise<never>((_, rej) => {
          timer = setTimeout(() => { try { s!.view.webContents.stop() } catch {}; rej(new Error(`Navigation timeout of ${timeoutMs}ms exceeded`)) }, timeoutMs)
        })
        await Promise.race([navPromise, timeoutPromise])
        clearTimeout(timer)
        if (s.page && !s.page.isClosed()) { try { await s.page.close() } catch {} }
        s.page = undefined
        return { success: true, url: s.view.webContents.getURL() }
      })
    ),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Navigated to ${output.url}` }] })
  })

  const browser_screenshot = tool({
    description: 'Captures a PNG screenshot of the active browser viewport and returns it as an image for visual verification.',
    inputSchema: z.object({}),
    execute: () => runOnMain('browser_screenshot', {}, convId, () =>
      enqueue(convId, async () => {
        log.info(`[tool:browser_screenshot] convId=${convId}`)
        let s = WindowManager.getSession(convId)
        if (!s || !s.view?.webContents || s.view.webContents.isDestroyed()) {
          WindowManager.destroySession(convId)
          s = WindowManager.getOrCreateSession(convId)
        }
        const screenshotDir = getConversationScreenshotsPath(convId)
        await fs.mkdir(screenshotDir, { recursive: true })
        try {
          const pngs = (await fs.readdir(screenshotDir)).filter(f => f.endsWith('.png')).sort()
          for (const old of pngs.slice(0, Math.max(0, pngs.length - 9))) await fs.rm(join(screenshotDir, old), { force: true }).catch(() => {})
        } catch {}
        const screenshotPath = join(screenshotDir, `screenshot_${Date.now()}.png`)
        const image = await s.view.webContents.capturePage()
        await fs.writeFile(screenshotPath, image.toPNG())
        return { success: true, screenshotPath }
      })
    ),
    toModelOutput: async ({ output }: any) => {
      if (!output.success || !output.screenshotPath) return { type: 'content', value: [{ type: 'text', text: output.error || 'Failed to capture screenshot' }] }
      if (!multimodal) return { type: 'content', value: [{ type: 'text', text: `Screenshot saved to file://${output.screenshotPath} (vision not supported by this model)` }] }
      try {
        const base64 = (await fs.readFile(output.screenshotPath)).toString('base64')
        return { type: 'image-data', data: base64, mediaType: 'image/png', filePath: `file://${output.screenshotPath}` }
      } catch (e: any) { return { type: 'content', value: [{ type: 'text', text: `Failed to read screenshot: ${e.message}` }] } }
    }
  })

  const browser_click = tool({
    description: 'Clicks an element on the webpage using a CSS/Playwright selector (preferred) or native mouse coordinates.',
    inputSchema: z.object({
      selector: z.string().optional().describe('CSS or Playwright selector for the element to click. Preferred over coordinates.'),
      x: z.number().optional().describe('Horizontal pixel coordinate (used only when selector is not provided).'),
      y: z.number().optional().describe('Vertical pixel coordinate (used only when selector is not provided).'),
      click_type: z.enum(['click', 'dblclick', 'right-click']).default('click').describe('Type of click to perform.')
    }),
    execute: ({ selector, x, y, click_type }) =>
      runOnMain('browser_click', { selector, x, y, click_type }, convId, () =>
        enqueue(convId, async () => {
          log.info(`[tool:browser_click] convId=${convId} selector="${selector}" x=${x} y=${y} type=${click_type}`)
          const page = await getOrAttachPlaywrightPage(convId)
          const button = click_type === 'right-click' ? 'right' as const : 'left' as const
          if (selector) {
            const locatorStr = /^\d+$/.test(selector) ? `[data-agent-id="${selector}"]` : selector
            const loc = page.locator(locatorStr)
            if (click_type === 'dblclick') await loc.dblclick({ button })
            else await loc.click({ button })
          } else if (x !== undefined && y !== undefined) {
            await page.mouse.click(x, y, { button })
          } else {
            throw new Error('Either selector or both x and y coordinates must be provided.')
          }
          return { success: true }
        })
      ),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : 'Successfully clicked' }] })
  })

  const browser_type = tool({
    description: 'Types text into an input field on the active webpage identified by a CSS or Playwright selector.',
    inputSchema: z.object({
      selector: z.string().describe('CSS or Playwright selector for the input element.'),
      text: z.string().describe('The text to type into the element.')
    }),
    execute: ({ selector, text }) =>
      runOnMain('browser_type', { selector, text }, convId, () =>
        enqueue(convId, async () => {
          log.info(`[tool:browser_type] convId=${convId} selector="${selector}"`)
          const page = await getOrAttachPlaywrightPage(convId)
          const locatorStr = /^\d+$/.test(selector) ? `[data-agent-id="${selector}"]` : selector
          await page.locator(locatorStr).fill(text)
          return { success: true }
        })
      ),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : 'Successfully typed text' }] })
  })

  const browser_keyboard_press = tool({
    description: 'Presses a key or key combination on the keyboard (e.g. "Enter", "Tab", "ArrowDown", "Control+A", "Control+C").',
    inputSchema: z.object({
      key: z.string().describe('The key or key combination to press (e.g. "Enter", "Tab", "Control+A").')
    }),
    execute: ({ key }) => runOnMain('browser_keyboard_press', { key }, convId, () =>
      enqueue(convId, async () => {
        log.info(`[tool:browser_keyboard_press] convId=${convId} key="${key}"`)
        const page = await getOrAttachPlaywrightPage(convId)
        await page.keyboard.press(key)
        return { success: true }
      })
    ),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully pressed "${output.key ?? 'key'}"` }] })
  })

  const browser_get_page_content = tool({
    description: 'Extracts the current page URL, title, visible text content, and a compact accessibility snapshot from the active browser viewport. Use this when you need to understand page state without a screenshot.',
    inputSchema: z.object({}),
    execute: () => runOnMain('browser_get_page_content', {}, convId, () =>
      enqueue(convId, async () => {
        log.info(`[tool:browser_get_page_content] convId=${convId}`)
        const page = await getOrAttachPlaywrightPage(convId)
        const url = page.url(), title = await page.title()
        const text = await page.evaluate(() => document.body.innerText || '').catch(() => '')
        
        let axSnippet = 'N/A'
        try {
          const client = await page.context().newCDPSession(page)
          const { nodes } = await client.send('Accessibility.getFullAXTree') as any
          await client.detach()
          const compact = (nodes as any[]).slice(0, 100).map((n: any) => ({
            role: n.role?.value,
            name: n.name?.value,
            description: n.description?.value,
            nodeId: n.nodeId
          })).filter(n => n.role && n.role !== 'none')
          axSnippet = JSON.stringify(compact, null, 2)
        } catch (err: any) { log.warn('[browser_get_page_content] AX tree error:', err.message) }
        const wrappedText = `[WEB PAGE CONTENT START]\nURL: ${url}\nTitle: ${title}\n\nVisible Text:\n${text.slice(0, 8000)}\n\nAccessibility Snapshot (top 100 nodes):\n${axSnippet}\n[WEB PAGE CONTENT END]`
        return { success: true, url, title, text: wrappedText }
      })
    ),
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : output.text }] })
  })

  return {
    browser_navigate,
    browser_screenshot,
    browser_click,
    browser_type,
    browser_keyboard_press,
    browser_get_page_content
  }
}
