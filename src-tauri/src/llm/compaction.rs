use rig::client::CompletionClient;
use rig::completion::{CompletionModel, Message};
use rig::message::{AssistantContent, UserContent};

use crate::config;
use crate::error::AppResult;
use crate::gateway::ModelInfo;
use crate::llm::client::ChatClient;
use crate::persistence::SqliteMemory;

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

    let input = memory.get_compaction_input(session_id).await?;
    if input.messages_since.is_empty() {
        return Ok(None);
    }

    let transcript = render_transcript(&input.messages_since);
    if transcript.trim().is_empty() {
        return Ok(None);
    }

    let summary = summarize(client, model_info, input.previous_summary.as_deref(), &transcript).await?;
    let original_message_count = input.prior_message_count + input.messages_since.len();

    let ts = memory.insert_compaction_marker(session_id, &summary, original_message_count).await?;
    Ok(Some(CompactionOutcome { original_message_count, ts }))
}

fn render_transcript(messages: &[Message]) -> String {
    messages.iter().filter_map(|m| match m {
        Message::User { content } => {
            let text: String = content.iter()
                .filter_map(|c| if let UserContent::Text(t) = c { Some(t.text.as_str()) } else { None })
                .collect();
            if text.is_empty() { None } else { Some(format!("User: {text}")) }
        }
        Message::Assistant { content, .. } => {
            let parts: Vec<String> = content.iter().filter_map(|c| match c {
                AssistantContent::Text(t) if !t.text.is_empty() => Some(format!("Assistant: {}", t.text)),
                AssistantContent::ToolCall(tc) => Some(format!("Tool call: {} ({})", tc.function.name, tc.function.arguments)),
                _ => None,
            }).collect();
            if parts.is_empty() { None } else { Some(parts.join("\n")) }
        }
        _ => None,
    }).collect::<Vec<_>>().join("\n\n")
}

async fn summarize(client: &ChatClient, model_info: &ModelInfo, previous_summary: Option<&str>, transcript: &str) -> AppResult<String> {
    let target_model = model_info.id.strip_prefix("opencode/").unwrap_or(&model_info.id);

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
        .completion_model(target_model)
        .completion_request(&summary_prompt)
        .send()
        .await
        .map_err(|e| crate::error::AppError::other(format!("compaction model call failed: {e}")))?;

    match completion.choice.first() {
        AssistantContent::Text(t) => Ok(t.text.clone()),
        _ => Err(crate::error::AppError::other("model returned no text for compaction summary")),
    }
}
