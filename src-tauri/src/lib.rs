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
pub mod run_persistence;
pub mod skills;
pub mod state;
pub mod terminal;
pub mod tools;
pub mod util;

use state::AppState;
use tauri::{Emitter, Manager};

const MAIN_WINDOW_LABEL: &str = "main";

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

async fn handle_connector_callback(app: &tauri::AppHandle, rest: &str) {
    let state = app.state::<AppState>();
    let (connector_id, code, oauth_state, callback_error) = parse_connector_oauth_callback(rest);
    let payload = if let Some(error) = callback_error {
        serde_json::json!({ "connector": null, "error": error, "connectorId": connector_id })
    } else if connector_id.is_empty() || code.is_empty() || oauth_state.is_empty() {
        serde_json::json!({
            "connector": null,
            "error": "Invalid connector sign-in callback",
            "connectorId": connector_id
        })
    } else {
        match ipc::complete_connector_auth(&state, connector_id.clone(), code, oauth_state).await {
            Ok(dto) => serde_json::json!({ "connector": dto, "error": null, "connectorId": connector_id }),
            Err(err) => serde_json::json!({ "connector": null, "error": err, "connectorId": connector_id }),
        }
    };
    let _ = app.emit("connector-changed", payload);
}

async fn handle_sign_in_callback(app: &tauri::AppHandle, raw_url: &str) {
    let state = app.state::<AppState>();
    let Some(session_id) = state.consume_sign_in_window() else {
        if state.current_user_id().is_none() {
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
            let _ = app.emit("auth-error", serde_json::json!({ "error": err }));
        }
    }
}

async fn handle_deep_link_url(app: &tauri::AppHandle, raw_url: &str) {
    if let Some(rest) = util::strip_prefix_ignore_ascii_case(raw_url, "orch://oauth/") {
        handle_connector_callback(app, rest).await;
    } else if util::strip_prefix_ignore_ascii_case(raw_url, "orch://").is_some() {
        handle_sign_in_callback(app, raw_url).await;
    }
    focus_main_window(app);
}

fn parse_connector_oauth_callback(rest: &str) -> (String, String, String, Option<String>) {
    let (connector_id, query) = rest.split_once('?').unwrap_or((rest, ""));
    let connector_id = connector_id.trim_end_matches('/');
    let mut code = String::new();
    let mut state = String::new();
    let mut error = None;

    for part in query.split('&') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        let value = urlencoding::decode(&value.replace('+', " "))
            .map(|decoded| decoded.into_owned())
            .unwrap_or_else(|_| value.to_string());
        match key {
            "code" => code = value,
            "state" => state = value,
            "error_description" => error = Some(value),
            "error" if error.is_none() => error = Some(value),
            _ => {}
        }
    }

    (connector_id.to_string(), code, state, error)
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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            util::warm_login_shell_path();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            skills::seed_bundled_skills(&data_dir);

            let app_state = AppState::new(&data_dir)?;
            app.manage(app_state);

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>();
                if let Err(e) = state.connector_manager.initialize(&state.memory).await {
                    eprintln!("connector manager init failed: {e}");
                }
            });

            AppState::spawn_background_loops(app.handle().clone());

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                app.deep_link().register_all()?;
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
            fsapi::read_parsed_document,
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
            ipc::get_session_view,
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
            ipc::ipc_ingest_document,
            ipc::ipc_list_documents,
            ipc::ipc_get_document,
            ipc::ipc_delete_document,
            ipc::ipc_search_documents,
            ipc::ipc_count_documents,
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
        }
    });
}
