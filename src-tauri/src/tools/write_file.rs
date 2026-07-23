use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::{fs_util, ToolError};
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
        "Create or completely overwrite a file with the given content. Parent directories are created automatically. Use multi_replace_file_content for targeted edits to existing files.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(WriteFileArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = self.workspace.read()
            .ok()
            .and_then(|g| g.clone())
            .ok_or_else(|| ToolError::msg("no workspace is open"))?;

        let path = fs_util::resolve_in_workspace(&root, &args.path)?;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                ToolError::msg(format!("cannot create parent dirs for {}: {e}", args.path))
            })?;
        }

        let existed = path.exists();
        let bytes = args.content.len();

        let tmp_path = path.with_extension(format!(
            "{}.tmp",
            path.extension().and_then(|e| e.to_str()).unwrap_or("tmp")
        ));
        tokio::fs::write(&tmp_path, args.content.as_bytes()).await.map_err(|e| {
            ToolError::msg(format!("cannot write temp file for {}: {e}", args.path))
        })?;
        tokio::fs::rename(&tmp_path, &path).await.map_err(|e| {
            ToolError::msg(format!("cannot finalize write for {}: {e}", args.path))
        })?;

        let rel = fs_util::display_relative(&root, &path);
        let verb = if existed { "Overwrote" } else { "Created" };
        Ok(format!("{verb} {rel} ({bytes} bytes)"))
    }
}
