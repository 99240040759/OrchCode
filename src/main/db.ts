import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import log from 'electron-log'

export interface ThreadEntry {
  id: string
  title?: string
  resourceId: string
  createdAt: string
  updatedAt: string
}

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  data?: string
  createdAt: string
}

let dbInstance: Database.Database | null = null

function getDB(): Database.Database {
  if (dbInstance) return dbInstance

  const dbPath = join(app.getPath('userData'), 'orch_db.sqlite')
  log.info(`[db] Initializing better-sqlite3 database at: ${dbPath}`)

  dbInstance = new Database(dbPath)

  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('foreign_keys = ON')

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      resourceId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      threadId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      data TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS thread_workspaces (
      threadId TEXT PRIMARY KEY,
      workspacePath TEXT NOT NULL,
      FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS opened_workspaces (
      path TEXT PRIMARY KEY,
      lastOpenedAt TEXT NOT NULL
    );
  `)

  return dbInstance
}

export async function getThreads(): Promise<(ThreadEntry & { workspacePath?: string | null })[]> {
  const db = getDB()
  const stmt = db.prepare(`
    SELECT t.*, tw.workspacePath FROM threads t
    LEFT JOIN thread_workspaces tw ON tw.threadId = t.id
    ORDER BY t.updatedAt DESC
  `)
  return stmt.all() as (ThreadEntry & { workspacePath?: string | null })[]
}

export async function getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  const db = getDB()
  const stmt = db.prepare('SELECT id, role, content, data, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC')
  return stmt.all(threadId) as ThreadMessage[]
}

export async function saveMessage(
  threadId: string,
  message: Omit<ThreadMessage, 'createdAt'> & { createdAt?: string }
): Promise<ThreadMessage> {
  const db = getDB()
  const now = new Date().toISOString()
  const msg = {
    id: message.id,
    threadId,
    role: message.role,
    content: message.content,
    data: message.data || null,
    createdAt: message.createdAt || now
  }

  const runTransaction = db.transaction(() => {
    const threadExists = db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)
    if (!threadExists) {
      db.prepare(`
        INSERT OR IGNORE INTO threads (id, title, resourceId, createdAt, updatedAt)
        VALUES (?, 'New Chat', 'local-user', ?, ?)
      `).run(threadId, now, now)
    }
    db.prepare('UPDATE threads SET updatedAt = ? WHERE id = ?').run(now, threadId)
    db.prepare(`
      INSERT OR REPLACE INTO messages (id, threadId, role, content, data, createdAt)
      VALUES (@id, @threadId, @role, @content, @data, @createdAt)
    `).run(msg)
  })

  runTransaction()

  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    data: msg.data || undefined,
    createdAt: msg.createdAt
  }
}

export async function deleteThread(threadId: string): Promise<boolean> {
  const db = getDB()
  const result = db.prepare('DELETE FROM threads WHERE id = ?').run(threadId)
  return result.changes > 0
}

export async function updateThreadTitle(threadId: string, title: string): Promise<boolean> {
  const db = getDB()
  const now = new Date().toISOString()
  const result = db.prepare('UPDATE threads SET title = ?, updatedAt = ? WHERE id = ?').run(title, now, threadId)
  return result.changes > 0
}

export function setThreadWorkspace(threadId: string, workspacePath: string): void {
  const db = getDB()

  const threadExists = db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)
  if (!threadExists) {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT OR IGNORE INTO threads (id, title, resourceId, createdAt, updatedAt)
      VALUES (?, ?, 'local-user', ?, ?)
    `).run(threadId, 'New Chat', now, now)
  }

  db.prepare(`
    INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath)
    VALUES (?, ?)
  `).run(threadId, workspacePath)
}

export function getThreadWorkspace(threadId: string): string | null {
  const db = getDB()
  const row = db.prepare('SELECT workspacePath FROM thread_workspaces WHERE threadId = ?').get(threadId) as any
  return row?.workspacePath ?? null
}

export async function getUniqueWorkspaces(): Promise<string[]> {
  const db = getDB()
  const rows = db.prepare('SELECT path FROM opened_workspaces ORDER BY lastOpenedAt DESC').all() as { path: string }[]
  return rows.map((r) => r.path)
}

export function addOpenedWorkspace(path: string): void {
  const db = getDB()
  const now = new Date().toISOString()
  db.prepare('INSERT OR REPLACE INTO opened_workspaces (path, lastOpenedAt) VALUES (?, ?)').run(path, now)
}

export function deleteOpenedWorkspace(path: string): void {
  const db = getDB()
  db.prepare('DELETE FROM opened_workspaces WHERE path = ?').run(path)
}

export async function deleteWorkspaceThreads(workspacePath: string): Promise<string[]> {
  const db = getDB()

  let threadIds: string[] = []

  db.transaction(() => {
    const rows = db.prepare('SELECT threadId FROM thread_workspaces WHERE workspacePath = ?').all(workspacePath) as { threadId: string }[]
    threadIds = rows.map((r) => r.threadId)
    const stmtDel = db.prepare('DELETE FROM threads WHERE id = ?')
    for (const id of threadIds) {
      stmtDel.run(id)
    }
  })()

  return threadIds
}
