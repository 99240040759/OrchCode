use super::{request_json, request_text, truncate_text};

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
        "Read the content of a Google Drive file by its ID. Google Docs/Sheets/Slides are exported as plain text automatically. Binary files are described but not decoded.".to_string()
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

        let binary_mimes = [
            "image/", "video/", "audio/", "application/octet-stream",
            "application/zip", "application/x-zip", "application/pdf",
        ];
        let is_binary = binary_mimes.iter().any(|prefix| mime.starts_with(prefix))
            && !mime.starts_with("application/vnd.google-apps");

        if is_binary {
            return Ok(format!(
                "File: {name}\nType: {mime}\nSize: {size} bytes\nModified: {modified}\nLink: {link}\n\n[Binary file — cannot display content]"
            ));
        }

        let (url, _is_export) = if mime.starts_with("application/vnd.google-apps") {
            let export_mime = args
                .export_mime_type
                .as_deref()
                .unwrap_or("text/plain")
                .to_string();
            (
                format!(
                    "{GDRIVE_EXPORT_API}/{}/export?mimeType={}",
                    urlencoding::encode(&args.file_id),
                    urlencoding::encode(&export_mime)
                ),
                true,
            )
        } else {
            (
                format!("{GDRIVE_EXPORT_API}/{}?alt=media", urlencoding::encode(&args.file_id)),
                false,
            )
        };

        let content = request_text(
            self.manager.http().get(&url).bearer_auth(&token),
            "Google Drive",
        )
        .await?;

        let char_count = content.chars().count();
        let truncated = truncate_text(
            &content,
            50_000,
            &format!("\n\n[Truncated: showing first 50,000 of {char_count} chars — file has more content]"),
        );

        Ok(format!("File: {name}\nType: {mime}\nSize: {size} bytes\nModified: {modified}\nLink: {link}\n\n{truncated}"))
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
