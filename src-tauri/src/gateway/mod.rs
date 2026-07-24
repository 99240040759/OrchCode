pub mod models;
pub mod budget;

use std::sync::{Arc, RwLock};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config;
use crate::error::{AppError, AppResult};

pub use budget::Budget;
pub use models::{ModelCatalog, ModelInfo};

pub type TokenHandle = Arc<RwLock<Option<String>>>;

#[derive(Clone)]
pub struct Gateway {
    http: reqwest::Client,
    token: TokenHandle,
}

impl Gateway {
    pub fn new(token: TokenHandle) -> Self {
        let http = reqwest::Client::builder().user_agent("orchcode/0.1").build().expect("failed to build reqwest client");
        Self { http, token }
    }

    fn token(&self) -> Option<String> {
        self.token.read().ok().and_then(|g| g.clone())
    }

    fn require_token(&self) -> AppResult<String> {
        self.token().ok_or(AppError::NoToken)
    }

    pub async fn models(&self) -> AppResult<ModelCatalog> {
        let bearer = self.token().unwrap_or_else(config::supabase_anon_key);
        let resp = self.http.get(config::models_url()).bearer_auth(bearer).send().await?;
        let resp = check_status(resp).await?;
        let map: std::collections::HashMap<String, ModelInfo> = resp.json().await?;
        Ok(ModelCatalog::from_map(map))
    }

    pub async fn budget(&self) -> AppResult<Budget> {
        let token = self.require_token()?;
        let resp = self.http.get(config::budget_url()).bearer_auth(token).send().await?;
        let resp = check_status(resp).await?;
        Ok(resp.json().await?)
    }

    pub async fn transcribe(&self, audio_base64: &str) -> AppResult<String> {
        let token = self.require_token()?;
        let resp = self.http.post(config::transcribe_url()).bearer_auth(token).json(&json!({ "audio": audio_base64 })).send().await?;
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
        let resp = self.http.post(config::tavily_url()).bearer_auth(token).json(req).send().await?;
        let resp = check_status(resp).await?;
        Ok(resp.json().await?)
    }

    pub async fn embed(&self, texts: Vec<String>, model: Option<&str>) -> AppResult<Vec<Vec<f32>>> {
        let token = self.require_token()?;
        let body = json!({
            "input": texts,
            "model": model.unwrap_or("gemini-embedding-2")
        });
        let resp = self.http
            .post(config::embeddings_url())
            .bearer_auth(token)
            .json(&body)
            .send()
            .await?;
        let resp = check_status(resp).await?;

        #[derive(Deserialize)]
        struct EmbeddingItem {
            embedding: Vec<f32>,
            index: usize,
        }
        #[derive(Deserialize)]
        struct EmbedResponse {
            data: Vec<EmbeddingItem>,
        }

        let mut parsed: EmbedResponse = resp.json().await?;
        parsed.data.sort_by_key(|e| e.index);
        Ok(parsed.data.into_iter().map(|e| e.embedding).collect())
    }

    pub async fn generate_title(&self, prompt: &str) -> AppResult<String> {
        let token = self.require_token()?;
        let base = config::models_url();
        let url = base.rsplit_once('/').map(|(head, _)| format!("{head}/title")).unwrap_or_else(|| format!("{base}/title"));
        let resp = self.http.post(&url).bearer_auth(token).json(&json!({ "prompt": prompt })).send().await?;
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
    Err(AppError::Gateway { status: status.as_u16(), body })
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
    #[serde(default)]
    pub score: Option<f64>,
}
