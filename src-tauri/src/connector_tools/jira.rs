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

    if resources.is_empty() {
        return Err(ToolError::msg(
            "No Jira Cloud instances found. Make sure your Atlassian account has access to at least one Jira Cloud site."
        ));
    }

    let id = resources
        .first()
        .and_then(|r| r["id"].as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ToolError::msg("Jira Cloud instance has no ID"))?;

    if resources.len() > 1 {
        let sites: Vec<String> = resources
            .iter()
            .filter_map(|r| {
                let id = r["id"].as_str()?;
                let name = r["name"].as_str().unwrap_or(id);
                Some(format!("{name} ({id})"))
            })
            .collect();
        eprintln!(
            "[Jira] Multiple Jira Cloud instances found — using first. Available: {}",
            sites.join(", ")
        );
    }

    manager.set_jira_cloud_id(&id);
    Ok(id)
}

pub async fn list_jira_instances(manager: &ConnectorManager, token: &str) -> Result<Vec<(String, String)>, ToolError> {
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
    Ok(resources
        .iter()
        .filter_map(|r| {
            let id = r["id"].as_str()?.to_string();
            let name = r["name"].as_str().unwrap_or(&id).to_string();
            Some((id, name))
        })
        .collect())
}

#[derive(Clone)]
pub struct JiraListInstances {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct JiraListInstancesArgs {}

impl Tool for JiraListInstances {
    const NAME: &'static str = "jira_list_instances";
    type Args = JiraListInstancesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List all Jira Cloud instances (sites) accessible to the authenticated user.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("jira", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Jira auth: {e}")))?;

        let instances = list_jira_instances(&self.manager, &token).await?;

        if instances.is_empty() {
            return Ok("No Jira Cloud instances found.".to_string());
        }

        let mut out = format!("Found {} Jira Cloud instance(s):\n\n", instances.len());
        for (id, name) in &instances {
            out.push_str(&format!("• {name}\n  Cloud ID: {id}\n\n"));
        }
        out.push_str("Use the Cloud ID when calling other Jira tools if prompted.");

        Ok(out)
    }
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
    pub start_at: Option<u32>,
}

impl Tool for JiraListIssues {
    const NAME: &'static str = "jira_list_issues";
    type Args = JiraListIssuesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List Jira issues with optional project key, status, and assignee filters. Supports pagination via start_at.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("jira", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Jira auth: {e}")))?;

        let cloud_id = get_jira_cloud_id(&self.manager, &token).await?;
        let limit = args.max_results.unwrap_or(20).min(100);
        let start = args.start_at.unwrap_or(0);

        let mut jql_parts = Vec::new();
        if let Some(proj) = &args.project {
            jql_parts.push(format!("project = \"{}\"", proj.replace('"', "\\\"")));
        }
        if let Some(status) = &args.status {
            jql_parts.push(format!("status = \"{}\"", status.replace('"', "\\\"")));
        }
        if let Some(assignee) = &args.assignee {
            jql_parts.push(format!("assignee = \"{}\"", assignee.replace('"', "\\\"")));
        }
        jql_parts.push("ORDER BY updated DESC".to_string());

        let jql = jql_parts.join(" AND ");
        let url = format!(
            "{JIRA_CLOUD_API}/{cloud_id}/rest/api/3/search/jql?jql={}&maxResults={limit}&startAt={start}&fields=summary,status,assignee,priority,updated,issuetype",
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

        check_jira_errors(&json)?;

        let issues = json["issues"].as_array().cloned().unwrap_or_default();
        let total = json["total"].as_u64().unwrap_or(0);
        let next_start = start as u64 + issues.len() as u64;

        if issues.is_empty() {
            return Ok("No issues found.".to_string());
        }

        let mut out = format!("Found {total} total issue(s) (showing {} from offset {start}):\n\n", issues.len());
        for issue in &issues {
            let key = issue["key"].as_str().unwrap_or("—");
            let summary = issue["fields"]["summary"].as_str().unwrap_or("(no title)");
            let status = issue["fields"]["status"]["name"].as_str().unwrap_or("—");
            let assignee = issue["fields"]["assignee"]["displayName"]
                .as_str()
                .unwrap_or("Unassigned");
            let priority = issue["fields"]["priority"]["name"].as_str().unwrap_or("—");
            let issue_type = issue["fields"]["issuetype"]["name"].as_str().unwrap_or("—");
            let updated = issue["fields"]["updated"].as_str().unwrap_or("—");
            out.push_str(&format!(
                "• [{key}] {summary}\n  Type: {issue_type} | Status: {status} | Priority: {priority} | Assignee: {assignee}\n  Updated: {updated}\n\n"
            ));
        }

        if next_start < total {
            out.push_str(&format!(
                "\n[More results — use start_at: {next_start} to fetch next page]"
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

    fn description(&self) -> String {
        "Get full details of a specific Jira issue by key (e.g. PROJ-123), including description, comments, and all fields.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("jira", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Jira auth: {e}")))?;

        let cloud_id = get_jira_cloud_id(&self.manager, &token).await?;

        let url = format!(
            "{JIRA_CLOUD_API}/{cloud_id}/rest/api/3/issue/{}?fields=summary,description,status,assignee,priority,comment,created,updated,issuetype,labels,components,reporter,fixVersions",
            urlencoding::encode(&args.issue_key)
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

        check_jira_errors(&json)?;

        let key = json["key"].as_str().unwrap_or("—");
        let fields = &json["fields"];
        let summary = fields["summary"].as_str().unwrap_or("(no title)");
        let status = fields["status"]["name"].as_str().unwrap_or("—");
        let priority = fields["priority"]["name"].as_str().unwrap_or("—");
        let issue_type = fields["issuetype"]["name"].as_str().unwrap_or("—");
        let assignee = fields["assignee"]["displayName"].as_str().unwrap_or("Unassigned");
        let reporter = fields["reporter"]["displayName"].as_str().unwrap_or("—");
        let created = fields["created"].as_str().unwrap_or("—");
        let updated = fields["updated"].as_str().unwrap_or("—");

        let labels: Vec<&str> = fields["labels"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|l| l.as_str()).collect())
            .unwrap_or_default();

        let components: Vec<&str> = fields["components"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|c| c["name"].as_str()).collect())
            .unwrap_or_default();

        let fix_versions: Vec<&str> = fields["fixVersions"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v["name"].as_str()).collect())
            .unwrap_or_default();

        let description = extract_adf_text(&fields["description"]);

        let mut out = format!(
            "# [{key}] {summary}\n\n\
            Type: {issue_type} | Status: {status} | Priority: {priority}\n\
            Assignee: {assignee} | Reporter: {reporter}\n\
            Created: {created} | Updated: {updated}\n"
        );

        if !labels.is_empty() {
            out.push_str(&format!("Labels: {}\n", labels.join(", ")));
        }
        if !components.is_empty() {
            out.push_str(&format!("Components: {}\n", components.join(", ")));
        }
        if !fix_versions.is_empty() {
            out.push_str(&format!("Fix Versions: {}\n", fix_versions.join(", ")));
        }

        out.push_str(&format!("\n## Description\n\n{description}\n"));

        let comments = fields["comment"]["comments"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let total_comments = fields["comment"]["total"].as_u64().unwrap_or(comments.len() as u64);

        if !comments.is_empty() {
            out.push_str(&format!("\n## Comments ({total_comments} total — showing last {}):\n\n", comments.len().min(10)));
            for c in comments.iter().rev().take(10).collect::<Vec<_>>().iter().rev() {
                let author = c["author"]["displayName"].as_str().unwrap_or("—");
                let created = c["created"].as_str().unwrap_or("—");
                let body = extract_adf_text(&c["body"]);
                out.push_str(&format!("**{author}** ({created}):\n{body}\n\n"));
            }
        }

        Ok(out)
    }
}

fn check_jira_errors(json: &Value) -> Result<(), ToolError> {
    if let Some(errs) = json["errorMessages"].as_array() {
        if !errs.is_empty() {
            let msg = errs
                .iter()
                .filter_map(|e| e.as_str())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(ToolError::msg(format!("Jira error: {msg}")));
        }
    }
    if let Some(errors) = json["errors"].as_object() {
        if !errors.is_empty() {
            let msg: Vec<String> = errors
                .iter()
                .map(|(k, v)| format!("{k}: {}", v.as_str().unwrap_or("error")))
                .collect();
            return Err(ToolError::msg(format!("Jira field errors: {}", msg.join("; "))));
        }
    }
    Ok(())
}

fn extract_adf_text(node: &Value) -> String {
    if node.is_null() || node.is_string() {
        return node.as_str().unwrap_or("").to_string();
    }
    let mut out = String::new();
    extract_adf_node(node, &mut out, 0);
    out.trim().to_string()
}

fn extract_adf_node(node: &Value, out: &mut String, depth: usize) {
    let node_type = node["type"].as_str().unwrap_or("");

    match node_type {
        "text" => {
            if let Some(t) = node["text"].as_str() {
                out.push_str(t);
            }
        }
        "hardBreak" | "rule" => {
            out.push('\n');
        }
        "paragraph" => {
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
            out.push_str("\n\n");
        }
        "heading" => {
            let level = node["attrs"]["level"].as_u64().unwrap_or(2);
            let hashes = "#".repeat(level as usize);
            out.push_str(&hashes);
            out.push(' ');
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
            out.push_str("\n\n");
        }
        "bulletList" => {
            if let Some(content) = node["content"].as_array() {
                for item in content {
                    let indent = "  ".repeat(depth);
                    out.push_str(&format!("{indent}• "));
                    extract_adf_node(item, out, depth + 1);
                }
            }
        }
        "orderedList" => {
            if let Some(content) = node["content"].as_array() {
                for (i, item) in content.iter().enumerate() {
                    let indent = "  ".repeat(depth);
                    out.push_str(&format!("{indent}{}. ", i + 1));
                    extract_adf_node(item, out, depth + 1);
                }
            }
        }
        "listItem" => {
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
            if !out.ends_with('\n') {
                out.push('\n');
            }
        }
        "blockquote" => {
            let mut inner = String::new();
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, &mut inner, depth);
                }
            }
            for line in inner.lines() {
                out.push_str(&format!("> {line}\n"));
            }
            out.push('\n');
        }
        "codeBlock" => {
            let lang = node["attrs"]["language"].as_str().unwrap_or("");
            out.push_str(&format!("```{lang}\n"));
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
            out.push_str("```\n\n");
        }
        "panel" => {
            let panel_type = node["attrs"]["panelType"].as_str().unwrap_or("info");
            out.push_str(&format!("[{panel_type}] "));
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
        }
        "table" => {
            if let Some(content) = node["content"].as_array() {
                for row in content {
                    extract_adf_node(row, out, depth);
                }
            }
            out.push('\n');
        }
        "tableRow" => {
            out.push('|');
            if let Some(content) = node["content"].as_array() {
                for cell in content {
                    let mut cell_text = String::new();
                    if let Some(cell_content) = cell["content"].as_array() {
                        for child in cell_content {
                            extract_adf_node(child, &mut cell_text, depth);
                        }
                    }
                    out.push_str(&format!(" {} |", cell_text.trim()));
                }
            }
            out.push('\n');
        }
        "tableHeader" | "tableCell" => {
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
        }
        "mediaSingle" | "mediaGroup" => {
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
        }
        "media" => {
            let alt = node["attrs"]["alt"].as_str().unwrap_or("attachment");
            out.push_str(&format!("[Attachment: {alt}]\n"));
        }
        "inlineCard" | "blockCard" | "embedCard" => {
            let url = node["attrs"]["url"].as_str().unwrap_or("");
            out.push_str(&format!("[Link: {url}]\n"));
        }
        "mention" => {
            let name = node["attrs"]["text"]
                .as_str()
                .unwrap_or_else(|| node["attrs"]["id"].as_str().unwrap_or("@someone"));
            out.push_str(name);
        }
        "emoji" => {
            let text = node["attrs"]["text"].as_str().unwrap_or("");
            out.push_str(text);
        }
        "date" => {
            let ts = node["attrs"]["timestamp"].as_str().unwrap_or("");
            out.push_str(&format!("[{ts}]"));
        }
        "status" => {
            let text = node["attrs"]["text"].as_str().unwrap_or("");
            out.push_str(&format!("[{text}]"));
        }
        "expand" | "nestedExpand" => {
            let title = node["attrs"]["title"].as_str().unwrap_or("Details");
            out.push_str(&format!("[Expand: {title}]\n"));
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
        }
        "taskList" | "decisionList" => {
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
        }
        "taskItem" => {
            let state = node["attrs"]["state"].as_str().unwrap_or("TODO");
            let mark = if state == "DONE" { "[x]" } else { "[ ]" };
            out.push_str(&format!("{mark} "));
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
            out.push('\n');
        }
        "decisionItem" => {
            out.push_str("→ ");
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
            out.push('\n');
        }
        "doc" => {
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            }
        }
        _ => {
            if let Some(content) = node["content"].as_array() {
                for child in content {
                    extract_adf_node(child, out, depth);
                }
            } else if let Some(t) = node["text"].as_str() {
                out.push_str(t);
            }
        }
    }
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
    pub start_at: Option<u32>,
}

