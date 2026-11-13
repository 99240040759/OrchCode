use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use orchharness::backend::{TavilyRequest, TavilyResponse};
use orchharness::error::{AppError, AppResult};
use orchharness::events::{ChatEvent, EventSink};
pub use orchharness::models::ModelInfo;
pub use orchharness::persistence::{
    Budget, CloudAttachment, CloudChatStreamReq, CloudWorkspaceInfo, SessionRecordPage,
    SessionSummary,
};
use orchharness::tools::{REPLACE_FILE_CONTENT, WRITE_TO_FILE};
use secrecy::{ExposeSecret, SecretString};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::config;

pub type TokenHandle = Arc<arc_swap::ArcSwapOption<SecretString>>;

#[derive(Debug, Clone, Default)]
pub struct ModelCatalog {
    entries: HashMap<String, ModelInfo>,
    sorted_list: Vec<(String, ModelInfo)>,
}

impl ModelCatalog {
    pub fn from_list(models: Vec<ModelInfo>) -> Self {
        let entries: HashMap<String, ModelInfo> = models
            .into_iter()
            .map(|model| (model.id.clone(), model))
            .collect();
        let mut sorted_list: Vec<(String, ModelInfo)> = entries
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        sorted_list.sort_by(|a, b| a.1.name.cmp(&b.1.name).then_with(|| a.0.cmp(&b.0)));
        Self { entries, sorted_list }
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn resolve(&self, key: &str) -> Option<&ModelInfo> {
        self.entries
            .get(key)
            .or_else(|| self.entries.values().find(|v| v.id == key))
    }

    pub fn list(&self) -> Vec<(String, ModelInfo)> {
        self.sorted_list.clone()
    }
}

#[derive(Clone)]
pub struct Gateway {
    http: reqwest_middleware::ClientWithMiddleware,
    streaming_http: reqwest::Client,
    token: TokenHandle,
}

impl Gateway {
    pub fn new(token: TokenHandle) -> AppResult<Self> {
        Ok(Self {
            http: orchharness::util::retry_http_client(),
            streaming_http: orchharness::util::streaming_http_client(),
            token,
        })
    }

    pub fn require_token(&self) -> AppResult<SecretString> {
        self.token
            .load_full()
            .filter(|token| !token.expose_secret().is_empty())
            .map(|token| token.as_ref().clone())
            .ok_or(AppError::NoToken)
    }

    async fn get<T: DeserializeOwned>(&self, url: &str, timeout: Duration) -> AppResult<T> {
        let token = self.require_token()?;
        let resp = self
            .http
            .get(url)
            .bearer_auth(token.expose_secret())
            .timeout(timeout)
            .send()
            .await?;
        Ok(check_status(resp).await?.json().await?)
    }

    async fn post<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
        timeout: Duration,
    ) -> AppResult<T> {
        let token = self.require_token()?;
        let resp = self
            .http
            .post(url)
            .bearer_auth(token.expose_secret())
            .timeout(timeout)
            .json(body)
            .send()
            .await?;
        Ok(check_status(resp).await?.json().await?)
    }

    pub async fn models(&self) -> AppResult<ModelCatalog> {
        let models: Vec<ModelInfo> =
            self.get(config::models_url(), Duration::from_secs(20)).await?;
        Ok(ModelCatalog::from_list(models))
    }

    pub async fn cloud_models(&self) -> AppResult<ModelCatalog> {
        let models: Vec<ModelInfo> = self
            .get(&config::cloud_url("/models"), Duration::from_secs(20))
            .await?;
        Ok(ModelCatalog::from_list(models))
    }

    pub async fn budget(&self) -> AppResult<Budget> {
        self.get(config::budget_url(), Duration::from_secs(15)).await
    }

    pub async fn transcribe(&self, audio_base64: &str, format: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct Resp {
            text: String,
        }
        let resp: Resp = self
            .post(
                config::transcribe_url(),
                &json!({ "audio": audio_base64, "format": format }),
                Duration::from_secs(300),
            )
            .await?;
        Ok(resp.text)
    }

    pub async fn tavily(&self, req: &TavilyRequest) -> AppResult<TavilyResponse> {
        self.post(config::tavily_url(), req, Duration::from_secs(30)).await
    }

