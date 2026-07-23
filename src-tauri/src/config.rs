pub fn gcp_functions_url() -> String {
    option_env!("GCP_FUNCTIONS_URL").unwrap_or("").to_string()
}

pub fn supabase_url() -> String {
    option_env!("SUPABASE_URL").unwrap_or("").to_string()
}

pub fn supabase_anon_key() -> String {
    option_env!("SUPABASE_ANON_KEY").unwrap_or("").to_string()
}

pub fn sentry_dsn() -> String {
    option_env!("SENTRY_DSN").unwrap_or("").to_string()
}

pub fn inference_base_url() -> String {
    format!("{}/opencode/v1", gcp_functions_url())
}

pub fn models_url() -> String {
    format!("{}/models", gcp_functions_url())
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

pub fn validate_runtime_config() {
    let gcf = gcp_functions_url();
    let supa = supabase_url();
    if gcf.is_empty() {
        eprintln!("[orchcode] FATAL: GCP_FUNCTIONS_URL is not set — inference, models, and budget will fail");
    } else if !gcf.starts_with("https://") {
        eprintln!("[orchcode] WARNING: GCP_FUNCTIONS_URL does not use HTTPS: {gcf}");
    }
    if supa.is_empty() {
        eprintln!("[orchcode] FATAL: SUPABASE_URL is not set — authentication will fail");
    } else if !supa.starts_with("https://") {
        eprintln!("[orchcode] WARNING: SUPABASE_URL does not use HTTPS: {supa}");
    }
}

pub const DEFAULT_MAX_TURNS: usize = 1000;
pub const DEFAULT_TOOL_CONCURRENCY: usize = 4;
pub const COMMAND_FOREGROUND_HANDOFF_SECS: u64 = 30;
pub const MAX_ATTACHMENT_BYTES: usize = 1024 * 1024;

/// Fraction of a model's native `contextWindow` (as reported by the gateway's `/models`
/// endpoint) at which the conversation is automatically summarised. Checked against the
/// server-provided context window for the *selected* model on every completed turn —
/// there is no fixed token count, since different models expose very different windows.
pub const COMPACTION_THRESHOLD_RATIO: f64 = 0.8;

/// How often the desktop app refreshes its cached model catalog in the background, so a
/// model added or changed server-side shows up without the user needing to explicitly
/// force a refresh or restart the app.
pub const MODEL_CATALOG_REFRESH_INTERVAL_SECS: u64 = 300;
