use tauri::Manager;

fn browser_webview(app: &tauri::AppHandle, label: &str) -> Result<tauri::Webview, String> {
    if !label.starts_with("browser-") {
        return Err("invalid browser tab".to_string());
    }

    app.webviews()
        .into_values()
        .find(|webview| webview.label() == label)
        .ok_or_else(|| format!("browser tab not found: {label}"))
}

fn parse_http_url(url: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("only http:// and https:// URLs are permitted".to_string()),
    }
}

#[tauri::command]
pub fn webview_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    let webview = browser_webview(&app, &label)?;
    let url = parse_http_url(&url)?;
    webview
        .navigate(url)
        .map_err(|e| format!("browser navigation failed: {e}"))
}

#[tauri::command]
pub fn webview_history(
    app: tauri::AppHandle,
    label: String,
    action: String,
) -> Result<(), String> {
    let webview = browser_webview(&app, &label)?;
    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(format!("unsupported browser history action: {action}")),
    };

    webview
        .eval(script)
        .map_err(|e| format!("browser history action failed: {e}"))
}
