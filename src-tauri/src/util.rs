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
    let canonical_root = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    match path.strip_prefix(&canonical_root) {
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_) => path.to_string_lossy().replace('\\', "/"),
    }
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

pub fn truncate_text(text: &str, limit: usize, suffix: &str) -> String {
    let truncated = truncate_chars(text, limit);
    if truncated.len() < text.len() {
        format!("{truncated}{suffix}")
    } else {
        text.to_string()
    }
}

pub fn clip_middle(text: &str, max_chars: usize) -> String {
    let total = text.chars().count();
    if total <= max_chars {
        return text.to_string();
    }
    let head_chars = max_chars * 7 / 10;
    let tail_chars = max_chars - head_chars;
    let head = truncate_chars(text, head_chars);
    let tail_start = text
        .char_indices()
        .nth(total - tail_chars)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    format!(
        "{head}\n\n[... {} characters omitted ...]\n\n{}",
        total - head_chars - tail_chars,
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

#[cfg(unix)]
fn resolve_login_path() -> Option<String> {
    use std::collections::HashSet;

    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());
    let discovered = query_shell_path(&shell, "-ilc").or_else(|| query_shell_path(&shell, "-lc"));

    let home = std::env::var("HOME").unwrap_or_default();
    let mut entries: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |value: &str| {
        let trimmed = value.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            entries.push(trimmed.to_string());
        }
    };
    if let Some(found) = discovered.as_deref() {
        for part in found.split(':') {
            push(part);
        }
    }
    if let Ok(current) = std::env::var("PATH") {
        for part in current.split(':') {
            push(part);
        }
    }
    let extra = [
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/opt/local/bin".to_string(),
        "/opt/local/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
        format!("{home}/.cargo/bin"),
        format!("{home}/.local/bin"),
        format!("{home}/.bun/bin"),
        format!("{home}/.deno/bin"),
    ];
    for part in &extra {
        if std::path::Path::new(part).is_dir() {
            push(part);
        }
    }
    if entries.is_empty() {
        None
    } else {
        Some(entries.join(":"))
    }
}

#[cfg(unix)]
fn query_shell_path(shell: &str, flags: &str) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    const MARKER: &str = "__ORCH_LOGIN_PATH__";
    let mut child = Command::new(shell)
        .arg(flags)
        .arg(format!("printf '{MARKER}%s{MARKER}' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let raw_bytes = match rx.recv_timeout(Duration::from_secs(6)) {
        Ok(out) => {
            let _ = child.wait();
            out
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    let output = String::from_utf8_lossy(&raw_bytes);
    let start = output.find(MARKER)? + MARKER.len();
    let rest = &output[start..];
    let end = rest.find(MARKER)?;
    let value = rest[..end].trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(not(unix))]
fn resolve_login_path() -> Option<String> {
    None
}

pub fn kill_process_tree(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
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
