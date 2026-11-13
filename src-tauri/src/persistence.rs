use std::path::Path;

use async_trait::async_trait;
use orchharness::backend::SessionStore;
use orchharness::error::{AppError, AppResult};
pub use orchharness::persistence::{
    HistoryRecord, SessionRecord, SessionRecordPage, SessionSnapshot, SessionSummary, TurnUsage,
};
use orchharness::util::now_ms;
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use sqlx::{Executor, Row};

const SCHEMA: &str = "
 CREATE TABLE IF NOT EXISTS sessions (
     id                    TEXT PRIMARY KEY,
     title                 TEXT,
     workspace_path        TEXT,
     user_id               TEXT,
     created_at            INTEGER NOT NULL,
     updated_at            INTEGER NOT NULL,
     last_context_tokens   INTEGER NOT NULL DEFAULT 0,
     last_input_tokens     INTEGER NOT NULL DEFAULT 0,
     last_output_tokens    INTEGER NOT NULL DEFAULT 0,
     last_cached_tokens    INTEGER NOT NULL DEFAULT 0,
     last_reasoning_tokens INTEGER NOT NULL DEFAULT 0
 );
 CREATE INDEX IF NOT EXISTS idx_sessions_workspace_user
     ON sessions(workspace_path, user_id, updated_at DESC);

 CREATE TABLE IF NOT EXISTS session_state (
     session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
     snapshot   TEXT NOT NULL
 );

 CREATE TABLE IF NOT EXISTS session_entries (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     seq        INTEGER NOT NULL,
     record     TEXT NOT NULL,
     PRIMARY KEY (session_id, seq)
 );

 DROP TABLE IF EXISTS reasoning_durations;
 DROP TABLE IF EXISTS work_runs;
";

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
                running: false,
            })
            .collect();

        Ok(summaries)
    }

    pub async fn delete_session(&self, session_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM sessions WHERE id = ?1")
            .bind(session_id)
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

    pub async fn session_meta(&self, conversation_id: &str) -> AppResult<Option<Option<String>>> {
        let opt_row = sqlx::query("SELECT user_id FROM sessions WHERE id = ?1")
            .bind(conversation_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(sql_err)?;

        Ok(opt_row.map(|row| row.get(0)))
    }
}

#[async_trait]
impl SessionStore for SqliteMemory {
    async fn load_snapshot(&self, session_id: &str) -> AppResult<SessionSnapshot> {
        let row = sqlx::query("SELECT snapshot FROM session_state WHERE session_id = ?1")
            .bind(session_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(sql_err)?;

        let Some(row) = row else {
            return Ok(SessionSnapshot::default());
        };
        let raw: String = row.get(0);
        serde_json::from_str(&raw)
            .map_err(|e| AppError::other(format!("invalid session snapshot: {e}")))
    }

    async fn save_snapshot(&self, session_id: &str, snapshot: &SessionSnapshot) -> AppResult<()> {
        let json = serde_json::to_string(snapshot)
            .map_err(|e| AppError::other(format!("serialize session snapshot: {e}")))?;
        let now = now_ms();
        let mut tx = self.pool.begin().await.map_err(sql_err)?;
        sqlx::query(
            "INSERT INTO session_state (session_id, snapshot)
             VALUES (?1, ?2)
             ON CONFLICT(session_id) DO UPDATE SET snapshot = excluded.snapshot",
        )
        .bind(session_id)
        .bind(json)
        .execute(&mut *tx)
        .await
        .map_err(sql_err)?;
        sqlx::query("UPDATE sessions SET updated_at = ?2 WHERE id = ?1")
            .bind(session_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(sql_err)?;
        tx.commit().await.map_err(sql_err)?;
        Ok(())
    }

    async fn append_history(&self, session_id: &str, records: &[HistoryRecord]) -> AppResult<()> {
        if records.is_empty() {
            return Ok(());
        }
        let now = now_ms();
        let mut tx = self.pool.begin().await.map_err(sql_err)?;
        let row = sqlx::query(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_entries WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(sql_err)?;
        let start_seq: i64 = row.get(0);

        for (offset, record) in records.iter().enumerate() {
            let seq = start_seq + offset as i64;
            let raw = serde_json::to_string(record)
                .map_err(|e| AppError::other(format!("serialize history record: {e}")))?;
            sqlx::query(
                "INSERT INTO session_entries (session_id, seq, record) VALUES (?1, ?2, ?3)",
            )
            .bind(session_id)
            .bind(seq)
            .bind(raw)
            .execute(&mut *tx)
            .await
            .map_err(sql_err)?;
        }

        sqlx::query("UPDATE sessions SET updated_at = ?2 WHERE id = ?1")
            .bind(session_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(sql_err)?;
        tx.commit().await.map_err(sql_err)?;
        Ok(())
    }

    async fn get_history(
        &self,
        session_id: &str,
        limit: usize,
        before_seq: Option<i64>,
    ) -> AppResult<SessionRecordPage> {
        let capped = limit.clamp(1, 200);
        let fetch_limit = (capped + 1) as i64;
        let mut rows = if let Some(before) = before_seq {
            sqlx::query(
                "SELECT seq, record FROM session_entries
                 WHERE session_id = ?1 AND seq < ?2
                 ORDER BY seq DESC LIMIT ?3",
            )
            .bind(session_id)
            .bind(before)
            .bind(fetch_limit)
            .fetch_all(&self.pool)
            .await
            .map_err(sql_err)?
        } else {
            sqlx::query(
                "SELECT seq, record FROM session_entries
                 WHERE session_id = ?1
                 ORDER BY seq DESC LIMIT ?2",
            )
            .bind(session_id)
            .bind(fetch_limit)
            .fetch_all(&self.pool)
            .await
            .map_err(sql_err)?
        };

        let has_more = rows.len() > capped;
        if has_more {
            rows.truncate(capped);
        }
        rows.reverse();

        let mut records = Vec::with_capacity(rows.len());
        for row in rows {
            let seq: i64 = row.get(0);
            let raw: String = row.get(1);
            let record: HistoryRecord = serde_json::from_str(&raw)
                .map_err(|e| AppError::other(format!("invalid history record: {e}")))?;
            records.push(SessionRecord { seq, record });
        }
        let earliest_seq = records.first().map(|entry| entry.seq);

        Ok(SessionRecordPage {
            records,
            has_more,
            earliest_seq,
        })
    }

    async fn set_context_tokens(&self, session_id: &str, context_tokens: u64) -> AppResult<()> {
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

    async fn record_usage(&self, session_id: &str, usage: &TurnUsage) -> AppResult<()> {
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
}

fn to_db_token(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

pub(crate) fn sql_err(e: sqlx::Error) -> AppError {
    sentry::capture_error(&e);
    AppError::other(format!("sqlite error: {e}"))
}
