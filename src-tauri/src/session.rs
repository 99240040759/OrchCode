use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rig::completion::Message;
use rig::conversation::{Author, Conversation, MessageId};
use rig::tool::Tool;
use rig::message::{
    AssistantContent, DocumentData, DocumentSourceKind, MimeType, ToolResultContent, UserContent,
};
use rig_memory::{as_of, history, summary_in, Compacted, DirStore, LogRecord, SessionError, Store};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::llm::{is_payload_part, payload_part_label};
use crate::persistence::{
    AttachmentView, MessageItemView, MessageView, SessionViewPage,
};
use crate::tools::{parse_display_info, RunCommand};

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

pub async fn load(data_dir: &Path, session_id: &str) -> AppResult<Conversation> {
    let store = open_store(data_dir, session_id)?;
    tokio::task::spawn_blocking(move || rig_memory::load(&store, LOG).map_err(session_error))
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

fn tool_outputs(items: &[Shown]) -> HashMap<String, (Option<String>, bool)> {
    let mut outputs = HashMap::new();
    for item in items {
        let Shown::Message { message, .. } = item else { continue };
        let Message::User { content } = &**message else { continue };
        for part in content {
            if let UserContent::ToolResult(result) = part {
                let output = (result.name == *<RunCommand as Tool>::NAME)
                    .then(|| render_tool_result(result.content.iter()));
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
                        if !crate::llm::is_mention_context_part(&t.text) {
                            let path = label
                                .split_once("#L")
                                .map(|(path, _)| path)
                                .unwrap_or(&label)
                                .to_string();
                            attachments.push(AttachmentView {
                                name: crate::util::basename(&path),
                                is_image: false,
                                path: Some(path),
                                data_url: None,
                            });
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
                    path: None,
                    data_url,
                });
            }
            UserContent::Document(doc) => {
                let data_url = match &doc.data {
                    DocumentData::File(DocumentSourceKind::Base64(b64)) => {
                        Some(format!("data:application/octet-stream;base64,{b64}"))
                    }
                    DocumentData::File(DocumentSourceKind::Url(url)) => Some(url.clone()),
                    _ => None,
                };
                attachments.push(AttachmentView {
                    name: "document".to_string(),
                    is_image: false,
                    path: None,
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
    outputs: &HashMap<String, (Option<String>, bool)>,
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
                let display_info = parse_display_info(tc.function.name.as_ref(), &args);
                let entry = outputs.get(&tc.id.to_string());
                let status = match entry {
                    Some((_, false)) => "done",
                    Some((_, true)) => "error",
                    None => "pending",
                };
                items.push(MessageItemView::ToolCall {
                    id: stable_id(cid, id.get(), item_idx, Some("tool")),
                    name: tc.function.name.to_string(),
                    args,
                    output: entry.and_then(|(output, _)| {
                        output
                            .as_deref()
                            .map(|text| crate::util::clip_middle(text, config::MAX_VIEW_TOOL_OUTPUT_CHARS))
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
        let items = shown(&store, &conversation).map_err(session_error)?;

        // Filter visible items and collect sequence numbers without decoding message contents
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
            .and_then(|cursor| visible.iter().position(|entry| entry.seq >= cursor))
            .unwrap_or(visible.len());
        let start = end.saturating_sub(limit);
        let page_entries = &visible[start..end];

        // Only build MessageViews (and decode/resize images) for the paginated slice
        let outputs = tool_outputs(&items);
        let mut messages = Vec::with_capacity(page_entries.len());
        for entry in page_entries {
            match entry.item {
                Shown::Compaction { summary, replaced, ts } => {
                    messages.push(MessageView {
                        id: compaction_message_id(&cid, *summary),
                        role: "system".to_string(),
                        items: vec![MessageItemView::CompactionNotice {
                            id: compaction_item_id(&cid, *summary),
                            original_message_count: *replaced,
                            ts: *ts,
                        }],
                        attachments: Vec::new(),
                    });
                }
                Shown::Message { id, message, author: None } => {
                    let view = match &**message {
                        Message::User { content } => user_view(&cid, *id, content),
                        Message::Assistant(assistant) => {
                            assistant_view(&cid, *id, &assistant.content, &outputs, &durations)
                        }
                        _ => None,
                    };
                    if let Some(view) = view {
                        messages.push(view);
                    }
                }
                _ => {}
            }
        }

        Ok(SessionViewPage {
            messages,
            has_more: start > 0,
            earliest_message_id: (start > 0).then(|| visible[start].seq),
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

