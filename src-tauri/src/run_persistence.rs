use std::future::Future;
use std::pin::Pin;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use rig::completion::Message;
use rig::memory::{ConversationMemory, MemoryError};

use crate::error::{AppError, AppResult};
use crate::persistence::SqliteMemory;
use crate::util::now_ms;

pub const DURABLE_RUN_SCHEMA: &str = r#"
ALTER TABLE messages ADD COLUMN run_id TEXT;
ALTER TABLE messages ADD COLUMN run_message_seq INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_run_sequence
    ON messages(run_id, run_message_seq)
    WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_runs (
    run_id                  TEXT PRIMARY KEY,
    conversation_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    model                    TEXT NOT NULL,
    raw_prompt               TEXT NOT NULL,
    user_message             TEXT,
    status                   TEXT NOT NULL DEFAULT 'running',
    commit_kind              TEXT,
    terminal_error           TEXT,
    prior_input_tokens       INTEGER NOT NULL DEFAULT 0,
    prior_output_tokens      INTEGER NOT NULL DEFAULT 0,
    prior_total_tokens       INTEGER NOT NULL DEFAULT 0,
    usage_input_tokens       INTEGER NOT NULL DEFAULT 0,
    usage_output_tokens      INTEGER NOT NULL DEFAULT 0,
    usage_total_tokens       INTEGER NOT NULL DEFAULT 0,
    last_turn_input_tokens   INTEGER NOT NULL DEFAULT 0,
    usage_complete           INTEGER NOT NULL DEFAULT 0,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_runs_conversation
    ON chat_runs(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_runs_recovery
    ON chat_runs(status, commit_kind);

CREATE TABLE IF NOT EXISTS chat_run_events (
    run_id       TEXT NOT NULL REFERENCES chat_runs(run_id) ON DELETE CASCADE,
    event_seq    INTEGER NOT NULL,
    kind         TEXT NOT NULL,
    payload      TEXT NOT NULL,
    ts           INTEGER NOT NULL,
    PRIMARY KEY (run_id, event_seq)
);

CREATE TABLE IF NOT EXISTS chat_run_usage (
    run_id         TEXT NOT NULL REFERENCES chat_runs(run_id) ON DELETE CASCADE,
    call_index     INTEGER NOT NULL,
    input_tokens   INTEGER NOT NULL,
    output_tokens  INTEGER NOT NULL,
    total_tokens   INTEGER NOT NULL,
    PRIMARY KEY (run_id, call_index)
);
"#;

#[derive(Debug, Clone, Copy)]
pub struct RunTokenBaseline {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct DurableRunUsage {
    pub cumulative_input_tokens: u64,
    pub cumulative_output_tokens: u64,
    pub cumulative_total_tokens: u64,
    pub last_turn_input_tokens: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunCommitKind {
    Canonical,
    Fallback,
}

#[derive(Clone)]
pub struct RunScopedMemory {
    inner: SqliteMemory,
    run_id: String,
}

type MemoryFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

impl SqliteMemory {
    pub fn scoped_to_run(&self, run_id: &str) -> RunScopedMemory {
        RunScopedMemory {
            inner: self.clone(),
            run_id: run_id.to_string(),
        }
    }

    pub async fn begin_chat_run(
        &self,
        run_id: &str,
        conversation_id: &str,
        model: &str,
        raw_prompt: &str,
        initial_user_message: &Message,
        workspace_path: Option<&str>,
    ) -> AppResult<RunTokenBaseline> {
        let pool = self.pool.clone();
        let run_id = run_id.to_string();
        let conversation_id = conversation_id.to_string();
        let model = model.to_string();
        let raw_prompt = raw_prompt.to_string();
        let workspace_path = workspace_path.map(str::to_string);
        let user_message = serde_json::to_string(initial_user_message)
            .map_err(|error| AppError::other(format!("serialize durable user message: {error}")))?;

        run_db_task(move || {
            let mut connection = pool.get().map_err(pool_err)?;
            let transaction = connection.transaction().map_err(sql_err)?;
            let now = now_ms();

            transaction
                .execute(
                    "INSERT INTO sessions (id, workspace_path, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?3)
                     ON CONFLICT(id) DO UPDATE SET workspace_path = ?2, updated_at = ?3",
                    params![conversation_id, workspace_path, now],
                )
                .map_err(sql_err)?;

            let (prior_input, prior_output, prior_total): (i64, i64, i64) = transaction
                .query_row(
                    "SELECT total_input_tokens, total_output_tokens, total_tokens
                     FROM sessions WHERE id = ?1",
                    params![conversation_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(sql_err)?;

            transaction
                .execute(
                    "INSERT INTO chat_runs (
                         run_id, conversation_id, model, raw_prompt, user_message,
                         status, prior_input_tokens, prior_output_tokens,
                         prior_total_tokens, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7, ?8, ?9, ?9)",
                    params![
                        run_id,
                        conversation_id,
                        model,
                        raw_prompt,
                        user_message,
                        prior_input,
                        prior_output,
                        prior_total,
                        now
                    ],
                )
                .map_err(sql_err)?;

            transaction.commit().map_err(sql_err)?;
            Ok(RunTokenBaseline {
                input_tokens: from_db_token(prior_input),
                output_tokens: from_db_token(prior_output),
                total_tokens: from_db_token(prior_total),
            })
        })
        .await
    }

    pub async fn update_chat_run_user_message(
        &self,
        run_id: &str,
        user_message: &Message,
    ) -> AppResult<()> {
        let pool = self.pool.clone();
        let run_id = run_id.to_string();
        let user_message = serde_json::to_string(user_message)
            .map_err(|error| AppError::other(format!("serialize durable user message: {error}")))?;
        run_db_task(move || {
            let connection = pool.get().map_err(pool_err)?;
            let changed = connection
                .execute(
                    "UPDATE chat_runs
                     SET user_message = ?1, updated_at = ?2
                     WHERE run_id = ?3 AND commit_kind IS NULL",
                    params![user_message, now_ms(), run_id],
                )
                .map_err(sql_err)?;
            if changed != 1 {
                return Err(AppError::other("chat run is missing or already finalized"));
            }
            Ok(())
        })
        .await
    }

    pub async fn append_chat_run_event(
        &self,
        run_id: &str,
        event_seq: u64,
        kind: &str,
        payload: &str,
    ) -> AppResult<()> {
        let pool = self.pool.clone();
        let run_id = run_id.to_string();
        let kind = kind.to_string();
        let payload = payload.to_string();
        run_db_task(move || {
            let mut connection = pool.get().map_err(pool_err)?;
            let transaction = connection.transaction().map_err(sql_err)?;
            let active: bool = transaction
                .query_row(
                    "SELECT commit_kind IS NULL FROM chat_runs WHERE run_id = ?1",
                    params![run_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(sql_err)?
                .unwrap_or(false);
            if !active {
                return Err(AppError::other("chat run is missing or already finalized"));
            }
            let now = now_ms();
            transaction
                .execute(
                    "INSERT INTO chat_run_events (run_id, event_seq, kind, payload, ts)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(run_id, event_seq) DO UPDATE SET
                         kind = excluded.kind, payload = excluded.payload, ts = excluded.ts",
                    params![run_id, to_db_token(event_seq), kind, payload, now],
                )
                .map_err(sql_err)?;
            transaction
                .execute(
                    "UPDATE chat_runs SET updated_at = ?1 WHERE run_id = ?2",
                    params![now, run_id],
                )
                .map_err(sql_err)?;
            transaction.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    pub async fn record_chat_run_completion_usage(
        &self,
        run_id: &str,
        call_index: usize,
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
    ) -> AppResult<DurableRunUsage> {
        let pool = self.pool.clone();
        let run_id = run_id.to_string();
        run_db_task(move || {
            let mut connection = pool.get().map_err(pool_err)?;
            let transaction = connection.transaction().map_err(sql_err)?;
            let total_tokens = normalized_total(input_tokens, output_tokens, total_tokens);

            transaction
                .execute(
                    "INSERT INTO chat_run_usage
                         (run_id, call_index, input_tokens, output_tokens, total_tokens)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(run_id, call_index) DO UPDATE SET
                         input_tokens = excluded.input_tokens,
                         output_tokens = excluded.output_tokens,
                         total_tokens = excluded.total_tokens",
                    params![
                        run_id,
                        call_index as i64,
                        to_db_token(input_tokens),
                        to_db_token(output_tokens),
                        to_db_token(total_tokens)
                    ],
                )
                .map_err(sql_err)?;

            let (run_input, run_output, run_total): (i64, i64, i64) = transaction
                .query_row(
                    "SELECT COALESCE(SUM(input_tokens), 0),
                            COALESCE(SUM(output_tokens), 0),
                            COALESCE(SUM(total_tokens), 0)
                     FROM chat_run_usage WHERE run_id = ?1",
                    params![run_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(sql_err)?;
            let last_turn_input: i64 = transaction
                .query_row(
                    "SELECT input_tokens FROM chat_run_usage
                     WHERE run_id = ?1 ORDER BY call_index DESC LIMIT 1",
                    params![run_id],
                    |row| row.get(0),
                )
                .map_err(sql_err)?;

            let usage = update_run_and_session_usage(
                &transaction,
                &run_id,
                run_input,
                run_output,
                run_total,
                last_turn_input,
                false,
            )?;
            transaction.commit().map_err(sql_err)?;
            Ok(usage)
        })
        .await
    }

    pub async fn reconcile_chat_run_usage(
        &self,
        run_id: &str,
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
        last_turn_input_tokens: u64,
    ) -> AppResult<DurableRunUsage> {
        let pool = self.pool.clone();
        let run_id = run_id.to_string();
        run_db_task(move || {
            let mut connection = pool.get().map_err(pool_err)?;
            let transaction = connection.transaction().map_err(sql_err)?;
            let (stored_input, stored_output, stored_total, stored_last): (i64, i64, i64, i64) =
                transaction
                    .query_row(
                        "SELECT usage_input_tokens, usage_output_tokens,
                                usage_total_tokens, last_turn_input_tokens
                         FROM chat_runs WHERE run_id = ?1",
                        params![run_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                    )
                    .map_err(sql_err)?;

            let provider_reported = input_tokens != 0 || output_tokens != 0 || total_tokens != 0;
            let (run_input, run_output, run_total) = if provider_reported {
                (
                    to_db_token(input_tokens),
                    to_db_token(output_tokens),
                    to_db_token(normalized_total(input_tokens, output_tokens, total_tokens)),
                )
            } else {
                (stored_input, stored_output, stored_total)
            };
            let last_turn_input = if last_turn_input_tokens == 0 {
                stored_last
            } else {
                to_db_token(last_turn_input_tokens)
            };

            let usage = update_run_and_session_usage(
                &transaction,
                &run_id,
                run_input,
                run_output,
                run_total,
                last_turn_input,
                true,
            )?;
            transaction.commit().map_err(sql_err)?;
            Ok(usage)
        })
        .await
    }

    pub async fn finalize_chat_run(
        &self,
        run_id: &str,
        status: &str,
        terminal_error: Option<&str>,
    ) -> AppResult<RunCommitKind> {
        let pool = self.pool.clone();
        let run_id = run_id.to_string();
        let status = status.to_string();
        let terminal_error = terminal_error.map(str::to_string);
        run_db_task(move || {
            let mut connection = pool.get().map_err(pool_err)?;
            finalize_chat_run_sync(
                &mut connection,
                &run_id,
                &status,
                terminal_error.as_deref(),
            )
        })
        .await
    }

    async fn commit_canonical_run_messages(
        &self,
        run_id: &str,
        conversation_id: &str,
        messages: Vec<Message>,
    ) -> AppResult<()> {
        let pool = self.pool.clone();
        let run_id = run_id.to_string();
        let conversation_id = conversation_id.to_string();
        run_db_task(move || {
            let mut connection = pool.get().map_err(pool_err)?;
            let transaction = connection.transaction().map_err(sql_err)?;
            let stored: Option<(String, Option<String>)> = transaction
                .query_row(
                    "SELECT conversation_id, commit_kind FROM chat_runs WHERE run_id = ?1",
                    params![run_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(sql_err)?;
            let Some((stored_conversation, commit_kind)) = stored else {
                return Err(AppError::other("durable chat run not found"));
            };
            if stored_conversation != conversation_id {
                return Err(AppError::other("chat run conversation mismatch"));
            }
            if commit_kind.is_some() {
                transaction.commit().map_err(sql_err)?;
                return Ok(());
            }

            insert_run_messages(
                &transaction,
                &conversation_id,
                &run_id,
                &messages,
            )?;
            let now = now_ms();
            transaction
                .execute(
                    "UPDATE chat_runs SET
                         status = 'committed', commit_kind = 'canonical',
                         terminal_error = NULL, user_message = NULL, updated_at = ?1
                     WHERE run_id = ?2",
                    params![now, run_id],
                )
                .map_err(sql_err)?;
            transaction
                .execute("DELETE FROM chat_run_events WHERE run_id = ?1", params![run_id])
                .map_err(sql_err)?;
            transaction
                .execute(
                    "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
                    params![now, conversation_id],
                )
                .map_err(sql_err)?;
            transaction.commit().map_err(sql_err)?;
            Ok(())
        })
        .await
    }
}

impl ConversationMemory for RunScopedMemory {
    fn load<'a>(
        &'a self,
        conversation_id: &'a str,
    ) -> MemoryFuture<'a, Result<Vec<Message>, MemoryError>> {
        <SqliteMemory as ConversationMemory>::load(&self.inner, conversation_id)
    }

    fn append<'a>(
        &'a self,
        conversation_id: &'a str,
        messages: Vec<Message>,
    ) -> MemoryFuture<'a, Result<(), MemoryError>> {
        let memory = self.inner.clone();
        let run_id = self.run_id.clone();
        let conversation_id = conversation_id.to_string();
        Box::pin(async move {
            memory
                .commit_canonical_run_messages(&run_id, &conversation_id, messages)
                .await
                .map_err(|error| {
                    MemoryError::backend(std::io::Error::other(format!(
                        "durable canonical commit failed: {error}"
                    )))
                })
        })
    }

    fn clear<'a>(
        &'a self,
        conversation_id: &'a str,
    ) -> MemoryFuture<'a, Result<(), MemoryError>> {
        <SqliteMemory as ConversationMemory>::clear(&self.inner, conversation_id)
    }
}

pub(crate) fn recover_interrupted_runs(connection: &mut Connection) -> AppResult<()> {
    let run_ids: Vec<String> = {
        let mut statement = connection
            .prepare(
                "SELECT run_id FROM chat_runs
                 WHERE commit_kind IS NULL AND status IN ('starting', 'running')
                 ORDER BY created_at ASC",
            )
            .map_err(sql_err)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sql_err)?;
        let mut run_ids = Vec::new();
        for row in rows {
            run_ids.push(row.map_err(sql_err)?);
        }
        run_ids
    };

    for run_id in run_ids {
        finalize_chat_run_sync(
            connection,
            &run_id,
            "interrupted",
            Some("the application stopped before the agent run finished"),
        )?;
    }
    Ok(())
}

fn finalize_chat_run_sync(
    connection: &mut Connection,
    run_id: &str,
    status: &str,
    terminal_error: Option<&str>,
) -> AppResult<RunCommitKind> {
    let transaction = connection.transaction().map_err(sql_err)?;
    let stored: Option<(String, String, Option<String>, Option<String>)> = transaction
        .query_row(
            "SELECT conversation_id, raw_prompt, user_message, commit_kind
             FROM chat_runs WHERE run_id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(sql_err)?;
    let Some((conversation_id, raw_prompt, user_message, commit_kind)) = stored else {
        return Err(AppError::other("durable chat run not found"));
    };

    if let Some(commit_kind) = commit_kind {
        let kind = match commit_kind.as_str() {
            "canonical" => RunCommitKind::Canonical,
            "fallback" => RunCommitKind::Fallback,
            other => {
                return Err(AppError::other(format!(
                    "unknown chat run commit kind: {other}"
                )))
            }
        };
        if kind == RunCommitKind::Canonical {
            transaction
                .execute(
                    "UPDATE chat_runs SET status = 'completed', terminal_error = NULL,
                         usage_complete = 1, updated_at = ?1 WHERE run_id = ?2",
                    params![now_ms(), run_id],
                )
                .map_err(sql_err)?;
        }
        transaction.commit().map_err(sql_err)?;
        return Ok(kind);
    }

    let events: Vec<(String, String)> = {
        let mut statement = transaction
            .prepare(
                "SELECT kind, payload FROM chat_run_events
                 WHERE run_id = ?1 ORDER BY event_seq ASC",
            )
            .map_err(sql_err)?;
        let rows = statement
            .query_map(params![run_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(sql_err)?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row.map_err(sql_err)?);
        }
        events
    };

    let user_message = user_message
        .as_deref()
        .and_then(|encoded| serde_json::from_str::<Message>(encoded).ok())
        .unwrap_or_else(|| Message::user(raw_prompt));
    let partial_response = render_run_events(&events);
    let assistant_message = Message::assistant(fallback_assistant_text(
        &partial_response,
        status,
        terminal_error,
    ));
    insert_run_messages(
        &transaction,
        &conversation_id,
        run_id,
        &[user_message, assistant_message],
    )?;

    let now = now_ms();
    transaction
        .execute(
            "UPDATE chat_runs SET
                 status = ?1, commit_kind = 'fallback', terminal_error = ?2,
                 user_message = NULL, updated_at = ?3
             WHERE run_id = ?4",
            params![status, terminal_error, now, run_id],
        )
        .map_err(sql_err)?;
    transaction
        .execute("DELETE FROM chat_run_events WHERE run_id = ?1", params![run_id])
        .map_err(sql_err)?;
    transaction
        .execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )
        .map_err(sql_err)?;
    transaction.commit().map_err(sql_err)?;
    Ok(RunCommitKind::Fallback)
}

fn insert_run_messages(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    run_id: &str,
    messages: &[Message],
) -> AppResult<()> {
    let start_seq: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(sql_err)?;
    let now = now_ms();
    for (index, message) in messages.iter().enumerate() {
        let data = serde_json::to_string(message)
            .map_err(|error| AppError::other(format!("serialize run message: {error}")))?;
        transaction
            .execute(
                "INSERT INTO messages
                     (conversation_id, seq, ts, data, kind, run_id, run_message_seq)
                 VALUES (?1, ?2, ?3, ?4, 'message', ?5, ?6)",
                params![
                    conversation_id,
                    start_seq + index as i64,
                    now,
                    data,
                    run_id,
                    index as i64
                ],
            )
            .map_err(sql_err)?;
    }
    Ok(())
}

fn update_run_and_session_usage(
    transaction: &Transaction<'_>,
    run_id: &str,
    run_input: i64,
    run_output: i64,
    run_total: i64,
    last_turn_input: i64,
    complete: bool,
) -> AppResult<DurableRunUsage> {
    let (conversation_id, prior_input, prior_output, prior_total): (String, i64, i64, i64) =
        transaction
            .query_row(
                "SELECT conversation_id, prior_input_tokens, prior_output_tokens,
                        prior_total_tokens
                 FROM chat_runs WHERE run_id = ?1",
                params![run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(sql_err)?;

    let cumulative_input = prior_input.saturating_add(run_input).max(0);
    let cumulative_output = prior_output.saturating_add(run_output).max(0);
    let cumulative_total = prior_total.saturating_add(run_total).max(0);
    let now = now_ms();
    transaction
        .execute(
            "UPDATE chat_runs SET
                 usage_input_tokens = ?1, usage_output_tokens = ?2,
                 usage_total_tokens = ?3, last_turn_input_tokens = ?4,
                 usage_complete = ?5, updated_at = ?6
             WHERE run_id = ?7",
            params![
                run_input.max(0),
                run_output.max(0),
                run_total.max(0),
                last_turn_input.max(0),
                i64::from(complete),
                now,
                run_id
            ],
        )
        .map_err(sql_err)?;
    transaction
        .execute(
            "UPDATE sessions SET total_input_tokens = ?1, total_output_tokens = ?2,
                 total_tokens = ?3, updated_at = ?4 WHERE id = ?5",
            params![
                cumulative_input,
                cumulative_output,
                cumulative_total,
                now,
                conversation_id
            ],
        )
        .map_err(sql_err)?;

    Ok(DurableRunUsage {
        cumulative_input_tokens: from_db_token(cumulative_input),
        cumulative_output_tokens: from_db_token(cumulative_output),
        cumulative_total_tokens: from_db_token(cumulative_total),
        last_turn_input_tokens: from_db_token(last_turn_input),
    })
}

fn render_run_events(events: &[(String, String)]) -> String {
    let mut output = String::new();
    let mut in_reasoning = false;

    for (kind, payload) in events {
        match kind.as_str() {
            "text" => {
                close_reasoning_section(&mut output, &mut in_reasoning);
                output.push_str(payload);
            }
            "reasoning" => {
                if !in_reasoning {
                    ensure_paragraph_break(&mut output);
                    output.push_str("[Reasoning]\n");
                    in_reasoning = true;
                }
                output.push_str(payload);
            }
            "reasoning_done" => close_reasoning_section(&mut output, &mut in_reasoning),
            "tool_call" => {
                close_reasoning_section(&mut output, &mut in_reasoning);
                ensure_paragraph_break(&mut output);
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                    let name = value.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let args = value.get("args").and_then(|v| v.as_str()).unwrap_or("{}");
                    output.push_str(&format!("[Tool call: {name}]\nArguments: {args}"));
                } else {
                    output.push_str("[Tool call]\n");
                    output.push_str(payload);
                }
            }
            "tool_execution" => {
                close_reasoning_section(&mut output, &mut in_reasoning);
                ensure_paragraph_break(&mut output);
                output.push_str("[Tool execution committed]\n");
                output.push_str(payload);
            }
            "tool_result" => {
                close_reasoning_section(&mut output, &mut in_reasoning);
                ensure_paragraph_break(&mut output);
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                    let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let result = value.get("output").and_then(|v| v.as_str()).unwrap_or("");
                    let label = if value.get("isError").and_then(|v| v.as_bool()).unwrap_or(false) {
                        "Tool error"
                    } else {
                        "Tool result"
                    };
                    output.push_str(&format!("[{label}: {id}]\n{result}"));
                } else {
                    output.push_str("[Tool result]\n");
                    output.push_str(payload);
                }
            }
            "model_turn_retried" => {
                close_reasoning_section(&mut output, &mut in_reasoning);
                ensure_paragraph_break(&mut output);
                output.push_str("[The preceding provisional model turn was rejected and retried.] ");
                output.push_str(payload);
            }
            _ => {}
        }
    }
    close_reasoning_section(&mut output, &mut in_reasoning);
    output
}

fn fallback_assistant_text(partial: &str, status: &str, detail: Option<&str>) -> String {
    let explanation = match (status, detail.filter(|value| !value.trim().is_empty())) {
        ("cancelled", Some(detail)) => format!("Agent run cancelled before completion: {detail}"),
        ("cancelled", None) => "Agent run cancelled before completion.".to_string(),
        ("interrupted", Some(detail)) => format!("Agent run interrupted: {detail}"),
        ("interrupted", None) => "Agent run interrupted before completion.".to_string(),
        ("completed", _) => {
            "Agent output ended before its canonical transcript commit was observed.".to_string()
        }
        (_, Some(detail)) => format!("Agent run failed before completion: {detail}"),
        _ => "Agent run failed before completion.".to_string(),
    };

    if partial.trim().is_empty() {
        format!("[{explanation}]")
    } else {
        format!("{}\n\n[{explanation}]", partial.trim_end())
    }
}

fn close_reasoning_section(output: &mut String, in_reasoning: &mut bool) {
    if *in_reasoning {
        if !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str("[End reasoning]");
        *in_reasoning = false;
    }
}

fn ensure_paragraph_break(output: &mut String) {
    if output.is_empty() {
        return;
    }
    if output.ends_with("\n\n") {
        return;
    }
    if output.ends_with('\n') {
        output.push('\n');
    } else {
        output.push_str("\n\n");
    }
}

fn normalized_total(input_tokens: u64, output_tokens: u64, total_tokens: u64) -> u64 {
    if total_tokens == 0 && (input_tokens != 0 || output_tokens != 0) {
        input_tokens.saturating_add(output_tokens)
    } else {
        total_tokens
    }
}

fn to_db_token(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn from_db_token(value: i64) -> u64 {
    value.max(0) as u64
}

async fn run_db_task<T, F>(task: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| AppError::other(format!("db task failed: {error}")))?
}

fn sql_err(error: rusqlite::Error) -> AppError {
    AppError::other(format!("sqlite error: {error}"))
}

fn pool_err(error: r2d2::Error) -> AppError {
    AppError::other(format!("db pool error: {error}"))
}
