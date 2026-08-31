use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
use crate::gateway::{Gateway, ModelInfo};
use crate::persistence::SqliteMemory;
use crate::tools::{
    parse_display_info, slice_lines, strip_tool_error_sentinel, tool_output_is_error, ToolContext,
};

pub type ChatClient = rig::providers::openai::CompletionsClient;
pub type ChatModel = rig::providers::openai::completion::CompletionModel<reqwest::Client>;
pub type ChatAgent = Agent<ChatModel>;

pub fn build_client(jwt: &str, provider: &str) -> AppResult<ChatClient> {
    let client = rig::providers::openai::Client::builder()
        .api_key(jwt)
        .base_url(&config::inference_base_url(provider))
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

fn parse_line_range(lr: &str) -> (Option<usize>, Option<usize>) {
    let s = lr.trim_start_matches("#L");
    match s.split_once('-') {
        Some((a, b)) => (a.parse::<usize>().ok(), b.parse::<usize>().ok()),
        None => (s.parse::<usize>().ok(), None),
    }
}

pub fn build_agent(
    client: &ChatClient,
    model: &ModelInfo,
    ctx: &ToolContext,
    memory: impl ConversationMemory + 'static,
    data_dir: &Path,
    workspace: Option<&Path>,
    enabled_connectors: &[String],
) -> ChatAgent {
    let preamble = build_preamble(data_dir, workspace, enabled_connectors);
    let mut builder = client
        .agent(model.target_model_id())
        .preamble(&preamble)
        .default_max_turns(config::DEFAULT_MAX_TURNS)
        .tool(ctx.list_dir())
        .tool(ctx.read_file())
        .tool(ctx.read_skill())
        .tool(ctx.write_file())
        .tool(ctx.multi_replace())
        .tool(ctx.search_workspace())
        .tool(ctx.web_search())
        .tool(ctx.run_command())
        .tool(ctx.get_command_status())
        .tool(ctx.stop_command())
        .tool(ctx.search_documents());

    if !enabled_connectors.is_empty() {
        builder = builder
            .tool(ctx.connector_search())
            .tool(ctx.connector_read())
            .tool(ctx.connector_list());
    }

    builder = builder.memory(memory);

    if model.max_tokens > 0 {
        builder = builder.max_tokens(model.max_tokens);
    }

    builder.build()
}

fn build_preamble(data_dir: &Path, workspace: Option<&Path>, enabled_connectors: &[String]) -> String {
    let workspace_line = match workspace {
        Some(p) => format!("Active Workspace: {}", p.display()),
        None => "No workspace folder is currently open. You can answer questions, explain concepts, or create quick scratch files. If the user wants to work on an existing project, suggest opening a workspace folder."
            .to_string(),
    };

    let mut connector_section = String::new();
    if !enabled_connectors.is_empty() {
        connector_section.push_str("\n## CONNECTED EXTERNAL SERVICES\n");
        connector_section.push_str("The following external knowledge sources are connected:\n");
        for id in enabled_connectors {
            if let Some(def) = crate::connectors::find_def(id) {
                connector_section.push_str(&format!("- **{}** (`{}`): {}\n", def.name, def.id, def.description));
            }
        }
        connector_section.push_str("\nAccess them using the unified connector tools:\n");
        connector_section.push_str("- `connector_search(provider, query)`: Search files, emails, issues, or messages\n");
        connector_section.push_str("- `connector_read(provider, target)`: Read specific file, email, issue, page, or channel content\n");
        connector_section.push_str("- `connector_list(provider, container?)`: List files, repos, channels, pages, or projects\n");
    }
    connector_section.push_str("\n## KNOWLEDGE LIBRARY\n");
    connector_section.push_str("You have access to a local knowledge library via the `search_documents` tool. When the user asks to find documents, search reports, or query company knowledge, use `search_documents` first before asking the user to provide files.\n");

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

    // Guardrails are embedded directly in the preamble — no external injection needed.

    format!(
        "You are Orch, an autonomous AI software engineer embedded inside a desktop IDE. \
You have full access to the user's codebase and can read files, edit files, run commands, \
search the web, and operate in a continuous tool-call loop: \
you think, call a tool, receive the result, and continue until the task is complete. \
Never stop at just planning — act.

{workspace_line}
{connector_section}
{skills_section}
## HOW YOUR LOOP WORKS

You are not a chatbot. You are an agent. Each time you respond, you either:
1. Call one or more tools to make progress toward the task, or
2. Deliver a final answer to the user because the task is fully complete and verified.

Do not narrate what you are about to do and then stop. Do not ask for permission to proceed. \
If you have enough information to act, act. If you need information, get it with a tool call.

Work purposefully and efficiently toward resolution. Each tool result feeds directly into your next decision. \
Use that feedback to make steady, deterministic progress.

## HOW TO INTERPRET TOOL RESULTS

Every tool returns a result you must read and reason about before continuing:

- **list_dir** lists folder entries to explore file structure and navigate directory trees.
- **read_file** returns the raw file content. Inspect it before writing any edits.
- **read_skill** returns detailed procedural instructions and checklists for specific engineering workflows.
- **write_file / multi_replace_file_content** return a confirmation or an error. \
  If multi_replace fails with \"not found\", the file content differs — read it again and retry with exact context.
- **run_command** returns output for foreground commands, or a task_id for background processes.
- **get_command_status** returns status (\"running\", \"completed\", \"failed\"), exit code, and accumulated output.
- **stop_command** cancels a running background command task if it has hung or is no longer needed.
- **search_workspace** returns file:line: content matches. Use these to locate symbols and code locations.
- **web_search** returns titles, URLs, and snippets from current online sources.
- **search_documents** searches indexed files (PDFs, Word docs, spreadsheets, presentations) in the knowledge library.
- **connector_search / connector_read / connector_list** search, read, and browse connected services (Google Drive, Gmail, GitHub, Notion, Slack, Jira).

Tool failures are prefixed with [[tool-error]]. Diagnose the message before retrying. \
Do not retry the same call unchanged if it failed — modify your parameters or approach.

## WORKING WITH FILES

1. Always call read_file before editing. You must see the exact current content.
2. For targeted edits (fixing a bug, changing a value, updating a function): use multi_replace_file_content. \
   Copy the old_string exactly from the file — character-for-character. Include enough surrounding context \
   to make the string unique if a short snippet might appear multiple times.
3. For new files or complete rewrites: use write_file.
4. After editing, verify: read the file back, or run the build/type-check command to confirm correctness.
5. Never guess a file's content. Never construct old_string from memory — always read first.

## WORKING WITH COMMANDS

1. Run short verification commands (build, lint, test) directly with run_command in foreground (background=false). \
   Inspect the full exit code and output.
2. For long-running processes (dev servers, file watchers, persistent tasks): \
   use background=true with run_command to obtain a task_id, then check get_command_status as needed.
3. Use stop_command to terminate a background task when finished or if it becomes unresponsive.
4. Commands run without interactive stdin. Never pass interactive flags (e.g. prompt confirmations).
5. A build that outputs warnings but exits 0 succeeded. A build that exits non-zero failed — \
   diagnose the output, fix the root cause, and re-run.
6. Never declare success on a command without verifying its exit code and output.

## INVESTIGATION STRATEGY

When asked to fix a bug or understand unfamiliar code, follow this order:
1. Use list_dir or search_workspace to locate relevant files, symbols, or error strings.
2. Use read_file to read the specific files and functions identified.
3. Form a hypothesis about the root cause before making any change.
4. Make the minimal change that addresses the root cause.
5. Verify with a build or test run.

Do not edit blindly. One focused, verified change is better than multiple speculative edits.

## VERIFICATION

A task is complete only when you have empirical evidence it works:
- For code changes: the build/compile/typecheck command succeeds with no errors.
- For UI changes: verify component state, markup, and visual hierarchy.
- For command tasks: exit code 0 and output confirms the expected outcome.
- For file edits: reading the file back confirms the content is exact.

Never tell the user a task is done based on reasoning alone. Show the evidence."
    )
}

pub struct RunResult {
    pub reasoning_durations: Vec<u64>,
    pub completed: bool,
    pub cumulative_input_tokens: u64,
    pub cumulative_output_tokens: u64,
    pub cumulative_total_tokens: u64,
    pub last_turn_input_tokens: u64,
}

pub struct RunRequest {
    pub session_id: String,
    pub prompt: String,
    pub attachments: Vec<AttachmentRef>,
    pub supports_images: bool,
    pub workspace: Option<PathBuf>,
    pub prior_input_tokens: u64,
    pub prior_output_tokens: u64,
    pub prior_total_tokens: u64,
}

pub async fn run_chat(
    agent: ChatAgent,
    request: RunRequest,
    cancel: CancellationToken,
    channel: Channel<ChatEvent>,
    gateway: Arc<Gateway>,
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
    let mut cumulative_input: u64 = request.prior_input_tokens;
    let mut cumulative_output: u64 = request.prior_output_tokens;
    let mut cumulative_total: u64 = request.prior_total_tokens;
    let mut last_turn_input: u64 = 0;
    let mut turns_since_budget_check: u32 = 0;
    let chunk_timeout = Duration::from_secs(config::STREAM_CHUNK_TIMEOUT_SECS);
    let mut deadline = tokio::time::Instant::now() + chunk_timeout;

    loop {
        let item = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                let _ = channel.send(ChatEvent::Cancelled);
                return RunResult {
                    reasoning_durations,
                    completed: false,
                    cumulative_input_tokens: cumulative_input,
                    cumulative_output_tokens: cumulative_output,
                    cumulative_total_tokens: cumulative_total,
                    last_turn_input_tokens: last_turn_input,
                };
            }
            _ = tokio::time::sleep_until(deadline) => {
                close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                let _ = channel.send(ChatEvent::Error {
                    message: format!(
                        "stream timed out: no data received from the model for {}s",
                        config::STREAM_CHUNK_TIMEOUT_SECS
                    ),
                });
                return RunResult {
                    reasoning_durations,
                    completed: false,
                    cumulative_input_tokens: cumulative_input,
                    cumulative_output_tokens: cumulative_output,
                    cumulative_total_tokens: cumulative_total,
                    last_turn_input_tokens: last_turn_input,
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
                last_turn_input = turn.input_tokens;
                cumulative_input += turn.input_tokens;
                cumulative_output += turn.output_tokens;
                cumulative_total += turn.total_tokens;
                let _ = channel.send(ChatEvent::Usage {
                    input_tokens: cumulative_input,
                    output_tokens: cumulative_output,
                    total_tokens: cumulative_total,
                });

                turns_since_budget_check += 1;
                if turns_since_budget_check >= config::BUDGET_RECHECK_EVERY_TURNS {
                    turns_since_budget_check = 0;
                    if let Ok(budget) = gateway.budget().await {
                        if !budget.allowed {
                            let _ = channel.send(ChatEvent::Error {
                                message: format!(
                                    "usage limit reached for this {}: {:.2} of {:.2} USD used",
                                    budget.period, budget.cost_usd, budget.limit_usd
                                ),
                            });
                            return RunResult {
                                reasoning_durations,
                                completed: false,
                                cumulative_input_tokens: cumulative_input,
                                cumulative_output_tokens: cumulative_output,
                                cumulative_total_tokens: cumulative_total,
                                last_turn_input_tokens: last_turn_input,
                            };
                        }
                    }
                }
            }
            Ok(_) => {}
            Err(e) => {
                close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);
                let message = humanize_llm_error(&e.to_string());
                let _ = channel.send(ChatEvent::Error { message });
                return RunResult {
                    reasoning_durations,
                    completed: false,
                    cumulative_input_tokens: cumulative_input,
                    cumulative_output_tokens: cumulative_output,
                    cumulative_total_tokens: cumulative_total,
                    last_turn_input_tokens: last_turn_input,
                };
            }
        }
    }

    close_reasoning(&mut reasoning_started, &mut reasoning_durations, &channel);

    RunResult {
        reasoning_durations,
        completed: true,
        cumulative_input_tokens: cumulative_input,
        cumulative_output_tokens: cumulative_output,
        cumulative_total_tokens: cumulative_total,
        last_turn_input_tokens: last_turn_input,
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

fn image_media_type(ext: &str) -> Option<ImageMediaType> {
    match ext {
        "png" => Some(ImageMediaType::PNG),
        "jpg" | "jpeg" => Some(ImageMediaType::JPEG),
        "webp" => Some(ImageMediaType::WEBP),
        "gif" => Some(ImageMediaType::GIF),
        _ => None,
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

fn mention_regex() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"@\[(?P<bracket>[^\]]+)\]|@(?P<plain>[^\s@]+)")
            .expect("mention regex is a valid pattern")
    })
}

