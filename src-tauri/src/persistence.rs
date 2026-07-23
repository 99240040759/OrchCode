use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use rig::completion::Message;
use rig::memory::{ConversationMemory, MemoryError};
use rig::message::{AssistantContent, UserContent};

use crate::error::{AppError, AppResult};
use crate::events::ToolDisplayInfo;
use crate::tools::parse_display_info;

type MemoryFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredToolCall {
    pub id: String,
    pub name: String,
    pub args: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub reasoning: Option<String>,
    #[serde(default)]
    pub tools: Vec<StoredToolCall>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: Option<String>,
    pub workspace_path: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MessageItemView {
    Text {
        id: String,
        text: String,
    },
    Reasoning {
        id: String,
        text: String,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    pub id: String,
    pub role: String,
    pub items: Vec<MessageItemView>,
}

#[derive(Clone)]
pub struct SqliteMemory {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteMemory {
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path).map_err(|e| AppError::other(format!("sqlite open failed: {e}")))?;

        let migrations = rusqlite_migration::Migrations::new(vec![
            rusqlite_migration::M::up(
                "CREATE TABLE IF NOT EXISTS messages (
                     conversation_id TEXT NOT NULL,
                     seq             INTEGER NOT NULL,
                     ts              INTEGER NOT NULL,
                     data            TEXT NOT NULL,
                     PRIMARY KEY (conversation_id, seq)
                 );
                 CREATE TABLE IF NOT EXISTS sessions (
                     id             TEXT PRIMARY KEY,
                     title          TEXT,
                     created_at     INTEGER NOT NULL,
                     updated_at     INTEGER NOT NULL
                 );"
            ),
            rusqlite_migration::M::up_with_hook(
                "-- add workspace_path column conditional on existence",
                |tx| {
                    let mut column_exists = false;
                    if let Ok(mut stmt) = tx.prepare("PRAGMA table_info(sessions)") {
                        if let Ok(mut rows) = stmt.query([]) {
                            while let Ok(Some(row)) = rows.next() {
                                if let Ok(name) = row.get::<_, String>(1) {
                                    if name == "workspace_path" {
                                        column_exists = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if !column_exists {
                        tx.execute("ALTER TABLE sessions ADD COLUMN workspace_path TEXT;", [])?;
                    }
                    Ok(())
                }
            )
        ]);

        migrations.to_latest(&mut conn).map_err(|e| AppError::other(format!("sqlite schema migration failed: {e}")))?;

        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub async fn list_sessions(&self) -> AppResult<Vec<SessionSummary>> {
        let conn = self.conn.clone();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let mut stmt = c.prepare("SELECT id, title, workspace_path, updated_at FROM sessions ORDER BY updated_at DESC").map_err(sql_err)?;
            let rows = stmt.query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    workspace_path: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            }).map_err(sql_err)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(sql_err)?);
            }
            Ok(out)
        }).await
    }

    pub async fn set_session_workspace(&self, conversation_id: &str, workspace_path: Option<&str>) -> AppResult<()> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        let ws = workspace_path.map(|s| s.to_string());
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let now = now_millis();
            c.execute(
                "INSERT INTO sessions (id, workspace_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(id) DO UPDATE SET workspace_path = COALESCE(?2, workspace_path), updated_at = ?3",
                params![cid, ws, now],
            ).map_err(sql_err)?;
            Ok(())
        }).await
    }
    pub async fn set_session_title(&self, conversation_id: &str, title: &str) -> AppResult<()> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        let t = title.to_string();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let now = now_millis();
            c.execute(
                "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(id) DO UPDATE SET title = ?2, updated_at = ?3",
                params![cid, t, now],
            ).map_err(sql_err)?;
            Ok(())
        }).await
    }

    pub async fn session_has_title(&self, conversation_id: &str) -> AppResult<bool> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let exists: bool = c.query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND title IS NOT NULL AND title != ''",
                params![cid],
                |row| row.get::<_, i64>(0),
            ).map(|n| n > 0).map_err(sql_err)?;
            Ok(exists)
        }).await
    }

    pub async fn load_raw_messages(&self, conversation_id: &str) -> AppResult<Vec<Message>> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let raw = load_raw(&c, &cid).map_err(sql_err)?;
            let mut out = Vec::with_capacity(raw.len());
            for json in raw {
                let msg: Message = serde_json::from_str(&json).map_err(|e| AppError::other(format!("message decode failed: {e}")))?;
                out.push(msg);
            }
            Ok(out)
        }).await
    }

    pub async fn compact_with_summary(&self, conversation_id: &str, summary: &str, original_message_count: usize) -> AppResult<()> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        let summary = summary.to_string();
        run_db_task(move || {
            let now = now_millis();
            let seed = Message::user(format!("[Conversation compacted — {original_message_count} messages summarised]\n\n{summary}"));
            let seed_json = serde_json::to_string(&seed).map_err(|e| AppError::other(format!("serialize seed message: {e}")))?;

            let mut c = conn.lock().map_err(lock_err)?;
            let tx = c.transaction().map_err(sql_err)?;

            tx.execute("DELETE FROM messages WHERE conversation_id = ?1", params![cid]).map_err(sql_err)?;
            tx.execute("INSERT INTO messages (conversation_id, seq, ts, data) VALUES (?1, 0, ?2, ?3)", params![cid, now, seed_json]).map_err(sql_err)?;
            tx.execute("UPDATE sessions SET updated_at = ?1 WHERE id = ?2", params![now, cid]).map_err(sql_err)?;

            tx.commit().map_err(sql_err)?;
            Ok(())
        }).await
    }

    pub async fn get_messages(&self, conversation_id: &str) -> AppResult<Vec<StoredMessage>> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let raw = load_raw(&c, &cid).map_err(sql_err)?;
            let mut out = Vec::with_capacity(raw.len());
            for json in raw {
                let msg: Message = serde_json::from_str(&json).map_err(|e| AppError::other(format!("message decode failed: {e}")))?;
                out.push(flatten(&msg));
            }
            Ok(out)
        }).await
    }

    pub async fn get_session_view(&self, conversation_id: &str, workspace: Option<&Path>) -> AppResult<Vec<MessageView>> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        let ws_buf = workspace.map(|p| p.to_path_buf());
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let raw_with_seq = load_raw_with_seq(&c, &cid).map_err(sql_err)?;

            let mut messages: Vec<(i64, Message)> = Vec::new();
            for (seq, json) in &raw_with_seq {
                match serde_json::from_str::<Message>(json) {
                    Ok(msg) => messages.push((*seq, msg)),
                    Err(e) => {
                        eprintln!("[persistence] corrupt message seq={seq} in session {cid}: {e}");
                    }
                }
            }

            struct StoredToolRes {
                output: String,
                is_error: bool,
            }
            let mut tool_outputs: HashMap<String, StoredToolRes> = HashMap::new();
            for (_, msg) in &messages {
                if let Message::User { content } = msg {
                    for c in content.clone() {
                        if let UserContent::ToolResult(tr) = c {
                            let call_id = tr.call_id.as_ref().unwrap_or(&tr.id);
                            use rig::message::ToolResultContent;
                            let output: String = tr.content.iter().filter_map(|c| {
                                if let ToolResultContent::Text(t) = c { Some(t.text.as_str()) } else { None }
                            }).collect();
                            let is_error = output.starts_with("Error:");
                            tool_outputs.insert(call_id.clone(), StoredToolRes { output, is_error });
                        }
                    }
                }
            }

            let ws_path = ws_buf.as_deref();
            let mut views: Vec<MessageView> = Vec::new();
            let mut msg_idx: usize = 0;
            for (seq, msg) in &messages {
                let msg_id = stable_id(&cid, *seq, msg_idx, None);
                msg_idx += 1;
                match msg {
                    Message::User { content } => {
                        let text: String = content.iter().filter_map(|c| {
                            if let UserContent::Text(t) = c { Some(t.text.as_str()) } else { None }
                        }).collect();
                        if !text.is_empty() {
                            views.push(MessageView {
                                id: msg_id.clone(),
                                role: "user".to_string(),
                                items: vec![MessageItemView::Text { id: stable_id(&cid, *seq, 0, Some("text")), text }],
                            });
                        }
                    }
                    Message::Assistant { content, .. } => {
                        let mut items: Vec<MessageItemView> = Vec::new();
                        let mut item_idx: usize = 0;
                        for c in content.clone() {
                            match c {
                                AssistantContent::Reasoning(r) => {
                                    let text = r.display_text();
                                    if !text.is_empty() {
                                        items.push(MessageItemView::Reasoning {
                                            id: stable_id(&cid, *seq, item_idx, Some("reasoning")),
                                            text,
                                        });
                                        item_idx += 1;
                                    }
                                }
                                AssistantContent::ToolCall(tc) => {
                                    let args = tc.function.arguments.to_string();
                                    let display_info = parse_display_info(&tc.function.name, &args, ws_path);
                                    let entry = tool_outputs.get(&tc.id);
                                    let output = entry.map(|e| e.output.clone());
                                    let status = match entry {
                                        Some(e) if e.is_error => "error",
                                        Some(_) => "done",
                                        None => "done",
                                    };
                                    items.push(MessageItemView::ToolCall {
                                        id: tc.id.clone(),
                                        name: tc.function.name.clone(),
                                        args,
                                        output,
                                        display_info,
                                        status: status.to_string(),
                                    });
                                    item_idx += 1;
                                }
                                AssistantContent::Text(t) => {
                                    if !t.text.is_empty() {
                                        items.push(MessageItemView::Text {
                                            id: stable_id(&cid, *seq, item_idx, Some("text")),
                                            text: t.text.clone(),
                                        });
                                        item_idx += 1;
                                    }
                                }
                                _ => {}
                            }
                        }
                        if !items.is_empty() {
                            views.push(MessageView {
                                id: msg_id,
                                role: "assistant".to_string(),
                                items,
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ok(views)
        }).await
    }
}

impl ConversationMemory for SqliteMemory {
    fn load<'a>(&'a self, conversation_id: &'a str) -> MemoryFuture<'a, Result<Vec<Message>, MemoryError>> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        Box::pin(async move {
            run_mem_task(move || {
                let c = conn.lock().map_err(mem_lock)?;
                let raw = load_raw(&c, &cid).map_err(mem_sql)?;
                let mut out = Vec::with_capacity(raw.len());
                for json in raw {
                    let msg: Message = serde_json::from_str(&json).map_err(MemoryError::backend)?;
                    out.push(msg);
                }
                Ok(out)
            }).await
        })
    }

    fn append<'a>(&'a self, conversation_id: &'a str, messages: Vec<Message>) -> MemoryFuture<'a, Result<(), MemoryError>> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        Box::pin(async move {
            run_mem_task(move || {
                let now = now_millis();
                let mut c = conn.lock().map_err(mem_lock)?;
                let tx = c.transaction().map_err(mem_sql)?;

                let has_title: bool = tx.query_row(
                    "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND title IS NOT NULL AND title != ''",
                    params![cid],
                    |row| row.get::<_, i64>(0),
                ).map(|cnt| cnt > 0).unwrap_or(false);

                let title = if has_title { None } else { derive_title(&messages) };

                let start_seq: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE conversation_id = ?1",
                    params![cid],
                    |row| row.get(0),
                ).map_err(mem_sql)?;

                for (i, msg) in messages.iter().enumerate() {
                    let data = serde_json::to_string(msg).map_err(MemoryError::backend)?;
                    tx.execute(
                        "INSERT INTO messages (conversation_id, seq, ts, data) VALUES (?1, ?2, ?3, ?4)",
                        params![cid, start_seq + i as i64, now, data],
                    ).map_err(mem_sql)?;
                }

                tx.execute(
                    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(id) DO UPDATE SET updated_at = ?4, title = COALESCE(sessions.title, ?2)",
                    params![cid, title, now, now],
                ).map_err(mem_sql)?;

                tx.commit().map_err(mem_sql)?;
                Ok(())
            }).await
        })
    }

    fn clear<'a>(&'a self, conversation_id: &'a str) -> MemoryFuture<'a, Result<(), MemoryError>> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        Box::pin(async move {
            run_mem_task(move || {
                let c = conn.lock().map_err(mem_lock)?;
                c.execute("DELETE FROM messages WHERE conversation_id = ?1", params![cid]).map_err(mem_sql)?;
                c.execute("DELETE FROM sessions WHERE id = ?1", params![cid]).map_err(mem_sql)?;
                Ok(())
            }).await
        })
    }
}

