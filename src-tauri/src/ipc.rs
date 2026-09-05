use std::path::PathBuf;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Emitter, State};

use crate::auth::{self, UserDisplay};
use crate::dictation;
use crate::events::{ChatEvent, DictationEvent, TerminalEvent};
use crate::gateway::{Budget, ModelInfo};
use crate::llm::{
    build_agent, build_client, build_user_message, maybe_compact, run_chat, AttachmentRef,
    RunOutcome, RunRequest,
};
use crate::persistence::MessageView;
use crate::run_persistence::RunCommitKind;
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

#[tauri::command]
pub async fn get_auth_user(state: State<'_, AppState>) -> Result<Option<UserDisplay>, String> {
    let client = auth::FirebaseAuthClient::new();

    if let Some(token) = state.access_token() {
        if let Ok(profile) = client.get_user(&token).await {
            state.set_authenticated_user(&profile.id);
            return Ok(Some(UserDisplay::from_profile(&profile)));
        }
    }

    let Some(refresh_token) = auth::load_refresh_token() else {
        state.clear_credentials();
        return Ok(None);
    };

    match client.refresh_session(&refresh_token).await {
        Ok(session) => {
            if let Some(rt) = session.refresh_token.as_deref() {
                auth::save_refresh_token(rt).map_err(|e| e.to_string())?;
            }
            state.set_token(Some(session.access_token.clone()));

            let profile = match session.user {
                Some(u) => u,
                None => client
                    .get_user(&session.access_token)
                    .await
                    .map_err(|e| e.to_string())?,
            };
            state.set_authenticated_user(&profile.id);
            Ok(Some(UserDisplay::from_profile(&profile)))
        }
        Err(e) => {
            if e.is_fatal_auth() {
                state.clear_credentials();
            }
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn get_oauth_url(
    state: State<'_, AppState>,
    redirect_to: Option<String>,
) -> Result<String, String> {
    state.mark_sign_in_started();
    let client = auth::FirebaseAuthClient::new();
    let target = redirect_to.unwrap_or_else(|| crate::config::AUTH_REDIRECT_URL.to_string());
    client
        .get_google_oauth_url(&target)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sign_out_auth(state: State<'_, AppState>) -> Result<(), String> {
    state.clear_credentials_full().await;
    Ok(())
}

#[tauri::command]
pub fn set_workspace(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let resolved = dunce::canonicalize(PathBuf::from(&path))
        .map_err(|e| format!("cannot resolve path: {e}"))?;
    if !resolved.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    state.set_workspace(resolved);
    Ok(())
}

#[tauri::command]
pub fn create_quick_project_dir(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<String, String> {
    if !is_safe_path_segment(&id) || !is_safe_path_segment(&name) {
        return Err("invalid quick project id or name".to_string());
    }
    let dir = state.quick_project_path(&id, &name);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create quick project dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_sessions_for_workspace(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<Vec<crate::persistence::SessionSummary>, String> {
    state
        .memory
        .list_sessions_for_workspace(&workspace_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_workspace_data(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_path: String,
    is_quick_project: bool,
) -> Result<(), String> {
    state
        .memory
        .delete_sessions_for_workspace(&workspace_path)
        .await
        .map_err(|e| e.to_string())?;

    if is_quick_project {
        let quick_projects_root = state.data_dir.join("quick-projects");
        let path = std::path::PathBuf::from(&workspace_path);
        if path.starts_with(&quick_projects_root) && path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("failed to delete quick project directory: {e}"))?;
        }
    }

    let _ = app.emit("sessions-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<Vec<ModelDto>, String> {
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
    state
        .gateway
        .budget()
        .await
        .map(BudgetDto::from)
        .map_err(|e| e.to_string())
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
        return Err("model key must not be empty".to_string());
    }
    if prompt.trim().is_empty() && attachments.is_empty() {
        return Err("a prompt or at least one attachment is required".to_string());
    }

    let workspace = state.workspace();
    let workspace_string = workspace
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let (run_id, cancel) = state.start_run(&session_id).map_err(|error| error.to_string())?;
    let raw_prompt = durable_prompt_text(&prompt, &attachments);
    let initial_user_message = Message::user(raw_prompt.clone());
    let baseline = match state
        .memory
        .begin_chat_run(
            &run_id,
            &session_id,
            &model,
            &raw_prompt,
            &initial_user_message,
            workspace_string.as_deref(),
        )
        .await
    {
        Ok(baseline) => baseline,
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            return Err(format!("failed to durably accept chat request: {error}"));
        }
    };

    let needs_title = !state
        .memory
        .session_has_title(&session_id)
        .await
        .unwrap_or(false);
    if needs_title {
        spawn_title_generation(&app, &state, &session_id, &prompt);
    }

    macro_rules! accepted_or_finish {
        ($result:expr) => {
            match $result {
                Ok(value) => value,
                Err(error) => {
                    return finish_accepted_chat_error(
                        &app,
                        &state,
                        &session_id,
                        &run_id,
                        &on_event,
                        error.to_string(),
                    )
                    .await
                }
            }
        };
    }

    accepted_or_finish!(state.ensure_fresh_token().await.map_err(|error| error.to_string()));
    let jwt = accepted_or_finish!(
        state
            .access_token()
            .ok_or_else(|| "not authenticated".to_string())
    );

    let budget = accepted_or_finish!(state.gateway.budget().await.map_err(|error| error.to_string()));
    if !budget.allowed {
        return finish_accepted_chat_error(
            &app,
            &state,
            &session_id,
            &run_id,
            &on_event,
            format!(
                "usage limit reached for this {}: {:.2} of {:.2} USD used",
                budget.period, budget.cost_usd, budget.limit_usd
            ),
        )
        .await;
    }

    let catalog = accepted_or_finish!(state.catalog().await.map_err(|error| error.to_string()));
    let model_info = accepted_or_finish!(
        catalog
            .resolve(&model)
            .cloned()
            .ok_or_else(|| format!("model not found: {model}"))
    );
    let client = accepted_or_finish!(build_client(&jwt, &model_info.provider).map_err(|error| error.to_string()));

    let user_message = build_user_message(
        workspace.as_deref(),
        &prompt,
        &attachments,
        model_info.supports_images(),
    )
    .await;
    accepted_or_finish!(
        state
            .memory
            .update_chat_run_user_message(&run_id, &user_message)
            .await
            .map_err(|error| error.to_string())
    );

    let tool_context = ToolContext {
        workspace: state.workspace.clone(),
        gateway: state.gateway.clone(),
        app_handle: app.clone(),
        command_manager: (*state.command_manager).clone(),
        data_dir: state.data_dir.clone(),
        memory: state.memory.clone(),
        connector_manager: state.connector_manager.clone(),
    };
    let enabled_connectors = state.connector_manager.enabled_ids();
    let agent = build_agent(
        &client,
        &model_info,
        &tool_context,
        state.memory.scoped_to_run(&run_id),
        &state.data_dir,
        workspace.as_deref(),
        &enabled_connectors,
    );
    let base_seq = state.memory.max_seq(&session_id).await.unwrap_or(-1);

    let result = run_chat(
        agent,
        RunRequest {
            run_id: run_id.clone(),
            session_id: session_id.clone(),
            user_message,
            prior_input_tokens: baseline.input_tokens,
            prior_output_tokens: baseline.output_tokens,
            prior_total_tokens: baseline.total_tokens,
        },
        cancel,
        on_event.clone(),
        state.gateway.clone(),
        state.memory.clone(),
    )
    .await;

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
            let message = format!("failed to finalize durable chat history: {error}");
            let _ = app.emit("sessions-updated", ());
            let _ = on_event.send(ChatEvent::Error { message });
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

    let completed = matches!(outcome, RunOutcome::Completed)
        || commit_kind == RunCommitKind::Canonical;
    if completed && commit_kind == RunCommitKind::Canonical {
        match maybe_compact(
            &state.memory,
            &client,
            &model_info,
            &session_id,
            result.last_turn_input_tokens,
        )
        .await
        {
            Ok(Some(outcome)) => {
                let _ = on_event.send(ChatEvent::Compacted {
                    original_message_count: outcome.original_message_count,
                    ts: outcome.ts,
                });
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("[chat] compaction failed after durable commit: {error}");
            }
        }
    }

    state.finish_run(&session_id, &run_id);
    let _ = app.emit("sessions-updated", ());
    if completed {
        let _ = on_event.send(ChatEvent::Done);
    } else {
        match outcome {
            RunOutcome::Cancelled => {
                let _ = on_event.send(ChatEvent::Cancelled);
            }
            RunOutcome::Failed(message) => {
                let _ = on_event.send(ChatEvent::Error { message });
            }
            RunOutcome::Completed => {
                let _ = on_event.send(ChatEvent::Done);
            }
        }
    }
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
        Err(error) => format!("{message} (durable finalization also failed: {error})"),
    };
    state.finish_run(session_id, run_id);
    let _ = app.emit("sessions-updated", ());
    let _ = on_event.send(ChatEvent::Error {
        message: displayed_message,
    });
    Ok(())
}

fn spawn_title_generation(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    prompt: &str,
) {
    let gateway = state.gateway.clone();
    let memory = state.memory.clone();
    let session_id = session_id.to_string();
    let prompt = prompt.to_string();
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        if memory
            .session_has_title(&session_id)
            .await
            .unwrap_or(false)
        {
            return;
        }
        let title = match gateway.generate_title(&prompt).await {
            Ok(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => prompt.trim().chars().take(80).collect::<String>(),
        };
        if title.is_empty() {
            return;
        }
        if memory.set_session_title(&session_id, &title).await.is_ok() {
            let _ = app.emit("sessions-updated", ());
        }
    });
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, AppState>, session_id: String) {
    state.cancel_run(&session_id);
}

#[tauri::command]
pub async fn clear_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.cancel_run(&session_id);
    state
        .memory
        .clear(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("sessions-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn get_session_view(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<MessageView>, String> {
    state
        .memory
        .get_session_view(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_user_pref(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("prefs.json").map_err(|e| e.to_string())?;
    Ok(store
        .get(&key)
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

#[tauri::command]
pub fn set_user_pref(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("prefs.json").map_err(|e| e.to_string())?;
    store.set(key, serde_json::Value::String(value));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_dictation(
    state: State<'_, AppState>,
    on_event: Channel<DictationEvent>,
) -> Result<(), String> {
    if !state.has_token() {
        return Err("not authenticated".to_string());
    }
    let mut guard = state.dictation.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = guard.take() {
        existing.stop();
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
pub fn terminal_open(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<(), String> {
    let workspace = state.workspace().unwrap_or_else(|| state.data_dir.clone());
    let terminals = state.terminals.clone();
    let id_cleanup = id.clone();
    let session = terminal::open(
        &workspace,
        cols.max(1),
        rows.max(1),
        on_event,
        Box::new(move || {
            let mut guard = terminals.lock().unwrap_or_else(|e| e.into_inner());
            guard.remove(&id_cleanup);
        }),
    )
    .map_err(|e| e.to_string())?;
    let mut guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut old) = guard.insert(id, session) {
        old.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let mut guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
    match guard.get_mut(&id) {
        Some(s) => {
            s.write(&data);
            Ok(())
        }
        None => Err(format!("no terminal session: {id}")),
    }
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
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
pub fn terminal_close(state: State<'_, AppState>, id: String) {
    let mut guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut session) = guard.remove(&id) {
        session.kill();
    }
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

fn connector_dto(
    def: &ConnectorDef,
    rec: Option<&ConnectorRecord>,
    has_token: bool,
) -> ConnectorDto {
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

    let dtos = CONNECTOR_DEFS
        .iter()
        .map(|def| {
            connector_dto(
                def,
                record_map.get(def.id).copied(),
                state.connector_manager.has_token(def.id),
            )
        })
        .collect();

    Ok(dtos)
}

#[tauri::command]
pub async fn get_connector_auth_url(
    state: State<'_, AppState>,
    connector_id: String,
) -> Result<String, String> {
    let def = connectors::find_def(&connector_id)
        .ok_or_else(|| format!("Connector not found: {connector_id}"))?;
    let state_param = state
        .connector_manager
        .begin_oauth(&connector_id)
        .map_err(|e| e.to_string())?;
    connectors::build_auth_url(def, &state_param).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete_connector_auth(
    state: State<'_, AppState>,
    connector_id: String,
    code: String,
    oauth_state: String,
) -> Result<ConnectorDto, String> {
    let def = connectors::find_def(&connector_id)
        .ok_or_else(|| format!("Connector not found: {connector_id}"))?;
    state
        .connector_manager
        .consume_oauth(&connector_id, &oauth_state)
        .map_err(|e| e.to_string())?;

    let redirect_uri = connectors::connector_redirect_uri(def.deep_link_id);
    let tokens = connectors::exchange_code(
        def,
        &code,
        &redirect_uri,
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
    Ok(connector_dto(
        def,
        rec,
        state.connector_manager.has_token(&connector_id),
    ))
}

#[tauri::command]
pub async fn disconnect_connector(
    state: State<'_, AppState>,
    connector_id: String,
) -> Result<(), String> {
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
pub async fn ipc_ingest_document(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<IngestResultDto, String> {
    let resolved = dunce::canonicalize(std::path::PathBuf::from(&path))
        .map_err(|e| format!("cannot resolve path: {e}"))?;
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
        .list_documents(source, file_type, limit.unwrap_or(50), offset.unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_get_document(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Option<DocumentRecord>, String> {
    state
        .memory
        .get_document(&document_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_delete_document(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<(), String> {
    let res = state
        .memory
        .delete_document(&document_id)
        .await
        .map_err(|e| e.to_string());
    if res.is_ok() {
        let _ = app.emit("documents-updated", ());
    }
    res
}

#[tauri::command]
pub async fn ipc_search_documents(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    state
        .memory
        .search_documents(&query, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipc_count_documents(state: State<'_, AppState>) -> Result<i64, String> {
    state.memory.count_documents().await.map_err(|e| e.to_string())
}
