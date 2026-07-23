use std::time::{Duration, Instant};
use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::command_manager::{CommandManager, TaskStatus};
use super::{fs_util, ToolError};
use crate::config;
use crate::state::WorkspaceHandle;

#[derive(Deserialize, JsonSchema)]
pub struct RunCommandArgs {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub background: Option<bool>,
}

pub struct RunCommand {
    workspace: WorkspaceHandle,
    manager: CommandManager,
}

impl RunCommand {
    pub fn new(workspace: WorkspaceHandle, manager: CommandManager) -> Self {
        Self { workspace, manager }
    }
}

fn format_completed(s: &TaskStatus) -> String {
    let code = s.exit_code.map(|c| c.to_string()).unwrap_or_else(|| s.status.clone());
    let mut out = format!("status: {}\nexit code: {code}\nelapsed: {}s\n", s.status, s.elapsed_secs);
    if s.output.trim().is_empty() {
        out.push_str("(no output)");
    } else {
        out.push_str("--- output ---\n");
        out.push_str(&s.output);
    }
    out
}

impl Tool for RunCommand {
    const NAME: &'static str = "run_command";
    type Error = ToolError;
    type Args = RunCommandArgs;
    type Output = String;

    fn description(&self) -> String {
        "Run a shell command in the workspace directory. Quick commands return their output directly. \
Longer commands are handed back a task_id (the command keeps running) so you can continue working and \
poll get_command_status(task_id) for progress, or cancel it with stop_command(task_id). Pass background=true \
to receive a task_id immediately without waiting.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(RunCommandArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = self.workspace.read()
            .ok()
            .and_then(|g| g.clone())
            .ok_or_else(|| ToolError::msg("no workspace is open"))?;

        let cwd = match &args.cwd {
            Some(sub) => fs_util::resolve_in_workspace(&root, sub)?,
            None => root.clone(),
        };

        let task_id = self.manager.spawn_task(&args.command, &cwd);

        if args.background.unwrap_or(false) {
            return Ok(format!(
                "Background task started with task_id: '{task_id}'. Use get_command_status(task_id: '{task_id}') to check output, or stop_command(task_id: '{task_id}') to cancel."
            ));
        }

        let handoff = Duration::from_secs(config::COMMAND_FOREGROUND_HANDOFF_SECS);
        let start = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;
            match self.manager.get_status(&task_id) {
                Some(status) if status.status != "running" => return Ok(format_completed(&status)),
                Some(_) => {
                    if start.elapsed() >= handoff {
                        return Ok(format!(
                            "Command still running after {}s and is now tracked as task_id: '{task_id}'. It keeps running in the background — poll get_command_status(task_id: '{task_id}') for progress, or stop_command(task_id: '{task_id}') to cancel.",
                            config::COMMAND_FOREGROUND_HANDOFF_SECS
                        ));
                    }
                }
                None => return Err(ToolError::msg("command task disappeared unexpectedly")),
            }
        }
    }
}
