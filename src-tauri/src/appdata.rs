use anyhow::Result;
use sha2::{Sha256, Digest};
use sqlx::SqlitePool;
use serde::{Serialize, Deserialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceSession {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: String,
}

/// Deterministic workspace ID: first 16 hex chars of sha256(path)
pub fn workspace_id(path: &str) -> String {
    let normalized = path.replace('\\', "/").to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

/// Returns %APPDATA%/OrchCode/workspaces/<workspace_id>/
pub fn workspace_data_dir(app_data: &PathBuf, workspace_id: &str) -> PathBuf {
    app_data.join("workspaces").join(workspace_id)
}

pub async fn session_list(pool: &SqlitePool) -> Result<Vec<WorkspaceSession>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT path, created_at FROM opened_workspaces ORDER BY created_at DESC"
    ).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(path, created_at)| {
        let name = PathBuf::from(&path)
            .file_name().map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        WorkspaceSession { id: workspace_id(&path), path, name, created_at }
    }).collect())
}

pub async fn session_open(pool: &SqlitePool, app_data: &PathBuf, path: &str) -> Result<WorkspaceSession> {
    let id = workspace_id(path);
    let ws_dir = workspace_data_dir(app_data, &id);
    std::fs::create_dir_all(&ws_dir)?;
    sqlx::query("INSERT OR IGNORE INTO opened_workspaces (path) VALUES (?)")
        .bind(path).execute(pool).await?;
    let name = PathBuf::from(path)
        .file_name().map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    Ok(WorkspaceSession { id, path: path.to_string(), name, created_at: chrono::Utc::now().to_rfc3339() })
}

pub async fn session_delete(pool: &SqlitePool, app_data: &PathBuf, path: &str) -> Result<()> {
    let id = workspace_id(path);
    // Delete DB records
    sqlx::query("DELETE FROM opened_workspaces WHERE path=?").bind(path).execute(pool).await?;
    sqlx::query("DELETE FROM threads WHERE workspace_path=?").bind(path).execute(pool).await?;
    sqlx::query("DELETE FROM rag_chunks WHERE workspace_id=?").bind(&id).execute(pool).await?;
    // Delete workspace appdata directory
    let ws_dir = workspace_data_dir(app_data, &id);
    if ws_dir.exists() { std::fs::remove_dir_all(&ws_dir)?; }
    Ok(())
}

