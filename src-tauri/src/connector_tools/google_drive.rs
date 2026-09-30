use super::{request_bytes, request_json, request_text, truncate_text};

use std::sync::Arc;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::tools::ToolError;
use crate::persistence::SqliteMemory;

const GDRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const GDRIVE_EXPORT_API: &str = "https://www.googleapis.com/drive/v3/files";

fn document_extension(mime: &str, name: &str) -> Option<&'static str> {
    let by_mime = match mime {
        "application/pdf" => Some("pdf"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.ms-excel" => Some("xls"),
        "application/vnd.oasis.opendocument.spreadsheet" => Some("ods"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => Some("pptx"),
        _ => None,
    };
    by_mime.or_else(|| {
        let lower = name.to_lowercase();
        ["pdf", "docx", "xlsx", "xls", "ods", "pptx"]
            .into_iter()
            .find(|ext| lower.ends_with(&format!(".{ext}")))
    })
}

fn is_textual_mime(mime: &str) -> bool {
    mime.starts_with("text/")
        || matches!(
            mime,
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/x-yaml"
                | "application/yaml"
                | "application/x-sh"
                | "application/sql"
                | "image/svg+xml"
        )
}

fn escape_gdrive_query(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

#[derive(Clone)]
pub struct GoogleDriveListFiles {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GoogleDriveListFilesArgs {
    pub folder_id: Option<String>,
    pub mime_type: Option<String>,
    pub max_results: Option<u32>,
    pub page_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GoogleDriveFileEntry {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: Option<String>,
    pub modified_time: Option<String>,
    pub web_view_link: Option<String>,
}

impl Tool for GoogleDriveListFiles {
    const NAME: &'static str = "google_drive_list_files";

    type Args = GoogleDriveListFilesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List files in Google Drive. Optionally filter by folder ID or MIME type. Supports pagination via page_token.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("google_drive", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Google Drive auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(100);
        let mut query_parts = vec!["trashed=false".to_string()];

        if let Some(folder) = &args.folder_id {
            query_parts.push(format!("'{}' in parents", escape_gdrive_query(folder)));
        }
        if let Some(mime) = &args.mime_type {
            query_parts.push(format!("mimeType='{}'", escape_gdrive_query(mime)));
        }

        let q = query_parts.join(" and ");
        let mut url = format!(
            "{GDRIVE_API}/files?q={}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)&pageSize={limit}&orderBy=modifiedTime desc",
            urlencoding::encode(&q)
        );
        if let Some(pt) = &args.page_token {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(pt)));
        }

        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Google Drive",
        )
        .await?;

        let files = json["files"].as_array().cloned().unwrap_or_default();
        let next_page = json["nextPageToken"].as_str().map(|s| s.to_string());

        if files.is_empty() {
            return Ok("No files found.".to_string());
        }

        let mut out = format!("Found {} file(s):\n\n", files.len());
        for f in &files {
            let name = f["name"].as_str().unwrap_or("(unnamed)");
            let id = f["id"].as_str().unwrap_or("");
            let mime = f["mimeType"].as_str().unwrap_or("");
            let size = f["size"].as_str().unwrap_or("—");
            let modified = f["modifiedTime"].as_str().unwrap_or("—");
            let link = f["webViewLink"].as_str().unwrap_or("");
            out.push_str(&format!(
                "• {name}\n  ID: {id}\n  Type: {mime}\n  Size: {size} bytes\n  Modified: {modified}\n  Link: {link}\n\n"
            ));
        }

        if let Some(pt) = next_page {
            out.push_str(&format!("\n[More results — use page_token: \"{pt}\" to fetch next page]"));
        }

        Ok(out)
    }
}

#[derive(Clone)]
pub struct GoogleDriveReadFile {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GoogleDriveReadFileArgs {
    pub file_id: String,
    pub export_mime_type: Option<String>,
}

impl Tool for GoogleDriveReadFile {
    const NAME: &'static str = "google_drive_read_file";

    type Args = GoogleDriveReadFileArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Read the content of a Google Drive file by its ID. Google Docs and Slides are exported as text and Sheets as CSV; PDF, Word, Excel and PowerPoint files are parsed to text. Other binary files are described but not decoded.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("google_drive", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Google Drive auth: {e}")))?;

        let meta_url = format!(
            "{GDRIVE_API}/files/{}?fields=name,mimeType,size,modifiedTime,webViewLink",
            urlencoding::encode(&args.file_id)
        );
        let meta: Value = request_json(
            self.manager.http().get(&meta_url).bearer_auth(&token),
            "Google Drive",
        )
        .await?;

        let mime = meta["mimeType"].as_str().unwrap_or("").to_string();
        let name = meta["name"].as_str().unwrap_or("file").to_string();
        let size = meta["size"].as_str().unwrap_or("unknown");
        let modified = meta["modifiedTime"].as_str().unwrap_or("—");
        let link = meta["webViewLink"].as_str().unwrap_or("");

        let header = format!("File: {name}\nType: {mime}\nSize: {size} bytes\nModified: {modified}\nLink: {link}\n\n");
        let file_url = format!("{GDRIVE_EXPORT_API}/{}", urlencoding::encode(&args.file_id));

        let content = if mime.starts_with("application/vnd.google-apps") {
            let default_export = match mime.as_str() {
                "application/vnd.google-apps.spreadsheet" => "text/csv",
                "application/vnd.google-apps.drawing" => "image/svg+xml",
                "application/vnd.google-apps.script" => "application/vnd.google-apps.script+json",
                _ => "text/plain",
            };
            let export_mime = args
                .export_mime_type
                .as_deref()
                .filter(|m| !m.trim().is_empty())
                .unwrap_or(default_export)
                .to_string();
            if matches!(
                mime.as_str(),
                "application/vnd.google-apps.folder"
                    | "application/vnd.google-apps.form"
                    | "application/vnd.google-apps.map"
                    | "application/vnd.google-apps.site"
                    | "application/vnd.google-apps.shortcut"
            ) {
                return Ok(format!("{header}[This Google item type has no readable content]"));
            }
            request_text(
                self.manager
                    .http()
                    .get(format!("{file_url}/export?mimeType={}", urlencoding::encode(&export_mime)))
                    .bearer_auth(&token),
                "Google Drive",
            )
            .await?
        } else if let Some(extension) = document_extension(&mime, &name) {
            let bytes = request_bytes(
                self.manager
                    .http()
                    .get(format!("{file_url}?alt=media"))
                    .bearer_auth(&token),
                "Google Drive",
            )
            .await?;
            let extension = extension.to_string();
            let parsed = tokio::task::spawn_blocking(move || {
                crate::document::parse_document_bytes(&bytes, &extension)
            })
            .await
            .map_err(|e| ToolError::msg(format!("document parse task failed: {e}")))??;
            parsed.full_text
        } else if is_textual_mime(&mime) {
            let bytes = request_bytes(
                self.manager
                    .http()
                    .get(format!("{file_url}?alt=media"))
                    .bearer_auth(&token),
                "Google Drive",
            )
            .await?;
            if crate::util::looks_binary(&bytes) {
                return Ok(format!("{header}[Binary file — cannot display content]"));
            }
            String::from_utf8_lossy(&bytes).into_owned()
        } else {
            return Ok(format!("{header}[Binary file — cannot display content]"));
        };

        let char_count = content.chars().count();
        let truncated = truncate_text(
            &content,
            50_000,
            &format!("\n\n[Truncated: showing first 50,000 of {char_count} chars — file has more content]"),
        );

        Ok(format!("{header}{truncated}"))

    }
}

#[derive(Clone)]
pub struct GoogleDriveSearchFiles {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GoogleDriveSearchFilesArgs {
    pub query: String,
    pub max_results: Option<u32>,
    pub page_token: Option<String>,
}

impl Tool for GoogleDriveSearchFiles {
    const NAME: &'static str = "google_drive_search_files";

    type Args = GoogleDriveSearchFilesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search for files in Google Drive by name or full-text content. Supports pagination via page_token.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("google_drive", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Google Drive auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(100);
        let escaped = escape_gdrive_query(&args.query);
        let q = format!("fullText contains '{escaped}' and trashed=false");

        let mut url = format!(
            "{GDRIVE_API}/files?q={}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)&pageSize={limit}&orderBy=modifiedTime desc",
            urlencoding::encode(&q)
        );
        if let Some(pt) = &args.page_token {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(pt)));
        }

        let json: Value = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Google Drive",
        )
        .await?;

        let files = json["files"].as_array().cloned().unwrap_or_default();
        let next_page = json["nextPageToken"].as_str().map(|s| s.to_string());

        if files.is_empty() {
            return Ok(format!("No files found matching '{}'.", args.query));
        }

        let mut out = format!(
            "Found {} file(s) matching '{}':\n\n",
            files.len(),
            args.query
        );
        for f in &files {
            let name = f["name"].as_str().unwrap_or("(unnamed)");
            let id = f["id"].as_str().unwrap_or("");
            let mime = f["mimeType"].as_str().unwrap_or("");
            let size = f["size"].as_str().unwrap_or("—");
            let link = f["webViewLink"].as_str().unwrap_or("");
            let modified = f["modifiedTime"].as_str().unwrap_or("—");
            out.push_str(&format!(
                "• {name}\n  ID: {id}\n  Type: {mime}\n  Size: {size} bytes\n  Modified: {modified}\n  Link: {link}\n\n"
            ));
        }

        if let Some(pt) = next_page {
            out.push_str(&format!("\n[More results — use page_token: \"{pt}\" to fetch next page]"));
        }

        Ok(out)
    }
}