fn collect_mentioned_paths(workspace: Option<&Path>, prompt: &str) -> Vec<(PathBuf, Option<String>)> {
    let Some(ws) = workspace else {
        return Vec::new();
    };
    let re = mention_regex();

    let mut out = Vec::new();
    for cap in re.captures_iter(prompt) {
        let Some(raw) = cap
            .name("bracket")
            .or_else(|| cap.name("plain"))
            .map(|value| value.as_str().trim())
        else {
            continue;
        };
        if raw.is_empty() {
            continue;
        }
        let (candidate, line_range) = if let Some(hash_pos) = raw.find("#L") {
            let (p, r) = raw.split_at(hash_pos);
            (p, Some(r.to_string()))
        } else {
            (raw, None)
        };
        if candidate.is_empty() {
            continue;
        }
        if let Ok(resolved) = crate::tools::fs_util::resolve_existing_file(ws, candidate) {
            out.push((resolved, line_range));
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

    let mut declared: Vec<(PathBuf, String)> = Vec::new();
    for attachment in attachments {
        let Some(ws) = workspace else {
            notes.push(format!("workspace required for attachment: {}", attachment.name));
            continue;
        };
        match crate::tools::fs_util::resolve_existing_file(ws, &attachment.path) {
            Ok(path) => declared.push((path, attachment.name.clone())),
            Err(_) => notes.push(format!("attachment not found in workspace: {}", attachment.name)),
        }
    }
    let mentioned: Vec<(PathBuf, String, Option<String>)> = collect_mentioned_paths(workspace, prompt)
        .into_iter()
        .map(|(p, line_range)| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            (p, name, line_range)
        })
        .collect();

    let declared_extended: Vec<(PathBuf, String, Option<String>)> = declared
        .into_iter()
        .map(|(p, n)| (p, n, None))
        .collect();

    for (path, display_name, line_range) in declared_extended.into_iter().chain(mentioned) {
        let canonical = dunce::canonicalize(&path)
            .map_err(|e| format!("cannot resolve attachment {display_name}: {e}"));
        let canonical = match canonical {
            Ok(path) => path,
            Err(message) => {
                notes.push(message);
                continue;
            }
        };
        if !seen.insert(canonical.clone()) {
            continue;
        }

        let ext = canonical
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let label = display_label(&canonical, workspace);
        let is_image = image_media_type(&ext).is_some();

        let size = match tokio::fs::metadata(&canonical).await {
            Ok(m) => m.len() as usize,
            Err(e) => {
                notes.push(format!("cannot read attachment {label}: {e}"));
                continue;
            }
        };

        if ext == "pdf" {
            let pdf_path = canonical.clone();
            let extracted = tokio::task::spawn_blocking(move || {
                crate::document::extract_pdf_text(&pdf_path, Some(cap))
            })
            .await;
            match extracted {
                Ok(Ok(text)) => {
                    parts.push(UserContent::text(format!("{PDF_PART_PREFIX}{label}>\n{text}")))
                }
                _ => notes.push(format!("PDF has no extractable text: {label}")),
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
            match tokio::fs::read(&canonical).await {
                Ok(bytes) => {
                    let b64 = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &bytes,
                    );
                    if let Some(media) = image_media_type(&ext) {
                        images.push((b64, media));
                    }
                }
                Err(e) => notes.push(format!("cannot read image {label}: {e}")),
            }
            continue;
        }

        match tokio::fs::read_to_string(&canonical).await {
            Ok(raw_content) => {
                let content = if let Some(ref lr) = line_range {
                    let (start, end) = parse_line_range(lr);
                    slice_lines(&raw_content, start, end)
                } else {
                    raw_content
                };
                let label_with_range = if let Some(ref lr) = line_range {
                    format!("{label}{lr}")
                } else {
                    label.clone()
                };
                parts.push(UserContent::text(format!(
                    "{FILE_PART_PREFIX}{label_with_range}>\n{content}"
                )));
            }
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
    input_tokens: u64,
) -> AppResult<Option<CompactionOutcome>> {
    if model_info.context_window == 0 {
        return Ok(None);
    }

    let ratio = input_tokens as f64 / model_info.context_window as f64;
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
