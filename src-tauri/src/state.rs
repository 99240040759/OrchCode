use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use arc_swap::ArcSwapOption;
use dashmap::DashMap;
use moka::future::Cache;
use parking_lot::Mutex;
use secrecy::{ExposeSecret, SecretString};
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

pub type WorkspaceHandle = Arc<ArcSwapOption<PathBuf>>;

pub struct RunHandle {
    pub run_id: String,
    pub cancel: CancellationToken,
    pub workspace: Option<PathBuf>,
    pub owner_id: String,
}

struct SignInAttempt {
    started: Instant,
    session_id: Option<String>,
}

pub struct AppState {
    pub token: TokenHandle,
    pub workspace: WorkspaceHandle,
    pub data_dir: PathBuf,
    pub gateway: Arc<Gateway>,
    pub catalog: ArcSwapOption<ModelCatalog>,
    pub memory: SqliteMemory,
    pub runs: DashMap<String, RunHandle>,
    pub dictation: Mutex<Option<DictationHandle>>,
    pub terminals: Arc<Mutex<HashMap<String, crate::terminal::TerminalSession>>>,
    pub command_manager: Arc<CommandManager>,
    pub connector_manager: Arc<ConnectorManager>,
    current_user_id: ArcSwapOption<String>,
    sign_in: Mutex<Option<SignInAttempt>>,
    pub sign_in_lock: Arc<tokio::sync::Mutex<()>>,
    pub prefs_save_lock: Arc<tokio::sync::Mutex<()>>,
    last_callback: Mutex<Option<(String, Instant)>>,
    run_finished_notify: Arc<tokio::sync::Notify>,
    token_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    catalog_fetch_lock: Arc<tokio::sync::Mutex<()>>,
    client: Mutex<Option<ChatClient>>,
    file_cache: Cache<PathBuf, Arc<Vec<FileEntry>>>,
}

impl AppState {
    pub fn new(data_dir: &Path) -> AppResult<Self> {
        let db_path = data_dir.join("Orch.db");
        let token: TokenHandle = Arc::new(ArcSwapOption::empty());
        let gateway = Arc::new(Gateway::new(token.clone())?);
        let memory = SqliteMemory::open(&db_path)?;
        let connector_manager = Arc::new(ConnectorManager::new(token.clone()));

        let quick_projects_dir = data_dir.join("quick-projects");
        std::fs::create_dir_all(&quick_projects_dir)?;

        let file_cache = Cache::builder()
            .time_to_live(Duration::from_secs(config::FILE_INDEX_TTL_SECS))
            .build();

        Ok(Self {
            token,
            workspace: Arc::new(ArcSwapOption::empty()),
            data_dir: data_dir.to_path_buf(),
            gateway,
            catalog: ArcSwapOption::empty(),
            memory,
            runs: DashMap::new(),
            dictation: Mutex::new(None),
            terminals: Arc::new(Mutex::new(HashMap::new())),
            command_manager: Arc::new(CommandManager::new()),
            connector_manager,
            current_user_id: ArcSwapOption::empty(),
            sign_in: Mutex::new(None),
            sign_in_lock: Arc::new(tokio::sync::Mutex::new(())),
            prefs_save_lock: Arc::new(tokio::sync::Mutex::new(())),
            last_callback: Mutex::new(None),
            run_finished_notify: Arc::new(tokio::sync::Notify::new()),
            token_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
            catalog_fetch_lock: Arc::new(tokio::sync::Mutex::new(())),
            client: Mutex::new(None),
            file_cache,
        })
    }

    pub fn set_token(&self, token: Option<String>) {
        self.set_secret_token(token.filter(|t| !t.is_empty()).map(SecretString::from));
    }

    pub fn set_secret_token(&self, token: Option<SecretString>) {
        self.token.store(
            token
                .filter(|token| !token.expose_secret().is_empty())
                .map(Arc::new),
        );
    }

    pub fn access_token(&self) -> Option<SecretString> {
        self.token
            .load_full()
            .map(|token| token.as_ref().clone())
            .filter(|token| !token.expose_secret().is_empty())
    }

    pub fn has_token(&self) -> bool {
        self.token
            .load()
            .as_ref()
            .is_some_and(|token| !token.expose_secret().is_empty())
    }

    pub fn current_user_id(&self) -> Option<String> {
        self.current_user_id
            .load_full()
            .map(|id| id.as_ref().clone())
    }

    pub fn reset_session_memory(&self) {
        sentry::configure_scope(|scope| {
            scope.set_user(None);
        });
        sentry::add_breadcrumb(sentry::Breadcrumb {
            category: Some("auth".to_string()),
            message: Some("session memory reset".to_string()),
            level: sentry::Level::Info,
            ..Default::default()
        });
        self.set_token(None);
        self.current_user_id.store(None);
        self.catalog.store(None);
        *self.client.lock() = None;
    }

