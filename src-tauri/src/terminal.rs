use anyhow::{anyhow, Result};
use dashmap::DashMap;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
pub struct Pty { pub master: Box<dyn MasterPty + Send>, pub writer: Box<dyn Write + Send> }
#[derive(Default)]
pub struct PtyStore(pub DashMap<String, Arc<Mutex<Pty>>>);
pub async fn create(store: &PtyStore, app: &AppHandle, id: &str, cols: u16, rows: u16, cwd: Option<&str>) -> Result<()> {
    if store.0.contains_key(id) { close(store, id); }
    let sys = native_pty_system();
    let pair = sys.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
    let shell = detect_shell();
    let mut cmd = CommandBuilder::new(&shell);
    if let Some(d) = cwd {
        if !d.is_empty() { cmd.cwd(d); }
    }
    pair.slave.spawn_command(cmd)?;
    drop(pair.slave);
    let writer = pair.master.take_writer()?;
    let mut reader = pair.master.try_clone_reader()?;
    let entry = Arc::new(Mutex::new(Pty { master: pair.master, writer }));
    store.0.insert(id.to_string(), entry);
    let app = app.clone();
    let id = id.to_string();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => { let _ = app.emit(&format!("terminal:data:{id}"), String::from_utf8_lossy(&buf[..n]).to_string()); }
            }
        }
    });
    Ok(())
}
pub async fn write(store: &PtyStore, id: &str, data: &str) -> Result<()> {
    let e = store.0.get(id).ok_or_else(|| anyhow!("No PTY: {id}"))?;
    e.lock().await.writer.write_all(data.as_bytes())?; Ok(())
}
pub async fn resize(store: &PtyStore, id: &str, cols: u16, rows: u16) -> Result<()> {
    let e = store.0.get(id).ok_or_else(|| anyhow!("No PTY: {id}"))?;
    e.lock().await.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?; Ok(())
}
pub fn close(store: &PtyStore, id: &str) { store.0.remove(id); }
fn detect_shell() -> String {
    #[cfg(windows)] { std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()) }
    #[cfg(not(windows))] { std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()) }
}
