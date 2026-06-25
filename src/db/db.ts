import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
export type SqliteDb = Database.Database;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, role TEXT NOT NULL, seq INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'complete', error TEXT, model TEXT, compacted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS parts (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, conv_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, text TEXT, tool_call_id TEXT, tool_name TEXT, tool_args TEXT, tool_result TEXT, tool_status TEXT, tool_meta TEXT, artifact_id TEXT, path TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, message_id TEXT, part_id TEXT, kind TEXT NOT NULL, mime TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_conv_workspace ON conversations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_part_msg ON parts(message_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_part_conv ON parts(conv_id)`,
  `CREATE INDEX IF NOT EXISTS idx_art_conv ON artifacts(conv_id)`,
];
let _db: SqliteDb | null = null;
export function getDb(): SqliteDb {
  if (_db) return _db;
  const sqlite = new Database(path.join(app.getPath('userData'), 'orchcode.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  for (const sql of SCHEMA) sqlite.exec(sql);
  for (const sql of INDEXES) sqlite.exec(sql);
  _db = sqlite;
  return _db;
}