    pub async fn generate_title(&self, prompt: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct Resp {
            title: String,
        }
        let resp: Resp = self
            .post(
                config::title_url(),
                &json!({ "prompt": prompt }),
                Duration::from_secs(20),
            )
            .await?;
        Ok(resp.title)
    }

    pub async fn summarize(&self, system: &str, prompt: &str, max_tokens: u64) -> AppResult<String> {
        #[derive(Deserialize)]
        struct Resp {
            text: String,
        }
        let resp: Resp = self
            .post(
                config::summarize_url(),
                &json!({ "system": system, "prompt": prompt, "maxTokens": max_tokens }),
                Duration::from_secs(config::SUMMARY_REQUEST_TIMEOUT_SECS),
            )
            .await?;
        Ok(resp.text)
    }

    pub async fn cloud_init_workspace(&self, repo_url: &str) -> AppResult<CloudWorkspaceInfo> {
        let url = config::cloud_url("/workspace/init");
        self.post(&url, &json!({ "repoUrl": repo_url }), Duration::from_secs(60))
            .await
    }

    fn cloud_files_url(sub: &str, workspace: &str, extra: &[(&str, String)]) -> String {
        let base = config::cloud_url(&format!("/files/{sub}"));
        let mut params: Vec<(&str, String)> = vec![("workspace", workspace.to_string())];
        params.extend(extra.iter().map(|(k, v)| (*k, v.clone())));
        reqwest::Url::parse_with_params(&base, &params)
            .map(|u| u.to_string())
            .unwrap_or(base)
    }

    pub async fn cloud_files_json<T: DeserializeOwned>(
        &self,
        sub: &str,
        workspace: &str,
        extra: &[(&str, String)],
    ) -> AppResult<T> {
        let url = Self::cloud_files_url(sub, workspace, extra);
        self.get(&url, Duration::from_secs(60)).await
    }

