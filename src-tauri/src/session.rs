use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rig::completion::Message;
use rig::conversation::{Author, Conversation, MessageId};
use rig::message::{
    AssistantContent, DocumentSourceKind, MimeType, ToolResultContent, UserContent,
};
use rig_memory::{as_of, history, summary_in, Compacted, DirStore, LogRecord, SessionError, Store};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::llm::{is_payload_part, payload_part_label};
use crate::persistence::{
    AttachmentView, MessageItemView, MessageView, SessionViewPage,
};
use crate::tools::parse_display_info;

pub const LOG: &str = "main";

pub fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn session_error(error: SessionError) -> AppError {
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

pub async fn load(data_dir: &Path, session_id: &str) -> AppResult<Conversation> {
    let store = open_store(data_dir, session_id)?;
    tokio::task::spawn_blocking(move || rig_memory::load(&store, LOG).map_err(session_error))
        .await
        .map_err(|e| AppError::other(format!("conversation load task failed: {e}")))?
}

pub async fn destroy(data_dir: &Path, session_id: &str) -> AppResult<()> {
    let store = open_store(data_dir, session_id)?;
    let dir = conversations_root(data_dir).join(session_id);
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        store.destroy().map_err(AppError::Io)?;
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(AppError::Io)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::other(format!("conversation delete task failed: {e}")))?
}

fn stable_id(cid: &str, message: u64, item_idx: usize, kind: Option<&str>) -> String {
    crate::util::stable_hash_hex(&format!("{cid}:{message}:{item_idx}:{}", kind.unwrap_or("")))
}

pub fn message_view_id(cid: &str, id: MessageId) -> String {
    stable_id(cid, id.get(), 0, None)
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

fn shown(store: &DirStore, conversation: &Conversation) -> Result<Vec<Shown>, SessionError> {
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
        let made = records.iter().find_map(|(stamp, record)| match record {
            LogRecord::Change(recorded) if summary_in(&recorded.change) == Some(compacted.summary) => {
                Some((stamp.n, stamp.t))
            }
            _ => None,
        });
        let Some((n, t)) = made else { continue };
        let Ok(before) = as_of(store, LOG, n) else { continue };
        let mut originals: Vec<Shown> = Vec::new();
        for id in &compacted.replaced {
            let Some(at) = before.index_of(*id) else { continue };
            let Some(entry) = before.entry(at) else { continue };
            originals.push(Shown::Message {
                id: *id,
                message: entry.message,
                author: entry.author,
            });
        }
        let position = list.iter().position(
            |item| matches!(item, Shown::Message { id, .. } if *id == compacted.summary),
        );
        let Some(position) = position else { continue };
        let replaced = originals
            .iter()
            .filter(|item| matches!(item, Shown::Message { author: None, .. }))
            .count();
        originals.push(Shown::Compaction {
            summary: compacted.summary,
            replaced,
            ts: i64::try_from(t).unwrap_or(0),
        });
        let _ = list.splice(position..=position, originals);
    }
    Ok(list)
}

fn tool_outputs(items: &[Shown]) -> HashMap<String, (String, bool)> {
    let mut outputs = HashMap::new();
    for item in items {
        let Shown::Message { message, .. } = item else { continue };
        let Message::User { content } = &**message else { continue };
        for part in content {
            if let UserContent::ToolResult(result) = part {
                let output: String = result
                    .content
                    .iter()
                    .filter_map(|c| match c {
                        ToolResultContent::Text(t) => Some(t.text.as_str()),
                        _ => None,
                    })
                    .collect();
                outputs.insert(result.call.to_string(), (output, result.is_error));
            }
        }
    }
    outputs
}

fn user_view(cid: &str, id: MessageId, content: &[UserContent]) -> Option<MessageView> {
    let mut text = String::new();
    let mut attachments: Vec<AttachmentView> = Vec::new();
    for part in content {
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
        return None;
    }
    Some(MessageView {
        id: message_view_id(cid, id),
        role: "user".to_string(),
        items: if text.is_empty() {
            Vec::new()
        } else {
            vec![MessageItemView::Text {
                id: stable_id(cid, id.get(), 0, Some("text")),
                text,
            }]
        },
        attachments,
    })
}

