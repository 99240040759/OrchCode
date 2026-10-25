use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
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

fn cached_display(state: &AppState) -> Option<UserDisplay> {
    let profile = auth::load_cached_user(&state.data_dir)?;
    state.set_authenticated_user(&profile.id);
    Some(UserDisplay::from_profile(&profile))
}

#[tauri::command]
pub async fn get_auth_user(state: State<'_, AppState>) -> Result<Option<UserDisplay>, String> {
    let client = auth::FirebaseAuthClient::new();

    if let Some(token) = state.access_token() {
        match client.get_user(&token).await {
            Ok(profile) => {
                state.set_authenticated_user(&profile.id);
                auth::save_cached_user(&state.data_dir, &profile);
                return Ok(Some(UserDisplay::from_profile(&profile)));
            }
            Err(error) if error.is_transient() => {
                if let Some(display) = cached_display(&state) {
                    return Ok(Some(display));
                }
            }
            Err(_) => {}
        }
    }

    let refresh_token = match auth::load_refresh_token() {
        Ok(Some(token)) => token,
        Ok(None) => {
            state.reset_session_memory();
            return Ok(None);
        }
        Err(error) => {
            return match cached_display(&state) {
                Some(display) => Ok(Some(display)),
                None => Err(format!("Could not access the system keychain: {error}")),
            };
        }
    };

    match client.refresh_session(&refresh_token).await {
        Ok(session) => {
            if let Some(rt) = session.refresh_token.as_deref() {
                if rt != refresh_token {
                    auth::save_refresh_token(rt).map_err(|e| e.to_string())?;
                }
            }
            state.set_token(Some(session.access_token.clone()));
            let profile = match session.user {
                Some(u) => u,
                None => match client.get_user(&session.access_token).await {
                    Ok(profile) => profile,
                    Err(error) if error.is_transient() => {
                        return Ok(cached_display(&state));
                    }
                    Err(error) => return Err(error.to_string()),
                },
            };
            state.set_authenticated_user(&profile.id);
            auth::save_cached_user(&state.data_dir, &profile);
            Ok(Some(UserDisplay::from_profile(&profile)))
        }
        Err(error) if error.is_fatal_auth() => {
            state.sign_out().await;
            Ok(None)
        }
        Err(error) => match cached_display(&state) {
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

    let sessions = state.cancel_runs_in_workspace(&workspace);
    state.wait_for_runs(&sessions, Duration::from_secs(10)).await;

    if state.workspace().as_deref() == Some(workspace.as_path()) {
        state.set_workspace(None);
    }

    if delete_project {
        let root = dunce::canonicalize(state.quick_projects_root()).map_err(|e| e.to_string())?;
        let session_ids = state
            .memory
            .session_ids_for_workspace(&canonical)
            .await
            .map_err(|e| e.to_string())?;
        state.wait_for_runs(&session_ids, Duration::from_secs(5)).await;
        for id in &session_ids {
            if let Err(error) = session::destroy(&state.data_dir, id).await {
                eprintln!("[sessions] could not delete the conversation of {id}: {error}");
            }
        }
        state
            .memory
            .delete_sessions_for_workspace(&canonical)
            .await
            .map_err(|e| e.to_string())?;

        if state.workspace().as_deref() == Some(workspace.as_path()) {
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
    let client = state
        .chat_client(&model_info.provider)
        .map_err(|error| error.to_string())?;
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
    let workspace_string = workspace.to_string_lossy().to_string();
    let (run_id, cancel) = state
        .start_run(&session_id, Some(workspace.clone()))
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
        memory: state.memory.clone(),
        connector_manager: state.connector_manager.clone(),
    };
    let enabled_connectors = state.connector_manager.enabled_ids();
    let agent = build_agent(AgentInputs {
        client: &client,
        model: &model_info,
        tools: &tool_context,
        data_dir: &state.data_dir,
        workspace: Some(workspace.as_path()),
        enabled_connectors: &enabled_connectors,
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
        eprintln!("[chat] failed to save the conversation: {error}");
    }
    if result.overflowed {
        let _ = state
            .memory
            .set_context_tokens(&session_id, config::COMPACTION_TRIGGER_TOKENS)
            .await;
    }

    state.finish_run(&session_id, &run_id);
    let _ = app.emit("sessions-updated", ());
    let event = match result.outcome {
        RunOutcome::Completed => ChatEvent::Done,
        RunOutcome::Cancelled => ChatEvent::Cancelled,
        RunOutcome::Failed(message) => ChatEvent::Error { message },
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
pub fn cancel_chat(state: State<'_, AppState>, session_id: String) {
    state.cancel_run(&session_id);
}

#[tauri::command]
pub async fn clear_session(app: tauri::AppHandle, state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(user_id) = state.current_user_id() {
        if let Some(owner) = state.memory.session_owner(&session_id).await.map_err(|e| e.to_string())? {
            if owner != user_id {
                return Err("session does not belong to the current user".to_string());
            }
        }
    }
    state.cancel_run(&session_id);
    state
        .wait_for_runs(std::slice::from_ref(&session_id), Duration::from_secs(10))
        .await;
    session::destroy(&state.data_dir, &session_id)
        .await
        .map_err(|e| e.to_string())?;
    state
        .memory
        .delete_session(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("sessions-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn get_session_messages_page(
    state: State<'_, AppState>,
    session_id: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> Result<SessionViewPage, String> {
    if let Some(user_id) = state.current_user_id() {
        if let Some(owner) = state.memory.session_owner(&session_id).await.map_err(|e| e.to_string())? {
            if owner != user_id {
                return Err("session does not belong to the current user".to_string());
            }
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
        before_seq,
    )
    .await
    .map_err(|e| e.to_string())
}

fn prefs_key(state: &AppState, key: &str, scoped: bool) -> String {
    match (scoped, state.current_user_id()) {
        (true, Some(user)) => format!("user:{user}:{key}"),
        _ => key.to_string(),
    }
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
    let full_key = prefs_key(&state, &key, scoped.unwrap_or(false));
    Ok(store
        .get(&full_key)
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

#[tauri::command]
pub fn set_user_pref(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: String,
    scoped: Option<bool>,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("prefs.json").map_err(|e| e.to_string())?;
    let full_key = prefs_key(&state, &key, scoped.unwrap_or(false));
    store.set(full_key, serde_json::Value::String(value));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_dictation(state: State<'_, AppState>, on_event: Channel<DictationEvent>) -> Result<(), String> {
    if !state.has_token() {
        return Err("not authenticated".to_string());
    }
    let mut guard = state.dictation.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = guard.take() {
        existing.cancel();
    }
    let handle = dictation::start(state.gateway.clone(), on_event).map_err(|e| e.to_string())?;
    *guard = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_dictation(state: State<'_, AppState>) -> Result<(), String> {
    let handle = state
        .dictation
        .lock()
        .unwrap_or_else(|e| e.into_inner())
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
                let mut guard = terminals.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(entry) = guard.get(&id_cleanup) {
                    if entry.instance_id() == exited_id {
                        guard.remove(&id_cleanup);
                    }
                }
            }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let previous = {
        let mut guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(id, session)
    };
    if let Some(mut old) = previous {
        old.kill();
    }
    Ok(())
}

#[tauri::command]
pub async fn terminal_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
    match guard.get(&id) {
        Some(s) if s.write(&data) => Ok(()),
        Some(_) => Err(format!("terminal session closed: {id}")),
        None => Err(format!("no terminal session: {id}")),
    }
}

#[tauri::command]
pub async fn terminal_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
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
        let mut guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
        guard.remove(&id)
    };
    if let Some(mut session) = session {
        session.kill();
    }
    Ok(())
}

use crate::connectors::{self, ConnectorDef, CONNECTOR_DEFS};
use crate::persistence::ConnectorRecord;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub auth_kind: String,
    pub is_configured: bool,
    pub has_token: bool,
    pub token_expires_at: Option<i64>,
    pub error: Option<String>,
}

fn connector_dto(def: &ConnectorDef, rec: Option<&ConnectorRecord>, has_token: bool) -> ConnectorDto {
    ConnectorDto {
        id: def.id.to_string(),
        name: def.name.to_string(),
        description: def.description.to_string(),
        category: def.category.to_string(),
        auth_kind: def.auth_kind.as_str().to_string(),
        is_configured: def.is_configured(),
        has_token,
        token_expires_at: rec.and_then(|r| r.token_expires_at),
        error: rec.and_then(|r| r.error.clone()),
    }
}

#[tauri::command]
pub async fn list_connectors(state: State<'_, AppState>) -> Result<Vec<ConnectorDto>, String> {
    let records = state
        .memory
        .list_connectors()
        .await
        .map_err(|e| e.to_string())?;
    let record_map: std::collections::HashMap<&str, &ConnectorRecord> =
        records.iter().map(|r| (r.id.as_str(), r)).collect();

    Ok(CONNECTOR_DEFS
        .iter()
        .map(|def| {
            connector_dto(
                def,
                record_map.get(def.id).copied(),
                state.connector_manager.has_token(def.id),
            )
        })
        .collect())
}

#[tauri::command]
pub async fn get_connector_auth_url(state: State<'_, AppState>, connector_id: String) -> Result<String, String> {
    let def = connectors::find_def(&connector_id).ok_or_else(|| format!("Connector not found: {connector_id}"))?;
    let (state_param, challenge) = state
        .connector_manager
        .begin_oauth(&connector_id)
        .map_err(|e| e.to_string())?;
    connectors::build_auth_url(def, &state_param, challenge.as_deref()).map_err(|e| e.to_string())
}

pub async fn complete_connector_auth(
    state: &AppState,
    connector_id: String,
    code: String,
    oauth_state: String,
) -> Result<ConnectorDto, String> {
    let def = connectors::find_def(&connector_id).ok_or_else(|| format!("Connector not found: {connector_id}"))?;
    let verifier = state
        .connector_manager
        .consume_oauth(&connector_id, &oauth_state)
        .map_err(|e| e.to_string())?;

    let redirect_uri = connectors::connector_redirect_uri(def.deep_link_id);
    let tokens = connectors::exchange_code(
        def,
        &code,
        &redirect_uri,
        verifier.as_deref(),
        state.connector_manager.http(),
    )
    .await
    .map_err(|e| e.to_string())?;

    state
        .connector_manager
        .store_tokens(&connector_id, &tokens, &state.memory)
        .await
        .map_err(|e| e.to_string())?;

    let records = state.memory.list_connectors().await.map_err(|e| e.to_string())?;
    let rec = records.iter().find(|r| r.id == connector_id);
    Ok(connector_dto(def, rec, state.connector_manager.has_token(&connector_id)))
}

#[tauri::command]
pub async fn disconnect_connector(state: State<'_, AppState>, connector_id: String) -> Result<(), String> {
    state
        .connector_manager
        .disconnect(&connector_id, &state.memory)
        .await
        .map_err(|e| e.to_string())
}

use crate::document::{ingest_document, IngestResult};
use crate::persistence::{DocumentRecord, SearchHit, SessionViewPage};

#[tauri::command]
pub async fn ipc_ingest_document(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<IngestResult, String> {
    if state.current_user_id().is_none() {
        return Err("authentication required to ingest documents".to_string());
    }
    let resolved = dunce::canonicalize(PathBuf::from(&path)).map_err(|e| format!("cannot resolve path: {e}"))?;
    if !resolved.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let ws = state.workspace();
    let result = ingest_document(&resolved, ws.as_deref(), &state.memory)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("documents-updated", ());

    Ok(result)
}

#[tauri::command]
pub async fn ipc_list_documents(
    state: State<'_, AppState>,
    source: Option<String>,
    file_type: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<DocumentRecord>, String> {
    if state.current_user_id().is_none() {
        return Err("authentication required".to_string());
    }
    let ws_str = state
        .workspace()
        .map(|w| dunce::canonicalize(&w).unwrap_or(w).to_string_lossy().into_owned());
    state
        .memory
        .list_documents(ws_str, source, file_type, limit.unwrap_or(50).clamp(1, 500), offset.unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_delete_document(app: tauri::AppHandle, state: State<'_, AppState>, document_id: String) -> Result<(), String> {
    if state.current_user_id().is_none() {
        return Err("authentication required".to_string());
    }
    state
        .memory
        .delete_document(&document_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("documents-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn ipc_search_documents(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    if state.current_user_id().is_none() {
        return Err("authentication required".to_string());
    }
    let ws_str = state
        .workspace()
        .map(|w| dunce::canonicalize(&w).unwrap_or(w).to_string_lossy().into_owned());
    state
        .memory
        .search_documents(&query, limit.unwrap_or(20).clamp(1, 100), ws_str)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_count_documents(state: State<'_, AppState>) -> Result<i64, String> {
    if state.current_user_id().is_none() {
        return Err("authentication required".to_string());
    }
    let ws_str = state
        .workspace()
        .map(|w| dunce::canonicalize(&w).unwrap_or(w).to_string_lossy().into_owned());
    state.memory.count_documents(ws_str).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn report_error(message: String) {
    if !cfg!(debug_assertions) {
        sentry::capture_message(&message, sentry::Level::Error);
    }
}
