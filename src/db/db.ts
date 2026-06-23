import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { app } from 'electron';
import path from 'node:path';
export const workspaces = sqliteTable('workspaces', { id: text('id').primaryKey(), name: text('name').notNull(), path: text('path').notNull(), createdAt: integer('created_at').notNull() });
export const conversations = sqliteTable('conversations', { id: text('id').primaryKey(), workspaceId: text('workspace_id'), title: text('title').notNull(), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull() });
export const messages = sqliteTable('messages', { id: text('id').primaryKey(), convId: text('conv_id').notNull(), role: text('role').notNull(), content: text('content').notNull(), toolCallId: text('tool_call_id'), tokenCount: integer('token_count').default(0).notNull(), createdAt: integer('created_at').notNull() });
export const toolCalls = sqliteTable('tool_calls', { id: text('id').primaryKey(), msgId: text('msg_id').notNull(), convId: text('conv_id').notNull(), name: text('name').notNull(), input: text('input').notNull(), output: text('output'), startLine: integer('start_line'), endLine: integer('end_line'), diffAdded: integer('diff_added'), diffRemoved: integer('diff_removed'), createdAt: integer('created_at').notNull() });
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
const TABLES: Record<string, string> = {
  workspaces: 'CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL)',
  conversations: 'CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  messages: 'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, tool_call_id TEXT, token_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)',
  tool_calls: 'CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, msg_id TEXT NOT NULL, conv_id TEXT NOT NULL, name TEXT NOT NULL, input TEXT NOT NULL, output TEXT, start_line INTEGER, end_line INTEGER, diff_added INTEGER, diff_removed INTEGER, created_at INTEGER NOT NULL)',
  settings: 'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
};
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_conv_workspace ON conversations(workspace_id)',
  'CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_tc_conv ON tool_calls(conv_id, created_at)',
];
let _db: ReturnType<typeof drizzle> | null = null;
export function getDb() {
  if (_db) return _db;
  const dbPath = path.join(app.getPath('userData'), 'orchcode.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  for (const sql of Object.values(TABLES)) sqlite.exec(sql);
  for (const sql of INDEXES) sqlite.exec(sql);
  _db = drizzle(sqlite, { schema: { workspaces, conversations, messages, toolCalls, settings } });
  return _db;
}