fn assistant_view(
    cid: &str,
    id: MessageId,
    content: &[AssistantContent],
    outputs: &HashMap<String, (String, bool)>,
    durations: &HashMap<String, u64>,
) -> Option<MessageView> {
    let mut items: Vec<MessageItemView> = Vec::new();
    let mut item_idx = 0usize;
    for part in content {
        match part {
            AssistantContent::Reasoning(r) => {
                if r.text.is_empty() {
                    continue;
                }
                let item_id = reasoning_item_id(cid, id, item_idx);
                let duration_seconds = durations.get(&item_id).copied();
                items.push(MessageItemView::Reasoning {
                    id: item_id,
                    text: r.text.clone(),
                    duration_seconds,
                });
                item_idx += 1;
            }
            AssistantContent::ToolCall(tc) => {
                let args = serde_json::to_string(&tc.function.arguments).unwrap_or_default();
                let display_info = parse_display_info(&tc.function.name.to_string(), &args);
                let entry = outputs.get(&tc.id.to_string());
                let status = match entry {
                    Some((_, false)) => "done",
                    _ => "error",
                };
                items.push(MessageItemView::ToolCall {
                    id: stable_id(cid, id.get(), item_idx, Some("tool")),
                    name: tc.function.name.to_string(),
                    args,
                    output: entry.map(|(output, _)| {
                        crate::util::clip_middle(output, config::MAX_VIEW_TOOL_OUTPUT_CHARS)
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
                    id: stable_id(cid, id.get(), item_idx, Some("text")),
                    text: t.text.clone(),
                });
                item_idx += 1;
            }
            _ => {}
        }
    }
    if items.is_empty() {
        return None;
    }
    Some(MessageView {
        id: message_view_id(cid, id),
        role: "assistant".to_string(),
        items,
        attachments: Vec::new(),
    })
}

fn build_views(
    cid: &str,
    store: &DirStore,
    conversation: &Conversation,
    durations: &HashMap<String, u64>,
) -> Result<Vec<MessageView>, SessionError> {
    let items = shown(store, conversation)?;
    let outputs = tool_outputs(&items);
    let mut views = Vec::with_capacity(items.len());
    for item in &items {
        match item {
            Shown::Compaction { summary, replaced, ts } => views.push(MessageView {
                id: compaction_message_id(cid, *summary),
                role: "system".to_string(),
                items: vec![MessageItemView::CompactionNotice {
                    id: compaction_item_id(cid, *summary),
                    original_message_count: *replaced,
                    ts: *ts,
                }],
                attachments: Vec::new(),
            }),
            Shown::Message { author: Some(_), .. } => {}
            Shown::Message { id, message, author: None } => match &**message {
                Message::User { content } => views.extend(user_view(cid, *id, content)),
                Message::Assistant(assistant) => {
                    views.extend(assistant_view(cid, *id, &assistant.content, &outputs, durations));
                }
                _ => {}
            },
        }
    }
    Ok(views)
}

pub async fn view_page(
    data_dir: &Path,
    session_id: &str,
    durations: HashMap<String, u64>,
    limit: usize,
    before: Option<i64>,
) -> AppResult<SessionViewPage> {
    let store = open_store(data_dir, session_id)?;
    let cid = session_id.to_string();
    tokio::task::spawn_blocking(move || -> AppResult<SessionViewPage> {
        let conversation = rig_memory::load(&store, LOG).map_err(session_error)?;
        let views = build_views(&cid, &store, &conversation, &durations).map_err(session_error)?;
        let end = match before {
            Some(at) => usize::try_from(at).unwrap_or(0).min(views.len()),
            None => views.len(),
        };
        let start = end.saturating_sub(limit);
        let messages: Vec<MessageView> = views.into_iter().skip(start).take(end - start).collect();
        Ok(SessionViewPage {
            messages,
            has_more: start > 0,
            earliest_seq: Some(start as i64),
        })
    })
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
    'messages: for entry in conversation.entries() {
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
                    match pending.next() {
                        Some(secs) => out.push((reasoning_item_id(cid, entry.id, item_idx), secs)),
                        None => break 'messages,
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
