use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use secrecy::{ExposeSecret, SecretString};

use crate::config;
use crate::error::{AppError, AppResult};

pub type TokenHandle = Arc<arc_swap::ArcSwapOption<SecretString>>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_window: u64,
    pub max_tokens: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    #[serde(alias = "cost_usd")]
    pub cost_usd: f64,
    #[serde(alias = "limit_usd")]
    pub limit_usd: f64,
    pub remaining: f64,
    pub period: String,
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
        let map: HashMap<String, ModelInfo> =
            self.get(config::models_url(), Duration::from_secs(20)).await?;
        Ok(ModelCatalog::from_map(map))
    }

    pub async fn budget(&self) -> AppResult<Budget> {
        self.get(config::budget_url(), Duration::from_secs(15)).await
    }

    pub async fn transcribe(&self, audio_base64: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct Resp {
            text: String,
        }
        let resp: Resp = self
            .post(
                config::transcribe_url(),
                &json!({ "audio": audio_base64 }),
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
