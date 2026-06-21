use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
pub fn assert_safe(root: &str, path: &str) -> Result<String> {
    if root.is_empty() { return Err(anyhow!("Workspace root is not set")); }
    let root_buf = PathBuf::from(root);
    let candidate = {
        let p = Path::new(path);
        if p.is_absolute() { PathBuf::from(path) }
        else {
            let clean = path.replace('\\', "/").trim_start_matches('/').to_string();
            root_buf.join(&clean)
        }
    };
    let resolved = candidate.canonicalize().unwrap_or(candidate.clone());
    // Normalize: strip \\?\ UNC prefix, forward-slash, lowercase for Windows-safe comparison
    let norm = |p: &Path| -> String {
        let s = p.to_string_lossy().replace('\\', "/").to_lowercase();
        s.strip_prefix("//?/").unwrap_or(&s).to_string()
    };
    let root_norm = norm(&root_buf.canonicalize().unwrap_or(root_buf.clone()));
    let res_norm = norm(&resolved);
    if !res_norm.starts_with(&root_norm) { return Err(anyhow!("Path '{}' is outside workspace", path)); }
    Ok(resolved.to_string_lossy().to_string())
}
pub fn list_files(root: &str) -> Result<Vec<String>> {
    use ignore::WalkBuilder;
    let root_path = Path::new(root);
    let root_str = root_path.to_string_lossy().replace('\\', "/") + "/";
    let mut files = Vec::new();
    for entry in WalkBuilder::new(root_path)
        .hidden(false).ignore(false).git_ignore(false).git_global(false).git_exclude(false)
        .max_depth(Some(12))
        .filter_entry(|e| {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let name = e.file_name().to_string_lossy();
                return !IGNORED_DIRS.iter().any(|s| *s == name.as_ref());
            }
            true
        }).build().flatten()
    {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let s = entry.path().to_string_lossy().replace('\\', "/");
            let rel = s.trim_start_matches(&root_str).trim_start_matches('/').to_string();
            if !rel.is_empty() { files.push(rel); }
        }
    }
    Ok(files)
}
const TEXT_EXTS: &[&str] = &[
    "rs","ts","tsx","js","jsx","json","toml","yaml","yml","md","txt","csv","html","css","scss",
    "xml","svg","sh","bash","zsh","fish","bat","cmd","ps1","py","rb","go","java","kt","kts",
    "dart","swift","c","cpp","h","hpp","cs","fs","lua","r","pl","php","sql","graphql","proto",
    "vue","svelte","astro","zig","nim","ex","exs","erl","hs","ml","mli","clj","cljs","scala",
    "tf","hcl","conf","ini","env","lock","log","makefile","dockerfile","gitignore","editorconfig",
];
pub fn is_binary(bytes: &[u8], path: Option<&Path>) -> bool {
    if let Some(p) = path {
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if TEXT_EXTS.contains(&ext.as_str()) { return false; }
        if p.file_name().and_then(|n| n.to_str()).map(|n| n.to_lowercase())
            .map(|n| TEXT_EXTS.iter().any(|e| n == *e)).unwrap_or(false) { return false; }
    }
    if bytes.is_empty() { return false; }
    let sample = &bytes[..bytes.len().min(8192)];
    if let Some(kind) = infer::get(sample) {
        let m = kind.mime_type();
        if m.starts_with("image/") || m.starts_with("video/") || m.starts_with("audio/")
            || m == "application/pdf" || m == "application/zip" || m == "application/x-executable" {
            return true;
        }
    }
    sample.iter().filter(|&&b| b < 9 || (b > 13 && b < 32) || b == 127).count() as f64 / sample.len() as f64 > 0.30
}
pub fn mime_type(path: &Path) -> String {
    mime_guess::from_path(path).first_or_octet_stream().to_string()
}
pub fn invalidate_cache() {
    if let Ok(mut c) = FILE_CACHE.lock() { c.clear(); }
}
/// BUG-9: invalidate cache for a specific workspace only
pub fn invalidate_cache_for(root: &str) {
    let key = root.replace('\\', "/");
    if let Ok(mut c) = FILE_CACHE.lock() { c.remove(&key); }
}
use std::sync::LazyLock;
use std::sync::Mutex;
use std::collections::HashMap;
use std::time::{Duration, Instant};
pub const IGNORED_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".next", ".nuxt",
    "__pycache__", ".dart_tool", "vendor", ".gradle", "coverage", ".cache",
    "out", ".output", ".venv",
];
// BUG-9: per-workspace cache map instead of single entry
static FILE_CACHE: LazyLock<Mutex<HashMap<String, (Vec<String>, Instant)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
const TTL: Duration = Duration::from_secs(10);
pub fn list_files_cached(root: &str) -> Result<Vec<String>> {
    let key = root.replace('\\', "/");
    {
        let cache = FILE_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((files, ts)) = cache.get(&key) {
            if ts.elapsed() < TTL { return Ok(files.clone()); }
        }
    }
    let files = list_files(root)?;
    if let Ok(mut c) = FILE_CACHE.lock() {
        c.insert(key, (files.clone(), Instant::now()));
        // Limit cache size to 10 workspaces
        if c.len() > 10 {
            if let Some(oldest) = c.iter().min_by_key(|(_, (_, ts))| *ts).map(|(k, _)| k.clone()) {
                c.remove(&oldest);
            }
        }
    }
    Ok(files)
}
