use std::io::{Read, Write};
use std::path::Path;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use crate::error::{AppError, AppResult};
use crate::events::TerminalEvent;

pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

impl TerminalSession {
    pub fn write(&mut self, data: &str) {
        let _ = self.writer.write_all(data.as_bytes());
        let _ = self.writer.flush();
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
    }

    pub fn kill(&mut self) {
        let _ = self.killer.kill();
    }
}

pub fn open(
    cwd: &Path,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
    on_exit: Box<dyn FnOnce() + Send + 'static>,
) -> AppResult<TerminalSession> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| AppError::other(format!("failed to open pty: {e}")))?;

    let mut cmd = CommandBuilder::new(default_shell());
    if cwd.is_dir() {
        cmd.cwd(cwd);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| AppError::other(format!("failed to spawn shell: {e}")))?;
    let killer = child.clone_killer();
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| AppError::other(format!("failed to clone pty reader: {e}")))?;
    let writer = pair.master.take_writer().map_err(|e| AppError::other(format!("failed to take pty writer: {e}")))?;

    {
        let channel = channel.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
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
            on_exit();
        });
    }

    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(TerminalSession {
        master: pair.master,
        writer,
        killer,
    })
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}
