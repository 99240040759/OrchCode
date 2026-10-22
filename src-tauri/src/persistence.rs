use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use rig::completion::Message;
use rig::id::ConversationId;
use rig::memory::{ConversationMemory, MemoryError};
use rig::message::{AssistantContent, DocumentSourceKind, MimeType, ToolResultContent, UserContent};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::events::ToolDisplayInfo;
use crate::llm::{is_payload_part, payload_part_label};
use crate::tools::parse_display_info;
use crate::util::now_ms;

type MemoryFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

const BASELINE_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS messages (
     conversation_id TEXT NOT NULL,
     seq             INTEGER NOT NULL,
     ts              INTEGER NOT NULL,
     data            TEXT NOT NULL,
     kind            TEXT NOT NULL DEFAULT 'message',
     PRIMARY KEY (conversation_id, seq)
 );
 CREATE TABLE IF NOT EXISTS sessions (
     id                 TEXT PRIMARY KEY,
     title              TEXT,
     workspace_path     TEXT,
     created_at         INTEGER NOT NULL,
     updated_at         INTEGER NOT NULL,
     last_input_tokens  INTEGER NOT NULL DEFAULT 0,
     last_output_tokens INTEGER NOT NULL DEFAULT 0,
     last_total_tokens  INTEGER NOT NULL DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS reasoning_durations (
     conversation_id  TEXT NOT NULL,
     item_id          TEXT NOT NULL,
     duration_seconds INTEGER NOT NULL,
     PRIMARY KEY (conversation_id, item_id)
 );
 CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);";

const RENAME_TOKEN_COLUMNS: &str = "
 ALTER TABLE sessions RENAME COLUMN last_input_tokens  TO total_input_tokens;
 ALTER TABLE sessions RENAME COLUMN last_output_tokens TO total_output_tokens;
 ALTER TABLE sessions RENAME COLUMN last_total_tokens  TO total_tokens;
";

const KNOWLEDGE_SCHEMA: &str = "
 CREATE TABLE IF NOT EXISTS connectors (
     id           TEXT PRIMARY KEY,
     name         TEXT NOT NULL,
     enabled      INTEGER NOT NULL DEFAULT 0,
     auth_kind    TEXT NOT NULL DEFAULT 'none',
     has_token    INTEGER NOT NULL DEFAULT 0,
     token_expires_at INTEGER,
     error        TEXT,
     updated_at   INTEGER NOT NULL DEFAULT 0
 );

 CREATE TABLE IF NOT EXISTS documents (
     id           TEXT PRIMARY KEY,
     title        TEXT NOT NULL,
     file_path    TEXT,
     source       TEXT NOT NULL DEFAULT 'local',
     source_id    TEXT,
     file_type    TEXT NOT NULL,
     size_bytes   INTEGER NOT NULL DEFAULT 0,
     page_count   INTEGER,
     word_count   INTEGER,
     metadata     TEXT NOT NULL DEFAULT '{}',
     indexed_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
 );

 CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
 CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
 CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);

 CREATE TABLE IF NOT EXISTS passages (
     id           TEXT PRIMARY KEY,
     document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     seq          INTEGER NOT NULL,
     text         TEXT NOT NULL,
     page_number  INTEGER,
     char_start   INTEGER,
     char_end     INTEGER
 );

 CREATE INDEX IF NOT EXISTS idx_passages_document ON passages(document_id, seq);

 CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
     text,
     document_id UNINDEXED,
     passage_id UNINDEXED,
     content='passages',
     content_rowid='rowid'
 );

 CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
     INSERT INTO passages_fts(rowid, text, document_id, passage_id)
     VALUES (new.rowid, new.text, new.document_id, new.id);
 END;

 CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
     INSERT INTO passages_fts(passages_fts, rowid, text, document_id, passage_id)
     VALUES ('delete', old.rowid, old.text, old.document_id, old.id);
 END;

 CREATE TRIGGER IF NOT EXISTS passages_au AFTER UPDATE ON passages BEGIN
     INSERT INTO passages_fts(passages_fts, rowid, text, document_id, passage_id)
     VALUES ('delete', old.rowid, old.text, old.document_id, old.id);
     INSERT INTO passages_fts(rowid, text, document_id, passage_id)
     VALUES (new.rowid, new.text, new.document_id, new.id);
 END;
