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

  dbInstance = new Database(dbPath)
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
  // Drop dead columns on existing installs if present — SQLite can't DROP COLUMN before 3.35
  // so we leave them in place but never write/read them (they're nullable with no DEFAULT)
  // New installs won't have them at all.

  return dbInstance
}

export function checkpointDB() {
  try {
    const db = getDB()
    db.pragma('wal_checkpoint(TRUNCATE)')
    log.info('[db] WAL checkpoint complete.')
  } catch (err) {
    log.error('[db] Error checkpointing WAL:', err)
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
    saved = db.prepare(`INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (@id, @threadId, @role, @content, @data, @createdAt) ON CONFLICT(id) DO UPDATE SET content = excluded.content, data = excluded.data RETURNING id, role, content, data, createdAt`).get(msg) as ThreadMessage
  })()
  return { id: saved!.id, role: saved!.role as 'user' | 'assistant' | 'system', content: saved!.content, data: saved!.data || undefined, createdAt: saved!.createdAt }
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
  const now = new Date().toISOString()
  const threadExists = db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)
  if (!threadExists) {
    db.prepare(
      `INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens)
       VALUES (?, 'New Chat', 'local-user', ?, ?, 0)`
    ).run(threadId, now, now)
  }
  db.prepare(
    `INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath) VALUES (?, ?)`
  ).run(threadId, workspacePath)
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
    const rows = db
      .prepare('SELECT threadId FROM thread_workspaces WHERE workspacePath = ?')
      .all(workspacePath) as { threadId: string }[]
    threadIds = rows.map((r) => r.threadId)
    const stmtDel = db.prepare('DELETE FROM threads WHERE id = ?')
    for (const id of threadIds) stmtDel.run(id)
  })()
  return threadIds
}

export function compactThreadHistory(threadId: string, summary: string, keepCount = 10): void {
  const db = getDB()
  db.transaction(() => {
    // 1. Get all messages for this thread sorted by createdAt
    const msgs = db
      .prepare('SELECT id, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC')
      .all(threadId) as { id: string; createdAt: string }[]
    if (msgs.length <= keepCount) return // nothing to compact

    const deleteCount = msgs.length - keepCount
    const toDelete = msgs.slice(0, deleteCount)
    const keptFirst = msgs[deleteCount]

    // 2. Delete old messages
    const deleteStmt = db.prepare('DELETE FROM messages WHERE id = ?')
    for (const msg of toDelete) {
      deleteStmt.run(msg.id)
    }

    // 3. Insert system summary message. Use a timestamp slightly before the first kept message's createdAt.
    const keptDate = new Date(keptFirst.createdAt)
    const summaryDate = new Date(keptDate.getTime() - 1000).toISOString()
    const summaryId = crypto.randomUUID()

    db.prepare(
      `
      INSERT INTO messages (id, threadId, role, content, data, createdAt)
      VALUES (?, ?, 'system', ?, NULL, ?)
    `
    ).run(
      summaryId,
      threadId,
      `[CONTEXT COMPACTED]\nPrior conversation summarised to preserve context window. Summary:\n\n${summary}`,
      summaryDate
    )

    // 4. Update the thread's updatedAt to reflect the change
    db.prepare('UPDATE threads SET updatedAt = ? WHERE id = ?').run(
      new Date().toISOString(),
      threadId
    )
  })()
}

export function getActiveThreadId(): string | null {
  const db = getDB()
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'activeThreadId'").get() as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
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
