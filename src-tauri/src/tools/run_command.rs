use std::process::Stdio;
use std::time::Duration;
use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::{command_manager::CommandManager, fs_util, ToolError};
use crate::config;
use crate::state::WorkspaceHandle;

#[derive(Deserialize, JsonSchema)]
pub struct RunCommandArgs {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub background: Option<bool>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
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

impl Tool for RunCommand {
    const NAME: &'static str = "run_command";
    type Error = ToolError;
    type Args = RunCommandArgs;
    type Output = String;

    fn description(&self) -> String {
        "Run a shell command in the workspace directory. Pass background=true for long-running processes and receive a task_id immediately. Use get_command_status with the task_id to inspect output or exit status.".to_string()
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

        if args.background.unwrap_or(false) {
            let task_id = self.manager.spawn_task(&args.command, &cwd);
            return Ok(format!(
                "Background task started with task_id: '{}'. Use get_command_status(task_id: '{}') to check output.",
                task_id, task_id
            ));
        }

        let timeout_secs = args.timeout_secs
            .unwrap_or(config::MAX_COMMAND_TIMEOUT_SECS)
            .min(config::MAX_COMMAND_TIMEOUT_SECS);
        let timeout = Duration::from_secs(timeout_secs);

        let mut cmd = build_command(&args.command);
        cmd.current_dir(&cwd).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);

        let output = match tokio::time::timeout(timeout, cmd.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => return Err(ToolError::msg(format!("command failed to start: {e}"))),
            Err(_) => return Err(ToolError::msg(format!("command timed out after {timeout_secs}s"))),
        };

        const OUTPUT_CAP: usize = 100 * 1024;
        let code = output.status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".to_string());
        let stdout_raw = String::from_utf8_lossy(&output.stdout);
        let stderr_raw = String::from_utf8_lossy(&output.stderr);

        let stdout = if stdout_raw.len() > OUTPUT_CAP {
            format!("...[truncated]...\n{}", &stdout_raw[stdout_raw.len() - OUTPUT_CAP..])
        } else {
            stdout_raw.into_owned()
        };
        let stderr = if stderr_raw.len() > OUTPUT_CAP {
            format!("...[truncated]...\n{}", &stderr_raw[stderr_raw.len() - OUTPUT_CAP..])
        } else {
            stderr_raw.into_owned()
        };

        let mut combined = format!("exit code: {code}\n");
        if !stdout.trim().is_empty() {
            combined.push_str("--- stdout ---\n");
            combined.push_str(&stdout);
            if !stdout.ends_with('\n') { combined.push('\n'); }
        }
        if !stderr.trim().is_empty() {
            combined.push_str("--- stderr ---\n");
            combined.push_str(&stderr);
        }

        Ok(combined)
    }
}

fn build_command(command: &str) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = tokio::process::Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command", command]);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.args(["-c", command]);
        cmd
    }
}