";

const PASSAGE_INDEX_SCHEMA: &str = "
 DROP TRIGGER IF EXISTS passages_ai;
 DROP TRIGGER IF EXISTS passages_ad;
 DROP TRIGGER IF EXISTS passages_au;
 DROP TABLE IF EXISTS passages_fts;

 CREATE TABLE passages_v2 (
     pid          INTEGER PRIMARY KEY,
     id           TEXT NOT NULL UNIQUE,
     document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     seq          INTEGER NOT NULL,
     text         TEXT NOT NULL,
     page_number  INTEGER,
     char_start   INTEGER,
     char_end     INTEGER
 );
 INSERT INTO passages_v2 (id, document_id, seq, text, page_number, char_start, char_end)
     SELECT id, document_id, seq, text, page_number, char_start, char_end
     FROM passages ORDER BY document_id, seq;
 DROP TABLE passages;
 ALTER TABLE passages_v2 RENAME TO passages;
 CREATE INDEX IF NOT EXISTS idx_passages_document ON passages(document_id, seq);

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

 INSERT INTO passages_fts(passages_fts) VALUES ('rebuild');
";

const CONVERSATION_SCOPE_SCHEMA: &str = "
 CREATE TABLE IF NOT EXISTS compactions (
     conversation_id        TEXT NOT NULL,
     upto_seq               INTEGER NOT NULL,
     summary                TEXT NOT NULL,
     original_message_count INTEGER NOT NULL,
     ts                     INTEGER NOT NULL,
     PRIMARY KEY (conversation_id, upto_seq)
 );
 INSERT OR REPLACE INTO compactions (conversation_id, upto_seq, summary, original_message_count, ts)
     SELECT conversation_id,
            seq,
            COALESCE(json_extract(data, '$.summary'), ''),
            COALESCE(json_extract(data, '$.original_message_count'), 0),
            ts
     FROM messages WHERE kind = 'compaction';
 DELETE FROM messages WHERE kind = 'compaction';

 ALTER TABLE sessions ADD COLUMN user_id TEXT;
 ALTER TABLE sessions ADD COLUMN last_context_tokens INTEGER NOT NULL DEFAULT 0;
 CREATE INDEX IF NOT EXISTS idx_sessions_workspace_user
     ON sessions(workspace_path, user_id, updated_at DESC);
";

const WORKSPACE_DOCUMENT_SCHEMA: &str = "
 ALTER TABLE documents ADD COLUMN workspace_path TEXT;
 CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_path);
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

pub struct CompactionInput {
    pub previous_summary: Option<String>,
    pub prior_message_count: usize,
    pub summarize: Vec<Message>,
    pub summarize_upto_seq: i64,
    pub remaining: Vec<Message>,
}

struct CompactionRecord {
    upto_seq: i64,
    summary: String,
    original_message_count: usize,
    ts: i64,
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
            rusqlite_migration::M::up(BASELINE_SCHEMA),
            rusqlite_migration::M::up(KNOWLEDGE_SCHEMA),
            rusqlite_migration::M::up(RENAME_TOKEN_COLUMNS),
            rusqlite_migration::M::up(crate::run_persistence::DURABLE_RUN_SCHEMA),
            rusqlite_migration::M::up(PASSAGE_INDEX_SCHEMA),
            rusqlite_migration::M::up(CONVERSATION_SCOPE_SCHEMA),
            rusqlite_migration::M::up(WORKSPACE_DOCUMENT_SCHEMA),
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

        crate::run_persistence::recover_interrupted_runs(&mut conn)?;
        drop(conn);

