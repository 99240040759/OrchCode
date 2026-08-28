use reqwest::RequestBuilder;
use serde_json::Value;

use crate::tools::ToolError;

pub mod github;
pub mod gmail;
pub mod google_drive;
pub mod jira;
pub mod notion;
pub mod slack;

pub async fn request_json(request: RequestBuilder, provider: &str) -> Result<Value, ToolError> {
    let response = request
        .send()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} request failed: {e}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} response read failed: {e}")))?;
    if !status.is_success() {
        return Err(ToolError::msg(format!(
            "{provider} API error ({}): {}",
            status.as_u16(),
            body
        )));
    }
    serde_json::from_str(&body)
        .map_err(|e| ToolError::msg(format!("{provider} response parse failed: {e}")))
}

pub async fn request_text(request: RequestBuilder, provider: &str) -> Result<String, ToolError> {
    let response = request
        .send()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} request failed: {e}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| ToolError::msg(format!("{provider} response read failed: {e}")))?;
    if !status.is_success() {
        return Err(ToolError::msg(format!(
            "{provider} API error ({}): {}",
            status.as_u16(),
            body
        )));
    }
    Ok(body)
}

pub fn truncate_text(text: &str, limit: usize, suffix: &str) -> String {
    let Some((end, _)) = text.char_indices().nth(limit) else {
        return text.to_string();
    };
    format!("{}{}", &text[..end], suffix)
}
