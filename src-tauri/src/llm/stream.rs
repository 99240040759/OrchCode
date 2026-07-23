use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use futures::StreamExt;
use tauri::ipc::Channel;

use rig::agent::MultiTurnStreamItem;
use rig::message::{ToolResult, ToolResultContent};
use rig::streaming::{StreamedAssistantContent, StreamedUserContent, StreamingPrompt};

use super::agent::ChatAgent;
use crate::events::ChatEvent;
use crate::tools::parse_display_info;

const MENTION_MAX_BYTES: usize = 1024 * 1024;

pub async fn run_chat(
    agent: ChatAgent,
    session_id: String,
    prompt: String,
    max_turns: usize,
    tool_concurrency: usize,
    cancel: Arc<AtomicBool>,
    workspace: Option<Arc<std::path::PathBuf>>,
    channel: Channel<ChatEvent>,
) {
    let ws_ref: Option<&Path> = workspace.as_deref().map(|p| p.as_path());
    let resolved_prompt = resolve_prompt_mentions(ws_ref, &prompt).await;

    let mut stream = agent
        .stream_prompt(resolved_prompt)
        .conversation(session_id)
        .max_turns(max_turns)
        .tool_concurrency(tool_concurrency)
        .await;

    let mut reasoning_started: Option<Instant> = None;

    while let Some(item) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            let _ = channel.send(ChatEvent::Cancelled);
            return;
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
                return;
            }
            Ok(_) => {}
            Err(e) => {
                finish_reasoning(&mut reasoning_started, &channel);
                let _ = channel.send(ChatEvent::Error { message: e.to_string() });
                return;
            }
        }
    }
}

fn finish_reasoning(started: &mut Option<Instant>, channel: &Channel<ChatEvent>) {
    if let Some(start) = started.take() {
        let duration_seconds = start.elapsed().as_secs().max(1);
        let _ = channel.send(ChatEvent::ReasoningDone { duration_seconds });
    }
}

async fn resolve_prompt_mentions(workspace: Option<&Path>, prompt: &str) -> String {
    let workspace = match workspace {
        Some(ws) => ws,
        None => return prompt.to_string(),
    };

    let mention_re = match regex::Regex::new(r"(?:@|@\[)([a-zA-Z0-9_\-./\\]+?\.[a-zA-Z0-9]+)\]?") {
        Ok(re) => re,
        Err(_) => return prompt.to_string(),
    };

    let attachment_re = match regex::Regex::new(r"\[Attached (?:file|image|document): [^\s—]+ — ([^\]]+)\]") {
        Ok(re) => re,
        Err(_) => return prompt.to_string(),
    };

    let mut resolved_files = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut process = |rel_path: &str| -> Option<String> {
        let trimmed = rel_path.trim();
        if trimmed.is_empty() || seen.contains(trimmed) { return None; }
        seen.insert(trimmed.to_string());
        crate::tools::fs_util::resolve_in_workspace(workspace, trimmed)
            .ok()
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string())
    };

    let mut paths: Vec<String> = Vec::new();
    for cap in mention_re.captures_iter(prompt) {
        if let Some(p) = process(cap[1].trim()) {
            paths.push(p);
        }
    }
    for cap in attachment_re.captures_iter(prompt) {
        if let Some(p) = process(cap[1].trim()) {
            paths.push(p);
        }
    }

    for path_str in paths {
        let p = std::path::Path::new(&path_str);
        let ext = p.extension().and_then(|s| s.to_str()).map(|s| s.to_lowercase()).unwrap_or_default();
        let rel = p.strip_prefix(workspace).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| path_str.clone());

        match ext.as_str() {
            "pdf" => {
                let glob_path = path_str.replace('\\', "/");
                let read_res: Option<String> = (|| {
                    let loader = rig::loaders::PdfFileLoader::with_glob(&glob_path).ok()?;
                    let docs = loader.read_with_path().ignore_errors();
                    let mut text = String::new();
                    for (_, content) in docs {
                        if text.len() >= MENTION_MAX_BYTES { break; }
                        text.push_str(&content);
                        text.push_str("\n\n");
                    }
                    if text.trim().is_empty() { None } else { Some(text) }
                })();
                if let Some(text) = read_res {
                    resolved_files.push(format!("[Attached PDF: {rel}]\n{text}"));
                }
            }
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" => {
                let meta = match std::fs::metadata(p) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.len() as usize > MENTION_MAX_BYTES { continue; }
                if let Ok(bytes) = tokio::fs::read(p).await {
                    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                    let mime = match ext.as_str() {
                        "png" => "image/png",
                        "jpg" | "jpeg" => "image/jpeg",
                        "webp" => "image/webp",
                        "gif" => "image/gif",
                        _ => "image/svg+xml",
                    };
                    resolved_files.push(format!("[Attached Image: {rel}]\ndata:{mime};base64,{b64}"));
                }
            }
            _ => {
                let meta = match std::fs::metadata(p) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.len() as usize > MENTION_MAX_BYTES { continue; }
                if let Ok(content) = tokio::fs::read_to_string(p).await {
                    resolved_files.push(format!("[Attached File: {rel}]\n```\n{content}\n```"));
                }
            }
        }
    }

    if resolved_files.is_empty() {
        prompt.to_string()
    } else {
        format!("{}\n\n{}", prompt, resolved_files.join("\n\n"))
    }
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
