use base64::Engine;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use tauri::State;

use crate::config;
use crate::state::AppState;
use crate::tools::fs_util;

const MAX_PREVIEW_BYTES: usize = 512 * 1024;
const MAX_BINARY_BYTES: u64 = 50 * 1024 * 1024;
const MAX_SCANNED_FILES: usize = 40_000;

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

fn resolve_path_flexible(
    root: &std::path::Path,
    data_dir: &std::path::Path,
    path: &str,
) -> Result<std::path::PathBuf, String> {
    let raw = std::path::Path::new(path);
    if raw.is_absolute() {
        let canonical =
            dunce::canonicalize(raw).map_err(|e| format!("cannot resolve {path}: {e}"))?;
        let permitted = [dunce::canonicalize(root).ok(), dunce::canonicalize(data_dir).ok()]
            .into_iter()
            .flatten()
            .any(|allowed| canonical.starts_with(&allowed));
        if permitted && canonical.is_file() {
            return Ok(canonical);
        }
        return Err(format!("path is outside the permitted directories: {path}"));
    }
    fs_util::resolve_existing_file(root, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_workspace_files(
    state: State<'_, AppState>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let query_str = query.unwrap_or_default().trim().to_string();
    let limit = limit.unwrap_or(100).clamp(1, 1000);

    tokio::task::spawn_blocking(move || {
        let mut scored: Vec<(u32, usize, FileEntry)> = Vec::new();
        let mut scanned = 0usize;
        let mut matcher = Matcher::new(Config::DEFAULT);
        let pattern = if query_str.is_empty() {
            None
        } else {
            Some(Pattern::parse(&query_str, CaseMatching::Ignore, Normalization::Smart))
        };

        for entry in fs_util::workspace_walker(&root).build().flatten() {
            if scanned >= MAX_SCANNED_FILES {
                break;
            }
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            scanned += 1;

            let rel = fs_util::display_relative(&root, entry.path());
            let name = entry.file_name().to_string_lossy().to_string();
            let score = match &pattern {
                Some(pattern) => {
                    let mut buf = Vec::new();
                    pattern.score(Utf32Str::new(&rel, &mut buf), &mut matcher)
                }
                None => Some(0),
            };

            if let Some(score) = score {
                scored.push((
                    score,
                    rel.matches('/').count(),
                    FileEntry { path: rel, name },
                ));
            }
        }

        scored.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.cmp(&b.1))
                .then_with(|| a.2.path.to_lowercase().cmp(&b.2.path.to_lowercase()))
        });

        Ok(scored
            .into_iter()
            .take(limit)
            .map(|(_, _, entry)| entry)
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_text_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<FileContent, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;

    let resolved = resolve_path_flexible(&root, &state.data_dir, &path)?;

    use tokio::io::AsyncReadExt;
    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    let truncated = meta.len() > MAX_PREVIEW_BYTES as u64;
    let file = tokio::fs::File::open(&resolved)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;
    let mut buf = Vec::new();
    file.take(MAX_PREVIEW_BYTES as u64)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    Ok(FileContent {
        path: fs_util::display_relative(&root, &resolved),
        content: String::from_utf8_lossy(&buf).into_owned(),
        truncated,
    })
}

fn file_mime(path: &std::path::Path) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

#[tauri::command]
pub async fn read_image_data_url(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&root, &path).map_err(|e| e.to_string())?;
    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if meta.len() > config::MAX_ATTACHMENT_BYTES as u64 {
        return Err(format!("image too large to preview: {path}"));
    }

    let mime = file_mime(&resolved);
    if !mime.starts_with("image/") {
        return Err(format!("not a supported image: {path}"));
    }

    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    if mime == "image/svg+xml" {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(format!("data:image/svg+xml;base64,{b64}"));
    }

    let image = image::load_from_memory(&bytes)
        .map_err(|e| format!("cannot decode image {path}: {e}"))?;
    let (output_mime, output_bytes) = if image.width() > 1200 || image.height() > 1200 {
        let resized = image.thumbnail(1200, 1200);
        let mut cursor = std::io::Cursor::new(Vec::new());
        resized
            .write_to(&mut cursor, image::ImageFormat::WebP)
            .map_err(|e| format!("cannot encode image {path}: {e}"))?;
        ("image/webp".to_string(), cursor.into_inner())
    } else {
        (mime, bytes)
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(output_bytes);
    Ok(format!("data:{output_mime};base64,{b64}"))
}

#[tauri::command]
pub async fn read_binary_file_as_data_url(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&root, &path).map_err(|e| e.to_string())?;
    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if meta.len() > MAX_BINARY_BYTES {
        return Err(format!("file too large to preview: {path}"));
    }

    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;
    let mime = file_mime(&resolved);
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFileMeta {
    pub name: String,
    pub size_bytes: u64,
    pub extension: String,
    pub mime: String,
    pub modified: Option<u64>,
}

#[tauri::command]
pub async fn read_document_metadata(
    state: State<'_, AppState>,
    path: String,
) -> Result<DocumentFileMeta, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;

    let resolved = resolve_path_flexible(&root, &state.data_dir, &path)?;

    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("metadata error: {e}"))?;
    let extension = resolved
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    let name = resolved
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&path)
        .to_string();
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());

    Ok(DocumentFileMeta {
        name,
        size_bytes: meta.len(),
        extension,
        mime: file_mime(&resolved),
        modified,
    })
}

#[tauri::command]
pub async fn read_parsed_document(
    state: State<'_, AppState>,
    path: String,
) -> Result<crate::document::ParsedDocumentDto, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&root, &path).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || crate::document::parse_document_file(&resolved))
        .await
        .map_err(|e| format!("document parse task failed: {e}"))?
        .map_err(|e| e.to_string())
}
