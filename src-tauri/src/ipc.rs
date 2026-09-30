use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Emitter, State};

use crate::auth::{self, UserDisplay};
use crate::dictation;
use crate::error::AppError;
use crate::events::{ChatEvent, DictationEvent, TerminalEvent};
use crate::gateway::{Budget, ModelInfo};
use crate::llm::{
    build_agent, build_user_message, maybe_compact, run_chat, AgentInputs, AttachmentRef,
    RunOutcome, RunRequest,
};
use crate::persistence::MessageView;
use crate::run_persistence::{BeginRun, RunCommitKind};
use crate::state::AppState;
use crate::terminal;
use crate::tools::ToolContext;

use rig::completion::Message;
use rig::memory::ConversationMemory;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetDto {
    pub cost_usd: f64,
    pub limit_usd: f64,
    pub remaining: f64,
    pub period: String,
    pub allowed: bool,
}

impl From<Budget> for BudgetDto {
    fn from(b: Budget) -> Self {
        Self {
            cost_usd: b.cost_usd,
            limit_usd: b.limit_usd,
            remaining: b.remaining,
            period: b.period,
            allowed: b.allowed,
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
        let target = dunce::canonicalize(&workspace).map_err(|e| format!("cannot resolve project: {e}"))?;
        if target == root || !target.starts_with(&root) {
            return Err("only quick projects created by Orch can be deleted".to_string());
        }
        let session_ids = state
            .memory
            .session_ids_for_workspace(&canonical)
            .await
            .map_err(|e| e.to_string())?;
        state.wait_for_runs(&session_ids, Duration::from_secs(5)).await;
        state
            .memory
            .delete_sessions_for_workspace(&canonical)
            .await
            .map_err(|e| e.to_string())?;
        tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&target))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("failed to delete quick project directory: {e}"))?;
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
pub async fn get_budget(state: State<'_, AppState>) -> Result<BudgetDto, String> {
    state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
    state
        .gateway
        .budget()
        .await
        .map(BudgetDto::from)
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

    let (budget, catalog) = tokio::join!(state.gateway.budget(), state.catalog());
    let budget = budget.map_err(|error| error.to_string())?;
    if !budget.allowed {
        return Err(format!(
            "Usage limit reached for this {}: {:.2} of {:.2} USD used",
            budget.period, budget.cost_usd, budget.limit_usd
        ));
    }
    let catalog = catalog.map_err(|error| error.to_string())?;
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

    let raw_prompt = durable_prompt_text(&prompt, &attachments);
    let initial_user_message = Message::user(raw_prompt.clone());
    match state
        .memory
        .begin_chat_run(BeginRun {
            run_id: &run_id,
            conversation_id: &session_id,
            model: &model,
            raw_prompt: &raw_prompt,
            initial_user_message: &initial_user_message,
            workspace_path: &workspace_string,
            user_id: &user_id,
        })
        .await
    {
        Ok(_) => {}
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            return Err(format!("failed to save the chat request: {error}"));
        }
    }
    let _ = app.emit("sessions-updated", ());

    if !state.memory.session_has_title(&session_id).await.unwrap_or(false) {
        spawn_title_generation(&app, &state, &session_id, &prompt);
    }

    let context_tokens = state.memory.session_context_tokens(&session_id).await.unwrap_or(0);
    match maybe_compact(&state.memory, &client, &model_info, &session_id, context_tokens, &cancel).await {
        Ok(Some(outcome)) => {
            let _ = on_event.send(ChatEvent::Compacted {
                original_message_count: outcome.original_message_count,
                ts: outcome.ts,
            });
        }
        Ok(None) => {}
        Err(error) => eprintln!("[chat] pre-run compaction failed: {error}"),
    }

    let built = build_user_message(
        Some(&workspace),
        &prompt,
        &attachments,
        model_info.supports_images(),
    )
    .await;
    if !built.notes.is_empty() {
        let _ = on_event.send(ChatEvent::Notice {
            message: built.notes.join("\n"),
        });
    }
    if let Err(error) = state
        .memory
        .update_chat_run_user_message(&run_id, &built.message)
        .await
    {
        return finish_accepted_chat_error(&app, &state, &session_id, &run_id, &on_event, error.to_string()).await;
    }

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
    let agent = build_agent(
        AgentInputs {
            client: &client,
            model: &model_info,
            tools: &tool_context,
            data_dir: &state.data_dir,
            workspace: Some(workspace.as_path()),
            enabled_connectors: &enabled_connectors,
        },
        state.memory.scoped_to_run(&run_id),
    );
    let base_seq = state.memory.max_seq(&session_id).await.unwrap_or(-1);

    let result = run_chat(
        agent,
        RunRequest {
            run_id: run_id.clone(),
            session_id: session_id.clone(),
            user_message: built.message,
        },
        cancel,
        on_event.clone(),
        state.gateway.clone(),
        state.memory.clone(),
    )
    .await;
    state.command_manager.kill_foreground_for_run(&run_id);

    let outcome = result.outcome.clone();
    let (status, terminal_error) = match &outcome {
        RunOutcome::Completed => ("completed", None),
        RunOutcome::Cancelled => ("cancelled", Some("cancelled by the user")),
        RunOutcome::Failed(message) => ("error", Some(message.as_str())),
    };
    let commit_kind = match state
        .memory
        .finalize_chat_run(&run_id, status, terminal_error)
        .await
    {
        Ok(kind) => kind,
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            let _ = app.emit("sessions-updated", ());
            let _ = on_event.send(ChatEvent::Error {
                message: format!("failed to save the chat history: {error}"),
            });
            return Ok(());
        }
    };

    if !result.reasoning_durations.is_empty() {
        if let Err(error) = state
            .memory
            .assign_reasoning_durations(&session_id, base_seq, result.reasoning_durations)
            .await
        {
            eprintln!("[chat] failed to persist reasoning durations: {error}");
        }
    }

    state.finish_run(&session_id, &run_id);
    let _ = app.emit("sessions-updated", ());
    let event = match outcome {
        RunOutcome::Completed => ChatEvent::Done,
        _ if commit_kind == RunCommitKind::Canonical => ChatEvent::Done,
        RunOutcome::Cancelled => ChatEvent::Cancelled,
        RunOutcome::Failed(message) => ChatEvent::Error { message },
    };
    let _ = on_event.send(event);
    Ok(())
}

