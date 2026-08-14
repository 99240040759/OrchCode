use std::collections::HashSet;
use std::path::{Path, PathBuf};

use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use futures::StreamExt;
use rig::agent::{Agent, MultiTurnStreamItem};
use rig::client::{AgentClientExt, CompletionClient};
use rig::completion::{CompletionModel, Message};
use rig::message::{AssistantContent, ImageDetail, ImageMediaType, ToolResult, ToolResultContent, UserContent};
use rig::memory::ConversationMemory;
use rig::streaming::{StreamedAssistantContent, StreamedUserContent, StreamingPrompt};
use rig::OneOrMany;
use serde::Deserialize;
use tauri::ipc::Channel;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::events::ChatEvent;
use crate::gateway::ModelInfo;
use crate::persistence::SqliteMemory;
use crate::tools::{parse_display_info, strip_tool_error_sentinel, tool_output_is_error, ToolContext};

pub type ChatClient = rig::providers::openai::CompletionsClient;
pub type ChatModel = rig::providers::openai::completion::CompletionModel<reqwest::Client>;
pub type ChatAgent = Agent<ChatModel>;

pub fn build_client(jwt: &str) -> AppResult<ChatClient> {
    let client = rig::providers::openai::Client::builder()
        .api_key(jwt)
        .base_url(&config::inference_base_url())
        .build()
        .map_err(|e| AppError::other(format!("failed to build inference client: {e:?}")))?
        .completions_api();
    Ok(client)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub path: String,
    pub name: String,
    pub is_image: bool,
}

pub const FILE_PART_PREFIX: &str = "<file:";
pub const PDF_PART_PREFIX: &str = "<pdf:";
pub const NOTE_PART_PREFIX: &str = "<note>";

pub fn is_payload_part(text: &str) -> bool {
    text.starts_with(FILE_PART_PREFIX)
        || text.starts_with(PDF_PART_PREFIX)
        || text.starts_with(NOTE_PART_PREFIX)
}

pub fn payload_part_label(text: &str) -> Option<String> {
    let rest = text
        .strip_prefix(FILE_PART_PREFIX)
        .or_else(|| text.strip_prefix(PDF_PART_PREFIX))?;
    let end = rest.find('>')?;
    let label = &rest[..end];
    if label.is_empty() {
        None
    } else {
        Some(label.to_string())
    }
}

pub fn build_agent(
    client: &ChatClient,
    model: &ModelInfo,
    ctx: &ToolContext,
    memory: impl ConversationMemory + 'static,
    data_dir: &Path,
    workspace: Option<&Path>,
) -> ChatAgent {
    let preamble = build_preamble(data_dir, workspace);
    let mut builder = client
        .agent(model.target_model_id())
        .preamble(&preamble)
        .default_max_turns(config::DEFAULT_MAX_TURNS)
        .tool(ctx.read_file())
        .tool(ctx.read_skill())
        .tool(ctx.write_file())
        .tool(ctx.multi_replace())
        .tool(ctx.search_workspace())
        .tool(ctx.web_search())
        .tool(ctx.run_command())
        .tool(ctx.get_command_status())
        .tool(ctx.stop_command())
        .memory(memory);

    if model.max_tokens > 0 {
        builder = builder.max_tokens(model.max_tokens);
    }

    if let Some(effort) = model.reasoning_effort.as_deref() {
        builder = builder.additional_params(serde_json::json!({ "reasoning_effort": effort }));
    }

    builder.build()
}

