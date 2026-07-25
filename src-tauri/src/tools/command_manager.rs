use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Notify;

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
        Self {
            data: String::with_capacity(cap.min(4096)),
            cap,
        }
    }

    fn push(&mut self, s: &str) {
        self.data.push_str(s);
        if self.data.len() > self.cap {
            let excess = self.data.len() - self.cap;
            let split = (excess..=self.data.len())
                .find(|i| self.data.is_char_boundary(*i))
                .unwrap_or(self.data.len());
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

    pub fn spawn_task(&self, command_str: &str, cwd: &std::path::Path) -> (String, Arc<Notify>) {
        self.prune_old_tasks();

        let task_id = format!("task-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
        let done = Arc::new(Notify::new());
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
        let done_signal = done.clone();

        tokio::spawn(async move {
            #[cfg(target_os = "windows")]
            let child_res = Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &cmd_str])
                .current_dir(&cwd_buf)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .creation_flags(0x08000000)
                .kill_on_drop(true)
                .spawn();

            #[cfg(not(target_os = "windows"))]
            let child_res = Command::new("sh")
                .args(["-c", &cmd_str])
                .current_dir(&cwd_buf)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn();

            match child_res {
                Ok(mut child) => {
                    let stdout_task = child.stdout.take().map(|out| {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move { pump(out, inner_ref).await })
                    });
                    let stderr_task = child.stderr.take().map(|err| {
                        let inner_ref = inner.clone();
                        tokio::spawn(async move { pump(err, inner_ref).await })
                    });

                    let wait_result = tokio::select! {
                        res = child.wait() => Some(res),
                        _ = kill_rx => {
                            let _ = child.kill().await;
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
                                g.output.push(&format!("\nprocess wait error: {e}\n"));
                            }
                            None => g.status = "cancelled".to_string(),
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

            done_signal.notify_waiters();
        });

        (task_id, done)
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
                let text = String::from_utf8_lossy(&buf[..n]);
                if let Ok(mut g) = inner.lock() {
                    g.output.push(&text);
                }
            }
            Err(_) => break,
        }
    }
}
