use std::sync::Arc;

use async_trait::async_trait;
use orchharness::backend::{
    SessionMetaStore, SummarizerBackend, TavilyRequest, TavilyResponse, WebSearchBackend,
};
use orchharness::error::AppResult;
pub use orchharness::llm::{
    build_agent, build_client_with_middleware, build_user_message, parse_thinking_effort,
    run_chat, AgentInputs, ChatAgent, ChatClient, ChatRun, RunOutcome, RunParams,
};
pub use orchharness::persistence::{AttachmentRef, TurnUsage};
use orchharness::work::WorkRun;
use secrecy::ExposeSecret;

use crate::config;
use crate::gateway::{Gateway, TokenHandle};
use crate::persistence::SqliteMemory;

#[derive(Clone, Debug)]
pub struct AuthMiddleware {
    token: TokenHandle,
}

impl AuthMiddleware {
    pub fn new(token: TokenHandle) -> Self {
        Self { token }
    }
}

#[async_trait]
impl reqwest_middleware::Middleware for AuthMiddleware {
    async fn handle(
        &self,
        mut req: reqwest::Request,
        extensions: &mut http::Extensions,
        next: reqwest_middleware::Next<'_>,
    ) -> reqwest_middleware::Result<reqwest::Response> {
        req.headers_mut().remove(reqwest::header::AUTHORIZATION);
        let token = self.token.load_full();
        if let Some(token) = token.filter(|token| !token.expose_secret().is_empty()) {
            if let Ok(value) =
                reqwest::header::HeaderValue::from_str(&format!("Bearer {}", token.expose_secret()))
            {
                req.headers_mut().insert(reqwest::header::AUTHORIZATION, value);
            }
        }
        next.run(req, extensions).await
    }
}

pub fn build_client(token: TokenHandle) -> AppResult<ChatClient> {
    Ok(build_client_with_middleware(
        config::inference_base_url(),
        AuthMiddleware::new(token),
    ))
}

#[derive(Clone)]
pub struct GatewayWebSearch {
    pub gateway: Arc<Gateway>,
}

#[async_trait]
impl WebSearchBackend for GatewayWebSearch {
    async fn tavily(&self, req: &TavilyRequest) -> AppResult<TavilyResponse> {
        self.gateway.tavily(req).await
    }
}

#[derive(Clone)]
pub struct GatewaySummarizer {
    pub gateway: Arc<Gateway>,
}

#[async_trait]
impl SummarizerBackend for GatewaySummarizer {
    async fn summarize(&self, system: &str, prompt: &str, max_tokens: u64) -> AppResult<String> {
        self.gateway.summarize(system, prompt, max_tokens).await
    }
}

#[derive(Clone)]
pub struct SqliteMetaStore {
    pub memory: SqliteMemory,
}

#[async_trait]
impl SessionMetaStore for SqliteMetaStore {
    async fn session_context_tokens(&self, session_id: &str) -> u64 {
        self.memory
            .session_context_tokens(session_id)
            .await
            .unwrap_or(0)
    }

    async fn set_context_tokens(&self, session_id: &str, tokens: u64) -> AppResult<()> {
        self.memory.set_context_tokens(session_id, tokens).await
    }

    async fn record_usage(&self, session_id: &str, usage: &TurnUsage) -> AppResult<()> {
        self.memory.record_usage(session_id, usage).await
    }

    async fn save_reasoning_durations(
        &self,
        session_id: &str,
        keys: Vec<(String, u64)>,
    ) -> AppResult<()> {
        self.memory.save_reasoning_durations(session_id, keys).await
    }

    async fn save_work_runs(&self, session_id: &str, keys: Vec<(String, WorkRun)>) -> AppResult<()> {
        self.memory.save_work_runs(session_id, keys).await
    }
}
