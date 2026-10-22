use super::{request_json, truncate_text};

use std::sync::Arc;

use futures::stream::{self, StreamExt};
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
    pub page_token: Option<String>,
}

impl Tool for GmailListEmails {
    const NAME: &'static str = "gmail_list_emails";
    type Args = GmailListEmailsArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List recent emails from Gmail with optional search filter. Supports pagination via page_token.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("gmail", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Gmail auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(50);
        let mut url = format!("{GMAIL_API}/messages?maxResults={limit}");
        if let Some(filter) = &args.filter {
            url.push_str(&format!("&q={}", urlencoding::encode(filter)));
        }
        if let Some(pt) = &args.page_token {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(pt)));
        }

        let list_json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Gmail",
        )
        .await?;

        let messages = list_json["messages"].as_array().cloned().unwrap_or_default();
        if messages.is_empty() {
            return Ok("No emails found.".to_string());
        }

        let next_page = list_json["nextPageToken"].as_str().map(|s| s.to_string());

        let http = self.manager.http();
        let fetch_futures: Vec<_> = messages
            .iter()
            .map(|msg| {
                let id = msg["id"].as_str().unwrap_or("").to_string();
                let meta_url = format!(
                    "{GMAIL_API}/messages/{}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=To",
                    urlencoding::encode(&id)
                );
                let req = http.get(&meta_url).bearer_auth(&token);
                async move { (id, request_json(req, "Gmail").await) }
            })
            .collect();

        let results = stream::iter(fetch_futures).buffer_unordered(10).collect::<Vec<_>>().await;

        let failed = results.iter().filter(|(_, r)| r.is_err()).count();
        let mut out = format!("Found {} email(s):\n\n", results.len() - failed);
        for (id, result) in results {
            if let Ok(meta) = result {
                let headers = meta["payload"]["headers"].as_array().cloned().unwrap_or_default();
                let subject = header_value(&headers, "Subject");
                let from = header_value(&headers, "From");
                let date = header_value(&headers, "Date");
                let snippet = truncate_text(
                    meta["snippet"].as_str().unwrap_or(""),
                    200,
                    "…",
                );
                out.push_str(&format!(
                    "• ID: {id}\n  Subject: {subject}\n  From: {from}\n  Date: {date}\n  Preview: {snippet}\n\n"
                ));
            }
        }

        if failed > 0 {
            out.push_str(&format!("[{failed} email(s) could not be loaded]\n"));
        }

        if let Some(pt) = next_page {
            out.push_str(&format!("\n[More results available — use page_token: \"{pt}\" to fetch the next page]"));
        }

        Ok(out)
    }
}

pub fn header_value(headers: &[Value], name: &str) -> String {
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

    fn description(&self) -> String {
        "Read the full content of an email by its Gmail message ID. Returns headers and decoded body (plain text preferred, HTML stripped as fallback).".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("gmail", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Gmail auth: {e}")))?;

        let url = format!("{GMAIL_API}/messages/{}?format=full", urlencoding::encode(args.message_id.trim()));
        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Gmail",
        )
        .await?;

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
        let cc = header_value(&headers, "Cc");

        let body = extract_best_body(&json["payload"]);

        let mut out = format!("Subject: {subject}\nFrom: {from}\nTo: {to}");
        if cc != "—" {
            out.push_str(&format!("\nCc: {cc}"));
        }
        out.push_str(&format!("\nDate: {date}\n\n---\n\n{body}"));

        Ok(truncate_text(&out, 20_000, "\n\n[Truncated — email is very large]"))
    }
}

fn decode_gmail_b64(data: &str) -> Option<Vec<u8>> {
    let cleaned: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    let unpadded = cleaned.trim_end_matches('=');
    base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, unpadded).ok()
}

fn extract_plain_text(payload: &Value) -> Option<String> {
    let mime = payload["mimeType"].as_str().unwrap_or("");

    if mime == "text/plain" {
        if let Some(data) = payload["body"]["data"].as_str() {
            if let Some(bytes) = decode_gmail_b64(data) {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
        }
    }

    if let Some(parts) = payload["parts"].as_array() {
        for part in parts {
            if let Some(text) = extract_plain_text(part) {
                return Some(text);
            }
        }
    }

    None
}

fn extract_html_as_text(payload: &Value) -> Option<String> {
    let mime = payload["mimeType"].as_str().unwrap_or("");

    if mime == "text/html" {
        if let Some(data) = payload["body"]["data"].as_str() {
            if let Some(bytes) = decode_gmail_b64(data) {
                let html = String::from_utf8_lossy(&bytes).into_owned();
                return Some(strip_html_tags(&html));
            }
        }
    }

    if let Some(parts) = payload["parts"].as_array() {
        for part in parts {
            if let Some(text) = extract_html_as_text(part) {
                return Some(text);
            }
        }
    }

    None
}

fn extract_best_body(payload: &Value) -> String {
    if let Some(text) = extract_plain_text(payload) {
        return text;
    }
    if let Some(text) = extract_html_as_text(payload) {
        return text;
    }
    String::from("(No readable body found)")
}

fn strip_html_tags(html: &str) -> String {
    nanohtml2text::html2text(html).trim().to_string()
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
    pub page_token: Option<String>,
}

impl Tool for GmailSearchEmails {
    const NAME: &'static str = "gmail_search_emails";
    type Args = GmailSearchEmailsArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search emails in Gmail using Gmail search syntax (e.g. 'from:alice subject:invoice has:attachment'). Supports pagination via page_token.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let lister = GmailListEmails {
            manager: self.manager.clone(),
            memory: self.memory.clone(),
        };
        lister.call(ctx, GmailListEmailsArgs {
            filter: Some(args.query),
            max_results: args.max_results,
            page_token: args.page_token,
        }).await
    }
}
