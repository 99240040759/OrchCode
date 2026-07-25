use base64::Engine;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{fs_util, workspace_root, ToolError};
use crate::state::WorkspaceHandle;

#[derive(Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    pub path: String,
    #[serde(default)]
    pub start_line: Option<usize>,
    #[serde(default)]
    pub end_line: Option<usize>,
}

pub struct ReadFile {
    workspace: WorkspaceHandle,
}

impl ReadFile {
    pub fn new(workspace: WorkspaceHandle) -> Self {
        Self { workspace }
    }
}

fn mime_for_image(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

fn slice_lines(content: &str, start: Option<usize>, end: Option<usize>) -> String {
    if start.is_none() && end.is_none() {
        return content.to_string();
    }
    let from = start.unwrap_or(1).max(1);
    let to = end.unwrap_or(usize::MAX);
    content
        .lines()
        .enumerate()
        .filter(|(i, _)| {
            let n = i + 1;
            n >= from && n <= to
        })
        .map(|(_, l)| l)
        .collect::<Vec<_>>()
        .join("\n")
}

impl Tool for ReadFile {
    const NAME: &'static str = "read_file";
    type Error = ToolError;
    type Args = ReadFileArgs;
    type Output = String;

    fn description(&self) -> String {
        "Read the contents of any file in the workspace. \
Returns the raw text content. \
Supports text files, source code, config files, markdown, JSON, and binary formats like PDF and images. \
For large files, pass start_line and end_line (1-based, inclusive) to read only the relevant section — \
this is faster and avoids context bloat. \
ALWAYS call this before editing any file — you must see the exact current content, \
including whitespace and line endings, before attempting a replacement. \
Never assume you already know what a file contains."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ReadFileArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;
        let path = fs_util::resolve_in_workspace(&root, &args.path)?;
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        if ext == "pdf" {
            let glob_path = path.to_string_lossy().replace('\\', "/");
            let loader = rig::loaders::PdfFileLoader::with_glob(&glob_path)
                .map_err(|e| ToolError::msg(format!("cannot load PDF {}: {e}", args.path)))?;
            let mut text = String::new();
            for (_, content) in loader.read_with_path().ignore_errors() {
                text.push_str(&content);
                text.push_str("\n\n");
            }
            if text.trim().is_empty() {
                return Err(ToolError::msg(format!(
                    "PDF contains no extractable text: {}",
                    args.path
                )));
            }
            return Ok(slice_lines(&text, args.start_line, args.end_line));
        }

        if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg") {
            fs_util::check_file_size(&path)?;
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| ToolError::msg(format!("cannot read image {}: {e}", args.path)))?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            return Ok(serde_json::json!({
                "type": "image",
                "data": b64,
                "mimeType": mime_for_image(&ext),
            })
            .to_string());
        }

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot stat {}: {e}", args.path)))?;
        if meta.len() > fs_util::FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!(
                "file too large ({} bytes): {}",
                meta.len(),
                args.path
            )));
        }

        let file = tokio::fs::File::open(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot open {}: {e}", args.path)))?;
        let mut reader = tokio::io::BufReader::new(file);
        use tokio::io::AsyncBufReadExt;

        let from = args.start_line.unwrap_or(1).max(1);
        let to = args.end_line.unwrap_or(usize::MAX);

        let mut lines: Vec<String> = Vec::new();
        let mut line_no = 0usize;
        let mut line_buf = String::new();

        loop {
            line_buf.clear();
            let read = reader
                .read_line(&mut line_buf)
                .await
                .map_err(|e| ToolError::msg(format!("read error on {}: {e}", args.path)))?;
            if read == 0 {
                break;
            }
            line_no += 1;
            if line_no >= from && line_no <= to {
                lines.push(
                    line_buf
                        .trim_end_matches(|c| c == '\r' || c == '\n')
                        .to_string(),
                );
            }
            if line_no >= to {
                break;
            }
        }

        Ok(lines.join("\n"))
    }
}
