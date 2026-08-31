pub fn gcp_functions_url() -> &'static str {
    env!("GCP_FUNCTIONS_URL")
}

pub fn firebase_api_key() -> &'static str {
    env!("FIREBASE_API_KEY")
}

pub fn firebase_auth_domain() -> &'static str {
    env!("FIREBASE_AUTH_DOMAIN")
}

pub fn sentry_dsn() -> &'static str {
    option_env!("SENTRY_DSN").unwrap_or("")
}

pub const AUTH_REDIRECT_URL: &str = "https://orch.live/auth-callback";

pub fn inference_base_url(provider: &str) -> String {
    let clean = if provider.trim().is_empty() {
        DEFAULT_INFERENCE_PROVIDER
    } else {
        provider.trim()
    };
    format!("{}/{}/v1", gcp_functions_url(), clean)
}

pub fn models_url() -> String {
    format!("{}/models", gcp_functions_url())
}

pub fn title_url() -> String {
    format!("{}/title", gcp_functions_url())
}

pub fn budget_url() -> String {
    format!("{}/budget", gcp_functions_url())
}

pub fn transcribe_url() -> String {
    format!("{}/transcribe", gcp_functions_url())
}

pub fn tavily_url() -> String {
    format!("{}/tavily", gcp_functions_url())
}

const DEFAULT_INFERENCE_PROVIDER: &str = "nvidia";

pub const DEFAULT_MAX_TURNS: usize = 100;
pub const DEFAULT_TOOL_CONCURRENCY: usize = 4;
pub const BUDGET_RECHECK_EVERY_TURNS: u32 = 10;
pub const COMMAND_FOREGROUND_HANDOFF_SECS: u64 = 30;
pub const MAX_ATTACHMENT_BYTES: usize = 1024 * 1024;

pub const COMPACTION_THRESHOLD_RATIO: f64 = 0.8;
pub const MODEL_CATALOG_REFRESH_INTERVAL_SECS: u64 = 300;
pub const TOKEN_REFRESH_CHECK_INTERVAL_SECS: u64 = 120;
pub const TOKEN_REFRESH_SKEW_SECS: i64 = 300;
pub const SIGN_IN_WINDOW_SECS: u64 = 600;
pub const STREAM_CHUNK_TIMEOUT_SECS: u64 = 120;
