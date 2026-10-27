use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use secrecy::{ExposeSecret, SecretString};

use crate::config;
use crate::error::{AppError, AppResult};

pub type TokenHandle = Arc<arc_swap::ArcSwapOption<SecretString>>;

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
}

#[derive(Debug, Clone, Default)]
pub struct ModelCatalog {
    entries: HashMap<String, ModelInfo>,
    sorted_list: Vec<(String, ModelInfo)>,
}

impl ModelCatalog {
    pub fn from_map(entries: HashMap<String, ModelInfo>) -> Self {
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

fn default_allowed() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    #[serde(default, alias = "cost_usd", alias = "costUsd", alias = "cost")]
    pub cost_usd: f64,
    #[serde(default, alias = "limit_usd", alias = "limitUsd", alias = "limit")]
    pub limit_usd: f64,
    #[serde(default)]
    pub remaining: f64,
    #[serde(default)]
    pub period: String,
    #[serde(default = "default_allowed")]
    pub allowed: bool,
}

#[derive(Clone)]
pub struct Gateway {
    http: reqwest_middleware::ClientWithMiddleware,
    token: TokenHandle,
}

impl Gateway {
    pub fn new(token: TokenHandle) -> AppResult<Self> {
        Ok(Self {
            http: crate::util::retry_http_client(),
            token,
        })
    }

    fn require_token(&self) -> AppResult<SecretString> {
        self.token
            .load_full()
            .filter(|token| !token.expose_secret().is_empty())
            .map(|token| token.as_ref().clone())
            .ok_or(AppError::NoToken)
    }

    pub async fn models(&self) -> AppResult<ModelCatalog> {
        let token = self.require_token()?;
        let resp = self
            .http
            .get(config::models_url())
            .bearer_auth(token.expose_secret())
            .timeout(Duration::from_secs(20))
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
            .bearer_auth(token.expose_secret())
            .timeout(Duration::from_secs(15))
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
            .bearer_auth(token.expose_secret())
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
            .bearer_auth(token.expose_secret())
            .timeout(Duration::from_secs(30))
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
            .bearer_auth(token.expose_secret())
            .timeout(Duration::from_secs(20))
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

    pub async fn summarize(&self, system: &str, prompt: &str, max_tokens: u64) -> AppResult<String> {
        let token = self.require_token()?;
        let resp = self
            .http
            .post(config::summarize_url())
            .bearer_auth(token.expose_secret())
            .timeout(Duration::from_secs(config::SUMMARY_REQUEST_TIMEOUT_SECS))
            .json(&json!({
                "system": system,
                "prompt": prompt,
                "maxTokens": max_tokens,
            }))
            .send()
            .await?;
        let resp = check_status(resp).await?;

        #[derive(Deserialize)]
        struct SummaryResp {
            #[serde(default)]
            text: String,
        }

        let body: SummaryResp = resp.json().await?;
        Ok(body.text)
    }
}

async fn check_status(resp: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let url = resp.url().to_string();
    let status_code = status.as_u16();
    let body = resp.text().await.unwrap_or_default();
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
    if status_code >= 500 || status_code == 429 {
        sentry::capture_error(&err);
    }
    Err(err)
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
