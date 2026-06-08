import { ipcMain } from 'electron'
import log from 'electron-log'
import { threadCommands } from './threadCommands'
import { workspaceCommands } from './workspaceCommands'
import { terminalCommands } from './terminalCommands'
import { browserCommands } from './browserCommands'
import { authCommands } from './authCommands'
import { updaterCommands } from './updaterCommands'
import { captureException } from '@sentry/electron'

export { cleanupAllPtys } from './terminalCommands'

const commands: Record<string, any> = {
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
      log.error(`[IPC Error] ${command}:`, err)
      captureException(err)
      throw err
    }
  })
  log.info(`[router] Registered ${Object.keys(commands).length} commands on api:invoke`)
}
