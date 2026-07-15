import { toast as sonnerToast } from 'sonner'
import * as Sentry from '@sentry/electron/renderer'

export const toast = {
  success: (message: string) => {
    sonnerToast.success(message)
  },
  error: (userMessage: string, err?: unknown) => {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('abort') &&
        !msg.includes('cancel') &&
        !msg.includes('network') &&
        !msg.includes('offline') &&
        !msg.includes('timeout')
      ) {
        Sentry.captureException(err)
      }
    }
    sonnerToast.error(userMessage)
  },
  info: (message: string) => {
    sonnerToast.info(message)
  }
}
