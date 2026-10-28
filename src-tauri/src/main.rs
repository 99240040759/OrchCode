#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    use tracing_subscriber::prelude::*;

    let dsn = orch_lib::config::sentry_dsn();
    let _guard = if !dsn.is_empty() {
        Some(sentry::init((
            dsn,
            sentry::ClientOptions {
                release: sentry::release_name!(),
                environment: Some(if cfg!(debug_assertions) {
                    std::borrow::Cow::Borrowed("development")
                } else {
                    std::borrow::Cow::Borrowed("production")
                }),
                auto_session_tracking: true,
                attach_stacktrace: true,
                send_default_pii: false,
                ..Default::default()
            },
        )))
    } else {
        None
    };

    let fmt_layer = tracing_subscriber::fmt::layer().with_ansi(cfg!(debug_assertions));
    if _guard.is_some() {
        tracing_subscriber::registry()
            .with(fmt_layer)
            .with(sentry_tracing::layer())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(fmt_layer)
            .init();
    }

    orch_lib::run();
}
