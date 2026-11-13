use std::sync::Arc;

use async_trait::async_trait;
use orchharness::backend::{SummarizerBackend, TavilyRequest, TavilyResponse, WebSearchBackend};
use orchharness::error::AppResult;
pub use orchharness::llm::{
    build_agent, build_client_with_middleware, build_user_message, parse_thinking_effort,
    run_chat, AgentInputs, ChatAgent, ChatClient, ChatRun, RunOutcome, RunParams,
};
pub use orchharness::persistence::AttachmentRef;
use secrecy::ExposeSecret;

use crate::config;
use crate::gateway::{Gateway, TokenHandle};

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
