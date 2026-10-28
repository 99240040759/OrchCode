use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use secrecy::ExposeSecret;
use tauri::ipc::Channel;
use tauri::{Emitter, State};

use crate::auth::{self, UserDisplay};
use crate::config;
use crate::dictation;
use crate::error::AppError;
use crate::events::{ChatEvent, DictationEvent, TerminalEvent};
use crate::gateway::{Budget, ModelInfo};
use crate::llm::{
    build_agent, build_user_message, run_chat, AgentInputs, AttachmentRef, ChatRun, RunOutcome,
    RunParams,
};
use crate::persistence::SessionViewPage;
use crate::session;
use crate::state::AppState;
use crate::terminal;
use crate::tools::ToolContext;

fn is_safe_path_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn canonical_string(path: &str) -> String {
    dunce::canonicalize(PathBuf::from(path))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDto {
    pub key: String,
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_window: u64,
    pub max_tokens: u64,
    pub capabilities: Vec<String>,
    pub badge: Option<String>,
}

impl ModelDto {
    fn from_entry(key: String, m: ModelInfo) -> Self {
        Self {
            key,
            id: m.id,
            name: m.name,
            provider: m.provider,
            context_window: m.context_window,
            max_tokens: m.max_tokens,
            capabilities: m.capabilities,
            badge: m.badge,
        }
    }
}

async fn cached_display(state: &AppState) -> Option<UserDisplay> {
    let profile = auth::load_cached_user_async(state.data_dir.clone()).await?;
    state.set_authenticated_user(&profile.id);
    Some(UserDisplay::from_profile(&profile))
}

#[tauri::command]
pub async fn get_auth_user(state: State<'_, AppState>) -> Result<Option<UserDisplay>, String> {
    let client = auth::FirebaseAuthClient::new();

    if let Some(token) = state.access_token() {
        match client.get_user(token.expose_secret()).await {
            Ok(profile) => {
                state.set_authenticated_user(&profile.id);
                auth::save_cached_user_async(state.data_dir.clone(), profile.clone()).await;
                return Ok(Some(UserDisplay::from_profile(&profile)));
            }
            Err(error) if error.is_transient() => {
                if let Some(display) = cached_display(&state).await {
                    return Ok(Some(display));
                }
            }
            Err(_) => {}
        }
    }

    let refresh_token = match auth::load_refresh_token_async().await {
        Ok(Some(token)) => token,
        Ok(None) => {
            state.reset_session_memory();
            return Ok(None);
        }
        Err(error) => {
            return match cached_display(&state).await {
                Some(display) => Ok(Some(display)),
                None => Err(format!("Could not access the system keychain: {error}")),
            };
        }
    };

    match client.refresh_session(refresh_token.expose_secret()).await {
        Ok(session) => {
            if let Some(rt) = session.refresh_token.as_ref() {
                if rt.expose_secret() != refresh_token.expose_secret() {
                    auth::save_refresh_token_async(rt.expose_secret()).await.map_err(|e| e.to_string())?;
                }
            }
            state.set_secret_token(Some(session.access_token.clone()));
            let profile = match session.user {
                Some(u) => u,
                None => match client.get_user(session.access_token.expose_secret()).await {
                    Ok(profile) => profile,
                    Err(error) if error.is_transient() => {
                        return Ok(cached_display(&state).await);
                    }
                    Err(error) => return Err(error.to_string()),
                },
            };
            state.set_authenticated_user(&profile.id);
            auth::save_cached_user_async(state.data_dir.clone(), profile.clone()).await;
            Ok(Some(UserDisplay::from_profile(&profile)))
        }
        Err(error) if error.is_fatal_auth() => {
            state.sign_out().await;
            Ok(None)
        }
        Err(error) => match cached_display(&state).await {
            Some(display) => Ok(Some(display)),
            None => Err(format!("Could not reach the sign-in service: {error}")),
        },
    }
}

#[tauri::command]
pub async fn get_oauth_url(state: State<'_, AppState>, redirect_to: Option<String>) -> Result<String, String> {
    let client = auth::FirebaseAuthClient::new();
    let target = redirect_to.unwrap_or_else(|| crate::config::AUTH_REDIRECT_URL.to_string());
    let start = client
        .get_google_oauth_url(&target)
        .await
        .map_err(|e| e.to_string())?;
    state.mark_sign_in_started(start.session_id);
    Ok(start.auth_uri)
}

#[tauri::command]
pub async fn sign_out_auth(state: State<'_, AppState>) -> Result<(), String> {
    state.sign_out().await;
    Ok(())
}

#[tauri::command]
pub fn set_workspace(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let resolved = dunce::canonicalize(PathBuf::from(&path)).map_err(|e| format!("cannot resolve path: {e}"))?;
    if !resolved.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    let display = resolved.to_string_lossy().to_string();
    state.set_workspace(Some(resolved));
    Ok(display)
}

#[tauri::command]
pub fn create_quick_project_dir(state: State<'_, AppState>, id: String, name: String) -> Result<String, String> {
    if !is_safe_path_segment(&id) || !is_safe_path_segment(&name) {
        return Err("invalid quick project id or name".to_string());
    }
    let dir = state.quick_project_path(&id, &name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create quick project dir: {e}"))?;
    let canonical = dunce::canonicalize(&dir).unwrap_or(dir);
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_sessions_for_workspace(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<Vec<crate::persistence::SessionSummary>, String> {
    let Some(user_id) = state.current_user_id() else {
        return Ok(Vec::new());
    };
    state
        .memory
        .list_sessions_for_workspace(&canonical_string(&workspace_path), &user_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn forget_workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_path: String,
    delete_project: bool,
) -> Result<(), String> {
    let canonical = canonical_string(&workspace_path);
    let workspace = PathBuf::from(&canonical);

    // Capture whether this is the active workspace before clearing it.
    let was_active_workspace = state.workspace().as_deref() == Some(workspace.as_path());

    let sessions = state.cancel_runs_in_workspace(&workspace);
    state.wait_for_runs(&sessions, Duration::from_secs(10)).await;

    if was_active_workspace {
        state.set_workspace(None);
    }

    if delete_project {
        let root = dunce::canonicalize(state.quick_projects_root()).map_err(|e| e.to_string())?;
        let user_id = state.current_user_id().unwrap_or_default();
        let session_ids = state
            .memory
            .session_ids_for_workspace(&canonical, &user_id)
            .await
            .map_err(|e| e.to_string())?;
        state.wait_for_runs(&session_ids, Duration::from_secs(5)).await;
        for id in &session_ids {
            if let Err(error) = session::destroy(&state.data_dir, id).await {
                tracing::error!(session_id = %id, error = %error, "could not delete conversation");
                sentry::capture_error(&error);
            }
        }
        state
            .memory
            .delete_sessions_for_workspace(&canonical, &user_id)
            .await
            .map_err(|e| e.to_string())?;

        // Close terminals in this workspace before attempting directory removal
        // (open PTYs lock the directory on Windows).
        if was_active_workspace {
            state.close_all_terminals();
        }

        if workspace.exists() {
            let target = dunce::canonicalize(&workspace).map_err(|e| format!("cannot resolve project: {e}"))?;
            if target == root || !target.starts_with(&root) {
                return Err("only quick projects created by Orch can be deleted".to_string());
            }
            tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&target))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| format!("failed to delete quick project directory: {e}"))?;
        }
    }

    let _ = app.emit("sessions-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>, force_refresh: Option<bool>) -> Result<Vec<ModelDto>, String> {
    let catalog = if force_refresh.unwrap_or(false) {
        state.refresh_catalog().await.map_err(|e| e.to_string())?
    } else {
        state.catalog().await.map_err(|e| e.to_string())?
    };
    Ok(catalog
        .list()
        .into_iter()
        .map(|(k, m)| ModelDto::from_entry(k, m))
        .collect())
}

#[tauri::command]
pub async fn get_budget(state: State<'_, AppState>) -> Result<Budget, String> {
    state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
    state
        .gateway
        .budget()
        .await
        .map_err(|e| e.to_string())
}

struct Preflight {
    model_info: ModelInfo,
    client: crate::llm::ChatClient,
    user_id: String,
}

async fn preflight(state: &AppState, model: &str) -> Result<Preflight, String> {
    state.ensure_fresh_token().await.map_err(|error| match error {
        AppError::NoToken => "You are signed out. Sign in again to continue.".to_string(),
        other => other.to_string(),
    })?;
    let user_id = state
        .current_user_id()
        .ok_or_else(|| "You are signed out. Sign in again to continue.".to_string())?;

    let catalog = state.catalog().await.map_err(|error| error.to_string())?;
    let model_info = catalog
        .resolve(model)
        .cloned()
        .ok_or_else(|| format!("Model not found: {model}. Pick another model and try again."))?;
    let client = state.chat_client().map_err(|error| error.to_string())?;
    Ok(Preflight {
        model_info,
        client,
        user_id,
    })
}

#[tauri::command]
pub async fn start_chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    model: String,
    prompt: String,
    attachments: Vec<AttachmentRef>,
    active_connectors: Vec<String>,
    thinking_effort: String,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("session id must not be empty".to_string());
    }
    if !session::is_safe_session_id(&session_id) {
        return Err("invalid session id".to_string());
    }
    if model.trim().is_empty() {
        return Err("Select a model before sending a message".to_string());
    }
    if prompt.trim().is_empty() && attachments.is_empty() {
        return Err("a prompt or at least one attachment is required".to_string());
    }

    let workspace = state
        .workspace()
        .ok_or_else(|| "Open a workspace folder before starting a chat".to_string())?;
    let run_owner = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    let workspace_string = workspace.to_string_lossy().to_string();
    let (run_id, cancel) = state
        .start_run(&session_id, Some(workspace.clone()), run_owner.clone())
        .map_err(|error| error.to_string())?;

    let ready = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("cancelled".to_string()),
        result = preflight(&state, &model) => result,
    };
    let Preflight {
        model_info,
        client,
        user_id,
    } = match ready {
        Ok(ready) => ready,
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            sentry::capture_message(&format!("chat preflight failed: {error}"), sentry::Level::Error);
            return Err(error);
        }
    };

    if let Some(owner) = state.memory.session_owner(&session_id).await.map_err(|e| e.to_string())? {
        if owner != user_id {
            state.finish_run(&session_id, &run_id);
            return Err("session does not belong to the current user".to_string());
        }
    } else if user_id != run_owner {
        state.finish_run(&session_id, &run_id);
        return Err("session does not belong to the current user".to_string());
    }

    let prepared = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("cancelled".to_string()),
        result = state.connector_manager.prepare(&active_connectors) => result.map_err(|error| error.to_string()),
    };
    let connectors = match prepared {
        Ok(connectors) => connectors,
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            sentry::capture_message(&format!("connectors prepare failed: {error}"), sentry::Level::Error);
            return Err(error);
        }
    };

    let built = match build_user_message(
        Some(&workspace),
        &prompt,
        &attachments,
        model_info.supports_images(),
    )
    .await
    {
        Ok(built) => built,
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            sentry::capture_message(&format!("build_user_message failed: {error}"), sentry::Level::Error);
            return Err(error);
        }
    };
    if !built.notes.is_empty() {
        let _ = on_event.send(ChatEvent::Notice {
            message: built.notes.join("\n"),
        });
    }

    if let Err(error) = state
        .memory
        .touch_session(&session_id, &workspace_string, &user_id)
        .await
    {
        state.finish_run(&session_id, &run_id);
        sentry::capture_error(&error);
        return Err(format!("failed to save the chat request: {error}"));
    }
    let _ = app.emit("sessions-updated", ());

    if !state.memory.session_has_title(&session_id).await.unwrap_or(false) {
        spawn_title_generation(&app, &state, &session_id, &prompt);
    }

    let chat = match ChatRun::begin(RunParams {
        data_dir: &state.data_dir,
        session_id: &session_id,
        gateway: state.gateway.clone(),
        memory: state.memory.clone(),
        channel: on_event.clone(),
        model: &model_info,
        cancel: cancel.clone(),
    })
    .await
    {
        Ok(chat) => chat,
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            sentry::capture_error(&error);
            return Err(format!("failed to open the conversation: {error}"));
        }
    };

    let tool_context = ToolContext {
        workspace: Some(workspace.clone()),
        run_id: run_id.clone(),
        gateway: state.gateway.clone(),
        app_handle: app.clone(),
        command_manager: (*state.command_manager).clone(),
        data_dir: state.data_dir.clone(),
        supports_images: model_info.supports_images(),
    };
    let agent = build_agent(AgentInputs {
        client: &client,
        model: &model_info,
        tools: &tool_context,
        data_dir: &state.data_dir,
        workspace: Some(workspace.as_path()),
        connectors: connectors.defs,
        connector_tools: connectors.tools,
        thinking_effort: match thinking_effort.as_str() {
            "medium" => rig::completion::Effort::Medium,
            "high" => rig::completion::Effort::High,
            _ => rig::completion::Effort::Low,
        },
    });

    let result = run_chat(
        agent,
        &chat,
        built.message.clone(),
        cancel.clone(),
        on_event.clone(),
    )
    .await;
    state.command_manager.kill_foreground_for_run(&run_id);

    if let Err(error) = chat.finish(&built.message, &result).await {
        tracing::error!(error = %error, "failed to save conversation");
        sentry::capture_error(&error);
    }
    if result.overflowed {
        let _ = state
            .memory
            .set_context_tokens(&session_id, config::compaction_trigger_tokens(model_info.context_window))
            .await;
    }

    state.finish_run(&session_id, &run_id);
    let _ = app.emit("sessions-updated", ());
    let event = match result.outcome {
        RunOutcome::Completed => ChatEvent::Done,
        RunOutcome::Cancelled => ChatEvent::Cancelled,
        RunOutcome::Failed(message) => {
            sentry::capture_message(&format!("chat run failed: {message}"), sentry::Level::Error);
            ChatEvent::Error { message }
        }
    };
    let _ = on_event.send(event);
    Ok(())
}

