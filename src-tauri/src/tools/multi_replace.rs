use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{fs_util, workspace_root, ToolError};
use crate::state::WorkspaceHandle;

#[derive(Deserialize, JsonSchema)]
pub struct Replacement {
    pub old_string: String,
    pub new_string: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct MultiReplaceArgs {
    pub path: String,
    pub replacements: Vec<Replacement>,
}

pub struct MultiReplaceFileContent {
    workspace: WorkspaceHandle,
}

impl MultiReplaceFileContent {
    pub fn new(workspace: WorkspaceHandle) -> Self {
        Self { workspace }
    }
}

impl Tool for MultiReplaceFileContent {
    const NAME: &'static str = "multi_replace_file_content";
    type Error = ToolError;
    type Args = MultiReplaceArgs;
    type Output = String;

    fn description(&self) -> String {
        "Edit an existing file by applying one or more exact string replacements in order. \
Each replacement specifies old_string (the exact text currently in the file) and new_string (what to replace it with). \
old_string must match the file content character-for-character, including whitespace, indentation, and newlines — \
if it does not match exactly, the tool returns an error and writes nothing. \
All occurrences of each old_string are replaced. \
If you need to change multiple unrelated parts of a file, pass all replacements in a single call — \
they are applied in the order listed. \
Always read the file first so you know the exact current content before constructing replacements. \
On success, returns a summary of how many replacements were applied and how many occurrences were changed."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(MultiReplaceArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        if args.replacements.is_empty() {
            return Err(ToolError::msg("no replacements provided"));
        }

        let root = workspace_root(&self.workspace)?;
        let path = fs_util::resolve_in_workspace(&root, &args.path)?;

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot stat {}: {e}", args.path)))?;
        if meta.len() > fs_util::FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!(
                "file too large to edit: {}",
                args.path
            )));
        }

        let mut content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot read {}: {e}", args.path)))?;

        let mut total = 0usize;
        for (i, r) in args.replacements.iter().enumerate() {
            if r.old_string.is_empty() {
                return Err(ToolError::msg(format!(
                    "replacement #{} has empty old_string",
                    i + 1
                )));
            }
            let count = content.matches(&r.old_string).count();
            if count == 0 {
                return Err(ToolError::msg(format!(
                    "replacement #{} not applied: old_string not found in {}. Re-read the file first.",
                    i + 1,
                    args.path
                )));
            }
            content = content.replace(&r.old_string, &r.new_string);
            total += count;
        }

        fs_util::atomic_write(&path, content.as_bytes()).await?;

        let rel = fs_util::display_relative(&root, &path);
        Ok(format!(
            "Applied {} replacement(s) ({total} occurrence(s)) to {rel}",
            args.replacements.len()
        ))
    }
}
