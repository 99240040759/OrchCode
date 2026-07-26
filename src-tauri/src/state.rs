use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};

use crate::auth;
use crate::config;
use crate::dictation::DictationHandle;
use crate::error::{AppError, AppResult};
use crate::gateway::{Gateway, ModelCatalog, TokenHandle};
use crate::persistence::SqliteMemory;
use crate::tools::command_manager::CommandManager;
use crate::vector_store::WorkspaceIndex;

pub type WorkspaceHandle = Arc<RwLock<Option<PathBuf>>>;

pub struct RunHandle {
    pub run_id: String,
    pub cancel: Arc<AtomicBool>,
}

pub struct AppState {
    pub token: TokenHandle,
    pub workspace: WorkspaceHandle,
    pub data_dir: PathBuf,
    pub sandbox: PathBuf,
    pub gateway: Arc<Gateway>,
    pub catalog: RwLock<Option<ModelCatalog>>,
    pub memory: SqliteMemory,
    pub workspace_index: WorkspaceIndex,
    pub runs: Mutex<HashMap<String, RunHandle>>,
    pub dictation: Mutex<Option<DictationHandle>>,
    pub terminals: Mutex<HashMap<String, crate::terminal::TerminalSession>>,
    pub command_manager: Arc<CommandManager>,
    current_user_id: RwLock<Option<String>>,
    sign_in_started_at: Mutex<Option<Instant>>,
}

impl AppState {
    pub fn new(data_dir: &Path) -> AppResult<Self> {
        let db_path = data_dir.join("orchcode.db");
        let token: TokenHandle = Arc::new(RwLock::new(None));
        let gateway = Arc::new(Gateway::new(token.clone())?);
        let memory = SqliteMemory::open(&db_path)?;
        let workspace_index = WorkspaceIndex::open(&db_path, gateway.clone())?;

        let sandbox = data_dir.join("sandbox");
        std::fs::create_dir_all(&sandbox)?;

        Ok(Self {
            token,
            workspace: Arc::new(RwLock::new(Some(sandbox.clone()))),
            data_dir: data_dir.to_path_buf(),
            sandbox,
            gateway,
            catalog: RwLock::new(None),
            memory,
            workspace_index,
            runs: Mutex::new(HashMap::new()),
            dictation: Mutex::new(None),
            terminals: Mutex::new(HashMap::new()),
            command_manager: Arc::new(CommandManager::new()),
            current_user_id: RwLock::new(None),
            sign_in_started_at: Mutex::new(None),
        })
    }

    pub fn set_token(&self, token: Option<String>) {
        let clean = token.filter(|t| !t.is_empty());
        if let Ok(mut guard) = self.token.write() {
            *guard = clean;
        }
    }

    pub fn access_token(&self) -> Option<String> {
        self.token
            .read()
            .ok()
            .and_then(|g| g.clone())
            .filter(|t| !t.is_empty())
    }

    pub fn has_token(&self) -> bool {
        self.access_token().is_some()
    }

    pub fn clear_credentials(&self) {
        self.set_token(None);
        auth::clear_tokens();
        if let Ok(mut guard) = self.current_user_id.write() {
            *guard = None;
        }
        if let Ok(mut guard) = self.catalog.write() {
            *guard = None;
        }
        self.workspace_index.invalidate();
    }

    pub fn set_authenticated_user(&self, user_id: &str) {
        let changed = match self.current_user_id.write() {
            Ok(mut guard) => {
                let changed = guard.as_deref() != Some(user_id);
                *guard = Some(user_id.to_string());
                changed
            }
            Err(_) => false,
        };
        if changed {
            if let Ok(mut cat) = self.catalog.write() {
                *cat = None;
            }
            self.workspace_index.invalidate();
        }
    }

    pub fn mark_sign_in_started(&self) {
        if let Ok(mut guard) = self.sign_in_started_at.lock() {
            *guard = Some(Instant::now());
        }
    }

