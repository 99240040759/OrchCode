use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{self, Sender};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::events::TerminalEvent;

pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    input: Sender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

impl TerminalSession {
    pub fn write(&self, data: &str) -> bool {
        self.input.send(data.as_bytes().to_vec()).is_ok()
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    pub fn kill(&mut self) {
        let _ = self.killer.kill();
    }
}

fn shell_command(cwd: &Path) -> CommandBuilder {
    #[cfg(target_os = "windows")]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut cmd = CommandBuilder::new_default_prog();
        if let Some(path) = crate::util::login_shell_path() {
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
    on_exit: Box<dyn FnOnce() + Send + 'static>,
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

    let mut child = pair
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

    let (input, input_rx) = mpsc::channel::<Vec<u8>>();
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
                        if !text.is_empty() && channel.send(TerminalEvent::Data { data: text }).is_err() {
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
        input,
        killer,
    })
}
