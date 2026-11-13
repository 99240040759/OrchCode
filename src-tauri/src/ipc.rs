use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use orchharness::backend::local_fs::LocalWorkspaceOps;
use orchharness::backend::{SessionStore, SummarizerBackend, WebSearchBackend, WorkspaceOps};
use orchharness::connectors::CONNECTOR_DEFS;
use orchharness::error::AppError;
use orchharness::events::{ChatEvent, DictationEvent, EventSink, TerminalEvent};
use orchharness::skills::load_all_skills;
use orchharness::tools::ToolContext;
use orchharness::util::{http_client, truncate_chars};
use secrecy::ExposeSecret;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Emitter, Manager, State};

use crate::auth::{self, UserDisplay};
use crate::cloud::{self, CloudWorkspaceInfo};
use crate::config;
use crate::dictation;
use crate::gateway::{Budget, CloudAttachment, CloudChatStreamReq, ModelInfo};
use crate::llm::{
    build_agent, build_user_message, parse_thinking_effort, run_chat, AgentInputs, AttachmentRef,
    ChatRun, GatewaySummarizer, GatewayWebSearch, RunOutcome, RunParams,
};
use crate::persistence::SessionRecordPage;
use crate::state::AppState;
use crate::terminal;
use crate::workspace::Workspace;

struct TauriEventSink {
    channel: Channel<ChatEvent>,
    app: tauri::AppHandle,
}

impl EventSink for TauriEventSink {
    fn send(&self, event: ChatEvent) {
        if let ChatEvent::FileWritten { path } = &event {
            let state = self.app.state::<AppState>();
            state.invalidate_file_index();
            let _ = self
                .app
                .emit("file-written", serde_json::json!({ "path": path }));
        }
        let _ = self.channel.send(event);
    }
}

