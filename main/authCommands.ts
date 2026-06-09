import { app, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { startGoogleAuth, getAuthUser, logoutUser } from './auth'
import WindowManager from './windowManager'

export const authCommands = {
  'auth:get-user': { schema: z.object({}), execute: () => getAuthUser() },
  'auth:login': { schema: z.object({}), execute: () => startGoogleAuth() },
  'auth:logout': { schema: z.object({}), execute: () => logoutUser() },
  'auth:complete-onboarding': { schema: z.object({}), execute: () => { app.emit('auth:open-main-and-close-onboarding') } },
  'dialog:confirm': {
    schema: z.object({ message: z.string().max(1000), detail: z.string().max(2000).optional(), buttons: z.array(z.string().max(100)).max(5).optional(), defaultId: z.number().int().optional(), cancelId: z.number().int().optional() }),
    execute: async (opts: any, event: any) => {
      const win = WindowManager.getMainWindow() || BrowserWindow.fromWebContents(event.sender)
      if (!win) return opts.cancelId ?? 0
      const result = await dialog.showMessageBox(win, { type: 'question', buttons: opts.buttons || ['Cancel', 'OK'], defaultId: opts.defaultId ?? 1, cancelId: opts.cancelId ?? 0, message: opts.message, detail: opts.detail ?? '' })
      return result.response
    }
  }
}
