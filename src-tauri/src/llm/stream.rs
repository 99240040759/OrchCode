use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use futures::StreamExt;
use tauri::ipc::Channel;

use rig::agent::MultiTurnStreamItem;
use rig::completion::Message;
use rig::message::{ImageDetail, ImageMediaType, ToolResult, ToolResultContent, UserContent};
use rig::streaming::{StreamedAssistantContent, StreamedUserContent, StreamingPrompt};
use rig::OneOrMany;

use super::agent::ChatAgent;
use super::attachment::AttachmentRef;
use crate::config;
use crate::events::ChatEvent;
use crate::tools::parse_display_info;

pub struct TurnOutcome {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

pub async fn run_chat(
    agent: ChatAgent,
    session_id: String,
    prompt: String,
    attachments: Vec<AttachmentRef>,
    supports_images: bool,
    max_turns: usize,
    tool_concurrency: usize,
    cancel: Arc<AtomicBool>,
    workspace: Option<Arc<std::path::PathBuf>>,
    channel: Channel<ChatEvent>,
) -> Option<TurnOutcome> {
    let ws_ref: Option<&Path> = workspace.as_deref().map(|p| p.as_path());
    let user_message = build_user_message(ws_ref, &prompt, &attachments, supports_images).await;

    let mut stream = agent
        .stream_prompt(user_message)
        .conversation(session_id)
        .max_turns(max_turns)
        .tool_concurrency(tool_concurrency)
        .await;

    let mut reasoning_started: Option<Instant> = None;

    while let Some(item) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            let _ = channel.send(ChatEvent::Cancelled);
            return None;
        }

        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(content)) => match content {
                StreamedAssistantContent::Text(t) => {
                    finish_reasoning(&mut reasoning_started, &channel);
                    let _ = channel.send(ChatEvent::Text { delta: t.text });
                }
                StreamedAssistantContent::Reasoning(r) => {
                    if reasoning_started.is_none() {
                        reasoning_started = Some(Instant::now());
                    }
                    let _ = channel.send(ChatEvent::Reasoning { delta: r.display_text() });
                }
                _ => {}
            },
            Ok(MultiTurnStreamItem::ToolExecutionStart { tool_call, internal_call_id }) => {
                finish_reasoning(&mut reasoning_started, &channel);
                let args_value = match &tool_call.function.arguments {
                    serde_json::Value::String(s) => {
                        serde_json::from_str::<serde_json::Value>(s)
                            .unwrap_or(tool_call.function.arguments.clone())
                    }
                    other => other.clone(),
                };
                let args = args_value.to_string();
                let display_info = parse_display_info(&tool_call.function.name, &args, ws_ref);
                let _ = channel.send(ChatEvent::ToolCall {
                    id: internal_call_id,
                    name: tool_call.function.name.clone(),
                    args,
                    display_info,
                });
            }
            Ok(MultiTurnStreamItem::StreamUserItem(StreamedUserContent::ToolResult {
                tool_result,
                internal_call_id,
            })) => {
                let output = stringify_tool_result(&tool_result);
                let is_error = output.starts_with("Error:");
                let _ = channel.send(ChatEvent::ToolResult {
                    id: internal_call_id,
                    output,
                    is_error,
                });
            }
            Ok(MultiTurnStreamItem::FinalResponse(res)) => {
                finish_reasoning(&mut reasoning_started, &channel);
                let usage = res.usage();
                let _ = channel.send(ChatEvent::Usage {
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    total_tokens: usage.total_tokens,
                });
                let _ = channel.send(ChatEvent::Done { output: res.output().to_string() });
                return Some(TurnOutcome {
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    total_tokens: usage.total_tokens,
                });
            }
            Ok(_) => {}
            Err(e) => {
                finish_reasoning(&mut reasoning_started, &channel);
                let _ = channel.send(ChatEvent::Error { message: e.to_string() });
                return None;
            }
        }
    }

    None
}

fn finish_reasoning(started: &mut Option<Instant>, channel: &Channel<ChatEvent>) {
    if let Some(start) = started.take() {
        let duration_seconds = start.elapsed().as_secs().max(1);
        let _ = channel.send(ChatEvent::ReasoningDone { duration_seconds });
    }
}

fn image_media_type(ext: &str) -> ImageMediaType {
    match ext {
        "jpg" | "jpeg" => ImageMediaType::JPEG,
        "webp" => ImageMediaType::WEBP,
        "gif" => ImageMediaType::GIF,
        "svg" => ImageMediaType::SVG,
        _ => ImageMediaType::PNG,
    }
}

