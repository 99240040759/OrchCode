use anyhow::{anyhow, Result};
use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::{collections::HashSet, path::Path};
use thiserror::Error;
use tokio::fs;

#[derive(Debug, Error)]
#[error("{0}")]
pub struct ToolError(pub String);
impl From<anyhow::Error> for ToolError { fn from(e: anyhow::Error) -> Self { Self(e.to_string()) } }
impl From<String> for ToolError { fn from(e: String) -> Self { Self(e) } }
impl From<&str> for ToolError { fn from(e: &str) -> Self { Self(e.to_string()) } }
impl From<std::io::Error> for ToolError { fn from(e: std::io::Error) -> Self { Self(e.to_string()) } }
impl From<reqwest::Error> for ToolError { fn from(e: reqwest::Error) -> Self { Self(e.to_string()) } }
impl From<base64::DecodeError> for ToolError { fn from(e: base64::DecodeError) -> Self { Self(e.to_string()) } }
impl From<serde_json::Error> for ToolError { fn from(e: serde_json::Error) -> Self { Self(e.to_string()) } }
impl From<zip::result::ZipError> for ToolError { fn from(e: zip::result::ZipError) -> Self { Self(e.to_string()) } }

macro_rules! te { ($($t:tt)*) => { ToolError(format!($($t)*)) } }
macro_rules! bail_te { ($($t:tt)*) => { return Err(te!($($t)*)) } }

// ─── AST helpers ──────────────────────────────────────────────────────────────
pub fn ts_lang(ext: &str) -> Option<tree_sitter::Language> {
    match ext {
        "js"|"mjs"|"cjs" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "ts"|"mts"|"cts" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
        "py" => Some(tree_sitter_python::LANGUAGE.into()),
        "go" => Some(tree_sitter_go::LANGUAGE.into()),
        "json" => Some(tree_sitter_json::LANGUAGE.into()),
        "css" => Some(tree_sitter_css::LANGUAGE.into()),
        "html" => Some(tree_sitter_html::LANGUAGE.into()),
        _ => None,
    }
}

fn check_syntax(path: &Path, content: &str) -> Vec<String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let Some(lang) = ts_lang(ext) else { return vec![]; };
    let mut p = tree_sitter::Parser::new();
    if p.set_language(&lang).is_err() { return vec![]; }
    match p.parse(content, None) {
        Some(t) if t.root_node().has_error() => vec!["Syntax error detected".into()],
        None => vec!["Parse failed".into()],
        _ => vec![],
    }
}

fn collect_tokens(node: tree_sitter::Node, src: &str, out: &mut Vec<(String, usize, usize)>) {
    if node.child_count() == 0 {
        let t = &src[node.start_byte()..node.end_byte()];
        if !t.trim().is_empty() { out.push((t.to_string(), node.start_byte(), node.end_byte())); }
        return;
    }
    let mut c = node.walk();
    for child in node.children(&mut c) { collect_tokens(child, src, out); }
}

fn ast_replace(content: &str, target: &str, replacement: &str, lang: &tree_sitter::Language) -> Result<String> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(lang)?;
    let ftree = parser.parse(content, None).ok_or_else(|| anyhow!("parse failed"))?;
    let ttree = parser.parse(target, None).ok_or_else(|| anyhow!("parse target failed"))?;
    let mut ftoks: Vec<(String, usize, usize)> = Vec::new();
    let mut ttoks: Vec<(String, usize, usize)> = Vec::new();
    collect_tokens(ftree.root_node(), content, &mut ftoks);
    collect_tokens(ttree.root_node(), target, &mut ttoks);
    if ttoks.is_empty() || ftoks.len() < ttoks.len() { return Err(anyhow!("not enough tokens")); }
    let n = ttoks.len();
    let mut best: Option<(f64, usize, usize)> = None;
    for i in 0..=(ftoks.len() - n) {
        let matched = (0..n).filter(|&j| {
            ftoks[i+j].0.replace(|c: char| c.is_whitespace(), "") == ttoks[j].0.replace(|c: char| c.is_whitespace(), "")
        }).count();
        let score = matched as f64 / n as f64;
        if score >= 0.85 && best.as_ref().map(|(s,_,_)| score > *s).unwrap_or(true) {
            best = Some((score, ftoks[i].1, ftoks[i+n-1].2));
        }
    }
    let (_, sb, eb) = best.ok_or_else(|| anyhow!("no AST match"))?;
    Ok(format!("{}{}{}", &content[..sb], replacement, &content[eb..]))
}

