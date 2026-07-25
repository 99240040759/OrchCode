use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{fs_util, workspace_root, ToolError};
use crate::state::WorkspaceHandle;

#[derive(Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    pub path: String,
    pub content: String,
}

pub struct WriteFile {
    workspace: WorkspaceHandle,
}

impl WriteFile {
    pub fn new(workspace: WorkspaceHandle) -> Self {
        Self { workspace }
    }
}

impl Tool for WriteFile {
    const NAME: &'static str = "write_file";
    type Error = ToolError;
    type Args = WriteFileArgs;
    type Output = String;

    fn description(&self) -> String {
        "Create a new file, or completely overwrite an existing file, with the provided content. \
Parent directories are created automatically if they don't exist. \
Use this when creating a file from scratch or when the changes are so large that targeted replacements would be impractical. \
For surgical edits to an existing file — changing a function, fixing a bug, updating a value — \
prefer multi_replace_file_content instead, which is safer because it only touches the exact strings you specify. \
The tool returns a confirmation with the file path and byte count on success."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(WriteFileArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;

        if args.content.len() as u64 > fs_util::FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!(
                "content too large ({} bytes) for {}",
                args.content.len(),
                args.path
            )));
        }

        let path = fs_util::resolve_in_workspace(&root, &args.path)?;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                ToolError::msg(format!("cannot create parent dirs for {}: {e}", args.path))
            })?;
        }

        let existed = tokio::fs::try_exists(&path).await.unwrap_or(false);
        let bytes = args.content.len();
        fs_util::atomic_write(&path, args.content.as_bytes()).await?;

        let rel = fs_util::display_relative(&root, &path);
        let verb = if existed { "Overwrote" } else { "Created" };
        Ok(format!("{verb} {rel} ({bytes} bytes)"))
    }
}
