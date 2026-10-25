use std::collections::HashMap;
use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

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
     conversation_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     item_id          TEXT NOT NULL,
     duration_seconds INTEGER NOT NULL,
     PRIMARY KEY (conversation_id, item_id)
 );
";

const REASONING_DURATIONS_FK_MIGRATION: &str = "
 CREATE TABLE reasoning_durations_v2 (
     conversation_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     item_id          TEXT NOT NULL,
     duration_seconds INTEGER NOT NULL,
     PRIMARY KEY (conversation_id, item_id)
 );
 INSERT INTO reasoning_durations_v2 (conversation_id, item_id, duration_seconds)
     SELECT conversation_id, item_id, duration_seconds
     FROM reasoning_durations
     WHERE conversation_id IN (SELECT id FROM sessions);
 DROP TABLE reasoning_durations;
 ALTER TABLE reasoning_durations_v2 RENAME TO reasoning_durations;
";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionViewPage {
    pub messages: Vec<MessageView>,
    pub has_more: bool,
    pub earliest_message_id: Option<i64>,
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
    pub path: Option<String>,
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
            rusqlite_migration::M::up(REASONING_DURATIONS_FK_MIGRATION),
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
