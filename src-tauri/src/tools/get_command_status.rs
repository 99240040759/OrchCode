use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{command_manager::CommandManager, ToolError};

const OUTPUT_TAIL_LINES: usize = 200;

#[derive(Deserialize, JsonSchema)]
pub struct GetCommandStatusArgs {
    pub task_id: String,
}

pub struct GetCommandStatus {
    manager: CommandManager,
}

impl GetCommandStatus {
    pub fn new(manager: CommandManager) -> Self {
        Self { manager }
    }
}

impl Tool for GetCommandStatus {
    const NAME: &'static str = "get_command_status";
    type Error = ToolError;
    type Args = GetCommandStatusArgs;
    type Output = String;

    fn description(&self) -> String {
        "Check the current status of a background command that was started with run_command. \
Returns the task_id, the original command string, current status (running, completed, failed or cancelled), \
exit code when finished, elapsed time in seconds, and the most recent output lines. \
Call this in a loop — waiting a few seconds between calls — to monitor a long-running command. \
When the status shows the command has finished, read the exit code to determine success or failure: \
exit code 0 means success, anything else means an error occurred. \
Always read the full output before drawing conclusions — warnings and errors appear in stdout/stderr \
even when the exit code is 0."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(GetCommandStatusArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let status = self
            .manager
            .get_status(&args.task_id)
            .ok_or_else(|| ToolError::msg(format!("task_id '{}' not found", args.task_id)))?;

        let mut out = String::new();
        out.push_str(&format!("task_id: {}\n", status.task_id));
        out.push_str(&format!("command: {}\n", status.command));
        out.push_str(&format!("status: {}\n", status.status));
        if let Some(code) = status.exit_code {
            out.push_str(&format!("exit_code: {code}\n"));
        }
        out.push_str(&format!("elapsed: {}s\n", status.elapsed_secs));

        let lines: Vec<&str> = status.output.lines().collect();
        let start = lines.len().saturating_sub(OUTPUT_TAIL_LINES);
        out.push_str("--- output (latest lines) ---\n");
        if lines.is_empty() {
            out.push_str("(no output)");
        } else {
            out.push_str(&lines[start..].join("\n"));
        }

        Ok(out)
    }
}
