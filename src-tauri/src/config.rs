pub fn gcp_functions_url() -> &'static str {
    env!("GCP_FUNCTIONS_URL")
}

pub fn firebase_api_key() -> &'static str {
    env!("FIREBASE_API_KEY")
}

pub fn sentry_dsn() -> &'static str {
    static DSN: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DSN.get_or_init(|| {
        std::env::var("SENTRY_DSN")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| option_env!("SENTRY_DSN").unwrap_or("").to_string())
    })
    .as_str()
}

pub const AUTH_REDIRECT_URL: &str = "https://orch.live/auth-callback";

/// Root the native Gemini client talks to. The gateway forwards
/// `/vertex/v1beta/models/{model}:streamGenerateContent` to Vertex AI.
pub fn inference_base_url() -> String {
    format!("{}/vertex", gcp_functions_url())
}

pub fn models_url() -> &'static str {
    concat!(env!("GCP_FUNCTIONS_URL"), "/models")
}

pub fn title_url() -> &'static str {
    concat!(env!("GCP_FUNCTIONS_URL"), "/title")
}

pub fn summarize_url() -> &'static str {
    concat!(env!("GCP_FUNCTIONS_URL"), "/summarize")
}

pub fn budget_url() -> &'static str {
    concat!(env!("GCP_FUNCTIONS_URL"), "/budget")
}

pub fn transcribe_url() -> &'static str {
    concat!(env!("GCP_FUNCTIONS_URL"), "/transcribe")
}

pub fn tavily_url() -> &'static str {
    concat!(env!("GCP_FUNCTIONS_URL"), "/tavily")
}

pub fn composio_url(path: &str) -> String {
    format!("{}/composio{}", gcp_functions_url(), path)
}

pub const DEFAULT_MAX_TURNS: usize = 100;
pub const DEFAULT_TOOL_CONCURRENCY: usize = 4;
pub const COMMAND_FOREGROUND_HANDOFF_SECS: u64 = 30;

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

pub const FILE_INDEX_TTL_SECS: u64 = 10;
pub const MAX_INDEXED_FILES: usize = 200_000;

pub const MAX_PREVIEW_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_PREVIEW_IMAGE_DIMENSION: u32 = 2048;
pub const MAX_BINARY_PREVIEW_BYTES: u64 = 200 * 1024 * 1024;
pub const MAX_SPREADSHEET_ROWS: usize = 5_000;
pub const MAX_SPREADSHEET_COLS: usize = 200;

pub const DICTATION_TARGET_SAMPLE_RATE: u32 = 16_000;
