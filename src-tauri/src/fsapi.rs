use std::path::Path;
use std::sync::Arc;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use orchharness::backend::local_fs::fs_util;
use orchharness::util::{display_path, looks_binary, lowercase_extension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::cloud::{absolute_cloud_path, relative_cloud_path, CloudWorkspace};
use crate::config;
use crate::state::AppState;

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
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<TreeEntry>,
    pub truncated: bool,
}

#[derive(Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

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

    if !query_str.is_empty() {
        if let Some(cloud) = state.active_cloud_workspace() {
            state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
            let entries: Vec<FileEntry> = state
                .gateway
                .cloud_files_json(
                    "list",
                    &cloud.workspace_uri,
                    &[
                        ("query", query_str.clone()),
                        ("limit", limit.to_string()),
                    ],
                )
                .await
                .map_err(|e| e.to_string())?;
            let paths = entries
                .into_iter()
                .filter_map(|entry| relative_cloud_path(&cloud.repo_dir, &entry.path))
                .collect();
            return Ok(build_file_index_from_paths(paths));
        }
    }

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

#[tauri::command]
pub async fn list_workspace_dir(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<DirListing, String> {
    let requested = path.unwrap_or_default();
    if let Some(cloud) = state.active_cloud_workspace() {
        state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
        return state
            .gateway
            .cloud_files_json("tree", &cloud.workspace_uri, &[("path", requested)])
            .await
            .map_err(|e| e.to_string());
    }
    let workspace = state.require_workspace().map_err(|e| e.to_string())?;

    tokio::task::spawn_blocking(move || {
        let root = dunce::canonicalize(&workspace).map_err(|e| e.to_string())?;
        let target = fs_util::resolve_in_workspace(&root, if requested.is_empty() { "." } else { &requested })
            .map_err(|e| e.to_string())?;
        if !target.is_dir() {
            return Err(format!("not a folder: {requested}"));
        }

        let mut builder = fs_util::workspace_walker(&target);
        builder.max_depth(Some(1));

        let mut entries: Vec<TreeEntry> = Vec::new();
        let mut truncated = false;
        for entry in builder.build().flatten() {
            if entry.depth() == 0 {
                continue;
            }
            if entries.len() >= config::MAX_DIR_ENTRIES {
                truncated = true;
                break;
            }
            entries.push(TreeEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: fs_util::display_relative(&root, entry.path()),
                is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| compare_ascii_case_insensitive(&a.name, &b.name))
        });
        Ok(DirListing { entries, truncated })
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn cloud_context(state: &AppState) -> Result<Option<Arc<CloudWorkspace>>, String> {
    let Some(cloud) = state.active_cloud_workspace() else {
        return Ok(None);
    };
    state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
    Ok(Some(cloud))
}

#[tauri::command]
pub async fn read_text_file(state: State<'_, AppState>, path: String) -> Result<FileContent, String> {
    if let Some(cloud) = cloud_context(&state).await? {
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let mut content: FileContent = state
            .gateway
            .cloud_files_json("text", &cloud.workspace_uri, &[("path", absolute)])
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
    if looks_binary(&buf) {
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
    if let Some(cloud) = cloud_context(&state).await? {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Resp {
            data_url: String,
        }
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let resp: Resp = state
            .gateway
            .cloud_files_json("image", &cloud.workspace_uri, &[("path", absolute)])
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

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
pub async fn read_binary_file(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    if let Some(cloud) = cloud_context(&state).await? {
        let absolute = absolute_cloud_path(&cloud.repo_dir, &path);
        let bytes = state
            .gateway
            .cloud_file_bytes(&cloud.workspace_uri, &absolute)
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

fn document_type_info(file_type: &str) -> (Option<String>, String) {
    let normalized = file_type.to_ascii_lowercase();
    let artifact_kind = match normalized.as_str() {
        "pdf" => Some("pdf"),
        "docx" => Some("docx"),
        "xlsx" | "xls" | "ods" => Some("xlsx"),
        "pptx" => Some("pptx"),
        _ => None,
    }
    .map(str::to_string);
    let label = match normalized.as_str() {
        "pdf" => "PDF",
        "docx" => "Word",
        "xlsx" | "xls" => "Excel",
        "ods" => "Spreadsheet",
        "pptx" => "PowerPoint",
        "txt" | "text" => "Text",
        "md" | "markdown" => "Markdown",
        "csv" => "CSV",
        "json" => "JSON",
        "html" | "htm" => "HTML",
        "xml" => "XML",
        "rtf" => "RTF",
        _ => return (artifact_kind, normalized.to_uppercase()),
    };
    (artifact_kind, label.to_string())
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
    if let Some(cloud) = cloud_context(&state).await? {
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
            .cloud_files_json("metadata", &cloud.workspace_uri, &[("path", absolute)])
            .await
            .map_err(|e| format!("metadata error: {e}"))?;
        let (artifact_kind, type_label) = document_type_info(&meta.extension);
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
    let extension = lowercase_extension(&resolved);
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

    let (artifact_kind, type_label) = document_type_info(&extension);
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
