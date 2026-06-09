import Database from 'better-sqlite3'
import log from 'electron-log'
import crypto from 'node:crypto'
import { getDatabasePath } from './paths'

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

  const dbPath = getDatabasePath()
  log.info(`[db] Initializing better-sqlite3 database at: ${dbPath}`)

  dbInstance = new Database(dbPath, { timeout: 5000 })
  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('synchronous = NORMAL')
  dbInstance.pragma('temp_store = MEMORY')
  dbInstance.pragma('foreign_keys = ON')

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, title TEXT, resourceId TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, accumulatedTokens INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, data TEXT, createdAt TEXT NOT NULL, FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE) STRICT;
    CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(threadId, createdAt);
    CREATE TABLE IF NOT EXISTS thread_workspaces (threadId TEXT PRIMARY KEY, workspacePath TEXT NOT NULL, FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE) STRICT;
    CREATE TABLE IF NOT EXISTS opened_workspaces (path TEXT PRIMARY KEY, lastOpenedAt TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT) STRICT;
  `)

  // Run any needed migrations for existing installs
  const cols = (table: string) =>
    (dbInstance!.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)

  const threadCols = cols('threads')
  if (!threadCols.includes('accumulatedTokens')) {
    dbInstance.exec(`ALTER TABLE threads ADD COLUMN accumulatedTokens INTEGER NOT NULL DEFAULT 0`)
  }
  // Note: ALTER TABLE ... DROP COLUMN is fully supported in SQLite 3.35+.
  // If there are any dead columns from old legacy installations, they can be dropped directly.

  return dbInstance
}

export function checkpointDB() {
  try {
    const db = getDB()
    db.pragma('wal_checkpoint(TRUNCATE)')
    log.info('[db] WAL checkpoint complete.')
  } catch (err) {
    log.error('[db] Error checkpointing WAL:', err)
    throw err
  }
}

export function getThreads(): (ThreadEntry & {
  workspacePath?: string | null
  accumulatedTokens?: number
})[] {
  const db = getDB()
  return db
    .prepare(
      `SELECT t.id, t.title, t.resourceId, t.createdAt, t.updatedAt, t.accumulatedTokens, tw.workspacePath
       FROM threads t
       LEFT JOIN thread_workspaces tw ON tw.threadId = t.id
       ORDER BY t.updatedAt DESC`
    )
    .all() as (ThreadEntry & { workspacePath?: string | null; accumulatedTokens?: number })[]
}

export function getThread(
  threadId: string
): (ThreadEntry & { workspacePath?: string | null; accumulatedTokens?: number }) | null {
  const db = getDB()
  return db
    .prepare(
      `SELECT t.id, t.title, t.resourceId, t.createdAt, t.updatedAt, t.accumulatedTokens, tw.workspacePath
       FROM threads t
       LEFT JOIN thread_workspaces tw ON tw.threadId = t.id
       WHERE t.id = ?`
    )
    .get(threadId) as
    | (ThreadEntry & { workspacePath?: string | null; accumulatedTokens?: number })
    | null
}

export function getThreadMessages(threadId: string): ThreadMessage[] {
  const db = getDB()
  return db
    .prepare(
      'SELECT id, role, content, data, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC'
    )
    .all(threadId) as ThreadMessage[]
}

export function saveMessage(threadId: string, message: Omit<ThreadMessage, 'createdAt'> & { createdAt?: string }): ThreadMessage {
  const db = getDB(), now = new Date().toISOString()
  const msg = { id: message.id, threadId, role: message.role, content: message.content, data: message.data || null, createdAt: message.createdAt || now }
  let saved: ThreadMessage | undefined
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
      db.prepare(`INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0)`).run(threadId, now, now)
    } else { db.prepare('UPDATE threads SET updatedAt = ? WHERE id = ?').run(now, threadId) }
    saved = db.prepare(`INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (@id, @threadId, @role, @content, @data, @createdAt) ON CONFLICT(id) DO UPDATE SET role = excluded.role, threadId = excluded.threadId, content = excluded.content, data = excluded.data, createdAt = excluded.createdAt RETURNING id, role, content, data, createdAt`).get(msg) as ThreadMessage
  })()
  if (!saved) throw new Error('[db] Failed to save message')
  return { id: saved.id, role: saved.role as 'user' | 'assistant' | 'system', content: saved.content, data: saved.data || undefined, createdAt: saved.createdAt }
}

export function deleteThread(threadId: string): boolean {
  const db = getDB()
  return db.prepare('DELETE FROM threads WHERE id = ?').run(threadId).changes > 0
}

export function updateThreadTitle(threadId: string, title: string): boolean {
  const db = getDB()
  const now = new Date().toISOString()
  return (
    db.prepare('UPDATE threads SET title = ?, updatedAt = ? WHERE id = ?').run(title, now, threadId)
      .changes > 0
  )
}

export function updateThreadAccumulatedTokens(threadId: string, tokens: number): void {
  const db = getDB()
  db.prepare('UPDATE threads SET accumulatedTokens = accumulatedTokens + ? WHERE id = ?').run(
    tokens,
    threadId
  )
}

export function setThreadAccumulatedTokens(threadId: string, tokens: number): void {
  const db = getDB()
  db.prepare('UPDATE threads SET accumulatedTokens = ? WHERE id = ?').run(tokens, threadId)
}

export function setThreadWorkspace(threadId: string, workspacePath: string): void {
  const db = getDB()
  if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0)`).run(threadId, now, now)
  }
  db.prepare(`INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath) VALUES (?, ?)`).run(threadId, workspacePath)
}

