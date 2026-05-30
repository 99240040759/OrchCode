import 'dotenv/config'
import { tool } from 'ai'
import { z } from 'zod'
import { promises as fs, realpathSync } from 'fs'
import { join, relative, extname, resolve, normalize, dirname } from 'path'
import { execa } from 'execa'
import log from 'electron-log'
import { tavily } from '@tavily/core'
import { getWorkspaceContext, getOrCreateWorkspaceContext, getActiveConversationId, isBinaryBuffer } from './workspace'

function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const dir = dirname(filePath)
      try {
        const resolvedDir = realpathSync(dir)
        return join(resolvedDir, filePath.split(/[/\\]/).pop() ?? '')
      } catch {
        return filePath
      }
    }
    throw err
  }
}

function assertWithinRoot(rootPath: string, targetPath: string): string {
  const cid = getActiveConversationId()
  const wctx = getWorkspaceContext(cid) || getOrCreateWorkspaceContext(cid)

  const resolvedRoot = safeRealpathSync(resolve(rootPath))
  const resolvedTarget = safeRealpathSync(resolve(targetPath))
  const normalizedTarget = normalize(resolvedTarget)

  if (normalizedTarget.includes('/.orch-artifacts/') || normalizedTarget.endsWith('/.orch-artifacts')) {
    const idx = normalizedTarget.indexOf('.orch-artifacts')
    const relativePart = normalizedTarget.substring(idx + '.orch-artifacts'.length)
    const secureRedirect = normalize(join(wctx.artifactsPath, relativePart))
    return secureRedirect
  }

  if (!normalizedTarget.startsWith(resolvedRoot + '/') && normalizedTarget !== resolvedRoot) {
    const errorMsg = `Path traversal blocked: "${targetPath}" (resolved: "${normalizedTarget}") resolves outside workspace root: "${resolvedRoot}"`
    log.error(`[security:assertWithinRoot] ${errorMsg}`)
    throw new Error(errorMsg)
  }
  return normalizedTarget
}

function resolveWorkspace(conversationId?: string) {
  const cid = conversationId || getActiveConversationId()
  return getWorkspaceContext(cid) || getOrCreateWorkspaceContext(cid)
}

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+(-[rRf]+\s+)?[\/~]/,
  /\bsudo\b/,
  /\bcurl\b.*\|\s*(ba)?sh/,
  /\bwget\b.*\|\s*(ba)?sh/,
]

function isCommandBlocked(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY || '' })

