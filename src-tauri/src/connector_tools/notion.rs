use super::{request_json, truncate_text};

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
    pub cursor: Option<String>,
}

impl Tool for NotionListPages {
    const NAME: &'static str = "notion_list_pages";
    type Args = NotionListPagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List recently edited Notion pages, or query pages in a specific database. Supports pagination via cursor.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("notion", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Notion auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(100);

        let request = if let Some(db_id) = args.database_id {
            let url = format!("{NOTION_API}/databases/{db_id}/query");
            let mut body = serde_json::json!({ "page_size": limit });
            if let Some(cursor) = &args.cursor {
                body["start_cursor"] = Value::String(cursor.clone());
            }
            self.manager
                .http()
                .post(&url)
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION)
                .json(&body)
        } else {
            let url = format!("{NOTION_API}/search");
            let mut body = serde_json::json!({
                "filter": { "value": "page", "property": "object" },
                "sort": { "direction": "descending", "timestamp": "last_edited_time" },
                "page_size": limit
            });
            if let Some(cursor) = &args.cursor {
                body["start_cursor"] = Value::String(cursor.clone());
            }
            self.manager
                .http()
                .post(&url)
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION)
                .json(&body)
        };

        let json = request_json(request, "Notion").await?;
        let results = json["results"].as_array().cloned().unwrap_or_default();
        let next_cursor = json["next_cursor"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
        let has_more = json["has_more"].as_bool().unwrap_or(false);

        if results.is_empty() {
            return Ok("No pages found.".to_string());
        }

        let mut out = format!("Found {} page(s):\n\n", results.len());
        for page in &results {
            let id = page["id"].as_str().unwrap_or("").replace('-', "");
            let last_edited = page["last_edited_time"].as_str().unwrap_or("—");
            let created = page["created_time"].as_str().unwrap_or("—");
            let title = extract_notion_title(page);
            let url = page["url"].as_str().unwrap_or("");
            out.push_str(&format!(
                "• {title}\n  ID: {id}\n  Created: {created}\n  Last edited: {last_edited}\n  URL: {url}\n\n"
            ));
        }

        if has_more {
            if let Some(cursor) = next_cursor {
                out.push_str(&format!("\n[More results — use cursor: \"{cursor}\" to fetch next page]"));
            }
        }

        Ok(out)
    }
}

pub fn extract_notion_title(page: &Value) -> String {
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
    if let Some(title_arr) = page["title"].as_array() {
        let text: String = title_arr
            .iter()
            .filter_map(|t| t["plain_text"].as_str())
            .collect::<Vec<_>>()
            .join("");
        if !text.is_empty() {
            return text;
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

    fn description(&self) -> String {
        "Read the full text content of a Notion page by its ID. Renders all block types including headings, lists, callouts, tables, toggles, and code.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("notion", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Notion auth: {e}")))?;

        let clean_id = args.page_id.replace('-', "");

        let meta: Value = request_json(
            self.manager
                .http()
                .get(format!("{NOTION_API}/pages/{clean_id}"))
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION),
            "Notion",
        )
        .await?;

        let title = extract_notion_title(&meta);
        let mut content = format!("# {title}\n\n");

        fetch_blocks_recursive(
            &self.manager,
            &token,
            &clean_id,
            0,
            &mut content,
        )
        .await?;

        let content = truncate_text(&content, 60_000, "\n\n[Content truncated — page is very large]");
        Ok(content)
    }
}

async fn fetch_blocks_recursive(
    manager: &ConnectorManager,
    token: &str,
    block_id: &str,
    depth: usize,
    out: &mut String,
) -> Result<(), ToolError> {
    let mut cursor: Option<String> = None;
    let indent = "  ".repeat(depth);

    loop {
        let mut url = format!("{NOTION_API}/blocks/{block_id}/children?page_size=100");
        if let Some(c) = &cursor {
            url.push_str(&format!("&start_cursor={}", urlencoding::encode(c)));
        }

        let blocks_json: Value = request_json(
            manager
                .http()
                .get(&url)
                .bearer_auth(token)
                .header("Notion-Version", NOTION_VERSION),
            "Notion",
        )
        .await?;

        let blocks = blocks_json["results"].as_array().cloned().unwrap_or_default();
        let has_more = blocks_json["has_more"].as_bool().unwrap_or(false);
        let next_cursor = blocks_json["next_cursor"].as_str().map(|s| s.to_string());

        for block in &blocks {
            render_block(block, &indent, out);

            let has_children = block["has_children"].as_bool().unwrap_or(false);
            if has_children && depth < 5 {
                if let Some(id) = block["id"].as_str() {
                    let child_id = id.replace('-', "");
                    Box::pin(fetch_blocks_recursive(manager, token, &child_id, depth + 1, out)).await?;
                }
            }
        }

        if has_more {
            cursor = next_cursor;
        } else {
            break;
        }
    }

    Ok(())
}

