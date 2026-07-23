use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::ToolError;
use tauri::Manager;

const CONTENT_TIMEOUT_MS: u64 = 5_000;

fn find_browser_webview(app: &tauri::AppHandle) -> Option<tauri::Webview> {
    app.webviews().into_values().find(|wv| wv.label().starts_with("browser-"))
}

fn validate_http_url(url: &str) -> Result<String, ToolError> {
    let normalized = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    let parsed: tauri::Url = normalized.parse().map_err(|e| ToolError::msg(format!("invalid url: {e}")))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(ToolError::msg("only http:// and https:// URLs are permitted"));
    }
    Ok(normalized)
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserNavigateArgs {
    pub url: String,
}

pub struct BrowserNavigate {
    app_handle: Option<tauri::AppHandle>,
}

impl BrowserNavigate {
    pub fn new(app_handle: Option<tauri::AppHandle>) -> Self {
        Self { app_handle }
    }
}

impl Tool for BrowserNavigate {
    const NAME: &'static str = "browser_navigate";
    type Error = ToolError;
    type Args = BrowserNavigateArgs;
    type Output = String;

    fn description(&self) -> String {
        "Navigate the in-app browser to an http or https URL. An open browser tab must exist in the UI.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserNavigateArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let app = self.app_handle.as_ref().ok_or_else(|| ToolError::msg("app handle unavailable"))?;
        let url_str = validate_http_url(&args.url)?;
        let parsed_url: tauri::Url = url_str.parse().map_err(|e| ToolError::msg(format!("url parse error: {e}")))?;

        let wv = find_browser_webview(app).ok_or_else(|| ToolError::msg("no browser tab is open — open one in the UI first"))?;
        wv.navigate(parsed_url).map_err(|e| ToolError::msg(format!("navigation failed: {e}")))?;
        Ok(format!("Navigated to {url_str}"))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserClickArgs {
    pub selector: String,
}

pub struct BrowserClick {
    app_handle: Option<tauri::AppHandle>,
}

impl BrowserClick {
    pub fn new(app_handle: Option<tauri::AppHandle>) -> Self {
        Self { app_handle }
    }
}

impl Tool for BrowserClick {
    const NAME: &'static str = "browser_click";
    type Error = ToolError;
    type Args = BrowserClickArgs;
    type Output = String;

    fn description(&self) -> String {
        "Click an element in the active browser page by CSS selector.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserClickArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let app = self.app_handle.as_ref().ok_or_else(|| ToolError::msg("app handle unavailable"))?;
        let wv = find_browser_webview(app).ok_or_else(|| ToolError::msg("no browser tab is open"))?;

        let selector = args.selector.replace('\'', "\\'");
        let script = format!(
            "document.querySelector('{selector}') ? (document.querySelector('{selector}').click(), 'clicked') : 'not_found'"
        );

        let result_str = std::panic::AssertUnwindSafe(async {
            wv.eval(&format!("(() => {{ return {}; }})()", script))
                .map_err(|e| ToolError::msg(format!("eval failed: {e}")))
        })
        .await;

        match result_str {
            Ok(_) => Ok(format!("Clicked '{}'", args.selector)),
            Err(e) => Err(e),
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserTypeArgs {
    pub selector: String,
    pub text: String,
}

pub struct BrowserType {
    app_handle: Option<tauri::AppHandle>,
}

impl BrowserType {
    pub fn new(app_handle: Option<tauri::AppHandle>) -> Self {
        Self { app_handle }
    }
}

impl Tool for BrowserType {
    const NAME: &'static str = "browser_type";
    type Error = ToolError;
    type Args = BrowserTypeArgs;
    type Output = String;

    fn description(&self) -> String {
        "Type text into an input or textarea element in the active browser page by CSS selector.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserTypeArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let app = self.app_handle.as_ref().ok_or_else(|| ToolError::msg("app handle unavailable"))?;
        let wv = find_browser_webview(app).ok_or_else(|| ToolError::msg("no browser tab is open"))?;

        let selector = args.selector.replace('\'', "\\'");
        let text = args.text.replace('\'', "\\'");
        let script = format!(
            "(() => {{ const el = document.querySelector('{selector}'); if (!el) return 'not_found'; el.value = '{text}'; el.dispatchEvent(new Event('input', {{ bubbles: true }})); return 'typed'; }})()"
        );

        wv.eval(&script).map_err(|e| ToolError::msg(format!("eval failed: {e}")))?;
        Ok(format!("Typed into '{}'", args.selector))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserGetContentArgs {}

pub struct BrowserGetContent {
    app_handle: Option<tauri::AppHandle>,
    browser_requests: crate::state::BrowserRequestsHandle,
}

impl BrowserGetContent {
    pub fn new(app_handle: Option<tauri::AppHandle>, browser_requests: crate::state::BrowserRequestsHandle) -> Self {
        Self { app_handle, browser_requests }
    }
}

impl Tool for BrowserGetContent {
    const NAME: &'static str = "browser_get_content";
    type Error = ToolError;
    type Args = BrowserGetContentArgs;
    type Output = String;

    fn description(&self) -> String {
        "Get visible text content from the active browser page.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserGetContentArgs)).unwrap_or_default()
    }

    async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        let app = self.app_handle.as_ref().ok_or_else(|| ToolError::msg("app handle unavailable"))?;
        let wv = find_browser_webview(app).ok_or_else(|| ToolError::msg("no browser tab is open"))?;

        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();

        {
            let mut guard = self.browser_requests.lock().unwrap_or_else(|e| e.into_inner());
            guard.insert(request_id.clone(), tx);
        }

        let script = format!(
            r#"(async () => {{
                const text = document.body ? document.body.innerText.slice(0, 500000) : '';
                try {{
                    await window.__TAURI_INTERNALS__.invoke('deliver_browser_content', {{ requestId: '{}', text }});
                }} catch(e) {{
                    console.error('browser_get_content IPC error', e);
                }}
            }})()"#,
            request_id
        );

        wv.eval(&script).map_err(|e| {
            let mut guard = self.browser_requests.lock().unwrap_or_else(|e2| e2.into_inner());
            guard.remove(&request_id);
            ToolError::msg(format!("eval failed: {e}"))
        })?;

        match tokio::time::timeout(
            std::time::Duration::from_millis(CONTENT_TIMEOUT_MS),
            rx
        ).await {
            Ok(Ok(content)) => Ok(content),
            Ok(Err(_)) => Err(ToolError::msg("browser content channel closed unexpectedly")),
            Err(_) => {
                let mut guard = self.browser_requests.lock().unwrap_or_else(|e| e.into_inner());
                guard.remove(&request_id);
                Err(ToolError::msg("timeout waiting for browser page content"))
            }
        }
    }
}
