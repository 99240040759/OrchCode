use anyhow::Result;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use crate::{db, appdata, agent, watcher, workspace};
use std::collections::HashMap;
#[derive(Clone, Serialize, Debug)]
pub struct WorkspaceMeta { pub id: String, pub path: String, pub name: String }
#[derive(Clone, Serialize, Debug)]
pub struct ActiveWorkspace {
    pub id: String, pub path: String, pub name: String,
    pub threads: Vec<db::Thread>,
    #[serde(rename = "activeThreadId")]
    pub active_thread_id: Option<String>,
}
#[derive(Clone, Serialize, Debug)]
pub struct AppSnapshot {
    pub workspaces: Vec<WorkspaceMeta>,
    pub active: Option<ActiveWorkspace>,
    #[serde(rename = "threadTokens")]
    pub thread_tokens: HashMap<String, (u64, u64)>,
}
struct Inner {
    workspaces: Vec<appdata::WorkspaceSession>,
    active_path: Option<String>,
    active_threads: Vec<db::Thread>,
    active_thread_id: Option<String>,
    thread_tokens: HashMap<String, (u64, u64)>,
}
pub struct AppStateManager { inner: RwLock<Inner> }
impl AppStateManager {
    pub fn new() -> Self {
        Self { inner: RwLock::new(Inner {
            workspaces: Vec::new(), active_path: None,
            active_threads: Vec::new(), active_thread_id: None,
            thread_tokens: HashMap::new(),
        })}
    }
    fn snap(s: &Inner) -> AppSnapshot {
        AppSnapshot {
            workspaces: s.workspaces.iter().map(|w| WorkspaceMeta {
                id: w.id.clone(), path: w.path.clone(), name: w.name.clone(),
            }).collect(),
            active: s.active_path.as_ref().map(|path| {
                let ws = s.workspaces.iter().find(|w| w.path == *path);
                ActiveWorkspace {
                    id: ws.map(|w| w.id.clone()).unwrap_or_default(),
                    path: path.clone(),
                    name: ws.map(|w| w.name.clone()).unwrap_or_default(),
                    threads: s.active_threads.clone(),
                    active_thread_id: s.active_thread_id.clone(),
                }
            }),
            thread_tokens: s.thread_tokens.clone(),
        }
    }
    fn emit(app: &AppHandle, s: &Inner) { let _ = app.emit("app:state", Self::snap(s)); }
    /// Load state from DB, start watcher, return initial snapshot
    pub async fn init(&self, pool: &SqlitePool, app: &AppHandle) -> Result<AppSnapshot> {
        let sessions = appdata::session_list(pool).await?;
        let active_tid = db::setting_get(pool, "active_thread_id").await?;
        let mut s = self.inner.write().await;
        s.workspaces = sessions;
        // Find workspace of active thread
        if let Some(ref tid) = active_tid {
            if let Some(thread) = db::thread_get(pool, tid).await? {
                if let Some(ref wp) = thread.workspace_path {
                    let norm = wp.replace('\\', "/");
                    if s.workspaces.iter().any(|w| w.path == norm || w.path == *wp) {
                        s.active_path = Some(norm.clone());
                        s.active_threads = db::thread_list_for_workspace(pool, &norm).await?;
                        s.active_thread_id = Some(tid.clone());
                    }
                }
            }
        }
        // Fallback: first workspace
        if s.active_path.is_none() && !s.workspaces.is_empty() {
            let wp = s.workspaces[0].path.clone();
            s.active_path = Some(wp.clone());
            let mut threads = db::thread_list_for_workspace(pool, &wp).await?;
            if threads.is_empty() {
                let id = uuid::Uuid::new_v4().to_string();
                db::thread_create(pool, &id, Some(&wp)).await?;
                threads = db::thread_list_for_workspace(pool, &wp).await?;
            }
            s.active_thread_id = threads.first().map(|t| t.id.clone());
            s.active_threads = threads;
        }
        if let Some(ref tid) = s.active_thread_id {
            db::setting_set(pool, "active_thread_id", tid).await.ok();
        }
        // Start watcher
        if let Some(ref path) = s.active_path { watcher::start(app.clone(), path).ok(); }
        Ok(Self::snap(&s))
    }
    /// Atomically switch to a workspace — cancels agents, stops watcher, loads threads
    pub async fn activate_workspace(&self, pool: &SqlitePool, app: &AppHandle, path: &str) -> Result<AppSnapshot> {
        cancel_all_agents();
        watcher::stop();
        workspace::invalidate_cache();
        let norm = path.replace('\\', "/");
        let mut threads = db::thread_list_for_workspace(pool, &norm).await?;
        if threads.is_empty() {
            let id = uuid::Uuid::new_v4().to_string();
            db::thread_create(pool, &id, Some(&norm)).await?;
            threads = db::thread_list_for_workspace(pool, &norm).await?;
        }
        let pref_key = format!("active_thread:{norm}");
        let pref_tid = db::setting_get(pool, &pref_key).await?;
        let active_tid = match pref_tid {
            Some(ref tid) if threads.iter().any(|t| t.id == *tid) => tid.clone(),
            _ => threads[0].id.clone(),
        };
        {
            let mut s = self.inner.write().await;
            s.active_path = Some(norm.clone());
            s.active_threads = threads;
            s.active_thread_id = Some(active_tid.clone());
            Self::emit(app, &s);
        }
        db::setting_set(pool, "active_thread_id", &active_tid).await.ok();
        db::setting_set(pool, &pref_key, &active_tid).await.ok();
        watcher::start(app.clone(), &norm).ok();
        // RAG in background
        let ws_id = appdata::workspace_id(&norm);
        let p2 = pool.clone(); let n2 = norm.clone();
        tokio::spawn(async move { crate::rag::index_workspace(&p2, &ws_id, &n2).await.ok(); });
        let s = self.inner.read().await;
        Ok(Self::snap(&s))
    }
    /// Open new workspace + activate
    pub async fn open_workspace(&self, pool: &SqlitePool, app: &AppHandle, data_dir: &std::path::Path, path: &str) -> Result<AppSnapshot> {
        let session = appdata::session_open(pool, &data_dir.to_path_buf(), path).await?;
        { let mut s = self.inner.write().await;
          if !s.workspaces.iter().any(|w| w.path == session.path) { s.workspaces.push(session); }
        }
        self.activate_workspace(pool, app, path).await
    }
    /// Close workspace — cancel agents, delete data, switch to next
    pub async fn close_workspace(&self, pool: &SqlitePool, app: &AppHandle, data_dir: &std::path::Path, path: &str) -> Result<AppSnapshot> {
        let norm = path.replace('\\', "/");
        let threads = db::thread_list_for_workspace(pool, &norm).await?;
        for t in &threads {
            if let Some((_, tok)) = agent::CANCEL_TOKENS.remove(&t.id) { tok.cancel(); }
        }
        appdata::session_delete(pool, &data_dir.to_path_buf(), &norm).await?;
        workspace::invalidate_cache_for(&norm);
        let mut s = self.inner.write().await;
        s.workspaces.retain(|w| w.path != norm);
        if s.active_path.as_deref() == Some(norm.as_str()) {
            watcher::stop();
            s.active_path = None;
            s.active_threads.clear();
            s.active_thread_id = None;
            if let Some(first) = s.workspaces.first().cloned() {
                drop(s);
                return self.activate_workspace(pool, app, &first.path).await;
            }
        }
        Self::emit(app, &s);
        Ok(Self::snap(&s))
    }
    /// Switch active thread
    pub async fn switch_thread(&self, pool: &SqlitePool, app: &AppHandle, thread_id: &str) -> Result<AppSnapshot> {
        let mut s = self.inner.write().await;
        if !s.active_threads.iter().any(|t| t.id == thread_id) {
            return Err(anyhow::anyhow!("Thread not in active workspace"));
        }
        s.active_thread_id = Some(thread_id.to_string());
        db::setting_set(pool, "active_thread_id", thread_id).await.ok();
        if let Some(ref path) = s.active_path {
            db::setting_set(pool, &format!("active_thread:{path}"), thread_id).await.ok();
        }
        Self::emit(app, &s);
        Ok(Self::snap(&s))
    }
    /// Create new thread in active workspace
    pub async fn create_thread(&self, pool: &SqlitePool, app: &AppHandle) -> Result<AppSnapshot> {
        let mut s = self.inner.write().await;
        let path = s.active_path.clone().ok_or_else(|| anyhow::anyhow!("No active workspace"))?;
        let id = uuid::Uuid::new_v4().to_string();
        db::thread_create(pool, &id, Some(&path)).await?;
        s.active_threads = db::thread_list_for_workspace(pool, &path).await?;
        s.active_thread_id = Some(id.clone());
        db::setting_set(pool, "active_thread_id", &id).await.ok();
        db::setting_set(pool, &format!("active_thread:{path}"), &id).await.ok();
        Self::emit(app, &s);
        Ok(Self::snap(&s))
    }
    /// Delete thread — switch to another or create new
    pub async fn delete_thread(&self, pool: &SqlitePool, app: &AppHandle, thread_id: &str) -> Result<AppSnapshot> {
        if let Some((_, tok)) = agent::CANCEL_TOKENS.remove(thread_id) { tok.cancel(); }
        db::thread_delete(pool, thread_id).await?;
        let mut s = self.inner.write().await;
        let path = s.active_path.clone().ok_or_else(|| anyhow::anyhow!("No active workspace"))?;
        s.active_threads = db::thread_list_for_workspace(pool, &path).await?;
        if s.active_thread_id.as_deref() == Some(thread_id) {
            if s.active_threads.is_empty() {
                let id = uuid::Uuid::new_v4().to_string();
                db::thread_create(pool, &id, Some(&path)).await?;
                s.active_threads = db::thread_list_for_workspace(pool, &path).await?;
                s.active_thread_id = Some(id);
            } else {
                s.active_thread_id = Some(s.active_threads[0].id.clone());
            }
            if let Some(ref tid) = s.active_thread_id {
                db::setting_set(pool, "active_thread_id", tid).await.ok();
            }
        }
        Self::emit(app, &s);
        Ok(Self::snap(&s))
    }
    /// Update thread title + emit
    pub async fn update_title(&self, pool: &SqlitePool, app: &AppHandle, thread_id: &str, title: &str) -> Result<()> {
        db::thread_set_title(pool, thread_id, title).await?;
        let mut s = self.inner.write().await;
        for t in &mut s.active_threads {
            if t.id == thread_id { t.title = Some(title.to_string()); }
        }
        Self::emit(app, &s);
        Ok(())
    }
    pub async fn active_workspace_path(&self) -> Option<String> { self.inner.read().await.active_path.clone() }
    /// Update token counts for a thread (called from agent stream)
    pub async fn update_tokens(&self, app: &AppHandle, thread_id: &str, input: u64, output: u64) {
        let mut s = self.inner.write().await;
        s.thread_tokens.insert(thread_id.to_string(), (input, output));
        Self::emit(app, &s);
    }
}
fn cancel_all_agents() {
    let keys: Vec<String> = agent::CANCEL_TOKENS.iter().map(|e| e.key().clone()).collect();
    for k in keys { if let Some((_, t)) = agent::CANCEL_TOKENS.remove(&k) { t.cancel(); } }
}
