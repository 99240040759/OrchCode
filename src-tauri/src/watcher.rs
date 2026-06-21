use anyhow::Result;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::LazyLock;
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter};
use crate::workspace::IGNORED_DIRS;

static WATCHER: LazyLock<Mutex<Option<RecommendedWatcher>>> = LazyLock::new(|| Mutex::new(None));
#[derive(Debug, Serialize, Clone)]
pub struct FsChange { pub paths: Vec<String>, pub kind: String }
pub fn start(app: AppHandle, workspace_path: &str) -> Result<()> {
    stop();
    let path = PathBuf::from(workspace_path);
    if !path.exists() { return Ok(()); }
    let ignored = IGNORED_DIRS;
    let app_clone = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        let kind = match event.kind {
            EventKind::Create(_) => "create",
            EventKind::Modify(_) => "modify",
            EventKind::Remove(_) => "remove",
            _ => return,
        };
        let paths: Vec<String> = event.paths.iter()
            .filter(|p| {
                let s = p.to_string_lossy();
                !ignored.iter().any(|ig| s.contains(&format!("/{ig}/")) || s.contains(&format!("\\{ig}\\")))
            })
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();
        if paths.is_empty() { return; }
        let _ = app_clone.emit("fs:change", FsChange { paths, kind: kind.to_string() });
    })?;
    // L9: remove poll interval — RecommendedWatcher on Windows uses ReadDirectoryChangesW natively
    watcher.watch(&path, RecursiveMode::Recursive)?;
    if let Ok(mut w) = WATCHER.lock() { *w = Some(watcher); }
    Ok(())
}
pub fn stop() {
    if let Ok(mut w) = WATCHER.lock() { *w = None; }
}
