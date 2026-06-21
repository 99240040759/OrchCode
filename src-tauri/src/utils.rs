use std::sync::LazyLock;

pub fn gcp_base() -> String {
    std::env::var("GCP_FUNCTIONS_URL").unwrap_or_else(|_| "https://api.orchcode.app".to_string())
}
pub fn model_base_url(model_id: &str) -> String {
    let base = gcp_base();
    let provider = provider_from_model(model_id);
    format!("{}/{}/v1", base.trim_end_matches('/'), provider)
}
pub fn provider_from_model(model_id: &str) -> &'static str {
    if model_id.starts_with("nvidia/") { "nvidia" }
    else if model_id.starts_with("opencode/") { "opencode" }
    else if model_id.starts_with("zai/") || model_id.starts_with("z-ai/") { "z-ai" }
    else { "opencode" }
}
pub fn strip_provider_prefix(model_id: &str) -> &str {
    model_id.find('/').map(|i| &model_id[i + 1..]).unwrap_or(model_id)
}
static BASE_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .pool_max_idle_per_host(10)
        .build().expect("failed to build reqwest client")
});
pub fn authed_client(token: &str) -> AuthedClient {
    AuthedClient { token: token.to_string() }
}
pub struct AuthedClient { token: String }
impl AuthedClient {
    pub fn get(&self, url: String) -> reqwest::RequestBuilder {
        self.apply(BASE_CLIENT.get(url))
    }
    pub fn post(&self, url: String) -> reqwest::RequestBuilder {
        self.apply(BASE_CLIENT.post(url))
    }

    fn apply(&self, rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut rb = rb.bearer_auth(&self.token);
        if let Ok(key) = std::env::var("SUPABASE_ANON_KEY") {
            rb = rb.header("apikey", key);
        }
        rb
    }
}

