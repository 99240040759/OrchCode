use std::sync::OnceLock;

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

pub const DEFAULT_MAX_TURNS: usize = 100;
pub const DEFAULT_TOOL_CONCURRENCY: usize = 4;
pub const COMMAND_FOREGROUND_HANDOFF_SECS: u64 = 30;
pub const COMMAND_MAX_WAIT_MS: u64 = 300_000;

pub const MAX_ATTACHMENT_SOURCE_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_TEXT_ATTACHMENT_CHARS: usize = 200_000;
pub const MAX_MODEL_IMAGE_DIMENSION: u32 = 4096;
pub const MAX_MODEL_IMAGE_BYTES: usize = 15 * 1024 * 1024;

pub const MAX_TOOL_OUTPUT_CHARS: usize = 48_000;
pub const MAX_READ_FILE_LINES: usize = 2_000;
pub const MAX_READ_FILE_CHARS: usize = 120_000;
pub const MAX_SEARCH_LINE_CHARS: usize = 300;
pub const MAX_SEARCH_OUTPUT_CHARS: usize = 40_000;
pub const MAX_VIEW_TOOL_OUTPUT_CHARS: usize = 16_000;

pub const PREAMBLE_TOKEN_RESERVE: u64 = 9_000;

pub const COMPACTION_TRIGGER_PERCENT: u64 = 80;

pub fn compaction_trigger_tokens(context_window: u64) -> u64 {
    context_window.saturating_mul(COMPACTION_TRIGGER_PERCENT) / 100
}

pub const COMPACTION_KEEP_RECENT_TOKENS: usize = 24_000;

pub const COMPACTION_SUMMARY_TOKENS: u64 = 10_000;

pub const COMPACTION_SNIPPET_CHARS: usize = 3_000;

pub const MODEL_CATALOG_REFRESH_INTERVAL_SECS: u64 = 300;
pub const TOKEN_REFRESH_CHECK_INTERVAL_SECS: u64 = 60;
pub const TOKEN_REFRESH_SKEW_SECS: i64 = 600;
pub const SIGN_IN_WINDOW_SECS: u64 = 600;
pub const AUTH_REQUEST_TIMEOUT_SECS: u64 = 15;

pub const STREAM_CHUNK_TIMEOUT_SECS: u64 = 360;
pub const TOOL_EXECUTION_TIMEOUT_SECS: u64 = 1_800;
pub const SUMMARY_REQUEST_TIMEOUT_SECS: u64 = 180;

pub const FILE_INDEX_TTL_SECS: u64 = 120;
pub const MAX_INDEXED_FILES: usize = 200_000;

pub const MAX_PREVIEW_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_PREVIEW_IMAGE_DIMENSION: u32 = 2048;
pub const MAX_BINARY_PREVIEW_BYTES: u64 = 30 * 1024 * 1024;
pub const MAX_SPREADSHEET_ROWS: usize = 5_000;
pub const MAX_SPREADSHEET_COLS: usize = 200;

pub const DICTATION_TARGET_SAMPLE_RATE: u32 = 16_000;
