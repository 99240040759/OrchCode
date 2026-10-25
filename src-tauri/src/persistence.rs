use std::collections::HashMap;
use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::events::ToolDisplayInfo;
use crate::util::now_ms;

const SCHEMA: &str = "
 CREATE TABLE sessions (
     id                  TEXT PRIMARY KEY,
     title               TEXT,
     workspace_path      TEXT,
     user_id             TEXT,
     created_at          INTEGER NOT NULL,
     updated_at          INTEGER NOT NULL,
     total_input_tokens  INTEGER NOT NULL DEFAULT 0,
     total_output_tokens INTEGER NOT NULL DEFAULT 0,
     total_tokens        INTEGER NOT NULL DEFAULT 0,
     last_context_tokens INTEGER NOT NULL DEFAULT 0
 );
 CREATE INDEX idx_sessions_workspace_user
     ON sessions(workspace_path, user_id, updated_at DESC);

 CREATE TABLE reasoning_durations (
     conversation_id  TEXT NOT NULL,
     item_id          TEXT NOT NULL,
     duration_seconds INTEGER NOT NULL,
     PRIMARY KEY (conversation_id, item_id)
 );

 CREATE TABLE connectors (
     id               TEXT PRIMARY KEY,
     name             TEXT NOT NULL,
     enabled          INTEGER NOT NULL DEFAULT 0,
     auth_kind        TEXT NOT NULL DEFAULT 'none',
     has_token        INTEGER NOT NULL DEFAULT 0,
     token_expires_at INTEGER,
     error            TEXT,
     updated_at       INTEGER NOT NULL DEFAULT 0
 );

 CREATE TABLE documents (
     id             TEXT PRIMARY KEY,
     title          TEXT NOT NULL,
     file_path      TEXT,
     source         TEXT NOT NULL DEFAULT 'local',
     source_id      TEXT,
     file_type      TEXT NOT NULL,
     size_bytes     INTEGER NOT NULL DEFAULT 0,
     page_count     INTEGER,
     word_count     INTEGER,
     metadata       TEXT NOT NULL DEFAULT '{}',
     indexed_at     INTEGER NOT NULL,
     updated_at     INTEGER NOT NULL,
     workspace_path TEXT
 );
 CREATE INDEX idx_documents_source ON documents(source);
 CREATE INDEX idx_documents_file_type ON documents(file_type);
 CREATE INDEX idx_documents_updated_at ON documents(updated_at DESC);
 CREATE INDEX idx_documents_workspace ON documents(workspace_path);

 CREATE TABLE passages (
     pid          INTEGER PRIMARY KEY,
     id           TEXT NOT NULL UNIQUE,
     document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     seq          INTEGER NOT NULL,
     text         TEXT NOT NULL,
     page_number  INTEGER,
     char_start   INTEGER,
     char_end     INTEGER
 );
 CREATE INDEX idx_passages_document ON passages(document_id, seq);

 CREATE VIRTUAL TABLE passages_fts USING fts5(
     text,
     content='passages',
     content_rowid='pid',
     tokenize='unicode61 remove_diacritics 2'
 );

 CREATE TRIGGER passages_ai AFTER INSERT ON passages BEGIN
     INSERT INTO passages_fts(rowid, text) VALUES (new.pid, new.text);
 END;

 CREATE TRIGGER passages_ad AFTER DELETE ON passages BEGIN
     INSERT INTO passages_fts(passages_fts, rowid, text) VALUES ('delete', old.pid, old.text);
 END;

 CREATE TRIGGER passages_au AFTER UPDATE ON passages BEGIN
     INSERT INTO passages_fts(passages_fts, rowid, text) VALUES ('delete', old.pid, old.text);
     INSERT INTO passages_fts(rowid, text) VALUES (new.pid, new.text);
 END;
