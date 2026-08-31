use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use circular_buffer::CircularBuffer;
use command_group::AsyncCommandGroup;
use ignore::WalkBuilder;
use path_clean::PathClean;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::events::{ToolDisplayInfo, ToolIcon};
use crate::gateway::{Gateway, TavilyRequest};
use crate::skills::load_all_skills;
use crate::state::WorkspaceHandle;

pub const TOOL_ERROR_SENTINEL: &str = "[[tool-error]] ";
pub const FILE_SIZE_LIMIT: u64 = 10 * 1024 * 1024;
pub const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".next",
    ".turbo",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
];

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("[[tool-error]] {0}")]
    Msg(String),
}

impl ToolError {
    pub fn msg(s: impl Into<String>) -> Self {
        ToolError::Msg(s.into())
    }
}

impl From<AppError> for ToolError {
    fn from(e: AppError) -> Self {
        ToolError::Msg(e.to_string())
    }
}

pub fn tool_output_is_error(output: &str) -> bool {
    output.starts_with(TOOL_ERROR_SENTINEL)
}

pub fn strip_tool_error_sentinel(output: &str) -> &str {
    output.strip_prefix(TOOL_ERROR_SENTINEL).unwrap_or(output)
}

pub fn workspace_root(handle: &WorkspaceHandle) -> Result<PathBuf, ToolError> {
    match handle.read() {
        Err(_) => Err(ToolError::msg("workspace state lock is poisoned")),
        Ok(guard) => guard.clone().ok_or_else(|| ToolError::msg("no workspace is open")),
    }
}

pub mod fs_util {
    use super::*;

    pub fn workspace_walker(root: &Path) -> WalkBuilder {
        let mut builder = WalkBuilder::new(root);
        builder
            .git_ignore(true)
            .git_global(false)
            .git_exclude(true)
            .hidden(false)
            .follow_links(false)
            .filter_entry(|entry| {
                if entry.depth() == 0 {
                    return true;
                }
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    return true;
                }
                let name = entry.file_name().to_string_lossy();
                !SKIP_DIRS.contains(&name.as_ref())
            });
        builder
    }

    pub fn resolve_in_workspace(root: &Path, input: &str) -> AppResult<PathBuf> {
        let canonical_root = dunce::canonicalize(root)?;
        let raw = Path::new(input);
        let joined = if raw.is_absolute() {
            raw.to_path_buf()
        } else {
            canonical_root.join(raw)
        };

        let cleaned = joined.clean();

        if let Ok(canonical) = dunce::canonicalize(&cleaned) {
            if !canonical.starts_with(&canonical_root) {
                return Err(AppError::PathEscapesWorkspace(input.to_string()));
            }
            return Ok(canonical);
        }

        if !cleaned.starts_with(&canonical_root) {
            return Err(AppError::PathEscapesWorkspace(input.to_string()));
        }

        Ok(cleaned)
    }

    pub fn resolve_existing_file(root: &Path, input: &str) -> AppResult<PathBuf> {
        let resolved = resolve_in_workspace(root, input)?;
        let metadata = std::fs::metadata(&resolved)?;
        if !metadata.is_file() {
            return Err(AppError::Other(format!("not a file: {input}")));
        }
        Ok(resolved)
    }

    pub fn check_file_size(path: &Path) -> AppResult<u64> {
        let meta = std::fs::metadata(path)?;
        let size = meta.len();
        if size > FILE_SIZE_LIMIT {
            return Err(AppError::FileTooLarge(format!(
                "{}: {size} bytes exceeds limit of {FILE_SIZE_LIMIT} bytes",
                path.display()
            )));
        }
        Ok(size)
    }

    pub fn display_relative(root: &Path, path: &Path) -> String {
        let canonical_root = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        match path.strip_prefix(&canonical_root) {
            Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
            Err(_) => path.to_string_lossy().replace('\\', "/"),
        }
    }

    pub async fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
        let target_path = path.to_path_buf();
        let bytes = content.to_vec();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            use std::io::Write;
            let parent = target_path
                .parent()
                .ok_or_else(|| AppError::other("target path has no parent directory"))?;
            let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(AppError::Io)?;
            tmp.write_all(&bytes).map_err(AppError::Io)?;
            tmp.as_file().sync_all().map_err(AppError::Io)?;
            tmp.persist(&target_path).map_err(|e| AppError::Io(e.error))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::other(format!("atomic write join failed: {e}")))?
    }
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

