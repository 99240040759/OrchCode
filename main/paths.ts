import { join } from 'node:path'
export const APP_ID = 'com.orchcode.app'
function getUserData(): string { return process.env.USER_DATA_PATH || require('electron').app.getPath('userData') }
export function getDatabasePath(): string { return join(getUserData(), 'orch_db.sqlite') }
export function getSessionPath(): string { return join(getUserData(), 'session.bin') }
function getConversationsPath(): string { return join(getUserData(), 'conversations') }
export function getConversationPath(id: string): string { return join(getConversationsPath(), id) }
export function getConversationScreenshotsPath(id: string): string { return join(getConversationPath(id), 'screenshots') }
