use std::sync::Arc;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

#[derive(Clone)]
pub struct GmailListEmails {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GmailListEmailsArgs {
    pub filter: Option<String>,
    pub max_results: Option<u32>,
}

impl Tool for GmailListEmails {
    const NAME: &'static str = "gmail_list_emails";
    type Args = GmailListEmailsArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "List recent emails from Gmail with optional search filter.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("gmail", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Gmail auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(50);
        let mut url = format!("{GMAIL_API}/messages?maxResults={limit}&format=minimal");
        if let Some(filter) = &args.filter {
            url.push_str(&format!("&q={}", urlencoding::encode(filter)));
        }

        let list_json: Value = self
            .manager
            .http()
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        let messages = list_json["messages"].as_array().cloned().unwrap_or_default();
        if messages.is_empty() {
            return Ok("No emails found.".to_string());
        }

        let mut out = format!("Found {} email(s):\n\n", messages.len());
        for msg in messages.iter().take(20) {
            let id = msg["id"].as_str().unwrap_or("");
            let meta_url = format!(
                "{GMAIL_API}/messages/{id}?format=metadata&metadataHeaders=Subject,From,Date"
            );
            if let Ok(resp) = self
                .manager
                .http()
                .get(&meta_url)
                .bearer_auth(&token)
                .send()
                .await
            {
                if let Ok(meta) = resp.json::<Value>().await {
                    let headers = meta["payload"]["headers"].as_array().cloned().unwrap_or_default();
                    let subject = header_value(&headers, "Subject");
                    let from = header_value(&headers, "From");
                    let date = header_value(&headers, "Date");
                    let snippet = meta["snippet"].as_str().unwrap_or("").chars().take(120).collect::<String>();
                    out.push_str(&format!(
                        "• ID: {id}\n  Subject: {subject}\n  From: {from}\n  Date: {date}\n  Snippet: {snippet}\n\n"
                    ));
                }
            }
        }

        Ok(out)
    }
}

fn header_value(headers: &[Value], name: &str) -> String {
    headers
        .iter()
        .find(|h| h["name"].as_str().map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false))
        .and_then(|h| h["value"].as_str())
        .unwrap_or("—")
        .to_string()
}

#[derive(Clone)]
pub struct GmailReadEmail {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GmailReadEmailArgs {
    pub message_id: String,
}

impl Tool for GmailReadEmail {
    const NAME: &'static str = "gmail_read_email";
    type Args = GmailReadEmailArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Read the full content of an email by its Gmail message ID.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("gmail", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Gmail auth: {e}")))?;

        let url = format!("{GMAIL_API}/messages/{}?format=full", args.message_id);
        let json: Value = self
            .manager
            .http()
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        if let Some(err) = json["error"]["message"].as_str() {
            return Err(ToolError::msg(format!("Gmail error: {err}")));
        }

        let headers = json["payload"]["headers"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let subject = header_value(&headers, "Subject");
        let from = header_value(&headers, "From");
        let to = header_value(&headers, "To");
        let date = header_value(&headers, "Date");

        let body = extract_gmail_body(&json["payload"]);

        let mut out = format!(
            "Subject: {subject}\nFrom: {from}\nTo: {to}\nDate: {date}\n\n---\n\n{body}"
        );

        const MAX_CHARS: usize = 20_000;
        if out.len() > MAX_CHARS {
            out.truncate(MAX_CHARS);
            out.push_str("\n\n[Truncated]");
        }

        Ok(out)
    }
}

fn extract_gmail_body(payload: &Value) -> String {
    let mime = payload["mimeType"].as_str().unwrap_or("");

    if mime == "text/plain" {
        if let Some(data) = payload["body"]["data"].as_str() {
            let cleaned: String = data
                .chars()
                .map(|c| if c == '-' { '+' } else if c == '_' { '/' } else { c })
                .collect();
            if let Ok(bytes) =
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, cleaned.as_bytes())
            {
                return String::from_utf8_lossy(&bytes).into_owned();
            }
        }
    }

    if let Some(parts) = payload["parts"].as_array() {
        for part in parts {
            let part_mime = part["mimeType"].as_str().unwrap_or("");
            if part_mime == "text/plain" {
                let text = extract_gmail_body(part);
                if !text.is_empty() {
                    return text;
                }
            }
        }
        for part in parts {
            let part_mime = part["mimeType"].as_str().unwrap_or("");
            if part_mime == "text/html" || part_mime.starts_with("multipart/") {
                let text = extract_gmail_body(part);
                if !text.is_empty() {
                    return text;
                }
            }
        }
    }

    String::new()
}

#[derive(Clone)]
pub struct GmailSearchEmails {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GmailSearchEmailsArgs {
    pub query: String,
    pub max_results: Option<u32>,
}

impl Tool for GmailSearchEmails {
    const NAME: &'static str = "gmail_search_emails";
    type Args = GmailSearchEmailsArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Search emails in Gmail using Gmail search syntax.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let lister = GmailListEmails {
            manager: self.manager.clone(),
            memory: self.memory.clone(),
        };
        let list_args = GmailListEmailsArgs {
            filter: Some(args.query),
            max_results: args.max_results,
        };
        lister.call(ctx, list_args).await
    }
}