fn extract_pdf_text(path: &Path, cap: usize) -> Option<String> {
    let glob_path = path.to_string_lossy().replace('\\', "/");
    let loader = rig::loaders::PdfFileLoader::with_glob(&glob_path).ok()?;
    let mut text = String::new();
    for (_, content) in loader.read_with_path().ignore_errors() {
        if text.len() >= cap { break; }
        text.push_str(&content);
        text.push_str("\n\n");
    }
    if text.trim().is_empty() { None } else { Some(text) }
}

fn display_label(path: &Path, workspace: Option<&Path>) -> String {
    workspace
        .and_then(|ws| path.strip_prefix(ws).ok())
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| {
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string_lossy().to_string())
        })
}

fn collect_mentioned_paths(workspace: Option<&Path>, prompt: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let Some(ws) = workspace else { return out; };
    let Ok(re) = regex::Regex::new(r"(?:@|@\[)([a-zA-Z0-9_\-./\\]+?\.[a-zA-Z0-9]+)\]?") else { return out; };

    for cap in re.captures_iter(prompt) {
        if let Ok(resolved) = crate::tools::fs_util::resolve_in_workspace(ws, cap[1].trim()) {
            if resolved.is_file() {
                let key = resolved.to_string_lossy().to_string();
                if seen.insert(key) {
                    out.push(resolved);
                }
            }
        }
    }

    out
}

async fn build_user_message(workspace: Option<&Path>, prompt: &str, attachments: &[AttachmentRef], supports_images: bool) -> Message {
    let cap = config::MAX_ATTACHMENT_BYTES;
    let mut text_sections: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut images: Vec<(String, ImageMediaType)> = Vec::new();

    let mentioned = collect_mentioned_paths(workspace, prompt);
    let attached_paths: Vec<(PathBuf, String, bool)> = attachments.iter()
        .map(|a| (PathBuf::from(&a.path), a.name.clone(), a.is_image))
        .collect();

    for (path, display_name, declared_image) in attached_paths.into_iter()
        .chain(mentioned.into_iter().map(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            (p, name, false)
        }))
    {
        if !path.is_file() {
            notes.push(format!("[Attached file not found: {display_name}]"));
            continue;
        }
        let ext = path.extension().and_then(|s| s.to_str()).map(|s| s.to_lowercase()).unwrap_or_default();
        let label = display_label(&path, workspace);
        let is_image = declared_image || matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg");

        if ext == "pdf" {
            if let Some(text) = extract_pdf_text(&path, cap) {
                text_sections.push(format!("[Attached PDF: {label}]\n{text}"));
            }
            continue;
        }

        if is_image {
            let too_big = std::fs::metadata(&path).map(|m| m.len() as usize > cap).unwrap_or(true);
            if too_big {
                notes.push(format!("[Attached image too large to include: {label}]"));
                continue;
            }
            if !supports_images {
                notes.push(format!("[Image attached but the selected model has no vision capability: {label}]"));
                continue;
            }
            if let Ok(bytes) = tokio::fs::read(&path).await {
                let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                images.push((b64, image_media_type(&ext)));
            }
            continue;
        }

        let too_big = std::fs::metadata(&path).map(|m| m.len() as usize > cap).unwrap_or(true);
        if too_big {
            notes.push(format!("[Attached file too large to include: {label}]"));
            continue;
        }
        if let Ok(content) = tokio::fs::read_to_string(&path).await {
            text_sections.push(format!("[Attached File: {label}]\n```\n{content}\n```"));
        }
    }

    let mut body = prompt.to_string();
    if !text_sections.is_empty() {
        body.push_str("\n\n");
        body.push_str(&text_sections.join("\n\n"));
    }
    if !notes.is_empty() {
        body.push_str("\n\n");
        body.push_str(&notes.join("\n"));
    }

    let mut parts: Vec<UserContent> = vec![UserContent::text(body)];
    for (b64, media) in images {
        parts.push(UserContent::image_base64(b64, Some(media), Some(ImageDetail::Auto)));
    }

    let content = OneOrMany::many(parts).unwrap_or_else(|_| OneOrMany::one(UserContent::text(prompt.to_string())));
    Message::User { content }
}

fn stringify_tool_result(tr: &ToolResult) -> String {
    let text: String = tr.content.iter()
        .filter_map(|c| match c {
            ToolResultContent::Text(t) => Some(t.text.as_str()),
            _ => None,
        })
        .collect();
    if text.is_empty() { "(no textual output)".to_string() } else { text }
}
