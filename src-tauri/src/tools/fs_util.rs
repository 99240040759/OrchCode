use std::path::{Path, PathBuf};
use crate::error::{AppError, AppResult};

const FILE_SIZE_LIMIT: u64 = 10 * 1024 * 1024;

pub fn resolve_in_workspace(root: &Path, input: &str) -> AppResult<PathBuf> {
    let canonical_root = dunce::canonicalize(root)?;
    let raw = Path::new(input);
    let joined = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        canonical_root.join(raw)
    };

    let canonical = dunce::canonicalize(&joined).map_err(|_| {
        AppError::PathEscapesWorkspace(input.to_string())
    })?;

    if !canonical.starts_with(&canonical_root) {
        return Err(AppError::PathEscapesWorkspace(input.to_string()));
    }

    #[cfg(windows)]
    {
        if let Ok(meta) = std::fs::symlink_metadata(&joined) {
            if meta.file_type().is_symlink() && !canonical.starts_with(&canonical_root) {
                return Err(AppError::SymlinkEscape(input.to_string()));
            }
        }
    }

    #[cfg(unix)]
    {
        if let Ok(meta) = std::fs::symlink_metadata(&joined) {
            if meta.file_type().is_symlink() {
                if !canonical.starts_with(&canonical_root) {
                    return Err(AppError::SymlinkEscape(input.to_string()));
                }
            }
        }
    }

    Ok(canonical)
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