";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionViewPage {
    pub messages: Vec<MessageView>,
    pub has_more: bool,
    pub earliest_seq: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: Option<String>,
    pub workspace_path: Option<String>,
    pub updated_at: i64,
    pub context_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    pub name: String,
    pub is_image: bool,
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MessageItemView {
    Text {
        id: String,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Reasoning {
        id: String,
        text: String,
        duration_seconds: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    ToolCall {
        id: String,
        name: String,
        args: String,
        output: Option<String>,
        display_info: ToolDisplayInfo,
        status: String,
    },
    #[serde(rename_all = "camelCase")]
    CompactionNotice {
        id: String,
        original_message_count: usize,
        ts: i64,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    pub id: String,
    pub role: String,
    pub items: Vec<MessageItemView>,
    pub attachments: Vec<AttachmentView>,
}

const POOL_SIZE: u32 = 6;

pub(crate) type SqlitePool = Pool<SqliteConnectionManager>;

#[derive(Clone)]
pub struct SqliteMemory {
    pub(crate) pool: SqlitePool,
}

impl SqliteMemory {
    pub fn open(path: &Path) -> AppResult<Self> {
        let manager = SqliteConnectionManager::file(path).with_init(configure_connection);
        let pool = Pool::builder()
            .max_size(POOL_SIZE)
            .build(manager)
            .map_err(|e| AppError::other(format!("sqlite pool build failed: {e}")))?;

        let mut conn = pool.get().map_err(pool_err)?;

        let migration_list = vec![
            rusqlite_migration::M::up(SCHEMA),
        ];
        let max_version = migration_list.len();
        let migrations = rusqlite_migration::Migrations::new(migration_list);

        let current_version: usize = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| AppError::other(format!("sqlite user_version read failed: {e}")))?;

        if current_version > max_version {
            return Err(AppError::other(format!(
                "database schema version {current_version} is newer than this build supports ({max_version})"
            )));
        }

        migrations
            .to_latest(&mut conn)
            .map_err(|e| AppError::other(format!("sqlite schema migration failed: {e}")))?;

        drop(conn);

        Ok(Self { pool })
    }

    pub async fn touch_session(
        &self,
        session_id: &str,
        workspace_path: &str,
        user_id: &str,
    ) -> AppResult<()> {
        let pool = self.pool.clone();
        let sid = session_id.to_string();
        let ws = workspace_path.to_string();
        let uid = user_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let now = now_ms();
            c.execute(
                "INSERT INTO sessions (id, workspace_path, user_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                     workspace_path = COALESCE(sessions.workspace_path, excluded.workspace_path),
                     user_id = COALESCE(sessions.user_id, excluded.user_id),
                     updated_at = excluded.updated_at",
                params![sid, ws, uid, now],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn record_usage(
        &self,
        session_id: &str,
        context_tokens: u64,
        input_tokens: u64,
        output_tokens: u64,
    ) -> AppResult<()> {
        let pool = self.pool.clone();
        let sid = session_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute(
                "UPDATE sessions SET
                     last_context_tokens = ?2,
                     total_input_tokens = total_input_tokens + ?3,
                     total_output_tokens = total_output_tokens + ?4,
                     total_tokens = total_tokens + ?3 + ?4,
                     updated_at = ?5
                 WHERE id = ?1",
                params![
                    sid,
                    to_db_token(context_tokens),
                    to_db_token(input_tokens),
                    to_db_token(output_tokens),
                    now_ms()
                ],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn set_context_tokens(&self, session_id: &str, context_tokens: u64) -> AppResult<()> {
        let pool = self.pool.clone();
        let sid = session_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute(
                "UPDATE sessions SET last_context_tokens = ?2, updated_at = ?3 WHERE id = ?1",
                params![sid, to_db_token(context_tokens), now_ms()],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn list_sessions_for_workspace(
        &self,
        workspace_path: &str,
        user_id: &str,
    ) -> AppResult<Vec<SessionSummary>> {
        let pool = self.pool.clone();
        let ws = workspace_path.to_string();
        let uid = user_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let mut stmt = c
                .prepare(
                    "SELECT id, title, workspace_path, updated_at, last_context_tokens
                     FROM sessions
                     WHERE workspace_path = ?1 AND (user_id = ?2 OR user_id IS NULL)
                     ORDER BY updated_at DESC",
                )
                .map_err(sql_err)?;
            let rows = stmt
                .query_map(params![ws, uid], |row| {
                    Ok(SessionSummary {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        workspace_path: row.get(2)?,
                        updated_at: row.get(3)?,
                        context_tokens: row.get(4)?,
                    })
                })
                .map_err(sql_err)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(sql_err)?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn session_ids_for_workspace(&self, workspace_path: &str) -> AppResult<Vec<String>> {
        let pool = self.pool.clone();
        let ws = workspace_path.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let mut stmt = c
                .prepare("SELECT id FROM sessions WHERE workspace_path = ?1")
                .map_err(sql_err)?;
            let rows = stmt
                .query_map(params![ws], |row| row.get::<_, String>(0))
                .map_err(sql_err)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(sql_err)?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn delete_session(&self, session_id: &str) -> AppResult<()> {
        let pool = self.pool.clone();
        let sid = session_id.to_string();
        run_db_task(move || {
            let mut c = pool.get().map_err(pool_err)?;
            let tx = c.transaction().map_err(sql_err)?;
            tx.execute(
                "DELETE FROM reasoning_durations WHERE conversation_id = ?1",
                params![sid],
            )
            .map_err(sql_err)?;
            tx.execute("DELETE FROM sessions WHERE id = ?1", params![sid])
                .map_err(sql_err)?;
            tx.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn delete_sessions_for_workspace(&self, workspace_path: &str) -> AppResult<()> {
        let pool = self.pool.clone();
        let ws = workspace_path.to_string();
        run_db_task(move || {
            let mut c = pool.get().map_err(pool_err)?;
            let tx = c.transaction().map_err(sql_err)?;
            tx.execute(
                "DELETE FROM reasoning_durations WHERE conversation_id IN (SELECT id FROM sessions WHERE workspace_path = ?1)",
                params![ws],
            )
            .map_err(sql_err)?;
            tx.execute("DELETE FROM sessions WHERE workspace_path = ?1", params![ws])
                .map_err(sql_err)?;
            tx.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn set_session_title(&self, conversation_id: &str, title: &str) -> AppResult<bool> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        let t = title.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let changed = c
                .execute(
                    "UPDATE sessions SET title = ?2 WHERE id = ?1 AND (title IS NULL OR title = '')",
                    params![cid, t],
                )
                .map_err(sql_err)?;
            Ok(changed > 0)
        })
        .await
    }

    pub async fn session_has_title(&self, conversation_id: &str) -> AppResult<bool> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND title IS NOT NULL AND title != ''",
                params![cid],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(sql_err)
        })
        .await
    }

    pub async fn session_owner(&self, conversation_id: &str) -> AppResult<Option<String>> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let owner: Option<Option<String>> = c
                .query_row(
                    "SELECT user_id FROM sessions WHERE id = ?1",
                    params![cid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(sql_err)?;
            Ok(owner.flatten())
        })
        .await
    }

    pub async fn session_context_tokens(&self, conversation_id: &str) -> AppResult<u64> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let value: Option<i64> = c
                .query_row(
                    "SELECT last_context_tokens FROM sessions WHERE id = ?1",
                    params![cid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(sql_err)?;
            Ok(value.unwrap_or(0).max(0) as u64)
        })
        .await
    }

    pub async fn reasoning_durations(&self, conversation_id: &str) -> AppResult<HashMap<String, u64>> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let mut stmt = c
                .prepare("SELECT item_id, duration_seconds FROM reasoning_durations WHERE conversation_id = ?1")
                .map_err(sql_err)?;
            let iter = stmt
                .query_map(params![cid], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(sql_err)?;
            let mut out = HashMap::new();
            for row in iter {
                let (item_id, secs) = row.map_err(sql_err)?;
                out.insert(item_id, secs.max(0) as u64);
            }
            Ok(out)
        })
        .await
    }

    pub async fn save_reasoning_durations(
        &self,
        conversation_id: &str,
        durations: Vec<(String, u64)>,
    ) -> AppResult<()> {
        if durations.is_empty() {
            return Ok(());
        }
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let mut c = pool.get().map_err(pool_err)?;
            let tx = c.transaction().map_err(sql_err)?;
            for (item_id, secs) in durations {
                tx.execute(
                    "INSERT INTO reasoning_durations (conversation_id, item_id, duration_seconds)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(conversation_id, item_id) DO UPDATE SET duration_seconds = ?3",
                    params![cid, item_id, to_db_token(secs)],
                )
                .map_err(sql_err)?;
            }
            tx.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }
}

fn to_db_token(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

pub fn configure_connection(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    conn.execute_batch("
        PRAGMA foreign_keys = ON;
        PRAGMA recursive_triggers = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 268435456;
        PRAGMA cache_size = -16384;
    ")?;
    Ok(())
}


fn fts5_query(raw: &str, joiner: &str) -> String {
    raw.split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(joiner)
}

pub(crate) async fn run_db_task<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::other(format!("db task failed: {e}")))?
}

pub(crate) fn sql_err(e: rusqlite::Error) -> AppError {
    AppError::other(format!("sqlite error: {e}"))
}

pub(crate) fn pool_err(e: r2d2::Error) -> AppError {
    AppError::other(format!("db pool error: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub source: String,
    pub source_id: Option<String>,
    pub file_type: String,
    pub size_bytes: i64,
    pub page_count: Option<i64>,
    pub word_count: Option<i64>,
    pub metadata: serde_json::Value,
    pub indexed_at: i64,
    pub updated_at: i64,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageRecord {
    pub id: String,
    pub document_id: String,
    pub seq: i64,
    pub text: String,
    pub page_number: Option<i64>,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub document_id: String,
    pub passage_id: String,
    pub document_title: String,
    pub file_type: String,
    pub source: String,
    pub file_path: Option<String>,
    pub snippet: String,
    pub score: f64,
    pub page_number: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRecord {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub auth_kind: String,
    pub has_token: bool,
    pub token_expires_at: Option<i64>,
    pub error: Option<String>,
    pub updated_at: i64,
}

fn search_passages(
    conn: &Connection,
    query: &str,
    limit: usize,
    workspace_path: Option<&str>,
) -> AppResult<Vec<SearchHit>> {
    let (sql, params_vec): (String, Vec<Box<dyn rusqlite::ToSql>>) = if let Some(ws) = workspace_path {
        (
            "SELECT p.document_id, p.id, d.title, d.file_type, d.source, d.file_path,
                    snippet(passages_fts, 0, '<b>', '</b>', '...', 32),
                    bm25(passages_fts),
                    p.page_number
             FROM passages_fts
             JOIN passages p ON p.pid = passages_fts.rowid
             JOIN documents d ON d.id = p.document_id
             WHERE passages_fts MATCH ?1
               AND (d.workspace_path = ?2 OR d.workspace_path IS NULL OR d.source != 'local')
             ORDER BY bm25(passages_fts)
             LIMIT ?3"
                .to_string(),
            vec![
                Box::new(query.to_string()),
                Box::new(ws.to_string()),
                Box::new(limit as i64),
            ],
        )
    } else {
        (
            "SELECT p.document_id, p.id, d.title, d.file_type, d.source, d.file_path,
                    snippet(passages_fts, 0, '<b>', '</b>', '...', 32),
                    bm25(passages_fts),
                    p.page_number
             FROM passages_fts
             JOIN passages p ON p.pid = passages_fts.rowid
             JOIN documents d ON d.id = p.document_id
             WHERE passages_fts MATCH ?1
             ORDER BY bm25(passages_fts)
             LIMIT ?2"
                .to_string(),
            vec![Box::new(query.to_string()), Box::new(limit as i64)],
        )
    };
    let refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|v| v.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(sql_err)?;
    let rows = stmt
        .query_map(refs.as_slice(), |row| {
            Ok(SearchHit {
                document_id: row.get(0)?,
                passage_id: row.get(1)?,
                document_title: row.get(2)?,
                file_type: row.get(3)?,
                source: row.get(4)?,
                file_path: row.get(5)?,
                snippet: row.get(6)?,
                score: row.get(7)?,
                page_number: row.get(8)?,
            })
        })
        .map_err(sql_err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(sql_err)?);
    }
    Ok(out)
}

impl SqliteMemory {
    pub async fn replace_document_with_passages(
        &self,
        doc: DocumentRecord,
        passages: Vec<PassageRecord>,
    ) -> AppResult<()> {
        let pool = self.pool.clone();
        run_db_task(move || {
            let mut c = pool.get().map_err(pool_err)?;
            let tx = c.transaction().map_err(sql_err)?;
            tx.execute("DELETE FROM documents WHERE id = ?1", params![doc.id])
                .map_err(sql_err)?;

            let meta = serde_json::to_string(&doc.metadata).map_err(|e| {
                AppError::other(format!("document metadata serialization failed: {e}"))
            })?;
            tx.execute(
                "INSERT INTO documents (id, title, file_path, source, source_id, file_type,
                  size_bytes, page_count, word_count, metadata, indexed_at, updated_at, workspace_path)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    doc.id,
                    doc.title,
                    doc.file_path,
                    doc.source,
                    doc.source_id,
                    doc.file_type,
                    doc.size_bytes,
                    doc.page_count,
                    doc.word_count,
                    meta,
                    doc.indexed_at,
                    doc.updated_at,
                    doc.workspace_path
                ],
            )
            .map_err(sql_err)?;

            if !passages.is_empty() {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO passages (id, document_id, seq, text, page_number, char_start, char_end)
                         VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    )
                    .map_err(sql_err)?;
                for passage in passages {
                    stmt.execute(params![
                        passage.id,
                        passage.document_id,
                        passage.seq,
                        passage.text,
                        passage.page_number,
                        passage.char_start,
                        passage.char_end
                    ])
                    .map_err(sql_err)?;
                }
                drop(stmt);
            }

            tx.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn delete_document(&self, document_id: &str) -> AppResult<()> {
        let pool = self.pool.clone();
        let did = document_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute("DELETE FROM documents WHERE id=?1", params![did])
                .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn clear_all_documents(&self) -> AppResult<()> {
        let pool = self.pool.clone();
        run_db_task(move || {
            let mut c = pool.get().map_err(pool_err)?;
            let tx = c.transaction().map_err(sql_err)?;
            tx.execute("DELETE FROM passages", []).map_err(sql_err)?;
            tx.execute("DELETE FROM documents", []).map_err(sql_err)?;
            tx.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn list_documents(
        &self,
        workspace_path: Option<String>,
        source: Option<String>,
        file_type: Option<String>,
        limit: usize,
        offset: usize,
    ) -> AppResult<Vec<DocumentRecord>> {
        let pool = self.pool.clone();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let mut sql = String::from(
                "SELECT id, title, file_path, source, source_id, file_type,
                        size_bytes, page_count, word_count, metadata, indexed_at, updated_at, workspace_path
                 FROM documents WHERE 1=1",
            );
            let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
            if let Some(ws) = workspace_path {
                sql.push_str(" AND (workspace_path = ? OR workspace_path IS NULL OR source != 'local')");
                values.push(Box::new(ws));
            }
            if let Some(s) = source {
                sql.push_str(" AND source=?");
                values.push(Box::new(s));
            }
            if let Some(ft) = file_type {
                sql.push_str(" AND file_type=?");
                values.push(Box::new(ft));
            }
            sql.push_str(" ORDER BY updated_at DESC LIMIT ? OFFSET ?");
            values.push(Box::new(limit as i64));
            values.push(Box::new(offset as i64));

            let refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
            let mut stmt = c.prepare(&sql).map_err(sql_err)?;
            let rows = stmt.query_map(refs.as_slice(), map_document_row).map_err(sql_err)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(sql_err)?);
            }
            Ok(out)
        })
        .await
    }


    pub async fn document_exists_by_path(&self, path: &str) -> AppResult<Option<String>> {
        let pool = self.pool.clone();
        let p = path.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.query_row(
                "SELECT id FROM documents WHERE file_path=?1 LIMIT 1",
                params![p],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(sql_err)
        })
        .await
    }

    pub async fn search_documents(
        &self,
        query: &str,
        limit: usize,
        workspace_path: Option<String>,
    ) -> AppResult<Vec<SearchHit>> {
        let strict = fts5_query(query, " ");
        if strict.is_empty() {
            return Ok(Vec::new());
        }
        let loose = fts5_query(query, " OR ");
        let pool = self.pool.clone();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let hits = search_passages(&c, &strict, limit, workspace_path.as_deref())?;
            if hits.is_empty() && loose != strict {
                return search_passages(&c, &loose, limit, workspace_path.as_deref());
            }
            Ok(hits)
        })
        .await
    }

    pub async fn count_documents(&self, workspace_path: Option<String>) -> AppResult<i64> {
        let pool = self.pool.clone();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            if let Some(ws) = workspace_path {
                c.query_row(
                    "SELECT COUNT(*) FROM documents WHERE (workspace_path = ?1 OR workspace_path IS NULL OR source != 'local')",
                    params![ws],
                    |r| r.get(0),
                )
                .map_err(sql_err)
            } else {
                c.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))
                    .map_err(sql_err)
            }
        })
        .await
    }

    pub async fn upsert_connector(&self, rec: ConnectorRecord) -> AppResult<()> {
        let pool = self.pool.clone();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute(
                "INSERT INTO connectors (id, name, enabled, auth_kind, has_token, token_expires_at, error, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name, enabled=excluded.enabled,
                   auth_kind=excluded.auth_kind, has_token=excluded.has_token,
                   token_expires_at=excluded.token_expires_at,
                   error=excluded.error, updated_at=excluded.updated_at",
                params![
                    rec.id,
                    rec.name,
                    rec.enabled as i64,
                    rec.auth_kind,
                    rec.has_token as i64,
                    rec.token_expires_at,
                    rec.error,
                    rec.updated_at
                ],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn list_connectors(&self) -> AppResult<Vec<ConnectorRecord>> {
        let pool = self.pool.clone();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let mut stmt = c
                .prepare(
                    "SELECT id, name, enabled, auth_kind, has_token, token_expires_at, error, updated_at
                     FROM connectors ORDER BY id",
                )
                .map_err(sql_err)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(ConnectorRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        enabled: row.get::<_, i64>(2)? != 0,
                        auth_kind: row.get(3)?,
                        has_token: row.get::<_, i64>(4)? != 0,
                        token_expires_at: row.get(5)?,
                        error: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                })
                .map_err(sql_err)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(sql_err)?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn set_connector_enabled(&self, id: &str, enabled: bool) -> AppResult<()> {
        let pool = self.pool.clone();
        let cid = id.to_string();
        let ts = now_ms();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute(
                "UPDATE connectors SET enabled=?1, updated_at=?2 WHERE id=?3",
                params![enabled as i64, ts, cid],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn set_connector_token_state(
        &self,
        id: &str,
        has_token: bool,
        expires_at: Option<i64>,
        error: Option<&str>,
    ) -> AppResult<()> {
        let pool = self.pool.clone();
        let cid = id.to_string();
        let ts = now_ms();
        let err = error.map(|s| s.to_string());
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute(
                "UPDATE connectors SET has_token=?1, token_expires_at=?2, error=?3, updated_at=?4 WHERE id=?5",
                params![has_token as i64, expires_at, err, ts, cid],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn set_connector_error(&self, id: &str, error: Option<&str>) -> AppResult<()> {
        let pool = self.pool.clone();
        let cid = id.to_string();
        let ts = now_ms();
        let err = error.map(|s| s.to_string());
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute(
                "UPDATE connectors SET error=?1, updated_at=?2 WHERE id=?3",
                params![err, ts, cid],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn clear_all_connector_tokens(&self) -> AppResult<()> {
        let pool = self.pool.clone();
        let ts = now_ms();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.execute(
                "UPDATE connectors SET enabled=0, has_token=0, token_expires_at=NULL, error=NULL, updated_at=?1",
                params![ts],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }
}

fn map_document_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentRecord> {
    let meta_str: String = row.get(9)?;
    let metadata =
        serde_json::from_str(&meta_str).unwrap_or(serde_json::Value::Object(Default::default()));
    Ok(DocumentRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        file_path: row.get(2)?,
        source: row.get(3)?,
        source_id: row.get(4)?,
        file_type: row.get(5)?,
        size_bytes: row.get(6)?,
        page_count: row.get(7)?,
        word_count: row.get(8)?,
        metadata,
        indexed_at: row.get(10)?,
        updated_at: row.get(11)?,
        workspace_path: row.get(12)?,
    })
}
