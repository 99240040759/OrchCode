import Database, { type Statement } from 'better-sqlite3'
import crypto from 'node:crypto'

const proc = process as any
let dbInstance: Database.Database | null = null
const stmtCache = new Map<string, Statement>()
const MAX_CACHED_STATEMENTS = 100

function getDB(dbPath: string): Database.Database {
  if (dbInstance) return dbInstance
  dbInstance = new Database(dbPath, { timeout: 5000 })
  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('synchronous = NORMAL')
  dbInstance.pragma('temp_store = MEMORY')
  dbInstance.pragma('foreign_keys = ON')
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, title TEXT, resourceId TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, accumulatedTokens INTEGER NOT NULL DEFAULT 0, lifetimeTokens INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, data TEXT, createdAt TEXT NOT NULL, FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE) STRICT;
    CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(threadId, createdAt);
    CREATE TABLE IF NOT EXISTS thread_workspaces (threadId TEXT PRIMARY KEY, workspacePath TEXT NOT NULL, FOREIGN KEY(threadId) REFERENCES threads(id) ON DELETE CASCADE) STRICT;
    CREATE TABLE IF NOT EXISTS opened_workspaces (path TEXT PRIMARY KEY, lastOpenedAt TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT) STRICT;
    CREATE TABLE IF NOT EXISTS tool_permissions (tool_name TEXT PRIMARY KEY, permission TEXT NOT NULL CHECK(permission IN ('always_allow','always_ask','always_deny'))) STRICT;
    CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', workspace_path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))) STRICT;
    CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_path);
    CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, transport TEXT NOT NULL CHECK(transport IN ('stdio','sse')), config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))) STRICT;
  `)
  const cols = (table: string) => (dbInstance!.pragma(`table_info(${table})`) as { name: string }[]).map(c => c.name)
  if (!cols('threads').includes('accumulatedTokens')) {
    dbInstance.exec(`ALTER TABLE threads ADD COLUMN accumulatedTokens INTEGER NOT NULL DEFAULT 0`)
  }
  if (!cols('threads').includes('lifetimeTokens')) {
    dbInstance.exec(`ALTER TABLE threads ADD COLUMN lifetimeTokens INTEGER NOT NULL DEFAULT 0`)
  }
  if (!cols('threads').includes('input_tokens')) {
    dbInstance.exec(`ALTER TABLE threads ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0`)
  }
  if (!cols('threads').includes('output_tokens')) {
    dbInstance.exec(`ALTER TABLE threads ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0`)
  }
  return dbInstance
}

function prepare(db: Database.Database, sql: string): Statement {
  let stmt = stmtCache.get(sql)
  if (!stmt) {
    if (stmtCache.size >= MAX_CACHED_STATEMENTS) {
      const firstKey = stmtCache.keys().next().value
      if (firstKey !== undefined) {
        stmtCache.delete(firstKey)
      }
    }
    stmt = db.prepare(sql)
    stmtCache.set(sql, stmt)
  }
  return stmt
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
    const db = getDB(dbPath)
    const now = new Date().toISOString()
    db.transaction(() => {
      if (!prepare(db, 'SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
        prepare(db, `INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens, lifetimeTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0, 0)`).run(threadId, now, now)
      }
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
      if (!prepare(db, 'SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
        prepare(db, `INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens, lifetimeTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0, 0)`).run(threadId, now, now)
      } else {
        prepare(db, 'UPDATE threads SET updatedAt = ? WHERE id = ?').run(now, threadId)
      }
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
  updateThreadTokens(dbPath, threadId, accumulated, lifetimeAdded) {
    prepare(getDB(dbPath), 'UPDATE threads SET accumulatedTokens = ?, lifetimeTokens = lifetimeTokens + ?, input_tokens = ?, output_tokens = ? WHERE id = ?').run(accumulated, lifetimeAdded, accumulated, lifetimeAdded, threadId)
  },
  setThreadWorkspace(dbPath, threadId, workspacePath) {
    const db = getDB(dbPath)
    if (!prepare(db, 'SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
      const now = new Date().toISOString()
      prepare(db, `INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, accumulatedTokens, lifetimeTokens) VALUES (?, 'New Chat', 'local-user', ?, ?, 0, 0)`).run(threadId, now, now)
    }
    prepare(db, `INSERT OR REPLACE INTO thread_workspaces (threadId, workspacePath) VALUES (?, ?)`).run(threadId, workspacePath)
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
      const rows = prepare(db, 'SELECT threadId FROM thread_workspaces WHERE workspacePath = ?').all(workspacePath) as any[]
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
      const msgs = prepare(db, 'SELECT id, createdAt FROM messages WHERE threadId = ? ORDER BY createdAt ASC').all(threadId) as any[]
      if (msgs.length <= keepCount) return
      const deleteCount = msgs.length - keepCount
      const toDelete = msgs.slice(0, deleteCount).map((m: any) => m.id)
      if (toDelete.length > 0) {
        const placeholders = toDelete.map(() => '?').join(',')
        db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...toDelete)
      }
      // Use fixed epoch timestamp so summary always sorts before any real message, even across multiple compactions
      const summaryDate = '0001-01-01T00:00:00.000Z'
      const summaryId = crypto.randomUUID()
      prepare(db, `INSERT INTO messages (id, threadId, role, content, data, createdAt) VALUES (?, ?, 'system', ?, NULL, ?)`).run(summaryId, threadId, `[CONTEXT COMPACTED]\nPrior conversation summarised to preserve context window. Summary:\n\n${summary}`, summaryDate)
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
  // Tool Permissions
  getToolPermissions(dbPath) {
    return prepare(getDB(dbPath), 'SELECT tool_name, permission FROM tool_permissions').all()
  },
  setToolPermission(dbPath, toolName, permission) {
    prepare(getDB(dbPath), 'INSERT OR REPLACE INTO tool_permissions (tool_name, permission) VALUES (?, ?)').run(toolName, permission)
  },
  deleteToolPermission(dbPath, toolName) {
    prepare(getDB(dbPath), 'DELETE FROM tool_permissions WHERE tool_name = ?').run(toolName)
  },
  // Memories
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
  // MCP Servers
  getMcpServers(dbPath) {
    return prepare(getDB(dbPath), 'SELECT * FROM mcp_servers ORDER BY created_at DESC').all()
  },
  saveMcpServer(dbPath, id, name, transport, config, enabled) {
    prepare(getDB(dbPath), 'INSERT INTO mcp_servers (id, name, transport, config, enabled, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))').run(id, name, transport, config, enabled ? 1 : 0)
  },
  updateMcpServer(dbPath, id, name, transport, config, enabled) {
    prepare(getDB(dbPath), 'UPDATE mcp_servers SET name = ?, transport = ?, config = ?, enabled = ? WHERE id = ?').run(name, transport, config, enabled ? 1 : 0, id)
  },
  deleteMcpServer(dbPath, id) {
    prepare(getDB(dbPath), 'DELETE FROM mcp_servers WHERE id = ?').run(id)
  },
  // Token tracking
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