fn load_raw(conn: &Connection, conversation_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT data FROM messages WHERE conversation_id = ?1 ORDER BY seq ASC")?;
    let rows = stmt.query_map(params![conversation_id], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn load_raw_with_seq(conn: &Connection, conversation_id: &str) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare("SELECT seq, data FROM messages WHERE conversation_id = ?1 ORDER BY seq ASC")?;
    let rows = stmt.query_map(params![conversation_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn stable_id(cid: &str, seq: i64, item_idx: usize, kind: Option<&str>) -> String {
    let input = format!("{cid}:{seq}:{item_idx}:{}", kind.unwrap_or(""));
    let hash = Sha256::digest(input.as_bytes());
    format!("{:016x}", u64::from_be_bytes(hash[..8].try_into().unwrap_or([0u8; 8])))
}

fn flatten(m: &Message) -> StoredMessage {
    let id = Uuid::new_v4().to_string();
    match m {
        Message::User { content } => StoredMessage {
            id,
            role: "user".to_string(),
            text: content.iter().filter_map(|c| match c {
                UserContent::Text(t) => Some(t.text.as_str()),
                _ => None,
            }).collect(),
            reasoning: None,
            tools: vec![],
        },
        Message::Assistant { content, .. } => {
            let mut text_parts: Vec<&str> = Vec::new();
            let mut reasoning_parts: Vec<String> = Vec::new();
            let mut tools: Vec<StoredToolCall> = Vec::new();

            for c in content.iter() {
                match c {
                    AssistantContent::Text(t) => text_parts.push(t.text.as_str()),
                    AssistantContent::Reasoning(r) => reasoning_parts.push(r.display_text()),
                    AssistantContent::ToolCall(tc) => {
                        tools.push(StoredToolCall {
                            id: tc.id.clone(),
                            name: tc.function.name.clone(),
                            args: tc.function.arguments.to_string(),
                            output: None,
                        });
                    }
                    _ => {}
                }
            }

            StoredMessage {
                id,
                role: "assistant".to_string(),
                text: text_parts.join(""),
                reasoning: if reasoning_parts.is_empty() { None } else { Some(reasoning_parts.join("")) },
                tools,
            }
        }
        Message::System { content } => StoredMessage {
            id,
            role: "system".to_string(),
            text: content.clone(),
            reasoning: None,
            tools: vec![],
        },
    }
}

fn derive_title(messages: &[Message]) -> Option<String> {
    messages.iter().find_map(|m| match m {
        Message::User { content } => content.iter().find_map(|c| match c {
            UserContent::Text(t) if !t.text.trim().is_empty() => Some(t.text.trim().chars().take(80).collect()),
            _ => None,
        }),
        _ => None,
    })
}

fn now_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

async fn run_db_task<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::other(format!("db task failed: {e}")))?
}

async fn run_mem_task<T, F>(f: F) -> Result<T, MemoryError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, MemoryError> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| MemoryError::Internal(e.to_string()))?
}

fn sql_err(e: rusqlite::Error) -> AppError {
    AppError::other(format!("sqlite error: {e}"))
}

fn lock_err<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError::other("sqlite connection lock poisoned")
}

fn mem_sql(e: rusqlite::Error) -> MemoryError {
    MemoryError::backend(e)
}

fn mem_lock<T>(_: std::sync::PoisonError<T>) -> MemoryError {
    MemoryError::Internal("sqlite connection lock poisoned".to_string())
}
