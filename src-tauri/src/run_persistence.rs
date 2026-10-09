use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use rig::completion::Message;
use rig::memory::{ConversationMemory, MemoryError};
use rig::message::{AssistantContent, ToolResultContent, UserContent};
use rig::OneOrMany;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::error::{AppError, AppResult};
use crate::persistence::SqliteMemory;
use crate::tools::TOOL_ERROR_SENTINEL;
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

pub struct BeginRun<'a> {
    pub run_id: &'a str,
    pub conversation_id: &'a str,
    pub model: &'a str,
    pub raw_prompt: &'a str,
    pub initial_user_message: &'a Message,
    pub workspace_path: &'a str,
    pub user_id: &'a str,
}

impl SqliteMemory {
    pub fn scoped_to_run(&self, run_id: &str) -> RunScopedMemory {
        RunScopedMemory {
            inner: self.clone(),
            run_id: run_id.to_string(),
        }
    }

    pub async fn begin_chat_run(&self, begin: BeginRun<'_>) -> AppResult<RunTokenBaseline> {
        let pool = self.pool.clone();
        let run_id = begin.run_id.to_string();
        let conversation_id = begin.conversation_id.to_string();
        let model = begin.model.to_string();
        let raw_prompt = begin.raw_prompt.to_string();
        let workspace_path = begin.workspace_path.to_string();
        let user_id = begin.user_id.to_string();
        let user_message = serde_json::to_string(begin.initial_user_message)
            .map_err(|error| AppError::other(format!("serialize durable user message: {error}")))?;

        run_db_task(move || {
            let mut connection = pool.get().map_err(pool_err)?;
            let transaction = connection.transaction().map_err(sql_err)?;
            let now = now_ms();

            transaction
                .execute(
                    "INSERT INTO sessions (id, workspace_path, user_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?4)
                     ON CONFLICT(id) DO UPDATE SET
                         workspace_path = COALESCE(sessions.workspace_path, excluded.workspace_path),
                         user_id = COALESCE(sessions.user_id, excluded.user_id),
                         updated_at = excluded.updated_at",
                    params![conversation_id, workspace_path, user_id, now],
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
            let connection = pool.get().map_err(pool_err)?;
            let now = now_ms();
            let inserted = connection
                .execute(
                    "INSERT INTO chat_run_events (run_id, event_seq, kind, payload, ts)
                     SELECT ?1, ?2, ?3, ?4, ?5
                     WHERE EXISTS (SELECT 1 FROM chat_runs WHERE run_id = ?1 AND commit_kind IS NULL)
                     ON CONFLICT(run_id, event_seq) DO UPDATE SET
                         kind = excluded.kind, payload = excluded.payload, ts = excluded.ts",
                    params![run_id, to_db_token(event_seq), kind, payload, now],
                )
                .map_err(sql_err)?;
            if inserted == 0 {
                return Err(AppError::other("chat run is missing or already finalized"));
            }
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
            let stored_last: i64 = transaction
                .query_row(
                    "SELECT last_turn_input_tokens FROM chat_runs WHERE run_id = ?1",
                    params![run_id],
                    |row| row.get(0),
                )
                .map_err(sql_err)?;

            let last_turn_input = if last_turn_input_tokens == 0 {
                stored_last
            } else {
                to_db_token(last_turn_input_tokens)
            };

            let usage = update_run_and_session_usage(
                &transaction,
                &run_id,
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
            finalize_chat_run_sync(&mut connection, &run_id, &status, terminal_error.as_deref())
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

            insert_run_messages(&transaction, &conversation_id, &run_id, &messages)?;
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

    fn clear<'a>(&'a self, conversation_id: &'a str) -> MemoryFuture<'a, Result<(), MemoryError>> {
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
            Some("the app closed before this run finished"),
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
    let mut messages = vec![user_message];
    messages.extend(reconstruct_partial_run(&events, status, terminal_error));
    insert_run_messages(&transaction, &conversation_id, run_id, &messages)?;

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

struct PendingCall {
    internal_id: String,
    call_id: String,
    provider_call_id: Option<String>,
    name: String,
    args: serde_json::Value,
}

#[derive(Default)]
struct TurnBuilder {
    parts: Vec<AssistantContent>,
    calls: Vec<PendingCall>,
    results: HashMap<String, (String, bool)>,
}

impl TurnBuilder {
    fn push_text(&mut self, text: &str) {
        if let Some(AssistantContent::Text(existing)) = self.parts.last_mut() {
            existing.text.push_str(text);
            return;
        }
        self.parts.push(AssistantContent::text(text));
    }

    fn push_reasoning(&mut self, text: &str) {
        if let Some(AssistantContent::Reasoning(existing)) = self.parts.last() {
            let merged = format!("{}{}", existing.display_text(), text);
            self.parts.pop();
            self.parts.push(AssistantContent::reasoning(merged));
            return;
        }
        self.parts.push(AssistantContent::reasoning(text));
    }

    fn awaiting_next_turn(&self) -> bool {
        !self.results.is_empty()
    }

    fn finish(&mut self, out: &mut Vec<Message>) {
        let mut assistant_parts: Vec<AssistantContent> = Vec::new();
        let mut tool_results: Vec<UserContent> = Vec::new();
        let mut call_iter = self.calls.drain(..);
        for part in self.parts.drain(..) {
            match part {
                AssistantContent::ToolCall(_) => {
                    let Some(call) = call_iter.next() else { continue };
                    let Some((output, is_error)) = self.results.get(&call.internal_id) else {
                        continue;
                    };
                    let content = if *is_error {
                        format!("{TOOL_ERROR_SENTINEL}{output}")
                    } else {
                        output.clone()
                    };
                    assistant_parts.push(match call.provider_call_id.clone() {
                        Some(provider) => AssistantContent::tool_call_with_call_id(
                            call.call_id.clone(),
                            provider,
                            call.name.clone(),
                            call.args.clone(),
                        ),
                        None => AssistantContent::tool_call(
                            call.call_id.clone(),
                            call.name.clone(),
                            call.args.clone(),
                        ),
                    });
                    let body = OneOrMany::one(ToolResultContent::text(content));
                    tool_results.push(match call.provider_call_id {
                        Some(provider) => UserContent::tool_result_with_call_id(call.call_id, provider, body),
                        None => UserContent::tool_result(call.call_id, body),
                    });
                }
                AssistantContent::Text(t) if t.text.trim().is_empty() => {}
                other => assistant_parts.push(other),
            }
        }
        self.results.clear();
        if let Ok(content) = OneOrMany::many(assistant_parts) {
            out.push(Message::Assistant { id: None, content });
        }
        if let Ok(content) = OneOrMany::many(tool_results) {
            out.push(Message::User { content });
        }
    }
}

fn reconstruct_partial_run(
    events: &[(String, String)],
    status: &str,
    detail: Option<&str>,
) -> Vec<Message> {
    let mut out: Vec<Message> = Vec::new();
    let mut turn = TurnBuilder::default();

    for (kind, payload) in events {
        match kind.as_str() {
            "text" | "reasoning" | "tool_call" if turn.awaiting_next_turn() => {
                turn.finish(&mut out);
                apply_event(&mut turn, kind, payload);
            }
            "model_turn_retried" => {
                turn = TurnBuilder::default();
            }
            _ => apply_event(&mut turn, kind, payload),
        }
    }
    turn.finish(&mut out);

    let note = fallback_note(status, detail);
    match out.last_mut() {
        Some(Message::Assistant { content, .. }) => {
            let mut parts: Vec<AssistantContent> = content.iter().cloned().collect();
            parts.push(AssistantContent::text(format!("\n\n{note}")));
            if let Ok(next) = OneOrMany::many(parts) {
                *content = next;
            }
        }
        _ => out.push(Message::assistant(note)),
    }
    out
}

fn apply_event(turn: &mut TurnBuilder, kind: &str, payload: &str) {
    match kind {
        "text" => turn.push_text(payload),
        "reasoning" => turn.push_reasoning(payload),
        "tool_call" => {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
                return;
            };
            let internal_id = value["id"].as_str().unwrap_or_default().to_string();
            let call_id = value["callId"].as_str().unwrap_or(&internal_id).to_string();
            if internal_id.is_empty() || call_id.is_empty() {
                return;
            }
            let args = value["args"]
                .as_str()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                .unwrap_or_else(|| serde_json::json!({}));
            let name = value["name"].as_str().unwrap_or("unknown").to_string();
            turn.parts
                .push(AssistantContent::tool_call(call_id.clone(), name.clone(), args.clone()));
            turn.calls.push(PendingCall {
                internal_id,
                call_id,
                provider_call_id: value["providerCallId"].as_str().map(str::to_string),
                name,
                args,
            });
        }
        "tool_result" => {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
                return;
            };
            let Some(internal_id) = value["id"].as_str() else {
                return;
            };
            let output = value["output"].as_str().unwrap_or("").to_string();
            let is_error = value["isError"].as_bool().unwrap_or(false);
            turn.results.insert(internal_id.to_string(), (output, is_error));
        }
        _ => {}
    }
}

fn fallback_note(status: &str, detail: Option<&str>) -> String {
    let detail = detail.map(str::trim).filter(|value| !value.is_empty());
    match (status, detail) {
        ("cancelled", _) => "_Stopped before completion._".to_string(),
        ("interrupted", _) => "_The app closed before this run finished._".to_string(),
        ("completed", _) => "_The run ended before its transcript was saved._".to_string(),
        (_, Some(detail)) => format!("_Run failed: {detail}_"),
        _ => "_Run failed before completion._".to_string(),
    }
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
    last_turn_input: i64,
    complete: bool,
) -> AppResult<DurableRunUsage> {
    let conversation_id: String = transaction
        .query_row(
            "SELECT conversation_id FROM chat_runs WHERE run_id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .map_err(sql_err)?;

    let now = now_ms();
    transaction
        .execute(
            "UPDATE chat_runs SET
                 last_turn_input_tokens = ?1,
                 usage_complete = ?2, updated_at = ?3
             WHERE run_id = ?4",
            params![
                last_turn_input.max(0),
                i64::from(complete),
                now,
                run_id
            ],
        )
        .map_err(sql_err)?;
    transaction
        .execute(
            "UPDATE sessions SET last_context_tokens = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                last_turn_input.max(0),
                now,
                conversation_id
            ],
        )
        .map_err(sql_err)?;

    Ok(DurableRunUsage {
        last_turn_input_tokens: from_db_token(last_turn_input),
    })
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
