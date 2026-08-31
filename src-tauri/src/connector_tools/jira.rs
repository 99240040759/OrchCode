use super::request_json;

use std::sync::Arc;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

const JIRA_CLOUD_API: &str = "https://api.atlassian.com/ex/jira";

async fn get_jira_cloud_id(manager: &ConnectorManager, token: &str) -> Result<String, ToolError> {
    if let Some(id) = manager.cached_jira_cloud_id() {
        return Ok(id);
    }
    let json = request_json(
        manager
            .http()
            .get("https://api.atlassian.com/oauth/token/accessible-resources")
            .bearer_auth(token)
            .header("Accept", "application/json"),
        "Jira",
    )
    .await?;
    let resources = json.as_array().cloned().unwrap_or_default();

    let id = resources
        .first()
        .and_then(|r| r["id"].as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ToolError::msg("No Jira Cloud instances found"))?;
    manager.set_jira_cloud_id(&id);
    Ok(id)
}

#[derive(Clone)]
pub struct JiraListIssues {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct JiraListIssuesArgs {
    pub project: Option<String>,
    pub status: Option<String>,
    pub assignee: Option<String>,
    pub max_results: Option<u32>,
}

impl Tool for JiraListIssues {
    const NAME: &'static str = "jira_list_issues";
    type Args = JiraListIssuesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "List Jira issues with optional project, status, and assignee filters.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("jira", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Jira auth: {e}")))?;

        let cloud_id = get_jira_cloud_id(&self.manager, &token).await?;
        let limit = args.max_results.unwrap_or(20).min(50);

        let mut jql_parts = Vec::new();
        if let Some(proj) = &args.project {
            jql_parts.push(format!("project = {proj}"));
        }
        if let Some(status) = &args.status {
            jql_parts.push(format!("status = \"{status}\""));
        }
        if let Some(assignee) = &args.assignee {
            jql_parts.push(format!("assignee = {assignee}"));
        }
        jql_parts.push("ORDER BY updated DESC".to_string());

        let jql = jql_parts.join(" AND ");
        let url = format!(
            "{JIRA_CLOUD_API}/{cloud_id}/rest/api/3/search/jql?jql={}&maxResults={limit}&fields=summary,status,assignee,priority,updated",
            urlencoding::encode(&jql)
        );

        let json = request_json(
            self.manager
                .http()
                .get(&url)
                .bearer_auth(&token)
                .header("Accept", "application/json"),
            "Jira",
        )
        .await?;

        if let Some(err) = json["errorMessages"].as_array() {
            if !err.is_empty() {
                return Err(ToolError::msg(format!("Jira error: {:?}", err)));
            }
        }

        let issues = json["issues"].as_array().cloned().unwrap_or_default();

        if issues.is_empty() {
            return Ok("No issues found.".to_string());
        }

        let mut out = format!("Found {} issue(s):\n\n", issues.len());
        for issue in &issues {
            let key = issue["key"].as_str().unwrap_or("—");
            let summary = issue["fields"]["summary"].as_str().unwrap_or("(no title)");
            let status = issue["fields"]["status"]["name"].as_str().unwrap_or("—");
            let assignee = issue["fields"]["assignee"]["displayName"]
                .as_str()
                .unwrap_or("Unassigned");
            let priority = issue["fields"]["priority"]["name"].as_str().unwrap_or("—");
            out.push_str(&format!(
                "• [{key}] {summary}\n  Status: {status} | Priority: {priority} | Assignee: {assignee}\n\n"
            ));
        }

        Ok(out)
    }
}

