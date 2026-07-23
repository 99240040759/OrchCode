use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use tokio::sync::oneshot;

use crate::auth;
use crate::config;
use crate::dictation::DictationHandle;
use crate::error::{AppError, AppResult};
use crate::gateway::{Gateway, ModelCatalog, TokenHandle};
use crate::persistence::SqliteMemory;
use crate::tools::command_manager::CommandManager;

pub type WorkspaceHandle = Arc<RwLock<Option<PathBuf>>>;
pub type BrowserRequestsHandle = Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>;

pub struct RunHandle {
    pub run_id: String,
    pub cancel: Arc<AtomicBool>,
    pub started_at: Instant,
}

pub struct AppState {
    pub token: TokenHandle,
    pub workspace: WorkspaceHandle,
    pub data_dir: PathBuf,
    pub sandbox: PathBuf,
    pub gateway: Arc<Gateway>,
    pub catalog: RwLock<Option<ModelCatalog>>,
    pub memory: SqliteMemory,
    pub runs: Mutex<HashMap<String, RunHandle>>,
    pub dictation: Mutex<Option<DictationHandle>>,
    pub terminals: Mutex<HashMap<String, crate::terminal::TerminalSession>>,
    pub browser_requests: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    pub command_manager: Arc<CommandManager>,
    pub current_user_id: RwLock<Option<String>>,
}

impl AppState {
    pub fn new(db_path: &Path) -> AppResult<Self> {
        let token: TokenHandle = Arc::new(RwLock::new(None));
        let gateway = Arc::new(Gateway::new(token.clone()));
        let memory = SqliteMemory::open(db_path)?;

        let data_dir = db_path.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
        let sandbox = data_dir.join("sandbox");
        std::fs::create_dir_all(&sandbox).map_err(AppError::Io)?;

        auth::migrate_legacy_tokens(&data_dir);

        if let Some(at) = auth::load_access_token(&data_dir) {
            if let Ok(mut guard) = token.write() {
                *guard = Some(at);
            }
        }

        let state = Self {
            token,
            workspace: Arc::new(RwLock::new(Some(sandbox.clone()))),
            data_dir,
            sandbox,
            gateway,
            catalog: RwLock::new(None),
            memory,
            runs: Mutex::new(HashMap::new()),
            dictation: Mutex::new(None),
            terminals: Mutex::new(HashMap::new()),
            browser_requests: Arc::new(Mutex::new(HashMap::new())),
            command_manager: Arc::new(CommandManager::new()),
            current_user_id: RwLock::new(None),
        };

        Ok(state)
    }

    pub fn set_token(&self, token: Option<String>) {
        let clean = token.filter(|t| !t.is_empty());
        if let Ok(mut guard) = self.token.write() {
            *guard = clean;
        }
    }

    pub fn clear_credentials(&self) {
        self.set_token(None);
        auth::clear_access_token(&self.data_dir);
        auth::clear_refresh_token();
        if let Ok(mut guard) = self.current_user_id.write() {
            *guard = None;
        }
        if let Ok(mut guard) = self.catalog.write() {
            *guard = None;
        }
    }

