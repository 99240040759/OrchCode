use std::time::Duration;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use tauri::Manager;

use super::ToolError;
use crate::state::BrowserRequestsHandle;

const CONTENT_TIMEOUT_MS: u64 = 15_000;
const WEBVIEW_WAIT_MS: u64 = 8_000;
const EVAL_ERROR_SENTINEL: &str = "[[eval-error]] ";

async fn require_browser_webview(app: &tauri::AppHandle) -> Result<tauri::Webview, ToolError> {
    let deadline = std::time::Instant::now() + Duration::from_millis(WEBVIEW_WAIT_MS);
    loop {
        if let Some(wv) = app
            .webviews()
            .into_values()
            .find(|wv| wv.label().starts_with("browser-"))
        {
            return Ok(wv);
        }
        if std::time::Instant::now() >= deadline {
            return Err(ToolError::msg(
                "no browser tab is open: call browser_navigate first",
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn validate_http_url(url: &str) -> Result<tauri::Url, ToolError> {
    let normalized = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    let parsed: tauri::Url = normalized
        .parse()
        .map_err(|e| ToolError::msg(format!("invalid url: {e}")))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(ToolError::msg(
            "only http:// and https:// URLs are permitted",
        ));
    }
    Ok(parsed)
}

async fn eval_js(
    wv: &tauri::Webview,
    browser_requests: &BrowserRequestsHandle,
    expression: &str,
) -> Result<String, ToolError> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let mut guard = browser_requests
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard.insert(request_id.clone(), tx);
    }

    let script = format!(
        r#"(async () => {{
            const __send = (text) => window.__TAURI_INTERNALS__.invoke('deliver_browser_content', {{ requestId: '{request_id}', text: text }});
            try {{
                let __result = ({expression});
                __result = await __result;
                await __send(String(__result));
            }} catch (e) {{
                await __send('{EVAL_ERROR_SENTINEL}' + (e && e.message ? e.message : String(e)));
            }}
        }})()"#
    );

    if let Err(e) = wv.eval(&script) {
        let mut guard = browser_requests
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        guard.remove(&request_id);
        return Err(ToolError::msg(format!("browser eval failed: {e}")));
    }

    let received = match tokio::time::timeout(Duration::from_millis(CONTENT_TIMEOUT_MS), rx).await {
        Ok(Ok(content)) => content,
        Ok(Err(_)) => {
            return Err(ToolError::msg("browser eval channel closed unexpectedly"));
        }
        Err(_) => {
            let mut guard = browser_requests
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            guard.remove(&request_id);
            return Err(ToolError::msg(
                "timed out waiting for the browser page to respond",
            ));
        }
    };

    match received.strip_prefix(EVAL_ERROR_SENTINEL) {
        Some(message) => Err(ToolError::msg(format!("page script error: {message}"))),
        None => Ok(received),
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserNavigateArgs {
    pub url: String,
}

pub struct BrowserNavigate {
    app_handle: tauri::AppHandle,
}

impl BrowserNavigate {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl Tool for BrowserNavigate {
    const NAME: &'static str = "browser_navigate";
    type Error = ToolError;
    type Args = BrowserNavigateArgs;
    type Output = String;

    fn description(&self) -> String {
        "Open a URL in the integrated browser panel. \
Accepts any http:// or https:// URL — the browser tab opens automatically if not already visible. \
Use this to preview web UIs, inspect live documentation, test deployed applications, or verify that \
a web page behaves as expected after making changes. \
After navigating, call browser_get_content to read the page text, or use browser_click and browser_type \
to interact with forms and buttons. \
Returns a confirmation when navigation completes."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserNavigateArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let url = validate_http_url(&args.url)?;
        let wv = require_browser_webview(&self.app_handle).await?;
        wv.navigate(url.clone())
            .map_err(|e| ToolError::msg(format!("navigation failed: {e}")))?;
        Ok(format!("Navigated to {url}"))
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserClickArgs {
    pub selector: String,
}

pub struct BrowserClick {
    app_handle: tauri::AppHandle,
    browser_requests: BrowserRequestsHandle,
}

impl BrowserClick {
    pub fn new(app_handle: tauri::AppHandle, browser_requests: BrowserRequestsHandle) -> Self {
        Self {
            app_handle,
            browser_requests,
        }
    }
}

impl Tool for BrowserClick {
    const NAME: &'static str = "browser_click";
    type Error = ToolError;
    type Args = BrowserClickArgs;
    type Output = String;

    fn description(&self) -> String {
        "Click a DOM element in the currently open browser page using a CSS selector. \
Use this to submit forms, activate buttons, open dropdowns, navigate tabs, or trigger any interactive UI element. \
The selector must match a visible, clickable element — use browser_get_content first to understand \
the page structure if needed. \
Returns a confirmation on success, or an error if no element matches the selector."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserClickArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let wv = require_browser_webview(&self.app_handle).await?;
        let sel = serde_json::to_string(&args.selector)
            .map_err(|e| ToolError::msg(format!("invalid selector: {e}")))?;
        let expr = format!(
            "(() => {{ const el = document.querySelector({sel}); if (!el) return 'not_found'; el.click(); return 'clicked'; }})()"
        );

        match eval_js(&wv, &self.browser_requests, &expr).await?.trim() {
            "clicked" => Ok(format!("Clicked '{}'", args.selector)),
            "not_found" => Err(ToolError::msg(format!(
                "no element matches selector '{}'",
                args.selector
            ))),
            other => Err(ToolError::msg(format!("click failed: {other}"))),
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserTypeArgs {
    pub selector: String,
    pub text: String,
}

pub struct BrowserType {
    app_handle: tauri::AppHandle,
    browser_requests: BrowserRequestsHandle,
}

impl BrowserType {
    pub fn new(app_handle: tauri::AppHandle, browser_requests: BrowserRequestsHandle) -> Self {
        Self {
            app_handle,
            browser_requests,
        }
    }
}

impl Tool for BrowserType {
    const NAME: &'static str = "browser_type";
    type Error = ToolError;
    type Args = BrowserTypeArgs;
    type Output = String;

    fn description(&self) -> String {
        "Set the value of an input field or textarea in the currently open browser page using a CSS selector. \
Use this to fill in search boxes, forms, login fields, or any text input. \
The text parameter replaces the current value and fires input and change events so reactive frameworks update. \
Returns a confirmation on success, or an error if no element matches the selector. \
After typing into a form, use browser_click to submit it."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserTypeArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let wv = require_browser_webview(&self.app_handle).await?;
        let sel = serde_json::to_string(&args.selector)
            .map_err(|e| ToolError::msg(format!("invalid selector: {e}")))?;
        let text = serde_json::to_string(&args.text)
            .map_err(|e| ToolError::msg(format!("invalid text: {e}")))?;
        let expr = format!(
            "(() => {{ const el = document.querySelector({sel}); if (!el) return 'not_found'; el.focus(); el.value = {text}; el.dispatchEvent(new Event('input', {{ bubbles: true }})); el.dispatchEvent(new Event('change', {{ bubbles: true }})); return 'typed'; }})()"
        );

        match eval_js(&wv, &self.browser_requests, &expr).await?.trim() {
            "typed" => Ok(format!("Typed into '{}'", args.selector)),
            "not_found" => Err(ToolError::msg(format!(
                "no element matches selector '{}'",
                args.selector
            ))),
            other => Err(ToolError::msg(format!("type failed: {other}"))),
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct BrowserGetContentArgs {}

pub struct BrowserGetContent {
    app_handle: tauri::AppHandle,
    browser_requests: BrowserRequestsHandle,
}

impl BrowserGetContent {
    pub fn new(app_handle: tauri::AppHandle, browser_requests: BrowserRequestsHandle) -> Self {
        Self {
            app_handle,
            browser_requests,
        }
    }
}

impl Tool for BrowserGetContent {
    const NAME: &'static str = "browser_get_content";
    type Error = ToolError;
    type Args = BrowserGetContentArgs;
    type Output = String;

    fn description(&self) -> String {
        "Extract all visible text from the currently open browser page. \
Use this after browser_navigate to verify what the page actually contains — \
check for error messages, rendered output, form labels, loaded data, or any visible UI text. \
Returns up to 500,000 characters of innerText. \
Call this to confirm a UI change worked, to read documentation, or to understand page structure \
before using browser_click or browser_type."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(BrowserGetContentArgs)).unwrap_or_default()
    }

    async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        let wv = require_browser_webview(&self.app_handle).await?;
        eval_js(
            &wv,
            &self.browser_requests,
            "document.body ? document.body.innerText.slice(0, 500000) : ''",
        )
        .await
    }
}
