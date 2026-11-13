use std::sync::OnceLock;

pub use orchharness::config::{
    compaction_trigger_tokens, CLOUD_FILE_LIST_LIMIT, CLOUD_MAX_ATTACHMENT_TOTAL_BYTES,
    CLOUD_STREAM_IDLE_TIMEOUT_SECS, MAX_DIR_ENTRIES, MAX_INDEXED_FILES,
    SUMMARY_REQUEST_TIMEOUT_SECS,
};

pub fn gcp_functions_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| {
        std::env::var("GCP_FUNCTIONS_URL")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                option_env!("GCP_FUNCTIONS_URL")
                    .map(|s| s.trim().trim_end_matches('/').to_string())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or_else(|| {
                let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
                format!("http://127.0.0.1:{port}")
            })
    })
    .as_str()
}

pub fn firebase_api_key() -> &'static str {
    static KEY: OnceLock<String> = OnceLock::new();
    KEY.get_or_init(|| {
        std::env::var("FIREBASE_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                option_env!("FIREBASE_API_KEY")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or_default()
    })
    .as_str()
}

pub fn sentry_dsn() -> &'static str {
    static DSN: OnceLock<String> = OnceLock::new();
    DSN.get_or_init(|| {
        std::env::var("SENTRY_DSN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                option_env!("SENTRY_DSN")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_default()
            })
    })
    .as_str()
}

pub const AUTH_REDIRECT_URL: &str = "https://orch.live/auth-callback";

pub fn inference_base_url() -> String {
    format!("{}/vertex", gcp_functions_url())
}

pub fn models_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| format!("{}/models", gcp_functions_url()))
        .as_str()
}

pub fn title_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| format!("{}/title", gcp_functions_url()))
        .as_str()
}

pub fn summarize_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| format!("{}/summarize", gcp_functions_url()))
        .as_str()
}

pub fn budget_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| format!("{}/budget", gcp_functions_url()))
        .as_str()
}

pub fn transcribe_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| format!("{}/transcribe", gcp_functions_url()))
        .as_str()
}

pub fn tavily_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| format!("{}/tavily", gcp_functions_url()))
        .as_str()
}

pub fn composio_url(path: &str) -> String {
    format!("{}/composio{}", gcp_functions_url(), path)
}

pub fn cloud_url(path: &str) -> String {
    format!("{}/cloud{}", gcp_functions_url(), path)
}

pub const MODEL_CATALOG_REFRESH_INTERVAL_SECS: u64 = 300;
pub const TOKEN_REFRESH_CHECK_INTERVAL_SECS: u64 = 60;
pub const TOKEN_REFRESH_SKEW_SECS: i64 = 600;
pub const SIGN_IN_WINDOW_SECS: u64 = 600;
pub const AUTH_REQUEST_TIMEOUT_SECS: u64 = 15;

pub const FILE_INDEX_TTL_SECS: u64 = 120;

pub const MAX_PREVIEW_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_PREVIEW_IMAGE_DIMENSION: u32 = 2048;
pub const MAX_BINARY_PREVIEW_BYTES: u64 = 30 * 1024 * 1024;
pub const MAX_SPREADSHEET_ROWS: usize = 5_000;
pub const MAX_SPREADSHEET_COLS: usize = 200;

pub const DICTATION_TARGET_SAMPLE_RATE: u32 = 16_000;
