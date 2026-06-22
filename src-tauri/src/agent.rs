use anyhow::Result;
use rig::agent::AgentBuilder;
use rig::completion::{AssistantContent, Document, Prompt};
use rig::message::{Message, UserContent};
use rig::providers::openai;
use rig::client::CompletionClient;
use rig::streaming::{StreamedAssistantContent, StreamedUserContent, StreamingChat};
use rig::agent::MultiTurnStreamItem;
use dashmap::DashMap;
use futures::StreamExt;
use std::sync::LazyLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::{ipc::Channel, Manager};
use tokio_util::sync::CancellationToken;
use crate::{db, skills, tools::*, utils, appdata};
const DEFAULT_THRESHOLD: usize = 180_000;
const KEEP_LAST_N: usize = 10;
const SUMMARISE_PROMPT: &str = "You are a conversation memory compactor for an AI coding agent. \
Produce a maximally detailed, lossless summary containing:\n\
1. **Primary Goal** and sub-goals.\n\
2. **Files Modified/Created** — every path.\n\
3. **Tool Execution Log** — every tool call and outcome.\n\
4. **Pending Actions** — planned but not yet executed steps.\n\
5. **User Preferences** — style/behavior preferences expressed.\n\
6. **Errors & Blockers** — unresolved issues.\n\
Do NOT compress or drop any detail.";
pub static CANCEL_TOKENS: LazyLock<DashMap<String, CancellationToken>> = LazyLock::new(|| DashMap::new(4));
static TIKTOKEN: LazyLock<tiktoken_rs::CoreBPE> = LazyLock::new(|| tiktoken_rs::cl100k_base().expect("cl100k_base"));
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamChunk {
    TextDelta { content: String },
    ToolCall { tool_call_id: String, tool_name: String, args: Value },
    ToolResult { tool_call_id: String, tool_name: String, result: Value, status: String },
    TokenUpdate { input_tokens: u64, output_tokens: u64, turn: u32 },
    Summarize { saved_tokens: i64, total_tokens: i64 },
    Finish { duration_seconds: f64 },
    Error { message: String },
}
#[derive(Debug, Serialize, Deserialize)]
pub struct StreamRequest {
    pub thread_id: String,
    pub model_id: String,
    pub prompt_text: String,
    pub context_window: Option<u64>,
    pub attachments: Option<Value>,
    pub workspace_path: Option<String>,
    pub artifacts_path: Option<String>,
}
fn history_tokens(msgs: &[Message], preamble: &str) -> usize {
    let text: String = std::iter::once(preamble.to_string())
        .chain(msgs.iter().map(|m| match m {
            Message::User { content } => content.iter().map(|c| match c {
                UserContent::Text(t) => t.text.clone(), _ => String::new(),
            }).collect::<String>(),
            Message::Assistant { content, .. } => content.iter().map(|c| match c {
                AssistantContent::Text(t) => t.text.clone(),
                AssistantContent::ToolCall(tc) => tc.function.arguments.to_string(),
                _ => String::new(),
            }).collect::<String>(),
            Message::System { content } => content.clone(),
        }))
        .collect::<Vec<_>>().join(" ");
    TIKTOKEN.encode_ordinary(&text).len()
}
/// BUG-16: Guard that always removes cancel token on exit
struct CancelGuard { thread_id: String }
impl Drop for CancelGuard {
    fn drop(&mut self) { CANCEL_TOKENS.remove(&self.thread_id); }
}
pub async fn run_agent(req: StreamRequest, pool: SqlitePool, ch: Channel<StreamChunk>, cancel: CancellationToken, app: tauri::AppHandle) -> Result<()> {
    // BUG-16: ensure cancel token is always removed
    let _guard = CancelGuard { thread_id: req.thread_id.clone() };
    tracing::info!(thread_id=%req.thread_id, model=%req.model_id, "[agent] run_agent START");
    let start = std::time::Instant::now();
    let ws = req.workspace_path.clone().unwrap_or_default();
    let ap = req.artifacts_path.clone().unwrap_or_default();
    let token = crate::auth::require_token_async().await.map_err(|e| anyhow::anyhow!("{e}"))?;
    let model_base = utils::model_base_url(&req.model_id);
    let upstream_model = utils::strip_provider_prefix(&req.model_id).to_string();
    let oai = openai::Client::builder()
        .api_key(&token).base_url(&model_base).build()
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let skills = skills::list().unwrap_or_default();
    let skills_text = skills::section(&skills);
    let memories = db::memory_list(&pool, Some(&ws)).await.unwrap_or_default();
    let mem_docs: Vec<Document> = memories.iter().map(|m| Document {
        id: m.id.clone(), text: format!("[{}] {}", m.category, m.content),
        additional_props: Default::default(),
    }).collect();
    let preamble = if ws.is_empty() {
        format!("You are Orch Code, an expert AI coding assistant.\n\nSKILLS:\n{skills_text}\n\nRules: Be precise. Use tools as needed.")
    } else {
        format!("You are Orch Code, an expert AI coding assistant.\n\nWORKSPACE: {ws}\n\nSKILLS:\n{skills_text}\n\nRules: Be precise. Use tools as needed.")
    };
    let ws_id: String = if !ws.is_empty() { appdata::workspace_id(&ws) } else { String::new() };
    let agent = {
        let mut b = AgentBuilder::new(oai.completion_model(&upstream_model))
            .preamble(&preamble).temperature(0.35).max_tokens(32768);
        for doc in &mem_docs { b = b.context(&format!("[MEMORY:{}] {}", doc.id, doc.text)); }
        b.tool(ListDir { workspace_root: ws.clone() })
         .tool(ViewFile { workspace_root: ws.clone() })
         .tool(WriteToFile { workspace_root: ws.clone() })
         .tool(MultiReplace { workspace_root: ws.clone() })
         .tool(SearchWorkspace { workspace_root: ws.clone(), pool: pool.clone(), workspace_id: ws_id })
         .tool(RunCommand { workspace_root: ws.clone() })
         .tool(SearchWeb)
         .tool(GenerateImage { artifacts_path: ap.clone() })
         .build()
    };
    if db::thread_get(&pool, &req.thread_id).await?.is_none() {
        db::thread_create(&pool, &req.thread_id, req.workspace_path.as_deref()).await?;
    }
    let mut history: Vec<Message> = db::msg_list(&pool, &req.thread_id).await?
        .into_iter().filter_map(|m| db_msg_to_rig(&m)).collect();
    let user_id = uuid::Uuid::new_v4().to_string();
    db::msg_upsert(&pool, &req.thread_id, &db::Message {
        id: user_id, thread_id: req.thread_id.clone(), role: "user".into(),
        content: req.prompt_text.clone(), data: None, created_at: chrono::Utc::now().to_rfc3339(),
    }).await?;
    let current_prompt = req.prompt_text.clone();
    // Compaction check — tiktoken-rs for accurate count
    let est_tokens = history_tokens(&history, &preamble);
    let threshold = req.context_window.map(|w| (w as usize) * 4 / 5).unwrap_or(DEFAULT_THRESHOLD);
    if est_tokens >= threshold {
        if let Some(summary) = summarise_history(&history, &oai, &upstream_model).await {
            let keep_from = history.len().saturating_sub(KEEP_LAST_N);
            let recent = history[keep_from..].to_vec();
            history = std::iter::once(Message::User {
                content: rig::OneOrMany::one(UserContent::text(&format!("[CONTEXT COMPACTED]\n{summary}")))
            }).chain(recent).collect();
            db::msg_compact(&pool, &req.thread_id, &summary, KEEP_LAST_N as u32).await.ok();
            let new_tok = history_tokens(&history, &preamble);
            let _ = ch.send(StreamChunk::Summarize { saved_tokens: est_tokens as i64, total_tokens: new_tok as i64 });
        }
    }
    if cancel.is_cancelled() {
        let _ = ch.send(StreamChunk::Finish { duration_seconds: start.elapsed().as_secs_f64() });
        return Ok(());
    }
    tracing::info!(thread_id=%req.thread_id, history_len=%history.len(), "[agent] starting multi_turn stream");
    let mut stream = tokio::select! {
        s = agent.stream_chat(&current_prompt, history.clone()).multi_turn(200) => s,
        _ = cancel.cancelled() => {
            tracing::info!(thread_id=%req.thread_id, "[agent] cancelled before stream start");
            let _ = ch.send(StreamChunk::Finish { duration_seconds: start.elapsed().as_secs_f64() });
            return Ok(());
        },
    };
    let mut assistant_text = String::new();
    // BUG-25: track tool calls by ID for proper name/result forwarding
    let mut call_id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut call_name_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // Ordered segments: preserves text↔tools interleaving for DB reload
    let mut segments: Vec<Value> = Vec::new();
    let mut current_text = String::new();
    let mut current_tools: Vec<Value> = Vec::new();
    let mut item_count: u32 = 0;
    let mut text_chunks: u32 = 0;
    let mut turn_count: u32 = 0;
    while let Some(item) = stream.next().await {
        item_count += 1;
        if cancel.is_cancelled() {
            tracing::info!(thread_id=%req.thread_id, item_count, "[agent] cancelled mid-stream");
            break;
        }
        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(t))) => {
                text_chunks += 1;
                tracing::debug!(thread_id=%req.thread_id, text_chunks, len=%t.text.len(), "[agent] text_delta");
                let _ = ch.send(StreamChunk::TextDelta { content: t.text.clone() });
                // Flush tools segment when text resumes after tool calls
                if !current_tools.is_empty() {
                    segments.push(serde_json::json!({"type": "tools", "tools": std::mem::take(&mut current_tools)}));
                }
                assistant_text.push_str(&t.text);
                current_text.push_str(&t.text);
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::ToolCall { tool_call, internal_call_id })) => {
                tracing::info!(thread_id=%req.thread_id, tool=%tool_call.function.name, id=%tool_call.id, internal=%internal_call_id, "[agent] tool_call streamed");
                call_id_map.insert(internal_call_id.clone(), tool_call.id.clone());
                // BUG-25: track tool name by internal_call_id for result forwarding
                call_name_map.insert(internal_call_id, tool_call.function.name.clone());
                let _ = ch.send(StreamChunk::ToolCall {
                    tool_call_id: tool_call.id.clone(),
                    tool_name: tool_call.function.name.clone(),
                    args: tool_call.function.arguments.clone(),
                });
                // Flush current text segment before starting tool calls
                if !current_text.is_empty() {
                    segments.push(serde_json::json!({"type": "text", "content": &current_text}));
                    current_text.clear();
                }
                current_tools.push(serde_json::json!({
                    "id": tool_call.id,
                    "name": tool_call.function.name,
                    "args": tool_call.function.arguments,
                    "status": "pending"
                }));
            }
            Ok(MultiTurnStreamItem::StreamUserItem(StreamedUserContent::ToolResult { tool_result, internal_call_id })) => {
                let provider_id = call_id_map.remove(&internal_call_id)
                    .unwrap_or_else(|| tool_result.call_id.clone().unwrap_or_default());
                // BUG-25: look up tool name from our map
                let tool_name = call_name_map.remove(&internal_call_id).unwrap_or_default();
                tracing::info!(thread_id=%req.thread_id, %provider_id, %internal_call_id, %tool_name, "[agent] tool_result received");
                let _ = ch.send(StreamChunk::ToolResult {
                    tool_call_id: provider_id.clone(),
                    tool_name,
                    result: serde_json::Value::Null,
                    status: "success".into(),
                });
                // Update status in current_tools
                for tc in current_tools.iter_mut() {
                    if tc["id"].as_str() == Some(&provider_id) {
                        tc["status"] = serde_json::json!("success");
                    }
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::ToolCallDelta { .. })) => {}
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::ReasoningDelta { .. })) => {}
            Ok(MultiTurnStreamItem::StreamAssistantItem(other)) => {
                tracing::debug!(thread_id=%req.thread_id, "[agent] StreamAssistantItem other: {:?}", std::mem::discriminant(&other));
            }
            Ok(MultiTurnStreamItem::FinalResponse(fr)) => {
                tracing::info!(thread_id=%req.thread_id, pending_map=%call_id_map.len(), turns=turn_count, items=item_count, "[agent] FinalResponse received");
                if let Some(usage) = fr.usage() {
                    turn_count += 1;
                    let input_tok = usage.input_tokens as u64;
                    let output_tok = usage.output_tokens as u64;
                    tracing::info!(thread_id=%req.thread_id, turn_count, input_tok, output_tok, "[agent] CompletionCall (turn done)");
                    let _ = ch.send(StreamChunk::TokenUpdate { input_tokens: input_tok, output_tokens: output_tok, turn: turn_count });
                    let sm = app.state::<crate::state::AppStateManager>();
                    sm.update_tokens(&app, &req.thread_id, input_tok, output_tok).await;
                }
                // Resolve any tools still without a result
                for (internal_id, provider_id) in call_id_map.drain() {
                    let tool_name = call_name_map.remove(&internal_id).unwrap_or_default();
                    tracing::warn!(thread_id=%req.thread_id, %internal_id, %provider_id, "[agent] tool pending at FinalResponse — resolving as success");
                    let _ = ch.send(StreamChunk::ToolResult {
                        tool_call_id: provider_id,
                        tool_name,
                        result: serde_json::Value::Null,
                        status: "success".into(),
                    });
                }
                for ac in fr.content().iter() {
                    if let AssistantContent::Text(t) = ac {
                        tracing::debug!(thread_id=%req.thread_id, len=%t.text.len(), "[agent] FinalResponse text");
                        // BUG-28: append FinalResponse text instead of conditionally replacing
                        if !t.text.is_empty() {
                            if assistant_text.is_empty() {
                                assistant_text = t.text.clone();
                            }
                            // If we already have text from streaming, the FinalResponse text is a duplicate — skip
                        }
                    }
                    if let AssistantContent::ToolCall(tc) = ac {
                        tracing::warn!(thread_id=%req.thread_id, tool=%tc.function.name, "[agent] FinalResponse contained ToolCall (NOT re-emitting)");
                    }
                }
                break;
            }
            Ok(other) => {
                tracing::debug!(thread_id=%req.thread_id, "[agent] unhandled MultiTurnStreamItem variant: {:?}", std::mem::discriminant(&other));
            }
            Err(e) => {
                tracing::error!(thread_id=%req.thread_id, error=%e, "[agent] stream error");
                let _ = ch.send(StreamChunk::Error { message: e.to_string() });
                break;
            }
        }
    }
    tracing::info!(thread_id=%req.thread_id, item_count, text_chunks, turn_count, assistant_len=%assistant_text.len(), "[agent] stream loop exited");
    // Flush remaining segments
    if !current_tools.is_empty() {
        segments.push(serde_json::json!({"type": "tools", "tools": current_tools}));
    }
    if !current_text.is_empty() {
        segments.push(serde_json::json!({"type": "text", "content": current_text}));
    }
    let data_json = if segments.is_empty() { None } else { Some(serde_json::to_string(&segments).unwrap_or_default()) };
    if !assistant_text.is_empty() || data_json.is_some() {
        tracing::info!(thread_id=%req.thread_id, len=%assistant_text.len(), segments=%segments.len(), "[agent] persisting assistant message");
        db::msg_upsert(&pool, &req.thread_id, &db::Message {
            id: uuid::Uuid::new_v4().to_string(), thread_id: req.thread_id.clone(),
            role: "assistant".into(), content: assistant_text, data: data_json,
            created_at: chrono::Utc::now().to_rfc3339(),
        }).await?;
    } else {
        tracing::warn!(thread_id=%req.thread_id, "[agent] no assistant text to persist");
    }
    let elapsed = start.elapsed().as_secs_f64();
    tracing::info!(thread_id=%req.thread_id, elapsed, "[agent] sending Finish");
    // BUG-16: _guard drop handles CANCEL_TOKENS.remove automatically
    let _ = ch.send(StreamChunk::Finish { duration_seconds: elapsed });
    tracing::info!(thread_id=%req.thread_id, "[agent] run_agent END");
    Ok(())
}
async fn summarise_history(history: &[Message], oai: &openai::Client, model: &str) -> Option<String> {
    let transcript = history.iter().map(|m| match m {
        Message::User { content } => format!("[USER]\n{}", content.iter().map(|c| match c {
            UserContent::Text(t) => t.text.clone(), _ => "[tool-result]".into(),
        }).collect::<String>()),
        Message::Assistant { content, .. } => format!("[ASSISTANT]\n{}", content.iter().map(|c| match c {
            AssistantContent::Text(t) => t.text.clone(),
            AssistantContent::ToolCall(tc) => format!("[Tool: {}]", tc.function.name),
            _ => String::new(),
        }).collect::<String>()),
        Message::System { content } => format!("[SYSTEM]\n{content}"),
    }).collect::<Vec<_>>().join("\n\n---\n\n");
    let summariser = AgentBuilder::new(oai.completion_model(model))
        .preamble(SUMMARISE_PROMPT).temperature(0.2).max_tokens(8192).build();
    match summariser.prompt(&format!("Summarise:\n\n{transcript}")).await {
        Ok(resp) => if resp.is_empty() { None } else { Some(resp) },
        Err(_) => None,
    }
}
fn db_msg_to_rig(m: &db::Message) -> Option<Message> {
    match m.role.as_str() {
        "user" => Some(Message::User { content: rig::OneOrMany::one(UserContent::text(&m.content)) }),
        "system" => Some(Message::System { content: m.content.clone() }),
        "assistant" => {
            let mut text = m.content.clone();
            if let Some(ref data_str) = m.data {
                if let Ok(segments) = serde_json::from_str::<Vec<Value>>(data_str) {
                    let summary: Vec<String> = segments.iter().filter_map(|seg| {
                        // New format: {type:"tools", tools:[...]}
                        if seg["type"].as_str() == Some("tools") {
                            let tools = seg["tools"].as_array()?;
                            Some(tools.iter().filter_map(|t| {
                                let name = t["name"].as_str()?;
                                let status = t["status"].as_str().unwrap_or("unknown");
                                Some(format!("[Tool: {} → {}]", name, status))
                            }).collect::<Vec<_>>().join(" "))
                        // Old format: {name:"...", status:"..."}
                        } else if seg["name"].is_string() {
                            let name = seg["name"].as_str()?;
                            let status = seg["status"].as_str().unwrap_or("unknown");
                            Some(format!("[Tool: {} → {}]", name, status))
                        } else { None }
                    }).collect();
                    if !summary.is_empty() { text = format!("{}\n{}", summary.join(" "), text); }
                }
            }
            Some(Message::Assistant { id: None, content: rig::OneOrMany::one(AssistantContent::text(&text)) })
        }
        _ => None,
    }
}
