use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::{fs_util, ToolError};
use crate::state::WorkspaceHandle;

const TEXT_SIZE_LIMIT: u64 = 10 * 1024 * 1024;

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

impl Tool for ReadFile {
    const NAME: &'static str = "read_file";
    type Error = ToolError;
    type Args = ReadFileArgs;
    type Output = String;

    fn description(&self) -> String {
        "Read contents of a text file in the workspace. Pass start_line and end_line (1-based, inclusive) to read a slice. Read before editing so edits match exactly.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ReadFileArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = self.workspace.read()
            .ok()
            .and_then(|g| g.clone())
            .ok_or_else(|| ToolError::msg("no workspace is open"))?;

        let path = fs_util::resolve_in_workspace(&root, &args.path)?;
        let ext = path.extension().and_then(|s| s.to_str()).map(|s| s.to_lowercase()).unwrap_or_default();

        let glob_path = path.to_string_lossy().replace('\\', "/");

        let content = if ext == "pdf" {
            match rig::loaders::PdfFileLoader::with_glob(&glob_path) {
                Ok(loader) => {
                    let docs = loader.read_with_path().ignore_errors();
                    let mut text = String::new();
                    for (_p, c) in docs {
                        text.push_str(&c);
                        text.push_str("\n\n");
                    }
                    if text.trim().is_empty() {
                        "[PDF contains no extractable text]".to_string()
                    } else {
                        text
                    }
                }
                Err(e) => return Err(ToolError::msg(format!("cannot load PDF {}: {e}", args.path))),
            }
        } else if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg") {
            fs_util::check_file_size(&path)?;
            let bytes = tokio::fs::read(&path).await.map_err(|e| ToolError::msg(format!("cannot read image {}: {e}", args.path)))?;
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
            let mime = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                "svg" => "image/svg+xml",
                _ => "image/png",
            };
            return Ok(serde_json::json!({ "type": "image", "data": b64, "mimeType": mime }).to_string());
        } else {
            let meta = tokio::fs::metadata(&path).await.map_err(|e| ToolError::msg(format!("cannot stat {}: {e}", args.path)))?;
            if meta.len() > TEXT_SIZE_LIMIT {
                return Err(ToolError::msg(format!("file too large ({} bytes): {}", meta.len(), args.path)));
            }
            let file = tokio::fs::File::open(&path).await.map_err(|e| ToolError::msg(format!("cannot open {}: {e}", args.path)))?;
            let mut reader = tokio::io::BufReader::new(file);
            use tokio::io::AsyncBufReadExt;

            let start = args.start_line.unwrap_or(1).max(1);
            let end = args.end_line.unwrap_or(usize::MAX);

            let mut lines = Vec::new();
            let mut line_no = 0usize;
            let mut line_buf = String::new();

            while reader.read_line(&mut line_buf).await.map_err(|e| ToolError::msg(format!("read error: {e}")))? > 0 {
                line_no += 1;
                if line_no >= start && line_no <= end {
                    lines.push(line_buf.trim_end_matches(|c| c == '\r' || c == '\n').to_string());
                }
                line_buf.clear();
                if line_no >= end {
                    break;
                }
            }
            return Ok(lines.join("\n"));
        };

        let sliced = match (args.start_line, args.end_line) {
            (None, None) => content,
            (start, end) => {
                let start = start.unwrap_or(1).max(1);
                let end = end.unwrap_or(usize::MAX);
                content
                    .lines()
                    .enumerate()
                    .filter(|(i, _)| { let n = i + 1; n >= start && n <= end })
                    .map(|(_, l)| l)
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        };

        Ok(sliced)
    }
}
