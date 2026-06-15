import Database, { type Statement } from 'better-sqlite3'
import crypto from 'node:crypto'

const proc = process as any
const dbInstanceMap = new Map<string, Database.Database>()
const dbCache = new WeakMap<Database.Database, Map<string, Statement>>()
const MAX_CACHED_STATEMENTS = 100

function getDB(dbPath: string): Database.Database {
  let db = dbInstanceMap.get(dbPath)
  if (!db) {
    db = new Database(dbPath, { timeout: 5000 })
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('temp_store = MEMORY')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, title TEXT, resourceId TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, accumulatedTokens INTEGER NOT NULL DEFAULT 0, lifetimeTokens INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, data TEXT, createdAt TEXT NOT NULL, FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE) STRICT;
      CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(threadId, createdAt);
      CREATE TABLE IF NOT EXISTS thread_workspaces (threadId TEXT PRIMARY KEY, workspacePath TEXT NOT NULL, FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE) STRICT;
      CREATE TABLE IF NOT EXISTS opened_workspaces (path TEXT PRIMARY KEY, lastOpenedAt TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT) STRICT;
      CREATE TABLE IF NOT EXISTS tool_permissions (tool_name TEXT PRIMARY KEY, permission TEXT NOT NULL CHECK(permission IN ('always_allow','always_ask','always_deny'))) STRICT;
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', workspace_path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))) STRICT;
      CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_path);
    `)
    const cols = (db.pragma('table_info(threads)') as { name: string }[]).map(c => c.name)
    if (!cols.includes('input_tokens')) db.exec(`ALTER TABLE threads ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0`)
    if (!cols.includes('output_tokens')) db.exec(`ALTER TABLE threads ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0`)
    dbInstanceMap.set(dbPath, db)
    dbCache.set(db, new Map())
  }
  return db
}

function prepare(db: Database.Database, sql: string): Statement {
  let cache = dbCache.get(db)
  if (!cache) {
    cache = new Map()
    dbCache.set(db, cache)
  }
  let stmt = cache.get(sql)
  if (!stmt) {
    if (cache.size >= MAX_CACHED_STATEMENTS) {
      const firstKey = cache.keys().next().value
      if (firstKey !== undefined) cache.delete(firstKey)
    }
    stmt = db.prepare(sql)
    cache.set(sql, stmt)
  }
  return stmt
}

 
function ensureThread(db: Database.Database, threadId: string, now: string) {
  if (!prepare(db, 'SELECT 1 FROM threads WHERE id = ?').get(threadId))
    prepare(db, `INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens, lifetimeTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0, 0)`).run(threadId, now, now)
}

const methods: Record<string, (dbPath: string, ...args: any[]) => any> = {
  checkpointDB(dbPath) {
    getDB(dbPath).pragma('wal_checkpoint(TRUNCATE)')
  },
  getThreads(dbPath) {
    return prepare(getDB(dbPath), `SELECT t.id, t.title, t.resourceId, t.createdAt, t.updatedAt, t.accumulatedTokens, t.lifetimeTokens, t.input_tokens, t.output_tokens, tw.workspacePath FROM threads t LEFT JOIN thread_workspaces tw ON tw.threadId = t.id ORDER BY t.updatedAt DESC`).all()
  },
  getThread(dbPath, threadId) {
    return prepare(getDB(dbPath), `SELECT t.id, t.title, t.resourceId, t.createdAt, t.updatedAt, t.accumulatedTokens, t.lifetimeTokens, t.input_tokens, t.output_tokens, tw.workspacePath FROM threads t LEFT JOIN thread_workspaces tw ON tw.threadId = t.id WHERE t.id = ?`).get(threadId)
  },
  getThreadMessages(dbPath, threadId) {
    return prepare(getDB(dbPath), 'SELECT id, role, content, data, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC').all(threadId)
  },
  createThread(dbPath, threadId, workspacePath) {
    const db = getDB(dbPath), now = new Date().toISOString()
    db.transaction(() => {
      ensureThread(db, threadId, now)
      if (workspacePath) {
        prepare(db, `INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath) VALUES (?, ?)`).run(threadId, workspacePath)
        prepare(db, `INSERT OR REPLACE INTO opened_workspaces (path, lastOpenedAt) VALUES (?, ?)`).run(workspacePath, now)
      }
    })()
  },
  saveMessage(dbPath, threadId, message) {
    const db = getDB(dbPath), now = new Date().toISOString()
    const msg = { id: message.id, threadId, role: message.role, content: message.content, data: message.data || null, createdAt: message.createdAt || now }
    let saved: any
    db.transaction(() => {
      ensureThread(db, threadId, now)
      prepare(db, 'UPDATE threads SET updatedAt = ? WHERE id = ?').run(now, threadId)
      saved = prepare(db, `INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (@id, @threadId, @role, @content, @data, @createdAt) ON CONFLICT(id) DO UPDATE SET content = excluded.content, data = excluded.data RETURNING id, role, content, data, createdAt`).get(msg)
    })()
    if (!saved) throw new Error('[db] Failed to save message')
    return { id: saved.id, role: saved.role, content: saved.content, data: saved.data || undefined, createdAt: saved.createdAt }
  },
  deleteThread(dbPath, threadId) {
    return prepare(getDB(dbPath), 'DELETE FROM threads WHERE id = ?').run(threadId).changes > 0
  },
  updateThreadTitle(dbPath, threadId, title) {
    const db = getDB(dbPath), now = new Date().toISOString()
    return prepare(db, 'UPDATE threads SET title = ?, updatedAt = ? WHERE id = ?').run(title, now, threadId).changes > 0
  },
  updateThreadTokens(dbPath, threadId, accumulated, lifetimeAdded, inputAdded = 0, outputAdded = 0) {
    prepare(getDB(dbPath), 'UPDATE threads SET accumulatedTokens = ?, lifetimeTokens = lifetimeTokens + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?').run(accumulated, lifetimeAdded, inputAdded, outputAdded, threadId)
  },
  setThreadWorkspace(dbPath, threadId, workspacePath) {
    const db = getDB(dbPath), now = new Date().toISOString()
    db.transaction(() => {
      ensureThread(db, threadId, now)
      prepare(db, `INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath) VALUES (?, ?)`).run(threadId, workspacePath)
    })()
  },
  getThreadWorkspace(dbPath, threadId) {
    const row = prepare(getDB(dbPath), 'SELECT workspacePath FROM thread_workspaces WHERE threadId = ?').get(threadId) as any
    return row?.workspacePath ?? null
  },
  addOpenedWorkspace(dbPath, path) {
    prepare(getDB(dbPath), 'INSERT OR REPLACE INTO opened_workspaces (path, lastOpenedAt) VALUES (?, ?)').run(path, new Date().toISOString())
  },
  deleteOpenedWorkspace(dbPath, path) {
    prepare(getDB(dbPath), 'DELETE FROM opened_workspaces WHERE path = ?').run(path)
  },
  deleteWorkspaceThreads(dbPath, workspacePath) {
    const db = getDB(dbPath)
    let threadIds: string[] = []
    db.transaction(() => {
      threadIds = (prepare(db, 'SELECT threadId FROM thread_workspaces WHERE workspacePath = ?').all(workspacePath) as any[]).map(r => r.threadId)
      const del = prepare(db, 'DELETE FROM threads WHERE id = ?')
      for (const id of threadIds) del.run(id)
    })()
    return threadIds
  },
  compactThreadHistory(dbPath, threadId, summary, keepCount = 10) {
    const db = getDB(dbPath)
    db.transaction(() => {
      const msgs = prepare(db, 'SELECT id FROM messages WHERE threadId = ? ORDER BY createdAt ASC').all(threadId) as any[]
      if (msgs.length <= keepCount) return
      const toDelete = msgs.slice(0, msgs.length - keepCount)
      const delMsg = prepare(db, 'DELETE FROM messages WHERE id = ?')
      for (const m of toDelete) delMsg.run(m.id)
      
      prepare(db, `INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (?, ?, 'system', ?, NULL, ?)`).run(crypto.randomUUID(), threadId, `[CONTEXT COMPACTED]\nPrior conversation summarised to preserve context window. Summary:\n\n${summary}`, '0001-01-01T00:00:00.000Z')
      prepare(db, 'UPDATE threads SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), threadId)
    })()
  },
  getActiveThreadId(dbPath) {
    const row = prepare(getDB(dbPath), "SELECT value FROM app_settings WHERE key = 'activeThreadId'").get() as any
    return row?.value ?? null
  },
  setActiveThreadId(dbPath, threadId) {
    const db = getDB(dbPath)
    if (threadId) prepare(db, "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('activeThreadId', ?)").run(threadId)
    else prepare(db, "DELETE FROM app_settings WHERE key = 'activeThreadId'").run()
  },
  
  getToolPermissions(dbPath) {
    return prepare(getDB(dbPath), 'SELECT tool_name, permission FROM tool_permissions').all()
  },
  setToolPermission(dbPath, toolName, permission) {
    prepare(getDB(dbPath), 'INSERT OR REPLACE INTO tool_permissions (tool_name, permission) VALUES (?, ?)').run(toolName, permission)
  },
  
  getMemories(dbPath, workspacePath) {
    if (workspacePath) return prepare(getDB(dbPath), 'SELECT * FROM memories WHERE workspace_path = ? OR workspace_path IS NULL ORDER BY updated_at DESC').all(workspacePath)
    return prepare(getDB(dbPath), 'SELECT * FROM memories ORDER BY updated_at DESC').all()
  },
  saveMemory(dbPath, id, content, category, workspacePath) {
    prepare(getDB(dbPath), 'INSERT INTO memories (id, content, category, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, datetime("now"), datetime("now"))').run(id, content, category, workspacePath || null)
  },
  updateMemory(dbPath, id, content, category) {
    prepare(getDB(dbPath), 'UPDATE memories SET content = ?, category = COALESCE(?, category), updated_at = datetime("now") WHERE id = ?').run(content, category || null, id)
  },
  deleteMemory(dbPath, id) {
    prepare(getDB(dbPath), 'DELETE FROM memories WHERE id = ?').run(id)
  },
  
  getAppTotalTokens(dbPath) {
    return prepare(getDB(dbPath), 'SELECT COALESCE(SUM(input_tokens),0) as totalInput, COALESCE(SUM(output_tokens),0) as totalOutput, COALESCE(SUM(lifetimeTokens),0) as totalLifetime FROM threads').get()
  }
}

function handleQuery(port: any, data: any) {
  const { id, method, args, dbPath } = data, fn = methods[method]
  if (!fn) return port.postMessage({ id, error: `Method ${method} not found` })
  try { port.postMessage({ id, result: fn(dbPath, ...args) }) }
  catch (err: any) { port.postMessage({ id, error: err.message }) }
}
proc.parentPort.on('message', (e: any) => {
  if (e.data?.type === 'new-client') {
    const [port] = e.ports
    if (port) {
      port.on('message', (pe: any) => handleQuery(port, pe.data))
      port.start()
    }
  } else { handleQuery(proc.parentPort, e.data) }
})
