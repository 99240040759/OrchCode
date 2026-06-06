import { app } from 'electron'
import { join } from 'node:path'

export const APP_ID = 'com.orchcode.app'
export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'orch_db.sqlite')
}

export function getSessionPath(): string {
  return join(app.getPath('userData'), 'session.bin')
}


function getConversationsPath(): string {
  return join(app.getPath('userData'), 'conversations')
}

export function getConversationPath(conversationId: string): string {
  return join(getConversationsPath(), conversationId)
}
