import { tool } from 'ai'
import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { join, relative, extname, dirname } from 'node:path'
import { execa } from 'execa'
import { rgPath } from '@vscode/ripgrep'
import log from 'electron-log'
import { getWorkspaceContext, assertWithinWorkspace, isFileBinary, getMimeType, invalidateWorkspaceFilesCache } from './workspace'

export const MAX_FILE_READ_BYTES = 25 * 1024 * 1024

const wctx = (convId: string) => {
  const ctx = getWorkspaceContext(convId)
  if (!ctx) throw new Error(`No workspace context for conversation ${convId}.`)
  return ctx
}

async function applyEditsToFile(filePath: string, edits: { startLine: number; endLine: number; replacementContent: string }[]): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8')
  const isCrlf = raw.includes('\r\n')
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine)
  for (const edit of sorted) {
    if (edit.endLine < edit.startLine) throw new Error(`Invalid line range: endLine before startLine.`)
    if (edit.startLine > lines.length + 1 || edit.endLine > lines.length + 1) throw new Error(`Invalid line range ${edit.startLine}-${edit.endLine}: file has ${lines.length} lines.`)
    lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...edit.replacementContent.replace(/\r\n/g, '\n').split('\n'))
  }
  await fs.writeFile(filePath, isCrlf ? lines.join('\r\n') : lines.join('\n'), 'utf-8')
}

