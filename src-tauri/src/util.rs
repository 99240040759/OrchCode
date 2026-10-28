use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn now_secs() -> i64 {
    now_ms() / 1000
}

pub fn fast_hash_hex(input: &str) -> String {
    format!("{:016x}", xxhash_rust::xxh3::xxh3_64(input.as_bytes()))
}

pub const USER_AGENT: &str = concat!("Orch/", env!("CARGO_PKG_VERSION"));

pub fn http_client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(120))
                .build()
                .expect("failed to build shared http client")
        })
        .clone()
}

pub fn streaming_http_client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(Duration::from_secs(15))
                .tcp_nodelay(true)
                .build()
                .expect("failed to build streaming http client")
        })
        .clone()
}

pub fn retry_http_client() -> reqwest_middleware::ClientWithMiddleware {
    static CLIENT: OnceLock<reqwest_middleware::ClientWithMiddleware> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let policy = reqwest_retry::policies::ExponentialBackoff::builder()
                .build_with_max_retries(3);
            reqwest_middleware::ClientBuilder::new(http_client())
                .with(reqwest_retry::RetryTransientMiddleware::new_with_policy(policy))
                .build()
        })
        .clone()
}

pub fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

pub fn lowercase_extension(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

pub fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

pub fn display_path(root: Option<&Path>, path: &Path) -> String {
    match root {
        Some(r) => display_relative(r, path),
        None => path.to_string_lossy().replace('\\', "/"),
    }
}

pub fn truncate_chars(text: &str, max_chars: usize) -> &str {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => &text[..end],
        None => text,
    }
}

pub fn clip_middle(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }
    if max_chars == 0 {
        return String::new();
    }
    let marker = "\n\n[... omitted ...]\n\n";
    let marker_chars = marker.chars().count();
    if max_chars <= marker_chars {
        return truncate_chars(text, max_chars).to_string();
    }
    let content_chars = max_chars - marker_chars;
    let head_chars = max_chars.saturating_mul(7) / 10;
    let head_chars = head_chars.min(content_chars);
    let tail_chars = content_chars - head_chars;
    let head_end = match text.char_indices().nth(head_chars) {
        Some((idx, _)) => idx,
        None => return text.to_string(),
    };
    let tail_start = match text.char_indices().rev().nth(tail_chars.saturating_sub(1)) {
        Some((idx, _)) => idx,
        None => return text.to_string(),
    };
    if head_end >= tail_start {
        return text.to_string();
    }
    format!(
        "{}{}{}",
        &text[..head_end],
        marker,
        &text[tail_start..]
    )
}

pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|b| *b == 0)
}

pub fn strip_prefix_ignore_ascii_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    if head.eq_ignore_ascii_case(prefix) {
        text.get(prefix.len()..)
    } else {
        None
    }
}

pub fn login_shell_path() -> Option<&'static str> {
    static PATH: OnceLock<Option<String>> = OnceLock::new();
    PATH.get_or_init(resolve_login_path).as_deref()
}

pub fn warm_login_shell_path() {
    std::thread::spawn(|| {
        let _ = login_shell_path();
    });
}

fn resolve_login_path() -> Option<String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = sender.send(resolve_login_path_from_profiles());
    });
    receiver
        .recv_timeout(Duration::from_secs(3))
        .ok()
        .flatten()
        .or_else(|| std::env::var("PATH").ok().filter(|path| !path.trim().is_empty()))
}

fn resolve_login_path_from_profiles() -> Option<String> {
    if let Ok(mut profiles) = envvars::get_profiles() {
        for profile in &mut profiles {
            if profile.load().is_ok() {
                if let Some(ref vars) = profile.envvars {
                    for (key, value) in vars {
                        if key.eq_ignore_ascii_case("PATH") && !value.trim().is_empty() {
                            return Some(value.clone());
                        }
                    }
                }
            }
        }
    }
    None
}

