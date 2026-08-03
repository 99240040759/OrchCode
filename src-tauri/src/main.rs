#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let dsn = orch_lib::config::sentry_dsn();
    let _guard = if !dsn.is_empty() && !cfg!(debug_assertions) {
        Some(sentry::init((
            dsn,
            sentry::ClientOptions {
                release: sentry::release_name!(),
                auto_session_tracking: true,
                ..Default::default()
            },
        )))
    } else {
        None
    };

    orch_lib::run();
}