fn extract_rich_text(rich_text: &Value) -> String {
    rich_text
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t["plain_text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn render_block(block: &Value, indent: &str, out: &mut String) {
    let block_type = match block["type"].as_str() {
        Some(t) => t,
        None => return,
    };
    let content = &block[block_type];

    match block_type {
        "paragraph" => {
            let text = extract_rich_text(&content["rich_text"]);
            if !text.is_empty() {
                out.push_str(&format!("{indent}{text}\n\n"));
            } else {
                out.push('\n');
            }
        }
        "heading_1" => {
            let text = extract_rich_text(&content["rich_text"]);
            out.push_str(&format!("{indent}# {text}\n\n"));
        }
        "heading_2" => {
            let text = extract_rich_text(&content["rich_text"]);
            out.push_str(&format!("{indent}## {text}\n\n"));
        }
        "heading_3" => {
            let text = extract_rich_text(&content["rich_text"]);
            out.push_str(&format!("{indent}### {text}\n\n"));
        }
        "bulleted_list_item" => {
            let text = extract_rich_text(&content["rich_text"]);
            out.push_str(&format!("{indent}• {text}\n"));
        }
        "numbered_list_item" => {
            let text = extract_rich_text(&content["rich_text"]);
            out.push_str(&format!("{indent}1. {text}\n"));
        }
        "to_do" => {
            let text = extract_rich_text(&content["rich_text"]);
            let checked = content["checked"].as_bool().unwrap_or(false);
            let mark = if checked { "[x]" } else { "[ ]" };
            out.push_str(&format!("{indent}{mark} {text}\n"));
        }
        "toggle" => {
            let text = extract_rich_text(&content["rich_text"]);
            out.push_str(&format!("{indent}▶ {text}\n"));
        }
        "quote" => {
            let text = extract_rich_text(&content["rich_text"]);
            for line in text.lines() {
                out.push_str(&format!("{indent}> {line}\n"));
            }
            out.push('\n');
        }
        "callout" => {
            let text = extract_rich_text(&content["rich_text"]);
            let emoji = content["icon"]["emoji"].as_str().unwrap_or("💡");
            out.push_str(&format!("{indent}{emoji} {text}\n\n"));
        }
        "code" => {
            let text = extract_rich_text(&content["rich_text"]);
            let lang = content["language"].as_str().unwrap_or("");
            let caption = extract_rich_text(&content["caption"]);
            out.push_str(&format!("{indent}```{lang}\n{text}\n{indent}```\n"));
            if !caption.is_empty() {
                out.push_str(&format!("{indent}_{caption}_\n"));
            }
            out.push('\n');
        }
        "divider" => {
            out.push_str(&format!("{indent}---\n\n"));
        }
        "table_of_contents" => {
            out.push_str(&format!("{indent}[Table of Contents]\n\n"));
        }
        "breadcrumb" => {}
        "column_list" | "column" => {}
        "table" => {
            out.push_str(&format!("{indent}[Table — see rows below]\n"));
        }
        "table_row" => {
            let cells = content["cells"].as_array().cloned().unwrap_or_default();
            let row: Vec<String> = cells
                .iter()
                .map(|cell| extract_rich_text(cell))
                .collect();
            out.push_str(&format!("{indent}| {} |\n", row.join(" | ")));
        }
        "image" => {
            let caption = extract_rich_text(&content["caption"]);
            let url = content["external"]["url"]
                .as_str()
                .or_else(|| content["file"]["url"].as_str())
                .unwrap_or("");
            if caption.is_empty() {
                out.push_str(&format!("{indent}[Image: {url}]\n\n"));
            } else {
                out.push_str(&format!("{indent}[Image: {caption}]\n\n"));
            }
        }
        "video" | "audio" | "file" | "pdf" => {
            let url = content["external"]["url"]
                .as_str()
                .or_else(|| content["file"]["url"].as_str())
                .unwrap_or("");
            let caption = extract_rich_text(&content["caption"]);
            out.push_str(&format!("{indent}[{block_type}: {caption} {url}]\n\n"));
        }
        "bookmark" | "link_preview" => {
            let url = content["url"].as_str().unwrap_or("");
            let caption = extract_rich_text(&content["caption"]);
            if caption.is_empty() {
                out.push_str(&format!("{indent}[Link: {url}]\n\n"));
            } else {
                out.push_str(&format!("{indent}[{caption}]({url})\n\n"));
            }
        }
        "embed" => {
            let url = content["url"].as_str().unwrap_or("");
            out.push_str(&format!("{indent}[Embed: {url}]\n\n"));
        }
        "equation" => {
            let expr = content["expression"].as_str().unwrap_or("");
            out.push_str(&format!("{indent}$${expr}$$\n\n"));
        }
        "synced_block" => {}
        "template" => {
            let text = extract_rich_text(&content["rich_text"]);
            if !text.is_empty() {
                out.push_str(&format!("{indent}{text}\n\n"));
            }
        }
        "link_to_page" => {
            let page_id = content["page_id"].as_str().unwrap_or("");
            let db_id = content["database_id"].as_str().unwrap_or("");
            let target = if !page_id.is_empty() { page_id } else { db_id };
            out.push_str(&format!("{indent}[→ Notion page: {target}]\n\n"));
        }
        "child_page" => {
            let title = content["title"].as_str().unwrap_or("(Untitled)");
            out.push_str(&format!("{indent}[📄 Sub-page: {title}]\n\n"));
        }
        "child_database" => {
            let title = content["title"].as_str().unwrap_or("(Untitled)");
            out.push_str(&format!("{indent}[🗃 Database: {title}]\n\n"));
        }
        _ => {
            if let Some(rt) = content["rich_text"].as_array() {
                let text: String = rt.iter().filter_map(|t| t["plain_text"].as_str()).collect::<Vec<_>>().join("");
                if !text.is_empty() {
                    out.push_str(&format!("{indent}{text}\n\n"));
                }
            }
        }
    }
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
    pub cursor: Option<String>,
}

impl Tool for NotionSearchPages {
    const NAME: &'static str = "notion_search_pages";
    type Args = NotionSearchPagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search for pages in Notion by title. Supports pagination via cursor.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("notion", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Notion auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(100);
        let mut body = serde_json::json!({
            "query": args.query,
            "filter": { "value": "page", "property": "object" },
            "page_size": limit
        });
        if let Some(cursor) = &args.cursor {
            body["start_cursor"] = Value::String(cursor.clone());
        }

        let json: Value = request_json(
            self.manager
                .http()
                .post(format!("{NOTION_API}/search"))
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION)
                .json(&body),
            "Notion",
        )
        .await?;

        let results = json["results"].as_array().cloned().unwrap_or_default();
        let has_more = json["has_more"].as_bool().unwrap_or(false);
        let next_cursor = json["next_cursor"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());

        if results.is_empty() {
            return Ok(format!("No pages found for '{}'.", args.query));
        }

        let mut out = format!("Found {} page(s):\n\n", results.len());
        for page in &results {
            let id = page["id"].as_str().unwrap_or("").replace('-', "");
            let title = extract_notion_title(page);
            let url = page["url"].as_str().unwrap_or("");
            let last_edited = page["last_edited_time"].as_str().unwrap_or("—");
            out.push_str(&format!("• {title}\n  ID: {id}\n  Last edited: {last_edited}\n  URL: {url}\n\n"));
        }

        if has_more {
            if let Some(cursor) = next_cursor {
                out.push_str(&format!("\n[More results — use cursor: \"{cursor}\" to fetch next page]"));
            }
        }

        Ok(out)
    }
}
