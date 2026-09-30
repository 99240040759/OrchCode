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

pub fn http_client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(concat!("Orch/", env!("CARGO_PKG_VERSION")))
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
                .user_agent(concat!("Orch/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(Duration::from_secs(15))
                .build()
                .expect("failed to build streaming http client")
        })
        .clone()
}

pub fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut boundary = index.min(text.len());
    while boundary > 0 && !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

pub fn truncate_chars(text: &str, max_chars: usize) -> &str {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => &text[..end],
        None => text,
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
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(6) => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
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
            .args(["-KILL", &format!("-{pid}")])
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