        Ok(Self { pool })
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
                       AND (EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = sessions.id)
                            OR EXISTS (SELECT 1 FROM chat_runs r WHERE r.conversation_id = sessions.id))
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

    pub async fn delete_sessions_for_workspace(&self, workspace_path: &str) -> AppResult<()> {
        let pool = self.pool.clone();
        let ws = workspace_path.to_string();
        run_db_task(move || {
            let mut c = pool.get().map_err(pool_err)?;
            let tx = c.transaction().map_err(sql_err)?;
            for table in ["messages", "reasoning_durations", "compactions"] {
                tx.execute(
                    &format!(
                        "DELETE FROM {table} WHERE conversation_id IN (SELECT id FROM sessions WHERE workspace_path = ?1)"
                    ),
                    params![ws],
                )
                .map_err(sql_err)?;
            }
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
            let owner: Option<String> = c
                .query_row(
                    "SELECT user_id FROM sessions WHERE id = ?1",
                    params![cid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(sql_err)?;
            Ok(owner)
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

    pub async fn max_seq(&self, conversation_id: &str) -> AppResult<i64> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            c.query_row(
                "SELECT COALESCE(MAX(seq), -1) FROM messages WHERE conversation_id = ?1",
                params![cid],
                |row| row.get(0),
            )
            .map_err(sql_err)
        })
        .await
    }

    pub async fn assign_reasoning_durations(
        &self,
        conversation_id: &str,
        after_seq: i64,
        durations: Vec<u64>,
    ) -> AppResult<()> {
        if durations.is_empty() {
            return Ok(());
        }
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let mut c = pool.get().map_err(pool_err)?;
            let rows = load_after(&c, &cid, after_seq).map_err(sql_err)?;
            let mut pending = durations.into_iter();
            let mut assignments: Vec<(String, u64)> = Vec::new();

            'outer: for row in &rows {
                let Ok(Message::Assistant(assistant)) =
                    serde_json::from_str::<Message>(&row.data)
                else {
                    continue;
                };
                let mut item_idx = 0usize;
                for part in assistant.content.iter() {
                    match part {
                        AssistantContent::Reasoning(r) => {
                            if r.text.is_empty() {
                                continue;
                            }
                            match pending.next() {
                                Some(secs) => assignments.push((
                                    stable_id(&cid, row.seq, item_idx, Some("reasoning")),
                                    secs,
                                )),
                                None => break 'outer,
                            }
                            item_idx += 1;
                        }
                        AssistantContent::Text(t) => {
                            if !t.text.is_empty() {
                                item_idx += 1;
                            }
                        }
                        AssistantContent::ToolCall(_) => item_idx += 1,
                        _ => {}
                    }
                }
            }

            if assignments.is_empty() {
                return Ok(());
            }

            let tx = c.transaction().map_err(sql_err)?;
            for (item_id, secs) in assignments {
                tx.execute(
                    "INSERT INTO reasoning_durations (conversation_id, item_id, duration_seconds)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(conversation_id, item_id) DO UPDATE SET duration_seconds = ?3",
                    params![cid, item_id, secs as i64],
                )
                .map_err(sql_err)?;
            }
            tx.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn get_compaction_input(
        &self,
        conversation_id: &str,
        recent_token_budget: u64,
    ) -> AppResult<Option<CompactionInput>> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = pool.get().map_err(pool_err)?;
            let latest = latest_compaction(&c, &cid).map_err(sql_err)?;
            let after = latest.as_ref().map(|r| r.upto_seq).unwrap_or(-1);
            let rows = load_after(&c, &cid, after).map_err(sql_err)?;

            if rows.len() < 2 {
                return Ok(None);
            }

            let mut decoded: Vec<(i64, Message)> = Vec::with_capacity(rows.len());
            for row in rows {
                let msg: Message = serde_json::from_str(&row.data)
                    .map_err(|e| AppError::other(format!("message decode failed: {e}")))?;
                decoded.push((row.seq, msg));
            }

            let user_turn_positions: Vec<usize> = decoded
                .iter()
                .enumerate()
                .filter(|(_, (_, m))| is_user_turn(m))
                .map(|(i, _)| i)
                .collect();

            if user_turn_positions.is_empty() {
                return Ok(None);
            }

            let mut chosen_cut = 0usize;
            let mut found_fit = false;

            for &pos in user_turn_positions.iter().rev() {
                let turn_tokens: u64 = decoded[pos..]
                    .iter()
                    .map(|(_, m)| estimate_message_tokens(m))
                    .sum();
                if turn_tokens <= recent_token_budget {
                    chosen_cut = pos;
                    found_fit = true;
                } else {
                    break;
                }
            }

            let cut = if !found_fit || chosen_cut == 0 {
                if user_turn_positions.len() > 1 {
                    *user_turn_positions.last().unwrap()
                } else if decoded.len() >= 4 {
                    decoded.len() / 2
                } else {
                    return Ok(None);
                }
            } else {
                chosen_cut
            };

            if cut == 0 || cut >= decoded.len() {
                return Ok(None);
            }

            let summarize: Vec<Message> = decoded[..cut].iter().map(|(_, m)| m.clone()).collect();
            let summarize_upto_seq = decoded[cut - 1].0;

            let remaining: Vec<Message> = decoded[cut..].iter().map(|(_, m)| m.clone()).collect();

            let (previous_summary, prior_message_count) = match latest {
                Some(record) => (Some(record.summary), record.original_message_count),
                None => (None, 0),
            };

            Ok(Some(CompactionInput {
                previous_summary,
                prior_message_count,
                summarize,
                summarize_upto_seq,
                remaining,
            }))
        })
        .await
    }

    pub async fn apply_compaction(
        &self,
        conversation_id: &str,
        summary: &str,
        original_message_count: usize,
        upto_seq: i64,
        new_context_tokens: u64,
    ) -> AppResult<i64> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        let summary = summary.to_string();
        run_db_task(move || {
            let now = now_ms();
            let mut c = pool.get().map_err(pool_err)?;
            let tx = c.transaction().map_err(sql_err)?;
            tx.execute(
                "INSERT OR REPLACE INTO compactions (conversation_id, upto_seq, summary, original_message_count, ts)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![cid, upto_seq, summary, original_message_count as i64, now],
            )
            .map_err(sql_err)?;
            tx.execute(
                "UPDATE sessions SET updated_at = ?1, last_context_tokens = ?3 WHERE id = ?2",
                params![now, cid, new_context_tokens as i64],
            )
            .map_err(sql_err)?;
            tx.commit().map_err(sql_err)?;
            Ok(now)
        })
        .await
    }

    pub async fn get_session_view_paginated(
        &self,
        conversation_id: &str,
        limit: usize,
        before_seq: Option<i64>,
    ) -> AppResult<SessionViewPage> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let (rows, has_more, compactions, reasoning_durations) = {
                let c = pool.get().map_err(pool_err)?;
                let (rows, has_more) = load_page(&c, &cid, limit, before_seq).map_err(sql_err)?;
                let compactions = list_compactions(&c, &cid).map_err(sql_err)?;

                let mut reasoning_durations: HashMap<String, u64> = HashMap::new();
                {
                    let mut stmt = c
                        .prepare(
                            "SELECT item_id, duration_seconds FROM reasoning_durations WHERE conversation_id = ?1",
                        )
                        .map_err(sql_err)?;
                    let iter = stmt
                        .query_map(params![cid], |row| {
                            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                        })
                        .map_err(sql_err)?;
                    for row in iter {
                        let (item_id, secs) = row.map_err(sql_err)?;
                        reasoning_durations.insert(item_id, secs.max(0) as u64);
                    }
                }
                (rows, has_more, compactions, reasoning_durations)
            };

            let earliest_seq = rows.first().map(|r| r.seq);
            let messages = build_session_views(&cid, &rows, &compactions, &reasoning_durations)?;
            Ok(SessionViewPage {
                messages,
                has_more,
                earliest_seq,
            })
        })
        .await
    }

    pub async fn get_session_view(&self, conversation_id: &str) -> AppResult<Vec<MessageView>> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let (rows, compactions, reasoning_durations) = {
                let c = pool.get().map_err(pool_err)?;
                let rows = load_all(&c, &cid).map_err(sql_err)?;
                let compactions = list_compactions(&c, &cid).map_err(sql_err)?;

                let mut reasoning_durations: HashMap<String, u64> = HashMap::new();
                {
                    let mut stmt = c
                        .prepare(
                            "SELECT item_id, duration_seconds FROM reasoning_durations WHERE conversation_id = ?1",
                        )
                        .map_err(sql_err)?;
                    let iter = stmt
                        .query_map(params![cid], |row| {
                            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                        })
                        .map_err(sql_err)?;
                    for row in iter {
                        let (item_id, secs) = row.map_err(sql_err)?;
                        reasoning_durations.insert(item_id, secs.max(0) as u64);
                    }
                }
                (rows, compactions, reasoning_durations)
            };

            build_session_views(&cid, &rows, &compactions, &reasoning_durations)
        })
        .await
    }
}