    pub fn consume_sign_in_window(&self) -> bool {
        match self.sign_in_started_at.lock() {
            Ok(mut guard) => match guard.take() {
                Some(started) => {
                    started.elapsed().as_secs() <= config::SIGN_IN_WINDOW_SECS
                }
                None => false,
            },
            Err(_) => false,
        }
    }

    pub fn use_sandbox(&self) {
        self.set_workspace(self.sandbox.clone());
    }

    pub fn is_sandbox(&self) -> bool {
        self.workspace().map(|w| w == self.sandbox).unwrap_or(true)
    }

    pub fn set_workspace(&self, path: PathBuf) {
        let changed = self.workspace().as_deref() != Some(path.as_path());
        if let Ok(mut guard) = self.workspace.write() {
            *guard = Some(path);
        }
        if changed {
            self.workspace_index.invalidate();
        }
    }

    pub fn workspace(&self) -> Option<PathBuf> {
        self.workspace.read().ok().and_then(|g| g.clone())
    }

    pub fn require_workspace(&self) -> AppResult<PathBuf> {
        self.workspace().ok_or(AppError::NoWorkspace)
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

    pub async fn ensure_fresh_token(&self) -> AppResult<()> {
        let Some(current) = self.access_token() else {
            return Err(AppError::NoToken);
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        match auth::jwt_expiry(&current) {
            Some(exp) if exp - now > config::TOKEN_REFRESH_SKEW_SECS => return Ok(()),
            _ => {}
        }

        let Some(refresh_token) = auth::load_refresh_token() else {
            return Err(AppError::NoToken);
        };

        let client = auth::FirebaseAuthClient::new();
        let session = client.refresh_session(&refresh_token).await?;
        if let Some(rt) = session.refresh_token.as_deref() {
            auth::save_refresh_token(rt)?;
        }
        self.set_token(Some(session.access_token));
        if let Some(user) = session.user.as_ref() {
            self.set_authenticated_user(&user.id);
        }
        Ok(())
    }

    pub fn spawn_background_loops(app: tauri::AppHandle) {
        let catalog_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let interval =
                std::time::Duration::from_secs(config::MODEL_CATALOG_REFRESH_INTERVAL_SECS);
            loop {
                tokio::time::sleep(interval).await;
                let state = catalog_app.state::<AppState>();
                if !state.has_token() {
                    continue;
                }
                match state.refresh_catalog().await {
                    Ok(_) => {
                        let _ = catalog_app.emit("models-updated", ());
                    }
                    Err(e) => {
                        eprintln!("[models] background refresh failed: {e}");
                    }
                }
            }
        });

        tauri::async_runtime::spawn(async move {
            let interval =
                std::time::Duration::from_secs(config::TOKEN_REFRESH_CHECK_INTERVAL_SECS);
            loop {
                tokio::time::sleep(interval).await;
                let state = app.state::<AppState>();
                if !state.has_token() {
                    continue;
                }
                if let Err(e) = state.ensure_fresh_token().await {
                    state.clear_credentials();
                    let _ = app.emit(
                        "auth-changed",
                        serde_json::json!({ "user": null, "error": e.to_string() }),
                    );
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
        guard.insert(
            session_id.to_string(),
            RunHandle {
                run_id: run_id.clone(),
                cancel: cancel.clone(),
            },
        );
        Ok((run_id, cancel))
    }

    pub fn finish_run(&self, session_id: &str, run_id: &str) {
        let mut guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if guard
            .get(session_id)
            .map(|r| r.run_id == run_id)
            .unwrap_or(false)
        {
            guard.remove(session_id);
        }
    }

    pub fn cancel_run(&self, session_id: &str) {
        let guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(run) = guard.get(session_id) {
            run.cancel
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    pub fn shutdown(&self) {
        self.command_manager.kill_all();
        let mut guard = self.terminals.lock().unwrap_or_else(|e| e.into_inner());
        for (_, session) in guard.iter_mut() {
            session.kill();
        }
        guard.clear();
        if let Ok(mut dictation) = self.dictation.lock() {
            if let Some(handle) = dictation.take() {
                handle.stop();
            }
        }
    }
}