fn ensure_cloud_attachment_budget(total_bytes: usize) -> Result<(), String> {
    if total_bytes > config::CLOUD_MAX_ATTACHMENT_TOTAL_BYTES {
        return Err(format!(
            "Attachments exceed the {} MB limit",
            config::CLOUD_MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}

fn canonical_string(path: &str) -> String {
    if cloud::is_cloud_workspace(path) {
        return path.to_string();
    }
    dunce::canonicalize(PathBuf::from(path))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

fn ensure_owner(owner: Option<&str>, user_id: &str) -> Result<(), String> {
    match owner {
        Some(owner) if owner != user_id => {
            Err("session does not belong to the current user".to_string())
        }
        _ => Ok(()),
    }
}

#[derive(Serialize)]
pub struct ModelDto {
    pub key: String,
    #[serde(flatten)]
    pub info: ModelInfo,
}

impl ModelDto {
    fn from_entry(key: String, info: ModelInfo) -> Self {
        Self { key, info }
    }
}

async fn cached_display(state: &AppState) -> Option<UserDisplay> {
    let profile = auth::load_cached_user_async(state.data_dir.clone()).await?;
    state.set_authenticated_user(&profile.id);
    Some(UserDisplay::from_profile(&profile))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    version: String,
    release_url: String,
}

#[tauri::command]
pub async fn fetch_latest_release(app: tauri::AppHandle) -> Result<LatestRelease, String> {
    let manifest_url = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|cfg| cfg.get("endpoints"))
        .and_then(|endpoints| endpoints.get(0))
        .and_then(|endpoint| endpoint.as_str())
        .map(str::to_string)
        .ok_or_else(|| "No updater endpoint configured".to_string())?;
    let release_url = manifest_url
        .split("/download/")
        .next()
        .unwrap_or(&manifest_url)
        .to_string();

    let response = http_client()
        .get(&manifest_url)
        .header("Cache-Control", "no-cache")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Update manifest request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Update manifest request failed ({})", status.as_u16()));
    }
    let manifest: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Update manifest is not valid JSON: {e}"))?;
    let version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Update manifest did not include a version".to_string())?;
    Ok(LatestRelease { version, release_url })
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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
pub async fn set_workspace(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if cloud::is_cloud_workspace(trimmed)
        || trimmed.starts_with("https://github.com/")
        || trimmed.starts_with("https://gitlab.com/")
        || trimmed.starts_with("https://bitbucket.org/")
    {
        state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
        let info = state
            .gateway
            .cloud_init_workspace(trimmed)
            .await
            .map_err(|e| e.to_string())?;
        let ws = Workspace::from_cloud_info(info);
        let key = ws.key();
        state.set_workspace(Some(ws));
        return Ok(key);
    }

    let resolved = dunce::canonicalize(PathBuf::from(trimmed)).map_err(|e| format!("cannot resolve path: {e}"))?;
    if !resolved.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    let display = resolved.to_string_lossy().to_string();
    state.set_workspace(Some(Workspace::Local(resolved)));
    Ok(display)
}

#[tauri::command]
pub async fn init_cloud_workspace(
    state: State<'_, AppState>,
    repo_url: String,
) -> Result<CloudWorkspaceInfo, String> {
    state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
    let info = state
        .gateway
        .cloud_init_workspace(&repo_url)
        .await
        .map_err(|e| e.to_string())?;
    state.set_workspace(Some(Workspace::from_cloud_info(info.clone())));
    Ok(info)
}

#[tauri::command]
pub async fn list_sessions_for_workspace(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<Vec<crate::persistence::SessionSummary>, String> {
    let Some(user_id) = state.current_user_id() else {
        return Ok(Vec::new());
    };
    let canonical = canonical_string(&workspace_path);
    if cloud::is_cloud_workspace(&canonical) {
        state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
        return state
            .gateway
            .cloud_list_sessions(&canonical)
            .await
            .map_err(|e| e.to_string());
    }
    state
        .memory
        .list_sessions_for_workspace(&canonical, &user_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn forget_workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<(), String> {
    let canonical = canonical_string(&workspace_path);
    let workspace = PathBuf::from(&canonical);

    let was_active_workspace = state.workspace_key().as_deref() == Some(canonical.as_str());

    let sessions = state.cancel_runs_in_workspace(&workspace);
    state.wait_for_runs(&sessions, Duration::from_secs(10)).await;

    if was_active_workspace {
        state.set_workspace(None);
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
    if !orchharness::session::is_safe_session_id(&session_id) {
        return Err("invalid session id".to_string());
    }
    if model.trim().is_empty() {
        return Err("Select a model before sending a message".to_string());
    }
    if prompt.trim().is_empty() && attachments.is_empty() {
        return Err("a prompt or at least one attachment is required".to_string());
    }

    let current = state
        .current_workspace()
        .ok_or_else(|| "Open a workspace folder before starting a chat".to_string())?;
    let run_owner = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    let workspace_string = current.key();

    let (run_id, cancel) = state
        .start_run(&session_id, Some(PathBuf::from(&workspace_string)), run_owner.clone())
        .map_err(|error| error.to_string())?;

    let workspace = match current.as_ref() {
        Workspace::Local(path) => path.clone(),
        Workspace::Cloud(cloud_ws) => {
            state.ensure_fresh_token().await.map_err(|e| {
                state.finish_run(&session_id, &run_id);
                e.to_string()
            })?;

            let event_sink: Arc<dyn EventSink> = Arc::new(TauriEventSink {
                channel: on_event.clone(),
                app: app.clone(),
            });

            let mut cloud_attachments = Vec::with_capacity(attachments.len());
            let mut total_bytes = 0usize;
            for att in attachments {
                let data_base64 = match att.data_base64 {
                    Some(data) => Some(data),
                    None => match tokio::fs::metadata(&att.path).await {
                        Ok(meta) if meta.is_file() => {
                            if let Err(error) =
                                ensure_cloud_attachment_budget(total_bytes + meta.len() as usize)
                            {
                                state.finish_run(&session_id, &run_id);
                                return Err(error);
                            }
                            tokio::fs::read(&att.path)
                                .await
                                .ok()
                                .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes))
                        }
                        _ => None,
                    },
                };
                match data_base64 {
                    Some(data_base64) => {
                        total_bytes += data_base64.len() / 4 * 3;
                        if let Err(error) = ensure_cloud_attachment_budget(total_bytes) {
                            state.finish_run(&session_id, &run_id);
                            return Err(error);
                        }
                        cloud_attachments.push(CloudAttachment {
                            name: att.name,
                            data_base64,
                        });
                    }
                    None => {
                        let _ = on_event.send(ChatEvent::notice(format!(
                            "{} could not be read and was not attached",
                            att.name
                        )));
                    }
                }
            }

            let req = CloudChatStreamReq {
                session_id: session_id.clone(),
                prompt: prompt.clone(),
                model: model.clone(),
                workspace: workspace_string.clone(),
                repo_url: Some(cloud_ws.repo_url.clone()),
                attachments: cloud_attachments,
                active_connectors,
                thinking_effort,
            };

            let _ = app.emit("sessions-updated", ());
            let stream_res = state
                .gateway
                .cloud_stream_chat(&req, event_sink.clone(), cancel.clone())
                .await;

            state.finish_run(&session_id, &run_id);
            let _ = app.emit("sessions-updated", ());
            if let Err(error) = stream_res {
                let message = error.to_string();
                sentry::capture_message(&format!("cloud chat run failed: {message}"), sentry::Level::Error);
                let _ = on_event.send(ChatEvent::error(message));
                let _ = on_event.send(ChatEvent::Done);
            }
            return Ok(());
        }
    };

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

    let event_sink: Arc<dyn EventSink> = Arc::new(TauriEventSink {
        channel: on_event.clone(),
        app: app.clone(),
    });

    let stored_owner = state.memory.session_owner(&session_id).await.map_err(|e| e.to_string())?;
    if let Err(error) = ensure_owner(Some(stored_owner.as_deref().unwrap_or(run_owner.as_str())), &user_id) {
        state.finish_run(&session_id, &run_id);
        return Err(error);
    }

    let prepared = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("cancelled".to_string()),
        result = state.connector_manager.prepare(&active_connectors) => result.map_err(|error| error.to_string()),
    };
    let (connector_defs, connector_tools) = match prepared {
        Ok(c) => (c.defs, c.tools),
        Err(error) => {
            state.finish_run(&session_id, &run_id);
            sentry::capture_message(&format!("connectors prepare failed: {error}"), sentry::Level::Error);
            return Err(error);
        }
    };

    let ops: Arc<dyn WorkspaceOps> = Arc::new(LocalWorkspaceOps {
        workspace: Some(workspace.clone()),
        data_dir: state.data_dir.clone(),
        command_manager: (*state.command_manager).clone(),
    });

    let built = match build_user_message(
        &*ops,
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
        let _ = on_event.send(ChatEvent::notice(built.notes.join("\n")));
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

    let summarizer: Arc<dyn SummarizerBackend> = Arc::new(GatewaySummarizer {
        gateway: state.gateway.clone(),
    });
    let store: Arc<dyn SessionStore> = Arc::new(state.memory.clone());

    let chat = match ChatRun::begin(RunParams {
        session_id: &session_id,
        store,
        summarizer,
        event_sink: event_sink.clone(),
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

    let web_search: Arc<dyn WebSearchBackend> = Arc::new(GatewayWebSearch {
        gateway: state.gateway.clone(),
    });
    let tool_context = ToolContext {
        ops: ops.clone(),
        web_search,
        event_sink: event_sink.clone(),
        run_id: run_id.clone(),
        supports_images: model_info.supports_images(),
    };
    let skills = load_all_skills(state.data_dir.clone()).await;
    let agent = build_agent(AgentInputs {
        client: &client,
        model: &model_info,
        tools: &tool_context,
        workspace: Some(workspace_string.as_str()),
        environment_note: None,
        connectors: connector_defs,
        connector_tools,
        thinking_effort: parse_thinking_effort(&thinking_effort),
        skills,
    });

    let result = run_chat(agent, &chat, built.message.clone()).await;
    ops.cleanup_foreground_commands(&run_id).await;

    if let Err(error) = chat.finish(&built.message, &result).await {
        tracing::error!(error = %error, "failed to save conversation");
        sentry::capture_error(&error);
    }

    state.finish_run(&session_id, &run_id);
    let _ = app.emit("sessions-updated", ());
    let closing = match result.outcome {
        RunOutcome::Completed => vec![ChatEvent::Done],
        RunOutcome::Cancelled => vec![ChatEvent::Cancelled, ChatEvent::Done],
        RunOutcome::Failed(message) => {
            sentry::capture_message(&format!("chat run failed: {message}"), sentry::Level::Error);
            vec![ChatEvent::error(message), ChatEvent::Done]
        }
    };
    for event in closing {
        let _ = on_event.send(event);
    }
    Ok(())
}

#[tauri::command]
pub async fn resume_chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    if !orchharness::session::is_safe_session_id(&session_id) {
        return Err("invalid session id".to_string());
    }
    let current = state
        .current_workspace()
        .ok_or_else(|| "Open a workspace folder before resuming a chat".to_string())?;
    if current.cloud().is_none() {
        return Err("Only cloud sessions can be resumed".to_string());
    }
    let run_owner = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    let (run_id, cancel) = state
        .start_run(&session_id, Some(PathBuf::from(current.key())), run_owner)
        .map_err(|error| error.to_string())?;

    if let Err(error) = state.ensure_fresh_token().await {
        state.finish_run(&session_id, &run_id);
        return Err(error.to_string());
    }

    let event_sink: Arc<dyn EventSink> = Arc::new(TauriEventSink {
        channel: on_event.clone(),
        app: app.clone(),
    });
    let result = state
        .gateway
        .cloud_resume_chat(&session_id, event_sink, cancel)
        .await;

    state.finish_run(&session_id, &run_id);
    let _ = app.emit("sessions-updated", ());
    if let Err(error) = result {
        let _ = on_event.send(ChatEvent::error(error.to_string()));
        let _ = on_event.send(ChatEvent::Done);
    }
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
        let title = truncate_chars(title, 120).to_string();
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
    let mut owner = state
        .memory
        .session_owner(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    if owner.is_none() {
        owner = state.run_owner(&session_id);
    }
    ensure_owner(owner.as_deref(), &user_id)?;
    state.cancel_run(&session_id);
    if state.active_cloud_workspace().is_some() {
        let _ = state.gateway.cloud_cancel_chat(&session_id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_session(app: tauri::AppHandle, state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let user_id = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    let local_meta = state.memory.session_meta(&session_id).await.map_err(|e| e.to_string())?;
    let local_exists = local_meta.is_some();
    let local_owner = local_meta.flatten();
    ensure_owner(local_owner.as_deref(), &user_id)?;
    state.cancel_run(&session_id);
    state
        .wait_for_runs(std::slice::from_ref(&session_id), Duration::from_secs(10))
        .await;
    if local_exists {
        state
            .memory
            .delete_session(&session_id)
            .await
            .map_err(|e| {
                sentry::capture_error(&e);
                e.to_string()
            })?;
    }
    if state.active_cloud_workspace().is_some() || !local_exists {
        state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
        state
            .gateway
            .cloud_delete_session(&session_id)
            .await
            .map_err(|e| {
                sentry::capture_error(&e);
                e.to_string()
            })?;
    }
    let _ = app.emit("sessions-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn get_session_records(
    state: State<'_, AppState>,
    session_id: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> Result<SessionRecordPage, String> {
    let user_id = state
        .current_user_id()
        .ok_or_else(|| "authentication required".to_string())?;
    let local_meta = state.memory.session_meta(&session_id).await.map_err(|e| e.to_string())?;
    let local_exists = local_meta.is_some();
    let local_owner = local_meta.flatten();
    let is_cloud_active = state.active_cloud_workspace().is_some();
    let capped_limit = limit.unwrap_or(50).clamp(1, 200);

    if is_cloud_active {
        state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
        return state
            .gateway
            .cloud_session_history(&session_id, capped_limit, before_seq)
            .await
            .map_err(|e| e.to_string());
    }

    if !local_exists {
        state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
        if let Ok(page) = state
            .gateway
            .cloud_session_history(&session_id, capped_limit, before_seq)
            .await
        {
            if let Ok(info) = state.gateway.cloud_session_workspace(&session_id).await {
                state.set_workspace(Some(Workspace::from_cloud_info(info)));
            }
            return Ok(page);
        }
    }

    ensure_owner(local_owner.as_deref(), &user_id)?;
    state
        .memory
        .get_history(&session_id, capped_limit, before_seq)
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
    let _guard = state.prefs_save_lock.lock().await;
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
    let terminals = state.terminals.clone();
    let id_cleanup = id.clone();
    let instance_id = uuid::Uuid::new_v4();

    let session = if let Some(cloud) = state.active_cloud_workspace() {
        state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
        let token = state.gateway.require_token().map_err(|e| e.to_string())?;
        terminal::open_cloud(
            &cloud.workspace_uri,
            token,
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
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            e.to_string()
        })?
    } else {
        let workspace = state.workspace().unwrap_or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(PathBuf::from)
                .unwrap_or_else(|| state.data_dir.clone())
        });
        tokio::task::spawn_blocking(move || {
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
        })?
    };

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
pub async fn list_github_repos(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<crate::connectors::RepoInfo>, String> {
    state.ensure_fresh_token().await.map_err(|e| e.to_string())?;
    state.connector_manager.github_repos(&query).await.map_err(|e| {
        sentry::capture_error(&e);
        e.to_string()
    })
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
    let truncated = truncate_chars(&message, 2000);
    sentry::capture_message(truncated, sentry::Level::Error);
}
