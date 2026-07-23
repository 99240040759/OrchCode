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
        .tool(ctx.read_skill())
        .tool(ctx.write_file())
        .tool(ctx.multi_replace())
        .tool(ctx.search_workspace())
        .tool(ctx.web_search())
        .tool(ctx.run_command())
        .tool(ctx.get_command_status())
        .tool(ctx.stop_command())
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
        skills_section.push_str("When a task matches an available skill, call `read_skill` with its name to load the instructions:\n");
        for sk in &all_skills {
            skills_section.push_str(&format!("- **{}**: {}\n", sk.name, sk.description));
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
2. **read_skill** — Load the full instructions for a skill listed in the skills index, by name.
3. **write_file** — Create a new file or fully overwrite an existing one; parent directories are created automatically.
4. **multi_replace_file_content** — Apply exact string replacements to an existing file.
5. **search_workspace** — Case-insensitive regex search across workspace files.
6. **web_search** — Search the live web for documentation, APIs, or current information.
7. **run_command** — Run a shell command. Quick commands return output directly; longer ones are handed back a task_id and keep running. Pass `background: true` to get a task_id immediately.
8. **get_command_status** — Check status, exit code, elapsed time, and output for a running or finished command by task_id.
9. **stop_command** — Cancel a running command by task_id.
10. **browser_navigate** — Navigate the in-app browser to an http/https URL; a browser tab opens automatically.
11. **browser_click** — Click a DOM element by CSS selector.
12. **browser_type** — Type text into a form field by CSS selector.
13. **browser_get_content** — Extract visible text from the active browser page.

### DIRECTIVES

- Read source files before editing. Never guess signatures, paths, or schemas.
- Trace root causes from full error output before applying fixes.
- For commands that may run long (builds, installs, dev servers), rely on the task_id and poll get_command_status instead of waiting; stop_command cancels one.
- Run `cargo check`, `npm run build`, or equivalent after edits to verify compilation.
- Never declare a task complete without empirical verification."
    )
}
