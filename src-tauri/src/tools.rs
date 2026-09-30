use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use circular_buffer::CircularBuffer;
use command_group::AsyncCommandGroup;
use ignore::WalkBuilder;
use path_clean::PathClean;
use rig::tool::{Tool, ToolExecutionError};
use schemars::JsonSchema;
use serde::Deserialize;
use tauri::Manager;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Notify;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::events::{ToolDisplayInfo, ToolIcon};
use crate::gateway::{Gateway, TavilyRequest};
use crate::skills::load_all_skills;

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

pub fn tool_failure(error: ToolError) -> ToolExecutionError {
    ToolExecutionError::other(error.to_string())
}

pub fn tool_output_is_error(output: &str) -> bool {
    output.starts_with(TOOL_ERROR_SENTINEL)
}

pub fn strip_tool_error_sentinel(output: &str) -> &str {
    output.strip_prefix(TOOL_ERROR_SENTINEL).unwrap_or(output)
}

pub fn workspace_root(workspace: &Option<PathBuf>) -> Result<PathBuf, ToolError> {
    workspace
        .clone()
        .ok_or_else(|| ToolError::msg("no workspace is open"))
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

        let mut existing = cleaned.clone();
        let mut missing: Vec<std::ffi::OsString> = Vec::new();
        let resolved = loop {
            match dunce::canonicalize(&existing) {
                Ok(canonical) => {
                    let mut out = canonical;
                    for part in missing.iter().rev() {
                        out.push(part);
                    }
                    break out;
                }
                Err(_) => {
                    let Some(name) = existing.file_name().map(|n| n.to_os_string()) else {
                        return Err(AppError::PathEscapesWorkspace(input.to_string()));
                    };
                    missing.push(name);
                    if !existing.pop() {
                        return Err(AppError::PathEscapesWorkspace(input.to_string()));
                    }
                }
            }
        };

        if !resolved.starts_with(&canonical_root) {
            return Err(AppError::PathEscapesWorkspace(input.to_string()));
        }
        Ok(resolved)
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

    pub fn file_lock(path: &Path) -> Arc<tokio::sync::Mutex<()>> {
        static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
        let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
        let mut guard = locks.lock().unwrap_or_else(|e| e.into_inner());
        guard.retain(|_, lock| Arc::strong_count(lock) > 1);
        guard
            .entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    pub async fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
        let requested = path.to_path_buf();
        let bytes = content.to_vec();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            use std::io::Write;
            let target = dunce::canonicalize(&requested).unwrap_or(requested);
            let existing = std::fs::metadata(&target).ok();

            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if let Some(meta) = existing.as_ref() {
                    if meta.nlink() > 1 {
                        let mut file = std::fs::OpenOptions::new()
                            .write(true)
                            .truncate(true)
                            .open(&target)?;
                        file.write_all(&bytes)?;
                        file.sync_all()?;
                        return Ok(());
                    }
                }
            }

            let parent = target
                .parent()
                .ok_or_else(|| AppError::other("target path has no parent directory"))?;
            let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
            tmp.write_all(&bytes)?;
            tmp.as_file().sync_all()?;
            match existing {
                Some(meta) => tmp.as_file().set_permissions(meta.permissions())?,
                None => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        tmp.as_file()
                            .set_permissions(std::fs::Permissions::from_mode(0o644))?;
                    }
                }
            }
            tmp.persist(&target).map_err(|e| AppError::Io(e.error))?;
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
const PIPE_DRAIN_GRACE: Duration = Duration::from_millis(750);

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
    run_id: String,
    background: bool,
    command: String,
    status: String,
    exit_code: Option<i32>,
    output: RingBuffer,
    started_at: Instant,
    pid: Option<u32>,
    cancel_requested: bool,
}