#[derive(Clone)]
pub struct JiraGetIssue {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct JiraGetIssueArgs {
    pub issue_key: String,
}

impl Tool for JiraGetIssue {
    const NAME: &'static str = "jira_get_issue";
    type Args = JiraGetIssueArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Get full details of a specific Jira issue including description and comments.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("jira", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Jira auth: {e}")))?;

        let cloud_id = get_jira_cloud_id(&self.manager, &token).await?;

        let url = format!(
            "{JIRA_CLOUD_API}/{cloud_id}/rest/api/3/issue/{}?fields=summary,description,status,assignee,priority,comment,created,updated",
            args.issue_key
        );

        let json: Value = request_json(
            self.manager
                .http()
                .get(&url)
                .bearer_auth(&token)
                .header("Accept", "application/json"),
            "Jira",
        )
        .await?;

        if let Some(err) = json["errorMessages"].as_array() {
            if !err.is_empty() {
                return Err(ToolError::msg(format!("Jira error: {:?}", err)));
            }
        }

        let key = json["key"].as_str().unwrap_or("—");
        let fields = &json["fields"];
        let summary = fields["summary"].as_str().unwrap_or("(no title)");
        let status = fields["status"]["name"].as_str().unwrap_or("—");
        let priority = fields["priority"]["name"].as_str().unwrap_or("—");
        let assignee = fields["assignee"]["displayName"]
            .as_str()
            .unwrap_or("Unassigned");
        let created = fields["created"].as_str().unwrap_or("—");
        let updated = fields["updated"].as_str().unwrap_or("—");

        let description = extract_adf_text(&fields["description"]);

        let mut out = format!(
            "# [{key}] {summary}\n\nStatus: {status} | Priority: {priority} | Assignee: {assignee}\nCreated: {created} | Updated: {updated}\n\n## Description\n{description}\n"
        );

        let comments = fields["comment"]["comments"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if !comments.is_empty() {
            out.push_str(&format!("\n## Comments ({}):\n\n", comments.len()));
            for (_i, c) in comments.iter().enumerate().take(10) {
                let author = c["author"]["displayName"].as_str().unwrap_or("—");
                let created = c["created"].as_str().unwrap_or("—");
                let body = extract_adf_text(&c["body"]);
                out.push_str(&format!("**{author}** ({created}):\n{body}\n\n"));
            }
        }

        Ok(out)
    }
}

fn extract_adf_text(node: &Value) -> String {
    if node.is_null() {
        return String::new();
    }
    let mut out = String::new();
    if let Some(content) = node["content"].as_array() {
        for block in content {
            let node_type = block["type"].as_str().unwrap_or("");
            match node_type {
                "paragraph" | "heading" | "listItem" | "bulletList" | "orderedList" | "codeBlock" => {
                    out.push_str(&extract_adf_text(block));
                    out.push('\n');
                }
                "text" => {
                    if let Some(t) = block["text"].as_str() {
                        out.push_str(t);
                    }
                }
                "hardBreak" => out.push('\n'),
                _ => out.push_str(&extract_adf_text(block)),
            }
        }
    }
    out
}

#[derive(Clone)]
pub struct JiraSearchIssues {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct JiraSearchIssuesArgs {
    pub jql: String,
    pub max_results: Option<u32>,
}

impl Tool for JiraSearchIssues {
    const NAME: &'static str = "jira_search_issues";
    type Args = JiraSearchIssuesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Search Jira issues using JQL (Jira Query Language).".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("jira", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Jira auth: {e}")))?;

        let cloud_id = get_jira_cloud_id(&self.manager, &token).await?;
        let limit = args.max_results.unwrap_or(20).min(50);

        let url = format!(
            "{JIRA_CLOUD_API}/{cloud_id}/rest/api/3/search/jql?jql={}&maxResults={limit}&fields=summary,status,assignee,priority",
            urlencoding::encode(&args.jql)
        );

        let json = request_json(
            self.manager
                .http()
                .get(&url)
                .bearer_auth(&token)
                .header("Accept", "application/json"),
            "Jira",
        )
        .await?;

        if let Some(errs) = json["errorMessages"].as_array() {
            if !errs.is_empty() {
                let msg = errs
                    .iter()
                    .filter_map(|e| e.as_str())
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(ToolError::msg(format!("Jira JQL error: {msg}")));
            }
        }

        let issues = json["issues"].as_array().cloned().unwrap_or_default();

        if issues.is_empty() {
            return Ok("No issues match the JQL query.".to_string());
        }

        let mut out = format!("Found {} issue(s):\n\n", issues.len());
        for issue in &issues {
            let key = issue["key"].as_str().unwrap_or("—");
            let summary = issue["fields"]["summary"].as_str().unwrap_or("(no title)");
            let status = issue["fields"]["status"]["name"].as_str().unwrap_or("—");
            out.push_str(&format!("• [{key}] {summary} — {status}\n"));
        }

        Ok(out)
    }
}

