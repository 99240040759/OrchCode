use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

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
    data: String,
    cap: usize,
}

impl RingBuffer {
    fn new(cap: usize) -> Self {
        Self { data: String::with_capacity(cap.min(4096)), cap }
    }

    fn push(&mut self, s: &str) {
        self.data.push_str(s);
        if self.data.len() > self.cap {
            let excess = self.data.len() - self.cap;
            let split = self.data.char_indices().find(|(i, _)| *i >= excess).map(|(i, _)| i).unwrap_or(excess);
            self.data.drain(..split);
        }
    }

    fn as_str(&self) -> &str {
        &self.data
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

    pub fn spawn_task(&self, command_str: &str, cwd: &std::path::Path) -> String {
        self.prune_old_tasks();

        let task_id = format!("task-{}", uuid::Uuid::new_v4().simple().to_string().chars().take(8).collect::<String>());
        let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
        let inner = Arc::new(Mutex::new(InnerTask {
            task_id: task_id.clone(),
            command: command_str.to_string(),
            status: "running".to_string(),
            exit_code: None,
            output: RingBuffer::new(OUTPUT_RING_BYTES),
            started_at: Instant::now(),
            kill_tx: Some(kill_tx),
        }));

        {
            let mut guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            guard.insert(task_id.clone(), inner.clone());
        }

        let cmd_str = command_str.to_string();
        let cwd_buf = cwd.to_path_buf();

        tokio::spawn(async move {
            #[cfg(target_os = "windows")]
            let child_res = Command::new("powershell.exe")
                .args(["-NoProfile", "-Command", &cmd_str])
                .current_dir(&cwd_buf)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn();

            #[cfg(not(target_os = "windows"))]
            let child_res = Command::new("sh")
                .args(["-c", &cmd_str])
                .current_dir(&cwd_buf)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn();

            match child_res {
                Ok(mut child) => {
                    let (stdout_done_tx, stdout_done_rx) = tokio::sync::oneshot::channel::<()>();
                    let (stderr_done_tx, stderr_done_rx) = tokio::sync::oneshot::channel::<()>();

                    if let Some(mut out) = child.stdout.take() {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move {
                            let mut buf = [0u8; 4096];
                            while let Ok(n) = out.read(&mut buf).await {
                                if n == 0 { break; }
                                let s = String::from_utf8_lossy(&buf[..n]);
                                if let Ok(mut g) = inner_ref.lock() {
                                    g.output.push(&s);
                                }
                            }
                            let _ = stdout_done_tx.send(());
                        });
                    } else {
                        let _ = stdout_done_tx.send(());
                    }

                    if let Some(mut err) = child.stderr.take() {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move {
                            let mut buf = [0u8; 4096];
                            while let Ok(n) = err.read(&mut buf).await {
                                if n == 0 { break; }
                                let s = String::from_utf8_lossy(&buf[..n]);
                                if let Ok(mut g) = inner_ref.lock() {
                                    g.output.push(&s);
                                }
                            }
                            let _ = stderr_done_tx.send(());
                        });
                    } else {
                        let _ = stderr_done_tx.send(());
                    }

                    tokio::select! {
                        res = child.wait() => {
                            let _ = stdout_done_rx.await;
                            let _ = stderr_done_rx.await;
                            if let Ok(mut g) = inner.lock() {
                                g.kill_tx = None;
                                match res {
                                    Ok(status) => {
                                        g.exit_code = status.code();
                                        g.status = if status.success() { "completed".to_string() } else { "failed".to_string() };
                                    }
                                    Err(_) => g.status = "failed".to_string(),
                                }
                            }
                        }
                        _ = kill_rx => {
                            let _ = child.kill().await;
                            let _ = stdout_done_rx.await;
                            let _ = stderr_done_rx.await;
                            if let Ok(mut g) = inner.lock() {
                                g.kill_tx = None;
                                g.status = "cancelled".to_string();
                            }
                        }
                    }
                }
                Err(e) => {
                    if let Ok(mut g) = inner.lock() {
                        g.kill_tx = None;
                        g.status = "failed".to_string();
                        g.output.push(&format!("spawn error: {e}"));
                    }
                }
            }
        });

        task_id
    }

    pub fn get_status(&self, task_id: &str) -> Option<TaskStatus> {
        let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        let task = guard.get(task_id)?;
        let g = task.lock().unwrap_or_else(|e| e.into_inner());
        Some(TaskStatus {
            task_id: g.task_id.clone(),
            command: g.command.clone(),
            status: g.status.clone(),
            exit_code: g.exit_code,
            output: g.output.as_str().to_string(),
            elapsed_secs: g.started_at.elapsed().as_secs(),
        })
    }

    pub fn kill_task(&self, task_id: &str) -> bool {
        let guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(task) = guard.get(task_id) {
            if let Ok(mut g) = task.lock() {
                if let Some(tx) = g.kill_tx.take() {
                    let _ = tx.send(());
                    return true;
                }
            }
        }
        false
    }

    fn prune_old_tasks(&self) {
        let mut guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        guard.retain(|_, task| {
            task.lock().map(|g| g.started_at.elapsed() < TASK_MAX_AGE).unwrap_or(true)
        });
    }
}
