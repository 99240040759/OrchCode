pub fn gcp_functions_url() -> &'static str {
    env!("GCP_FUNCTIONS_URL")
}

pub fn firebase_api_key() -> &'static str {
    env!("FIREBASE_API_KEY")
}

pub fn sentry_dsn() -> &'static str {
    option_env!("SENTRY_DSN").unwrap_or("")
}

pub const AUTH_REDIRECT_URL: &str = "https://orch.live/auth-callback";

fn clean_base_url() -> &'static str {
    gcp_functions_url().trim_end_matches('/')
}

pub fn inference_base_url(provider: &str) -> String {
    let clean = if provider.trim().is_empty() {
        DEFAULT_INFERENCE_PROVIDER
    } else {
        provider.trim()
    };
    format!("{}/{}/v1", clean_base_url(), clean)
}

pub fn models_url() -> String {
    format!("{}/models", clean_base_url())
}

pub fn title_url() -> String {
    format!("{}/title", clean_base_url())
}

pub fn summarize_url() -> String {
    format!("{}/summarize", clean_base_url())
}

pub fn budget_url() -> String {
    format!("{}/budget", clean_base_url())
}

pub fn transcribe_url() -> String {
    format!("{}/transcribe", clean_base_url())
}

pub fn tavily_url() -> String {
    format!("{}/tavily", clean_base_url())
}

const DEFAULT_INFERENCE_PROVIDER: &str = "vertex";

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

pub const COMPACTION_TRIGGER_TOKENS: u64 = 100_000;

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