fn durable_prompt_text(prompt: &str, attachments: &[AttachmentRef]) -> String {
    let mut text = prompt.trim().to_string();
    if !attachments.is_empty() {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str("[Attachments submitted: ");
        text.push_str(
            &attachments
                .iter()
                .map(|attachment| attachment.name.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        );
        text.push(']');
    }
    if text.is_empty() {
        "[Attachment-only user request]".to_string()
    } else {
        text
    }
}

async fn finish_accepted_chat_error(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    run_id: &str,
    on_event: &Channel<ChatEvent>,
    message: String,
) -> Result<(), String> {
    let displayed_message = match state
        .memory
        .finalize_chat_run(run_id, "error", Some(&message))
        .await
    {
        Ok(_) => message,
        Err(error) => format!("{message} (saving the chat history also failed: {error})"),
    };
    state.finish_run(session_id, run_id);
    let _ = app.emit("sessions-updated", ());
    let _ = on_event.send(ChatEvent::Error {
        message: displayed_message,
    });
    Ok(())
}

fn spawn_title_generation(app: &tauri::AppHandle, state: &AppState, session_id: &str, prompt: &str) {
    let gateway = state.gateway.clone();
    let memory = state.memory.clone();
    let session_id = session_id.to_string();
    let prompt = prompt.to_string();
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        let fallback = || {
            let first_line = prompt.trim().lines().next().unwrap_or("").trim().to_string();
            crate::util::truncate_chars(&first_line, 80).to_string()
        };
        let title = match gateway.generate_title(&prompt).await {
            Ok(t) if !t.trim().is_empty() => crate::util::truncate_chars(t.trim(), 120).to_string(),
            _ => fallback(),
        };
        if title.is_empty() {
            return;
        }
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
    state.cancel_run(&session_id);
    state
        .wait_for_runs(std::slice::from_ref(&session_id), Duration::from_secs(10))
        .await;
    state
        .memory
        .clear(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("sessions-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn get_session_view(state: State<'_, AppState>, session_id: String) -> Result<Vec<MessageView>, String> {
    state
        .memory
        .get_session_view(&session_id)
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
            .map(PathBuf::from)
            .unwrap_or_else(|| state.data_dir.clone())
    });
    let terminals = state.terminals.clone();
    let id_cleanup = id.clone();
    let session = tokio::task::spawn_blocking(move || {
        terminal::open(
            Path::new(&workspace),
            cols.max(1),
            rows.max(1),
            on_event,
            Box::new(move || {
                let mut guard = terminals.lock().unwrap_or_else(|e| e.into_inner());
                guard.remove(&id_cleanup);
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

use crate::document::ingest_document;
use crate::persistence::{DocumentRecord, SearchHit};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResultDto {
    pub document_id: String,
    pub title: String,
    pub file_type: String,
    pub passage_count: usize,
    pub word_count: usize,
    pub page_count: Option<usize>,
    pub was_update: bool,
}

#[tauri::command]
pub async fn ipc_ingest_document(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<IngestResultDto, String> {
    let resolved = dunce::canonicalize(PathBuf::from(&path)).map_err(|e| format!("cannot resolve path: {e}"))?;
    if !resolved.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let result = ingest_document(&resolved, &state.memory)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("documents-updated", ());

    Ok(IngestResultDto {
        document_id: result.document_id,
        title: result.title,
        file_type: result.file_type,
        passage_count: result.passage_count,
        word_count: result.word_count,
        page_count: result.page_count,
        was_update: result.was_update,
    })
}

#[tauri::command]
pub async fn ipc_list_documents(
    state: State<'_, AppState>,
    source: Option<String>,
    file_type: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<DocumentRecord>, String> {
    state
        .memory
        .list_documents(source, file_type, limit.unwrap_or(50).clamp(1, 500), offset.unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_get_document(state: State<'_, AppState>, document_id: String) -> Result<Option<DocumentRecord>, String> {
    state
        .memory
        .get_document(&document_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_delete_document(app: tauri::AppHandle, state: State<'_, AppState>, document_id: String) -> Result<(), String> {
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
    state
        .memory
        .search_documents(&query, limit.unwrap_or(20).clamp(1, 100))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_count_documents(state: State<'_, AppState>) -> Result<i64, String> {
    state.memory.count_documents().await.map_err(|e| e.to_string())
}
