pub mod auth;
pub mod browser;
pub mod config;
pub mod connector_tools;
pub mod connectors;
pub mod dictation;
pub mod document;
pub mod error;
pub mod events;
pub mod fsapi;
pub mod gateway;
pub mod ipc;
pub mod llm;
pub mod persistence;
pub mod platform;
pub mod skills;
pub mod state;
pub mod terminal;
pub mod tools;

use state::AppState;
use tauri::{Emitter, Manager};

const MAIN_WINDOW_LABEL: &str = "main";

async fn handle_deep_link_url(app: &tauri::AppHandle, raw_url: &str) {
    if let Some(rest) = raw_url.strip_prefix("orch://oauth/") {
        let state = app.state::<AppState>();
        let (connector_id, code) = parse_connector_oauth_callback(rest);
        if !connector_id.is_empty() && !code.is_empty() {
            match ipc::complete_connector_auth(
                state.clone(),
                connector_id.clone(),
                code,
            )
            .await
            {
                Ok(dto) => {
                    let _ = app.emit(
                        "connector-changed",
                        serde_json::json!({ "connector": dto, "error": null }),
                    );
                }
                Err(err) => {
                    let _ = app.emit(
                        "connector-changed",
                        serde_json::json!({ "connector": null, "error": err, "connectorId": connector_id }),
                    );
                }
            }
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            return;
        }
    }

    let state = app.state::<AppState>();

    if !state.consume_sign_in_window() {
        let _ = app.emit(
            "auth-changed",
            serde_json::json!({
                "user": null,
                "error": "Unexpected sign-in callback: start sign-in from the app and try again"
            }),
        );
        return;
    }

    match auth::handle_auth_callback(&state.token, raw_url).await {
        Ok(user) => {
            state.set_authenticated_user(&user.id);
            let _ = app.emit(
                "auth-changed",
                serde_json::json!({ "user": user, "error": null }),
            );
        }
        Err(err) => {
            let _ = app.emit(
                "auth-changed",
                serde_json::json!({ "user": null, "error": err }),
            );
        }
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn parse_connector_oauth_callback(rest: &str) -> (String, String) {
    let (connector_id, query) = rest.split_once('?').unwrap_or((rest, ""));
    let code = query
        .split('&')
        .find_map(|part| {
            let (k, v) = part.split_once('=')?;
            if k == "code" {
                Some(urlencoding::decode(v).unwrap_or_default().into_owned())
            } else {
                None
            }
        })
        .unwrap_or_default();
    (connector_id.to_string(), code)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                for arg in args {
                    if arg.to_lowercase().starts_with("orch://") {
                        handle_deep_link_url(&app_handle, &arg).await;
                    }
                }
            });
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            skills::seed_bundled_skills(&data_dir);

            let app_state = AppState::new(&data_dir)?;
            app.manage(app_state);

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>();
                if let Err(e) = state
                    .connector_manager
                    .initialize(&state.memory)
                    .await
                {
                    eprintln!("connector manager init failed: {e}");
                }
            });

            AppState::spawn_background_loops(app.handle().clone());

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(target_os = "windows")]
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
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
                Box::new(tauri::generate_handler![
                browser::webview_navigate,
                browser::webview_history,
                browser::webview_close,
                fsapi::list_workspace_files,
                fsapi::read_text_file,
                fsapi::read_image_data_url,
                fsapi::read_binary_file_as_data_url,
                fsapi::read_document_metadata,
                fsapi::read_parsed_document,
                ipc::get_auth_user,
                ipc::get_oauth_url,
                ipc::sign_out_auth,
                ipc::set_workspace,
                ipc::get_workspace_info,
                ipc::use_sandbox,
                ipc::list_models,
                ipc::get_budget,
                ipc::list_sessions,
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
                ipc::complete_connector_auth,
                ipc::disconnect_connector,
                ipc::ipc_ingest_document,
                ipc::ipc_list_documents,
                ipc::ipc_get_document,
                ipc::ipc_delete_document,
                ipc::ipc_search_documents,
                ipc::ipc_count_documents,
                ]);
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                handler(invoke)
            }
        })
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
