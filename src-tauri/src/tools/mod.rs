pub mod command_manager;
pub mod display;
pub mod fs_util;
pub mod get_command_status;
pub mod multi_replace;
pub mod read_file;
pub mod read_skill;
pub mod run_command;
pub mod search_workspace;
pub mod stop_command;
pub mod web_search;
pub mod write_file;

use std::path::PathBuf;
use std::sync::Arc;

use crate::gateway::Gateway;
use crate::state::WorkspaceHandle;
use crate::tools::command_manager::CommandManager;

pub use display::parse_display_info;
pub use get_command_status::GetCommandStatus;
pub use multi_replace::MultiReplaceFileContent;
pub use read_file::ReadFile;
pub use read_skill::ReadSkill;
pub use run_command::RunCommand;
pub use search_workspace::SearchWorkspace;
pub use stop_command::StopCommand;
pub use web_search::WebSearch;
pub use write_file::WriteFile;

pub const TOOL_ERROR_SENTINEL: &str = "[[tool-error]] ";

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("[[tool-error]] {0}")]
    Msg(String),
}

impl ToolError {
    pub fn msg(s: impl Into<String>) -> Self {
        ToolError::Msg(s.into())
    }
}

impl From<crate::error::AppError> for ToolError {
    fn from(e: crate::error::AppError) -> Self {
        ToolError::Msg(e.to_string())
    }
}

pub fn tool_output_is_error(output: &str) -> bool {
    output.starts_with(TOOL_ERROR_SENTINEL)
}

pub fn strip_tool_error_sentinel(output: &str) -> &str {
    output.strip_prefix(TOOL_ERROR_SENTINEL).unwrap_or(output)
}

pub fn workspace_root(handle: &WorkspaceHandle) -> Result<PathBuf, ToolError> {
    match handle.read() {
        Err(_) => Err(ToolError::msg("workspace state lock is poisoned")),
        Ok(guard) => guard.clone().ok_or_else(|| ToolError::msg("no workspace is open")),
    }
}

pub struct ToolContext {
    pub workspace: WorkspaceHandle,
    pub gateway: Arc<Gateway>,
    pub app_handle: tauri::AppHandle,
    pub command_manager: CommandManager,
    pub data_dir: PathBuf,
}

impl ToolContext {
    pub fn read_file(&self) -> ReadFile {
        ReadFile::new(self.workspace.clone())
    }
    pub fn read_skill(&self) -> ReadSkill {
        ReadSkill::new(self.data_dir.clone(), self.workspace.clone())
    }
    pub fn write_file(&self) -> WriteFile {
        WriteFile::new(self.workspace.clone())
    }
    pub fn multi_replace(&self) -> MultiReplaceFileContent {
        MultiReplaceFileContent::new(self.workspace.clone())
    }
    pub fn search_workspace(&self) -> SearchWorkspace {
        SearchWorkspace::new(self.workspace.clone())
    }
    pub fn web_search(&self) -> WebSearch {
        WebSearch::new(self.gateway.clone())
    }
    pub fn run_command(&self) -> RunCommand {
        RunCommand::new(self.workspace.clone(), self.command_manager.clone())
    }
    pub fn get_command_status(&self) -> GetCommandStatus {
        GetCommandStatus::new(self.command_manager.clone())
    }
    pub fn stop_command(&self) -> StopCommand {
        StopCommand::new(self.command_manager.clone())
    }
}
