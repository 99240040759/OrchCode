use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::StreamExt;
use tauri::ipc::Channel;

use rig::agent::MultiTurnStreamItem;
use rig::completion::Message;
use rig::message::{ImageDetail, ImageMediaType, ToolResult, ToolResultContent, UserContent};
use rig::streaming::{StreamedAssistantContent, StreamedUserContent, StreamingPrompt};
use rig::OneOrMany;

use super::agent::ChatAgent;
use super::attachment::{AttachmentRef, FILE_PART_PREFIX, NOTE_PART_PREFIX, PDF_PART_PREFIX};
use crate::config;
use crate::events::ChatEvent;
use crate::tools::{parse_display_info, strip_tool_error_sentinel, tool_output_is_error};

const CANCEL_POLL_MS: u64 = 120;

pub struct TurnOutcome {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

pub struct RunResult {
    pub usage: Option<TurnOutcome>,
    pub reasoning_durations: Vec<u64>,
    pub completed: bool,
    pub cumulative_input_tokens: u64,
    pub cumulative_output_tokens: u64,
    pub cumulative_total_tokens: u64,
}

pub struct RunRequest {
    pub session_id: String,
    pub prompt: String,
    pub attachments: Vec<AttachmentRef>,
    pub supports_images: bool,
    pub workspace: Option<PathBuf>,
}

pub async fn run_chat(
    agent: ChatAgent,
    request: RunRequest,
    cancel: Arc<AtomicBool>,
    channel: Channel<ChatEvent>,
) -> RunResult {
    let ws_ref: Option<&Path> = request.workspace.as_deref();
    let user_message = build_user_message(
        ws_ref,
        &request.prompt,
        &request.attachments,
        request.supports_images,
    )
    .await;

    let mut stream = agent
        .stream_prompt(user_message)
        .conversation(request.session_id.clone())
        .max_turns(config::DEFAULT_MAX_TURNS)
        .tool_concurrency(config::DEFAULT_TOOL_CONCURRENCY)
        .await;

    let mut reasoning_started: Option<Instant> = None;
    let mut reasoning_durations: Vec<u64> = Vec::new();
    let mut usage: Option<TurnOutcome> = None;
    let mut cumulative_input: u64 = 0;
    let mut cumulative_output: u64 = 0;
    let mut cumulative_total: u64 = 0;

    loop {
        if cancel.load(Ordering::SeqCst) {
            close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
            let _ = channel.send(ChatEvent::Cancelled);
            return RunResult {
                usage,
                reasoning_durations,
                completed: false,
                cumulative_input_tokens: cumulative_input,
                cumulative_output_tokens: cumulative_output,
                cumulative_total_tokens: cumulative_total,
            };
        }

        let item = tokio::select! {
            biased;
            next = stream.next() => match next {
                Some(item) => item,
                None => break,
            },
            _ = tokio::time::sleep(Duration::from_millis(CANCEL_POLL_MS)) => continue,
        };

        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(content)) => match content {
                StreamedAssistantContent::Text(t) => {
                    close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                    let _ = channel.send(ChatEvent::Text { delta: t.text });
                }
                StreamedAssistantContent::Reasoning(r) => {
                    if reasoning_started.is_none() {
                        reasoning_started = Some(Instant::now());
                    }
                    let _ = channel.send(ChatEvent::Reasoning {
                        delta: r.display_text(),
                    });
                }
                StreamedAssistantContent::ReasoningDelta { reasoning, .. } => {
                    if reasoning_started.is_none() {
                        reasoning_started = Some(Instant::now());
                    }
                    let _ = channel.send(ChatEvent::Reasoning { delta: reasoning });
                }
                _ => {}
            },
            Ok(MultiTurnStreamItem::ToolExecutionStart {
                tool_call,
                internal_call_id,
            }) => {
                close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                let args_value = match &tool_call.function.arguments {
                    serde_json::Value::String(s) => serde_json::from_str::<serde_json::Value>(s)
                        .unwrap_or_else(|_| tool_call.function.arguments.clone()),
                    other => other.clone(),
                };
                let args = args_value.to_string();
                let display_info = parse_display_info(&tool_call.function.name, &args);
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
                let raw = stringify_tool_result(&tool_result);
                let is_error = tool_output_is_error(&raw);
                let _ = channel.send(ChatEvent::ToolResult {
                    id: internal_call_id,
                    output: strip_tool_error_sentinel(&raw).to_string(),
                    is_error,
                });
            }
            Ok(MultiTurnStreamItem::FinalResponse(res)) => {
                close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                let turn = res.usage();
                cumulative_input += turn.input_tokens;
                cumulative_output += turn.output_tokens;
                cumulative_total += turn.total_tokens;
                let _ = channel.send(ChatEvent::Usage {
                    input_tokens: cumulative_input,
                    output_tokens: cumulative_output,
                    total_tokens: cumulative_total,
                });
                usage = Some(TurnOutcome {
                    input_tokens: cumulative_input,
                    output_tokens: cumulative_output,
                    total_tokens: cumulative_total,
                });
            }
            Ok(_) => {}
            Err(e) => {
                close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                let _ = channel.send(ChatEvent::Error {
                    message: e.to_string(),
                });
                return RunResult {
                    usage,
                    reasoning_durations,
                    completed: false,
                    cumulative_input_tokens: cumulative_input,
                    cumulative_output_tokens: cumulative_output,
                    cumulative_total_tokens: cumulative_total,
                };
            }
        }
    }

    close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
    let _ = channel.send(ChatEvent::Done);

    RunResult {
        usage,
        reasoning_durations,
        completed: true,
        cumulative_input_tokens: cumulative_input,
        cumulative_output_tokens: cumulative_output,
        cumulative_total_tokens: cumulative_total,
    }
}