fn build_session_views(
    cid: &str,
    rows: &[MessageRow],
    compactions: &[CompactionRecord],
    reasoning_durations: &HashMap<String, u64>,
) -> AppResult<Vec<MessageView>> {
    let mut decoded: Vec<(i64, Message)> = Vec::with_capacity(rows.len());
    for row in rows {
        let msg: Message = serde_json::from_str(&row.data)
            .map_err(|e| AppError::other(format!("message decode failed: {e}")))?;
        decoded.push((row.seq, msg));
    }

    let mut tool_outputs: HashMap<String, (String, bool)> = HashMap::new();
    for (_, msg) in &decoded {
        if let Message::User { content } = msg {
            for part in content.iter() {
                if let UserContent::ToolResult(tr) = part {
                    let output: String = tr
                        .content
                        .iter()
                        .filter_map(|c| match c {
                            ToolResultContent::Text(t) => Some(t.text.as_str()),
                            _ => None,
                        })
                        .collect();
                    tool_outputs.insert(tr.call.to_string(), (output, tr.is_error));
                }
            }
        }
    }

    let mut views: Vec<MessageView> = Vec::new();
    let min_seq = decoded.first().map(|(s, _)| *s).unwrap_or(0);
    let mut pending_compactions = compactions
        .iter()
        .filter(|r| r.upto_seq >= min_seq || decoded.is_empty())
        .peekable();

    for (seq, msg) in &decoded {
        while let Some(record) = pending_compactions.next_if(|r| r.upto_seq < *seq) {
            views.push(compaction_view(cid, record));
        }

        let msg_id = stable_id(cid, *seq, 0, None);
        match msg {
            Message::User { content } => {
                let mut text = String::new();
                let mut attachments: Vec<AttachmentView> = Vec::new();

                for part in content.iter() {
                    match part {
                        UserContent::Text(t) => {
                            if is_payload_part(&t.text) {
                                if let Some(label) = payload_part_label(&t.text) {
                                    attachments.push(AttachmentView {
                                        name: crate::util::basename(&label),
                                        is_image: false,
                                        data_url: None,
                                    });
                                }
                            } else if text.is_empty() {
                                text = t.text.clone();
                            }
                        }
                        UserContent::Image(img) => {
                            let mime = img
                                .media_type
                                .as_ref()
                                .map(|m| m.to_mime_type().to_string())
                                .unwrap_or_else(|| "image/png".to_string());
                            let data_url = match &img.data {
                                DocumentSourceKind::Base64(b64) => {
                                    crate::media::thumbnail_data_url_from_base64(b64, &mime, 320)
                                }
                                DocumentSourceKind::Url(url) => Some(url.clone()),
                                _ => None,
                            };
                            let ext = mime.split('/').nth(1).unwrap_or("png").to_string();
                            attachments.push(AttachmentView {
                                name: format!("image.{ext}"),
                                is_image: true,
                                data_url,
                            });
                        }
                        _ => {}
                    }
                }

                if text.is_empty() && attachments.is_empty() {
                    continue;
                }

                views.push(MessageView {
                    id: msg_id,
                    role: "user".to_string(),
                    items: if text.is_empty() {
                        vec![]
                    } else {
                        vec![MessageItemView::Text {
                            id: stable_id(cid, *seq, 0, Some("text")),
                            text,
                        }]
                    },
                    attachments,
                });
            }
            Message::Assistant(assistant) => {
                let mut items: Vec<MessageItemView> = Vec::new();
                let mut item_idx = 0usize;
                for part in assistant.content.iter() {
                    match part {
                        AssistantContent::Reasoning(r) => {
                            let text = r.text.clone();
                            if text.is_empty() {
                                continue;
                            }
                            let item_id = stable_id(cid, *seq, item_idx, Some("reasoning"));
                            let duration_seconds = reasoning_durations.get(&item_id).copied();
                            items.push(MessageItemView::Reasoning {
                                id: item_id,
                                text,
                                duration_seconds,
                            });
                            item_idx += 1;
                        }
                        AssistantContent::ToolCall(tc) => {
                            let args = serde_json::to_string(&tc.function.arguments).unwrap_or_default();
                            let display_info = parse_display_info(&tc.function.name.to_string(), &args);
                            let raw_entry = tool_outputs.get(&tc.id.to_string());
                            let status = match raw_entry {
                                Some((_, true)) => "error",
                                Some((_, false)) => "done",
                                None => "error",
                            };
                            let raw = raw_entry.map(|(o, _)| o.as_str());
                            items.push(MessageItemView::ToolCall {
                                id: stable_id(cid, *seq, item_idx, Some("tool")),
                                name: tc.function.name.to_string(),
                                args,
                                output: raw.map(|o| {
                                    crate::util::clip_middle(
                                        o,
                                        config::MAX_VIEW_TOOL_OUTPUT_CHARS,
                                    )
                                }),
                                display_info,
                                status: status.to_string(),
                            });
                            item_idx += 1;
                        }
                        AssistantContent::Text(t) => {
                            if t.text.is_empty() {
                                continue;
                            }
                            items.push(MessageItemView::Text {
                                id: stable_id(cid, *seq, item_idx, Some("text")),
                                text: t.text.clone(),
                            });
                            item_idx += 1;
                        }
                        _ => {}
                    }
                }
                if !items.is_empty() {
                    views.push(MessageView {
                        id: msg_id,
                        role: "assistant".to_string(),
                        items,
                        attachments: vec![],
                    });
                }
            }
            _ => {}
        }
    }
    for record in pending_compactions {
        views.push(compaction_view(cid, record));
    }
    Ok(views)
}

