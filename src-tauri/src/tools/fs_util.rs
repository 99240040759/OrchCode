use std::ffi::OsString;
use std::path::{Path, PathBuf};
use crate::error::{AppError, AppResult};

pub const FILE_SIZE_LIMIT: u64 = 10 * 1024 * 1024;

pub const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", ".git", ".next"];

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
                let name = cursor.file_name().ok_or_else(|| AppError::PathEscapesWorkspace(input.to_string()))?;
                tail.push(name.to_os_string());
                cursor = cursor.parent().ok_or_else(|| AppError::PathEscapesWorkspace(input.to_string()))?;
            }
        }
    };

    if !canonical_existing.starts_with(&canonical_root) {
        return Err(AppError::PathEscapesWorkspace(input.to_string()));
    }

    let mut resolved = canonical_existing;
    for name in tail.into_iter().rev() {
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
            "{}: {} bytes exceeds limit of {} bytes",
            path.display(),
            size,
            FILE_SIZE_LIMIT
        )));
    }
    Ok(size)
}

pub fn display_relative(root: &Path, path: &Path) -> String {
    let root = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    match path.strip_prefix(&root) {
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_) => path.to_string_lossy().to_string(),
    }
}