    pub fn has_token(&self) -> bool {
        self.token.read().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn set_authenticated_user(&self, user_id: &str) -> bool {
        if let Ok(mut guard) = self.current_user_id.write() {
            let changed = guard.as_deref() != Some(user_id);
            *guard = Some(user_id.to_string());
            if changed {
                if let Ok(mut cat) = self.catalog.write() {
                    *cat = None;
                }
            }
            return changed;
        }
        false
    }

    pub fn use_sandbox(&self) {
        self.set_workspace(self.sandbox.clone());
    }

    pub fn is_sandbox(&self) -> bool {
        self.workspace().map(|w| w == self.sandbox).unwrap_or(true)
    }

    pub fn set_workspace(&self, path: PathBuf) {
        if let Ok(mut guard) = self.workspace.write() {
            *guard = Some(path);
        }
    }

    pub fn workspace(&self) -> Option<PathBuf> {
        self.workspace.read().ok().and_then(|g| g.clone())
    }

    pub fn require_workspace(&self) -> AppResult<PathBuf> {
        self.workspace().ok_or(AppError::NoWorkspace)
    }

    pub fn snapshot_workspace(&self) -> Option<PathBuf> {
        self.workspace()
    }

    pub async fn catalog(&self) -> AppResult<ModelCatalog> {
        if let Ok(guard) = self.catalog.read() {
            if let Some(cat) = guard.as_ref() {
                if !cat.is_empty() {
                    return Ok(cat.clone());
                }
            }
        }
        self.refresh_catalog().await
    }

    pub async fn refresh_catalog(&self) -> AppResult<ModelCatalog> {
        let fresh = self.gateway.models().await?;
        if let Ok(mut guard) = self.catalog.write() {
            *guard = Some(fresh.clone());
        }
        Ok(fresh)
    }

    /// Background TTL refresh of the model catalog. The catalog previously only
    /// refetched on an explicit `force_refresh` from the frontend or on login/logout, so
    /// a model added or changed server-side would not appear until the user manually
    /// triggered a refresh. This loop re-polls `/models` on a fixed interval for the
    /// lifetime of the app and emits `models-updated` so the frontend can silently pick
    /// up changes without the user doing anything.
    pub fn spawn_catalog_refresh_loop(app: tauri::AppHandle) {
        use tauri::{Emitter, Manager};
        // `tauri::async_runtime::spawn` (not `tokio::spawn`) — this is called from
        // Tauri's synchronous `setup()` hook, which runs outside a tokio task context.
        // `tokio::spawn` requires an active reactor on the calling thread and panics
        // with "there is no reactor running" when called from there; Tauri's own
        // runtime handle spawns onto its managed runtime regardless of caller context.
        tauri::async_runtime::spawn(async move {
            let interval = std::time::Duration::from_secs(config::MODEL_CATALOG_REFRESH_INTERVAL_SECS);
            loop {
                tokio::time::sleep(interval).await;
                let state = app.state::<AppState>();
                match state.refresh_catalog().await {
                    Ok(_) => {
                        let _ = app.emit("models-updated", ());
                    }
                    Err(e) => {
                        eprintln!("[models] background TTL refresh failed: {e}");
                    }
                }
            }
        });
    }

    pub fn start_run(&self, session_id: &str) -> AppResult<(String, Arc<AtomicBool>)> {
        let mut guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if guard.contains_key(session_id) {
            return Err(AppError::RunConflict);
        }
        let run_id = format!("{}-{}", session_id, uuid::Uuid::new_v4().simple());
        let cancel = Arc::new(AtomicBool::new(false));
        guard.insert(session_id.to_string(), RunHandle {
            run_id: run_id.clone(),
            cancel: cancel.clone(),
            started_at: Instant::now(),
        });
        Ok((run_id, cancel))
    }

    pub fn finish_run(&self, session_id: &str, run_id: &str) {
        let mut guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if guard.get(session_id).map(|r| r.run_id == run_id).unwrap_or(false) {
            guard.remove(session_id);
        }
    }

    pub fn cancel_run(&self, session_id: &str) {
        let guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(run) = guard.get(session_id) {
            run.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    pub fn is_session_active(&self, session_id: &str) -> bool {
        self.runs.lock().unwrap_or_else(|e| e.into_inner()).contains_key(session_id)
    }

    pub fn register_browser_request(&self, request_id: &str) -> oneshot::Receiver<String> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self.browser_requests.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(request_id.to_string(), tx);
        rx
    }

    pub fn fulfill_browser_request(&self, request_id: &str, content: String) -> AppResult<()> {
        let mut guard = self.browser_requests.lock().unwrap_or_else(|e| e.into_inner());
        match guard.remove(request_id) {
            Some(tx) => {
                let _ = tx.send(content);
                Ok(())
            }
            None => Err(AppError::NoBrowserRequest),
        }
    }
}
