use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rig::completion::Message;
use rig::conversation::{Author, Conversation, MessageId};
use rig::message::{AssistantContent, DocumentSourceKind, MimeType, ToolResultContent, UserContent};
use rig_memory::{as_of, history, summary_in, Compacted, DirStore, LogRecord, SessionError, Store};
use serde_json::{json, Value};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::llm::{is_payload_part, payload_part_label};
use crate::persistence::{SessionRecord, SessionRecordPage};
use crate::wire;

pub const LOG: &str = "main";

pub fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn session_error(error: SessionError) -> AppError {
    sentry::capture_error(&error);
    AppError::other(format!("conversation log: {error}"))
}

fn conversations_root(data_dir: &Path) -> PathBuf {
    data_dir.join("conversations")
}

pub fn open_store(data_dir: &Path, session_id: &str) -> AppResult<DirStore> {
    if !is_safe_session_id(session_id) {
        return Err(AppError::other("invalid session id"));
    }
    DirStore::open(conversations_root(data_dir).join(session_id)).map_err(session_error)
}

pub fn load_from_store<S: Store>(store: &S) -> AppResult<Conversation> {
    rig_memory::load(store, LOG).map_err(session_error)
}

pub async fn load(data_dir: &Path, session_id: &str) -> AppResult<Conversation> {
    let store = open_store(data_dir, session_id)?;
    tokio::task::spawn_blocking(move || load_from_store(&store))
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            AppError::other(format!("conversation load task failed: {e}"))
        })?
}

pub async fn destroy(data_dir: &Path, session_id: &str) -> AppResult<()> {
    let store = open_store(data_dir, session_id)?;
    let dir = conversations_root(data_dir).join(session_id);
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        store.destroy().map_err(AppError::Io)?;
        match std::fs::remove_dir_all(&dir) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::Io(e)),
        }
    })
    .await
    .map_err(|e| {
        sentry::capture_error(&e);
        AppError::other(format!("conversation delete task failed: {e}"))
    })?
}

fn stable_id(cid: &str, message: u64, item_idx: usize, kind: Option<&str>) -> String {
    crate::util::fast_hash_hex(&format!("{cid}:{message}:{item_idx}:{}", kind.unwrap_or("")))
}

pub fn reasoning_item_id(cid: &str, id: MessageId, item_idx: usize) -> String {
    stable_id(cid, id.get(), item_idx, Some("reasoning"))
}

pub fn compaction_message_id(cid: &str, summary: MessageId) -> String {
    stable_id(cid, summary.get(), 0, Some("compaction-message"))
}

pub fn compaction_item_id(cid: &str, summary: MessageId) -> String {
    stable_id(cid, summary.get(), 0, Some("compaction"))
}

enum Shown {
    Message {
        id: MessageId,
        message: Arc<Message>,
        author: Option<Author>,
    },
    Compaction {
        summary: MessageId,
        replaced: usize,
        ts: i64,
    },
}

