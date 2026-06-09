import Database from 'better-sqlite3'
import crypto from 'node:crypto'
const proc = process as any
let dbInstance: Database.Database | null = null
function getDB(dbPath: string): Database.Database {
  if (dbInstance) return dbInstance
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
  const cols = (table: string) => (dbInstance!.pragma(`table_info(${table})`) as { name: string }[]).map(c => c.name)
  if (!cols('threads').includes('accumulatedTokens')) {
    dbInstance.exec(`ALTER TABLE threads ADD COLUMN accumulatedTokens INTEGER NOT NULL DEFAULT 0`)
  }
  return dbInstance
}
const methods: Record<string, (dbPath: string, ...args: any[]) => any> = {
  checkpointDB(dbPath) { getDB(dbPath).pragma('wal_checkpoint(TRUNCATE)') },
  getThreads(dbPath) {
    return getDB(dbPath).prepare(`SELECT t.id, t.title, t.resourceId, t.createdAt, t.updatedAt, t.accumulatedTokens, tw.workspacePath FROM threads t LEFT JOIN thread_workspaces tw ON tw.threadId = t.id ORDER BY t.updatedAt DESC`).all()
  },
  getThread(dbPath, threadId) {
    return getDB(dbPath).prepare(`SELECT t.id, t.title, t.resourceId, t.createdAt, t.updatedAt, t.accumulatedTokens, tw.workspacePath FROM threads t LEFT JOIN thread_workspaces tw ON tw.threadId = t.id WHERE t.id = ?`).get(threadId)
  },
  getThreadMessages(dbPath, threadId) {
    return getDB(dbPath).prepare('SELECT id, role, content, data, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC').all(threadId)
  },
  saveMessage(dbPath, threadId, message) {
    const db = getDB(dbPath), now = new Date().toISOString()
    const msg = { id: message.id, threadId, role: message.role, content: message.content, data: message.data || null, createdAt: message.createdAt || now }
    let saved: any
    db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
        db.prepare(`INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0)`).run(threadId, now, now)
      } else { db.prepare('UPDATE threads SET updatedAt = ? WHERE id = ?').run(now, threadId) }
      saved = db.prepare(`INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (@id, @threadId, @role, @content, @data, @createdAt) ON CONFLICT(id) DO UPDATE SET content = excluded.content, data = excluded.data RETURNING id, role, content, data, createdAt`).get(msg)
    })()
    if (!saved) throw new Error('[db] Failed to save message')
    return { id: saved.id, role: saved.role, content: saved.content, data: saved.data || undefined, createdAt: saved.createdAt }
  },
  deleteThread(dbPath, threadId) { return getDB(dbPath).prepare('DELETE FROM threads WHERE id = ?').run(threadId).changes > 0 },
  updateThreadTitle(dbPath, threadId, title) {
    const db = getDB(dbPath), now = new Date().toISOString()
    return db.prepare('UPDATE threads SET title = ?, updatedAt = ? WHERE id = ?').run(title, now, threadId).changes > 0
  },
  updateThreadAccumulatedTokens(dbPath, threadId, tokens) {
    getDB(dbPath).prepare('UPDATE threads SET accumulatedTokens = accumulatedTokens + ? WHERE id = ?').run(tokens, threadId)
  },
  setThreadAccumulatedTokens(dbPath, threadId, tokens) {
    getDB(dbPath).prepare('UPDATE threads SET accumulatedTokens = ? WHERE id = ?').run(tokens, threadId)
  },
  setThreadWorkspace(dbPath, threadId, workspacePath) {
    const db = getDB(dbPath)
    if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
      const now = new Date().toISOString()
      db.prepare(`INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0)`).run(threadId, now, now)
    }
    db.prepare(`INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath) VALUES (?, ?)`).run(threadId, workspacePath)
  },
  getThreadWorkspace(dbPath, threadId) {
    const row = getDB(dbPath).prepare('SELECT workspacePath FROM thread_workspaces WHERE threadId = ?').get(threadId) as any
    return row?.workspacePath ?? null
  },
  addOpenedWorkspace(dbPath, path) {
    getDB(dbPath).prepare('INSERT OR REPLACE INTO opened_workspaces (path, lastOpenedAt) VALUES (?, ?)').run(path, new Date().toISOString())
  },
  bindWorkspaceTransaction(dbPath, threadId, workspacePath) {
    getDB(dbPath).transaction(() => {
      methods.addOpenedWorkspace(dbPath, workspacePath)
      methods.setThreadWorkspace(dbPath, threadId, workspacePath)
    })()
  },
  deleteOpenedWorkspace(dbPath, path) { getDB(dbPath).prepare('DELETE FROM opened_workspaces WHERE path = ?').run(path) },
  deleteWorkspaceThreads(dbPath, workspacePath) {
    const db = getDB(dbPath)
    let threadIds: string[] = []
    db.transaction(() => {
      const rows = db.prepare('SELECT threadId FROM thread_workspaces WHERE workspacePath = ?').all(workspacePath) as any[]
      threadIds = rows.map(r => r.threadId)
      if (threadIds.length > 0) {
        const placeholders = threadIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM threads WHERE id IN (${placeholders})`).run(...threadIds)
      }
    })()
    return threadIds
  },
  compactThreadHistory(dbPath, threadId, summary, keepCount = 10) {
    const db = getDB(dbPath)
    db.transaction(() => {
      const msgs = db.prepare('SELECT id, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC').all(threadId) as any[]
      if (msgs.length <= keepCount) return
      const deleteCount = msgs.length - keepCount
      const toDelete = msgs.slice(0, deleteCount).map(m => m.id)
      const keptFirst = msgs[deleteCount]
      if (toDelete.length > 0) {
        const placeholders = toDelete.map(() => '?').join(',')
        db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...toDelete)
      }
      const keptDate = new Date(keptFirst.createdAt)
      const summaryDate = new Date(keptDate.getTime() - 1).toISOString()
      const summaryId = crypto.randomUUID()
      db.prepare(`INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (?, ?, 'system', ?, NULL, ?)`).run(summaryId, threadId, `[CONTEXT COMPACTED]\nPrior conversation summarised to preserve context window. Summary:\n\n${summary}`, summaryDate)
      db.prepare('UPDATE threads SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), threadId)
    })()
  },
  getActiveThreadId(dbPath) {
    const row = getDB(dbPath).prepare("SELECT value FROM app_settings WHERE key = 'activeThreadId'").get() as any
    return row?.value ?? null
  },
  setActiveThreadId(dbPath, threadId) {
    const db = getDB(dbPath)
    if (threadId) db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('activeThreadId', ?)").run(threadId)
    else db.prepare("DELETE FROM app_settings WHERE key = 'activeThreadId'").run()
  }
}
proc.parentPort.on('message', (e: { data: any }) => {
  const { id, method, args, dbPath } = e.data
  const fn = methods[method]
  if (!fn) return proc.parentPort.postMessage({ id, error: `Method ${method} not found` })
  try {
    const result = fn(dbPath, ...args)
    proc.parentPort.postMessage({ id, result })
  } catch (err: any) {
    proc.parentPort.postMessage({ id, error: err.message })
  }
})
