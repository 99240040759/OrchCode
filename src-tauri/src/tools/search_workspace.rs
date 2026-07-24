use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::{fs_util, ToolError};
use crate::state::WorkspaceHandle;
use ignore::WalkBuilder;

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
        "Search all files in the workspace using a case-insensitive regular expression. \
Returns matching lines with their file path and line number in the format path:line: content. \
Use this to locate where a symbol, function, class, string, or pattern is defined or used — \
faster than reading files one by one. \
Optionally scope the search to a subdirectory with the path parameter. \
Increase max_results (default 50, max 200) if you need broader coverage. \
Respects .gitignore and skips common non-source directories like node_modules and build output. \
If a search returns no results, check your regex syntax — special characters like ( ) [ ] . * must be escaped with \\.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(SearchWorkspaceArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = self.workspace.read()
            .ok()
            .and_then(|g| g.clone())
            .ok_or_else(|| ToolError::msg("no workspace is open"))?;

        let search_path = match args.path {
            Some(ref p) => fs_util::resolve_in_workspace(&root, p)?,
            None => root.clone(),
        };

        let max_hits = args.max_results.unwrap_or(50).min(200);
        let matcher = grep_regex::RegexMatcherBuilder::new()
            .case_insensitive(true)
            .build(&args.query)
            .map_err(|e| ToolError::msg(format!("invalid search pattern: {e}")))?;

        let mut results = Vec::new();
        let walker = WalkBuilder::new(&search_path)
            .git_ignore(true)
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !fs_util::SKIP_DIRS.contains(&name.as_ref())
            })
            .build();
        let mut searcher = grep_searcher::Searcher::new();

        for entry in walker.flatten() {
            if results.len() >= max_hits {
                break;
            }
            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                continue;
            }

            let file_path = entry.path();
            if let Ok(metadata) = entry.metadata() {
                if metadata.len() > 10_000_000 || !metadata.is_file() {
                    continue;
                }
            }

            let rel_path = fs_util::display_relative(&root, file_path);
            let rel_path_clone = rel_path.clone();

            let results_ref = &mut results;
            let sink = grep_searcher::sinks::UTF8(|line_num, line| {
                results_ref.push(format!("{}:{}: {}", rel_path_clone, line_num, line.trim()));
                Ok(results_ref.len() < max_hits)
            });

            let _ = searcher.search_path(&matcher, file_path, sink);
        }

        if results.is_empty() {
            Ok(format!("No matches found for pattern: '{}'", args.query))
        } else {
            Ok(results.join("\n"))
        }
    }
}
