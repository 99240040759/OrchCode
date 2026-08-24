use std::sync::Arc;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

const NOTION_API: &str = "https://api.notion.com/v1";
const NOTION_VERSION: &str = "2022-06-28";

#[derive(Clone)]
pub struct NotionListPages {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct NotionListPagesArgs {
    pub database_id: Option<String>,
    pub max_results: Option<u32>,
}

impl Tool for NotionListPages {
    const NAME: &'static str = "notion_list_pages";
    type Args = NotionListPagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "List recently edited pages or pages in a Notion database.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("notion", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Notion auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(50);

        let json: Value = if let Some(db_id) = args.database_id {
            let url = format!("{NOTION_API}/databases/{db_id}/query");
            let body = serde_json::json!({ "page_size": limit });
            self.manager
                .http()
                .post(&url)
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION)
                .json(&body)
                .send()
                .await
                .map_err(|e| ToolError::msg(e.to_string()))?
                .json()
                .await
                .map_err(|e| ToolError::msg(e.to_string()))?
        } else {
            let url = format!("{NOTION_API}/search");
            let body = serde_json::json!({
                "filter": { "value": "page", "property": "object" },
                "sort": { "direction": "descending", "timestamp": "last_edited_time" },
                "page_size": limit
            });
            self.manager
                .http()
                .post(&url)
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION)
                .json(&body)
                .send()
                .await
                .map_err(|e| ToolError::msg(e.to_string()))?
                .json()
                .await
                .map_err(|e| ToolError::msg(e.to_string()))?
        };

        let results = json["results"].as_array().cloned().unwrap_or_default();
        if results.is_empty() {
            return Ok("No pages found.".to_string());
        }

        let mut out = format!("Found {} page(s):\n\n", results.len());
        for page in &results {
            let id = page["id"].as_str().unwrap_or("");
            let last_edited = page["last_edited_time"].as_str().unwrap_or("—");
            let title = extract_notion_title(page);
            let url = page["url"].as_str().unwrap_or("");
            out.push_str(&format!(
                "• {title}\n  ID: {id}\n  Last edited: {last_edited}\n  URL: {url}\n\n"
            ));
        }

        Ok(out)
    }
}

fn extract_notion_title(page: &Value) -> String {
    if let Some(props) = page["properties"].as_object() {
        for (_, prop) in props {
            if let Some(title_arr) = prop["title"].as_array() {
                let text: String = title_arr
                    .iter()
                    .filter_map(|t| t["plain_text"].as_str())
                    .collect::<Vec<_>>()
                    .join("");
                if !text.is_empty() {
                    return text;
                }
            }
        }
    }
    "(Untitled)".to_string()
}

#[derive(Clone)]
pub struct NotionReadPage {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct NotionReadPageArgs {
    pub page_id: String,
}

impl Tool for NotionReadPage {
    const NAME: &'static str = "notion_read_page";
    type Args = NotionReadPageArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Read the full text content of a Notion page by its ID.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("notion", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Notion auth: {e}")))?;

        let meta: Value = self
            .manager
            .http()
            .get(format!("{NOTION_API}/pages/{}", args.page_id))
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        let title = extract_notion_title(&meta);

        let blocks_url = format!("{NOTION_API}/blocks/{}/children?page_size=100", args.page_id);
        let blocks_json: Value = self
            .manager
            .http()
            .get(&blocks_url)
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        let blocks = blocks_json["results"].as_array().cloned().unwrap_or_default();
        let mut content = format!("# {title}\n\n");

        for block in &blocks {
            if let Some(text) = extract_block_text(block) {
                content.push_str(&text);
                content.push('\n');
            }
        }

        const MAX_CHARS: usize = 40_000;
        if content.len() > MAX_CHARS {
            content.truncate(MAX_CHARS);
            content.push_str("\n\n[Content truncated]");
        }

        Ok(content)
    }
}

fn extract_block_text(block: &Value) -> Option<String> {
    let block_type = block["type"].as_str()?;
    let content = &block[block_type];
    let rich_text = content["rich_text"].as_array()?;

    let text: String = rich_text
        .iter()
        .filter_map(|rt| rt["plain_text"].as_str())
        .collect::<Vec<_>>()
        .join("");

    if text.is_empty() {
        return None;
    }

    let formatted = match block_type {
        "heading_1" => format!("# {text}"),
        "heading_2" => format!("## {text}"),
        "heading_3" => format!("### {text}"),
        "bulleted_list_item" => format!("• {text}"),
        "numbered_list_item" => format!("1. {text}"),
        "quote" => format!("> {text}"),
        "code" => format!("```\n{text}\n```"),
        "divider" => "---".to_string(),
        _ => text,
    };

    Some(formatted)
}

#[derive(Clone)]
pub struct NotionSearchPages {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct NotionSearchPagesArgs {
    pub query: String,
    pub max_results: Option<u32>,
}

impl Tool for NotionSearchPages {
    const NAME: &'static str = "notion_search_pages";
    type Args = NotionSearchPagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Search for pages in Notion by title or content.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("notion", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Notion auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(50);
        let body = serde_json::json!({
            "query": args.query,
            "filter": { "value": "page", "property": "object" },
            "page_size": limit
        });

        let json: Value = self
            .manager
            .http()
            .post(format!("{NOTION_API}/search"))
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .json(&body)
            .send()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?
            .json()
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        let results = json["results"].as_array().cloned().unwrap_or_default();
        if results.is_empty() {
            return Ok(format!("No pages found for '{}'.", args.query));
        }

        let mut out = format!("Found {} page(s):\n\n", results.len());
        for page in &results {
            let id = page["id"].as_str().unwrap_or("");
            let title = extract_notion_title(page);
            let url = page["url"].as_str().unwrap_or("");
            out.push_str(&format!("• {title}\n  ID: {id}\n  URL: {url}\n\n"));
        }

        Ok(out)
    }
}