fn build_preamble(data_dir: &Path, workspace: Option<&Path>) -> String {
    let workspace_line = match workspace {
        Some(p) => format!("Active Workspace: {}", p.display()),
        None => "No workspace is open. Ask the user to open a folder before making file changes."
            .to_string(),
    };

    let all_skills = crate::skills::load_all_skills(data_dir);
    let mut skills_section = String::new();
    if !all_skills.is_empty() {
        skills_section.push_str("\n## SKILLS\n");
        skills_section.push_str(
            "These are reusable procedure guides for common task categories. \
When your current task matches a skill name, call read_skill with that name BEFORE starting work. \
The skill content gives you a proven sequence of steps, tool calls, and checks — follow it.\n\n",
        );
        for sk in &all_skills {
            skills_section.push_str(&format!("- **{}** — {}\n", sk.name, sk.description));
        }
    }

    format!(
        "You are Orch, an autonomous AI software engineer embedded inside a desktop IDE. \
You have full access to the user's codebase and can read files, edit files, run commands, \
search the web, and operate in a continuous tool-call loop: \
you think, call a tool, receive the result, and continue until the task is complete. \
Never stop at just planning — act.

{workspace_line}
{skills_section}
## HOW YOUR LOOP WORKS

You are not a chatbot. You are an agent. Each time you respond, you either:
1. Call one or more tools to make progress toward the task, or
2. Deliver a final answer to the user because the task is fully complete and verified.

Do not narrate what you are about to do and then stop. Do not ask for permission to proceed. \
If you have enough information to act, act. If you need information, get it with a tool call.

Your loop continues across as many turns as needed — there is no artificial limit. \
Each tool result feeds directly into your next decision. Use that feedback.

## HOW TO INTERPRET TOOL RESULTS

Every tool returns a result you must read and reason about before continuing:

- **read_file** returns the raw file content. Inspect it before writing any edits.
- **write_file / multi_replace_file_content** return a confirmation or an error. \
  If multi_replace fails with \"not found\", the file changed — read it again and retry.
- **run_command** returns either the full output (short commands) or a task_id (long commands). \
  For a task_id, poll get_command_status until the command finishes, then check the exit code AND the output.
- **get_command_status** returns status, exit code, and output. \
  \"running\" means keep polling. \"completed\" with exit code 0 means success — read the output to confirm. \
  \"failed\" with a non-zero exit code means failure — read the output to diagnose the error.
- **search_workspace** returns file:line: content matches. Use these to locate exactly where to read or edit.
- **web_search** returns titles, URLs, and snippets. Read them before deciding your next action.

Tool failures are prefixed with [[tool-error]]. Diagnose the message before retrying. \
Do not retry the same call unchanged if it failed — something must be different.

## WORKING WITH FILES

1. Always call read_file before editing. You must see the exact current content.
2. For targeted edits (fixing a bug, changing a value, updating a function): use multi_replace_file_content. \
   Copy the old_string exactly from the file — character-for-character. Include enough surrounding context \
   to make the string unique if a short snippet might appear multiple times.
3. For new files or complete rewrites: use write_file.
4. After editing, verify: read the file back, or run the build/type-check command to confirm correctness.
5. Never guess a file's content. Never construct old_string from memory — always read first.

## WORKING WITH COMMANDS

1. Run short verification commands (build, lint, test) directly with run_command. Read the full output.
2. For commands that take more than ~30 seconds (install, long build, dev server): \
   use background=true with run_command to get a task_id immediately, then poll get_command_status.
3. When polling: wait a few seconds between calls. Read the output each time — errors appear in the stream.
4. Commands run with no interactive stdin. Never pass interactive flags.
5. A build that outputs warnings but exits 0 still succeeded. A build that exits non-zero failed — \
   read the output to find the error, fix the file, and run the build again.
6. Never declare success on a command without checking its exit code and output.

## INVESTIGATION STRATEGY

When asked to fix a bug or understand unfamiliar code, follow this order:
1. Use search_workspace to locate relevant files, symbols, or error strings.
2. Use read_file to read the specific files and functions identified.
3. Form a hypothesis about the root cause before making any change.
4. Make the minimal change that addresses the root cause.
5. Verify with a build or test run.

Do not edit blindly. Do not make multiple changes at once and hope one works. \
One focused change, then verify.

## VERIFICATION

A task is complete only when you have empirical evidence it works:
- For code changes: the build/compile command succeeds with no errors.
- For UI changes: inspect the implementation and use the available verification method appropriate to it.
- For command tasks: exit code 0 and output confirms the expected outcome.
- For file edits: reading the file back confirms the content is exactly right.

Never tell the user a task is done based on reasoning alone. Show the evidence."
    )
}

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
    cancel: CancellationToken,
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
    let chunk_timeout = Duration::from_secs(config::STREAM_CHUNK_TIMEOUT_SECS);
    let mut deadline = tokio::time::Instant::now() + chunk_timeout;

    loop {
        let item = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
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
            _ = tokio::time::sleep_until(deadline) => {
                close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                let _ = channel.send(ChatEvent::Error {
                    message: "stream timed out: no data received from the model for 120 s".to_string(),
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
            next = stream.next() => match next {
                Some(item) => {
                    deadline = tokio::time::Instant::now() + chunk_timeout;
                    item
                }
                None => break,
            },
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
                StreamedAssistantContent::ToolCall {
                    tool_call,
                    internal_call_id,
                } => {
                    close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                    let args_value = match &tool_call.function.arguments {
                        serde_json::Value::String(s) => {
                            serde_json::from_str::<serde_json::Value>(s.as_str())
                                .unwrap_or_else(|_| tool_call.function.arguments.clone())
                        }
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
                _ => {}
            },
            Ok(MultiTurnStreamItem::ToolExecutionCommitted { .. }) => {}
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
                let message = humanize_llm_error(&e.to_string());
                let _ = channel.send(ChatEvent::Error { message });
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

    let canonical_ws = workspace.and_then(|ws| dunce::canonicalize(ws).ok());

    for (path, display_name, declared_image) in declared.into_iter().chain(mentioned) {
        let canonical = dunce::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.insert(canonical.clone()) {
            continue;
        }

        if let Some(ref cws) = canonical_ws {
            if !canonical.starts_with(cws) {
                notes.push(format!("attachment escapes workspace: {display_name}"));
                continue;
            }
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
        let is_image = (declared_image && ext != "svg")
            || matches!(
                ext.as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif"
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
Capture: the user's goals, key decisions, files or code modified, important findings, and open items. \
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

pub fn humanize_llm_error(raw: &str) -> String {
    if let Some(start) = raw.find('{') {
        if let Some(end) = raw.rfind('}') {
            if end > start {
                let json_slice = &raw[start..=end];
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_slice) {
                    if let Some(msg) = extract_json_error_message(&val) {
                        return msg;
                    }
                }
            }
        }
    }

    let clean = raw
        .trim_start_matches("CompletionError: ")
        .trim_start_matches("HttpError: ")
        .trim_start_matches("ProviderError: ")
        .trim_start_matches("RequestError: ")
        .trim();

    clean.to_string()
}

fn extract_json_error_message(val: &serde_json::Value) -> Option<String> {
    if let Some(msg) = val.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
        if !msg.trim().is_empty() {
            return Some(msg.trim().to_string());
        }
    }
    if let Some(msg) = val.get("error").and_then(|e| e.as_str()) {
        if !msg.trim().is_empty() {
            return Some(msg.trim().to_string());
        }
    }
    if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
        if !msg.trim().is_empty() {
            return Some(msg.trim().to_string());
        }
    }
    if let Some(msg) = val.get("detail").and_then(|m| m.as_str()) {
        if !msg.trim().is_empty() {
            return Some(msg.trim().to_string());
        }
    }
    None
}