fn shown<S: Store>(store: &S, conversation: &Conversation) -> Result<Vec<Shown>, SessionError> {
    let mut list: Vec<Shown> = conversation
        .entries()
        .filter_map(|entry| {
            Some(Shown::Message {
                id: entry.id,
                message: conversation.messages().get(entry.index)?.clone(),
                author: entry.author.cloned(),
            })
        })
        .collect();
    let compactions: Vec<Compacted> = Compacted::of(conversation)
        .map(|(_, compacted)| compacted)
        .collect();
    if compactions.is_empty() {
        return Ok(list);
    }
    let records = history(store, LOG)?;
    for compacted in compactions.iter().rev() {
        let (n, t) = records
            .iter()
            .find_map(|(stamp, record)| match record {
                LogRecord::Change(recorded) if summary_in(&recorded.change) == Some(compacted.summary) => {
                    Some((stamp.n, stamp.t))
                }
                _ => None,
            })
            .ok_or_else(|| unreadable("a compaction has no record in the log"))?;
        let before = as_of(store, LOG, n)?;
        let mut originals: Vec<Shown> = Vec::new();
        for id in &compacted.replaced {
            let entry = before
                .index_of(*id)
                .and_then(|at| before.entry(at))
                .ok_or_else(|| unreadable("a compacted message is missing from the log"))?;
            originals.push(Shown::Message {
                id: *id,
                message: entry.message,
                author: entry.author,
            });
        }
        let replaced = originals
            .iter()
            .filter(|item| matches!(item, Shown::Message { author: None, .. }))
            .count();
        let position = list
            .iter()
            .position(|item| matches!(item, Shown::Message { id, .. } if *id == compacted.summary))
            .ok_or_else(|| unreadable("a compaction summary is missing from the conversation"))?;
        let _ = list.splice(position..=position, originals);

        let last_before = before
            .entries()
            .next_back()
            .map(|entry| entry.id)
            .ok_or_else(|| unreadable("a compaction happened in an empty conversation"))?;
        let after = list
            .iter()
            .position(|item| matches!(item, Shown::Message { id, .. } if *id == last_before))
            .ok_or_else(|| unreadable("the message a compaction followed is missing"))?;
        list.insert(
            after + 1,
            Shown::Compaction {
                summary: compacted.summary,
                replaced,
                ts: i64::try_from(t).unwrap_or(0),
            },
        );
    }
    Ok(list)
}

fn unreadable(why: &str) -> SessionError {
    SessionError::Record {
        log: LOG.to_string(),
        line: 0,
        why: why.to_string(),
    }
}

pub fn render_tool_result<'a>(content: impl IntoIterator<Item = &'a ToolResultContent>) -> String {
    content
        .into_iter()
        .filter_map(|part| match part {
            ToolResultContent::Text(t) => Some(t.text.as_str()),
            _ => None,
        })
        .collect()
}

fn tool_outputs(items: &[Shown], needed: &HashSet<String>) -> HashMap<String, (String, bool)> {
    let mut outputs = HashMap::new();
    if needed.is_empty() {
        return outputs;
    }
    for item in items {
        let Shown::Message { message, .. } = item else { continue };
        let Message::User { content } = &**message else { continue };
        for part in content {
            if let UserContent::ToolResult(result) = part {
                let call = result.call.to_string();
                if !needed.contains(&call) {
                    continue;
                }
                let text = crate::util::clip_middle(
                    &render_tool_result(result.content.iter()),
                    config::MAX_VIEW_TOOL_OUTPUT_CHARS,
                );
                outputs.insert(call, (text, result.is_error));
            }
        }
    }
    outputs
}

fn split_data_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("data:")?;
    let (mime, data) = rest.split_once(";base64,")?;
    Some((mime.to_string(), data.to_string()))
}

fn step_record(index: usize, step: Value, deltas: Vec<Value>, stop: Value) -> Value {
    json!({
        "kind": "step",
        "index": index,
        "step": step,
        "deltas": deltas,
        "stop": stop,
    })
}

