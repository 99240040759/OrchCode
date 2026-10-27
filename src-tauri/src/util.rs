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

pub fn stable_hash_hex(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(input.as_bytes());
    format!(
        "{:016x}",
        u64::from_be_bytes(hash[..8].try_into().unwrap_or([0u8; 8]))
    )
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
    if text.len() <= max_chars {
        return text.to_string();
    }
    let head_chars = max_chars * 7 / 10;
    let tail_chars = max_chars - head_chars;
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
    let omitted = if text.is_ascii() {
        tail_start - head_end
    } else {
        text[head_end..tail_start].chars().count()
    };
    format!(
        "{}\n\n[... {omitted} characters omitted ...]\n\n{}",
        &text[..head_end],
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
    std::env::var("PATH").ok().filter(|s| !s.trim().is_empty())
}

pub fn kill_process_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGKILL);
        let _ = libc::kill(pid as i32, libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x08000000)
            .status();
    }
}
