use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::config;
use crate::error::AppError;
use crate::gateway::TokenHandle;

const ACCOUNTS_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const TOOLS_TIMEOUT: Duration = Duration::from_secs(45);
const EXECUTE_TIMEOUT: Duration = Duration::from_secs(130);

#[derive(Debug, thiserror::Error)]
pub enum ComposioError {
    #[error("You are signed out of Orch. Sign in again to use connectors.")]
    NoToken,
    #[error("{message}")]
    Rejected {
        status: u16,
        code: Option<String>,
        message: String,
    },
    #[error("The connector service could not be reached: {0}")]
    Transport(String),
    #[error("The connector service sent an unexpected response: {0}")]
    Malformed(String),
}

impl From<ComposioError> for AppError {
    fn from(error: ComposioError) -> Self {
        match error {
            ComposioError::NoToken => AppError::NoToken,
            other => AppError::Connector(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AccountWire {
    pub id: String,
    pub toolkit: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolWire {
    pub slug: String,
    pub description: String,
    pub version: String,
    pub is_deprecated: bool,
    pub tags: Vec<String>,
    pub input_parameters: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExecuteWire {
    pub data: Value,
    pub error: Option<String>,
    pub successful: bool,
}

#[derive(Deserialize)]
struct AccountsWire {
    accounts: Vec<AccountWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectWire {
    redirect_url: String,
}

#[derive(Deserialize)]
struct ToolsWire {
    tools: Vec<ToolWire>,
}

#[derive(Deserialize)]
struct FailureWire {
    error: Option<String>,
    code: Option<String>,
}

#[derive(Clone)]
pub struct ComposioClient {
    http: reqwest::Client,
    token: TokenHandle,
}

impl ComposioClient {
    pub fn new(token: TokenHandle) -> Self {
        Self {
            http: crate::util::http_client(),
            token,
        }
    }

    fn bearer(&self) -> Result<String, ComposioError> {
        self.token
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .filter(|t| !t.is_empty())
            .ok_or(ComposioError::NoToken)
    }

    async fn send<T: for<'de> Deserialize<'de>>(
        &self,
        request: reqwest::RequestBuilder,
        timeout: Duration,
    ) -> Result<T, ComposioError> {
        let response = request
            .bearer_auth(self.bearer()?)
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| ComposioError::Transport(e.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| ComposioError::Transport(e.to_string()))?;
        if !status.is_success() {
            // Parse as structured failure if possible; fall back to raw body text.
            let (code, message) = if let Ok(failure) = serde_json::from_str::<FailureWire>(&body) {
                (
                    failure.code,
                    failure
                        .error
                        .unwrap_or_else(|| format!("The connector service failed ({})", status.as_u16())),
                )
            } else {
                (
                    None,
                    format!(
                        "status {}: {}",
                        status.as_u16(),
                        crate::util::truncate_chars(&body, 200)
                    ),
                )
            };
            return Err(ComposioError::Rejected { status: status.as_u16(), code, message });
        }
        serde_json::from_str(&body).map_err(|e| {
            ComposioError::Malformed(format!("{e}: {}", crate::util::truncate_chars(&body, 200)))
        })
    }

    pub async fn accounts(&self) -> Result<Vec<AccountWire>, ComposioError> {
        let wire: AccountsWire = self
            .send(self.http.get(config::composio_url("/accounts")), ACCOUNTS_TIMEOUT)
            .await?;
        Ok(wire.accounts)
    }

    pub async fn connect(&self, toolkit: &str) -> Result<String, ComposioError> {
        let wire: ConnectWire = self
            .send(
                self.http
                    .post(config::composio_url("/connect"))
                    .json(&json!({ "toolkit": toolkit })),
                CONNECT_TIMEOUT,
            )
            .await?;
        Ok(wire.redirect_url)
    }

    pub async fn disconnect(&self, account_id: &str) -> Result<(), ComposioError> {
        let account_param: String = url::form_urlencoded::byte_serialize(account_id.as_bytes()).collect();
        let path = format!("/accounts/{account_param}");
        let _: Value = self
            .send(self.http.delete(config::composio_url(&path)), ACCOUNTS_TIMEOUT)
            .await?;
        Ok(())
    }

    pub async fn tools(&self, slugs: &[&str]) -> Result<Vec<ToolWire>, ComposioError> {
        let slugs_param: String = url::form_urlencoded::byte_serialize(slugs.join(",").as_bytes()).collect();
        let path = format!("/tools?slugs={slugs_param}");
        let wire: ToolsWire = self
            .send(self.http.get(config::composio_url(&path)), TOOLS_TIMEOUT)
            .await?;
        Ok(wire.tools)
    }

    pub async fn execute(
        &self,
        slug: &str,
        version: &str,
        arguments: Value,
    ) -> Result<ExecuteWire, ComposioError> {
        self.send(
            self.http
                .post(config::composio_url("/execute"))
                .json(&json!({ "slug": slug, "version": version, "arguments": arguments })),
            EXECUTE_TIMEOUT,
        )
        .await
    }
}
