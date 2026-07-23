use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
