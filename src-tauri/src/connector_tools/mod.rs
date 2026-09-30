use std::sync::Arc;
use std::time::Duration;

use reqwest::{RequestBuilder, Response, StatusCode};
use rig::tool::{Tool, ToolExecutionError};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::{tool_failure, ToolError};

pub mod github;
pub mod gmail;
pub mod google_drive;
pub mod jira;
pub mod notion;
pub mod slack;

const MAX_RETRIES: usize = 3;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(10);
const MAX_DOWNLOAD_BYTES: usize = 25 * 1024 * 1024;

fn retry_delay(response: &Response, attempt: usize) -> Duration {
    response
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_millis(500 * (1 << attempt) as u64))
        .min(MAX_RETRY_WAIT)
}

async fn send_with_retry(request: RequestBuilder, provider: &str) -> Result<Response, ToolError> {
    let mut attempt = 0usize;
    let mut current = request;
    loop {
        let retry = current.try_clone();
        let response = current
            .send()
            .await
            .map_err(|e| ToolError::msg(format!("{provider} request failed: {e}")))?;
        let status = response.status();
        let retryable = status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE;
        match retry {
            Some(next) if retryable && attempt < MAX_RETRIES => {
                tokio::time::sleep(retry_delay(&response, attempt)).await;
                attempt += 1;
                current = next;
            }
            _ => return Ok(response),
        }
    }
}

async fn read_success_body(response: Response, provider: &str) -> Result<String, ToolError> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} response read failed: {e}")))?;
    if !status.is_success() {
        return Err(ToolError::msg(format!(
            "{provider} API error ({}): {}",
            status.as_u16(),
            crate::util::truncate_chars(&body, 1_000)
        )));
    }
    Ok(body)
}

pub async fn request_json(request: RequestBuilder, provider: &str) -> Result<Value, ToolError> {
    let response = send_with_retry(request, provider).await?;
    let body = read_success_body(response, provider).await?;
    serde_json::from_str(&body).map_err(|e| {
        ToolError::msg(format!(
            "{provider} response parse failed: {e} — body: {}",
            crate::util::truncate_chars(&body, 200)
        ))
    })
}

pub async fn request_text(request: RequestBuilder, provider: &str) -> Result<String, ToolError> {
    let response = send_with_retry(request, provider).await?;
    read_success_body(response, provider).await
}

pub async fn request_bytes(request: RequestBuilder, provider: &str) -> Result<Vec<u8>, ToolError> {
    let response = send_with_retry(request, provider).await?;
    let status = response.status();
    if !status.is_success() {
        return Err(read_success_body(response, provider).await.err().unwrap_or_else(|| {
            ToolError::msg(format!("{provider} API error ({})", status.as_u16()))
        }));
    }
    if let Some(length) = response.content_length() {
        if length as usize > MAX_DOWNLOAD_BYTES {
            return Err(ToolError::msg(format!(
                "{provider} file is too large to read ({length} bytes)"
            )));
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} download failed: {e}")))?;
    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err(ToolError::msg(format!(
            "{provider} file is too large to read ({} bytes)",
            bytes.len()
        )));
    }
    Ok(bytes.to_vec())
}

pub fn truncate_text(text: &str, limit: usize, suffix: &str) -> String {
    let Some((end, _)) = text.char_indices().nth(limit) else {
        return text.to_string();
    };
    format!("{}{}", &text[..end], suffix)
}

#[derive(Clone)]
pub struct ConnectorSearch {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ConnectorSearchArgs {
    pub provider: String,
    pub query: String,
    pub max_results: Option<u32>,
    pub page_token: Option<String>,
}

impl Tool for ConnectorSearch {
    const NAME: &'static str = "connector_search";
    type Args = ConnectorSearchArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search connected external services by provider name and query. Supported providers: google_drive, gmail, github, notion, slack, jira. Use page_token/cursor for pagination.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let p = args.provider.to_lowercase();
        let manager = &self.manager;
        let memory = &self.memory;
        match p.as_str() {
            "google_drive" | "gdrive" | "drive" => {
                google_drive::GoogleDriveSearchFiles { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, google_drive::GoogleDriveSearchFilesArgs {
                        query: args.query,
                        max_results: args.max_results,
                        page_token: args.page_token,
                    }).await
            }
            "gmail" | "email" => {
                gmail::GmailSearchEmails { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, gmail::GmailSearchEmailsArgs {
                        query: args.query,
                        max_results: args.max_results,
                        page_token: args.page_token,
                    }).await
            }
            "github" => {
                github::GitHubSearchCode { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, github::GitHubSearchCodeArgs {
                        query: args.query,
                        max_results: args.max_results,
                        page: args.page_token.as_deref().and_then(|s| s.parse().ok()),
                    }).await
            }
            "notion" => {
                notion::NotionSearchPages { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, notion::NotionSearchPagesArgs {
                        query: args.query,
                        max_results: args.max_results,
                        cursor: args.page_token,
                    }).await
            }
            "slack" => {
                slack::SlackSearchMessages { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, slack::SlackSearchMessagesArgs {
                        query: args.query,
                        max_results: args.max_results,
                        page: args.page_token.as_deref().and_then(|s| s.parse().ok()),
                    }).await
            }
            "jira" => {
                jira::JiraSearchIssues { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, jira::JiraSearchIssuesArgs {
                        jql: args.query,
                        max_results: args.max_results,
                        next_page_token: args.page_token,
                    }).await
            }
            unknown => Err(ToolError::msg(format!(
                "Unknown connector provider '{unknown}'. Supported: google_drive, gmail, github, notion, slack, jira."
            ))),
        }
    }
}

