import { ipcMain } from 'electron'
import log from 'electron-log'
import { threadCommands } from './threadCommands'
import { workspaceCommands } from './workspaceCommands'
import { terminalCommands } from './terminalCommands'
import { browserCommands } from './browserCommands'
import { authCommands } from './authCommands'
import { updaterCommands } from './updaterCommands'
import { captureException } from '@sentry/electron'

import type { z } from 'zod'

export { cleanupAllPtys } from './terminalCommands'

interface CommandDef<T extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: T
  execute: (payload: z.infer<T>, event: Electron.IpcMainInvokeEvent) => Promise<any> | any
}

const commands: Record<string, CommandDef<any>> = {
  ...threadCommands,
  ...workspaceCommands,
  ...terminalCommands,
  ...browserCommands,
  ...authCommands,
  ...updaterCommands
}

export function registerAllIpc() {
  ipcMain.handle('api:invoke', async (event, { command, payload }) => {
    try {
      const handler = commands[command]
      if (!handler) throw new Error(`Unknown command: ${command}`)
      const parsed = handler.schema.parse(payload ?? {})
      return await handler.execute(parsed, event)
    } catch (err) {
      log.error(`[IPC Error] ${command}:`, err); captureException(err)
      const e = new Error(err instanceof Error ? err.message : String(err)); e.name = err instanceof Error ? err.name : 'Error'; e.stack = err instanceof Error ? err.stack : undefined; throw e
    }
  })
  log.info(`[router] Registered ${Object.keys(commands).length} commands on api:invoke`)
}
