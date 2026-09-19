use super::{request_json, truncate_text};

use std::sync::Arc;

use base64::Engine as _;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

const GITHUB_API: &str = "https://api.github.com";
const GITHUB_API_VERSION: &str = "2022-11-28";

fn github_request(manager: &ConnectorManager, token: &str, url: &str) -> reqwest::RequestBuilder {
    manager
        .http()
        .get(url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .header("User-Agent", "Orch-App")
}

fn check_github_error(json: &serde_json::Value) -> Result<(), ToolError> {
    if let Some(msg) = json["message"].as_str() {
        let docs = json["documentation_url"].as_str().unwrap_or("");
        if docs.is_empty() {
            return Err(ToolError::msg(format!("GitHub API error: {msg}")));
        }
        return Err(ToolError::msg(format!("GitHub API error: {msg} — {docs}")));
    }
    Ok(())
}

#[derive(Clone)]
pub struct GitHubListRepos {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitHubListReposArgs {
    pub visibility: Option<String>,
    pub max_results: Option<u32>,
    pub page: Option<u32>,
}

impl Tool for GitHubListRepos {
    const NAME: &'static str = "github_list_repos";
    type Args = GitHubListReposArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List GitHub repositories accessible to the authenticated user. visibility can be 'all', 'owner', 'public', or 'private'. Supports pagination via page.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("github", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("GitHub auth: {e}")))?;

        let visibility = args.visibility.as_deref().unwrap_or("owner");
        let limit = args.max_results.unwrap_or(30).min(100);
        let page = args.page.unwrap_or(1).max(1);

        let url = format!(
            "{GITHUB_API}/user/repos?type={visibility}&sort=updated&per_page={limit}&page={page}"
        );

        let repos_json = request_json(
            github_request(&self.manager, &token, &url),
            "GitHub",
        )
        .await?;

        check_github_error(&repos_json)?;

        let repos = repos_json.as_array().cloned().unwrap_or_default();

        if repos.is_empty() {
            return Ok(format!("No repositories found (page {page})."));
        }

        let mut out = format!("Found {} repository/repositories (page {page}):\n\n", repos.len());
        for repo in &repos {
            let name = repo["full_name"].as_str().unwrap_or("(unnamed)");
            let desc = repo["description"].as_str().filter(|s| !s.is_empty()).unwrap_or("No description");
            let lang = repo["language"].as_str().unwrap_or("—");
            let stars = repo["stargazers_count"].as_u64().unwrap_or(0);
            let forks = repo["forks_count"].as_u64().unwrap_or(0);
            let updated = repo["updated_at"].as_str().unwrap_or("—");
            let private = repo["private"].as_bool().unwrap_or(false);
            let default_branch = repo["default_branch"].as_str().unwrap_or("main");
            let html_url = repo["html_url"].as_str().unwrap_or("");
            out.push_str(&format!(
                "• {name} [{lang}] ★{stars} 🍴{forks} {}\n  Branch: {default_branch}\n  {desc}\n  Updated: {updated}\n  URL: {html_url}\n\n",
                if private { "(private)" } else { "(public)" }
            ));
        }

        if repos.len() == limit as usize {
            out.push_str(&format!("\n[Use page: {} to fetch next page]", page + 1));
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

    fn description(&self) -> String {
        "Read a file from a GitHub repository. repo must be 'owner/repo' format. Returns decoded file content.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("github", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("GitHub auth: {e}")))?;

        let clean_path = args.path.trim_start_matches('/');
        let mut url = format!(
            "{GITHUB_API}/repos/{}/contents/{}",
            args.repo,
            urlencoding::encode(clean_path)
        );
        if let Some(r) = &args.ref_ {
            url.push_str(&format!("?ref={}", urlencoding::encode(r)));
        }

        let json = request_json(
            github_request(&self.manager, &token, &url),
            "GitHub",
        )
        .await?;

        check_github_error(&json)?;

        if json.is_array() {
            let entries = json.as_array().unwrap();
            let mut out = format!("Directory listing for {}/{}:\n\n", args.repo, clean_path);
            for entry in entries {
                let name = entry["name"].as_str().unwrap_or("(unknown)");
                let entry_type = entry["type"].as_str().unwrap_or("?");
                let size = entry["size"].as_u64().unwrap_or(0);
                let icon = if entry_type == "dir" { "📁" } else { "📄" };
                out.push_str(&format!("{icon} {name}  ({size} bytes)\n"));
            }
            return Ok(out);
        }

        let encoding = json["encoding"].as_str().unwrap_or("");
        let content_raw = json["content"].as_str().unwrap_or("");
        let name = json["name"].as_str().unwrap_or(&args.path);
        let sha = json["sha"].as_str().unwrap_or("—");
        let size = json["size"].as_u64().unwrap_or(0);
        let html_url = json["html_url"].as_str().unwrap_or("");

        if encoding != "base64" && !content_raw.is_empty() {
            return Ok(format!("File: {name} (sha: {sha}, {size} bytes)\nURL: {html_url}\n\n{content_raw}"));
        }

        if content_raw.is_empty() {
            return Ok(format!("File: {name} (sha: {sha}, {size} bytes)\nURL: {html_url}\n\n[Empty file]"));
        }

        let cleaned: String = content_raw.chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(cleaned.as_bytes())
            .map_err(|e| ToolError::msg(format!("base64 decode failed: {e}")))?;

        let content = String::from_utf8_lossy(&bytes).into_owned();
        let char_count = content.chars().count();
        let truncated = truncate_text(
            &content,
            40_000,
            &format!("\n\n[Truncated: showing first 40,000 of {char_count} chars]"),
        );

        Ok(format!("File: {name} (sha: {sha}, {size} bytes)\nURL: {html_url}\n\n{truncated}"))
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
    pub page: Option<u32>,
}

impl Tool for GitHubSearchCode {
    const NAME: &'static str = "github_search_code";
    type Args = GitHubSearchCodeArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search code across GitHub repositories using GitHub code search syntax. Example: 'fn main language:rust repo:owner/repo'. Supports pagination via page.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("github", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("GitHub auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(30);
        let page = args.page.unwrap_or(1).max(1);
        let url = format!(
            "{GITHUB_API}/search/code?q={}&per_page={limit}&page={page}",
            urlencoding::encode(&args.query)
        );

        let json = request_json(
            github_request(&self.manager, &token, &url),
            "GitHub",
        )
        .await?;

        check_github_error(&json)?;

        let total = json["total_count"].as_u64().unwrap_or(0);
        let incomplete = json["incomplete_results"].as_bool().unwrap_or(false);
        let items = json["items"].as_array().cloned().unwrap_or_default();
        let total_pages = (total + limit as u64 - 1) / limit as u64;

        if items.is_empty() {
            return Ok(format!("No code results for '{}'.", args.query));
        }

        let mut out = format!(
            "Found {total} total results{} (page {page} of {total_pages}, showing {}):\n\n",
            if incomplete { " (results may be incomplete)" } else { "" },
            items.len()
        );
        for item in &items {
            let name = item["name"].as_str().unwrap_or("(unknown)");
            let path = item["path"].as_str().unwrap_or("—");
            let repo = item["repository"]["full_name"].as_str().unwrap_or("—");
            let html_url = item["html_url"].as_str().unwrap_or("");
            out.push_str(&format!("• {name}\n  Repo: {repo}\n  Path: {path}\n  URL: {html_url}\n\n"));
        }

        if (page as u64) < total_pages {
            out.push_str(&format!("\n[More results — use page: {} to fetch next page]", page + 1));
        }

        Ok(out)
    }
}

#[derive(Clone)]
pub struct GitHubSearchRepos {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GitHubSearchReposArgs {
    pub query: String,
    pub max_results: Option<u32>,
    pub page: Option<u32>,
}

impl Tool for GitHubSearchRepos {
    const NAME: &'static str = "github_search_repos";
    type Args = GitHubSearchReposArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search GitHub repositories by name, description, or topics. Example: 'language:rust stars:>1000'. Supports pagination via page.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("github", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("GitHub auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(100);
        let page = args.page.unwrap_or(1).max(1);
        let url = format!(
            "{GITHUB_API}/search/repositories?q={}&sort=stars&order=desc&per_page={limit}&page={page}",
            urlencoding::encode(&args.query)
        );

        let json = request_json(
            github_request(&self.manager, &token, &url),
            "GitHub",
        )
        .await?;

        check_github_error(&json)?;

        let total = json["total_count"].as_u64().unwrap_or(0);
        let items = json["items"].as_array().cloned().unwrap_or_default();
        let total_pages = (total + limit as u64 - 1) / limit as u64;

        if items.is_empty() {
            return Ok(format!("No repositories found for '{}'.", args.query));
        }

        let mut out = format!(
            "Found {total} total repositories (page {page} of {total_pages}, showing {}):\n\n",
            items.len()
        );
        for repo in &items {
            let name = repo["full_name"].as_str().unwrap_or("(unnamed)");
            let desc = repo["description"].as_str().filter(|s| !s.is_empty()).unwrap_or("No description");
            let lang = repo["language"].as_str().unwrap_or("—");
            let stars = repo["stargazers_count"].as_u64().unwrap_or(0);
            let html_url = repo["html_url"].as_str().unwrap_or("");
            out.push_str(&format!(
                "• {name} [{lang}] ★{stars}\n  {desc}\n  URL: {html_url}\n\n"
            ));
        }

        if (page as u64) < total_pages {
            out.push_str(&format!("\n[More results — use page: {} to fetch next page]", page + 1));
        }

        Ok(out)
    }
}
