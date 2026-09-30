use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::auth;
use crate::config;
use crate::connectors::ConnectorManager;
use crate::dictation::DictationHandle;
use crate::error::{AppError, AppResult};
use crate::fsapi::FileEntry;
use crate::gateway::{Gateway, ModelCatalog, TokenHandle};
use crate::llm::ChatClient;
use crate::persistence::SqliteMemory;
use crate::tools::CommandManager;

pub type WorkspaceHandle = Arc<RwLock<Option<PathBuf>>>;

pub struct RunHandle {
    pub run_id: String,
    pub cancel: CancellationToken,
    pub workspace: Option<PathBuf>,
}

struct SignInAttempt {
    started: Instant,
    session_id: Option<String>,
}

struct FileIndex {
    root: PathBuf,
    built_at: Instant,
    entries: Arc<Vec<FileEntry>>,
}

pub struct AppState {
    pub token: TokenHandle,
    pub workspace: WorkspaceHandle,
    pub data_dir: PathBuf,
    pub gateway: Arc<Gateway>,
    pub catalog: RwLock<Option<ModelCatalog>>,
    pub memory: SqliteMemory,
    pub runs: Mutex<HashMap<String, RunHandle>>,
    pub dictation: Mutex<Option<DictationHandle>>,
    pub terminals: Arc<Mutex<HashMap<String, crate::terminal::TerminalSession>>>,
    pub command_manager: Arc<CommandManager>,
    pub connector_manager: Arc<ConnectorManager>,
    current_user_id: RwLock<Option<String>>,
    sign_in: Mutex<Option<SignInAttempt>>,
    token_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    catalog_fetch_lock: Arc<tokio::sync::Mutex<()>>,
    clients: Mutex<HashMap<String, ChatClient>>,
    file_index: Mutex<Option<FileIndex>>,
}

