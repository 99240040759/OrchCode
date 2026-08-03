use std::path::PathBuf;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{fs_util, workspace_root, ToolError};
use crate::state::WorkspaceHandle;

const MAX_SEARCHABLE_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Deserialize, JsonSchema)]
pub struct SearchWorkspaceArgs {
    pub query: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
}

pub struct SearchWorkspace {
    workspace: WorkspaceHandle,
}

impl SearchWorkspace {
    pub fn new(workspace: WorkspaceHandle) -> Self {
        Self { workspace }
    }
}

impl Tool for SearchWorkspace {
    const NAME: &'static str = "search_workspace";
    type Error = ToolError;
    type Args = SearchWorkspaceArgs;
    type Output = String;

    fn description(&self) -> String {
        "Case-insensitive regex search over all files in the workspace. \
Returns matching lines with file path and line number in the format \
path:line: content. Use this to locate where a symbol, function, class, \
string, or pattern is defined or used. Respects .gitignore and skips \
dependency and build output directories. Special regex characters like \
( ) [ ] . * must be escaped with \\. \
Optionally scope the search to a subdirectory with the path parameter. \
Increase max_results (default 50) if you need broader coverage."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(SearchWorkspaceArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;
        let search_path = match args.path.as_deref() {
            Some(p) => fs_util::resolve_in_workspace(&root, p)?,
            None => root.clone(),
        };
        let max_hits = args.max_results.unwrap_or(50).clamp(1, 200);
        let query = args.query.clone();
        tokio::task::spawn_blocking(move || search_text(&root, &search_path, &query, max_hits))
            .await
            .map_err(|e| ToolError::msg(format!("search task failed: {e}")))?
    }
}

fn search_text(
    root: &PathBuf,
    search_path: &PathBuf,
    query: &str,
    max_hits: usize,
) -> Result<String, ToolError> {
    let matcher = grep_regex::RegexMatcherBuilder::new()
        .case_insensitive(true)
        .build(query)
        .map_err(|e| ToolError::msg(format!("invalid search pattern: {e}")))?;

    let mut results: Vec<String> = Vec::new();
    let mut searcher = grep_searcher::Searcher::new();

    for entry in fs_util::workspace_walker(search_path).build().flatten() {
        if results.len() >= max_hits {
            break;
        }
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        match entry.metadata() {
            Ok(meta) if meta.len() <= MAX_SEARCHABLE_FILE_BYTES => {}
            _ => continue,
        }

        let file_path = entry.path();
        let rel_path = fs_util::display_relative(root, file_path);
        let results_ref = &mut results;
        let sink = grep_searcher::sinks::UTF8(|line_num, line| {
            results_ref.push(format!("{rel_path}:{line_num}: {}", line.trim()));
            Ok(results_ref.len() < max_hits)
        });
        let _ = searcher.search_path(&matcher, file_path, sink);
    }

    if results.is_empty() {
        Ok(format!("No matches found for pattern: '{query}'"))
    } else {
        Ok(results.join("\n"))
    }
}
