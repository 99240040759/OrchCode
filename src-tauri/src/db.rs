use anyhow::Result;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::Path;
pub async fn init(db_path: &Path) -> Result<SqlitePool> {
    let url = format!("sqlite:{}?mode=rwc", db_path.to_string_lossy().replace('\\', "/"));
    let pool = SqlitePoolOptions::new().max_connections(5).connect(&url).await?;
    sqlx::query("PRAGMA journal_mode=WAL").execute(&pool).await?;
    sqlx::query("PRAGMA synchronous=NORMAL").execute(&pool).await?;
    sqlx::query("PRAGMA foreign_keys=ON").execute(&pool).await?;
    migrate(&pool).await?;
    Ok(pool)
}
async fn migrate(pool: &SqlitePool) -> Result<()> {
    sqlx::query("CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY, title TEXT, resource_id TEXT NOT NULL,
        workspace_path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        accumulated_tokens INTEGER NOT NULL DEFAULT 0, lifetime_tokens INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0
    )").execute(pool).await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )").execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id, created_at)").execute(pool).await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS opened_workspaces (path TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))").execute(pool).await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')").execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_settings_key ON app_settings(key)").execute(pool).await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general',
        workspace_path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )").execute(pool).await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, file_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL, chunk_text TEXT NOT NULL, embedding TEXT NOT NULL,
        file_mtime INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )").execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_rag_ws ON rag_chunks(workspace_id)").execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_rag_file ON rag_chunks(workspace_id,file_path)").execute(pool).await?;
    Ok(())
}
#[derive(Debug, serde::Serialize, serde::Deserialize, sqlx::FromRow, Clone)]
pub struct Thread {
    pub id: String, pub title: Option<String>, pub resource_id: String,
    pub workspace_path: Option<String>, pub created_at: String, pub updated_at: String,
}
#[derive(Debug, serde::Serialize, serde::Deserialize, sqlx::FromRow, Clone)]
pub struct Message {
    pub id: String, pub thread_id: String, pub role: String, pub content: String,
    pub data: Option<String>, pub created_at: String,
}
#[derive(Debug, serde::Serialize, serde::Deserialize, sqlx::FromRow, Clone)]
pub struct Memory {
    pub id: String, pub content: String, pub category: String,
    pub workspace_path: Option<String>, pub created_at: String, pub updated_at: String,
}
pub async fn thread_list_for_workspace(pool: &SqlitePool, workspace_path: &str) -> Result<Vec<Thread>> {
    let normalized = normalize_ws_path(workspace_path);
    Ok(sqlx::query_as::<_, Thread>("SELECT id,title,resource_id,workspace_path,created_at,updated_at FROM threads WHERE REPLACE(LOWER(REPLACE(workspace_path,'\\','/')),'/','/')=REPLACE(LOWER(REPLACE(?,'\\','/')),'/','/')  ORDER BY updated_at DESC")
        .bind(&normalized).fetch_all(pool).await?)
}
pub async fn thread_get(pool: &SqlitePool, id: &str) -> Result<Option<Thread>> {
    Ok(sqlx::query_as::<_, Thread>("SELECT id,title,resource_id,workspace_path,created_at,updated_at FROM threads WHERE id=?").bind(id).fetch_optional(pool).await?)
}
pub async fn thread_create(pool: &SqlitePool, id: &str, workspace_path: Option<&str>) -> Result<()> {
    let wp = workspace_path.map(normalize_ws_path);
    sqlx::query("INSERT INTO threads (id, resource_id, workspace_path) VALUES (?,?,?)").bind(id).bind(id).bind(wp.as_deref()).execute(pool).await?; Ok(())
}
pub async fn thread_delete(pool: &SqlitePool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM threads WHERE id=?").bind(id).execute(pool).await?; Ok(())
}
pub async fn thread_set_title(pool: &SqlitePool, id: &str, title: &str) -> Result<()> {
    sqlx::query("UPDATE threads SET title=?, updated_at=datetime('now') WHERE id=?").bind(title).bind(id).execute(pool).await?; Ok(())
}
pub async fn msg_list(pool: &SqlitePool, thread_id: &str) -> Result<Vec<Message>> {
    Ok(sqlx::query_as::<_, Message>("SELECT id, thread_id, role, content, data, created_at FROM messages WHERE thread_id=? ORDER BY created_at ASC").bind(thread_id).fetch_all(pool).await?)
}
pub async fn msg_upsert(pool: &SqlitePool, thread_id: &str, m: &Message) -> Result<()> {
    sqlx::query("INSERT INTO messages (id,thread_id,role,content,data,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content, data=excluded.data")
        .bind(&m.id).bind(thread_id).bind(&m.role).bind(&m.content).bind(&m.data).bind(&m.created_at).execute(pool).await?;
    sqlx::query("UPDATE threads SET updated_at=datetime('now') WHERE id=?").bind(thread_id).execute(pool).await?; Ok(())
}
pub async fn msg_compact(pool: &SqlitePool, thread_id: &str, summary: &str, keep: u32) -> Result<()> {
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE thread_id=?")
        .bind(thread_id).fetch_one(pool).await?;
    let drop_count = (total as u32).saturating_sub(keep);
    if drop_count == 0 { return Ok(()); }
    let earliest: Option<String> = sqlx::query_scalar("SELECT MIN(created_at) FROM messages WHERE thread_id=?")
        .bind(thread_id).fetch_optional(pool).await?.flatten();
    let ts = earliest.unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    sqlx::query("DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE thread_id=? ORDER BY created_at ASC LIMIT ?)")
        .bind(thread_id).bind(drop_count).execute(pool).await?;
    let sid = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO messages (id,thread_id,role,content,created_at) VALUES (?,?,'system',?,?)")
        .bind(sid).bind(thread_id).bind(summary).bind(ts).execute(pool).await?;
    Ok(())
}
pub async fn setting_get(pool: &SqlitePool, key: &str) -> Result<Option<String>> {
    Ok(sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?").bind(key).fetch_optional(pool).await?)
}
pub async fn setting_set(pool: &SqlitePool, key: &str, value: &str) -> Result<()> {
    sqlx::query("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key).bind(value).execute(pool).await?; Ok(())
}
pub async fn memory_list(pool: &SqlitePool, workspace_path: Option<&str>) -> Result<Vec<Memory>> {
    Ok(match workspace_path {
        Some(p) => sqlx::query_as::<_, Memory>("SELECT * FROM memories WHERE workspace_path=? OR workspace_path IS NULL ORDER BY updated_at DESC").bind(p).fetch_all(pool).await?,
        None => sqlx::query_as::<_, Memory>("SELECT * FROM memories WHERE workspace_path IS NULL ORDER BY updated_at DESC").fetch_all(pool).await?,
    })
}
fn normalize_ws_path(path: &str) -> String { path.replace('\\', "/") }
