use std::sync::Arc;

use reqwest::RequestBuilder;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

pub mod github;
pub mod gmail;
pub mod google_drive;
pub mod jira;
pub mod notion;
pub mod slack;

pub async fn request_json(request: RequestBuilder, provider: &str) -> Result<Value, ToolError> {
    let response = request
        .send()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} request failed: {e}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} response read failed: {e}")))?;
    if !status.is_success() {
        return Err(ToolError::msg(format!(
            "{provider} API error ({}): {}",
            status.as_u16(),
            body
        )));
    }
    serde_json::from_str(&body)
        .map_err(|e| ToolError::msg(format!("{provider} response parse failed: {e}")))
}

pub async fn request_text(request: RequestBuilder, provider: &str) -> Result<String, ToolError> {
    let response = request
        .send()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} request failed: {e}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} response read failed: {e}")))?;
    if !status.is_success() {
        return Err(ToolError::msg(format!(
            "{provider} API error ({}): {}",
            status.as_u16(),
            body
        )));
    }
    Ok(body)
}

pub fn truncate_text(text: &str, limit: usize, suffix: &str) -> String {
    let Some((end, _)) = text.char_indices().nth(limit) else {
        return text.to_string();
    };
    format!("{}{}", &text[..end], suffix)
}

// ==========================================
// UNIFIED CONNECTOR TOOLS
// ==========================================

#[derive(Clone)]
pub struct ConnectorSearch {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ConnectorSearchArgs {
    /// The provider service: "google_drive", "gmail", "github", "notion", "slack", or "jira"
    pub provider: String,
    /// Search query string
    pub query: String,
    /// Optional maximum results to return
    pub max_results: Option<u32>,
}

impl Tool for ConnectorSearch {
    const NAME: &'static str = "connector_search";
    type Args = ConnectorSearchArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search connected external services (Google Drive, Gmail, GitHub, Notion, Slack, Jira) by provider name and query.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let p = args.provider.to_lowercase();
        let manager = &self.manager;
        let memory = &self.memory;
        match p.as_str() {
            "google_drive" | "gdrive" | "drive" => {
                google_drive::GoogleDriveSearchFiles { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, google_drive::GoogleDriveSearchFilesArgs { query: args.query, max_results: args.max_results }).await
            }
            "gmail" | "email" => {
                gmail::GmailSearchEmails { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, gmail::GmailSearchEmailsArgs { query: args.query, max_results: args.max_results }).await
            }
            "github" => {
                github::GitHubSearchCode { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, github::GitHubSearchCodeArgs { query: args.query, max_results: args.max_results }).await
            }
            "notion" => {
                notion::NotionSearchPages { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, notion::NotionSearchPagesArgs { query: args.query, max_results: args.max_results }).await
            }
            "slack" => {
                slack::SlackSearchMessages { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, slack::SlackSearchMessagesArgs { query: args.query, max_results: args.max_results }).await
            }
            "jira" => {
                jira::JiraSearchIssues { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, jira::JiraSearchIssuesArgs { jql: args.query, max_results: args.max_results }).await
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
    /// The provider service: "google_drive", "gmail", "github", "notion", "slack", or "jira"
    pub provider: String,
    /// Target identifier: File ID (Google Drive), Message ID (Gmail), "owner/repo/path" (GitHub), Page ID (Notion), Channel ID (Slack), or Issue Key (Jira)
    pub target: String,
    /// Optional extra parameter (e.g. export MIME type for Google Drive, ref/branch for GitHub, oldest timestamp for Slack)
    pub extra: Option<String>,
}

impl Tool for ConnectorRead {
    const NAME: &'static str = "connector_read";
    type Args = ConnectorReadArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Read specific content from a connected service: a file in Google Drive/GitHub, an email in Gmail, a Notion page, Slack messages in a channel, or a Jira issue.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let p = args.provider.to_lowercase();
        let manager = &self.manager;
        let memory = &self.memory;
        match p.as_str() {
            "google_drive" | "gdrive" | "drive" => {
                google_drive::GoogleDriveReadFile { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, google_drive::GoogleDriveReadFileArgs { file_id: args.target, export_mime_type: args.extra }).await
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
                        return Err(ToolError::msg("GitHub read target must be 'owner/repo/path/to/file' or set extra='path'"));
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
                    .call(_ctx, slack::SlackReadMessagesArgs { channel_id: args.target, limit: Some(50), oldest }).await
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
    /// The provider service: "google_drive", "gmail", "github", "notion", "slack", or "jira"
    pub provider: String,
    /// Optional container/filter (Folder ID for Google Drive, database ID for Notion, filter for Gmail, visibility for GitHub, project for Jira)
    pub container: Option<String>,
    /// Optional maximum results to return
    pub max_results: Option<u32>,
}

impl Tool for ConnectorList {
    const NAME: &'static str = "connector_list";
    type Args = ConnectorListArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List items in a connected service: files in Google Drive, recent emails in Gmail, repositories in GitHub, pages in Notion, channels in Slack, or issues in Jira.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let p = args.provider.to_lowercase();
        let manager = &self.manager;
        let memory = &self.memory;
        match p.as_str() {
            "google_drive" | "gdrive" | "drive" => {
                google_drive::GoogleDriveListFiles { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, google_drive::GoogleDriveListFilesArgs { folder_id: args.container, mime_type: None, max_results: args.max_results }).await
            }
            "gmail" | "email" => {
                gmail::GmailListEmails { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, gmail::GmailListEmailsArgs { filter: args.container, max_results: args.max_results }).await
            }
            "github" => {
                github::GitHubListRepos { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, github::GitHubListReposArgs { visibility: args.container, max_results: args.max_results }).await
            }
            "notion" => {
                notion::NotionListPages { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, notion::NotionListPagesArgs { database_id: args.container, max_results: args.max_results }).await
            }
            "slack" => {
                slack::SlackListChannels { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, slack::SlackListChannelsArgs { max_results: args.max_results }).await
            }
            "jira" => {
                jira::JiraListIssues { manager: manager.clone(), memory: memory.clone() }
                    .call(_ctx, jira::JiraListIssuesArgs { project: args.container, status: None, assignee: None, max_results: args.max_results }).await
            }
            unknown => Err(ToolError::msg(format!(
                "Unknown connector provider '{unknown}'. Supported: google_drive, gmail, github, notion, slack, jira."
            ))),
        }
    }
}

