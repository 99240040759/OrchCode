import { app } from 'electron'
import { z } from 'zod'
import { getCurrentUpdateStatus, triggerUpdateCheck, triggerInstall } from './updater'

export const updaterCommands = {
  'updater:get-status': { schema: z.object({}), execute: () => getCurrentUpdateStatus() },
  'app:get-version': { schema: z.object({}), execute: () => app.getVersion() },
  'updater:check': { schema: z.object({}), execute: () => { triggerUpdateCheck() } },
  'updater:install': { schema: z.object({}), execute: () => { triggerInstall() } },
  'updater:open-mac-release': {
    schema: z.object({}),
    execute: async () => {
      if (process.platform === 'darwin') {
        const { shell } = await import('electron')
        await shell.openExternal('https://github.com/sameer786ss/OrchCode/releases/latest')
        app.quit()
      }
    }
  }
}