fn str_arg(args: &serde_json::Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub fn parse_display_info(name: &str, args_json: &str) -> ToolDisplayInfo {
    let args: serde_json::Value = serde_json::from_str(args_json).unwrap_or_default();
    let tool_name = name.rsplit(':').next().unwrap_or(name);

    match tool_name {
        "read_file" => {
            let path = str_arg(&args, "path");
            let start = args.get("start_line").and_then(|n| n.as_u64());
            let end = args.get("end_line").and_then(|n| n.as_u64());
            let line_range = match (start, end) {
                (Some(s), Some(e)) => Some(format!("#L{s}-{e}")),
                (Some(s), None) => Some(format!("#L{s}")),
                _ => None,
            };
            ToolDisplayInfo {
                label: "Read".to_string(),
                filename: path.as_deref().map(basename),
                full_path: path,
                line_range,
                icon: ToolIcon::File,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "write_file" => {
            let path = str_arg(&args, "path");
            let added_lines = args
                .get("content")
                .and_then(|v| v.as_str())
                .map(|c| c.lines().count() as u32)
                .filter(|n| *n > 0);
            ToolDisplayInfo {
                label: "Wrote".to_string(),
                filename: path.as_deref().map(basename),
                full_path: path,
                added_lines,
                icon: ToolIcon::File,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "multi_replace_file_content" => {
            let path = str_arg(&args, "path");
            let mut added: u32 = 0;
            let mut removed: u32 = 0;
            if let Some(arr) = args.get("replacements").and_then(|v| v.as_array()) {
                for r in arr {
                    removed += r
                        .get("old_string")
                        .and_then(|s| s.as_str())
                        .map(|s| s.lines().count() as u32)
                        .unwrap_or(0);
                    added += r
                        .get("new_string")
                        .and_then(|s| s.as_str())
                        .map(|s| s.lines().count() as u32)
                        .unwrap_or(0);
                }
            }
            ToolDisplayInfo {
                label: "Edited".to_string(),
                filename: path.as_deref().map(basename),
                full_path: path,
                added_lines: if added > 0 { Some(added) } else { None },
                removed_lines: if removed > 0 { Some(removed) } else { None },
                icon: ToolIcon::File,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "run_command" => ToolDisplayInfo {
            label: "Ran".to_string(),
            target_text: str_arg(&args, "command"),
            icon: ToolIcon::Terminal,
            opens_artifact: false,
            ..Default::default()
        },

        "stop_command" => ToolDisplayInfo {
            label: "Stopped Task".to_string(),
            target_text: str_arg(&args, "task_id"),
            icon: ToolIcon::ZapOff,
            opens_artifact: false,
            ..Default::default()
        },

        "get_command_status" => ToolDisplayInfo {
            label: "Task Status".to_string(),
            target_text: str_arg(&args, "task_id"),
            icon: ToolIcon::Cpu,
            opens_artifact: false,
            ..Default::default()
        },

        "read_skill" => ToolDisplayInfo {
            label: "Read Skill".to_string(),
            target_text: str_arg(&args, "name"),
            icon: ToolIcon::Book,
            opens_artifact: false,
            ..Default::default()
        },

        "web_search" => ToolDisplayInfo {
            label: "Searched Web".to_string(),
            target_text: str_arg(&args, "query"),
            icon: ToolIcon::Globe,
            opens_artifact: false,
            ..Default::default()
        },

        "search_workspace" => ToolDisplayInfo {
            label: "Searched Code".to_string(),
            target_text: str_arg(&args, "query"),
            icon: ToolIcon::Search,
            opens_artifact: false,
            ..Default::default()
        },

        "list_dir" => ToolDisplayInfo {
            label: "Listed".to_string(),
            target_text: str_arg(&args, "path"),
            full_path: str_arg(&args, "path"),
            icon: ToolIcon::Folder,
            opens_artifact: false,
            ..Default::default()
        },

        "search_documents" => ToolDisplayInfo {
            label: "Searched Docs".to_string(),
            target_text: str_arg(&args, "query"),
            icon: ToolIcon::Search,
            opens_artifact: false,
            ..Default::default()
        },

        "connector_search" => ToolDisplayInfo {
            label: format!("{}: Search", str_arg(&args, "provider").unwrap_or_else(|| "Connector".to_string())),
            target_text: str_arg(&args, "query"),
            icon: ToolIcon::Search,
            opens_artifact: false,
            ..Default::default()
        },

        "connector_read" => ToolDisplayInfo {
            label: format!("{}: Read", str_arg(&args, "provider").unwrap_or_else(|| "Connector".to_string())),
            target_text: str_arg(&args, "target"),
            icon: ToolIcon::File,
            opens_artifact: false,
            ..Default::default()
        },

        "connector_list" => ToolDisplayInfo {
            label: format!("{}: List", str_arg(&args, "provider").unwrap_or_else(|| "Connector".to_string())),
            target_text: str_arg(&args, "container"),
            icon: ToolIcon::Folder,
            opens_artifact: false,
            ..Default::default()
        },

        other => ToolDisplayInfo {
            label: other.to_string(),
            target_text: Some(args_json.chars().take(120).collect()),
            icon: ToolIcon::Terminal,
            opens_artifact: false,
            ..Default::default()
        },
    }
}

const OUTPUT_RING_BYTES: usize = 100 * 1024;
const TASK_MAX_AGE: Duration = Duration::from_secs(3600);

#[derive(Clone, Debug)]
pub struct TaskStatus {
    pub task_id: String,
    pub command: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub output: String,
    pub elapsed_secs: u64,
}

struct InnerTask {
    task_id: String,
    command: String,
    status: String,
    exit_code: Option<i32>,
    output: RingBuffer,
    started_at: Instant,
    kill_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

struct RingBuffer {
    data: CircularBuffer<OUTPUT_RING_BYTES, u8>,
}

impl RingBuffer {
    fn new() -> Self {
        Self {
            data: CircularBuffer::new(),
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.data.extend(bytes.iter().copied());
    }

    fn as_string(&mut self) -> String {
        String::from_utf8_lossy(self.data.make_contiguous()).to_string()
    }
}

#[derive(Clone, Default)]
pub struct CommandManager {
    tasks: Arc<Mutex<HashMap<String, Arc<Mutex<InnerTask>>>>>,
}

impl CommandManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn_task(&self, command_str: &str, cwd: &Path) -> (String, Arc<Notify>) {
        self.prune_old_tasks();

        let task_id = format!("task-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
        let done = Arc::new(Notify::new());
        let inner = Arc::new(Mutex::new(InnerTask {
            task_id: task_id.clone(),
            command: command_str.to_string(),
            status: "running".to_string(),
            exit_code: None,
            output: RingBuffer::new(),
            started_at: Instant::now(),
            kill_tx: Some(kill_tx),
        }));

        {
            let mut guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            guard.insert(task_id.clone(), inner.clone());
        }

        let cmd_str = command_str.to_string();
        let cwd_buf = cwd.to_path_buf();
        let done_signal = done.clone();

        tokio::spawn(async move {
            #[cfg(target_os = "windows")]
            let mut cmd = Command::new("powershell.exe");
            #[cfg(target_os = "windows")]
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &cmd_str])
                .current_dir(&cwd_buf)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .creation_flags(0x08000000)
                .kill_on_drop(true);

            #[cfg(not(target_os = "windows"))]
            let mut cmd = Command::new("sh");
            #[cfg(not(target_os = "windows"))]
            cmd.args(["-c", &cmd_str])
                .current_dir(&cwd_buf)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);

            let child_res = cmd.group_spawn();

            match child_res {
                Ok(mut child) => {
                    let stdout_task = child.inner().stdout.take().map(|out| {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move { pump(out, inner_ref).await })
                    });
                    let stderr_task = child.inner().stderr.take().map(|err| {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move { pump(err, inner_ref).await })
                    });

                    let wait_result = tokio::select! {
                        res = child.wait() => Some(res),
                        _ = kill_rx => {
                            let _ = child.kill();
                            None
                        }
                    };

                    if let Some(handle) = stdout_task {
                        let _ = handle.await;
                    }
                    if let Some(handle) = stderr_task {
                        let _ = handle.await;
                    }

                    if let Ok(mut g) = inner.lock() {
                        g.kill_tx = None;
                        match wait_result {
                            Some(Ok(status)) => {
                                g.exit_code = status.code();
                                g.status = if status.success() {
                                    "completed".to_string()
                                } else {
                                    "failed".to_string()
                                };
                            }
                            Some(Err(e)) => {
                                g.status = "failed".to_string();
                                g.output.push(format!("\nprocess wait error: {e}\n").as_bytes());
                            }
                            None => g.status = "cancelled".to_string(),
                        }
                    }
                }
                Err(e) => {
                    if let Ok(mut g) = inner.lock() {
                        g.kill_tx = None;
                        g.status = "failed".to_string();
                        g.output.push(format!("spawn error: {e}").as_bytes());
                    }
                }
            }

            done_signal.notify_waiters();
        });

        (task_id, done)
    }

    pub fn get_status(&self, task_id: &str) -> Option<TaskStatus> {
        let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        let task = guard.get(task_id)?;
        let mut g = task.lock().unwrap_or_else(|e| e.into_inner());
        let output = g.output.as_string();
        Some(TaskStatus {
            task_id: g.task_id.clone(),
            command: g.command.clone(),
            status: g.status.clone(),
            exit_code: g.exit_code,
            output,
            elapsed_secs: g.started_at.elapsed().as_secs(),
        })
    }

    pub fn kill_task(&self, task_id: &str) -> bool {
        let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        let Some(task) = guard.get(task_id) else {
            return false;
        };
        let mut g = task.lock().unwrap_or_else(|e| e.into_inner());
        match g.kill_tx.take() {
            Some(tx) => tx.send(()).is_ok(),
            None => false,
        }
    }

    pub fn kill_all(&self) {
        let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        for task in guard.values() {
            let mut g = task.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(tx) = g.kill_tx.take() {
                let _ = tx.send(());
            }
        }
    }

    fn prune_old_tasks(&self) {
        let mut guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        guard.retain(|_, task| {
            let g = task.lock().unwrap_or_else(|e| e.into_inner());
            g.status == "running" || g.started_at.elapsed() < TASK_MAX_AGE
        });
    }
}

async fn pump<R>(mut reader: R, inner: Arc<Mutex<InnerTask>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                if let Ok(mut g) = inner.lock() {
                    g.output.push(&buf[..n]);
                }
            }
            Err(_) => break,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    pub path: String,
    #[serde(default)]
    pub start_line: Option<usize>,
    #[serde(default)]
    pub end_line: Option<usize>,
}

pub struct ReadFile {
    workspace: WorkspaceHandle,
}

impl ReadFile {
    pub fn new(workspace: WorkspaceHandle) -> Self {
        Self { workspace }
    }
}

fn mime_for_image(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

pub(crate) fn slice_lines(content: &str, start: Option<usize>, end: Option<usize>) -> String {
    if start.is_none() && end.is_none() {
        return content.to_string();
    }
    let from = start.unwrap_or(1).max(1);
    let to = end.unwrap_or(usize::MAX);
    content
        .lines()
        .enumerate()
        .filter(|(i, _)| {
            let n = i + 1;
            n >= from && n <= to
        })
        .map(|(_, l)| l)
        .collect::<Vec<_>>()
        .join("\n")
}

impl Tool for ReadFile {
    const NAME: &'static str = "read_file";
    type Error = ToolError;
    type Args = ReadFileArgs;
    type Output = String;

    fn description(&self) -> String {
        "Read the contents of any file in the workspace. \
Returns the raw text content. \
Supports text files, source code, config files, markdown, JSON, and binary formats like PDF and images. \
For large files, pass start_line and end_line (1-based, inclusive) to read only the relevant section. \
ALWAYS call this before editing any file."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ReadFileArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;
        let path = fs_util::resolve_in_workspace(&root, &args.path)?;
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        if ext == "pdf" {
            let pdf_path = path.clone();
            let text = tokio::task::spawn_blocking(move || {
                crate::document::extract_pdf_text(&pdf_path, None)
            })
            .await
            .map_err(|e| ToolError::msg(format!("pdf extraction task failed: {e}")))??;
            return Ok(slice_lines(&text, args.start_line, args.end_line));
        }

        if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg") {
            fs_util::check_file_size(&path)?;
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| ToolError::msg(format!("cannot read image {}: {e}", args.path)))?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            return Ok(serde_json::json!({
                "type": "image",
                "data": b64,
                "mimeType": mime_for_image(&ext),
            })
            .to_string());
        }

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot stat {}: {e}", args.path)))?;
        if meta.len() > FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!(
                "file too large ({} bytes): {}",
                meta.len(),
                args.path
            )));
        }

        let file = tokio::fs::File::open(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot open {}: {e}", args.path)))?;
        let mut reader = tokio::io::BufReader::new(file);

        let from = args.start_line.unwrap_or(1).max(1);
        let to = args.end_line.unwrap_or(usize::MAX);

        let mut lines: Vec<String> = Vec::new();
        let mut line_no = 0usize;
        let mut line_buf = String::new();

        loop {
            line_buf.clear();
            let read = reader
                .read_line(&mut line_buf)
                .await
                .map_err(|e| ToolError::msg(format!("read error on {}: {e}", args.path)))?;
            if read == 0 {
                break;
            }
            line_no += 1;
            if line_no >= from && line_no <= to {
                lines.push(
                    line_buf
                        .trim_end_matches(|c| c == '\r' || c == '\n')
                        .to_string(),
                );
            }
            if line_no >= to {
                break;
            }
        }

        Ok(lines.join("\n"))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    pub path: String,
    pub content: String,
}

pub struct WriteFile {
    workspace: WorkspaceHandle,
    app: tauri::AppHandle,
}

impl WriteFile {
    pub fn new(workspace: WorkspaceHandle, app: tauri::AppHandle) -> Self {
        Self { workspace, app }
    }
}

impl Tool for WriteFile {
    const NAME: &'static str = "write_file";
    type Error = ToolError;
    type Args = WriteFileArgs;
    type Output = String;

    fn description(&self) -> String {
        "Create a new file, or completely overwrite an existing file, with the provided content."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(WriteFileArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;

        if args.content.len() as u64 > FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!(
                "content too large ({} bytes) for {}",
                args.content.len(),
                args.path
            )));
        }

        let path = fs_util::resolve_in_workspace(&root, &args.path)?;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                ToolError::msg(format!("cannot create parent dirs for {}: {e}", args.path))
            })?;
        }

        let existed = tokio::fs::try_exists(&path).await.unwrap_or(false);
        let bytes = args.content.len();
        fs_util::atomic_write(&path, args.content.as_bytes()).await?;

        let full_path = path.to_string_lossy().replace('\\', "/");
        let _ = tauri::Emitter::emit(&self.app, "file-written", &full_path);

        let rel = fs_util::display_relative(&root, &path);
        let verb = if existed { "Overwrote" } else { "Created" };
        Ok(format!("{verb} {rel} ({bytes} bytes)"))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct Replacement {
    pub old_string: String,
    pub new_string: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct MultiReplaceArgs {
    pub path: String,
    pub replacements: Vec<Replacement>,
}

pub struct MultiReplaceFileContent {
    workspace: WorkspaceHandle,
    app: tauri::AppHandle,
}

impl MultiReplaceFileContent {
    pub fn new(workspace: WorkspaceHandle, app: tauri::AppHandle) -> Self {
        Self { workspace, app }
    }
}

impl Tool for MultiReplaceFileContent {
    const NAME: &'static str = "multi_replace_file_content";
    type Error = ToolError;
    type Args = MultiReplaceArgs;
    type Output = String;

    fn description(&self) -> String {
        "Edit an existing file by applying one or more exact string replacements in order."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(MultiReplaceArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        if args.replacements.is_empty() {
            return Err(ToolError::msg("no replacements provided"));
        }

        let root = workspace_root(&self.workspace)?;
        let path = fs_util::resolve_in_workspace(&root, &args.path)?;

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot stat {}: {e}", args.path)))?;
        if meta.len() > FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!(
                "file too large to edit: {}",
                args.path
            )));
        }

        let mut content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot read {}: {e}", args.path)))?;

        let mut total = 0usize;
        for (i, r) in args.replacements.iter().enumerate() {
            if r.old_string.is_empty() {
                return Err(ToolError::msg(format!(
                    "replacement #{} has empty old_string",
                    i + 1
                )));
            }
            let count = content.matches(&r.old_string).count();
            if count == 0 {
                return Err(ToolError::msg(format!(
                    "replacement #{} not applied: old_string not found in {}. Re-read the file first.",
                    i + 1,
                    args.path
                )));
            }
            if count > 1 {
                return Err(ToolError::msg(format!(
                    "replacement #{} is ambiguous: old_string matches {count} locations in {}. Expand context.",
                    i + 1,
                    args.path
                )));
            }
            content = content.replace(&r.old_string, &r.new_string);
            total += 1;
        }

        fs_util::atomic_write(&path, content.as_bytes()).await?;

        let full_path = path.to_string_lossy().replace('\\', "/");
        let _ = tauri::Emitter::emit(&self.app, "file-written", &full_path);

        let rel = fs_util::display_relative(&root, &path);
        Ok(format!(
            "Applied {} replacement(s) ({total} occurrence(s)) to {rel}",
            args.replacements.len()
        ))
    }
}