impl InnerTask {
    fn request_kill(&mut self) -> bool {
        if self.status != "running" {
            return false;
        }
        self.cancel_requested = true;
        match self.pid {
            Some(pid) => {
                crate::util::kill_process_tree(pid);
                true
            }
            None => false,
        }
    }
}

struct RingBuffer {
    data: Box<CircularBuffer<OUTPUT_RING_BYTES, u8>>,
}

impl RingBuffer {
    fn new() -> Self {
        Self {
            data: CircularBuffer::boxed(),
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

    pub fn spawn_task(
        &self,
        command_str: &str,
        cwd: &Path,
        run_id: &str,
        background: bool,
    ) -> (String, Arc<Notify>) {
        self.prune_old_tasks();

        let task_id = format!("task-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        let done = Arc::new(Notify::new());
        let inner = Arc::new(Mutex::new(InnerTask {
            task_id: task_id.clone(),
            run_id: run_id.to_string(),
            background,
            command: command_str.to_string(),
            status: "running".to_string(),
            exit_code: None,
            output: RingBuffer::new(),
            started_at: Instant::now(),
            pid: None,
            cancel_requested: false,
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
            let mut cmd = {
                let mut cmd = Command::new("powershell.exe");
                cmd.args(["-NoProfile", "-NonInteractive", "-Command", &cmd_str])
                    .creation_flags(0x08000000);
                cmd
            };

            #[cfg(not(target_os = "windows"))]
            let mut cmd = {
                let mut cmd = Command::new("/bin/sh");
                cmd.args(["-c", &cmd_str]);
                if let Some(path) = crate::util::login_shell_path() {
                    cmd.env("PATH", path);
                }
                cmd
            };

            cmd.current_dir(&cwd_buf)
                .env("CI", "1")
                .env("TERM", "dumb")
                .env("NO_COLOR", "1")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);

            match cmd.group_spawn() {
                Ok(mut child) => {
                    let pid = child.id();
                    let killed_before_start = {
                        let mut g = inner.lock().unwrap_or_else(|e| e.into_inner());
                        g.pid = pid;
                        g.cancel_requested
                    };
                    if killed_before_start {
                        if let Some(pid) = pid {
                            crate::util::kill_process_tree(pid);
                        }
                    }

                    let stdout_task = child.inner().stdout.take().map(|out| {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move { pump(out, inner_ref).await })
                    });
                    let stderr_task = child.inner().stderr.take().map(|err| {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move { pump(err, inner_ref).await })
                    });

                    let wait_result = child.wait().await;

                    for handle in [stdout_task, stderr_task].into_iter().flatten() {
                        let abort = handle.abort_handle();
                        if tokio::time::timeout(PIPE_DRAIN_GRACE, handle).await.is_err() {
                            abort.abort();
                        }
                    }

                    let mut g = inner.lock().unwrap_or_else(|e| e.into_inner());
                    g.pid = None;
                    match wait_result {
                        Ok(_) if g.cancel_requested => g.status = "cancelled".to_string(),
                        Ok(status) => {
                            g.exit_code = status.code();
                            g.status = if status.success() {
                                "completed".to_string()
                            } else {
                                "failed".to_string()
                            };
                        }
                        Err(e) => {
                            g.status = "failed".to_string();
                            g.output.push(format!("\nprocess wait error: {e}\n").as_bytes());
                        }
                    }
                }
                Err(e) => {
                    let mut g = inner.lock().unwrap_or_else(|e| e.into_inner());
                    g.status = "failed".to_string();
                    g.output.push(format!("spawn error: {e}").as_bytes());
                }
            }

            done_signal.notify_waiters();
        });

        (task_id, done)
    }

    pub fn get_status(&self, task_id: &str) -> Option<TaskStatus> {
        let task = {
            let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            guard.get(task_id)?.clone()
        };
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
        let task = {
            let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            match guard.get(task_id) {
                Some(task) => task.clone(),
                None => return false,
            }
        };
        let mut g = task.lock().unwrap_or_else(|e| e.into_inner());
        g.request_kill()
    }

    pub fn kill_foreground_for_run(&self, run_id: &str) {
        self.kill_matching(|task| task.run_id == run_id && !task.background);
    }

    pub fn kill_all(&self) {
        self.kill_matching(|_| true);
    }

    fn kill_matching(&self, predicate: impl Fn(&InnerTask) -> bool) {
        let tasks: Vec<Arc<Mutex<InnerTask>>> = {
            let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            guard.values().cloned().collect()
        };
        for task in tasks {
            let mut g = task.lock().unwrap_or_else(|e| e.into_inner());
            if predicate(&g) {
                g.request_kill();
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
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let mut g = inner.lock().unwrap_or_else(|e| e.into_inner());
                g.output.push(&buf[..n]);
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
    workspace: Option<PathBuf>,
}

fn raster_mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

pub(crate) fn window_lines(content: &str, start: Option<usize>, end: Option<usize>) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    if total == 0 {
        return String::new();
    }
    let from = start.unwrap_or(1).max(1).min(total);
    let requested_to = match (start, end) {
        (_, Some(e)) => e.max(from).min(total),
        (Some(_), None) => total,
        (None, None) => total,
    };
    let line_cap = from + config::MAX_READ_FILE_LINES - 1;
    let mut to = requested_to.min(line_cap);

    let mut out = String::new();
    let mut last = from - 1;
    for (idx, line) in lines.iter().enumerate().take(to).skip(from - 1) {
        if out.len() + line.len() + 1 > config::MAX_READ_FILE_CHARS && idx + 1 > from {
            break;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(line);
        last = idx + 1;
    }
    to = last;
    if to < requested_to || (start.is_none() && end.is_none() && to < total) {
        out.push_str(&format!(
            "\n\n[truncated: showing lines {from}-{to} of {total}. Call read_file with start_line/end_line to read other sections.]"
        ));
    }
    out
}

impl Tool for ReadFile {
    const NAME: &'static str = "read_file";
    type Error = ToolError;
    type Args = ReadFileArgs;
    type Output = String;

    fn description(&self) -> String {
        "Read the contents of a file in the workspace. \
Returns text content for source code, config, markdown, JSON, SVG, PDF, Word, Excel and PowerPoint files. \
Output is limited to about 2000 lines per call; pass start_line and end_line (1-based, inclusive) to read other sections. \
Raster images return their dimensions only. ALWAYS call this before editing any file."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ReadFileArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let root = workspace_root(&self.workspace)?;
        let path = fs_util::resolve_existing_file(&root, &args.path)?;
        let rel = fs_util::display_relative(&root, &path);
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        if crate::document::is_parseable_document(&path) {
            let doc_path = path.clone();
            let parsed = tokio::task::spawn_blocking(move || crate::document::parse_document_file(&doc_path))
                .await
                .map_err(|e| ToolError::msg(format!("document extraction task failed: {e}")))??;
            if parsed.full_text.trim().is_empty() {
                return Err(ToolError::msg(format!("{rel} contains no extractable text")));
            }
            return Ok(window_lines(&parsed.full_text, args.start_line, args.end_line));
        }

        if crate::media::is_raster_extension(&ext) {
            let size = fs_util::check_file_size(&path)?;
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| ToolError::msg(format!("cannot read image {rel}: {e}")))?;
            let dims = tokio::task::spawn_blocking(move || crate::media::image_dimensions(&bytes))
                .await
                .ok()
                .flatten();
            let dimension_text = dims
                .map(|(w, h)| format!("{w}x{h} px, "))
                .unwrap_or_default();
            return Ok(format!(
                "Image file {rel} ({dimension_text}{size} bytes, {}). Image pixels cannot be returned through tools; if visual inspection is needed, ask the user to attach the image to a chat message.",
                raster_mime(&ext)
            ));
        }

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot stat {rel}: {e}")))?;
        if meta.len() > FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!(
                "file too large ({} bytes): {rel}",
                meta.len()
            )));
        }
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot read {rel}: {e}")))?;
        if crate::util::looks_binary(&bytes) {
            return Err(ToolError::msg(format!(
                "{rel} is a binary file ({} bytes) and cannot be read as text",
                bytes.len()
            )));
        }
        let text = String::from_utf8_lossy(&bytes);
        Ok(window_lines(&text, args.start_line, args.end_line))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    pub path: String,
    pub content: String,
}

pub struct WriteFile {
    workspace: Option<PathBuf>,
    app: tauri::AppHandle,
}

fn notify_file_written(app: &tauri::AppHandle, root: &Path, path: &Path) {
    app.state::<crate::state::AppState>().invalidate_file_index();
    let rel = fs_util::display_relative(root, path);
    let _ = tauri::Emitter::emit(app, "file-written", &rel);
}

impl Tool for WriteFile {
    const NAME: &'static str = "write_file";
    type Error = ToolError;
    type Args = WriteFileArgs;
    type Output = String;

