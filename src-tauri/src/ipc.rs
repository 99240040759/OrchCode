use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::auth::{self, UserDisplay};
use crate::config;
use crate::dictation;
use crate::events::{ChatEvent, DictationEvent, TerminalEvent};
use crate::gateway::{Budget, ModelInfo};
use crate::llm::{build_agent, build_client, maybe_compact, run_chat, AttachmentRef};
use crate::persistence::{MessageView, SessionSummary};
use crate::state::AppState;
use crate::terminal;
use crate::tools::ToolContext;

use rig::memory::ConversationMemory;

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
    pub reasoning_effort: Option<String>,
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
            reasoning_effort: m.reasoning_effort,
        }
    }
}

#[tauri::command]
pub fn is_authenticated(state: State<'_, AppState>) -> bool {
    state.has_token()
}

#[tauri::command]
pub async fn get_auth_user(state: State<'_, AppState>) -> Result<Option<UserDisplay>, String> {
    let auth_client = auth::SupabaseAuthClient::new();
    let token = state.token.read().ok().and_then(|g| g.clone());

    if let Some(at) = token.filter(|t| !t.is_empty()) {
        match auth_client.get_user(&at).await {
            Ok(user) => {
                state.set_authenticated_user(&user.id);
                return Ok(Some(UserDisplay::from_profile(&user)));
            }
            Err(_) => {}
        }
    }

    if let Some(refresh_token) = auth::load_refresh_token() {
        match auth_client.refresh_session(&refresh_token).await {
            Ok(new_session) => {
                if let Some(rt) = new_session.refresh_token.as_deref().filter(|s| !s.is_empty()) {
                    auth::save_refresh_token(rt);
                }
                auth::save_access_token(&state.data_dir, &new_session.access_token);
                state.set_token(Some(new_session.access_token.clone()));

                let user = match new_session.user {
                    Some(u) => u,
                    None => auth_client.get_user(&new_session.access_token).await.map_err(|e| e.to_string())?,
                };
                state.set_authenticated_user(&user.id);
                return Ok(Some(UserDisplay::from_profile(&user)));
            }
            Err(_) => {
                state.clear_credentials();
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub fn get_oauth_url(redirect_to: Option<String>) -> String {
    let auth_client = auth::SupabaseAuthClient::new();
    let r = redirect_to.unwrap_or_else(|| "orchcode://auth-callback".to_string());
    auth_client.get_google_oauth_url(&r)
}

#[tauri::command]
pub async fn set_auth_session(state: State<'_, AppState>, access_token: String, refresh_token: Option<String>) -> Result<UserDisplay, String> {
    let auth_client = auth::SupabaseAuthClient::new();
    let user = auth_client.get_user(&access_token).await.map_err(|_| "invalid access token".to_string())?;

    if let Some(rt) = refresh_token.as_deref().filter(|s| !s.is_empty()) {
        auth::save_refresh_token(rt);
    }
    auth::save_access_token(&state.data_dir, &access_token);
    state.set_token(Some(access_token));
    state.set_authenticated_user(&user.id);

    Ok(UserDisplay::from_profile(&user))
}

#[tauri::command]
pub fn sign_out_auth(state: State<'_, AppState>) {
    state.clear_credentials();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub path: String,
    pub name: String,
    pub is_sandbox: bool,
}

fn workspace_info(state: &AppState) -> WorkspaceInfo {
    let path = state.workspace().unwrap_or_else(|| state.sandbox.clone());
    let is_sandbox = state.is_sandbox();
    let name = if is_sandbox {
        "Sandbox".to_string()
    } else {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string())
    };
    WorkspaceInfo { path: path.to_string_lossy().to_string(), name, is_sandbox }
}

#[tauri::command]
pub fn set_workspace(state: State<'_, AppState>, path: String) -> Result<WorkspaceInfo, String> {
    let p = dunce::canonicalize(PathBuf::from(&path)).map_err(|e| format!("cannot resolve path: {e}"))?;
    if !p.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    state.set_workspace(p);
    Ok(workspace_info(&state))
}

#[tauri::command]
pub fn get_workspace_info(state: State<'_, AppState>) -> WorkspaceInfo {
    workspace_info(&state)
}

#[tauri::command]
pub fn use_sandbox(state: State<'_, AppState>) -> WorkspaceInfo {
    state.use_sandbox();
    workspace_info(&state)
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>, force_refresh: Option<bool>) -> Result<Vec<ModelDto>, String> {
    let catalog = if force_refresh.unwrap_or(false) {
        state.refresh_catalog().await.map_err(|e| e.to_string())?
    } else {
        state.catalog().await.map_err(|e| e.to_string())?
    };
    Ok(catalog.list().into_iter().map(|(k, m)| ModelDto::from_entry(k, m)).collect())
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
pub async fn get_budget(state: State<'_, AppState>) -> Result<BudgetDto, String> {
    state.gateway.budget().await.map(BudgetDto::from).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    model: String,
    prompt: String,
    reasoning_effort: Option<String>,
    attachments: Vec<AttachmentRef>,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let jwt = state.token.read()
        .ok()
        .and_then(|g| g.clone())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "not authenticated".to_string())?;
    if model.is_empty() {
        return Err("model key must not be empty".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("prompt must not be empty".to_string());
    }

    let catalog = {
        let c = state.catalog().await.map_err(|e| e.to_string())?;
        if c.is_empty() {
            state.refresh_catalog().await.map_err(|e| e.to_string())?
        } else {
            c
        }
    };
    let mut model_info = catalog.resolve(&model).cloned().ok_or_else(|| format!("model not found: {model}"))?;
    if let Some(effort) = reasoning_effort.filter(|e| !e.is_empty()) {
        model_info.reasoning_effort = Some(effort);
    }
    let supports_images = model_info.supports_images();

    let (run_id, cancel) = state.start_run(&session_id).map_err(|e| e.to_string())?;
    let workspace_snapshot: Option<Arc<PathBuf>> = state.snapshot_workspace().map(Arc::new);
    let ws_str = workspace_snapshot.as_ref().map(|p| p.to_string_lossy().to_string());
    let _ = state.memory.set_session_workspace(&session_id, ws_str.as_deref()).await;

    let is_new_session = !state.memory.session_has_title(&session_id).await.unwrap_or(false);

    let ctx = ToolContext {
        workspace: state.workspace.clone(),
        gateway: state.gateway.clone(),
        app_handle: Some(app.clone()),
        command_manager: (*state.command_manager).clone(),
        browser_requests: state.browser_requests.clone(),
        data_dir: Some(state.data_dir.clone()),
    };
    let memory = state.memory.clone();
    let client = build_client(&jwt).map_err(|e| e.to_string())?;
    let agent = build_agent(&client, &model_info, &ctx, memory, Some(&state.data_dir), workspace_snapshot.as_deref().map(|p| p.as_path()));

    if is_new_session {
        let gateway_clone = state.gateway.clone();
        let memory_clone = state.memory.clone();
        let sid = session_id.clone();
        let p = prompt.clone();
        let app_handle = app.clone();
        tokio::spawn(async move {
            if memory_clone.session_has_title(&sid).await.unwrap_or(false) {
                return;
            }
            let title = match gateway_clone.generate_title(&p).await {
                Ok(t) if !t.trim().is_empty() => t.trim().to_string(),
                _ => p.trim().chars().take(80).collect::<String>(),
            };
            if !title.is_empty() && memory_clone.set_session_title(&sid, &title).await.is_ok() {
                use tauri::Emitter;
                let _ = app_handle.emit("sessions-updated", ());
            }
        });
    }

    let outcome = run_chat(
        agent,
        session_id.clone(),
        prompt,
        attachments,
        supports_images,
        config::DEFAULT_MAX_TURNS,
        config::DEFAULT_TOOL_CONCURRENCY,
        cancel,
        workspace_snapshot,
        state.memory.clone(),
        on_event.clone(),
    ).await;

    if let Some(outcome) = outcome {
        let _ = state.memory.update_session_tokens(
            &session_id,
            outcome.input_tokens,
            outcome.output_tokens,
            outcome.total_tokens,
        ).await;

        match maybe_compact(&state.memory, &client, &model_info, &session_id, outcome.total_tokens).await {
            Ok(Some(result)) => {
                let _ = on_event.send(ChatEvent::Compacted {
                    original_message_count: result.original_message_count,
                    ts: result.ts,
                });
            }
            Ok(None) => {}
            Err(e) => {
                eprintln!("[compaction] failed for session {session_id}: {e}");
            }
        }
    }

    state.finish_run(&session_id, &run_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, AppState>, session_id: String) {
    state.cancel_run(&session_id);
}

#[tauri::command]
pub async fn clear_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.cancel_run(&session_id);
    state.memory.clear(&session_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionSummary>, String> {
    state.memory.list_sessions().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_session_view(state: State<'_, AppState>, session_id: String) -> Result<Vec<MessageView>, String> {
    let ws = state.workspace();
    state.memory.get_session_view(&session_id, ws.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_user_pref(app: tauri::AppHandle, key: String) -> Option<serde_json::Value> {
    use tauri_plugin_store::StoreExt;
    app.store("prefs.json").ok().and_then(|s| s.get(&key))
}

#[tauri::command]
pub fn set_user_pref(app: tauri::AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("prefs.json").map_err(|e| e.to_string())?;
    store.set(key, value);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_dictation(state: State<'_, AppState>, on_event: Channel<DictationEvent>) -> Result<(), String> {
    if !state.has_token() {
        return Err("not authenticated".to_string());
    }
    let mut guard = state.dictation.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return Err("dictation is already active".to_string());
    }
    let handle = dictation::start(state.gateway.clone(), on_event).map_err(|e| e.to_string())?;
    *guard = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_dictation(state: State<'_, AppState>) -> Result<(), String> {
    let handle = state.dictation.lock().unwrap_or_else(|e| e.into_inner()).take();
    match handle {
        Some(h) => { h.stop(); Ok(()) }
        None => Err("dictation is not active".to_string()),
    }
}

#[tauri::command]
pub fn terminal_open(
    state: State<'_, AppState>,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<(), String> {
    let workspace = state.workspace().unwrap_or_else(|| state.sandbox.clone());
    let dir = match cwd.as_deref() {
        Some(c) if !c.is_empty() => {
            let candidate = dunce::canonicalize(PathBuf::from(c)).map_err(|e| format!("invalid cwd: {e}"))?;
            if !candidate.starts_with(&workspace) && !candidate.starts_with(&state.sandbox) {
                return Err(format!("cwd is outside workspace: {c}"));
            }
            candidate
        }
        _ => workspace,
    };
    let session = terminal::open(&dir, cols.max(1), rows.max(1), on_event).map_err(|e| e.to_string())?;
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
        Some(s) => { s.write(&data); Ok(()) }
        None => Err(format!("no terminal session: {id}")),
    }
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
    match guard.get(&id) {
        Some(s) => { s.resize(cols.max(1), rows.max(1)); Ok(()) }
        None => Err(format!("no terminal session: {id}")),
    }
}

#[tauri::command]
pub fn terminal_close(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut guard = state.terminals.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut s) = guard.remove(&id) {
        s.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn webview_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    use tauri::Manager;
    if !label.starts_with("browser-") {
        return Err(format!("webview_navigate only permitted for browser-* labels, got: {label}"));
    }
    let parsed: tauri::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("only http:// and https:// URLs are permitted".to_string());
    }
    let webview = app.webviews().get(&label).cloned().ok_or_else(|| format!("webview not found: {label}"))?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn webview_history(app: tauri::AppHandle, label: String, action: String) -> Result<(), String> {
    use tauri::Manager;
    if !label.starts_with("browser-") {
        return Err(format!("webview_history only permitted for browser-* labels, got: {label}"));
    }
    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        other => return Err(format!("unknown history action: {other}")),
    };
    let webview = app.webviews().get(&label).cloned().ok_or_else(|| format!("webview not found: {label}"))?;
    webview.eval(script).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn deliver_browser_content(state: State<'_, AppState>, request_id: String, text: String) -> Result<(), String> {
    state.fulfill_browser_request(&request_id, text).map_err(|e| e.to_string())
}