const MAX_SEARCHABLE_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Deserialize, JsonSchema)]
pub struct SearchWorkspaceArgs {
    pub query: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
}

pub struct SearchWorkspace {
    workspace: WorkspaceHandle,
}

impl SearchWorkspace {
    pub fn new(workspace: WorkspaceHandle) -> Self {
        Self { workspace }
    }
}

impl Tool for SearchWorkspace {
    const NAME: &'static str = "search_workspace";
    type Error = ToolError;
    type Args = SearchWorkspaceArgs;
    type Output = String;

    fn description(&self) -> String {
        "Case-insensitive regex search over all files in the workspace."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(SearchWorkspaceArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;
        let search_path = match args.path.as_deref() {
            Some(p) => fs_util::resolve_in_workspace(&root, p)?,
            None => root.clone(),
        };
        let max_hits = args.max_results.unwrap_or(50).clamp(1, 200);
        let query = args.query.clone();
        tokio::task::spawn_blocking(move || search_text(&root, &search_path, &query, max_hits))
            .await
            .map_err(|e| ToolError::msg(format!("search task failed: {e}")))?
    }
}

fn search_text(
    root: &PathBuf,
    search_path: &PathBuf,
    query: &str,
    max_hits: usize,
) -> Result<String, ToolError> {
    let matcher = grep_regex::RegexMatcherBuilder::new()
        .case_insensitive(true)
        .build(query)
        .map_err(|e| ToolError::msg(format!("invalid search pattern: {e}")))?;

    let mut results: Vec<String> = Vec::new();
    let mut searcher = grep_searcher::Searcher::new();

    for entry in fs_util::workspace_walker(search_path).build().flatten() {
        if results.len() >= max_hits {
            break;
        }
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        match entry.metadata() {
            Ok(meta) if meta.len() <= MAX_SEARCHABLE_FILE_BYTES => {}
            _ => continue,
        }

        let file_path = entry.path();
        let rel_path = fs_util::display_relative(root, file_path);
        let results_ref = &mut results;
        let sink = grep_searcher::sinks::UTF8(|line_num, line| {
            results_ref.push(format!("{rel_path}:{line_num}: {}", line.trim()));
            Ok(results_ref.len() < max_hits)
        });
        let _ = searcher.search_path(&matcher, file_path, sink);
    }

    if results.is_empty() {
        Ok(format!("No matches found for pattern: '{query}'"))
    } else {
        Ok(results.join("\n"))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct RunCommandArgs {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub background: Option<bool>,
}

pub struct RunCommand {
    workspace: WorkspaceHandle,
    manager: CommandManager,
}

impl RunCommand {
    pub fn new(workspace: WorkspaceHandle, manager: CommandManager) -> Self {
        Self { workspace, manager }
    }
}

fn format_completed(s: &TaskStatus) -> String {
    let code = s
        .exit_code
        .map(|c| c.to_string())
        .unwrap_or_else(|| "none".to_string());
    let mut out = format!(
        "status: {}\nexit code: {code}\nelapsed: {}s\n",
        s.status, s.elapsed_secs
    );
    if s.output.trim().is_empty() {
        out.push_str("(no output)");
    } else {
        out.push_str("--- output ---\n");
        out.push_str(&s.output);
    }
    out
}

impl Tool for RunCommand {
    const NAME: &'static str = "run_command";
    type Error = ToolError;
    type Args = RunCommandArgs;
    type Output = String;

    fn description(&self) -> String {
        "Run a shell command in the workspace root directory."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(RunCommandArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        if args.command.trim().is_empty() {
            return Err(ToolError::msg("command must not be empty"));
        }

        let root = workspace_root(&self.workspace)?;
        let cwd = match &args.cwd {
            Some(sub) => fs_util::resolve_in_workspace(&root, sub)?,
            None => root,
        };
        if !cwd.is_dir() {
            return Err(ToolError::msg(format!(
                "cwd is not a directory: {}",
                cwd.display()
            )));
        }

        let (task_id, done) = self.manager.spawn_task(&args.command, &cwd);

        if args.background.unwrap_or(false) {
            return Ok(format!(
                "Background task started with task_id: '{task_id}'."
            ));
        }

        let handoff = Duration::from_secs(config::COMMAND_FOREGROUND_HANDOFF_SECS);
        let started = Instant::now();

        loop {
            let status = self
                .manager
                .get_status(&task_id)
                .ok_or_else(|| ToolError::msg("command task disappeared unexpectedly"))?;
            if status.status != "running" {
                return Ok(format_completed(&status));
            }

            let remaining = handoff.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                return Ok(format!(
                    "Command still running after {}s and is now tracked as task_id: '{task_id}'.",
                    config::COMMAND_FOREGROUND_HANDOFF_SECS
                ));
            }

            let tick = remaining.min(Duration::from_millis(250));
            tokio::select! {
                _ = done.notified() => {}
                _ = tokio::time::sleep(tick) => {}
            }
        }
    }
}

const OUTPUT_TAIL_LINES: usize = 200;

#[derive(Deserialize, JsonSchema)]
pub struct GetCommandStatusArgs {
    pub task_id: String,
}

pub struct GetCommandStatus {
    manager: CommandManager,
}

impl GetCommandStatus {
    pub fn new(manager: CommandManager) -> Self {
        Self { manager }
    }
}

impl Tool for GetCommandStatus {
    const NAME: &'static str = "get_command_status";
    type Error = ToolError;
    type Args = GetCommandStatusArgs;
    type Output = String;

    fn description(&self) -> String {
        "Check current status of a background command."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(GetCommandStatusArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let status = self
            .manager
            .get_status(&args.task_id)
            .ok_or_else(|| ToolError::msg(format!("task_id '{}' not found", args.task_id)))?;

        let mut out = String::new();
        out.push_str(&format!("task_id: {}\n", status.task_id));
        out.push_str(&format!("command: {}\n", status.command));
        out.push_str(&format!("status: {}\n", status.status));
        if let Some(code) = status.exit_code {
            out.push_str(&format!("exit_code: {code}\n"));
        }
        out.push_str(&format!("elapsed: {}s\n", status.elapsed_secs));

        let lines: Vec<&str> = status.output.lines().collect();
        let start = lines.len().saturating_sub(OUTPUT_TAIL_LINES);
        out.push_str("--- output (latest lines) ---\n");
        if lines.is_empty() {
            out.push_str("(no output)");
        } else {
            out.push_str(&lines[start..].join("\n"));
        }

        Ok(out)
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct StopCommandArgs {
    pub task_id: String,
}

pub struct StopCommand {
    manager: CommandManager,
}

impl StopCommand {
    pub fn new(manager: CommandManager) -> Self {
        Self { manager }
    }
}

impl Tool for StopCommand {
    const NAME: &'static str = "stop_command";
    type Error = ToolError;
    type Args = StopCommandArgs;
    type Output = String;

    fn description(&self) -> String {
        "Cancel a running background command."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(StopCommandArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        if self.manager.kill_task(&args.task_id) {
            Ok(format!("Requested cancellation of task '{}'.", args.task_id))
        } else {
            Err(ToolError::msg(format!("task '{}' is not running or does not exist", args.task_id)))
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct ReadSkillArgs {
    pub name: String,
}

pub struct ReadSkill {
    data_dir: PathBuf,
}

impl ReadSkill {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

impl Tool for ReadSkill {
    const NAME: &'static str = "read_skill";
    type Error = ToolError;
    type Args = ReadSkillArgs;
    type Output = String;

    fn description(&self) -> String {
        "Load step-by-step instructions for a named skill."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ReadSkillArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let skills = load_all_skills(&self.data_dir);
        let target = args.name.trim().to_lowercase();
        let skill = skills
            .into_iter()
            .find(|s| s.name.to_lowercase() == target)
            .ok_or_else(|| ToolError::msg(format!("no skill named '{}'", args.name)))?;
        tokio::fs::read_to_string(&skill.file_path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot read skill '{}': {e}", args.name)))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct WebSearchArgs {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<u32>,
    #[serde(default)]
    pub search_depth: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
}

pub struct WebSearch {
    gateway: Arc<Gateway>,
}

impl WebSearch {
    pub fn new(gateway: Arc<Gateway>) -> Self {
        Self { gateway }
    }
}

impl Tool for WebSearch {
    const NAME: &'static str = "web_search";
    type Error = ToolError;
    type Args = WebSearchArgs;
    type Output = String;

    fn description(&self) -> String {
        "Search the live web and return relevant results."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(WebSearchArgs)).unwrap_or_default()
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let depth = args.search_depth.unwrap_or_else(|| "basic".to_string());
        let req = TavilyRequest {
            query: args.query.clone(),
            max_results: Some(args.max_results.unwrap_or(5).clamp(1, 10)),
            search_depth: Some(depth),
            topic: args.topic,
            domain: args.domain,
        };

        let resp = self.gateway.tavily(&req).await?;
        let mut out = String::new();
        if let Some(answer) = resp.answer.filter(|a| !a.is_empty()) {
            out.push_str("Answer: ");
            out.push_str(&answer);
            out.push_str("\n\n");
        }

        if resp.results.is_empty() {
            out.push_str("No results found.");
            return Ok(out);
        }

        for (i, r) in resp.results.iter().enumerate() {
            let snippet: String = r.content.chars().take(500).collect();
            out.push_str(&format!(
                "{}. {}\n   {}\n   {}\n",
                i + 1,
                if r.title.is_empty() { "(untitled)" } else { &r.title },
                r.url,
                snippet
            ));
        }

        Ok(out)
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct ListDirArgs {
    pub path: String,
}

pub struct ListDir {
    workspace: WorkspaceHandle,
}

impl ListDir {
    pub fn new(workspace: WorkspaceHandle) -> Self {
        Self { workspace }
    }
}

impl Tool for ListDir {
    const NAME: &'static str = "list_dir";
    type Error = ToolError;
    type Args = ListDirArgs;
    type Output = String;

    fn description(&self) -> String {
        "List files and folders inside a directory. \
Returns the names, whether it is a directory or a file, and the size if it is a file. \
Useful to explore the codebase structure."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ListDirArgs)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;
        let resolved = fs_util::resolve_in_workspace(&root, &args.path)?;
        let display_path = args.path.clone();

        tokio::task::spawn_blocking(move || {
            if !resolved.exists() {
                return Err(ToolError::msg(format!("Directory not found: {display_path}")));
            }
            if !resolved.is_dir() {
                return Err(ToolError::msg(format!("Path is not a directory: {display_path}")));
            }

            let entries = std::fs::read_dir(&resolved)
                .map_err(|e| ToolError::msg(format!("Failed to read directory: {e}")))?;
            let mut paths: Vec<_> = entries.filter_map(Result::ok).collect();
            paths.sort_by_key(|e| e.file_name());

            let mut out = format!("Contents of {display_path}:\n\n");
            let mut count = 0;

            for entry in paths {
                let name = entry.file_name().to_string_lossy().into_owned();
                let metadata = entry.metadata().ok();
                let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);

                if is_dir && SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                if count >= 200 {
                    out.push_str("... (truncated. too many files)\n");
                    break;
                }
                count += 1;

                if is_dir {
                    out.push_str(&format!("[DIR]  {name}\n"));
                } else {
                    let size = metadata.map(|m| m.len()).unwrap_or(0);
                    let size_str = if size < 1024 {
                        format!("{size} B")
                    } else if size < 1024 * 1024 {
                        format!("{} KB", size / 1024)
                    } else {
                        format!("{} MB", size / (1024 * 1024))
                    };
                    out.push_str(&format!("[FILE] {name} ({size_str})\n"));
                }
            }
            Ok(out)
        })
        .await
        .map_err(|e| ToolError::msg(format!("list_dir task failed: {e}")))?
    }
}

pub struct ToolContext {
    pub workspace: WorkspaceHandle,
    pub gateway: Arc<Gateway>,
    pub app_handle: tauri::AppHandle,
    pub command_manager: CommandManager,
    pub data_dir: PathBuf,
    pub memory: crate::persistence::SqliteMemory,
    pub connector_manager: Arc<crate::connectors::ConnectorManager>,
}

impl ToolContext {
    pub fn list_dir(&self) -> ListDir {
        ListDir::new(self.workspace.clone())
    }
    pub fn read_file(&self) -> ReadFile {
        ReadFile::new(self.workspace.clone())
    }
    pub fn read_skill(&self) -> ReadSkill {
        ReadSkill::new(self.data_dir.clone())
    }
    pub fn write_file(&self) -> WriteFile {
        WriteFile::new(self.workspace.clone(), self.app_handle.clone())
    }
    pub fn multi_replace(&self) -> MultiReplaceFileContent {
        MultiReplaceFileContent::new(self.workspace.clone(), self.app_handle.clone())
    }
    pub fn search_workspace(&self) -> SearchWorkspace {
        SearchWorkspace::new(self.workspace.clone())
    }
    pub fn web_search(&self) -> WebSearch {
        WebSearch::new(self.gateway.clone())
    }
    pub fn run_command(&self) -> RunCommand {
        RunCommand::new(self.workspace.clone(), self.command_manager.clone())
    }
    pub fn get_command_status(&self) -> GetCommandStatus {
        GetCommandStatus::new(self.command_manager.clone())
    }
    pub fn stop_command(&self) -> StopCommand {
        StopCommand::new(self.command_manager.clone())
    }
    pub fn search_documents(&self) -> SearchDocuments {
        SearchDocuments { memory: self.memory.clone() }
    }

    pub fn connector_search(&self) -> crate::connector_tools::ConnectorSearch {
        crate::connector_tools::ConnectorSearch {
            manager: self.connector_manager.clone(),
            memory: self.memory.clone(),
        }
    }

    pub fn connector_read(&self) -> crate::connector_tools::ConnectorRead {
        crate::connector_tools::ConnectorRead {
            manager: self.connector_manager.clone(),
            memory: self.memory.clone(),
        }
    }

    pub fn connector_list(&self) -> crate::connector_tools::ConnectorList {
        crate::connector_tools::ConnectorList {
            manager: self.connector_manager.clone(),
            memory: self.memory.clone(),
        }
    }
}

pub struct SearchDocuments {
    pub memory: crate::persistence::SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchDocumentsArgs {
    pub query: String,
    pub limit: Option<usize>,
}

impl Tool for SearchDocuments {
    const NAME: &'static str = "search_documents";

    type Args = SearchDocumentsArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search the company knowledge library (PDFs, Word docs, Excel files, presentations, etc.) using full-text search. Returns matching passages with document names, file types, and page numbers.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(10).min(20);
        let hits = self
            .memory
            .search_documents(&args.query, limit)
            .await
            .map_err(|e| ToolError::msg(e.to_string()))?;

        if hits.is_empty() {
            return Ok(format!("No documents found matching '{}'.", args.query));
        }

        let mut out = format!("Found {} matching passage(s) for '{}':\n\n", hits.len(), args.query);
        for (i, hit) in hits.iter().enumerate() {
            let page_info = hit.page_number
                .map(|p| format!(" (page {p})"))
                .unwrap_or_default();
            out.push_str(&format!(
                "{}. **{}** [{}]{}\n   Source: {}\n   {}\n\n",
                i + 1,
                hit.document_title,
                hit.file_type,
                page_info,
                hit.source,
                hit.snippet
            ));
        }

        Ok(out)
    }
}


