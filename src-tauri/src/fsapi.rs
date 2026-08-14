

use base64::Engine;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use tauri::State;

use crate::config;
use crate::state::AppState;
use crate::tools::fs_util;

const MAX_PREVIEW_BYTES: usize = 512 * 1024;
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
        let pattern = if !query_str.is_empty() {
            Some(Pattern::parse(&query_str, CaseMatching::Ignore, Normalization::Smart))
        } else {
            None
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

            let score = if let Some(ref pat) = pattern {
                let mut buf = Vec::new();
                let utf32 = Utf32Str::new(&rel, &mut buf);
                pat.score(utf32, &mut matcher)
            } else {
                Some(0)
            };

            if let Some(score) = score {
                let depth = rel.matches('/').count();
                scored.push((score, depth, FileEntry { path: rel, name }));
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
    let resolved = fs_util::resolve_in_workspace(&root, &path).map_err(|e| e.to_string())?;

    use tokio::io::AsyncReadExt;
    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let truncated = meta.len() as usize > MAX_PREVIEW_BYTES;

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
        content: String::from_utf8_lossy(&buf).to_string(),
        truncated,
    })
}

#[tauri::command]
pub async fn read_image_data_url(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_in_workspace(&root, &path).map_err(|e| e.to_string())?;

    let meta = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("not a file: {path}"));
    }
    if meta.len() as usize > config::MAX_ATTACHMENT_BYTES {
        return Err(format!("image too large to preview: {path}"));
    }

    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    let (mime, final_bytes) = if let Ok(img) = image::load_from_memory(&bytes) {
        if img.width() > 1200 || img.height() > 1200 {
            let resized = img.thumbnail(1200, 1200);
            let mut cursor = std::io::Cursor::new(Vec::new());
            if resized.write_to(&mut cursor, image::ImageFormat::WebP).is_ok() {
                ("image/webp", cursor.into_inner())
            } else {
                ("image/png", bytes)
            }
        } else {
            let ext_mime = match resolved
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase())
                .as_deref()
            {
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("webp") => "image/webp",
                Some("gif") => "image/gif",
                Some("bmp") => "image/bmp",
                Some("svg") => "image/svg+xml",
                _ => "image/png",
            };
            (ext_mime, bytes)
        }
    } else {
        ("image/png", bytes)
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&final_bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}