// ─── LIST DIR ─────────────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
pub struct ListDirArgs { pub directory_path: String }

#[derive(Serialize)]
struct DirEntry { name: String, relative_path: String, is_directory: bool, size_bytes: Option<u64>, extension: Option<String> }

pub struct ListDir { pub workspace_root: String }

impl Tool for ListDir {
    const NAME: &'static str = "list_dir";
    type Error = ToolError;
    type Args = ListDirArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Lists files and subdirectories one level deep. Use before reading unknown directories to understand the structure. Prefer this over search_workspace for exploration.".into(),
            parameters: json!({"type":"object","properties":{"directory_path":{"type":"string","description":"Absolute path to the directory to list. Use the workspace root path for top-level listing."}},"required":["directory_path"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let safe = crate::workspace::assert_safe(&self.workspace_root, &args.directory_path)?;
        let root_str = self.workspace_root.replace('\\', "/") + "/";
        let mut entries = Vec::new();
        let mut rd = fs::read_dir(&safe).await?;
        while let Some(e) = rd.next_entry().await? {
            let name = e.file_name().to_string_lossy().to_string();
            let meta = e.metadata().await?;
            let is_dir = meta.is_dir();
            let full = e.path().to_string_lossy().replace('\\', "/");
            let rel = full.strip_prefix(&root_str).unwrap_or(&full).to_string();
            let ext = if !is_dir { Path::new(&name).extension().map(|x| x.to_string_lossy().into_owned()) } else { None };
            entries.push(DirEntry { name, relative_path: rel, is_directory: is_dir, size_bytes: if !is_dir { Some(meta.len()) } else { None }, extension: ext });
        }
        entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less, (false, true) => std::cmp::Ordering::Greater, _ => a.name.cmp(&b.name),
        });
        Ok(serde_json::to_value(entries).map_err(|e| te!("{e}"))?)
    }
}

// ─── VIEW FILE ────────────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
pub struct ViewFileArgs { pub absolute_path: String, pub start_line: Option<usize>, pub end_line: Option<usize> }

pub struct ViewFile { pub workspace_root: String }