#[derive(Clone)]
pub struct ConnectorRead {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ConnectorReadArgs {
    pub provider: String,
    pub target: String,
    pub extra: Option<String>,
}

impl Tool for ConnectorRead {
    const NAME: &'static str = "connector_read";
    type Args = ConnectorReadArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Read specific content from a connected service. target is: file ID for Google Drive, message ID for Gmail, 'owner/repo/path' for GitHub, page ID for Notion, channel ID for Slack, issue key (e.g. PROJ-123) for Jira.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let p = args.provider.to_lowercase();
        let manager = &self.manager;
        let memory = &self.memory;
        match p.as_str() {
            "google_drive" | "gdrive" | "drive" => {
                google_drive::GoogleDriveReadFile { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, google_drive::GoogleDriveReadFileArgs {
                        file_id: args.target,
                        export_mime_type: args.extra,
                    }).await
            }
            "gmail" | "email" => {
                gmail::GmailReadEmail { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, gmail::GmailReadEmailArgs { message_id: args.target }).await
            }
            "github" => {
                let (repo, path) = if let Some(ref extra_path) = args.extra {
                    (args.target.clone(), extra_path.clone())
                } else {
                    let parts: Vec<&str> = args.target.splitn(3, '/').collect();
                    if parts.len() >= 3 {
                        (format!("{}/{}", parts[0], parts[1]), parts[2].to_string())
                    } else {
                        return Err(ToolError::msg(
                            "GitHub read target must be 'owner/repo/path/to/file' or set extra='path/to/file'"
                        ));
                    }
                };
                github::GitHubReadFile { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, github::GitHubReadFileArgs { repo, path, ref_: None }).await
            }
            "notion" => {
                notion::NotionReadPage { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, notion::NotionReadPageArgs { page_id: args.target }).await
            }
            "slack" => {
                let oldest = args.extra.as_deref().and_then(|s| s.parse::<f64>().ok());
                slack::SlackReadMessages { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, slack::SlackReadMessagesArgs {
                        channel_id: args.target,
                        limit: Some(50),
                        oldest,
                        cursor: None,
                    }).await
            }
            "jira" => {
                jira::JiraGetIssue { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, jira::JiraGetIssueArgs { issue_key: args.target }).await
            }
            unknown => Err(ToolError::msg(format!(
                "Unknown connector provider '{unknown}'. Supported: google_drive, gmail, github, notion, slack, jira."
            ))),
        }
    }
}

#[derive(Clone)]
pub struct ConnectorList {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ConnectorListArgs {
    pub provider: String,
    pub container: Option<String>,
    pub max_results: Option<u32>,
    pub page_token: Option<String>,
}

impl Tool for ConnectorList {
    const NAME: &'static str = "connector_list";
    type Args = ConnectorListArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List items in a connected service. container is: folder ID for Drive, label/filter for Gmail, 'all'/'owner'/'private' for GitHub repos, database ID for Notion, nothing needed for Slack channels, project key for Jira. Use page_token for pagination.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let p = args.provider.to_lowercase();
        let manager = &self.manager;
        let memory = &self.memory;
        match p.as_str() {
            "google_drive" | "gdrive" | "drive" => {
                google_drive::GoogleDriveListFiles { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, google_drive::GoogleDriveListFilesArgs {
                        folder_id: args.container,
                        mime_type: None,
                        max_results: args.max_results,
                        page_token: args.page_token,
                    }).await
            }
            "gmail" | "email" => {
                gmail::GmailListEmails { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, gmail::GmailListEmailsArgs {
                        filter: args.container,
                        max_results: args.max_results,
                        page_token: args.page_token,
                    }).await
            }
            "github" => {
                github::GitHubListRepos { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, github::GitHubListReposArgs {
                        visibility: args.container,
                        max_results: args.max_results,
                        page: args.page_token.as_deref().and_then(|s| s.parse().ok()),
                    }).await
            }
            "notion" => {
                notion::NotionListPages { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, notion::NotionListPagesArgs {
                        database_id: args.container,
                        max_results: args.max_results,
                        cursor: args.page_token,
                    }).await
            }
            "slack" => {
                slack::SlackListChannels { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, slack::SlackListChannelsArgs {
                        max_results: args.max_results,
                        cursor: args.page_token,
                        include_private: None,
                    }).await
            }
            "jira" => {
                jira::JiraListIssues { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, jira::JiraListIssuesArgs {
                        project: args.container,
                        status: None,
                        assignee: None,
                        max_results: args.max_results,
                        next_page_token: args.page_token,
                    }).await
            }
            unknown => Err(ToolError::msg(format!(
                "Unknown connector provider '{unknown}'. Supported: google_drive, gmail, github, notion, slack, jira."
            ))),
        }
    }
}