impl AppState {
    pub fn new(data_dir: &Path) -> AppResult<Self> {
        let db_path = data_dir.join("Orch.db");
        let token: TokenHandle = Arc::new(RwLock::new(None));
        let gateway = Arc::new(Gateway::new(token.clone())?);
        let memory = SqliteMemory::open(&db_path)?;

        let quick_projects_dir = data_dir.join("quick-projects");
        std::fs::create_dir_all(&quick_projects_dir)?;

        Ok(Self {
            token,
            workspace: Arc::new(RwLock::new(None)),
            data_dir: data_dir.to_path_buf(),
            gateway,
            catalog: RwLock::new(None),
            memory,
            runs: Mutex::new(HashMap::new()),
            dictation: Mutex::new(None),
            terminals: Arc::new(Mutex::new(HashMap::new())),
            command_manager: Arc::new(CommandManager::new()),
            connector_manager: Arc::new(ConnectorManager::new()),
            current_user_id: RwLock::new(None),
            sign_in: Mutex::new(None),
            token_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
            catalog_fetch_lock: Arc::new(tokio::sync::Mutex::new(())),
            clients: Mutex::new(HashMap::new()),
            file_index: Mutex::new(None),
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

    pub fn current_user_id(&self) -> Option<String> {
        self.current_user_id
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn reset_session_memory(&self) {
        self.set_token(None);
        *self.current_user_id.write().unwrap_or_else(|e| e.into_inner()) = None;
        *self.catalog.write().unwrap_or_else(|e| e.into_inner()) = None;
        self.clients.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    pub async fn sign_out(&self) {
        self.cancel_all_runs();
        self.reset_session_memory();
        auth::clear_tokens();
        auth::clear_cached_user(&self.data_dir);
        if let Err(error) = self.connector_manager.logout_all(&self.memory).await {
            eprintln!("[auth] connector sign-out failed: {error}");
        }
    }

    pub async fn complete_sign_in(&self, id_token: String, profile: &auth::UserProfile) {
        let previous = auth::load_cached_user(&self.data_dir).map(|p| p.id);
        if previous.as_deref().is_some_and(|id| id != profile.id) {
            if let Err(error) = self.connector_manager.logout_all(&self.memory).await {
                eprintln!("[auth] clearing previous account connectors failed: {error}");
            }
        }
        self.set_token(Some(id_token));
        self.set_authenticated_user(&profile.id);
        auth::save_cached_user(&self.data_dir, profile);
    }

    pub fn set_authenticated_user(&self, user_id: &str) {
        let changed = {
            let mut guard = self.current_user_id.write().unwrap_or_else(|e| e.into_inner());
            let changed = guard.as_deref() != Some(user_id);
            *guard = Some(user_id.to_string());
            changed
        };
        if changed {
            *self.catalog.write().unwrap_or_else(|e| e.into_inner()) = None;
        }
    }

    pub fn mark_sign_in_started(&self, session_id: Option<String>) {
        *self.sign_in.lock().unwrap_or_else(|e| e.into_inner()) = Some(SignInAttempt {
            started: Instant::now(),
            session_id,
        });
    }

    pub fn consume_sign_in_window(&self) -> Option<Option<String>> {
        let attempt = self.sign_in.lock().unwrap_or_else(|e| e.into_inner()).take()?;
        if attempt.started.elapsed().as_secs() <= config::SIGN_IN_WINDOW_SECS {
            Some(attempt.session_id)
        } else {
            None
        }
    }

    pub fn set_workspace(&self, path: Option<PathBuf>) {
        *self.workspace.write().unwrap_or_else(|e| e.into_inner()) = path;
        self.invalidate_file_index();
    }

    pub fn workspace(&self) -> Option<PathBuf> {
        self.workspace.read().ok().and_then(|g| g.clone())
    }

    pub fn require_workspace(&self) -> AppResult<PathBuf> {
        self.workspace().ok_or(AppError::NoWorkspace)
    }

    pub fn quick_projects_root(&self) -> PathBuf {
        self.data_dir.join("quick-projects")
    }

    pub fn quick_project_path(&self, id: &str, name: &str) -> PathBuf {
        self.quick_projects_root().join(format!("{id}-{name}"))
    }

    pub fn invalidate_file_index(&self) {
        *self.file_index.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub async fn file_index(&self, root: &Path) -> Result<Arc<Vec<FileEntry>>, String> {
        {
            let guard = self.file_index.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(index) = guard.as_ref() {
                if index.root == root
                    && index.built_at.elapsed() < Duration::from_secs(config::FILE_INDEX_TTL_SECS)
                {
                    return Ok(index.entries.clone());
                }
            }
        }
        let root_buf = root.to_path_buf();
        let entries = tokio::task::spawn_blocking(move || crate::fsapi::build_file_index(&root_buf))
            .await
            .map_err(|e| format!("file index task failed: {e}"))?;
        let entries = Arc::new(entries);
        *self.file_index.lock().unwrap_or_else(|e| e.into_inner()) = Some(FileIndex {
            root: root.to_path_buf(),
            built_at: Instant::now(),
            entries: entries.clone(),
        });
        Ok(entries)
    }

    pub fn chat_client(&self, provider: &str) -> AppResult<ChatClient> {
        let mut clients = self.clients.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(client) = clients.get(provider) {
            return Ok(client.clone());
        }
        let client = crate::llm::build_client(self.token.clone(), provider)?;
        clients.insert(provider.to_string(), client.clone());
        Ok(client)
    }

    pub async fn catalog(&self) -> AppResult<ModelCatalog> {
        if let Some(cat) = self.cached_catalog() {
            return Ok(cat);
        }
        let _fetch_guard = self.catalog_fetch_lock.lock().await;
        if let Some(cat) = self.cached_catalog() {
            return Ok(cat);
        }
        self.refresh_catalog().await
    }

    fn cached_catalog(&self) -> Option<ModelCatalog> {
        let guard = self.catalog.read().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().filter(|cat| !cat.is_empty()).cloned()
    }

    pub async fn refresh_catalog(&self) -> AppResult<ModelCatalog> {
        let fresh = self.gateway.models().await?;
        *self.catalog.write().unwrap_or_else(|e| e.into_inner()) = Some(fresh.clone());
        Ok(fresh)
    }

    fn token_is_fresh(token: &str) -> bool {
        match auth::jwt_expiry(token) {
            Some(exp) => exp - crate::util::now_secs() > config::TOKEN_REFRESH_SKEW_SECS,
            None => false,
        }
    }

    pub async fn ensure_fresh_token(&self) -> AppResult<()> {
        if self.access_token().is_some_and(|t| Self::token_is_fresh(&t)) {
            return Ok(());
        }

        let _guard = self.token_refresh_lock.lock().await;
        if self.access_token().is_some_and(|t| Self::token_is_fresh(&t)) {
            return Ok(());
        }

        let refresh_token = auth::load_refresh_token()?.ok_or(AppError::NoToken)?;
        let client = auth::FirebaseAuthClient::new();
        let session = client.refresh_session(&refresh_token).await?;
        if let Some(rt) = session.refresh_token.as_deref() {
            if rt != refresh_token {
                auth::save_refresh_token(rt)?;
            }
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
            let interval = Duration::from_secs(config::MODEL_CATALOG_REFRESH_INTERVAL_SECS);
            loop {
                tokio::time::sleep(interval).await;
                let state = catalog_app.state::<AppState>();
                if state.current_user_id().is_none() || !state.has_token() {
                    continue;
                }
                match state.refresh_catalog().await {
                    Ok(_) => {
                        let _ = catalog_app.emit("models-updated", ());
                    }
                    Err(e) => eprintln!("[models] background refresh failed: {e}"),
                }
            }
        });

        tauri::async_runtime::spawn(async move {
            let interval = Duration::from_secs(config::TOKEN_REFRESH_CHECK_INTERVAL_SECS);
            loop {
                tokio::time::sleep(interval).await;
                let state = app.state::<AppState>();
                if state.current_user_id().is_none() {
                    continue;
                }
                if let Err(e) = state.ensure_fresh_token().await {
                    if e.is_fatal_auth() {
                        state.sign_out().await;
                        let _ = app.emit(
                            "auth-changed",
                            serde_json::json!({ "user": null, "error": "Your session expired. Sign in again to continue." }),
                        );
                    } else {
                        eprintln!("[auth] token refresh failed (retryable): {e}");
                    }
                }
            }
        });
    }

    pub fn start_run(&self, session_id: &str, workspace: Option<PathBuf>) -> AppResult<(String, CancellationToken)> {
        let mut guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if guard.contains_key(session_id) {
            return Err(AppError::RunConflict);
        }
        let run_id = format!("{}-{}", session_id, uuid::Uuid::new_v4().simple());
        let cancel = CancellationToken::new();
        guard.insert(
            session_id.to_string(),
            RunHandle {
                run_id: run_id.clone(),
                cancel: cancel.clone(),
                workspace,
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
        let run_id = {
            let guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
            guard.get(session_id).map(|run| {
                run.cancel.cancel();
                run.run_id.clone()
            })
        };
        if let Some(run_id) = run_id {
            self.command_manager.kill_foreground_for_run(&run_id);
        }
    }

    pub fn cancel_runs_in_workspace(&self, workspace: &Path) -> Vec<String> {
        let targets: Vec<String> = {
            let guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
            guard
                .iter()
                .filter(|(_, run)| run.workspace.as_deref().is_some_and(|ws| ws.starts_with(workspace)))
                .map(|(session, _)| session.clone())
                .collect()
        };
        for session in &targets {
            self.cancel_run(session);
        }
        targets
    }

    pub fn cancel_all_runs(&self) {
        let sessions: Vec<String> = {
            let guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
            guard.keys().cloned().collect()
        };
        for session in sessions {
            self.cancel_run(&session);
        }
    }

    pub async fn wait_for_runs(&self, sessions: &[String], timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let active = {
                let guard = self.runs.lock().unwrap_or_else(|e| e.into_inner());
                sessions.iter().any(|s| guard.contains_key(s))
            };
            if !active || Instant::now() >= deadline {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    pub fn shutdown(&self) {
        {
            let runs = self.runs.lock().unwrap_or_else(|error| error.into_inner());
            for run in runs.values() {
                run.cancel.cancel();
            }
        }
        self.command_manager.kill_all();
        let mut guard = self.terminals.lock().unwrap_or_else(|e| e.into_inner());
        for (_, session) in guard.iter_mut() {
            session.kill();
        }
        guard.clear();
        if let Ok(mut dictation) = self.dictation.lock() {
            if let Some(handle) = dictation.take() {
                handle.cancel();
            }
        }
    }
}