fn compaction_view(cid: &str, record: &CompactionRecord) -> MessageView {
    MessageView {
        id: compaction_message_id(cid, record.upto_seq),
        role: "system".to_string(),
        items: vec![MessageItemView::CompactionNotice {
            id: compaction_item_id(cid, record.upto_seq),
            original_message_count: record.original_message_count,
            ts: record.ts,
        }],
        attachments: vec![],
    }
}

impl ConversationMemory for SqliteMemory {
    fn load<'a>(
        &'a self,
        conversation_id: &'a ConversationId,
    ) -> MemoryFuture<'a, Result<Vec<Message>, MemoryError>> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        Box::pin(async move {
            run_db_task(move || {
                let c = pool.get().map_err(pool_err)?;
                let latest = latest_compaction(&c, &cid).map_err(sql_err)?;
                let after = latest.as_ref().map(|r| r.upto_seq).unwrap_or(-1);
                let rows = load_after(&c, &cid, after).map_err(sql_err)?;

                let mut out = Vec::with_capacity(rows.len() + 1);
                if let Some(record) = latest {
                    out.push(Message::user(format!(
                        "[CONTEXT SUMMARY — {} earlier messages summarized]\n\n{}\n\n[The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.]",
                        record.original_message_count, record.summary
                    )));
                }
                for row in &rows {
                    let msg: Message = serde_json::from_str(&row.data)
                        .map_err(|e| AppError::other(format!("deserialize message: {e}")))?;
                    out.push(msg);
                }
                Ok(out)
            })
            .await
            .map_err(|e| MemoryError::Internal(e.to_string()))
        })
    }

    fn append<'a>(
        &'a self,
        conversation_id: &'a ConversationId,
        messages: Vec<Message>,
    ) -> MemoryFuture<'a, Result<(), MemoryError>> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        Box::pin(async move {
            run_db_task(move || {
                let now = now_ms();
                let mut c = pool.get().map_err(pool_err)?;
                let tx = c.transaction().map_err(sql_err)?;

                let start_seq: i64 = tx
                    .query_row(
                        "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE conversation_id = ?1",
                        params![cid],
                        |row| row.get(0),
                    )
                    .map_err(sql_err)?;

                for (i, msg) in messages.iter().enumerate() {
                    let data = serde_json::to_string(msg)
                        .map_err(|e| AppError::other(format!("serialize message: {e}")))?;
                    tx.execute(
                        "INSERT INTO messages (conversation_id, seq, ts, data, kind) VALUES (?1, ?2, ?3, ?4, 'message')",
                        params![cid, start_seq + i as i64, now, data],
                    )
                    .map_err(sql_err)?;
                }

                tx.execute(
                    "INSERT INTO sessions (id, created_at, updated_at) VALUES (?1, ?2, ?2)
                     ON CONFLICT(id) DO UPDATE SET updated_at = ?2",
                    params![cid, now],
                )
                .map_err(sql_err)?;

                tx.commit().map_err(sql_err)?;
                Ok(())
            })
            .await
            .map_err(|e| MemoryError::Internal(e.to_string()))
        })
    }

    fn clear<'a>(&'a self, conversation_id: &'a ConversationId) -> MemoryFuture<'a, Result<(), MemoryError>> {
        let pool = self.pool.clone();
        let cid = conversation_id.to_string();
        Box::pin(async move {
            run_db_task(move || {
                let mut c = pool.get().map_err(pool_err)?;
                let tx = c.transaction().map_err(sql_err)?;
                for table in ["messages", "reasoning_durations", "compactions"] {
                    tx.execute(
                        &format!("DELETE FROM {table} WHERE conversation_id = ?1"),
                        params![cid],
                    )
                    .map_err(sql_err)?;
                }
                tx.execute("DELETE FROM sessions WHERE id = ?1", params![cid])
                    .map_err(sql_err)?;
                tx.commit().map_err(sql_err)?;
                Ok(())
            })
            .await
            .map_err(|e| MemoryError::Internal(e.to_string()))
        })
    }
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