    fn description(&self) -> String {
        "Create a new file, or completely overwrite an existing file, with the provided content. \
File permissions, symlinks and hard links of existing files are preserved."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(WriteFileArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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
        let lock = fs_util::file_lock(&path);
        let _guard = lock.lock().await;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                ToolError::msg(format!("cannot create parent dirs for {}: {e}", args.path))
            })?;
        }

        let existed = tokio::fs::try_exists(&path).await.unwrap_or(false);
        let bytes = args.content.len();
        fs_util::atomic_write(&path, args.content.as_bytes()).await?;

        notify_file_written(&self.app, &root, &path);

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
    workspace: Option<PathBuf>,
    app: tauri::AppHandle,
}

fn to_crlf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\n', "\r\n")
}

impl Tool for MultiReplaceFileContent {
    const NAME: &'static str = "multi_replace_file_content";
    type Error = ToolError;
    type Args = MultiReplaceArgs;
    type Output = String;

    fn description(&self) -> String {
        "Edit an existing file by applying one or more exact string replacements in order. \
Each old_string must match exactly one location. Line endings are normalized automatically."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(MultiReplaceArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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
        let path = fs_util::resolve_existing_file(&root, &args.path)?;
        let lock = fs_util::file_lock(&path);
        let _guard = lock.lock().await;

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot stat {}: {e}", args.path)))?;
        if meta.len() > FILE_SIZE_LIMIT {
            return Err(ToolError::msg(format!("file too large to edit: {}", args.path)));
        }

        let mut content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot read {} as UTF-8 text: {e}", args.path)))?;
        let uses_crlf = content.contains("\r\n");

        for (i, r) in args.replacements.iter().enumerate() {
            if r.old_string.is_empty() {
                return Err(ToolError::msg(format!(
                    "replacement #{} has empty old_string",
                    i + 1
                )));
            }
            let (old, new) = if uses_crlf && !r.old_string.contains('\r') {
                (to_crlf(&r.old_string), to_crlf(&r.new_string))
            } else {
                (r.old_string.clone(), r.new_string.clone())
            };
            let count = content.matches(old.as_str()).count();
            if count == 0 {
                return Err(ToolError::msg(format!(
                    "replacement #{} not applied: old_string not found in {}. Re-read the file and copy the exact text.",
                    i + 1,
                    args.path
                )));
            }
            if count > 1 {
                return Err(ToolError::msg(format!(
                    "replacement #{} is ambiguous: old_string matches {count} locations in {}. Include more surrounding context.",
                    i + 1,
                    args.path
                )));
            }
            content = content.replacen(old.as_str(), &new, 1);
        }

        fs_util::atomic_write(&path, content.as_bytes()).await?;
        notify_file_written(&self.app, &root, &path);

        let rel = fs_util::display_relative(&root, &path);
        Ok(format!(
            "Applied {} replacement(s) to {rel}",
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
    workspace: Option<PathBuf>,
}

impl Tool for SearchWorkspace {
    const NAME: &'static str = "search_workspace";
    type Error = ToolError;
    type Args = SearchWorkspaceArgs;
    type Output = String;

    fn description(&self) -> String {
        "Case-insensitive regex search over text files in the workspace. Binary files are skipped and long lines are shortened."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(SearchWorkspaceArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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

fn search_text(root: &Path, search_path: &Path, query: &str, max_hits: usize) -> Result<String, ToolError> {
    let matcher = grep_regex::RegexMatcherBuilder::new()
        .case_insensitive(true)
        .build(query)
        .map_err(|e| ToolError::msg(format!("invalid search pattern: {e}")))?;

    let mut results: Vec<String> = Vec::new();
    let mut total_chars = 0usize;
    let mut searcher = grep_searcher::SearcherBuilder::new()
        .binary_detection(grep_searcher::BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();
    let mut truncated = false;

    for entry in fs_util::workspace_walker(search_path).build().flatten() {
        if results.len() >= max_hits || total_chars >= config::MAX_SEARCH_OUTPUT_CHARS {
            truncated = true;
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
        let chars_ref = &mut total_chars;
        let sink = grep_searcher::sinks::UTF8(|line_num, line| {
            let trimmed = line.trim();
            let shown = crate::util::truncate_chars(trimmed, config::MAX_SEARCH_LINE_CHARS);
            let suffix = if shown.len() < trimmed.len() { " …" } else { "" };
            let entry = format!("{rel_path}:{line_num}: {shown}{suffix}");
            *chars_ref += entry.len() + 1;
            results_ref.push(entry);
            Ok(results_ref.len() < max_hits && *chars_ref < config::MAX_SEARCH_OUTPUT_CHARS)
        });
        let _ = searcher.search_path(&matcher, file_path, sink);
    }

    if results.is_empty() {
        Ok(format!("No matches found for pattern: '{query}'"))
    } else {
        let mut out = results.join("\n");
        if truncated || results.len() >= max_hits {
            out.push_str("\n\n[results limited; narrow the pattern or pass path to search a subdirectory]");
        }
        Ok(out)
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
    workspace: Option<PathBuf>,
    manager: CommandManager,
    run_id: String,
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
        out.push_str(&crate::util::clip_middle(&s.output, config::MAX_TOOL_OUTPUT_CHARS));
    }
    out
}

impl Tool for RunCommand {
    const NAME: &'static str = "run_command";
    type Error = ToolError;
    type Args = RunCommandArgs;
    type Output = String;

    fn description(&self) -> String {
        "Run a shell command in the workspace (or a subdirectory via cwd) using the user's login PATH. \
Foreground commands return their output, or a task_id if they run longer than 30 seconds. \
Set background=true for servers and watchers."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(RunCommandArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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

        let background = args.background.unwrap_or(false);
        let (task_id, done) = self
            .manager
            .spawn_task(&args.command, &cwd, &self.run_id, background);

        if background {
            return Ok(format!("Background task started with task_id: '{task_id}'."));
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
                    "Command still running after {}s and is now tracked as task_id: '{task_id}'. Use get_command_status to check it.",
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

impl Tool for GetCommandStatus {
    const NAME: &'static str = "get_command_status";
    type Error = ToolError;
    type Args = GetCommandStatusArgs;
    type Output = String;

    fn description(&self) -> String {
        "Check the status, exit code and latest output of a command task.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(GetCommandStatusArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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
            out.push_str(&crate::util::clip_middle(
                &lines[start..].join("\n"),
                config::MAX_TOOL_OUTPUT_CHARS,
            ));
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

impl Tool for StopCommand {
    const NAME: &'static str = "stop_command";
    type Error = ToolError;
    type Args = StopCommandArgs;
    type Output = String;

    fn description(&self) -> String {
        "Terminate a running command task and all of its child processes.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(StopCommandArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
    }

    async fn call(
        &self,
        _ctx: &mut rig::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        if self.manager.kill_task(&args.task_id) {
            Ok(format!("Stopped task '{}'.", args.task_id))
        } else {
            Err(ToolError::msg(format!(
                "task '{}' is not running or does not exist",
                args.task_id
            )))
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

impl Tool for ReadSkill {
    const NAME: &'static str = "read_skill";
    type Error = ToolError;
    type Args = ReadSkillArgs;
    type Output = String;

    fn description(&self) -> String {
        "Load step-by-step instructions for a named skill.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ReadSkillArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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

impl Tool for WebSearch {
    const NAME: &'static str = "web_search";
    type Error = ToolError;
    type Args = WebSearchArgs;
    type Output = String;

    fn description(&self) -> String {
        "Search the live web and return relevant results.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(WebSearchArgs)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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
            let snippet = crate::util::truncate_chars(&r.content, 500);
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
    workspace: Option<PathBuf>,
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

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
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
    pub workspace: Option<PathBuf>,
    pub run_id: String,
    pub gateway: Arc<Gateway>,
    pub app_handle: tauri::AppHandle,
    pub command_manager: CommandManager,
    pub data_dir: PathBuf,
    pub memory: crate::persistence::SqliteMemory,
    pub connector_manager: Arc<crate::connectors::ConnectorManager>,
}

impl ToolContext {
    pub fn list_dir(&self) -> ListDir {
        ListDir {
            workspace: self.workspace.clone(),
        }
    }
    pub fn read_file(&self) -> ReadFile {
        ReadFile {
            workspace: self.workspace.clone(),
        }
    }
    pub fn read_skill(&self) -> ReadSkill {
        ReadSkill {
            data_dir: self.data_dir.clone(),
        }
    }
    pub fn write_file(&self) -> WriteFile {
        WriteFile {
            workspace: self.workspace.clone(),
            app: self.app_handle.clone(),
        }
    }
    pub fn multi_replace(&self) -> MultiReplaceFileContent {
        MultiReplaceFileContent {
            workspace: self.workspace.clone(),
            app: self.app_handle.clone(),
        }
    }
    pub fn search_workspace(&self) -> SearchWorkspace {
        SearchWorkspace {
            workspace: self.workspace.clone(),
        }
    }
    pub fn web_search(&self) -> WebSearch {
        WebSearch {
            gateway: self.gateway.clone(),
        }
    }
    pub fn run_command(&self) -> RunCommand {
        RunCommand {
            workspace: self.workspace.clone(),
            manager: self.command_manager.clone(),
            run_id: self.run_id.clone(),
        }
    }
    pub fn get_command_status(&self) -> GetCommandStatus {
        GetCommandStatus {
            manager: self.command_manager.clone(),
        }
    }
    pub fn stop_command(&self) -> StopCommand {
        StopCommand {
            manager: self.command_manager.clone(),
        }
    }
    pub fn search_documents(&self) -> SearchDocuments {
        SearchDocuments {
            memory: self.memory.clone(),
        }
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
        "Search the knowledge library (PDFs, Word docs, Excel files, presentations, text) using full-text search. Returns matching passages with document names, file types, and page numbers.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        tool_failure(error)
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let limit = args.limit.unwrap_or(10).clamp(1, 20);
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
            let page_info = hit
                .page_number
                .map(|p| format!(" (page {p})"))
                .unwrap_or_default();
            let snippet = hit.snippet.replace("<b>", "**").replace("</b>", "**");
            out.push_str(&format!(
                "{}. {} [{}]{}\n   Source: {}\n   {}\n\n",
                i + 1,
                hit.document_title,
                hit.file_type,
                page_info,
                hit.file_path.as_deref().unwrap_or(&hit.source),
                snippet
            ));
        }

        Ok(out)
    }
}