fn spawn_title_generation(app: &tauri::AppHandle, state: &AppState, session_id: &str, prompt: &str) {
    let gateway = state.gateway.clone();
    let memory = state.memory.clone();
    let session_id = session_id.to_string();
    let prompt = prompt.to_string();
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        let Ok(title) = gateway.generate_title(&prompt).await else {
            return;
        };
        let title = title.trim();
        if title.is_empty() {
            return;
        }
        let title = crate::util::truncate_chars(title, 120).to_string();
        if let Ok(true) = memory.set_session_title(&session_id, &title).await {
            let _ = app.emit("sessions-updated", ());
        }
    });
}

#[tauri::command]
pub async fn cancel_chat(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let user_id = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    let owner = state
        .memory
        .session_owner(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    let owner = owner.or_else(|| state.run_owner(&session_id));
    let owner = owner.ok_or_else(|| "session not found".to_string())?;
    if owner != user_id {
        return Err("session does not belong to the current user".to_string());
    }
    state.cancel_run(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn clear_session(app: tauri::AppHandle, state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let user_id = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    if let Some(owner) = state.memory.session_owner(&session_id).await.map_err(|e| e.to_string())? {
        if owner != user_id {
            return Err("session does not belong to the current user".to_string());
        }
    }
    state.cancel_run(&session_id);
    state
        .wait_for_runs(std::slice::from_ref(&session_id), Duration::from_secs(10))
        .await;
    session::destroy(&state.data_dir, &session_id)
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            e.to_string()
        })?;
    state
        .memory
        .delete_session(&session_id)
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            e.to_string()
        })?;
    let _ = app.emit("sessions-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn get_session_messages_page(
    state: State<'_, AppState>,
    session_id: String,
    limit: Option<usize>,
    before_message_id: Option<i64>,
) -> Result<SessionViewPage, String> {
    let user_id = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    if let Some(owner) = state.memory.session_owner(&session_id).await.map_err(|e| e.to_string())? {
        if owner != user_id {
            return Err("session does not belong to the current user".to_string());
        }
    }
    let durations = state
        .memory
        .reasoning_durations(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    session::view_page(
        &state.data_dir,
        &session_id,
        durations,
        limit.unwrap_or(50).clamp(1, 200),
        before_message_id,
    )
    .await
    .map_err(|e| e.to_string())
}

fn prefs_key(state: &AppState, key: &str, scoped: bool) -> Result<String, String> {
    if !scoped {
        if key.starts_with("user:") {
            return Err("user-scoped preference keys are reserved".to_string());
        }
        return Ok(key.to_string());
    }
    let user = state
        .current_user_id()
        .ok_or_else(|| "authentication required for scoped preference".to_string())?;
    Ok(format!("user:{user}:{key}"))
}

#[tauri::command]
pub fn get_user_pref(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    key: String,
    scoped: Option<bool>,
) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("prefs.json").map_err(|e| e.to_string())?;
    let full_key = prefs_key(&state, &key, scoped.unwrap_or(false))?;
    Ok(store
        .get(&full_key)
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

#[tauri::command]
pub async fn set_user_pref(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: String,
    scoped: Option<bool>,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("prefs.json").map_err(|e| e.to_string())?;
    let full_key = prefs_key(&state, &key, scoped.unwrap_or(false))?;
    store.set(full_key, serde_json::Value::String(value));
    tokio::task::spawn_blocking(move || store.save())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_dictation(state: State<'_, AppState>, on_event: Channel<DictationEvent>) -> Result<(), String> {
    if !state.has_token() {
        return Err("not authenticated".to_string());
    }
    let mut guard = state.dictation.lock();
    if let Some(existing) = guard.take() {
        existing.cancel();
    }
    let handle = dictation::start(state.gateway.clone(), on_event).map_err(|e| {
        sentry::capture_error(&e);
        e.to_string()
    })?;
    *guard = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_dictation(state: State<'_, AppState>) -> Result<(), String> {
    let handle = state
        .dictation
        .lock()
        .take();
    if let Some(h) = handle {
        h.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn terminal_open(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<(), String> {
    let workspace = state.workspace().unwrap_or_else(|| {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| state.data_dir.clone())
    });
    let terminals = state.terminals.clone();
    let id_cleanup = id.clone();
    let instance_id = uuid::Uuid::new_v4();
    let session = tokio::task::spawn_blocking(move || {
        terminal::open(
            Path::new(&workspace),
            cols.max(1),
            rows.max(1),
            on_event,
            instance_id,
            Box::new(move |exited_id| {
                let mut guard = terminals.lock();
                if let Some(entry) = guard.get(&id_cleanup) {
                    if entry.instance_id() == exited_id {
                        guard.remove(&id_cleanup);
                    }
                }
            }),
        )
    })
    .await
    .map_err(|e| {
        sentry::capture_message(&format!("terminal spawn task failed: {e}"), sentry::Level::Error);
        e.to_string()
    })?
    .map_err(|e| {
        sentry::capture_error(&e);
        e.to_string()
    })?;
    let previous = {
        let mut guard = state.terminals.lock();
        guard.insert(id, session)
    };
    if let Some(mut old) = previous {
        old.kill();
    }
    Ok(())
}

#[tauri::command]
pub async fn terminal_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let guard = state.terminals.lock();
    match guard.get(&id) {
        Some(s) if s.write(&data) => Ok(()),
        Some(_) => Err(format!("terminal session closed: {id}")),
        None => Err(format!("no terminal session: {id}")),
    }
}

#[tauri::command]
pub async fn terminal_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let guard = state.terminals.lock();
    match guard.get(&id) {
        Some(s) => {
            s.resize(cols.max(1), rows.max(1));
            Ok(())
        }
        None => Err(format!("no terminal session: {id}")),
    }
}

#[tauri::command]
pub async fn terminal_close(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let session = {
        let mut guard = state.terminals.lock();
        guard.remove(&id)
    };
    if let Some(mut session) = session {
        session.kill();
    }
    Ok(())
}

use crate::connectors::CONNECTOR_DEFS;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub connected: bool,
    pub tool_count: usize,
}

#[tauri::command]
pub async fn list_connectors(state: State<'_, AppState>) -> Result<Vec<ConnectorDto>, String> {
    state.ensure_fresh_token().await.map_err(|e| {
        sentry::capture_error(&e);
        e.to_string()
    })?;
    let connected = state
        .connector_manager
        .connected_ids()
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            e.to_string()
        })?;
    Ok(CONNECTOR_DEFS
        .iter()
        .map(|def| ConnectorDto {
            id: def.id.to_string(),
            name: def.name.to_string(),
            description: def.description.to_string(),
            category: def.category.to_string(),
            connected: connected.contains(&def.id),
            tool_count: def.actions.len(),
        })
        .collect())
}

#[tauri::command]
pub async fn get_connector_auth_url(state: State<'_, AppState>, connector_id: String) -> Result<String, String> {
    state.ensure_fresh_token().await.map_err(|e| {
        sentry::capture_error(&e);
        e.to_string()
    })?;
    state
        .connector_manager
        .begin_connect(&connector_id)
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            e.to_string()
        })
}

#[tauri::command]
pub async fn disconnect_connector(state: State<'_, AppState>, connector_id: String) -> Result<(), String> {
    state.ensure_fresh_token().await.map_err(|e| {
        sentry::capture_error(&e);
        e.to_string()
    })?;
    state
        .connector_manager
        .disconnect(&connector_id)
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            e.to_string()
        })
}

#[tauri::command]
pub fn report_error(message: String) {
    let truncated = crate::util::truncate_chars(&message, 2000);
    sentry::capture_message(truncated, sentry::Level::Error);
}
