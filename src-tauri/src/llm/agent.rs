use std::path::Path;
use rig::agent::Agent;
use rig::client::CompletionClient;
use rig::memory::ConversationMemory;
use super::client::{ChatClient, ChatModel};
use crate::config;
use crate::gateway::ModelInfo;
use crate::tools::ToolContext;

pub type ChatAgent = Agent<ChatModel>;

pub fn build_agent(
    client: &ChatClient,
    model: &ModelInfo,
    ctx: &ToolContext,
    memory: impl ConversationMemory + 'static,
    data_dir: Option<&Path>,
    workspace: Option<&Path>,
) -> ChatAgent {
    let preamble = build_preamble(data_dir, workspace);
    let target_model = model.id.strip_prefix("opencode/").unwrap_or(&model.id);
    let mut builder = client
        .agent(target_model)
        .preamble(&preamble)
        .temperature(0.0)
        .default_max_turns(config::DEFAULT_MAX_TURNS)
        .tool(ctx.read_file())
        .tool(ctx.write_file())
        .tool(ctx.multi_replace())
        .tool(ctx.search_workspace())
        .tool(ctx.web_search())
        .tool(ctx.run_command())
        .tool(ctx.get_command_status())
        .tool(ctx.browser_navigate())
        .tool(ctx.browser_click())
        .tool(ctx.browser_type())
        .tool(ctx.browser_get_content())
        .memory(memory);

    if model.max_tokens > 0 {
        builder = builder.max_tokens(model.max_tokens);
    }

    if let Some(effort) = model.reasoning_effort.as_ref().filter(|e| !e.is_empty()) {
        builder = builder.additional_params(serde_json::json!({ "reasoning_effort": effort }));
    }

    builder.build()
}

fn build_preamble(data_dir: Option<&Path>, workspace: Option<&Path>) -> String {
    let workspace_line = match workspace {
        Some(p) => format!("Active Workspace Root: {}", p.display()),
        None => "No workspace folder is open. Ask the user to open one before making file changes.".to_string(),
    };

    let all_skills = crate::skills::load_all_skills(data_dir, workspace);
    let mut skills_section = String::new();
    if !all_skills.is_empty() {
        skills_section.push_str("\n### SKILLS INDEX\n");
        skills_section.push_str("When a task matches an available skill, use `read_file` with its file path to read instructions:\n");
        for sk in &all_skills {
            skills_section.push_str(&format!("- **{}**: {} ({})\n", sk.name, sk.description, sk.file_path));
        }
    }

    format!(
        "You are Orch Code — an autonomous AI software engineer operating inside a desktop IDE. \
You work directly on production codebases: reading and editing files, running shell commands, \
performing web research, and verifying UI in an embedded browser.

{workspace_line}
{skills_section}

### TOOLS

1. **read_file** — Read a text file or image in the workspace. Always read before editing.
2. **write_file** — Create or fully overwrite a file. Use only for new files or complete rewrites.
3. **multi_replace_file_content** — Apply exact string replacements to an existing file.
4. **search_workspace** — Case-insensitive regex search across workspace files.
5. **web_search** — Search the live web for documentation, APIs, or current information.
6. **run_command** — Run a shell command. Pass `background: true` for long-running processes and receive a `task_id`.
7. **get_command_status** — Check status, exit code, elapsed time, and output for a background task.
8. **browser_navigate** — Navigate the in-app browser to an http/https URL.
9. **browser_click** — Click a DOM element by CSS selector.
10. **browser_type** — Type text into a form field by CSS selector.
11. **browser_get_content** — Extract visible text from the active browser page.

### DIRECTIVES

- Read source files before editing. Never guess signatures, paths, or schemas.
- Trace root causes from full error output before applying fixes.
- Run `cargo check`, `npm run build`, or equivalent after edits to verify compilation.
- Never declare a task complete without empirical verification."
    )
}
