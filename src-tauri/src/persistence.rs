use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use rig::completion::Message;
use rig::memory::{ConversationMemory, MemoryError};
use rig::message::{AssistantContent, DocumentSourceKind, MimeType, UserContent};

use crate::error::{AppError, AppResult};
use crate::events::ToolDisplayInfo;
use crate::tools::parse_display_info;

type MemoryFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CompactionMarker {
    summary: String,
    original_message_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: Option<String>,
    pub workspace_path: Option<String>,
    pub updated_at: i64,
    pub last_input_tokens: i64,
    pub last_output_tokens: i64,
    pub last_total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    pub name: String,
    pub is_image: bool,
    /// `data:image/<type>;base64,<data>` for images; empty string for docs.
    pub data_url: String,
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
    pub messages_since: Vec<Message>,
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
                |tx| { Ok(add_column_if_missing(tx, "sessions", "workspace_path", "TEXT")?) }
            ),
            rusqlite_migration::M::up_with_hook(
                "-- add compaction-marker discriminator column to messages",
                |tx| { Ok(add_column_if_missing(tx, "messages", "kind", "TEXT NOT NULL DEFAULT 'message'")?) }
            ),
            rusqlite_migration::M::up_with_hook(
                "-- add persisted per-session token usage columns",
                |tx| {
                    add_column_if_missing(tx, "sessions", "last_input_tokens", "INTEGER NOT NULL DEFAULT 0")?;
                    add_column_if_missing(tx, "sessions", "last_output_tokens", "INTEGER NOT NULL DEFAULT 0")?;
                    Ok(add_column_if_missing(tx, "sessions", "last_total_tokens", "INTEGER NOT NULL DEFAULT 0")?)
                }
            ),
        ]);

        migrations.to_latest(&mut conn).map_err(|e| AppError::other(format!("sqlite schema migration failed: {e}")))?;

        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub async fn list_sessions(&self) -> AppResult<Vec<SessionSummary>> {
        let conn = self.conn.clone();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let mut stmt = c.prepare(
                "SELECT id, title, workspace_path, updated_at, last_input_tokens, last_output_tokens, last_total_tokens
                 FROM sessions ORDER BY updated_at DESC"
            ).map_err(sql_err)?;
            let rows = stmt.query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    workspace_path: row.get(2)?,
                    updated_at: row.get(3)?,
                    last_input_tokens: row.get(4)?,
                    last_output_tokens: row.get(5)?,
                    last_total_tokens: row.get(6)?,
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

    pub async fn update_session_tokens(&self, conversation_id: &str, input_tokens: u64, output_tokens: u64, total_tokens: u64) -> AppResult<()> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let now = now_millis();
            c.execute(
                "UPDATE sessions SET last_input_tokens = ?1, last_output_tokens = ?2, last_total_tokens = ?3, updated_at = ?4 WHERE id = ?5",
                params![input_tokens as i64, output_tokens as i64, total_tokens as i64, now, cid],
            ).map_err(sql_err)?;
            Ok(())
        }).await
    }

    pub async fn get_compaction_input(&self, conversation_id: &str) -> AppResult<CompactionInput> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let rows = load_all(&c, &cid).map_err(sql_err)?;
            let boundary = rows.iter().rposition(|r| r.kind == "compaction");

            let (previous_summary, prior_message_count, tail_start) = match boundary {
                Some(idx) => {
                    let marker: CompactionMarker = serde_json::from_str(&rows[idx].data)
                        .map_err(|e| AppError::other(format!("compaction marker decode failed: {e}")))?;
                    (Some(marker.summary), marker.original_message_count, idx + 1)
                }
                None => (None, 0, 0),
            };

            let mut messages_since = Vec::new();
            for row in &rows[tail_start..] {
                if row.kind == "message" {
                    let msg: Message = serde_json::from_str(&row.data)
                        .map_err(|e| AppError::other(format!("message decode failed: {e}")))?;
                    messages_since.push(msg);
                }
            }

            Ok(CompactionInput { previous_summary, prior_message_count, messages_since })
        }).await
    }

    pub async fn insert_compaction_marker(&self, conversation_id: &str, summary: &str, original_message_count: usize) -> AppResult<i64> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        let summary = summary.to_string();
        run_db_task(move || {
            let now = now_millis();
            let marker = CompactionMarker { summary, original_message_count };
            let data = serde_json::to_string(&marker).map_err(|e| AppError::other(format!("serialize compaction marker: {e}")))?;

            let mut c = conn.lock().map_err(lock_err)?;
            let tx = c.transaction().map_err(sql_err)?;

            let seq: i64 = tx.query_row(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE conversation_id = ?1",
                params![cid],
                |row| row.get(0),
            ).map_err(sql_err)?;

            tx.execute(
                "INSERT INTO messages (conversation_id, seq, ts, data, kind) VALUES (?1, ?2, ?3, ?4, 'compaction')",
                params![cid, seq, now, data],
            ).map_err(sql_err)?;
            tx.execute("UPDATE sessions SET updated_at = ?1 WHERE id = ?2", params![now, cid]).map_err(sql_err)?;

            tx.commit().map_err(sql_err)?;
            Ok(now)
        }).await
    }

    pub async fn get_session_view(&self, conversation_id: &str, workspace: Option<&Path>) -> AppResult<Vec<MessageView>> {
        let conn = self.conn.clone();
        let cid = conversation_id.to_string();
        let ws_buf = workspace.map(|p| p.to_path_buf());
        run_db_task(move || {
            let c = conn.lock().map_err(lock_err)?;
            let rows = load_all(&c, &cid).map_err(sql_err)?;

            struct StoredToolRes {
                output: String,
                is_error: bool,
            }
            let mut tool_outputs: HashMap<String, StoredToolRes> = HashMap::new();
            for row in &rows {
                if row.kind != "message" { continue; }
                if let Ok(Message::User { content }) = serde_json::from_str::<Message>(&row.data) {
                    for c in content {
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

            for row in &rows {
                let msg_id = stable_id(&cid, row.seq, 0, None);

                if row.kind == "compaction" {
                    let marker: CompactionMarker = match serde_json::from_str(&row.data) {
                        Ok(m) => m,
                        Err(e) => {
                            eprintln!("[persistence] corrupt compaction marker seq={} in session {cid}: {e}", row.seq);
                            continue;
                        }
                    };
                    views.push(MessageView {
                        id: msg_id,
                        role: "system".to_string(),
                        items: vec![MessageItemView::CompactionNotice {
                            id: stable_id(&cid, row.seq, 0, Some("compaction")),
                            original_message_count: marker.original_message_count,
                            ts: row.ts,
                        }],
                        attachments: vec![],
                    });
                    continue;
                }

                let msg: Message = match serde_json::from_str(&row.data) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[persistence] corrupt message seq={} in session {cid}: {e}", row.seq);
                        continue;
                    }
                };

                match msg {
                    Message::User { content } => {
                        let text: String = content.iter().filter_map(|c| {
                            if let UserContent::Text(t) = c { Some(t.text.as_str()) } else { None }
                        }).collect();

                        let mut attachments: Vec<AttachmentView> = Vec::new();

                        for part in content.iter() {
                            if let UserContent::Image(img) = part {
                                let data_url = match &img.data {
                                    DocumentSourceKind::Base64(b64) => {
                                        let mime = img.media_type.as_ref()
                                            .map(|m| format!("{}", m.to_mime_type()))
                                            .unwrap_or_else(|| "image/png".to_string());
                                        format!("data:{mime};base64,{b64}")
                                    }
                                    DocumentSourceKind::Url(url) => url.clone(),
                                    _ => String::new(),
                                };
                                if !data_url.is_empty() {
                                    let ext = img.media_type.as_ref()
                                        .map(|m| m.to_mime_type().split('/').nth(1).unwrap_or("img").to_string())
                                        .unwrap_or_else(|| "img".to_string());
                                    attachments.push(AttachmentView {
                                        name: format!("image.{ext}"),
                                        is_image: true,
                                        data_url,
                                    });
                                }
                            }
                        }

                        let doc_re = regex::Regex::new(r"\[Attached (?:File|PDF): ([^\]\n]+)\]").unwrap();
                        for cap in doc_re.captures_iter(&text) {
                            let label = cap[1].trim();
                            let name = label.replace('\\', "/")
                                .split('/')
                                .last()
                                .unwrap_or(label)
                                .to_string();
                            attachments.push(AttachmentView {
                                name,
                                is_image: false,
                                data_url: String::new(),
                            });
                        }

                        if !text.is_empty() || !attachments.is_empty() {
                            views.push(MessageView {
                                id: msg_id.clone(),
                                role: "user".to_string(),
                                items: if text.is_empty() { vec![] } else {
                                    vec![MessageItemView::Text { id: stable_id(&cid, row.seq, 0, Some("text")), text }]
                                },
                                attachments,
                            });
                        }
                    }
                    Message::Assistant { content, .. } => {
                        let mut items: Vec<MessageItemView> = Vec::new();
                        let mut item_idx: usize = 0;
                        for c in content {
                            match c {
                                AssistantContent::Reasoning(r) => {
                                    let text = r.display_text();
                                    if !text.is_empty() {
                                        items.push(MessageItemView::Reasoning {
                                            id: stable_id(&cid, row.seq, item_idx, Some("reasoning")),
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
                                            id: stable_id(&cid, row.seq, item_idx, Some("text")),
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
                                attachments: vec![],
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
                let rows = load_all(&c, &cid).map_err(mem_sql)?;
                let boundary = rows.iter().rposition(|r| r.kind == "compaction");

                let mut out = Vec::new();
                let tail_start = match boundary {
                    Some(idx) => {
                        let marker: CompactionMarker = serde_json::from_str(&rows[idx].data).map_err(MemoryError::backend)?;
                        out.push(Message::user(format!(
                            "[Conversation compacted — {} earlier messages summarised]\n\n{}",
                            marker.original_message_count, marker.summary
                        )));
                        idx + 1
                    }
                    None => 0,
                };

                for row in &rows[tail_start..] {
                    if row.kind == "message" {
                        let msg: Message = serde_json::from_str(&row.data).map_err(MemoryError::backend)?;
                        out.push(msg);
                    }
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

                let start_seq: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE conversation_id = ?1",
                    params![cid],
                    |row| row.get(0),
                ).map_err(mem_sql)?;

                for (i, msg) in messages.iter().enumerate() {
                    let data = serde_json::to_string(msg).map_err(MemoryError::backend)?;
                    tx.execute(
                        "INSERT INTO messages (conversation_id, seq, ts, data, kind) VALUES (?1, ?2, ?3, ?4, 'message')",
                        params![cid, start_seq + i as i64, now, data],
                    ).map_err(mem_sql)?;
                }

                tx.execute(
                    "INSERT INTO sessions (id, created_at, updated_at) VALUES (?1, ?2, ?2)
                     ON CONFLICT(id) DO UPDATE SET updated_at = ?2",
                    params![cid, now],
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

struct MessageRow {
    seq: i64,
    ts: i64,
    kind: String,
    data: String,
}

fn load_all(conn: &Connection, conversation_id: &str) -> rusqlite::Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare("SELECT seq, ts, kind, data FROM messages WHERE conversation_id = ?1 ORDER BY seq ASC")?;
    let rows = stmt.query_map(params![conversation_id], |row| {
        Ok(MessageRow {
            seq: row.get(0)?,
            ts: row.get(1)?,
            kind: row.get(2)?,
            data: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn add_column_if_missing(tx: &rusqlite::Transaction, table: &str, column: &str, ddl_type: &str) -> rusqlite::Result<()> {
    let mut exists = false;
    let mut stmt = tx.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            exists = true;
            break;
        }
    }
    drop(rows);
    drop(stmt);
    if !exists {
        tx.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl_type};"), [])?;
    }
    Ok(())
}

fn stable_id(cid: &str, seq: i64, item_idx: usize, kind: Option<&str>) -> String {
    let input = format!("{cid}:{seq}:{item_idx}:{}", kind.unwrap_or(""));
    let hash = Sha256::digest(input.as_bytes());
    format!("{:016x}", u64::from_be_bytes(hash[..8].try_into().unwrap_or([0u8; 8])))
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