struct MessageRow {
    seq: i64,
    data: String,
}

fn map_message_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageRow> {
    Ok(MessageRow {
        seq: row.get(0)?,
        data: row.get(1)?,
    })
}

fn load_all(conn: &Connection, conversation_id: &str) -> rusqlite::Result<Vec<MessageRow>> {
    load_after(conn, conversation_id, i64::MIN)
}

fn load_after(
    conn: &Connection,
    conversation_id: &str,
    after_seq: i64,
) -> rusqlite::Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT seq, data FROM messages
         WHERE conversation_id = ?1 AND seq > ?2 AND kind = 'message'
         ORDER BY seq ASC",
    )?;
    let rows = stmt.query_map(params![conversation_id, after_seq], map_message_row)?;
    rows.collect()
}

fn load_page(
    conn: &Connection,
    conversation_id: &str,
    limit: usize,
    before_seq: Option<i64>,
) -> rusqlite::Result<(Vec<MessageRow>, bool)> {
    if let Some(before) = before_seq {
        let mut stmt = conn.prepare(
            "SELECT seq, data FROM messages
             WHERE conversation_id = ?1 AND seq < ?2 AND kind = 'message'
             ORDER BY seq DESC LIMIT ?3",
        )?;
        let fetched: Vec<MessageRow> = stmt
            .query_map(params![conversation_id, before, (limit + 1) as i64], map_message_row)?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = fetched.len() > limit;
        let mut rows: Vec<MessageRow> = fetched.into_iter().take(limit).collect();
        rows.reverse();
        Ok((rows, has_more))
    } else {
        let mut stmt = conn.prepare(
            "SELECT seq, data FROM messages
             WHERE conversation_id = ?1 AND kind = 'message'
             ORDER BY seq DESC LIMIT ?2",
        )?;
        let fetched: Vec<MessageRow> = stmt
            .query_map(params![conversation_id, (limit + 1) as i64], map_message_row)?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = fetched.len() > limit;
        let mut rows: Vec<MessageRow> = fetched.into_iter().take(limit).collect();
        rows.reverse();
        Ok((rows, has_more))
    }
}

