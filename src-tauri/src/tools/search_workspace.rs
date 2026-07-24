use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::{fs_util, ToolError};
use crate::state::WorkspaceHandle;
use crate::vector_store::WorkspaceIndex;
use ignore::WalkBuilder;

#[derive(Deserialize, JsonSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    #[default]
    Text,
    Semantic,
}

#[derive(Deserialize, JsonSchema)]
pub struct SearchWorkspaceArgs {
    pub query: String,
    #[serde(default)]
    pub mode: Option<SearchMode>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
}

pub struct SearchWorkspace {
    workspace: WorkspaceHandle,
    index: WorkspaceIndex,
}

impl SearchWorkspace {
    pub fn new(workspace: WorkspaceHandle, index: WorkspaceIndex) -> Self {
        Self { workspace, index }
    }
}

impl Tool for SearchWorkspace {
    const NAME: &'static str = "search_workspace";
    type Error = ToolError;
    type Args = SearchWorkspaceArgs;
    type Output = String;

    fn description(&self) -> String {
        "Search all files in the workspace. Supports two modes:\n\
- mode: \"text\" (default) — case-insensitive regex search. Returns matching lines with file path \
and line number in the format path:line: content. Use this to locate where a symbol, function, \
class, string, or pattern is defined or used. Respects .gitignore and skips node_modules and \
build output. Special regex characters like ( ) [ ] . * must be escaped with \\.\n\
- mode: \"semantic\" — natural language search using embeddings via rig's InMemoryVectorIndex. \
Use this when you want to find code by meaning rather than exact text, e.g. \
\"error handling for auth\" or \"function that formats a date\". The workspace is indexed \
automatically on first semantic search using the Gemini embedding model; subsequent searches \
reuse the in-memory index unless re-indexed.\n\
Optionally scope text mode to a subdirectory with the path parameter. \
Increase max_results (default 50 for text, 8 for semantic) if you need broader coverage.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(SearchWorkspaceArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        match args.mode.unwrap_or(SearchMode::Text) {
            SearchMode::Text => {
                search_text(&self.workspace, &args.query, args.path.as_deref(), args.max_results).await
            }
            SearchMode::Semantic => {
                search_semantic(&self.workspace, &self.index, &args.query, args.max_results).await
            }
        }
    }
}

async fn search_text(
    workspace: &WorkspaceHandle,
    query: &str,
    path: Option<&str>,
    max_results: Option<usize>,
) -> Result<String, ToolError> {
    let root = workspace.read()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| ToolError::msg("no workspace is open"))?;

    let search_path = match path {
        Some(p) => fs_util::resolve_in_workspace(&root, p)?,
        None => root.clone(),
    };

    let max_hits = max_results.unwrap_or(50).min(200);
    let matcher = grep_regex::RegexMatcherBuilder::new()
        .case_insensitive(true)
        .build(query)
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
        let rel_clone = rel_path.clone();
        let results_ref = &mut results;
        let sink = grep_searcher::sinks::UTF8(|line_num, line| {
            results_ref.push(format!("{}:{}: {}", rel_clone, line_num, line.trim()));
            Ok(results_ref.len() < max_hits)
        });
        let _ = searcher.search_path(&matcher, file_path, sink);
    }

    if results.is_empty() {
        Ok(format!("No matches found for pattern: '{}'", query))
    } else {
        Ok(results.join("\n"))
    }
}

async fn search_semantic(
    workspace: &WorkspaceHandle,
    index: &WorkspaceIndex,
    query: &str,
    max_results: Option<usize>,
) -> Result<String, ToolError> {
    let root = workspace.read()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| ToolError::msg("no workspace is open"))?;

    let top_k = max_results.unwrap_or(8).min(30);

    let results = index
        .search(&root, query, top_k)
        .await
        .map_err(|e| ToolError::msg(format!("semantic search failed: {e}")))?;

    if results.is_empty() {
        return Ok(format!(
            "No relevant chunks found for: '{}' ({} chunks indexed). \
Try rephrasing or use mode: \"text\" for exact matches.",
            query,
            index.chunk_count()
        ));
    }

    let mut out = format!(
        "Semantic search results for: '{}' ({} chunks indexed)\n\n",
        query,
        index.chunk_count(),
    );

    for (i, (score, _id, chunk)) in results.iter().enumerate() {
        out.push_str(&format!(
            "--- Result {} | {} lines {}-{} | score: {:.3} ---\n{}\n\n",
            i + 1,
            chunk.file_path,
            chunk.start_line,
            chunk.end_line,
            score,
            chunk.content,
        ));
    }

    Ok(out)
}
