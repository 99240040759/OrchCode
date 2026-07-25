use rig::client::CompletionClient;
use rig::completion::{CompletionModel, Message};
use rig::message::{AssistantContent, ToolResultContent, UserContent};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::gateway::ModelInfo;
use crate::llm::attachment::is_payload_part;
use crate::llm::client::ChatClient;
use crate::persistence::SqliteMemory;

const KEEP_RECENT_USER_TURNS: usize = 4;

pub struct CompactionOutcome {
    pub original_message_count: usize,
    pub ts: i64,
}

pub async fn maybe_compact(
    memory: &SqliteMemory,
    client: &ChatClient,
    model_info: &ModelInfo,
    session_id: &str,
    total_tokens: u64,
) -> AppResult<Option<CompactionOutcome>> {
    if model_info.context_window == 0 {
        return Ok(None);
    }

    let ratio = total_tokens as f64 / model_info.context_window as f64;
    if ratio < config::COMPACTION_THRESHOLD_RATIO {
        return Ok(None);
    }

    let Some(input) = memory
        .get_compaction_input(session_id, KEEP_RECENT_USER_TURNS)
        .await?
    else {
        return Ok(None);
    };

    let transcript = render_transcript(&input.summarize);
    if transcript.trim().is_empty() {
        return Ok(None);
    }

    let summary = summarize(
        client,
        model_info,
        input.previous_summary.as_deref(),
        &transcript,
    )
    .await?;
    if summary.trim().is_empty() {
        return Err(AppError::other("compaction produced an empty summary"));
    }

    let original_message_count = input.prior_message_count + input.summarize.len();
    let ts = memory
        .apply_compaction(
            session_id,
            &summary,
            original_message_count,
            input.first_seq,
            input.summarize_upto_seq,
        )
        .await?;

    Ok(Some(CompactionOutcome {
        original_message_count,
        ts,
    }))
}

fn render_transcript(messages: &[Message]) -> String {
    messages
        .iter()
        .filter_map(|m| match m {
            Message::User { content } => {
                let parts: Vec<String> = content
                    .iter()
                    .filter_map(|c| match c {
                        UserContent::Text(t) if !is_payload_part(&t.text) => {
                            Some(format!("User: {}", t.text))
                        }
                        UserContent::ToolResult(tr) => {
                            let text: String = tr
                                .content
                                .iter()
                                .filter_map(|tc| match tc {
                                    ToolResultContent::Text(t) => Some(t.text.as_str()),
                                    _ => None,
                                })
                                .collect();
                            if text.is_empty() {
                                None
                            } else {
                                let snippet = if text.len() > 600 {
                                    format!("{}...", &text[..600])
                                } else {
                                    text
                                };
                                Some(format!("Tool Result: {snippet}"))
                            }
                        }
                        _ => None,
                    })
                    .collect();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("\n"))
                }
            }
            Message::Assistant { content, .. } => {
                let parts: Vec<String> = content
                    .iter()
                    .filter_map(|c| match c {
                        AssistantContent::Text(t) if !t.text.is_empty() => {
                            Some(format!("Assistant: {}", t.text))
                        }
                        AssistantContent::ToolCall(tc) => Some(format!(
                            "Tool call: {} ({})",
                            tc.function.name, tc.function.arguments
                        )),
                        _ => None,
                    })
                    .collect();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("\n"))
                }
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

async fn summarize(
    client: &ChatClient,
    model_info: &ModelInfo,
    previous_summary: Option<&str>,
    transcript: &str,
) -> AppResult<String> {
    let prior_context = match previous_summary {
        Some(prev) => format!(
            "Here is the summary of everything before this excerpt:\n---\n{prev}\n---\n\n\
Merge it with the new excerpt below into a single updated summary — do not just describe the new excerpt in isolation.\n\n"
        ),
        None => String::new(),
    };

    let summary_prompt = format!(
        "Produce a concise but complete summary of the following conversation excerpt. \
Capture: the user's goals, key decisions, files or code created or modified, important findings, and open items. \
Write in third-person past tense. Output only the summary, no preamble or sign-off.\n\n{prior_context}\
---\n{transcript}\n---"
    );

    let completion = client
        .completion_model(model_info.target_model_id())
        .completion_request(&summary_prompt)
        .send()
        .await
        .map_err(|e| AppError::other(format!("compaction model call failed: {e}")))?;

    match completion.choice.first() {
        AssistantContent::Text(t) => Ok(t.text.clone()),
        _ => Err(AppError::other(
            "model returned no text for compaction summary",
        )),
    }
}