fn close_reasoning(
    started: &mut Option<Instant>,
    durations: &mut Vec<u64>,
    channel: &Channel<ChatEvent>,
) {
    let Some(start) = started.take() else { return };
    let duration_seconds = start.elapsed().as_secs().max(1);
    durations.push(duration_seconds);
    let _ = channel.send(ChatEvent::ReasoningDone { duration_seconds });
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

fn extract_pdf_text(path: &Path) -> Option<String> {
    let glob_path = path.to_string_lossy().replace('\\', "/");
    let loader = rig::loaders::PdfFileLoader::with_glob(&glob_path).ok()?;
    let mut text = String::new();
    for (_, content) in loader.read_with_path().ignore_errors() {
        if text.len() >= config::MAX_ATTACHMENT_BYTES {
            break;
        }
        text.push_str(&content);
        text.push_str("\n\n");
    }
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
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
    let Some(ws) = workspace else {
        return Vec::new();
    };
    let Ok(re) = regex::Regex::new(r"(?:@|@\[)([^\s\]]+)\]?") else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for cap in re.captures_iter(prompt) {
        let candidate = cap[1].trim();
        if candidate.is_empty() {
            continue;
        }
        if let Ok(resolved) = crate::tools::fs_util::resolve_in_workspace(ws, candidate) {
            if resolved.is_file() {
                out.push(resolved);
            }
        }
    }
    out
}

async fn build_user_message(
    workspace: Option<&Path>,
    prompt: &str,
    attachments: &[AttachmentRef],
    supports_images: bool,
) -> Message {
    let cap = config::MAX_ATTACHMENT_BYTES;
    let mut parts: Vec<UserContent> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut images: Vec<(String, ImageMediaType)> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    if !prompt.trim().is_empty() {
        parts.push(UserContent::text(prompt.to_string()));
    }

    let declared: Vec<(PathBuf, String, bool)> = attachments
        .iter()
        .map(|a| (PathBuf::from(&a.path), a.name.clone(), a.is_image))
        .collect();
    let mentioned: Vec<(PathBuf, String, bool)> = collect_mentioned_paths(workspace, prompt)
        .into_iter()
        .map(|p| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            (p, name, false)
        })
        .collect();

    for (path, display_name, declared_image) in declared.into_iter().chain(mentioned) {
        let canonical = dunce::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.insert(canonical) {
            continue;
        }

        if !path.is_file() {
            notes.push(format!("attached file not found: {display_name}"));
            continue;
        }

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let label = display_label(&path, workspace);
        let is_image = declared_image
            || matches!(
                ext.as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg"
            );

        let size = match tokio::fs::metadata(&path).await {
            Ok(m) => m.len() as usize,
            Err(e) => {
                notes.push(format!("cannot read attachment {label}: {e}"));
                continue;
            }
        };

        if ext == "pdf" {
            match extract_pdf_text(&path) {
                Some(text) => {
                    parts.push(UserContent::text(format!("{PDF_PART_PREFIX}{label}>\n{text}")))
                }
                None => notes.push(format!("PDF has no extractable text: {label}")),
            }
            continue;
        }

        if size > cap {
            notes.push(format!("attachment too large to include: {label}"));
            continue;
        }

        if is_image {
            if !supports_images {
                notes.push(format!(
                    "image attached but the selected model has no vision capability: {label}"
                ));
                continue;
            }
            match tokio::fs::read(&path).await {
                Ok(bytes) => {
                    let b64 = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &bytes,
                    );
                    images.push((b64, image_media_type(&ext)));
                }
                Err(e) => notes.push(format!("cannot read image {label}: {e}")),
            }
            continue;
        }

        match tokio::fs::read_to_string(&path).await {
            Ok(content) => parts.push(UserContent::text(format!(
                "{FILE_PART_PREFIX}{label}>\n{content}"
            ))),
            Err(e) => notes.push(format!("cannot read attachment {label} as text: {e}")),
        }
    }

    for (b64, media) in images {
        parts.push(UserContent::image_base64(
            b64,
            Some(media),
            Some(ImageDetail::Auto),
        ));
    }

    if !notes.is_empty() {
        parts.push(UserContent::text(format!(
            "{NOTE_PART_PREFIX}{}</note>",
            notes.join("; ")
        )));
    }

    if parts.is_empty() {
        parts.push(UserContent::text(prompt.to_string()));
    }

    let content = OneOrMany::many(parts)
        .unwrap_or_else(|_| OneOrMany::one(UserContent::text(prompt.to_string())));
    Message::User { content }
}

fn stringify_tool_result(tr: &ToolResult) -> String {
    let text: String = tr
        .content
        .iter()
        .filter_map(|c| match c {
            ToolResultContent::Text(t) => Some(t.text.as_str()),
            _ => None,
        })
        .collect();
    if text.is_empty() {
        "(no textual output)".to_string()
    } else {
        text
    }
}