    pub async fn sign_out(&self) {
        sentry::configure_scope(|scope| {
            scope.set_user(None);
        });
        sentry::add_breadcrumb(sentry::Breadcrumb {
            category: Some("auth".to_string()),
            message: Some("user signed out".to_string()),
            level: sentry::Level::Info,
            ..Default::default()
        });
        self.cancel_all_runs();
        self.close_all_terminals();
        self.reset_session_memory();
        auth::clear_tokens_async().await;
        auth::clear_cached_user_async(self.data_dir.clone()).await;
    }

    pub async fn complete_sign_in(&self, id_token: SecretString, profile: &auth::UserProfile) {
        self.set_secret_token(Some(id_token));
        self.set_authenticated_user(&profile.id);
        auth::save_cached_user_async(self.data_dir.clone(), profile.clone()).await;
    }

    pub fn set_authenticated_user(&self, user_id: &str) {
        sentry::configure_scope(|scope| {
            scope.set_user(Some(sentry::User {
                id: Some(user_id.to_string()),
                ..Default::default()
            }));
        });
        sentry::add_breadcrumb(sentry::Breadcrumb {
            category: Some("auth".to_string()),
            message: Some("user authenticated".to_string()),
            level: sentry::Level::Info,
            ..Default::default()
        });
        let changed = self.current_user_id.load().as_deref().map(|id| id.as_str()) != Some(user_id);
        self.current_user_id.store(Some(Arc::new(user_id.to_string())));
        if changed {
            self.catalog.store(None);
        }
    }

    pub fn mark_sign_in_started(&self, session_id: Option<String>) {
        *self.sign_in.lock() = Some(SignInAttempt {
            started: Instant::now(),
            session_id,
        });
    }

    pub fn consume_sign_in_window(&self) -> Option<Option<String>> {
        let attempt = self.sign_in.lock().take()?;
        if attempt.started.elapsed().as_secs() <= config::SIGN_IN_WINDOW_SECS {
            Some(attempt.session_id)
        } else {
            None
        }
    }

    pub fn is_recent_auth_callback(&self, raw_url: &str) -> bool {
        let guard = self.last_callback.lock();
        if let Some((last_url, instant)) = guard.as_ref() {
            if last_url == raw_url && instant.elapsed().as_secs() < 30 {
                return true;
            }
        }
        false
    }

    pub fn mark_recent_auth_callback(&self, raw_url: &str) {
        let mut guard = self.last_callback.lock();
        *guard = Some((raw_url.to_string(), Instant::now()));
    }

    pub fn set_workspace(&self, path: Option<PathBuf>) {
        if self.workspace() != path {
            self.cancel_all_runs();
        }
        sentry::configure_scope(|scope| match &path {
            Some(p) => scope.set_tag("workspace", p.to_string_lossy().to_string()),
            None => scope.remove_tag("workspace"),
        });
        sentry::add_breadcrumb(sentry::Breadcrumb {
            category: Some("workspace".to_string()),
            message: Some(format!("workspace updated: {:?}", path.as_deref())),
            level: sentry::Level::Info,
            ..Default::default()
        });
        self.workspace.store(path.map(Arc::new));
        self.invalidate_file_index();
    }

    pub fn workspace(&self) -> Option<PathBuf> {
        self.workspace.load_full().map(|path| path.as_ref().clone())
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
        self.file_cache.invalidate_all();
    }

    pub async fn file_index(&self, root: &Path) -> Result<Arc<Vec<FileEntry>>, String> {
        let root_buf = root.to_path_buf();
        self.file_cache
            .try_get_with(root_buf.clone(), async {
                tokio::task::spawn_blocking(move || crate::fsapi::build_file_index(&root_buf))
                    .await
                    .map(Arc::new)
                    .map_err(|e| format!("file index task failed: {e}"))
            })
            .await
            .map_err(|e| e.to_string())
    }

    pub fn chat_client(&self) -> AppResult<ChatClient> {
        let mut slot = self.client.lock();
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = crate::llm::build_client(self.token.clone())?;
        *slot = Some(client.clone());
        Ok(client)
    }

    pub async fn catalog(&self) -> AppResult<Arc<ModelCatalog>> {
        if let Some(cat) = self.cached_catalog() {
            return Ok(cat);
        }
        let _fetch_guard = self.catalog_fetch_lock.lock().await;
        if let Some(cat) = self.cached_catalog() {
            return Ok(cat);
        }
        self.refresh_catalog().await
    }

    fn cached_catalog(&self) -> Option<Arc<ModelCatalog>> {
        self.catalog
            .load_full()
            .filter(|catalog| !catalog.is_empty())
    }

    pub async fn refresh_catalog(&self) -> AppResult<Arc<ModelCatalog>> {
        self.ensure_fresh_token().await?;
        let fresh = Arc::new(self.gateway.models().await?);
        self.catalog.store(Some(fresh.clone()));
        Ok(fresh)
    }

    fn token_is_fresh(token: &str) -> bool {
        match auth::jwt_expiry(token) {
            Some(exp) => exp.saturating_sub(crate::util::now_secs()) > config::TOKEN_REFRESH_SKEW_SECS,
            None => false,
        }
    }