fn map_compaction_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CompactionRecord> {
    Ok(CompactionRecord {
        upto_seq: row.get(0)?,
        summary: row.get(1)?,
        original_message_count: row.get::<_, i64>(2)?.max(0) as usize,
        ts: row.get(3)?,
    })
}

fn latest_compaction(conn: &Connection, conversation_id: &str) -> rusqlite::Result<Option<CompactionRecord>> {
    conn.query_row(
        "SELECT upto_seq, summary, original_message_count, ts FROM compactions
         WHERE conversation_id = ?1 ORDER BY upto_seq DESC LIMIT 1",
        params![conversation_id],
        map_compaction_row,
    )
    .optional()
}

fn list_compactions(conn: &Connection, conversation_id: &str) -> rusqlite::Result<Vec<CompactionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT upto_seq, summary, original_message_count, ts FROM compactions
         WHERE conversation_id = ?1 ORDER BY upto_seq ASC",
    )?;
    let rows = stmt.query_map(params![conversation_id], map_compaction_row)?;
    rows.collect()
}

pub(crate) fn is_user_turn(msg: &Message) -> bool {
    match msg {
        Message::User { content } => content.iter().any(|c| matches!(c, UserContent::Text(_) | UserContent::Image(_))),
        _ => false,
    }
}

