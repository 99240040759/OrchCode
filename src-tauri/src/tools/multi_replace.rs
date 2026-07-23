use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::{fs_util, ToolError};
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
        "Edit an existing file by applying ordered exact string replacements. old_string must appear verbatim in the file. All occurrences of each old_string are replaced. Returns error if any old_string is not found and no changes are written.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(MultiReplaceArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        if args.replacements.is_empty() {
            return Err(ToolError::msg("no replacements provided"));
        }

        let root = self.workspace.read()
            .ok()
            .and_then(|g| g.clone())
            .ok_or_else(|| ToolError::msg("no workspace is open"))?;

        let path = fs_util::resolve_in_workspace(&root, &args.path)?;

        let meta = tokio::fs::metadata(&path).await.map_err(|e| {
            ToolError::msg(format!("cannot stat {}: {e}", args.path))
        })?;
        if meta.len() > 10 * 1024 * 1024 {
            return Err(ToolError::msg(format!("file too large to edit: {}", args.path)));
        }

        let mut content = tokio::fs::read_to_string(&path).await.map_err(|e| {
            ToolError::msg(format!("cannot read {}: {e}", args.path))
        })?;

        let mut total = 0usize;
        for (i, r) in args.replacements.iter().enumerate() {
            if r.old_string.is_empty() {
                return Err(ToolError::msg(format!("replacement #{} has empty old_string", i + 1)));
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

        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
        let tmp_path = path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
        tokio::fs::write(&tmp_path, content.as_bytes()).await.map_err(|e| {
            ToolError::msg(format!("cannot write temp for {}: {e}", args.path))
        })?;
        if let Err(e) = tokio::fs::rename(&tmp_path, &path).await {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(ToolError::msg(format!("cannot finalize edit for {}: {e}", args.path)));
        }

        let rel = fs_util::display_relative(&root, &path);
        Ok(format!("Applied {} replacement(s) ({total} occurrence(s)) to {rel}", args.replacements.len()))
    }
}
