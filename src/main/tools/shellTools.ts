import { tool } from 'ai'
import { z } from 'zod'
import { execa } from 'execa'
import { join, relative } from 'node:path'
import log from 'electron-log'
import { getWorkspaceContext, assertWithinWorkspace } from '../workspace'

function resolveWorkspace(convId: string) {
  const ctx = getWorkspaceContext(convId)
  if (!ctx)
    throw new Error(
      `No workspace context for conversation ${convId}. Workspace must be initialized before tool execution.`
    )
  return ctx
}

function isCommandPermitted(command: string, workspaceRoot: string): { permitted: boolean; reason?: string } {
  // Split the command line by logical chaining operators
  const subcommands = command.split(/(?:&&|\|\||;|\||\n)/)
  
  for (let sub of subcommands) {
    sub = sub.trim()
    if (!sub) continue
    
    // Extract the command executable
    const tokens = sub.split(/\s+/)
    const executable = tokens[0].toLowerCase()
    
    // 1. Block privilege escalation
    if (['sudo', 'su', 'gksudo', 'runas'].includes(executable)) {
      return { permitted: false, reason: `Privilege escalation command '${executable}' is forbidden.` }
    }
    
    // 2. Block direct remote-execution execution patterns (e.g. curl ... | sh)
    if ((sub.includes('curl') || sub.includes('wget')) && (sub.includes('|') && (sub.includes('sh') || sub.includes('bash') || sub.includes('cmd')))) {
      return { permitted: false, reason: 'Piping remote downloads to shell interpreters is forbidden.' }
    }
    
    // 3. Block recursive interactive shells
    if (['bash', 'sh', 'powershell', 'cmd', 'pwsh', 'zsh'].includes(executable)) {
      if (tokens.length === 1) {
        return { permitted: false, reason: 'Running nested interactive shell interpreters is forbidden.' }
      }
    }
    
    // 4. Block dangerous system administration commands
    const systemBlocklist = [
      'dd', 'mkfs', 'fdisk', 'format', 'shutdown', 'reboot', 'passwd', 'chroot', 'init'
    ]
    if (systemBlocklist.includes(executable)) {
      return { permitted: false, reason: `Administrative tool '${executable}' is forbidden.` }
    }
    
    // 5. Destructive commands validation: check if they delete files outside the workspace
    if (['rm', 'del', 'rmdir', 'rd'].includes(executable)) {
      const targetPaths = tokens.slice(1).filter(t => !t.startsWith('-') && !t.startsWith('/'))
      
      for (const target of targetPaths) {
        if (target === '/' || target === '~' || target.toLowerCase() === 'c:\\' || target.toLowerCase() === 'c:/') {
          return { permitted: false, reason: `Deleting root/home directories is forbidden.` }
        }
        if (target.includes('..') || target.startsWith('/') || target.startsWith('\\') || /^[a-zA-Z]:/.test(target)) {
          try {
            const resolvedPath = join(workspaceRoot, target)
            const relativePath = relative(workspaceRoot, resolvedPath)
            if (relativePath.startsWith('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
              return { permitted: false, reason: `Destructive target path '${target}' is outside the active workspace.` }
            }
          } catch {
            return { permitted: false, reason: `Destructive target path validation failed.` }
          }
        }
      }
    }
  }
  
  return { permitted: true }
}

export function createShellTools(convId: string) {
  const wctx = () => resolveWorkspace(convId)

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

        const policyCheck = isCommandPermitted(commandLine, ctx.rootPath)
        if (!policyCheck.permitted) {
          return {
            stdout: '',
            stderr: `Command blocked by security execution policy: ${policyCheck.reason}`,
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

  return {
    runCommand
  }
}
