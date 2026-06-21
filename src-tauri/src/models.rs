use anyhow::Result;
use std::sync::LazyLock;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub multimodal: bool,
    #[serde(rename = "contextWindow")]
    pub context_window: Option<u64>,
    pub badge: Option<String>,
    pub provider: Option<String>,
    #[serde(rename = "reasoningEffort")]
    pub reasoning_effort: Option<String>,
}
static CACHE: LazyLock<Mutex<Option<(Vec<ModelInfo>, Instant)>>> = LazyLock::new(|| Mutex::new(None));
const TTL: Duration = Duration::from_secs(300);
pub async fn list(force: bool) -> Result<Vec<ModelInfo>> {
    {
        let c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if !force {
            if let Some((ref models, ts)) = *c {
                if ts.elapsed() < TTL { return Ok(models.clone()); }
            }
        }
    }
    let token = crate::auth::require_token_async().await?;
    let resp: serde_json::Value = crate::utils::authed_client(&token)
        .get(format!("{}/models", crate::utils::gcp_base()))
        .send().await?.error_for_status()?.json().await?;
    // H8: handle both object and array response shapes
    let models: Vec<ModelInfo> = if let Some(obj) = resp.as_object() {
        obj.values().filter_map(|v| serde_json::from_value::<ModelInfo>(v.clone()).ok()).collect()
    } else if let Some(arr) = resp.as_array() {
        arr.iter().filter_map(|v| serde_json::from_value::<ModelInfo>(v.clone()).ok()).collect()
    } else {
        Vec::new()
    };
    // L10: use unwrap_or_else on write lock too
    if let Ok(mut c) = CACHE.lock().or_else(|e| Ok::<_, ()>(e.into_inner())) {
        *c = Some((models.clone(), Instant::now()));
    }
    Ok(models)
}