pub fn estimate_message_tokens(message: &Message) -> u64 {
    let mut chars = 0usize;
    match message {
        Message::User { content } => {
            for part in content.iter() {
                match part {
                    UserContent::Text(t) => chars += t.text.len(),
                    UserContent::ToolResult(tr) => {
                        for c in tr.content.iter() {
                            if let ToolResultContent::Text(t) = c {
                                chars += t.text.len();
                            }
                        }
                    }
                    _ => chars += 100,
                }
            }
        }
        Message::Assistant(assistant) => {
            for part in assistant.content.iter() {
                match part {
                    AssistantContent::Text(t) => chars += t.text.len(),
                    AssistantContent::ToolCall(tc) => {
                        chars += tc.function.name.len()
                            + serde_json::to_string(&tc.function.arguments)
                                .map(|s| s.len())
                                .unwrap_or(0);
                    }
                    AssistantContent::Reasoning(r) => chars += r.text.len(),
                    _ => {}
                }
            }
        }
        Message::System { content } => {
            chars += content.len();
        }
    }
    ((chars / 4).max(1)) as u64
}


fn fts5_query(raw: &str, joiner: &str) -> String {
    raw.split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(joiner)
}

fn stable_id(cid: &str, seq: i64, item_idx: usize, kind: Option<&str>) -> String {
    crate::util::stable_hash_hex(&format!("{cid}:{seq}:{item_idx}:{}", kind.unwrap_or("")))
}

pub fn message_id(cid: &str, seq: i64) -> String {
    stable_id(cid, seq, 0, None)
}

pub fn compaction_message_id(cid: &str, seq: i64) -> String {
    stable_id(cid, seq, 0, Some("compaction-message"))
}

pub fn compaction_item_id(cid: &str, seq: i64) -> String {
    stable_id(cid, seq, 0, Some("compaction"))
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
