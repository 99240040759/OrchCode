use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::Arc;

use futures::{SinkExt, StreamExt};
use orchharness::error::{AppError, AppResult};
use orchharness::events::TerminalEvent;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use secrecy::{ExposeSecret, SecretString};
use serde_json::json;
use tauri::ipc::Channel;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::config;

enum TerminalBackend {
    Local {
        master: Box<dyn MasterPty + Send>,
        input: SyncSender<Vec<u8>>,
        killer: Box<dyn ChildKiller + Send + Sync>,
    },
    Cloud {
        input: UnboundedSender<String>,
        killed: Arc<AtomicBool>,
    },
}

pub struct TerminalSession {
    instance_id: uuid::Uuid,
    backend: TerminalBackend,
}

impl TerminalSession {
    pub fn instance_id(&self) -> uuid::Uuid {
        self.instance_id
    }

    pub fn write(&self, data: &str) -> bool {
        match &self.backend {
            TerminalBackend::Local { input, .. } => input.send(data.as_bytes().to_vec()).is_ok(),
            TerminalBackend::Cloud { input, killed } => {
                if killed.load(Ordering::Relaxed) {
                    return false;
                }
                input
                    .send(json!({ "type": "input", "data": data }).to_string())
                    .is_ok()
            }
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        match &self.backend {
            TerminalBackend::Local { master, .. } => {
                let _ = master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
            TerminalBackend::Cloud { input, killed } => {
                if !killed.load(Ordering::Relaxed) {
                    let _ = input.send(
                        json!({ "type": "resize", "cols": cols, "rows": rows }).to_string(),
                    );
                }
            }
        }
    }

    pub fn kill(&mut self) {
        match &mut self.backend {
            TerminalBackend::Local { killer, .. } => {
                let _ = killer.kill();
            }
            TerminalBackend::Cloud { input, killed } => {
                if !killed.swap(true, Ordering::Relaxed) {
                    let _ = input.send(json!({ "type": "close" }).to_string());
                }
            }
        }
    }
}

fn shell_command(cwd: &Path) -> CommandBuilder {
    #[cfg(target_os = "windows")]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut cmd = CommandBuilder::new_default_prog();
        if let Some(path) = orchharness::util::login_shell_path() {
            cmd.env("PATH", path);
        }
        cmd
    };
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Orch");
    if cwd.is_dir() {
        cmd.cwd(cwd);
    }
    cmd
}

pub fn open(
    cwd: &Path,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
    instance_id: uuid::Uuid,
    on_exit: Box<dyn FnOnce(uuid::Uuid) + Send + 'static>,
) -> AppResult<TerminalSession> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::other(format!("failed to open pty: {e}")))?;

    let child = pair
        .slave
        .spawn_command(shell_command(cwd))
        .map_err(|e| AppError::other(format!("failed to spawn shell: {e}")))?;
    let killer = child.clone_killer();
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::other(format!("failed to clone pty reader: {e}")))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::other(format!("failed to take pty writer: {e}")))?;

    let (input, input_rx) = mpsc::sync_channel::<Vec<u8>>(256);
    std::thread::spawn(move || {
        for chunk in input_rx {
            if writer.write_all(&chunk).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });

    {
        let channel = channel.clone();
        let mut killer_for_wait = child.clone_killer();
        let mut child = child;
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 16384];
            let mut decoder = encoding_rs::UTF_8.new_decoder();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut text = String::new();
                        if let Some(cap) = decoder.max_utf8_buffer_length(n) {
                            text.reserve(cap);
                        }
                        let _ = decoder.decode_to_string(&buf[..n], &mut text, false);
                        if !text.is_empty()
                            && channel.send(TerminalEvent::Data { data: text }).is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let mut tail = String::new();
            let _ = decoder.decode_to_string(&[], &mut tail, true);
            if !tail.is_empty() {
                let _ = channel.send(TerminalEvent::Data { data: tail });
            }
            let _ = channel.send(TerminalEvent::Exit);
            on_exit(instance_id);
            let _ = killer_for_wait.kill();
            let _ = child.wait();
        });
    }

    Ok(TerminalSession {
        instance_id,
        backend: TerminalBackend::Local {
            master: pair.master,
            input,
            killer,
        },
    })
}

fn cloud_terminal_ws_url(workspace: &str, cols: u16, rows: u16) -> AppResult<String> {
    let base = config::cloud_url("/terminal");
    let ws_base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        base
    };
    let parsed = url::Url::parse_with_params(
        &ws_base,
        &[
            ("workspace", workspace.to_string()),
            ("cols", cols.to_string()),
            ("rows", rows.to_string()),
        ],
    )
    .map_err(|e| AppError::other(format!("invalid cloud terminal url: {e}")))?;
    Ok(parsed.to_string())
}

pub async fn open_cloud(
    workspace: &str,
    token: SecretString,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
    instance_id: uuid::Uuid,
    on_exit: Box<dyn FnOnce(uuid::Uuid) + Send + 'static>,
) -> AppResult<TerminalSession> {
    let ws_url = cloud_terminal_ws_url(workspace, cols, rows)?;
    let mut request = ws_url
        .into_client_request()
        .map_err(|e| AppError::other(format!("invalid cloud terminal request: {e}")))?;
    let auth_header = http::HeaderValue::from_str(&format!("Bearer {}", token.expose_secret()))
        .map_err(|e| AppError::other(format!("invalid authorization header: {e}")))?;
    request
        .headers_mut()
        .insert(http::header::AUTHORIZATION, auth_header);

    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| AppError::other(format!("cloud terminal connection failed: {e}")))?;

    let (mut ws_sink, mut ws_stream_rx) = ws_stream.split();
    let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let killed = Arc::new(AtomicBool::new(false));
    let killed_pump = killed.clone();

    tokio::spawn(async move {
        let mut on_exit = Some(on_exit);
        loop {
            tokio::select! {
                outbound = input_rx.recv() => {
                    match outbound {
                        Some(msg) => {
                            let is_close = killed_pump.load(Ordering::Relaxed) && msg.contains("\"close\"");
                            if ws_sink.send(Message::Text(msg.into())).await.is_err() || is_close {
                                let _ = ws_sink.close().await;
                                break;
                            }
                        }
                        None => {
                            let _ = ws_sink.close().await;
                            break;
                        }
                    }
                }
                inbound = ws_stream_rx.next() => {
                    match inbound {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(text.as_str()) {
                                match val.get("type").and_then(|t| t.as_str()) {
                                    Some("data") => {
                                        if let Some(data) = val.get("data").and_then(|d| d.as_str()) {
                                            if !data.is_empty()
                                                && channel.send(TerminalEvent::Data { data: data.to_string() }).is_err()
                                            {
                                                break;
                                            }
                                        }
                                    }
                                    Some("exit") => break,
                                    _ => {}
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                        _ => {}
                    }
                }
            }
        }
        let _ = channel.send(TerminalEvent::Exit);
        if let Some(cb) = on_exit.take() {
            cb(instance_id);
        }
    });

    Ok(TerminalSession {
        instance_id,
        backend: TerminalBackend::Cloud { input: input_tx, killed },
    })
}