    pub async fn ensure_fresh_token(&self) -> AppResult<()> {
        if self.access_token().is_some_and(|t| Self::token_is_fresh(t.expose_secret())) {
            return Ok(());
        }

        let _guard = self.token_refresh_lock.lock().await;
        if self.access_token().is_some_and(|t| Self::token_is_fresh(t.expose_secret())) {
            return Ok(());
        }

        let refresh_token = auth::load_refresh_token_async().await?.ok_or(AppError::NoToken)?;
        let client = auth::FirebaseAuthClient::new();
        let session = client.refresh_session(refresh_token.expose_secret()).await?;
        if let Some(rt) = session.refresh_token.as_ref() {
            if rt.expose_secret() != refresh_token.expose_secret() {
                auth::save_refresh_token_async(rt.expose_secret()).await?;
            }
        }
        self.set_secret_token(Some(session.access_token.clone()));
        if let Some(user) = session.user.as_ref() {
            self.set_authenticated_user(&user.id);
        } else if let Some(uid) = auth::jwt_user_id(session.access_token.expose_secret()) {
            self.set_authenticated_user(&uid);
        } else if let Some(cached) = auth::load_cached_user_async(self.data_dir.clone()).await {
            self.set_authenticated_user(&cached.id);
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
                    Err(e) => {
                        tracing::warn!(error = %e, "background model refresh failed");
                        sentry::capture_error(&e);
                    }
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
                        sentry::capture_error(&e);
                        state.sign_out().await;
                        let _ = app.emit(
                            "auth-changed",
                            serde_json::json!({ "user": null, "error": "Your session expired. Sign in again to continue." }),
                        );
                    } else {
                        tracing::warn!(error = %e, "token refresh failed and will be retried");
                        sentry::capture_error(&e);
                    }
                }
            }
        });
    }

    pub fn start_run(
        &self,
        session_id: &str,
        workspace: Option<PathBuf>,
        owner_id: String,
    ) -> AppResult<(String, CancellationToken)> {
        use dashmap::mapref::entry::Entry;
        let run_id = format!("{}-{}", session_id, uuid::Uuid::new_v4().simple());
        let cancel = CancellationToken::new();
        match self.runs.entry(session_id.to_string()) {
            Entry::Occupied(_) => return Err(AppError::RunConflict),
            Entry::Vacant(slot) => {
                slot.insert(RunHandle {
                    run_id: run_id.clone(),
                    cancel: cancel.clone(),
                    workspace,
                    owner_id,
                });
            }
        }
        sentry::add_breadcrumb(sentry::Breadcrumb {
            category: Some("chat".to_string()),
            message: Some(format!("started run {run_id} for session {session_id}")),
            level: sentry::Level::Info,
            ..Default::default()
        });
        Ok((run_id, cancel))
    }

    pub fn finish_run(&self, session_id: &str, run_id: &str) {
        if self.runs.remove_if(session_id, |_, r| r.run_id == run_id).is_some() {
            self.run_finished_notify.notify_waiters();
            sentry::add_breadcrumb(sentry::Breadcrumb {
                category: Some("chat".to_string()),
                message: Some(format!("finished run {run_id} for session {session_id}")),
                level: sentry::Level::Info,
                ..Default::default()
            });
        }
    }

    pub fn cancel_run(&self, session_id: &str) {
        let run_id = self.runs.get(session_id).map(|run| {
            run.cancel.cancel();
            run.run_id.clone()
        });
        if let Some(run_id) = run_id {
            self.command_manager.kill_for_run(&run_id);
        }
    }

    pub fn has_run(&self, session_id: &str) -> bool {
        self.runs.contains_key(session_id)
    }

    pub fn run_owner(&self, session_id: &str) -> Option<String> {
        self.runs.get(session_id).map(|run| run.owner_id.clone())
    }

    pub fn cancel_runs_matching(&self, predicate: impl Fn(&RunHandle) -> bool) -> Vec<String> {
        let targets: Vec<String> = self
            .runs
            .iter()
            .filter(|entry| predicate(entry.value()))
            .map(|entry| entry.key().clone())
            .collect();
        for session in &targets {
            self.cancel_run(session);
        }
        targets
    }

    pub fn cancel_runs_in_workspace(&self, workspace: &Path) -> Vec<String> {
        self.cancel_runs_matching(|run| run.workspace.as_deref().is_some_and(|ws| ws.starts_with(workspace)))
    }

    pub fn cancel_all_runs(&self) {
        self.cancel_runs_matching(|_| true);
    }

    pub async fn wait_for_runs(&self, sessions: &[String], timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let notified = self.run_finished_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let active = sessions.iter().any(|s| self.runs.contains_key(s));
            if !active {
                return;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return;
            }
            let _ = tokio::time::timeout(remaining, notified).await;
        }
    }

    pub fn close_all_terminals(&self) {
        let mut guard = self.terminals.lock();
        for session in guard.values_mut() {
            session.kill();
        }
        guard.clear();
    }

    pub fn shutdown(&self) {
        for entry in self.runs.iter() {
            entry.value().cancel.cancel();
        }
        self.command_manager.kill_all();
        self.close_all_terminals();
        if let Some(handle) = self.dictation.lock().take() {
            handle.cancel();
        }
    }
}