fn user_records(content: &[UserContent]) -> Vec<Value> {
    let mut text = String::new();
    let mut parts: Vec<Value> = Vec::new();
    for part in content {
        match part {
            UserContent::Text(t) => {
                if is_payload_part(&t.text) {
                    if let Some(label) = payload_part_label(&t.text) {
                        if !crate::llm::is_mention_context_part(&t.text) {
                            let path = label
                                .split_once("#L")
                                .map(|(path, _)| path)
                                .unwrap_or(&label)
                                .to_string();
                            parts.push(json!({
                                "type": "document",
                                "name": crate::util::basename(&path),
                                "path": path,
                            }));
                        }
                    } else if let Some(note) = t
                        .text
                        .strip_prefix(crate::llm::NOTE_PART_PREFIX)
                        .and_then(|value| value.strip_suffix("</note>"))
                    {
                        if !text.is_empty() {
                            text.push_str("\n\n");
                        }
                        text.push_str(note);
                    }
                } else if text.is_empty() {
                    text = t.text.clone();
                } else {
                    text.push_str("\n\n");
                    text.push_str(&t.text);
                }
            }
            UserContent::Image(img) => {
                let mime = img
                    .media_type
                    .as_ref()
                    .map(|m| m.to_mime_type().to_string())
                    .unwrap_or_else(|| "image/png".to_string());
                match &img.data {
                    DocumentSourceKind::Base64(b64) => {
                        if let Some((thumb_mime, data)) =
                            crate::media::thumbnail_data_url_from_base64(b64, &mime, 320)
                                .and_then(|url| split_data_url(&url))
                        {
                            parts.push(json!({
                                "type": "image",
                                "data": data,
                                "mime_type": thumb_mime,
                            }));
                        }
                    }
                    DocumentSourceKind::Url(url) => {
                        parts.push(json!({ "type": "image", "uri": url, "mime_type": mime }));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    let mut content_parts: Vec<Value> = Vec::new();
    if !text.is_empty() {
        content_parts.push(json!({ "type": "text", "text": text }));
    }
    content_parts.extend(parts);
    if content_parts.is_empty() {
        return Vec::new();
    }
    vec![json!({ "kind": "user_input", "content": content_parts })]
}

fn assistant_records(
    cid: &str,
    id: MessageId,
    content: &[AssistantContent],
    outputs: &HashMap<String, (String, bool)>,
    durations: &HashMap<String, u64>,
) -> Vec<Value> {
    let mut records: Vec<Value> = Vec::new();
    let mut item_idx = 0usize;
    for part in content {
        match part {
            AssistantContent::Reasoning(r) => {
                if r.text.is_empty() {
                    continue;
                }
                let duration = durations.get(&reasoning_item_id(cid, id, item_idx)).copied();
                let stop = match duration {
                    Some(seconds) => json!({ "duration_seconds": seconds }),
                    None => json!({}),
                };
                records.push(step_record(
                    records.len(),
                    json!({ "type": "thought" }),
                    vec![json!({ "content": { "text": r.text } })],
                    stop,
                ));
                item_idx += 1;
            }
            AssistantContent::ToolCall(tc) => {
                let call_id = tc.id.to_string();
                let name = tc.function.name.to_string();
                let arguments = Value::Object(tc.function.arguments.clone());
                records.push(step_record(
                    records.len(),
                    wire::call_step(&call_id, &name, arguments),
                    Vec::new(),
                    json!({}),
                ));
                if let Some((output, is_error)) = outputs.get(&call_id) {
                    records.push(step_record(
                        records.len(),
                        wire::result_step(&call_id, &name, *is_error, output),
                        Vec::new(),
                        json!({}),
                    ));
                }
                item_idx += 1;
            }
            AssistantContent::Text(t) => {
                if t.text.is_empty() {
                    continue;
                }
                records.push(step_record(
                    records.len(),
                    json!({ "type": "model_output" }),
                    vec![json!({ "type": "text", "text": t.text })],
                    json!({}),
                ));
                item_idx += 1;
            }
            _ => {}
        }
    }
    records
}

pub fn replaced_message_count(conversation: &Conversation, end: usize) -> usize {
    conversation
        .entries()
        .take(end)
        .filter(|entry| entry.author.is_none())
        .count()
}

fn persistent_seq(id: MessageId) -> i64 {
    i64::try_from(id.get()).unwrap_or(i64::MAX)
}

struct ShownEntry<'a> {
    seq: i64,
    item: &'a Shown,
}

const RECORD_STRIDE: i64 = 1024;

pub fn view_page_from_store<S: Store>(
    store: &S,
    cid: &str,
    durations: &HashMap<String, u64>,
    limit: usize,
    before: Option<i64>,
) -> AppResult<SessionRecordPage> {
    let conversation = rig_memory::load(store, LOG).map_err(session_error)?;
    let items = shown(store, &conversation).map_err(session_error)?;

    let visible: Vec<ShownEntry> = items
        .iter()
        .filter_map(|item| match item {
            Shown::Compaction { summary, .. } => Some(ShownEntry {
                seq: persistent_seq(*summary),
                item,
            }),
            Shown::Message { id, message, author: None } => match &**message {
                Message::User { .. } | Message::Assistant(_) => Some(ShownEntry {
                    seq: persistent_seq(*id),
                    item,
                }),
                _ => None,
            },
            _ => None,
        })
        .collect();

    let end = before
        .map(|cursor| cursor.div_euclid(RECORD_STRIDE))
        .and_then(|cursor| visible.iter().position(|entry| entry.seq >= cursor))
        .unwrap_or(visible.len());
    let start = end.saturating_sub(limit);
    let page_entries = &visible[start..end];

    let mut needed: HashSet<String> = HashSet::new();
    for entry in page_entries {
        if let Shown::Message { message, author: None, .. } = entry.item {
            if let Message::Assistant(assistant) = &**message {
                for part in assistant.content.iter() {
                    if let AssistantContent::ToolCall(tc) = part {
                        needed.insert(tc.id.to_string());
                    }
                }
            }
        }
    }
    let outputs = tool_outputs(&items, &needed);

    let mut records: Vec<SessionRecord> = Vec::new();
    for entry in page_entries {
        let base = entry.seq.saturating_mul(RECORD_STRIDE);
        let produced: Vec<Value> = match entry.item {
            Shown::Compaction { summary, replaced, ts } => vec![json!({
                "kind": "orch.compaction",
                "original_message_count": replaced,
                "ts": ts,
                "message_id": compaction_message_id(cid, *summary),
                "item_id": compaction_item_id(cid, *summary),
            })],
            Shown::Message { id, message, author: None } => match &**message {
                Message::User { content } => user_records(content),
                Message::Assistant(assistant) => {
                    assistant_records(cid, *id, &assistant.content, &outputs, durations)
                }
                _ => Vec::new(),
            },
            _ => Vec::new(),
        };
        for (offset, record) in produced.into_iter().enumerate() {
            records.push(SessionRecord {
                seq: base + (offset as i64).min(RECORD_STRIDE - 1),
                turn: 0,
                record,
            });
        }
    }

    Ok(SessionRecordPage {
        records,
        has_more: start > 0,
        earliest_seq: (start > 0).then(|| visible[start].seq.saturating_mul(RECORD_STRIDE)),
    })
}

pub async fn view_page(
    data_dir: &Path,
    session_id: &str,
    durations: HashMap<String, u64>,
    limit: usize,
    before: Option<i64>,
) -> AppResult<SessionRecordPage> {
    let store = open_store(data_dir, session_id)?;
    let cid = session_id.to_string();
    tokio::task::spawn_blocking(move || view_page_from_store(&store, &cid, &durations, limit, before))
        .await
        .map_err(|e| AppError::other(format!("transcript task failed: {e}")))?
}

pub fn reasoning_keys(
    cid: &str,
    conversation: &Conversation,
    first_new_id: u64,
    durations: Vec<u64>,
) -> Vec<(String, u64)> {
    let mut pending = durations.into_iter();
    let mut out = Vec::new();
    for entry in conversation.entries() {
        if entry.id.get() < first_new_id {
            continue;
        }
        let Message::Assistant(assistant) = entry.message else { continue };
        let mut item_idx = 0usize;
        for part in &assistant.content {
            match part {
                AssistantContent::Reasoning(r) => {
                    if r.text.is_empty() {
                        continue;
                    }
                    if let Some(secs) = pending.next() {
                        out.push((reasoning_item_id(cid, entry.id, item_idx), secs));
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
    out
}