export const listDir = tool({
  description:
    'List the contents of a directory within the active workspace — shows all files and subdirectories with their sizes, types, and child counts. Respects workspace sandboxing.',
  inputSchema: z.object({
    directoryPath: z
      .string()
      .describe('Absolute path to the directory to list. Must be within the workspace root.'),
    conversationId: z.string().optional().describe('Active conversation/session ID (optional)')
  }),
  execute: async ({ directoryPath, conversationId }) => {
    try {
      const wctx = resolveWorkspace(conversationId)
      const safePath = assertWithinRoot(wctx.rootPath, directoryPath)

      const rawEntries = await fs.readdir(safePath, { withFileTypes: true })

      const entries = await Promise.all(
        rawEntries.map(async (entry) => {
          const fullPath = join(safePath, entry.name)
          const relativePath = relative(wctx.rootPath, fullPath)
          const isDirectory = entry.isDirectory()

          let sizeBytes: number | undefined
          let numChildren: number | undefined

          if (isDirectory) {
            try {
              const children = await fs.readdir(fullPath)
              numChildren = children.length
            } catch {}
          } else {
            try {
              const stat = await fs.stat(fullPath)
              sizeBytes = stat.size
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

      return { entries, dirPath: safePath, rootPath: wctx.rootPath }
    } catch (err: any) {
      log.error(`[tool:listDir] error:`, err)
      return { success: false, error: err.message }
    }
  }
})

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

export const viewFile = tool({
  description:
    'Read the content of a file within the workspace. Returns the file contents between startLine and endLine (1-indexed, inclusive). Max 800 lines per read. For binary images/video the base64 content and mimeType are returned.',
  inputSchema: z.object({
    absolutePath: z
      .string()
      .describe('Absolute path to the file. Must be within the workspace root.'),
    startLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-indexed start line (inclusive). Omit to start from line 1.'),
    endLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-indexed end line (inclusive). Omit to read up to line 800.'),
    conversationId: z.string().optional().describe('Active conversation/session ID (optional)')
  }),
  execute: async ({ absolutePath, startLine, endLine, conversationId }) => {
    try {
      const wctx = resolveWorkspace(conversationId)
      const safePath = assertWithinRoot(wctx.rootPath, absolutePath)

      const stat = await fs.stat(safePath)
      if (!stat.isFile()) {
        throw new Error(`Not a file: "${safePath}"`)
      }

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
      const truncated = requestedEnd > maxEnd && totalLines > maxEnd

      const targetLines = allLines.slice(start - 1, end)
      const numberedContent = targetLines
        .map((line, i) => `${start + i}: ${line}`)
        .join('\n')

      return {
        content: numberedContent,
        rawContent: targetLines.join('\n'),
        absolutePath: safePath,
        totalLines,
        readStart: start,
        readEnd: end,
        truncated
      }
    } catch (err: any) {
      log.error(`[tool:viewFile] error:`, err)
      return { success: false, error: err.message }
    }
  }
})

export const writeToFile = tool({
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
      .describe('If true, overwrite an existing file. Defaults to false.'),
    conversationId: z.string().optional().describe('Active conversation/session ID (optional)')
  }),
  execute: async ({ targetFile, codeContent, overwrite, conversationId }) => {
    try {
      const wctx = resolveWorkspace(conversationId)
      const safePath = assertWithinRoot(wctx.rootPath, targetFile)

      let exists = false
      try {
        await fs.stat(safePath)
        exists = true
      } catch {}

      if (exists && !overwrite) {
        throw new Error(
          `File already exists: "${safePath}". Set overwrite=true to replace it.`
        )
      }

      await fs.mkdir(dirname(safePath), { recursive: true })
      await fs.writeFile(safePath, codeContent, 'utf-8')

      log.info(`[tool:writeToFile] wrote ${safePath} (overwrite=${overwrite})`)
      return { success: true, absolutePath: safePath, created: !exists }
    } catch (err: any) {
      log.error(`[tool:writeToFile] error:`, err)
      return { success: false, error: err.message }
    }
  }
})

export const replaceFileContent = tool({
  description:
    'Edit a SINGLE contiguous block in an existing file. Searches for TargetContent within the line range [startLine, endLine] and replaces it with ReplacementContent. Use for single contiguous edits only.',
  inputSchema: z.object({
    targetFile: z
      .string()
      .describe('Absolute path to the file to edit. Must be within the workspace root.'),
    targetContent: z.string().describe('Exact string to find and replace. Must match exactly.'),
    replacementContent: z.string().describe('Replacement content for the target string.'),
    startLine: z.number().int().min(1).describe('Start of the search range (1-indexed).'),
    endLine: z.number().int().min(1).describe('End of the search range (1-indexed, inclusive).'),
    allowMultiple: z
      .boolean()
      .default(false)
      .describe('If true, replace all occurrences in the range. If false, error on multiple matches.'),
    conversationId: z.string().optional().describe('Active conversation/session ID (optional)')
  }),
  execute: async ({
    targetFile,
    targetContent,
    replacementContent,
    startLine,
    endLine,
    allowMultiple,
    conversationId
  }) => {
    try {
      const wctx = resolveWorkspace(conversationId)
      const safePath = assertWithinRoot(wctx.rootPath, targetFile)

      const raw = await fs.readFile(safePath, 'utf-8')
      const allLines = raw.split('\n')

      const start = Math.max(1, startLine)
      const end = Math.min(allLines.length, endLine)

      const beforeLines = allLines.slice(0, start - 1)
      const rangeLines = allLines.slice(start - 1, end)
      const afterLines = allLines.slice(end)

      const rangeText = rangeLines.join('\n')

      const occurrences = rangeText.split(targetContent).length - 1
      if (occurrences === 0) {
        throw new Error(
          `TargetContent not found in lines ${start}–${end} of "${safePath}".\nSearched for:\n${targetContent}`
        )
      }
      if (occurrences > 1 && !allowMultiple) {
        throw new Error(
          `Multiple occurrences (${occurrences}) of TargetContent found in lines ${start}–${end}. Set allowMultiple=true to replace all.`
        )
      }

      const newRangeText = allowMultiple
        ? rangeText.split(targetContent).join(replacementContent)
        : rangeText.replace(targetContent, () => replacementContent)

      const newLines = [...beforeLines, ...newRangeText.split('\n'), ...afterLines]
      const finalContent = newLines.join('\n')

      await fs.writeFile(safePath, finalContent, 'utf-8')
      log.info(`[tool:replaceFileContent] edited ${safePath} (occurrences replaced: ${occurrences})`)

      return { success: true, absolutePath: safePath, occurrencesReplaced: occurrences }
    } catch (err: any) {
      log.error(`[tool:replaceFileContent] error:`, err)
      return { success: false, error: err.message }
    }
  }
})

const ReplacementChunkSchema = z.object({
  startLine: z.number().int().min(1).describe('Start of search range (1-indexed).'),
  endLine: z.number().int().min(1).describe('End of search range (1-indexed, inclusive).'),
  targetContent: z.string().describe('Exact string to find and replace.'),
  replacementContent: z.string().describe('Replacement content.'),
  allowMultiple: z
    .boolean()
    .default(false)
    .describe('If true, replace all occurrences in range. If false, error on multiple matches.')
})

export const multiReplaceFileContent = tool({
  description:
    'Edit MULTIPLE non-contiguous blocks in an existing file in a single call. Provide an array of replacement chunks. Chunks are applied in reverse line order to preserve line numbers. Use this when editing more than one separate block in the same file.',
  inputSchema: z.object({
    targetFile: z
      .string()
      .describe('Absolute path to the file to edit. Must be within the workspace root.'),
    instruction: z.string().describe('Human-readable description of what changes are being made.'),
    replacementChunks: z
      .array(ReplacementChunkSchema)
      .min(1)
      .describe('Array of replacement chunks to apply.'),
    conversationId: z.string().optional().describe('Active conversation/session ID (optional)')
  }),
  execute: async ({ targetFile, instruction, replacementChunks, conversationId }) => {
    try {
      const wctx = resolveWorkspace(conversationId)
      const safePath = assertWithinRoot(wctx.rootPath, targetFile)

      log.info(`[tool:multiReplaceFileContent] ${safePath} — ${instruction} (${replacementChunks.length} chunks)`)

      let raw = await fs.readFile(safePath, 'utf-8')

      const sorted = [...replacementChunks].sort((a, b) => b.startLine - a.startLine)

      const results: { startLine: number; endLine: number; occurrencesReplaced: number }[] = []

      for (const chunk of sorted) {
        const allLines = raw.split('\n')
        const start = Math.max(1, chunk.startLine)
        const end = Math.min(allLines.length, chunk.endLine)

        const beforeLines = allLines.slice(0, start - 1)
        const rangeLines = allLines.slice(start - 1, end)
        const afterLines = allLines.slice(end)

        const rangeText = rangeLines.join('\n')
        const occurrences = rangeText.split(chunk.targetContent).length - 1

        if (occurrences === 0) {
          throw new Error(
            `Chunk [lines ${start}–${end}]: TargetContent not found in "${safePath}".\nSearched for:\n${chunk.targetContent}`
          )
        }
        if (occurrences > 1 && !chunk.allowMultiple) {
          throw new Error(
            `Chunk [lines ${start}–${end}]: Multiple occurrences (${occurrences}) found. Set allowMultiple=true to replace all.`
          )
        }

        const newRangeText = chunk.allowMultiple
          ? rangeText.split(chunk.targetContent).join(chunk.replacementContent)
          : rangeText.replace(chunk.targetContent, () => chunk.replacementContent)

        const newLines = [...beforeLines, ...newRangeText.split('\n'), ...afterLines]
        raw = newLines.join('\n')

        results.push({ startLine: start, endLine: end, occurrencesReplaced: occurrences })
      }

      await fs.writeFile(safePath, raw, 'utf-8')
      log.info(`[tool:multiReplaceFileContent] done — ${results.length} chunks applied`)

      return { success: true, absolutePath: safePath, chunksApplied: results.length, results }
    } catch (err: any) {
      log.error(`[tool:multiReplaceFileContent] error:`, err)
      return { success: false, error: err.message }
    }
  }
})

export const runCommand = tool({
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
      .max(60000)
      .optional()
      .default(30000)
      .describe('Timeout in milliseconds (max 60000). Defaults to 30000ms.'),
    conversationId: z.string().optional().describe('Active conversation/session ID (optional)')
  }),
  execute: async ({ commandLine, cwd, waitMsBeforeAsync, conversationId }) => {
    try {
      const wctx = resolveWorkspace(conversationId)

      const runDir = cwd ? assertWithinRoot(wctx.rootPath, cwd) : wctx.rootPath

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
      log.error(`[tool:runCommand] error:`, err)
      return { success: false, error: err.message, stdout: '', stderr: err.message, exitCode: 1 }
    }
  }
})

export const searchWeb = tool({
  description:
    'Search the web using the Tavily API and return a summary of relevant results with URL citations. Use for looking up documentation, current events, package info, or any web research.',
  inputSchema: z.object({
    query: z.string().describe('The search query.'),
    domain: z
      .string()
      .optional()
      .describe('Optional domain to prioritize in results (e.g. "docs.react.dev").'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe('Max number of results to return (1–10, default 5).')
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

      return {
        query,
        answer: response.answer ?? null,
        results,
        totalResults: results.length
      }
    } catch (err: any) {
      log.error('[tool:searchWeb] Tavily error:', err)
      return { success: false, error: `Web search failed: ${err.message}` }
    }
  }
})

export const tools = {
  listDir,
  viewFile,
  writeToFile,
  replaceFileContent,
  multiReplaceFileContent,
  runCommand,
  searchWeb
}
