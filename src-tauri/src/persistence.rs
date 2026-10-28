use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use sqlx::{Executor, Row};

use crate::error::{AppError, AppResult};
use crate::events::ToolDisplayInfo;
use crate::util::now_ms;

const SCHEMA: &str = "
 CREATE TABLE IF NOT EXISTS sessions (
     id                  TEXT PRIMARY KEY,
     title               TEXT,
     workspace_path      TEXT,
     user_id             TEXT,
     created_at          INTEGER NOT NULL,
     updated_at          INTEGER NOT NULL,
     last_context_tokens INTEGER NOT NULL DEFAULT 0,
     last_input_tokens   INTEGER NOT NULL DEFAULT 0,
     last_output_tokens  INTEGER NOT NULL DEFAULT 0,
     last_cached_tokens  INTEGER NOT NULL DEFAULT 0,
     last_reasoning_tokens INTEGER NOT NULL DEFAULT 0
 );
 CREATE INDEX IF NOT EXISTS idx_sessions_workspace_user
     ON sessions(workspace_path, user_id, updated_at DESC);

 CREATE TABLE IF NOT EXISTS reasoning_durations (
     conversation_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     item_id          TEXT NOT NULL,
     duration_seconds INTEGER NOT NULL,
     PRIMARY KEY (conversation_id, item_id)
 );
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
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_tokens: i64,
    pub reasoning_tokens: i64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TurnUsage {
    pub context_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_tokens: u64,
    pub reasoning_tokens: u64,
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

#[derive(Clone)]
pub struct SqliteMemory {
    pub(crate) pool: SqlitePool,
}

impl SqliteMemory {
    pub fn open(path: &Path) -> AppResult<Self> {
        tauri::async_runtime::block_on(Self::open_async(path))
    }

    pub async fn open_async(path: &Path) -> AppResult<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .busy_timeout(std::time::Duration::from_secs(10))
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(POOL_SIZE)
            .connect_with(options)
            .await
            .map_err(sql_err)?;

        pool.execute(SCHEMA).await.map_err(sql_err)?;
        let columns = sqlx::query("PRAGMA table_info(sessions)")
            .fetch_all(&pool)
            .await
            .map_err(sql_err)?
            .into_iter()
            .map(|row| row.get::<String, _>("name"))
            .collect::<std::collections::HashSet<_>>();
        for (column, ddl) in [
            ("last_input_tokens", "INTEGER NOT NULL DEFAULT 0"),
            ("last_output_tokens", "INTEGER NOT NULL DEFAULT 0"),
            ("last_cached_tokens", "INTEGER NOT NULL DEFAULT 0"),
            ("last_reasoning_tokens", "INTEGER NOT NULL DEFAULT 0"),
        ] {
            if !columns.contains(column) {
                pool.execute(format!("ALTER TABLE sessions ADD COLUMN {column} {ddl}").as_str())
                    .await
                    .map_err(sql_err)?;
            }
        }

        Ok(Self { pool })
    }

    pub async fn touch_session(
        &self,
        session_id: &str,
        workspace_path: &str,
        user_id: &str,
    ) -> AppResult<()> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO sessions (id, workspace_path, user_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET
                 workspace_path = COALESCE(sessions.workspace_path, excluded.workspace_path),
                 user_id = COALESCE(sessions.user_id, excluded.user_id),
                 updated_at = excluded.updated_at
             WHERE sessions.user_id = ?3 OR sessions.user_id IS NULL",
        )
        .bind(session_id)
        .bind(workspace_path)
        .bind(user_id)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(sql_err)?;

        Ok(())
    }

    pub async fn record_usage(&self, session_id: &str, usage: &TurnUsage) -> AppResult<()> {
        sqlx::query(
            "UPDATE sessions SET last_context_tokens = ?2, last_input_tokens = ?3,
             last_output_tokens = ?4, last_cached_tokens = ?5, last_reasoning_tokens = ?6,
             updated_at = ?7 WHERE id = ?1",
        )
        .bind(session_id)
        .bind(to_db_token(usage.context_tokens))
        .bind(to_db_token(usage.input_tokens))
        .bind(to_db_token(usage.output_tokens))
        .bind(to_db_token(usage.cached_tokens))
        .bind(to_db_token(usage.reasoning_tokens))
        .bind(now_ms())
        .execute(&self.pool)
        .await
        .map_err(sql_err)?;
        Ok(())
    }

    pub async fn set_context_tokens(&self, session_id: &str, context_tokens: u64) -> AppResult<()> {
        let now = now_ms();
        sqlx::query(
            "UPDATE sessions SET last_context_tokens = ?2, last_input_tokens = 0,
             last_output_tokens = 0, last_cached_tokens = 0, last_reasoning_tokens = 0,
             updated_at = ?3 WHERE id = ?1",
        )
        .bind(session_id)
        .bind(to_db_token(context_tokens))
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(sql_err)?;

        Ok(())
    }

    pub async fn list_sessions_for_workspace(
        &self,
        workspace_path: &str,
        user_id: &str,
    ) -> AppResult<Vec<SessionSummary>> {
        let rows = sqlx::query(
            "SELECT id, title, workspace_path, updated_at, last_context_tokens,
                    last_input_tokens, last_output_tokens, last_cached_tokens,
                    last_reasoning_tokens
             FROM sessions
             WHERE workspace_path = ?1 AND (user_id = ?2 OR user_id IS NULL)
             ORDER BY updated_at DESC",
        )
        .bind(workspace_path)
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(sql_err)?;

        let summaries = rows
            .into_iter()
            .map(|row| SessionSummary {
                id: row.get(0),
                title: row.get(1),
                workspace_path: row.get(2),
                updated_at: row.get(3),
                context_tokens: row.get(4),
                input_tokens: row.get(5),
                output_tokens: row.get(6),
                cached_tokens: row.get(7),
                reasoning_tokens: row.get(8),
            })
            .collect();

        Ok(summaries)
    }

    pub async fn session_ids_for_workspace(&self, workspace_path: &str, user_id: &str) -> AppResult<Vec<String>> {
        let rows = sqlx::query("SELECT id FROM sessions WHERE workspace_path = ?1 AND (user_id = ?2 OR user_id IS NULL)")
            .bind(workspace_path)
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
            .map_err(sql_err)?;

        Ok(rows.into_iter().map(|row| row.get(0)).collect())
    }

    pub async fn delete_session(&self, session_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM sessions WHERE id = ?1")
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(sql_err)?;

        Ok(())
    }

    pub async fn delete_sessions_for_workspace(&self, workspace_path: &str, user_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM sessions WHERE workspace_path = ?1 AND (user_id = ?2 OR user_id IS NULL)")
            .bind(workspace_path)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(sql_err)?;

        Ok(())
    }

    pub async fn set_session_title(&self, conversation_id: &str, title: &str) -> AppResult<bool> {
        let res = sqlx::query(
            "UPDATE sessions SET title = ?2 WHERE id = ?1 AND (title IS NULL OR title = '')",
        )
        .bind(conversation_id)
        .bind(title)
        .execute(&self.pool)
        .await
        .map_err(sql_err)?;

        Ok(res.rows_affected() > 0)
    }

    pub async fn session_has_title(&self, conversation_id: &str) -> AppResult<bool> {
        let row = sqlx::query(
            "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND title IS NOT NULL AND title != ''",
        )
        .bind(conversation_id)
        .fetch_one(&self.pool)
        .await
        .map_err(sql_err)?;

        let count: i64 = row.get(0);
        Ok(count > 0)
    }

    pub async fn session_owner(&self, conversation_id: &str) -> AppResult<Option<String>> {
        let opt_row = sqlx::query("SELECT user_id FROM sessions WHERE id = ?1")
            .bind(conversation_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(sql_err)?;

        Ok(opt_row.and_then(|row| row.get(0)))
    }

    pub async fn session_context_tokens(&self, conversation_id: &str) -> AppResult<u64> {
        let opt_row = sqlx::query("SELECT last_context_tokens FROM sessions WHERE id = ?1")
            .bind(conversation_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(sql_err)?;

        let value: Option<i64> = opt_row.and_then(|row| row.get(0));
        Ok(value.unwrap_or(0).max(0) as u64)
    }

    pub async fn reasoning_durations(&self, conversation_id: &str) -> AppResult<HashMap<String, u64>> {
        let rows = sqlx::query(
            "SELECT item_id, duration_seconds FROM reasoning_durations WHERE conversation_id = ?1",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await
        .map_err(sql_err)?;

        let mut out = HashMap::new();
        for row in rows {
            let item_id: String = row.get(0);
            let secs: i64 = row.get(1);
            out.insert(item_id, secs.max(0) as u64);
        }
        Ok(out)
    }

    pub async fn save_reasoning_durations(
        &self,
        conversation_id: &str,
        durations: Vec<(String, u64)>,
    ) -> AppResult<()> {
        if durations.is_empty() {
            return Ok(());
        }
        let mut builder: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
            "INSERT INTO reasoning_durations (conversation_id, item_id, duration_seconds) ",
        );
        builder.push_values(durations, |mut b, (item_id, secs)| {
            b.push_bind(conversation_id)
                .push_bind(item_id)
                .push_bind(to_db_token(secs));
        });
        builder.push(" ON CONFLICT(conversation_id, item_id) DO UPDATE SET duration_seconds = excluded.duration_seconds");
        builder.build().execute(&self.pool).await.map_err(sql_err)?;
        Ok(())
    }
}

fn to_db_token(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

pub(crate) fn sql_err(e: sqlx::Error) -> AppError {
    sentry::capture_error(&e);
    AppError::other(format!("sqlite error: {e}"))
}