impl Tool for ViewFile {
    const NAME: &'static str = "view_file";
    type Error = ToolError;
    type Args = ViewFileArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Reads file content with line numbers. Max 800 lines per call — paginate large files using start_line/end_line. Automatically extracts text from PDF, DOCX, and XLSX. Binary files return base64.".into(),
            parameters: json!({"type":"object","properties":{
                "absolute_path":{"type":"string","description":"Absolute path to the file to read."},
                "start_line":{"type":"integer","minimum":1,"description":"First line to read (1-indexed, inclusive). Omit to start from line 1."},
                "end_line":{"type":"integer","minimum":1,"description":"Last line to read (1-indexed, inclusive). Omit to auto-read up to 800 lines from start_line."}
            },"required":["absolute_path"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let safe = crate::workspace::assert_safe(&self.workspace_root, &args.absolute_path)?;
        let p = Path::new(&safe);
        if !p.is_file() { bail_te!("Not a file: {safe}"); }
        let bytes = fs::read(p).await?;
        if bytes.len() > 25 * 1024 * 1024 { bail_te!("File exceeds 25MB"); }
        let mime = crate::workspace::mime_type(p);
        if crate::workspace::is_binary(&bytes, Some(p)) {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            let text = match ext.as_str() {
                "pdf" => extract_pdf(&bytes).ok(),
                "docx" => extract_docx(&bytes).ok(),
                "xlsx"|"xls" => extract_xlsx(&bytes).ok(),
                _ => None,
            };
            return match text {
                Some(t) => Ok(json!({"content":t,"is_binary":false,"mime_type":"text/plain","absolute_path":safe,"size_bytes":bytes.len()})),
                None => Ok(json!({"is_binary":true,"mime_type":mime,"base64_content":base64::Engine::encode(&base64::engine::general_purpose::STANDARD,&bytes),"absolute_path":safe,"size_bytes":bytes.len()})),
            };
        }
        let content = String::from_utf8_lossy(&bytes).to_string();
        let lines: Vec<&str> = content.lines().collect();
        let total = lines.len();
        let start = args.start_line.unwrap_or(1).max(1);
        if start > total { bail_te!("start_line {start} exceeds file length {total}"); }
        let end = args.end_line.unwrap_or((start + 799).min(total)).min(total);
        if end - start + 1 > 800 { bail_te!("Max 800 lines per read — use start_line/end_line pagination"); }
        Ok(json!({"content":lines[start-1..end].join("\n"),"total_lines":total,"read_start":start,"read_end":end,"truncated":end<total,"absolute_path":safe,"size_bytes":bytes.len()}))
    }
}

fn extract_pdf(bytes: &[u8]) -> Result<String> {
    let doc = lopdf::Document::load_mem(bytes)?;
    let mut text = String::new();
    let page_count = doc.page_iter().count() as u32;
    for page_num in 1..=page_count {
        if let Ok(t) = doc.extract_text(&[page_num]) { text.push_str(&t); text.push('\n'); }
    }
    Ok(text)
}

fn extract_docx(bytes: &[u8]) -> Result<String> {
    use std::io::{Cursor, Read};
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
    let mut file = archive.by_name("word/document.xml")?;
    let mut xml = String::new();
    file.read_to_string(&mut xml)?;
    let text = xml.split('<').skip(1).filter_map(|chunk| {
        let end = chunk.find('>')?;
        let rest = &chunk[end+1..];
        if !rest.trim().is_empty() { Some(rest.to_string()) } else { None }
    }).collect::<Vec<_>>().join(" ");
    Ok(text)
}

fn extract_xlsx(bytes: &[u8]) -> Result<String> {
    use calamine::{open_workbook_from_rs, Reader, Xlsx};
    let mut wb: Xlsx<_> = open_workbook_from_rs(std::io::Cursor::new(bytes))?;
    let mut text = String::new();
    for name in wb.sheet_names().to_owned() {
        if let Ok(range) = wb.worksheet_range(&name) {
            text.push_str(&format!("Sheet: {name}\n"));
            for row in range.rows() { text.push_str(&row.iter().map(|c| c.to_string()).collect::<Vec<_>>().join("\t")); text.push('\n'); }
        }
    }
    Ok(text)
}

// ─── WRITE TO FILE ────────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
pub struct WriteFileArgs { pub target_file: String, pub code_content: String, pub overwrite: Option<bool> }

pub struct WriteToFile { pub workspace_root: String }

impl Tool for WriteToFile {
    const NAME: &'static str = "write_to_file";
    type Error = ToolError;
    type Args = WriteFileArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Creates a new file or fully replaces an existing one. Use for new files or complete rewrites. For targeted edits to existing files prefer multi_replace_file_content.".into(),
            parameters: json!({"type":"object","properties":{
                "target_file":{"type":"string","description":"Absolute path for the file to create or overwrite."},
                "code_content":{"type":"string","description":"Full file content to write. Replaces entire file."},
                "overwrite":{"type":"boolean","default":false,"description":"Must be true to replace an existing file. Defaults to false — will error if file already exists."}
            },"required":["target_file","code_content"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let safe = crate::workspace::assert_safe(&self.workspace_root, &args.target_file)?;
        let p = Path::new(&safe);
        // H9: use is_file() to avoid following symlinks outside workspace
        let exists = p.is_file();
        if exists && !args.overwrite.unwrap_or(false) { bail_te!("File exists. Set overwrite=true."); }
        if let Some(parent) = p.parent() { fs::create_dir_all(parent).await?; }
        let content = args.code_content.replace("\r\n", "\n");
        fs::write(p, &content).await?;
        crate::workspace::invalidate_cache();
        Ok(json!({"success":true,"absolute_path":safe,"created":!exists,"syntax_errors":check_syntax(p,&content)}))
    }
}

// ─── MULTI REPLACE ───────────────────────────────────────────────────────────
#[derive(Deserialize, Clone, Default)]
pub struct EditChunk { pub target_content: String, pub replacement_content: String }

#[derive(Deserialize, Default)]
pub struct MultiReplaceArgs { pub target_file: String, pub replacement_chunks: Vec<EditChunk> }

pub struct MultiReplace { pub workspace_root: String }

impl Tool for MultiReplace {
    const NAME: &'static str = "multi_replace_file_content";
    type Error = ToolError;
    type Args = MultiReplaceArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Surgically edits specific blocks within an existing file using AST-aware fuzzy matching (85% token threshold). Safer than write_to_file for partial changes — each chunk independently finds and replaces one section.".into(),
            parameters: json!({"type":"object","properties":{
                "target_file":{"type":"string","description":"Absolute path to the file to edit."},
                "replacement_chunks":{"type":"array","description":"Ordered list of find-and-replace operations. Applied sequentially.","items":{"type":"object","properties":{
                    "target_content":{"type":"string","description":"Exact text block to find. Must be unique in the file — include surrounding context lines if needed. Uses fuzzy AST matching at 85% threshold."},
                    "replacement_content":{"type":"string","description":"New text to substitute in place of target_content."}
                },"required":["target_content","replacement_content"]}}
            },"required":["target_file","replacement_chunks"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let safe = crate::workspace::assert_safe(&self.workspace_root, &args.target_file)?;
        let p = Path::new(&safe);
        let raw = fs::read(p).await?;
        let crlf = raw.windows(2).any(|w| w == b"\r\n");
        let mut content = String::from_utf8_lossy(&raw).replace("\r\n", "\n");
        let lang = p.extension().and_then(|e| e.to_str()).and_then(ts_lang);
        for chunk in &args.replacement_chunks {
            content = apply_chunk(content, chunk, lang.as_ref())?;
        }
        fs::write(p, if crlf { content.replace('\n', "\r\n") } else { content.clone() }).await?;
        crate::workspace::invalidate_cache();
        Ok(json!({"success":true,"absolute_path":safe,"chunks_applied":args.replacement_chunks.len(),"syntax_errors":check_syntax(p,&content)}))
    }
}

fn apply_chunk(content: String, chunk: &EditChunk, lang: Option<&tree_sitter::Language>) -> Result<String, ToolError> {
    if let Some(lang) = lang {
        if let Ok(r) = ast_replace(&content, &chunk.target_content, &chunk.replacement_content, lang) { return Ok(r); }
    }
    match content.matches(&chunk.target_content).count() {
        0 => Err(te!("Target content not found:\n{}", &chunk.target_content[..chunk.target_content.len().min(120)])),
        1 => Ok(content.replacen(&chunk.target_content, &chunk.replacement_content, 1)),
        n => Err(te!("Target content found {n} times — add more context to uniquely identify it")),
    }
}

// ─── SEARCH WORKSPACE ────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
pub struct SearchArgs { pub query: String, pub mode: Option<String>, pub includes: Option<Vec<String>> }

pub struct SearchWorkspace { pub workspace_root: String, pub pool: SqlitePool, pub workspace_id: String }

impl Tool for SearchWorkspace {
    const NAME: &'static str = "search_workspace";
    type Error = ToolError;
    type Args = SearchArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Searches workspace files. Use mode='regex' (default) for exact pattern/symbol/string search. Use mode='semantic' for natural-language conceptual queries — searches against pre-indexed embeddings and returns the most relevant code chunks.".into(),
            parameters: json!({"type":"object","properties":{
                "query":{"type":"string","description":"Regex pattern for mode=regex (e.g. 'fn\\s+handle_error'). Natural language description for mode=semantic (e.g. 'authentication token refresh logic')."},
                "mode":{"type":"string","enum":["regex","semantic"],"description":"'regex' (default): fast exact/pattern match across all files. 'semantic': embedding-based similarity search using indexed workspace chunks — good for conceptual queries."},
                "includes":{"type":"array","items":{"type":"string"},"description":"Glob patterns to restrict search scope, e.g. ['*.rs'] or ['src/**/*.ts']. Omit to search all files."}
            },"required":["query"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let mode = args.mode.as_deref().unwrap_or("regex");
        if mode == "semantic" {
            if self.workspace_id.is_empty() { bail_te!("No workspace indexed — open a workspace first"); }
            let results = crate::rag::search(&self.pool, &self.workspace_id, &args.query, 8)
                .await.map_err(|e| te!("{e}"))?;
            if results.is_empty() { return Ok(json!({"results":"No semantic matches found.","mode":"semantic"})); }
            let out: Vec<Value> = results.iter().map(|r| json!({
                "file": r.file_path, "score": r.score, "chunk": r.chunk_text
            })).collect();
            return Ok(json!({"results":out,"mode":"semantic","count":out.len()}));
        }
        use grep_regex::RegexMatcher;
        use grep_searcher::{SearcherBuilder, sinks::UTF8};
        use ignore::overrides::OverrideBuilder;
        use crate::workspace::IGNORED_DIRS;
        let matcher = RegexMatcher::new_line_matcher(&args.query).map_err(|e| te!("Invalid regex: {e}"))?;
        let root = Path::new(&self.workspace_root);
        let root_str = root.to_string_lossy().replace('\\', "/") + "/";
        let mut wb = ignore::WalkBuilder::new(root);
        wb.hidden(false).ignore(true).git_ignore(true)
          .filter_entry(|e| {
              if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                  let name = e.file_name().to_string_lossy();
                  return !IGNORED_DIRS.iter().any(|s| *s == name.as_ref());
              }
              true
          });
        if let Some(ref globs) = args.includes {
            let mut ov = OverrideBuilder::new(root);
            for g in globs { ov.add(g).map_err(|e| te!("{e}"))?; }
            wb.overrides(ov.build().map_err(|e| te!("{e}"))?);
        }
        let mut lines = Vec::new();
        let mut truncated = false;
        for entry in wb.build().flatten() {
            if lines.len() >= 200 { truncated = true; break; }
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }
            let ps = entry.path().to_string_lossy().replace('\\', "/");
            let rel = ps.strip_prefix(&root_str).unwrap_or(&ps).to_string();
            let mut s = SearcherBuilder::new().line_number(true).build();
            let _ = s.search_path(&matcher, entry.path(), UTF8(|n, l| {
                if lines.len() < 200 { lines.push(format!("{rel}:{n}:{}", l.trim_end())); } else { truncated = true; }
                Ok(true)
            }));
        }
        Ok(json!({"results":if lines.is_empty(){"No matches found.".into()}else{lines.join("\n")},"truncated":truncated,"mode":"regex"}))
    }
}

// ─── RUN COMMAND ─────────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
pub struct RunCmdArgs { pub command_line: String, pub cwd: Option<String>, pub wait_ms_before_async: Option<u64> }

pub struct RunCommand { pub workspace_root: String }

// C5: blocked list — shell interpreters removed since the agent needs to run commands
// Only truly dangerous system commands are blocked
fn blocked() -> HashSet<&'static str> {
    ["shutdown","reboot","init","mkfs","fdisk","format","dd","passwd","chroot",
     "nslookup","dig","whoami"].into_iter().collect()
}


impl Tool for RunCommand {
    const NAME: &'static str = "run_command";
    type Error = ToolError;
    type Args = RunCmdArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Executes a terminal command in the workspace via the system shell (cmd.exe on Windows, sh on Unix). Supports pipes, redirects, and shell builtins. Returns stdout, stderr, and exit code.".into(),
            parameters: json!({"type":"object","properties":{
                "command_line":{"type":"string","description":"The command to run. Supports shell features like pipes, redirects, &&. Example: 'cargo build --release'"},
                "cwd":{"type":"string","description":"Working directory as an absolute path within the workspace. Defaults to workspace root."},
                "wait_ms_before_async":{"type":"integer","minimum":0,"maximum":180000,"description":"Milliseconds to wait for output before returning (0–180000). Use 60000 for most commands. Increase for long builds."}
            },"required":["command_line"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let tokens = shell_words::split(&args.command_line).map_err(|e| te!("{e}"))?;
        if tokens.is_empty() { bail_te!("Empty command"); }
        for t in &tokens {
            let base = Path::new(t).file_stem().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if blocked().contains(base.as_str()) || blocked().contains(t.to_lowercase().as_str()) { bail_te!("Command '{t}' is blocked"); }
        }
        let cwd = match &args.cwd {
            Some(c) => crate::workspace::assert_safe(&self.workspace_root, c)?,
            None => self.workspace_root.clone(),
        };
        let ms = args.wait_ms_before_async.unwrap_or(60_000);
        let timeout = std::time::Duration::from_millis(ms);
        // Run through shell so builtins (echo, cd, dir, etc.) work
        #[cfg(target_os = "windows")]
        let mut cmd = { let mut c = tokio::process::Command::new("cmd"); c.args(&["/C", &args.command_line]); c };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = { let mut c = tokio::process::Command::new("sh"); c.args(&["-c", &args.command_line]); c };
        cmd.current_dir(&cwd).env("FORCE_COLOR","1").env("PAGER","cat").kill_on_drop(true);
        #[cfg(target_os = "windows")] {
            #[allow(unused_imports)] use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let out = tokio::time::timeout(timeout, cmd.output()).await
            .map_err(|_| te!("Timed out after {ms}ms"))?
            .map_err(|e| te!("Failed to run: {e}"))?;
        crate::workspace::invalidate_cache();
        Ok(json!({"stdout":String::from_utf8_lossy(&out.stdout),"stderr":String::from_utf8_lossy(&out.stderr),"exit_code":out.status.code().unwrap_or(-1),"success":out.status.success(),"cwd":cwd}))
    }
}

// ─── SEARCH WEB ───────────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
pub struct SearchWebArgs { pub query: String, pub domain: Option<String>, pub max_results: Option<u32>, pub search_depth: Option<String>, pub topic: Option<String>, pub include_images: Option<bool> }

pub struct SearchWeb;
impl Tool for SearchWeb {
    const NAME: &'static str = "search_web";
    type Error = ToolError;
    type Args = SearchWebArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Searches the web via Tavily API. Use for documentation, library APIs, current events, or anything not in the codebase.".into(),
            parameters: json!({"type":"object","properties":{
                "query":{"type":"string","description":"Search query."},
                "domain":{"type":"string","description":"Optional domain to restrict results, e.g. 'docs.rs' or 'developer.mozilla.org'."},
                "max_results":{"type":"integer","description":"Number of results to return (default 5)."},
                "search_depth":{"type":"string","enum":["basic","advanced"],"description":"'basic' for fast results, 'advanced' for deeper analysis (slower)."},
                "topic":{"type":"string","enum":["general","news"],"description":"'general' for documentation/code, 'news' for recent events."},
                "include_images":{"type":"boolean","description":"Whether to include image results."}
            },"required":["query"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = crate::auth::require_token_async().await?;
        Ok(crate::utils::authed_client(&token)
            .post(format!("{}/tavily", crate::utils::gcp_base()))
            .json(&json!({"query":args.query,"domain":args.domain,"maxResults":args.max_results.unwrap_or(5),"searchDepth":args.search_depth.unwrap_or_else(||"basic".into()),"topic":args.topic.unwrap_or_else(||"general".into()),"includeImages":args.include_images.unwrap_or(false)}))
            .send().await?.error_for_status()?.json().await?)
    }
}

// ─── GENERATE IMAGE ───────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
pub struct GenImageArgs { pub prompt: String, pub width: Option<u32>, pub height: Option<u32>, pub seed: Option<u64>, pub steps: Option<u32> }

pub struct GenerateImage { pub artifacts_path: String }
impl Tool for GenerateImage {
    const NAME: &'static str = "generate_image";
    type Error = ToolError;
    type Args = GenImageArgs;
    type Output = Value;
    async fn definition(&self, _: String) -> ToolDefinition {
        ToolDefinition { name: Self::NAME.into(),
            description: "Generates an image from a text prompt and saves it as a PNG to the artifacts directory. Use for UI mockups, diagrams, icons, or visual assets.".into(),
            parameters: json!({"type":"object","properties":{
                "prompt":{"type":"string","description":"Detailed description of the image. More specific prompts produce better results."},
                "width":{"type":"integer","description":"Image width in pixels (rounded to nearest 16, clamped 512–1568). Default 1024."},
                "height":{"type":"integer","description":"Image height in pixels (rounded to nearest 16, clamped 512–1568). Default 1024."},
                "seed":{"type":"integer","description":"Optional seed for reproducible output."},
                "steps":{"type":"integer","description":"Generation steps (default 4). Higher = better quality but slower."}
            },"required":["prompt"]}) }
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let snap = |v: u32| ((v as f64/16.0).round() as u32 * 16).clamp(512, 1568);
        let (w, h) = (snap(args.width.unwrap_or(1024)), snap(args.height.unwrap_or(1024)));
        let token = crate::auth::require_token_async().await?;
        let resp: Value = crate::utils::authed_client(&token)
            .post(format!("{}/generate-image", crate::utils::gcp_base()))
            .json(&json!({"prompt":args.prompt,"width":w,"height":h,"seed":args.seed.unwrap_or(0),"steps":args.steps.unwrap_or(4)}))
            .send().await?.error_for_status()?.json().await?;
        let b64 = resp["data"][0]["b64_json"].as_str()
            .or_else(|| resp["artifacts"][0]["base64"].as_str())
            .ok_or_else(|| te!("No image data returned"))?;
        fs::create_dir_all(&self.artifacts_path).await?;
        let name = format!("img-{}.png", chrono::Utc::now().timestamp_millis());
        let path = Path::new(&self.artifacts_path).join(&name);
        fs::write(&path, base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)?).await?;
        Ok(json!({"success":true,"file_path":path.to_string_lossy(),"filename":name}))
    }
}
