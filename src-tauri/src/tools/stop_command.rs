use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::{command_manager::CommandManager, ToolError};

#[derive(Deserialize, JsonSchema)]
pub struct StopCommandArgs {
    pub task_id: String,
}

pub struct StopCommand {
    manager: CommandManager,
}

impl StopCommand {
    pub fn new(manager: CommandManager) -> Self {
        Self { manager }
    }
}

impl Tool for StopCommand {
    const NAME: &'static str = "stop_command";
    type Error = ToolError;
    type Args = StopCommandArgs;
    type Output = String;

    fn description(&self) -> String {
        "Cancel a background command that is currently running. \
Use the task_id returned by run_command or get_command_status. \
Call this when a command is hung, taking too long, or when you want to restart it with different arguments. \
The tool sends a termination signal and confirms cancellation. \
After cancelling, you can start the command again with run_command if needed.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(StopCommandArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        if self.manager.kill_task(&args.task_id) {
            Ok(format!("Requested cancellation of task '{}'.", args.task_id))
        } else {
            Err(ToolError::msg(format!("task '{}' is not running or does not exist", args.task_id)))
        }
    }
}
