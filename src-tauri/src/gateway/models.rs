use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(rename = "reasoningEffort", default)]
    pub reasoning_effort: Option<String>,
}

impl ModelInfo {
    /// The gateway (`gcp-functions/api/index.js` MODEL_DEFINITIONS) emits an explicit
    /// `"images"` literal in `capabilities` when a model accepts image input. This is an
    /// exact match against that server-defined contract — no client-side heuristics or
    /// substring guessing (`contains("vision")`, `== "multimodal"`, etc.). If the gateway
    /// introduces a new capability literal, it must be added here explicitly so the two
    /// sides stay in lockstep instead of silently drifting.
    pub fn supports_images(&self) -> bool {
        self.capabilities.iter().any(|c| c == "images")
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
        if let Some(info) = self.entries.get(key) {
            return Some(info);
        }
        let lower = key.to_lowercase();
        self.entries.iter().find(|(k, v)| k.to_lowercase() == lower || v.id == key).map(|(_, v)| v)
    }

    pub fn list(&self) -> Vec<(String, ModelInfo)> {
        let mut out: Vec<(String, ModelInfo)> = self.entries.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }
}