export function getThreadWorkspace(threadId: string): string | null {
  const db = getDB()
  const row = db
    .prepare('SELECT workspacePath FROM thread_workspaces WHERE threadId = ?')
    .get(threadId) as { workspacePath: string } | undefined
  return row?.workspacePath ?? null
}

export function addOpenedWorkspace(path: string): void {
  const db = getDB()
  db.prepare('INSERT OR REPLACE INTO opened_workspaces (path, lastOpenedAt) VALUES (?, ?)').run(
    path,
    new Date().toISOString()
  )
}

export function deleteOpenedWorkspace(path: string): void {
  const db = getDB()
  db.prepare('DELETE FROM opened_workspaces WHERE path = ?').run(path)
}

export function deleteWorkspaceThreads(workspacePath: string): string[] {
  const db = getDB()
  let threadIds: string[] = []
  db.transaction(() => {
    const rows = db.prepare('SELECT threadId FROM thread_workspaces WHERE workspacePath = ?').all(workspacePath) as { threadId: string }[]
    threadIds = rows.map((r) => r.threadId)
    if (threadIds.length > 0) {
      const placeholders = threadIds.map(() => '?').join(',')
      db.prepare(`DELETE FROM threads WHERE id IN (${placeholders})`).run(...threadIds)
    }
  })()
  return threadIds
}

export function compactThreadHistory(threadId: string, summary: string, keepCount = 10): void {
  const db = getDB()
  db.transaction(() => {
    const msgs = db.prepare('SELECT id, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC').all(threadId) as { id: string; createdAt: string }[]
    if (msgs.length <= keepCount) return
    const deleteCount = msgs.length - keepCount
    const toDelete = msgs.slice(0, deleteCount).map(m => m.id)
    const keptFirst = msgs[deleteCount]
    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => '?').join(',')
      db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...toDelete)
    }
    const keptDate = new Date(keptFirst.createdAt)
    const summaryDate = new Date(keptDate.getTime() - 1000).toISOString()
    const summaryId = crypto.randomUUID()
    db.prepare(`INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (?, ?, 'system', ?, NULL, ?)`).run(summaryId, threadId, `[CONTEXT COMPACTED]\nPrior conversation summarised to preserve context window. Summary:\n\n${summary}`, summaryDate)
    db.prepare('UPDATE threads SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), threadId)
  })()
}

export function getActiveThreadId(): string | null {
  const db = getDB()
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'activeThreadId'").get() as { value: string } | undefined
    return row?.value ?? null
  } catch (err) {
    log.error('[db] getActiveThreadId error:', err)
    throw err
  }
}

export function setActiveThreadId(threadId: string | null): void {
  const db = getDB()
  if (threadId) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('activeThreadId', ?)").run(threadId)
  } else {
    db.prepare("DELETE FROM app_settings WHERE key = 'activeThreadId'").run()
  }
}