    pub async fn cloud_file_bytes(&self, workspace: &str, path: &str) -> AppResult<Vec<u8>> {
        let token = self.require_token()?;
        let url = Self::cloud_files_url("binary", workspace, &[("path", path.to_string())]);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token.expose_secret())
            .timeout(Duration::from_secs(120))
            .send()
            .await?;
        Ok(check_status(resp).await?.bytes().await?.to_vec())
    }

    pub async fn cloud_session_workspace(&self, session_id: &str) -> AppResult<CloudWorkspaceInfo> {
        let url = config::cloud_url(&format!("/sessions/{session_id}/workspace"));
        self.get(&url, Duration::from_secs(60)).await
    }

    pub async fn cloud_list_sessions(&self, workspace: &str) -> AppResult<Vec<SessionSummary>> {
        let base = config::cloud_url("/sessions");
        let url = reqwest::Url::parse_with_params(&base, &[("workspace", workspace)])
            .map(|u| u.to_string())
            .unwrap_or(base);
        self.get(&url, Duration::from_secs(20)).await
    }

    pub async fn cloud_session_history(
        &self,
        session_id: &str,
        limit: usize,
        before: Option<i64>,
    ) -> AppResult<SessionRecordPage> {
        let base = config::cloud_url(&format!("/sessions/{session_id}/history"));
        let mut params = vec![("limit", limit.to_string())];
        if let Some(b) = before {
            params.push(("before", b.to_string()));
        }
        let url = reqwest::Url::parse_with_params(&base, &params)
            .map(|u| u.to_string())
            .unwrap_or(base);
        self.get(&url, Duration::from_secs(30)).await
    }

    pub async fn cloud_delete_session(&self, session_id: &str) -> AppResult<()> {
        let token = self.require_token()?;
        let url = config::cloud_url(&format!("/sessions/{session_id}"));
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(token.expose_secret())
            .timeout(Duration::from_secs(20))
            .send()
            .await?;
        let _ = check_status(resp).await?;
        Ok(())
    }

    pub async fn cloud_cancel_chat(&self, session_id: &str) -> AppResult<()> {
        let url = config::cloud_url("/chat/cancel");
        let _: serde_json::Value = self
            .post(
                &url,
                &json!({ "sessionId": session_id }),
                Duration::from_secs(10),
            )
            .await?;
        Ok(())
    }

    pub async fn cloud_stream_chat(
        &self,
        req: &CloudChatStreamReq,
        event_sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> AppResult<()> {
        let token = self.require_token()?;
        let url = config::cloud_url("/chat/stream");
        let resp = self
            .streaming_http
            .post(&url)
            .bearer_auth(token.expose_secret())
            .header("Accept", "text/event-stream")
            .json(req)
            .send()
            .await?;
        let resp = check_status(resp).await?;
        self.cloud_follow(&req.session_id, resp, event_sink, cancel).await
    }

    pub async fn cloud_resume_chat(
        &self,
        session_id: &str,
        event_sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> AppResult<()> {
        let resp = self.open_resume(session_id, 0).await?;
        self.cloud_follow(session_id, resp, event_sink, cancel).await
    }

    async fn open_resume(&self, session_id: &str, last_event_id: u64) -> AppResult<reqwest::Response> {
        let token = self.require_token()?;
        let base = config::cloud_url("/chat/resume");
        let url = reqwest::Url::parse_with_params(
            &base,
            &[
                ("sessionId", session_id.to_string()),
                ("lastEventId", last_event_id.to_string()),
            ],
        )
        .map(|u| u.to_string())
        .unwrap_or(base);
        let resp = self
            .streaming_http
            .get(&url)
            .bearer_auth(token.expose_secret())
            .header("Accept", "text/event-stream")
            .send()
            .await?;
        check_status(resp).await
    }

    async fn cloud_follow(
        &self,
        session_id: &str,
        first: reqwest::Response,
        event_sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> AppResult<()> {
        let mut response = first;
        let mut follower = Follower::default();
        let mut attempts = 0u32;

        loop {
            let before = follower.last_id;
            let outcome = follower.pump(response, &event_sink, &cancel).await;
            if follower.last_id != before {
                attempts = 0;
            }
            match outcome {
                Pumped::Done => return Ok(()),
                Pumped::Cancelled => {
                    let gw = self.clone();
                    let sid = session_id.to_string();
                    tokio::spawn(async move {
                        let _ = gw.cloud_cancel_chat(&sid).await;
                    });
                    event_sink.send(ChatEvent::cancelled());
                    event_sink.send(ChatEvent::done());
                    return Ok(());
                }
                Pumped::Dropped => {}
            }

            loop {
                attempts += 1;
                if attempts > MAX_RESUME_ATTEMPTS {
                    event_sink.send(ChatEvent::error(
                        "The connection to the cloud agent was lost. The run keeps going in the cloud. Reopen this chat to follow it.",
                    ));
                    event_sink.send(ChatEvent::done());
                    return Ok(());
                }
                let delay = Duration::from_secs((1u64 << attempts.min(4)).min(15));
                tokio::select! {
                    _ = cancel.cancelled() => {
                        let gw = self.clone();
                        let sid = session_id.to_string();
                        tokio::spawn(async move {
                            let _ = gw.cloud_cancel_chat(&sid).await;
                        });
                        event_sink.send(ChatEvent::cancelled());
                        event_sink.send(ChatEvent::done());
                        return Ok(());
                    }
                    _ = tokio::time::sleep(delay) => {}
                }
                match self.open_resume(session_id, follower.last_id).await {
                    Ok(next) => {
                        if follower.last_id == 0 {
                            event_sink.send(ChatEvent::resync());
                        }
                        response = next;
                        break;
                    }
                    Err(AppError::Gateway { status, body })
                        if (400..500).contains(&status) && status != 429 =>
                    {
                        event_sink.send(ChatEvent::error(format!(
                            "Could not resume the cloud run ({status}): {body}"
                        )));
                        event_sink.send(ChatEvent::done());
                        return Ok(());
                    }
                    Err(_) => {}
                }
            }
        }
    }
}

const MAX_RESUME_ATTEMPTS: u32 = 8;

enum Pumped {
    Done,
    Cancelled,
    Dropped,
}

#[derive(Default)]
struct Follower {
    last_id: u64,
    pending_writes: HashMap<String, String>,
}

impl Follower {
    async fn pump(
        &mut self,
        response: reqwest::Response,
        event_sink: &Arc<dyn EventSink>,
        cancel: &CancellationToken,
    ) -> Pumped {
        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let idle = Duration::from_secs(config::CLOUD_STREAM_IDLE_TIMEOUT_SECS);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Pumped::Cancelled,
                chunk = tokio::time::timeout(idle, stream.next()) => {
                    let Ok(Some(Ok(bytes))) = chunk else {
                        return Pumped::Dropped;
                    };
                    buffer.extend(bytes.iter().copied().filter(|byte| *byte != b'\r'));
                    while let Some(position) = buffer.windows(2).position(|pair| pair == b"\n\n") {
                        let raw: Vec<u8> = buffer.drain(..position + 2).collect();
                        let block = String::from_utf8_lossy(&raw[..position]).into_owned();
                        if forward_block(&block, event_sink, &mut self.pending_writes, &mut self.last_id) {
                            return Pumped::Done;
                        }
                    }
                }
            }
        }
    }
}

