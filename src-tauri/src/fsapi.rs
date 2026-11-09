use std::path::Path;
use std::sync::Arc;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::cloud::{absolute_cloud_path, relative_cloud_path, CloudWorkspace};
use crate::config;
use crate::state::AppState;
use crate::tools::fs_util;

const MAX_PREVIEW_BYTES: usize = 512 * 1024;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    #[serde(skip)]
    depth: u16,
}

fn compare_ascii_case_insensitive(left: &str, right: &str) -> std::cmp::Ordering {
    left.bytes()
        .map(|byte| byte.to_ascii_lowercase())
        .cmp(right.bytes().map(|byte| byte.to_ascii_lowercase()))
}

#[derive(Serialize, Deserialize)]
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
        let rel = fs_util::display_relative(root, entry.path());
        let name = entry.file_name().to_string_lossy().to_string();
        let depth = rel.matches('/').count().min(u16::MAX as usize) as u16;
        entries.push(FileEntry { path: rel, name, depth });
    }

    entries.sort_by(|a, b| {
        a.depth
            .cmp(&b.depth)
            .then_with(|| compare_ascii_case_insensitive(&a.path, &b.path))
    });
    entries
}

pub fn build_file_index_from_paths(paths: Vec<String>) -> Vec<FileEntry> {
    let mut entries = Vec::with_capacity(paths.len().min(config::MAX_INDEXED_FILES));
    for rel in paths.into_iter().take(config::MAX_INDEXED_FILES) {
        let name = rel
            .rsplit('/')
            .next()
            .unwrap_or(&rel)
            .to_string();
        let depth = rel.matches('/').count().min(u16::MAX as usize) as u16;
        entries.push(FileEntry { path: rel, name, depth });
    }
    entries.sort_by(|a, b| {
        a.depth
            .cmp(&b.depth)
            .then_with(|| compare_ascii_case_insensitive(&a.path, &b.path))
    });
    entries
}

#[tauri::command]
pub async fn list_workspace_files(
    state: State<'_, AppState>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let query_str = query.unwrap_or_default().trim().to_string();
    let limit = limit.unwrap_or(100).clamp(1, 1000);
    let index: Arc<Vec<FileEntry>> = state.file_index().await?;

    tokio::task::spawn_blocking(move || {
        if query_str.is_empty() {
            return index.iter().take(limit).cloned().collect();
        }

        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let pattern = Pattern::parse(&query_str, CaseMatching::Ignore, Normalization::Smart);
        let mut buf = Vec::new();
        let mut scored: Vec<(u32, u16, &FileEntry)> = index
            .iter()
            .filter_map(|entry| {
                pattern
                    .score(Utf32Str::new(&entry.path, &mut buf), &mut matcher)
                    .map(|score| (score, entry.depth, entry))
            })
            .collect();

        let cmp = |a: &(u32, u16, &FileEntry), b: &(u32, u16, &FileEntry)| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.cmp(&b.1))
                .then_with(|| compare_ascii_case_insensitive(&a.2.path, &b.2.path))
        };

        if scored.len() > limit {
            scored.select_nth_unstable_by(limit, cmp);
            scored.truncate(limit);
        }
        scored.sort_by(cmp);
        scored.into_iter().map(|(_, _, e)| e.clone()).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

async fn cloud_context(
    state: &AppState,
) -> Result<Option<(String, Arc<CloudWorkspace>)>, String> {
    let Some(cloud) = state.active_cloud_workspace() else {
        return Ok(None);
    };
    let session_id = state.cloud_session().ok_or_else(|| {
        "The cloud workspace is created with your first message. Send a message to browse its files."
            .to_string()
    })?;
    state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
    Ok(Some((session_id, cloud)))
}

#[tauri::command]
pub async fn read_text_file(state: State<'_, AppState>, path: String) -> Result<FileContent, String> {
    if let Some((session_id, cloud)) = cloud_context(&state).await? {
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let mut content: FileContent = state
            .gateway
            .cloud_files_json("text", &session_id, &[("path", absolute)])
            .await
            .map_err(|e| format!("cannot read {path}: {e}"))?;
        if let Some(relative) = relative_cloud_path(&cloud.repo_dir, &content.path) {
            content.path = relative;
        }
        return Ok(content);
    }

    let workspace = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&workspace, &path).map_err(|e| e.to_string())?;

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
        path: display_path(Some(&workspace), &resolved),
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
    if let Some((session_id, cloud)) = cloud_context(&state).await? {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Resp {
            data_url: String,
        }
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let resp: Resp = state
            .gateway
            .cloud_files_json("image", &session_id, &[("path", absolute)])
            .await
            .map_err(|e| format!("cannot read {path}: {e}"))?;
        return Ok(resp.data_url);
    }

    let workspace = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&workspace, &path).map_err(|e| e.to_string())?;
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
    if let Some((session_id, cloud)) = cloud_context(&state).await? {
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let bytes = state
            .gateway
            .cloud_file_bytes(&session_id, &absolute)
            .await
            .map_err(|e| format!("cannot read {path}: {e}"))?;
        return Ok(tauri::ipc::Response::new(bytes));
    }

    let workspace = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&workspace, &path).map_err(|e| e.to_string())?;
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

#[derive(Serialize, Deserialize)]
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
    if let Some((session_id, cloud)) = cloud_context(&state).await? {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CloudMeta {
            name: String,
            size_bytes: u64,
            extension: String,
            mime: String,
        }
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let meta: CloudMeta = state
            .gateway
            .cloud_files_json("metadata", &session_id, &[("path", absolute)])
            .await
            .map_err(|e| format!("metadata error: {e}"))?;
        let (artifact_kind, type_label) = crate::document::document_type_info(&meta.extension);
        return Ok(DocumentFileMeta {
            name: meta.name,
            size_bytes: meta.size_bytes,
            extension: meta.extension,
            mime: meta.mime,
            artifact_kind,
            type_label,
            modified: None,
        });
    }

    let workspace = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&workspace, &path).map_err(|e| e.to_string())?;

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
    if let Some((session_id, cloud)) = cloud_context(&state).await? {
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let bytes = state
            .gateway
            .cloud_file_bytes(&session_id, &absolute)
            .await
            .map_err(|e| format!("cannot read spreadsheet {path}: {e}"))?;
        let ext = crate::util::lowercase_extension(Path::new(&path));
        let tmp_path = std::env::temp_dir().join(format!(
            "orch-cloud-sheet-{}.{}",
            uuid::Uuid::new_v4(),
            if ext.is_empty() { "xlsx" } else { &ext }
        ));
        tokio::fs::write(&tmp_path, &bytes)
            .await
            .map_err(|e| format!("failed to write temp spreadsheet: {e}"))?;
        let res = tokio::task::spawn_blocking({
            let tmp_path = tmp_path.clone();
            move || {
                crate::document::read_spreadsheet(
                    &tmp_path,
                    config::MAX_SPREADSHEET_ROWS,
                    config::MAX_SPREADSHEET_COLS,
                )
            }
        })
        .await
        .map_err(|e| format!("spreadsheet task failed: {e}"))?
        .map_err(|e| e.to_string());
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return res;
    }

    let workspace = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_existing_file(&workspace, &path).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        crate::document::read_spreadsheet(&resolved, config::MAX_SPREADSHEET_ROWS, config::MAX_SPREADSHEET_COLS)
    })
    .await
    .map_err(|e| format!("spreadsheet task failed: {e}"))?
    .map_err(|e| e.to_string())
}
