import { toast as sonnerToast } from 'sonner'
import * as Sentry from '@sentry/electron/renderer'

export const toast = {
  success: (message: string) => {
    sonnerToast.success(message)
  },
  error: (userMessage: string, err?: unknown) => {
    if (err !== undefined) Sentry.captureException(err)
    sonnerToast.error(userMessage)
  },
  info: (message: string) => {
    sonnerToast.info(message)
  }
}
