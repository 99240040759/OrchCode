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
      updatedAt TEXT NOT NULL,
      accumulatedTokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      threadId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      data TEXT,
      createdAt TEXT NOT NULL,
      isCompactionAnchor INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread_created
      ON messages(threadId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_messages_compaction
      ON messages(threadId, isCompactionAnchor);
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

  const checkColumn = (table: string, column: string) => {
    const cols = dbInstance!.pragma(`table_info(${table})`) as any[]
    return cols.some((c) => c.name === column)
  }

  if (!checkColumn('threads', 'accumulatedTokens')) {
    dbInstance!.exec(`ALTER TABLE threads ADD COLUMN accumulatedTokens INTEGER NOT NULL DEFAULT 0`)
  }
  if (!checkColumn('threads', 'compactionSummary')) {
    dbInstance!.exec(`ALTER TABLE threads ADD COLUMN compactionSummary TEXT`)
  }
  if (!checkColumn('messages', 'isCompactionAnchor')) {
    dbInstance!.exec(
      `ALTER TABLE messages ADD COLUMN isCompactionAnchor INTEGER NOT NULL DEFAULT 0`
    )
  }

  return dbInstance
}

export function getThreads(): (ThreadEntry & { workspacePath?: string | null })[] {
  const db = getDB()
  return db
    .prepare(
      `
    SELECT t.*, tw.workspacePath FROM threads t
    LEFT JOIN thread_workspaces tw ON tw.threadId = t.id
    ORDER BY t.updatedAt DESC
  `
    )
    .all() as (ThreadEntry & { workspacePath?: string | null })[]
}

export function getThread(threadId: string): (ThreadEntry & { workspacePath?: string | null }) | null {
  const db = getDB()
  return db
    .prepare(
      `
    SELECT t.*, tw.workspacePath FROM threads t
    LEFT JOIN thread_workspaces tw ON tw.threadId = t.id
    WHERE t.id = ?
  `
    )
    .get(threadId) as (ThreadEntry & { workspacePath?: string | null }) | null
}



export function getThreadMessages(threadId: string): ThreadMessage[] {
  const db = getDB()
  return db
    .prepare(
      'SELECT id, role, content, data, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC'
    )
    .all(threadId) as ThreadMessage[]
}

export function saveMessage(
  threadId: string,
  message: Omit<ThreadMessage, 'createdAt'> & { createdAt?: string; isCompactionAnchor?: boolean }
): ThreadMessage {
  const db = getDB()
  const now = new Date().toISOString()
  const msg = {
    id: message.id,
    threadId,
    role: message.role,
    content: message.content,
    data: message.data || null,
    createdAt: message.createdAt || now,
    isCompactionAnchor: message.isCompactionAnchor ? 1 : 0
  }

  db.transaction(() => {
    const threadExists = db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)
    if (!threadExists) {
      db.prepare(
        `
        INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens)
        VALUES (?, 'New Chat', 'local-user', ?, ?, 0)
      `
      ).run(threadId, now, now)
    } else {
      db.prepare('UPDATE threads SET updatedAt = ? WHERE id = ?').run(now, threadId)
    }
    db.prepare(
      `
      INSERT INTO messages (id, threadId, role, content, data, createdAt, isCompactionAnchor)
      VALUES (@id, @threadId, @role, @content, @data, @createdAt, @isCompactionAnchor)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        data = excluded.data,
        isCompactionAnchor = excluded.isCompactionAnchor
    `
    ).run(msg)
  })()

  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    data: msg.data || undefined,
    createdAt: msg.createdAt
  }
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

export function getThreadAccumulatedTokens(threadId: string): number {
  const db = getDB()
  const row = db.prepare('SELECT accumulatedTokens FROM threads WHERE id = ?').get(threadId) as any
  return row?.accumulatedTokens ?? 0
}

export function updateThreadAccumulatedTokens(threadId: string, tokens: number): void {
  const db = getDB()
  db.prepare('UPDATE threads SET accumulatedTokens = ? WHERE id = ?').run(tokens, threadId)
}

export function setThreadWorkspace(threadId: string, workspacePath: string): void {
  const db = getDB()
  const now = new Date().toISOString()
  const threadExists = db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)
  if (!threadExists) {
    db.prepare(
      `
      INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens)
      VALUES (?, 'New Chat', 'local-user', ?, ?, 0)
    `
    ).run(threadId, now, now)
  }
  db.prepare(
    `
    INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath)
    VALUES (?, ?)
  `
  ).run(threadId, workspacePath)
}

export function getThreadWorkspace(threadId: string): string | null {
  const db = getDB()
  const row = db
    .prepare('SELECT workspacePath FROM thread_workspaces WHERE threadId = ?')
    .get(threadId) as any
  return row?.workspacePath ?? null
}

export function getUniqueWorkspaces(): string[] {
  const db = getDB()
  return (
    db.prepare('SELECT path FROM opened_workspaces ORDER BY lastOpenedAt DESC').all() as {
      path: string
    }[]
  ).map((r) => r.path)
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

