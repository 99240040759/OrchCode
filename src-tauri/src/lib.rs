#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod agent; mod auth; mod db; mod models; mod skills; mod state; mod terminal; mod tools; mod utils; mod workspace;
mod appdata; mod rag;
use serde_json::json;
use std::sync::Arc;
use std::sync::LazyLock;
use tauri::{AppHandle, Manager, State, WebviewWindowBuilder, ipc::Channel};
use terminal::PtyStore;
use state::{AppStateManager, AppSnapshot};
static CL100K: LazyLock<tiktoken_rs::CoreBPE> = LazyLock::new(|| tiktoken_rs::cl100k_base().expect("cl100k_base"));
static O200K: LazyLock<tiktoken_rs::CoreBPE>  = LazyLock::new(|| tiktoken_rs::o200k_base().expect("o200k_base"));
#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use rig::tool::Tool;
pub struct AppDb(pub Arc<sqlx::SqlitePool>);
pub struct AppDataDir(pub std::path::PathBuf);
fn ce(e: impl std::fmt::Display) -> String { let s = e.to_string(); tracing::error!("{s}"); s }
pub fn run() {
    // Panic hook: show native dialog so invisible-window crashes aren't ghost processes
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("OrchCode crashed:\n{info}");
        eprintln!("{msg}");
        #[cfg(target_os = "windows")] {
            use std::ffi::CString;
            unsafe {
                let text = CString::new(msg.clone()).unwrap_or_default();
                let title = CString::new("Orch Code — Fatal Error").unwrap_or_default();
                windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxA(
                    std::ptr::null_mut(), text.as_ptr() as _, title.as_ptr() as _, 0x10,
                );
            }
        }
        default_panic(info);
    }));
    let _sentry = sentry::init((
        env!("SENTRY_DSN").to_string(),
        sentry::ClientOptions { release: sentry::release_name!(),
            environment: Some(if cfg!(debug_assertions) { "development" } else { "production" }.into()),
            ..Default::default() },
    ));
    #[cfg(debug_assertions)] {
        let env_path = std::env::current_dir().ok().and_then(|d| {
            [d.join(".env"), d.parent()?.join(".env")].into_iter().find(|p| p.exists())
        });
        if let Some(p) = env_path { dotenv::from_path(p).ok(); } else { dotenv::dotenv().ok(); }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = app.get_webview_window("main").map(|w| w.set_focus());
        }))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let log_dir = data_dir.join("logs");
            std::fs::create_dir_all(&log_dir)?;
            let (writer, _guard) = tracing_appender::non_blocking(tracing_appender::rolling::daily(&log_dir, "orchcode.log"));
            let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("orchcode=debug,info"));
            let registry = tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer().with_writer(writer))
                .with(sentry::integrations::tracing::layer());
            #[cfg(debug_assertions)]
            let registry = registry.with(tracing_subscriber::fmt::layer().with_writer(std::io::stdout));
            registry.init();
            let db_path = data_dir.join("orchcode.db");
            let pool = Arc::new(tauri::async_runtime::block_on(db::init(&db_path))?);
            app.manage(AppDb(pool));
            app.manage(AppDataDir(data_dir));
            app.manage(PtyStore::default());
            app.manage(AppStateManager::new());
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")] {
                    let _ = w.set_decorations(false);
                    let _ = w.set_shadow(true);
                    let _ = apply_mica(&w, None);
                }
                #[cfg(target_os = "macos")] {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    let _ = apply_vibrancy(&w, NSVisualEffectMaterial::UnderWindowBackground, None, None);
                }
                w.show()?;
            }
            tracing::info!("OrchCode started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── State (atomic, backend-driven) ──
            cmd_state_init, cmd_state_activate_workspace, cmd_state_open_workspace,
            cmd_state_close_workspace, cmd_state_switch_thread, cmd_state_create_thread,
            cmd_state_delete_thread, cmd_state_generate_title,
            // ── Data queries (stateless) ──
            cmd_thread_messages, cmd_workspace_list_files_by_path, cmd_workspace_tsconfig,
            cmd_file_read, cmd_file_read_original, cmd_file_is_directory, cmd_file_open,
            // ── Agent (streaming, not state) ──
            cmd_agent_stream, cmd_agent_stop,
            // ── Terminal (frontend-driven lifecycle) ──
            cmd_terminal_create, cmd_terminal_write, cmd_terminal_resize, cmd_terminal_close,
            // ── Models / Auth / Budget / Settings ──
            cmd_models_list, cmd_quota_get,
            cmd_auth_login, cmd_auth_logout, cmd_auth_get_user, cmd_auth_complete_onboarding,
            cmd_count_tokens,
            // ── App lifecycle ──
            cmd_updater_check, cmd_updater_install, cmd_app_restart, cmd_app_version, cmd_settings_open,
            cmd_pick_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error running orchcode");
}
// ═══════════════════════════════════════════════════════════════════════════════
// STATE COMMANDS — atomic, return AppSnapshot
// ═══════════════════════════════════════════════════════════════════════════════
#[tauri::command] async fn cmd_state_init(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, app: AppHandle) -> Result<AppSnapshot, String> {
    sm.init(&db.0, &app).await.map_err(ce)
}
#[tauri::command] async fn cmd_state_activate_workspace(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, app: AppHandle, path: String) -> Result<AppSnapshot, String> {
    sm.activate_workspace(&db.0, &app, &path).await.map_err(ce)
}
#[tauri::command] async fn cmd_state_open_workspace(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, dd: State<'_, AppDataDir>, app: AppHandle, path: String) -> Result<AppSnapshot, String> {
    sm.open_workspace(&db.0, &app, &dd.0, &path).await.map_err(ce)
}
#[tauri::command] async fn cmd_state_close_workspace(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, dd: State<'_, AppDataDir>, app: AppHandle, path: String) -> Result<AppSnapshot, String> {
    sm.close_workspace(&db.0, &app, &dd.0, &path).await.map_err(ce)
}
#[tauri::command] async fn cmd_state_switch_thread(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, app: AppHandle, thread_id: String) -> Result<AppSnapshot, String> {
    sm.switch_thread(&db.0, &app, &thread_id).await.map_err(ce)
}
#[tauri::command] async fn cmd_state_create_thread(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, app: AppHandle) -> Result<AppSnapshot, String> {
    sm.create_thread(&db.0, &app).await.map_err(ce)
}
#[tauri::command] async fn cmd_state_delete_thread(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, app: AppHandle, thread_id: String) -> Result<AppSnapshot, String> {
    sm.delete_thread(&db.0, &app, &thread_id).await.map_err(ce)
}
#[tauri::command] async fn cmd_state_generate_title(sm: State<'_, AppStateManager>, db: State<'_, AppDb>, app: AppHandle, text: String, thread_id: String) -> Result<Option<String>, String> {
    let token = auth::require_token_async().await.map_err(ce)?;
    let truncated: String = text.chars().take(3000).collect();
    let resp: serde_json::Value = utils::authed_client(&token)
        .post(format!("{}/generate-title", utils::gcp_base()))
        .json(&json!({"text": &truncated}))
        .send().await.map_err(ce)?.error_for_status().map_err(ce)?.json().await.map_err(ce)?;
    let title = resp["title"].as_str().filter(|t| *t != "New Conversation").map(|s| s.trim().to_string());
    if let Some(ref t) = title { sm.update_title(&db.0, &app, &thread_id, t).await.map_err(ce)?; }
    Ok(title)
}
// ═══════════════════════════════════════════════════════════════════════════════
// DATA QUERIES — stateless
// ═══════════════════════════════════════════════════════════════════════════════
#[tauri::command] async fn cmd_thread_messages(db: State<'_, AppDb>, thread_id: String) -> Result<Vec<db::Message>, String> {
    db::msg_list(&db.0, &thread_id).await.map_err(ce)
}
#[tauri::command] fn cmd_workspace_list_files_by_path(workspace_path: String) -> Result<Vec<String>, String> {
    workspace::list_files_cached(&workspace_path).map_err(ce)
}
#[tauri::command] async fn cmd_workspace_tsconfig(workspace_path: String) -> Result<Option<serde_json::Value>, String> {
    let p = std::path::Path::new(&workspace_path).join("tsconfig.json");
    if !p.exists() { return Ok(None); }
    Ok(tokio::fs::read_to_string(p).await.ok().and_then(|s| serde_json::from_str(&s).ok()))
}
// ═══════════════════════════════════════════════════════════════════════════════
// FILES
// ═══════════════════════════════════════════════════════════════════════════════
#[tauri::command] async fn cmd_file_read(sm: State<'_, AppStateManager>, file_path: String) -> Result<serde_json::Value, String> {
    let root = sm.active_workspace_path().await.unwrap_or_default();
    tools::ViewFile { workspace_root: root }.call(tools::ViewFileArgs { absolute_path: file_path, start_line: None, end_line: None }).await.map_err(ce)
}
#[tauri::command] async fn cmd_file_read_original(sm: State<'_, AppStateManager>, file_path: String) -> Result<serde_json::Value, String> {
    let root = sm.active_workspace_path().await.unwrap_or_default();
    let rel = file_path.strip_prefix(&root).unwrap_or(&file_path).trim_start_matches(['/', '\\']).to_string();
    let out = tokio::process::Command::new("git").args(["show", &format!("HEAD:{rel}")]).current_dir(&root).output().await.map_err(ce)?;
    if out.status.success() { Ok(json!({"content":String::from_utf8_lossy(&out.stdout)})) } else { Err("Not in git history".into()) }
}
#[tauri::command] async fn cmd_file_is_directory(sm: State<'_, AppStateManager>, file_path: String) -> Result<bool, String> {
    let root = sm.active_workspace_path().await.unwrap_or_default();
    let safe = workspace::assert_safe(&root, &file_path).map_err(ce)?;
    Ok(std::path::Path::new(&safe).is_dir())
}
#[tauri::command] async fn cmd_file_open(file_path: String) -> Result<(), String> { open::that(file_path).map_err(ce) }
// ═══════════════════════════════════════════════════════════════════════════════
// AGENT
// ═══════════════════════════════════════════════════════════════════════════════
#[tauri::command] async fn cmd_agent_stream(app: AppHandle, db: State<'_, AppDb>, req: agent::StreamRequest, channel: Channel<agent::StreamChunk>) -> Result<(), String> {
    let pool = (*db.0).clone();
    let cancel = tokio_util::sync::CancellationToken::new();
    agent::CANCEL_TOKENS.insert(req.thread_id.clone(), cancel.clone());
    let ch2 = channel.clone();
    tokio::spawn(async move {
        if let Err(e) = agent::run_agent(req, pool, channel, cancel, app).await {
            tracing::error!("run_agent failed: {e}");
            let _ = ch2.send(agent::StreamChunk::Error { message: e.to_string() });
            let _ = ch2.send(agent::StreamChunk::Finish { duration_seconds: 0.0 });
        }
    });
    Ok(())
}
#[tauri::command] async fn cmd_agent_stop(thread_id: String) -> Result<(), String> {
    if let Some((_, t)) = agent::CANCEL_TOKENS.remove(&thread_id) { t.cancel(); }
    Ok(())
}
// ═══════════════════════════════════════════════════════════════════════════════
// TERMINAL / MODELS / AUTH / BUDGET / SETTINGS / APP
// ═══════════════════════════════════════════════════════════════════════════════
#[tauri::command] async fn cmd_terminal_create(app: AppHandle, store: State<'_, PtyStore>, id: String, cols: u16, rows: u16, cwd: Option<String>) -> Result<(), String> { terminal::create(&store, &app, &id, cols, rows, cwd.as_deref()).await.map_err(ce) }
#[tauri::command] async fn cmd_terminal_write(store: State<'_, PtyStore>, id: String, data: String) -> Result<(), String> { terminal::write(&store, &id, &data).await.map_err(|e| e.to_string()) }
#[tauri::command] async fn cmd_terminal_resize(store: State<'_, PtyStore>, id: String, cols: u16, rows: u16) -> Result<(), String> { terminal::resize(&store, &id, cols, rows).await.map_err(|e| e.to_string()) }
#[tauri::command] async fn cmd_terminal_close(store: State<'_, PtyStore>, id: String) -> Result<(), String> { terminal::close(&store, &id); Ok(()) }
#[tauri::command] async fn cmd_models_list() -> Result<Vec<models::ModelInfo>, String> { models::list(false).await.map_err(ce) }
#[tauri::command] async fn cmd_auth_login(app: AppHandle) -> Result<auth::UserProfile, String> { auth::login(app).await.map_err(ce) }
#[tauri::command] async fn cmd_auth_logout(app: AppHandle) -> Result<(), String> { auth::logout(&app).map_err(ce) }
#[tauri::command] async fn cmd_auth_get_user() -> Result<Option<auth::UserProfile>, String> { Ok(auth::get_user()) }
#[tauri::command] async fn cmd_auth_complete_onboarding() -> Result<(), String> { auth::complete_onboarding().await.map_err(ce) }
#[tauri::command] async fn cmd_quota_get() -> Result<serde_json::Value, String> {
    let token = auth::require_token_async().await.map_err(ce)?;
    utils::authed_client(&token).get(format!("{}/budget", utils::gcp_base())).send().await.map_err(ce)?.error_for_status().map_err(ce)?.json().await.map_err(ce)
}
#[tauri::command] async fn cmd_app_version(app: AppHandle) -> Result<String, String> { Ok(app.package_info().version.to_string()) }
#[tauri::command] fn cmd_app_restart(app: AppHandle) { app.restart(); }
#[tauri::command] async fn cmd_updater_check(app: AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater_builder().build().map_err(ce)?.check().await.map_err(ce)?;
    Ok(match update {
        Some(u) => json!({"available":true,"version":u.version,"body":u.body,"platform":std::env::consts::OS}),
        None    => json!({"available":false,"platform":std::env::consts::OS}),
    })
}
#[tauri::command] async fn cmd_updater_install(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    if let Some(u) = app.updater_builder().build().map_err(ce)?.check().await.map_err(ce)? {
        u.download_and_install(|_,_| {}, || {}).await.map_err(ce)?;
    }
    Ok(())
}
#[tauri::command] async fn cmd_settings_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") { return w.set_focus().map_err(ce); }
    WebviewWindowBuilder::new(&app, "settings", tauri::WebviewUrl::App("?view=settings".into()))
        .title("Settings").inner_size(680.0, 560.0).resizable(false).center().decorations(false)
        .build().map(|_| ()).map_err(ce)
}
#[tauri::command] async fn cmd_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    Ok(tauri_plugin_dialog::DialogExt::dialog(&app).file().set_title("Select Project Folder").blocking_pick_folder().map(|p| p.to_string()))
}
#[tauri::command] fn cmd_count_tokens(text: String, model_id: String) -> usize {
    let bpe: &tiktoken_rs::CoreBPE = if model_id.contains("gpt-4o") || model_id.starts_with("o1") || model_id.starts_with("o3") || model_id.contains("o1-") || model_id.contains("o3-") { &O200K } else { &CL100K };
    bpe.encode_ordinary(&text).len()
}

