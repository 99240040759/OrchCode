use std::collections::HashMap;

use serde::Deserialize;

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
    #[serde(rename = "reasoningEffort", default)]
    pub reasoning_effort: Option<String>,
}

impl ModelInfo {
    pub fn supports_images(&self) -> bool {
        self.capabilities.iter().any(|c| c == "images")
    }

    pub fn target_model_id(&self) -> &str {
        match self.id.rfind('/') {
            Some(pos) => &self.id[pos + 1..],
            None => &self.id,
        }
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
