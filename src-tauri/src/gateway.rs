use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config;
use crate::error::{AppError, AppResult};

pub type TokenHandle = Arc<RwLock<Option<String>>>;

#[derive(Debug, Clone, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub provider: String,
    #[serde(rename = "contextWindow", default)]
    pub context_window: u64,
    #[serde(rename = "maxTokens", default)]
    pub max_tokens: u64,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub badge: Option<String>,
}

impl ModelInfo {
    pub fn supports_images(&self) -> bool {
        self.capabilities.iter().any(|c| c == "images")
    }

    pub fn target_model_id(&self) -> &str {
        &self.id
    }
}

#[derive(Debug, Clone, Default)]
pub struct ModelCatalog {
    entries: HashMap<String, ModelInfo>,
}

impl ModelCatalog {
    pub fn from_map(entries: HashMap<String, ModelInfo>) -> Self {
        Self { entries }
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
        let mut out: Vec<(String, ModelInfo)> = self
            .entries
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        out.sort_by(|a, b| a.1.name.cmp(&b.1.name).then_with(|| a.0.cmp(&b.0)));
        out
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Budget {
    #[serde(default)]
    pub cost_usd: f64,
    #[serde(default)]
    pub limit_usd: f64,
    #[serde(default)]
    pub remaining: f64,
    #[serde(default)]
    pub period: String,
    #[serde(default)]
    pub allowed: bool,
}

#[derive(Clone)]
pub struct Gateway {
    http: reqwest::Client,
    token: TokenHandle,
}

impl Gateway {
    pub fn new(token: TokenHandle) -> AppResult<Self> {
        Ok(Self {
            http: crate::util::http_client(),
            token,
        })
    }

    fn require_token(&self) -> AppResult<String> {
        self.token
            .read()
            .ok()
            .and_then(|g| g.clone())
            .filter(|t| !t.is_empty())
            .ok_or(AppError::NoToken)
    }

    pub async fn models(&self) -> AppResult<ModelCatalog> {
        let token = self.require_token()?;
        let resp = self
            .http
            .get(config::models_url())
            .bearer_auth(token)
            .send()
            .await?;
        let resp = check_status(resp).await?;
        let map: HashMap<String, ModelInfo> = resp.json().await?;
        Ok(ModelCatalog::from_map(map))
    }

    pub async fn budget(&self) -> AppResult<Budget> {
        let token = self.require_token()?;
        let resp = self
            .http
            .get(config::budget_url())
            .bearer_auth(token)
            .send()
            .await?;
        let resp = check_status(resp).await?;
        Ok(resp.json().await?)
    }

    pub async fn transcribe(&self, audio_base64: &str) -> AppResult<String> {
        let token = self.require_token()?;
        let resp = self
            .http
            .post(config::transcribe_url())
            .bearer_auth(token)
            .timeout(Duration::from_secs(300))
            .json(&json!({ "audio": audio_base64 }))
            .send()
            .await?;
        let resp = check_status(resp).await?;

        #[derive(Deserialize)]
        struct TranscribeResp {
            #[serde(default)]
            text: String,
        }

        let body: TranscribeResp = resp.json().await?;
        Ok(body.text)
    }

    pub async fn tavily(&self, req: &TavilyRequest) -> AppResult<TavilyResponse> {
        let token = self.require_token()?;
        let resp = self
            .http
            .post(config::tavily_url())
            .bearer_auth(token)
            .json(req)
            .send()
            .await?;
        let resp = check_status(resp).await?;
        Ok(resp.json().await?)
    }

    pub async fn generate_title(&self, prompt: &str) -> AppResult<String> {
        let token = self.require_token()?;
        let resp = self
            .http
            .post(config::title_url())
            .bearer_auth(token)
            .json(&json!({ "prompt": prompt }))
            .send()
            .await?;
        let resp = check_status(resp).await?;

        #[derive(Deserialize)]
        struct TitleResp {
            #[serde(default)]
            title: String,
        }

        let body: TitleResp = resp.json().await?;
        Ok(body.title)
    }
}

async fn check_status(resp: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    Err(AppError::Gateway {
        status: status.as_u16(),
        body,
    })
}

#[derive(Debug, Serialize)]
pub struct TavilyRequest {
    pub query: String,
    #[serde(rename = "maxResults", skip_serializing_if = "Option::is_none")]
    pub max_results: Option<u32>,
    #[serde(rename = "searchDepth", skip_serializing_if = "Option::is_none")]
    pub search_depth: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TavilyResponse {
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub results: Vec<TavilyResult>,
}

#[derive(Debug, Deserialize)]
pub struct TavilyResult {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub content: String,
}
