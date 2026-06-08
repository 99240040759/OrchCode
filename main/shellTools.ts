import { tool } from 'ai'
import { z } from 'zod'
import { execa } from 'execa'
import { basename } from 'node:path'
import { parse } from 'shell-quote'
import log from 'electron-log'
import { getWorkspaceContext, assertWithinWorkspace } from './workspace'

const BLOCKED_EXECUTABLES = new Set([
  'sudo', 'su', 'runas', 'gksudo',
  'shutdown', 'reboot', 'init',
  'mkfs', 'fdisk', 'format', 'dd',
  'passwd', 'chroot',
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'ash', 'csh', 'tcsh'
])

function tokenizeCommand(commandLine: string): string[] {
  return parse(commandLine).map(t => typeof t === 'string' ? t : ('pattern' in t ? t.pattern : ('op' in t ? t.op : ''))).filter(Boolean)
}

function resolveWorkspace(convId: string) {
  const ctx = getWorkspaceContext(convId)
  if (!ctx)
    throw new Error(
      `No workspace context for conversation ${convId}. Workspace must be initialized before tool execution.`
    )
  return ctx
}

export function createShellTools(convId: string) {
  const wctx = () => resolveWorkspace(convId)

  const runCommand = tool({
    description:
      'Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code. Dangerous commands (sudo, shutdown, mkfs, etc.) are blocked. Timeout defaults to 60s.',
    inputSchema: z.object({
      commandLine: z.string().max(4096).describe('The shell command to execute.'),
      cwd: z
        .string()
        .optional()
        .describe('Absolute path to run the command in. Must be within workspace root.'),
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

        // L-7 FIX: Use proper tokenizer that handles quoted arguments and paths with spaces
        const tokens = tokenizeCommand(commandLine.trim())
        const executable = tokens[0]
        const args = tokens.slice(1)

        if (!executable) {
          return { success: false, stdout: '', stderr: 'Empty command.', exitCode: 1 }
        }

        // M-9 FIX: Check both the raw executable string AND its basename to prevent
        // blocklist bypass via full paths like /usr/bin/sudo or C:\Windows\sudo.exe
        const executableBasename = basename(executable).toLowerCase()
        const executableLower = executable.toLowerCase()
        if (
          BLOCKED_EXECUTABLES.has(executableBasename) ||
          BLOCKED_EXECUTABLES.has(executableLower)
        ) {
          return {
            success: false,
            stdout: '',
            stderr: `Command blocked: '${executable}' is not permitted.`,
            exitCode: 1
          }
        }

        log.info(`[tool:runCommand] cwd=${runDir} exe=${executable} args=${JSON.stringify(args)}`)

        const result = await execa(executable, args, {
          shell: false,
          cwd: runDir,
          timeout: waitMsBeforeAsync ?? 60000,
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
        log.error('[tool:runCommand] error:', err.message)
        return { success: false, error: err.message, stdout: '', stderr: err.message, exitCode: 1 }
      }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false && output.error ? `Error: ${output.error}` : `Command finished with exit code ${output.exitCode}.\nCwd: ${output.cwd}\nStdout:\n${output.stdout}\nStderr:\n${output.stderr}` }] })
  })

  return { runCommand }
}