export function createFileTools(convId: string, modelSupportsVision = true) {
  const resolve = () => wctx(convId)
  const safe = (p: string) => assertWithinWorkspace(resolve().rootPath, p, convId)

  const listDir = tool({
    description: 'List the contents of a directory within the active workspace.',
    inputSchema: z.object({ directoryPath: z.string().describe('Absolute path to the directory to list.') }),
    execute: async ({ directoryPath }) => {
      try {
        const ctx = resolve(), safePath = safe(directoryPath)
        const rawEntries = await fs.readdir(safePath, { withFileTypes: true })
        const entries = await Promise.all(rawEntries.map(async (entry) => {
          const fullPath = join(safePath, entry.name), relativePath = relative(ctx.rootPath, fullPath), isDirectory = entry.isDirectory()
          let sizeBytes: number | undefined, numChildren: number | undefined
          if (isDirectory) { try { numChildren = (await fs.readdir(fullPath)).length } catch {} }
          else { try { sizeBytes = (await fs.stat(fullPath)).size } catch {} }
          return { name: entry.name, relativePath, absolutePath: fullPath, isDirectory, extension: isDirectory ? undefined : extname(entry.name), sizeBytes, numChildren }
        }))
        entries.sort((a, b) => (a.isDirectory && !b.isDirectory) ? -1 : (!a.isDirectory && b.isDirectory) ? 1 : a.name.localeCompare(b.name))
        return { entries, dirPath: safePath, rootPath: ctx.rootPath }
      } catch (err: any) { log.error('[tool:listDir] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : JSON.stringify(output.entries.map(e => ({ name: e.name, relativePath: e.relativePath, isDirectory: e.isDirectory, sizeBytes: e.sizeBytes, numChildren: e.numChildren }))) }] })
  })

  const viewFile = tool({
    description: 'Read the content of a file within the workspace. Supports both text and binary files (including images, which are rendered as visual inputs if the model supports vision).',
    inputSchema: z.object({
      absolutePath: z.string().describe('Absolute path to the file.'),
      startLine: z.number().int().min(1).optional().describe('Optional 1-indexed start line number to read for text files. If omitted, defaults to 1.'),
      endLine: z.number().int().min(1).optional().describe('Optional 1-indexed end line number to read for text files (maximum 800 lines from startLine). If omitted, defaults to reading up to 800 lines.')
    }),
    execute: async ({ absolutePath, startLine, endLine }) => {
      try {
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
        const end = endLine !== undefined ? Math.min(totalLines, endLine) : Math.min(totalLines, start + 799)
        if (end < start) throw new Error('Invalid line range: endLine cannot be less than startLine.')
        if (end - start + 1 > 800) throw new Error('Line range limit exceeded: cannot read more than 800 lines at a time.')
        const targetLines = allLines.slice(start - 1, end), numberedContent = targetLines.map((line, i) => `${start + i}: ${line}`).join('\n')
        return { content: numberedContent, absolutePath: safePath, totalLines, readStart: start, readEnd: end, truncated: end < totalLines }
      } catch (err: any) { log.error('[tool:viewFile] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => {
      if (output.isBinary && output.mimeType?.startsWith('image/') && output.base64Content) {
        if (!modelSupportsVision) return { type: 'content', value: [{ type: 'text', text: `Binary image file: ${output.absolutePath} (${output.sizeBytes} bytes). Vision not supported.` }] }
        return { type: 'content', value: [{ type: 'image-data', data: output.base64Content, mediaType: output.mimeType }, { type: 'text', text: `Successfully analyzed binary image: ${output.absolutePath}` }] }
      }
      return { type: 'content', value: [{ type: 'text', text: output.content || output.error || 'No content' }] }
    }
  })
 
  const writeToFile = tool({
    description: 'Create a new file within the workspace.',
    inputSchema: z.object({ targetFile: z.string().describe('Absolute path for the file.'), codeContent: z.string().describe('Full content.'), overwrite: z.boolean().default(false) }),
    execute: async ({ targetFile, codeContent, overwrite }) => {
      try {
        const ctx = resolve(), safePath = safe(targetFile)
        let exists = false
        try { await fs.stat(safePath); exists = true } catch {}
        if (exists && !overwrite) throw new Error(`File already exists: "${safePath}". Set overwrite=true.`)
        await fs.mkdir(dirname(safePath), { recursive: true })
        await fs.writeFile(safePath, codeContent, 'utf-8')
        invalidateWorkspaceFilesCache(ctx.rootPath)
        return { success: true, absolutePath: safePath, created: !exists }
      } catch (err: any) { log.error('[tool:writeToFile] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully wrote to file ${output.absolutePath}` }] })
  })
 
  const multiReplaceFileContent = tool({
    description: 'Edit MULTIPLE non-contiguous blocks in an existing file.',
    inputSchema: z.object({
      targetFile: z.string().describe('Absolute path to file.'),
      instruction: z.string().describe('Description of changes.'),
      replacementChunks: z.array(z.object({
        startLine: z.number().int().min(1).describe('The 1-indexed start line number of the block to replace.'),
        endLine: z.number().int().min(1).describe('The 1-indexed end line number (inclusive) of the block to replace.'),
        replacementContent: z.string().describe('The new content to replace the specified line range with.')
      })).min(1).describe('Non-overlapping chunks of the file to replace, sorted in ascending order of startLine.')
    }),
    execute: async ({ targetFile, instruction: _instruction, replacementChunks }) => {
      try {
        const safePath = safe(targetFile), ctx = resolve()
        const ascending = [...replacementChunks].sort((a, b) => a.startLine - b.startLine)
        for (let i = 1; i < ascending.length; i++) {
          if (ascending[i].startLine <= ascending[i - 1].endLine) throw new Error(`Chunks overlap at lines ${ascending[i - 1].startLine}-${ascending[i - 1].endLine} and ${ascending[i].startLine}-${ascending[i].endLine}.`)
        }
        await applyEditsToFile(safePath, replacementChunks)
        invalidateWorkspaceFilesCache(ctx.rootPath)
        return { success: true, absolutePath: safePath, chunksApplied: replacementChunks.length }
      } catch (err: any) { log.error('[tool:multiReplaceFileContent] error:', err.message); return { success: false, error: err.message } }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Successfully applied ${output.chunksApplied} edits to file ${output.absolutePath}` }] })
  })

  const searchWorkspace = tool({
    description: 'Searches the workspace for files containing a specific regex pattern.',
    inputSchema: z.object({ query: z.string().describe('Regex query.'), includes: z.array(z.string()).optional() }),
    execute: async ({ query, includes }) => {
      try {
        const ctx = resolve(), runDir = ctx.rootPath, args = ['-n', '-I', '--smart-case']
        if (includes) includes.forEach(g => args.push('-g', g))
        args.push('--', query, runDir)
        const result = await execa(rgPath, args, { shell: false, cwd: runDir, reject: false, timeout: 10000 })
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

  return { listDir, viewFile, writeToFile, multiReplaceFileContent, searchWorkspace }
}
