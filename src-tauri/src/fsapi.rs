use serde::Serialize;
use tauri::State;
use crate::state::AppState;
use crate::tools::fs_util;

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", ".git", ".next"];
const MAX_PREVIEW_BYTES: usize = 512 * 1024;

#[tauri::command]
pub async fn list_workspace_files(
    state: State<'_, AppState>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let query = query.unwrap_or_default().to_lowercase();
    let limit = limit.unwrap_or(10_000);

    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        let walker = ignore::WalkBuilder::new(&root)
            .git_ignore(true)
            .git_global(false)
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !SKIP_DIRS.contains(&name.as_ref())
            })
            .build();

        for entry in walker.flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            let rel = fs_util::display_relative(&root, path);
            if !query.is_empty() && !rel.to_lowercase().contains(&query) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            out.push(FileEntry { path: rel, name });
            if out.len() >= limit {
                break;
            }
        }
        out.sort_by(|a, b| {
            let a_name_match = a.name.to_lowercase().contains(&query);
            let b_name_match = b.name.to_lowercase().contains(&query);
            b_name_match.cmp(&a_name_match).then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
        });
        Ok(out)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_dir(state: State<'_, AppState>, path: Option<String>) -> Result<Vec<DirEntry>, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let target = match path {
        Some(p) if !p.is_empty() => fs_util::resolve_in_workspace(&root, &p).map_err(|e| e.to_string())?,
        _ => dunce::canonicalize(&root).map_err(|e| e.to_string())?,
    };

    tokio::task::spawn_blocking(move || {
        let read = std::fs::read_dir(&target).map_err(|e| e.to_string())?;
        let mut entries = Vec::new();
        for e in read.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let p = e.path();
            let is_dir = p.is_dir();
            let rel = fs_util::display_relative(&root, &p);
            entries.push(DirEntry { name, path: rel, is_dir });
        }
        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(entries)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_text_file(state: State<'_, AppState>, path: String) -> Result<FileContent, String> {
    let root = state.require_workspace().map_err(|e| e.to_string())?;
    let resolved = fs_util::resolve_in_workspace(&root, &path).map_err(|e| e.to_string())?;

    let meta = tokio::fs::metadata(&resolved).await.map_err(|e| format!("cannot stat {path}: {e}"))?;
    let file_size = meta.len() as usize;
    let truncated = file_size > MAX_PREVIEW_BYTES;
    let end = file_size.min(MAX_PREVIEW_BYTES);

    let bytes = tokio::fs::read(&resolved).await.map_err(|e| format!("cannot read {path}: {e}"))?;
    let content = String::from_utf8_lossy(&bytes[..end]).to_string();
    let display_path = fs_util::display_relative(&root, &resolved);
    Ok(FileContent { path: display_path, content, truncated })
}
