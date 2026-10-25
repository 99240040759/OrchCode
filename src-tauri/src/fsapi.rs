use std::path::{Path, PathBuf};
use std::sync::Arc;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use tauri::State;

use crate::config;
use crate::state::AppState;
use crate::tools::fs_util;

const MAX_PREVIEW_BYTES: usize = 512 * 1024;

#[derive(Serialize, Clone)]
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

use crate::util::display_path;

pub fn build_file_index(root: &Path) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    for entry in fs_util::workspace_walker(root).build().flatten() {
        if entries.len() >= config::MAX_INDEXED_FILES {
            break;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        entries.push(FileEntry {
            path: fs_util::display_relative(root, entry.path()),
            name: entry.file_name().to_string_lossy().to_string(),
        });
    }
    entries
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
    let index: Arc<Vec<FileEntry>> = state.file_index(&root).await?;

    tokio::task::spawn_blocking(move || {
        if query_str.is_empty() {
            let mut sorted: Vec<&FileEntry> = index.iter().collect();
            sorted.sort_by(|a, b| {
                a.path
                    .matches('/')
                    .count()
                    .cmp(&b.path.matches('/').count())
                    .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
            });
            return sorted.into_iter().take(limit).cloned().collect();
        }

        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let pattern = Pattern::parse(&query_str, CaseMatching::Ignore, Normalization::Smart);
        let mut buf = Vec::new();
        let mut scored: Vec<(u32, usize, &FileEntry)> = index
            .iter()
            .filter_map(|entry| {
                pattern
                    .score(Utf32Str::new(&entry.path, &mut buf), &mut matcher)
                    .map(|score| (score, entry.path.matches('/').count(), entry))
            })
            .collect();
        scored.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.cmp(&b.1))
                .then_with(|| a.2.path.to_lowercase().cmp(&b.2.path.to_lowercase()))
        });
        scored.into_iter().take(limit).map(|(_, _, e)| e.clone()).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_text_file(state: State<'_, AppState>, path: String) -> Result<FileContent, String> {
    let workspace = state.workspace();
    let resolved = fs_util::resolve_readable_file(workspace.as_deref(), &path).map_err(|e| e.to_string())?;

    use tokio::io::AsyncReadExt;
    let file = tokio::fs::File::open(&resolved)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;
    let mut buf = Vec::new();
    file.take((MAX_PREVIEW_BYTES + 1) as u64)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;
    let truncated = buf.len() > MAX_PREVIEW_BYTES;
    if truncated {
        buf.truncate(MAX_PREVIEW_BYTES);
        let cut = match std::str::from_utf8(&buf) {
            Ok(s) => s.len(),
            Err(e) => e.valid_up_to(),
        };
        buf.truncate(cut);
    }
    if crate::util::looks_binary(&buf) {
        return Err(format!("cannot read binary file as text: {path}"));
    }

    Ok(FileContent {
        path: display_path(workspace.as_deref(), &resolved),
        content: String::from_utf8_lossy(&buf).into_owned(),
        truncated,
    })
}

fn file_mime(path: &Path) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

#[tauri::command]
pub async fn read_image_data_url(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let workspace = state.workspace();
    let resolved = fs_util::resolve_readable_file(workspace.as_deref(), &path).map_err(|e| e.to_string())?;
    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if meta.len() > config::MAX_PREVIEW_IMAGE_BYTES {
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
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(format!("data:image/svg+xml;base64,{b64}"));
    }

    tokio::task::spawn_blocking(move || {
        crate::media::preview_data_url(&bytes, &mime, config::MAX_PREVIEW_IMAGE_DIMENSION)
            .map_err(|e| format!("cannot decode image {path}: {e}"))
    })
    .await
    .map_err(|e| format!("image preview task failed: {e}"))?
}

#[tauri::command]
pub async fn read_binary_file(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    let workspace = state.workspace();
    let resolved = fs_util::resolve_readable_file(workspace.as_deref(), &path).map_err(|e| e.to_string())?;
    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if meta.len() > config::MAX_BINARY_PREVIEW_BYTES {
        return Err(format!("file too large to preview: {path}"));
    }
    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFileMeta {
    pub name: String,
    pub size_bytes: u64,
    pub extension: String,
    pub mime: String,
    pub artifact_kind: Option<String>,
    pub type_label: String,
    pub modified: Option<u64>,
}

#[tauri::command]
pub async fn read_document_metadata(
    state: State<'_, AppState>,
    path: String,
) -> Result<DocumentFileMeta, String> {
    let workspace = state.workspace();
    let resolved = fs_util::resolve_readable_file(workspace.as_deref(), &path).map_err(|e| e.to_string())?;

    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("metadata error: {e}"))?;
    let extension = crate::util::lowercase_extension(&resolved);
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

    let (artifact_kind, type_label) = crate::document::document_type_info(&extension);
    Ok(DocumentFileMeta {
        name,
        size_bytes: meta.len(),
        extension,
        mime: file_mime(&resolved),
        artifact_kind,
        type_label,
        modified,
    })
}

#[tauri::command]
pub async fn read_spreadsheet(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<crate::document::SpreadsheetSheet>, String> {
    let workspace = state.workspace();
    let resolved = fs_util::resolve_readable_file(workspace.as_deref(), &path).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        crate::document::read_spreadsheet(&resolved, config::MAX_SPREADSHEET_ROWS, config::MAX_SPREADSHEET_COLS)
    })
    .await
    .map_err(|e| format!("spreadsheet task failed: {e}"))?
    .map_err(|e| e.to_string())
}
