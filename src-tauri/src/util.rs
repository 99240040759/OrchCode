use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn http_client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(concat!("Orch/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(120))
                .build()
                .expect("failed to build shared http client")
        })
        .clone()
}