impl Tool for JiraSearchIssues {
    const NAME: &'static str = "jira_search_issues";
    type Args = JiraSearchIssuesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search Jira issues using JQL (Jira Query Language). Example: 'project = MYPROJ AND status = \"In Progress\" ORDER BY priority DESC'. Supports pagination via start_at.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("jira", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Jira auth: {e}")))?;

        let cloud_id = get_jira_cloud_id(&self.manager, &token).await?;
        let limit = args.max_results.unwrap_or(20).min(100);
        let start = args.start_at.unwrap_or(0);

        let url = format!(
            "{JIRA_CLOUD_API}/{cloud_id}/rest/api/3/search/jql?jql={}&maxResults={limit}&startAt={start}&fields=summary,status,assignee,priority,issuetype,updated",
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

        check_jira_errors(&json)?;

        let issues = json["issues"].as_array().cloned().unwrap_or_default();
        let total = json["total"].as_u64().unwrap_or(0);
        let next_start = start as u64 + issues.len() as u64;

        if issues.is_empty() {
            return Ok("No issues match the JQL query.".to_string());
        }

        let mut out = format!("Found {total} total issue(s) (showing {} from offset {start}):\n\n", issues.len());
        for issue in &issues {
            let key = issue["key"].as_str().unwrap_or("—");
            let summary = issue["fields"]["summary"].as_str().unwrap_or("(no title)");
            let status = issue["fields"]["status"]["name"].as_str().unwrap_or("—");
            let priority = issue["fields"]["priority"]["name"].as_str().unwrap_or("—");
            let issue_type = issue["fields"]["issuetype"]["name"].as_str().unwrap_or("—");
            let assignee = issue["fields"]["assignee"]["displayName"].as_str().unwrap_or("Unassigned");
            let updated = issue["fields"]["updated"].as_str().unwrap_or("—");
            out.push_str(&format!(
                "• [{key}] {summary}\n  Type: {issue_type} | Status: {status} | Priority: {priority} | Assignee: {assignee}\n  Updated: {updated}\n\n"
            ));
        }

        if next_start < total {
            out.push_str(&format!(
                "\n[More results — use start_at: {next_start} to fetch next page]"
            ));
        }

        Ok(out)
    }
}
