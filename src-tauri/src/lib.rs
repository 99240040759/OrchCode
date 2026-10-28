pub mod auth;
pub mod browser;
pub mod config;
pub mod connector_tools;
pub mod connectors;
pub mod credentials;
pub mod dictation;
pub mod document;
pub mod error;
pub mod events;
pub mod fsapi;
pub mod gateway;
pub mod ipc;
pub mod llm;
pub mod media;
pub mod persistence;
pub mod platform;
pub mod session;
pub mod skills;
pub mod state;
pub mod terminal;
pub mod tools;
pub mod util;

use state::AppState;
use tauri::{Emitter, Manager};

pub const MAIN_WINDOW_LABEL: &str = "main";

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

async fn handle_connector_callback(app: &tauri::AppHandle, rest: &str) {
    let error = connector_callback_error(rest);
    if let Some(ref err) = error {
        sentry::capture_message(&format!("connector callback error: {err}"), sentry::Level::Warning);
    }
    let _ = app.emit("connector-changed", serde_json::json!({ "error": error }));
}

async fn handle_sign_in_callback(app: &tauri::AppHandle, raw_url: &str) {
    let state = app.state::<AppState>();
    let _guard = state.sign_in_lock.lock().await;

    if state.is_recent_auth_callback(raw_url) {
        return;
    }
    state.mark_recent_auth_callback(raw_url);

    let Some(session_id) = state.consume_sign_in_window() else {
        if state.current_user_id().is_none() {
            sentry::capture_message("sign-in link expired or consumed", sentry::Level::Warning);
            let _ = app.emit(
                "auth-error",
                serde_json::json!({
                    "error": "This sign-in link has expired. Start sign-in from the app and try again."
                }),
            );
        }
        return;
    };

    match auth::handle_auth_callback(raw_url, session_id.as_deref()).await {
        Ok(completed) => {
            state
                .complete_sign_in(completed.id_token, &completed.profile)
                .await;
            let _ = app.emit(
                "auth-changed",
                serde_json::json!({
                    "user": auth::UserDisplay::from_profile(&completed.profile),
                    "error": null
                }),
            );
        }
        Err(err) => {
            sentry::capture_message(&format!("auth callback error: {err}"), sentry::Level::Error);
            let _ = app.emit("auth-error", serde_json::json!({ "error": err }));
        }
    }
}

async fn handle_deep_link_url(app: &tauri::AppHandle, raw_url: &str) {
    if let Some(rest) = util::strip_prefix_ignore_ascii_case(raw_url, "orch://oauth/") {
        handle_connector_callback(app, rest).await;
    } else if is_sign_in_callback_url(raw_url) {
        handle_sign_in_callback(app, raw_url).await;
    }
    focus_main_window(app);
}

fn is_sign_in_callback_url(raw_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw_url) else {
        return false;
    };
    url.scheme().eq_ignore_ascii_case("orch")
        && url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("auth-callback"))
        && (url.path().is_empty() || url.path() == "/")
}

const INVALID_CONNECTOR_CALLBACK: &str = "Invalid connector sign-in callback";

fn connector_callback_error(rest: &str) -> Option<String> {
    let normalized = format!("http://localhost/{}", rest.trim_start_matches('/'));
    let Ok(url) = reqwest::Url::parse(&normalized) else {
        return Some(INVALID_CONNECTOR_CALLBACK.to_string());
    };
    if url.path().trim_matches('/') != "composio" {
        return Some(INVALID_CONNECTOR_CALLBACK.to_string());
    }
    let status = url
        .query_pairs()
        .find(|(key, _)| key == "status")
        .map(|(_, value)| value.into_owned());
    match status.as_deref() {
        Some("success") => None,
        Some("failed") => Some("The connector sign-in was not completed".to_string()),
        _ => Some(INVALID_CONNECTOR_CALLBACK.to_string()),
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut handled = false;
                for arg in args {
                    if util::strip_prefix_ignore_ascii_case(&arg, "orch://").is_some() {
                        handled = true;
                        handle_deep_link_url(&app_handle, &arg).await;
                    }
                }
                if !handled {
                    focus_main_window(&app_handle);
                }
            });
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            sentry::add_breadcrumb(sentry::Breadcrumb {
                category: Some("lifecycle".to_string()),
                message: Some("app setup initialized".to_string()),
                level: sentry::Level::Info,
                ..Default::default()
            });
            util::warm_login_shell_path();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            skills::seed_bundled_skills(&data_dir);

            let app_state = AppState::new(&data_dir)?;
            app.manage(app_state);

            AppState::spawn_background_loops(app.handle().clone());

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                {
                    let _ = app.deep_link().register_all();
                    let handle = app.handle().clone();
                    let args: Vec<String> = std::env::args().skip(1).collect();
                    tauri::async_runtime::spawn(async move {
                        for arg in args {
                            if util::strip_prefix_ignore_ascii_case(&arg, "orch://").is_some() {
                                handle_deep_link_url(&handle, &arg).await;
                            }
                        }
                    });
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        for url in urls {
                            handle_deep_link_url(&handle, url.as_str()).await;
                        }
                    });
                });
            }

            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                platform::setup_native_window(&window);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            browser::webview_navigate,
            browser::webview_history,
            browser::webview_close,
            fsapi::list_workspace_files,
            fsapi::read_text_file,
            fsapi::read_image_data_url,
            fsapi::read_binary_file,
            fsapi::read_document_metadata,
            fsapi::read_spreadsheet,
            ipc::get_auth_user,
            ipc::get_oauth_url,
            ipc::sign_out_auth,
            ipc::set_workspace,
            ipc::create_quick_project_dir,
            ipc::list_sessions_for_workspace,
            ipc::forget_workspace,
            ipc::list_models,
            ipc::get_budget,
            ipc::get_session_messages_page,
            ipc::clear_session,
            ipc::get_user_pref,
            ipc::set_user_pref,
            ipc::start_chat,
            ipc::cancel_chat,
            ipc::start_dictation,
            ipc::stop_dictation,
            ipc::terminal_open,
            ipc::terminal_write,
            ipc::terminal_resize,
            ipc::terminal_close,
            ipc::list_connectors,
            ipc::get_connector_auth_url,
            ipc::disconnect_connector,
            ipc::report_error,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the application");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            for (label, webview) in handle.webviews() {
                if label.starts_with("browser-") {
                    let _ = webview.close();
                }
            }
            handle.state::<AppState>().shutdown();
            // Flush Sentry before the process exits (macOS never unwinds main).
            if let Some(client) = sentry::Hub::current().client() {
                client.close(Some(std::time::Duration::from_secs(2)));
            }
        }
    });
}
