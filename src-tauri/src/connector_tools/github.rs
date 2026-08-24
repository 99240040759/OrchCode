use std::sync::Arc;

use base64::Engine as _;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

const GITHUB_API: &str = "https://api.github.com";

#[derive(Clone)]
pub struct GitHubListRepos {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitHubListReposArgs {
    pub visibility: Option<String>,
    pub max_results: Option<u32>,
}

impl Tool for GitHubListRepos {
    const NAME: &'static str = "github_list_repos";
    type Args = GitHubListReposArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "List GitHub repositories accessible to the authenticated user.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("github", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("GitHub auth: {e}")))?;

        let visibility = args.visibility.as_deref().unwrap_or("owner");
        let limit = args.max_results.unwrap_or(30).min(100);

        let url = format!(
            "{GITHUB_API}/user/repos?type={visibility}&sort=updated&per_page={limit}"
        );

        let repos: Vec<Value> = self
            .manager
            .http()
            .get(&url)
            .bearer_auth(&token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        if repos.is_empty() {
            return Ok("No repositories found.".to_string());
        }

        let mut out = format!("Found {} repository/repositories:\n\n", repos.len());
        for repo in &repos {
            let name = repo["full_name"].as_str().unwrap_or("(unnamed)");
            let desc = repo["description"].as_str().unwrap_or("No description");
            let lang = repo["language"].as_str().unwrap_or("—");
            let stars = repo["stargazers_count"].as_u64().unwrap_or(0);
            let updated = repo["updated_at"].as_str().unwrap_or("—");
            let private = repo["private"].as_bool().unwrap_or(false);
            out.push_str(&format!(
                "• {name} [{lang}] ★{stars} {}\n  {desc}\n  Updated: {updated}\n\n",
                if private { "(private)" } else { "(public)" }
            ));
        }

        Ok(out)
    }
}

#[derive(Clone)]
pub struct GitHubReadFile {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitHubReadFileArgs {
    pub repo: String,
    pub path: String,
    pub ref_: Option<String>,
}

impl Tool for GitHubReadFile {
    const NAME: &'static str = "github_read_file";
    type Args = GitHubReadFileArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Read a file from a GitHub repository. Returns file contents as text.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("github", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("GitHub auth: {e}")))?;

        let mut url = format!("{GITHUB_API}/repos/{}/contents/{}", args.repo, args.path);
        if let Some(r) = &args.ref_ {
            url.push_str(&format!("?ref={r}"));
        }

        let json: Value = self
            .manager
            .http()
            .get(&url)
            .bearer_auth(&token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        if let Some(err) = json["message"].as_str() {
            return Err(ToolError::msg(format!("GitHub API: {err}")));
        }

        let encoding = json["encoding"].as_str().unwrap_or("");
        let content_raw = json["content"].as_str().unwrap_or("");

        let content = if encoding == "base64" {
            let cleaned: String = content_raw.chars().filter(|c| !c.is_whitespace()).collect();
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(cleaned.as_bytes())
                .map_err(|e| ToolError::msg(format!("base64 decode: {e}")))?;
            String::from_utf8_lossy(&bytes).into_owned()
        } else {
            content_raw.to_string()
        };

        const MAX_CHARS: usize = 40_000;
        let truncated = if content.len() > MAX_CHARS {
            format!(
                "{}\n\n[Truncated: showing {MAX_CHARS} of {} chars]",
                &content[..MAX_CHARS],
                content.len()
            )
        } else {
            content
        };

        let name = json["name"].as_str().unwrap_or(&args.path);
        let sha = json["sha"].as_str().unwrap_or("—");

        Ok(format!("File: {name} (sha: {sha})\n\n{truncated}"))
    }
}

#[derive(Clone)]
pub struct GitHubSearchCode {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitHubSearchCodeArgs {
    pub query: String,
    pub max_results: Option<u32>,
}

impl Tool for GitHubSearchCode {
    const NAME: &'static str = "github_search_code";
    type Args = GitHubSearchCodeArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Search code across GitHub repositories using GitHub's code search.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("github", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("GitHub auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(30);
        let url = format!(
            "{GITHUB_API}/search/code?q={}&per_page={limit}",
            urlencoding::encode(&args.query)
        );

        let json: Value = self
            .manager
            .http()
            .get(&url)
            .bearer_auth(&token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        if let Some(err) = json["message"].as_str() {
            return Err(ToolError::msg(format!("GitHub search: {err}")));
        }

        let total = json["total_count"].as_u64().unwrap_or(0);
        let items = json["items"].as_array().cloned().unwrap_or_default();

        if items.is_empty() {
            return Ok(format!("No code results for '{}'.", args.query));
        }

        let mut out = format!("Found {total} total results (showing {}):\n\n", items.len());
        for item in &items {
            let name = item["name"].as_str().unwrap_or("(unknown)");
            let path = item["path"].as_str().unwrap_or("—");
            let repo = item["repository"]["full_name"].as_str().unwrap_or("—");
            let html_url = item["html_url"].as_str().unwrap_or("");
            out.push_str(&format!("• {name}\n  Repo: {repo}\n  Path: {path}\n  URL: {html_url}\n\n"));
        }

        Ok(out)
    }
}