fn forward_block(
    block: &str,
    event_sink: &Arc<dyn EventSink>,
    pending_writes: &mut HashMap<String, String>,
    last_id: &mut u64,
) -> bool {
    let mut event: Option<&str> = None;
    let mut id: Option<u64> = None;
    let mut data: Vec<&str> = Vec::new();
    for line in block.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            event = Some(rest.trim());
        } else if let Some(rest) = line.strip_prefix("id:") {
            id = rest.trim().parse::<u64>().ok();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data.push(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    if event.is_none() && data.is_empty() {
        return false;
    }
    let Some(chat_event) = ChatEvent::from_sse(event, &data.join("\n")) else {
        return false;
    };
    note_file_writes(&chat_event, pending_writes, event_sink);
    let finished = chat_event.is_done();
    if chat_event.event_type() == "orch.resync" {
        *last_id = 0;
        pending_writes.clear();
    } else if let Some(id) = id {
        *last_id = id;
    }
    event_sink.send(chat_event);
    finished
}

fn note_file_writes(
    event: &ChatEvent,
    pending_writes: &mut HashMap<String, String>,
    event_sink: &Arc<dyn EventSink>,
) {
    if event.event_type() != "step.start" {
        return;
    }
    let Some(step) = event.0.get("step") else {
        return;
    };
    match step.get("type").and_then(serde_json::Value::as_str) {
        Some("function_call") => {
            let name = step
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if name != WRITE_TO_FILE && name != REPLACE_FILE_CONTENT {
                return;
            }
            let id = step.get("id").and_then(serde_json::Value::as_str);
            let target = step
                .get("arguments")
                .and_then(|arguments| arguments.get("TargetFile"))
                .and_then(serde_json::Value::as_str);
            if let (Some(id), Some(target)) = (id, target) {
                pending_writes.insert(id.to_string(), target.to_string());
            }
        }
        Some("function_result") => {
            let call_id = step
                .get("call_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let failed = step
                .get("is_error")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            if let Some(path) = pending_writes.remove(call_id) {
                if !failed {
                    event_sink.emit_file_written(&path);
                }
            }
        }
        _ => {}
    }
}

async fn check_status(resp: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let url = resp.url().to_string();
    let status_code = status.as_u16();
    let raw_body = resp.text().await.unwrap_or_default();
    let (body, code) = parse_server_error(&raw_body);
    if status_code == 409 && code.as_deref() == Some("RUN_ACTIVE") {
        return Err(AppError::RunConflict);
    }
    let err = AppError::Gateway {
        status: status_code,
        body,
    };
    sentry::add_breadcrumb(sentry::Breadcrumb {
        category: Some("gateway".to_string()),
        message: Some(format!("HTTP {status_code} on {url}")),
        level: if status_code >= 500 {
            sentry::Level::Error
        } else {
            sentry::Level::Warning
        },
        ..Default::default()
    });
    let expected_limit = code.as_deref() == Some("BUDGET_EXCEEDED");
    if status_code >= 500 || (status_code == 429 && !expected_limit) {
        sentry::capture_error(&err);
    }
    Err(err)
}

fn parse_server_error(raw: &str) -> (String, Option<String>) {
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(raw) else {
        return (raw.to_string(), None);
    };
    let code = map.get("code").and_then(|c| c.as_str()).map(str::to_string);
    match map.get("error").and_then(|e| e.as_str()) {
        Some(message) if !message.is_empty() => (message.to_string(), code),
        _ => (raw.to_string(), code),
    }
}
