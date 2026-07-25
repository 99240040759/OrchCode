use std::ffi::OsString;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;

use crate::error::{AppError, AppResult};

pub const FILE_SIZE_LIMIT: u64 = 10 * 1024 * 1024;

pub const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".next",
    ".turbo",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
];

pub fn workspace_walker(root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(root);
    builder
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .hidden(false)
        .follow_links(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !SKIP_DIRS.contains(&name.as_ref())
        });
    builder
}

pub fn resolve_in_workspace(root: &Path, input: &str) -> AppResult<PathBuf> {
    let canonical_root = dunce::canonicalize(root)?;
    let raw = Path::new(input);
    let joined = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        canonical_root.join(raw)
    };

    let mut cursor = joined.as_path();
    let mut tail: Vec<OsString> = Vec::new();
    let canonical_existing = loop {
        match dunce::canonicalize(cursor) {
            Ok(resolved) => break resolved,
            Err(_) => {
                let name = cursor
                    .file_name()
                    .ok_or_else(|| AppError::PathEscapesWorkspace(input.to_string()))?;
                tail.push(name.to_os_string());
                cursor = cursor
                    .parent()
                    .ok_or_else(|| AppError::PathEscapesWorkspace(input.to_string()))?;
            }
        }
    };

    if !canonical_existing.starts_with(&canonical_root) {
        return Err(AppError::PathEscapesWorkspace(input.to_string()));
    }

    let mut resolved = canonical_existing;
    for name in tail.into_iter().rev() {
        if name == std::ffi::OsStr::new("..") || name == std::ffi::OsStr::new(".") {
            return Err(AppError::PathEscapesWorkspace(input.to_string()));
        }
        resolved.push(name);
    }

    if !resolved.starts_with(&canonical_root) {
        return Err(AppError::PathEscapesWorkspace(input.to_string()));
    }

    Ok(resolved)
}

pub fn check_file_size(path: &Path) -> AppResult<u64> {
    let meta = std::fs::metadata(path)?;
    let size = meta.len();
    if size > FILE_SIZE_LIMIT {
        return Err(AppError::FileTooLarge(format!(
            "{}: {size} bytes exceeds limit of {FILE_SIZE_LIMIT} bytes",
            path.display()
        )));
    }
    Ok(size)
}

pub fn display_relative(root: &Path, path: &Path) -> String {
    let canonical_root = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    match path.strip_prefix(&canonical_root) {
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_) => path.to_string_lossy().replace('\\', "/"),
    }
}

pub async fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::other(format!("invalid target path: {}", path.display())))?;
    let tmp_path = path.with_file_name(format!(
        ".{name}.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));

    tokio::fs::write(&tmp_path, content).await?;
    if let Err(e) = tokio::fs::rename(&tmp_path, path).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(AppError::Io(e));
    }
    Ok(())
}
