import { tool } from 'ai'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { join, relative, extname, dirname } from 'node:path'
import { execa } from 'execa'
import { rgPath } from '@vscode/ripgrep'
import log from 'electron-log'
import { getWorkspaceContext, assertWithinWorkspace, isFileBinary, getMimeType, invalidateWorkspaceFilesCache } from '../workspace'

const MAX_TOOL_FILE_READ_BYTES = 25 * 1024 * 1024

function resolveWorkspace(convId: string) {
  const ctx = getWorkspaceContext(convId)
  if (!ctx)
    throw new Error(
      `No workspace context for conversation ${convId}. Workspace must be initialized before tool execution.`
    )
  return ctx
}

function sliceLines(allLines: string[], startLine: number, endLine: number) {
  if (endLine < startLine) {
    throw new Error(`Invalid line range: endLine (${endLine}) is before startLine (${startLine}).`)
  }
  if (startLine > allLines.length || endLine > allLines.length) {
    throw new Error(
      `Invalid line range ${startLine}-${endLine}: file contains ${allLines.length} lines.`
    )
  }
  const start = Math.max(1, startLine)
  const end = Math.min(allLines.length, endLine)
  const beforeLines = allLines.slice(0, start - 1)
  const rangeLines = allLines.slice(start - 1, end)
  const afterLines = allLines.slice(end)
  const rangeText = rangeLines.join('\n')
  return { start, end, beforeLines, rangeLines, afterLines, rangeText }
}

export function createFileTools(convId: string, modelSupportsVision = true) {
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
        if (stat.size > MAX_TOOL_FILE_READ_BYTES) {
          throw new Error('File exceeds the 25 MB tool read limit.')
        }

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
        if (!modelSupportsVision) {
          return {
            type: 'content',
            value: [
              {
                type: 'text',
                text: `Binary image file: ${output.absolutePath} (${output.sizeBytes} bytes). Image data omitted from tool result because this model does not support vision.`
              }
            ]
          }
        }
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
        const ctx = wctx()
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
        // L-8 FIX: Invalidate cache so subsequent listWorkspaceFiles sees the new file immediately
        invalidateWorkspaceFilesCache(ctx.rootPath)
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
        const ctx = wctx()
        const isCrlf = raw.includes('\r\n')
        const normalizedRaw = raw.replace(/\r\n/g, '\n')
        const allLines = normalizedRaw.split('\n')

        const { beforeLines, afterLines } = sliceLines(allLines, startLine, endLine)

        const newLines = [...beforeLines, ...replacementContent.split('\n'), ...afterLines]
        const finalContent = isCrlf ? newLines.join('\r\n') : newLines.join('\n')

        await fs.writeFile(safePath, finalContent, 'utf-8')
        // L-8 FIX: Invalidate cache after edit
        invalidateWorkspaceFilesCache(ctx.rootPath)
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
        const ctx = wctx()
        const isCrlf = raw.includes('\r\n')
        const normalized = raw.replace(/\r\n/g, '\n')

        // A-6 FIX: Split ONCE into a mutable line array.
        // Apply all chunks to the array in reverse order (high→low lines) so earlier
        // line numbers remain valid as we splice. Then join once at the end.
        const sorted = [...replacementChunks].sort((a, b) => b.startLine - a.startLine)
        const ascending = [...replacementChunks].sort((a, b) => a.startLine - b.startLine)
        for (let i = 1; i < ascending.length; i++) {
          if (ascending[i].startLine <= ascending[i - 1].endLine) {
            throw new Error(
              `Replacement chunks overlap at lines ${ascending[i - 1].startLine}-${ascending[i - 1].endLine} and ${ascending[i].startLine}-${ascending[i].endLine}.`
            )
          }
        }

        const lines = normalized.split('\n')
        const results: { startLine: number; endLine: number }[] = []

        for (const chunk of sorted) {
          const { start, end } = sliceLines(lines, chunk.startLine, chunk.endLine)
          const replacementLines = chunk.replacementContent.split('\n')
          // Splice in-place: replace [start-1 .. end] with replacement lines
          lines.splice(start - 1, end - start + 1, ...replacementLines)
          results.push({ startLine: start, endLine: end })
        }

        const finalContent = isCrlf ? lines.join('\r\n') : lines.join('\n')
        await fs.writeFile(safePath, finalContent, 'utf-8')
        // L-8 FIX: Invalidate cache after multi-edit
        invalidateWorkspaceFilesCache(ctx.rootPath)
        log.info(`[tool:multiReplaceFileContent] done — ${results.length} chunks applied`)
        return { success: true, absolutePath: safePath, chunksApplied: results.length, results }
      } catch (err: any) {
        log.error('[tool:multiReplaceFileContent] error:', err)
        return { success: false, error: err.message }
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
          if (result.exitCode === 1) return { success: true, results: 'No matches found.' }
          if (
            (result as { code?: string }).code === 'ENOENT' ||
            result.stderr?.includes('not found') ||
            result.stderr?.includes('No such file')
          ) {
            return { success: false, error: 'ripgrep (rg) not found.' }
          }
          return {
            success: false,
            error: result.stderr || `ripgrep execution failed with exit code ${result.exitCode}`
          }
        }

        const output = result.stdout.trim()
        const rootPrefix = runDir.replace(/\\/g, '/') + '/'
        const cleaned = output
          .split('\n')
          .map((line) => {
            const normalized = line.replace(/\\/g, '/')
            return normalized.startsWith(rootPrefix)
              ? normalized.slice(rootPrefix.length)
              : normalized
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
          return { success: false, error: 'ripgrep (rg) not found in PATH.' }
        }
        return { success: false, error: err.message }
      }
    }
  })

  return {
    listDir,
    viewFile,
    writeToFile,
    replaceFileContent,
    multiReplaceFileContent,
    searchWorkspace
  }
}
