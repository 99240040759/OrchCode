use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use reqwest::Client;
use serde::Deserialize;
use url::Url;

use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::persistence::{ConnectorRecord, SqliteMemory};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthKind {
    None,
    OAuth2,
    ApiKey,
}

impl AuthKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthKind::None => "none",
            AuthKind::OAuth2 => "oauth2",
            AuthKind::ApiKey => "apikey",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectorDef {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub auth_kind: AuthKind,
    pub client_id_env: &'static str,
    pub client_secret_env: &'static str,
    pub auth_url: &'static str,
    pub token_url: &'static str,
    pub scopes: &'static [&'static str],
    pub deep_link_id: &'static str,
}

impl ConnectorDef {
    pub fn client_id(&self) -> String {
        if self.client_id_env.is_empty() {
            return String::new();
        }
        option_env_static(self.client_id_env)
    }

    pub fn client_secret(&self) -> String {
        if self.client_secret_env.is_empty() {
            return String::new();
        }
        option_env_static(self.client_secret_env)
    }

    pub fn is_configured(&self) -> bool {
        match self.auth_kind {
            AuthKind::None => true,
            _ => !self.client_id().is_empty(),
        }
    }
}

fn option_env_static(key: &str) -> String {
    match key {
        "GOOGLE_CLIENT_ID" => option_env!("GOOGLE_CLIENT_ID").unwrap_or("").to_string(),
        "GOOGLE_CLIENT_SECRET" => option_env!("GOOGLE_CLIENT_SECRET").unwrap_or("").to_string(),
        "GITHUB_CLIENT_ID" => option_env!("GITHUB_CLIENT_ID").unwrap_or("").to_string(),
        "GITHUB_CLIENT_SECRET" => option_env!("GITHUB_CLIENT_SECRET").unwrap_or("").to_string(),
        "NOTION_CLIENT_ID" => option_env!("NOTION_CLIENT_ID").unwrap_or("").to_string(),
        "NOTION_CLIENT_SECRET" => option_env!("NOTION_CLIENT_SECRET").unwrap_or("").to_string(),
        "SLACK_CLIENT_ID" => option_env!("SLACK_CLIENT_ID").unwrap_or("").to_string(),
        "SLACK_CLIENT_SECRET" => option_env!("SLACK_CLIENT_SECRET").unwrap_or("").to_string(),
        "JIRA_CLIENT_ID" => option_env!("JIRA_CLIENT_ID").unwrap_or("").to_string(),
        "JIRA_CLIENT_SECRET" => option_env!("JIRA_CLIENT_SECRET").unwrap_or("").to_string(),
        _ => String::new(),
    }
}

pub static CONNECTOR_DEFS: &[ConnectorDef] = &[
    ConnectorDef {
        id: "google_drive",
        name: "Google Drive",
        description: "Access files, folders, and documents stored in Google Drive.",
        category: "Cloud Storage",
        auth_kind: AuthKind::OAuth2,
        client_id_env: "GOOGLE_CLIENT_ID",
        client_secret_env: "GOOGLE_CLIENT_SECRET",
        auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
        token_url: "https://oauth2.googleapis.com/token",
        scopes: &[
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
        deep_link_id: "google_drive",
    },
    ConnectorDef {
        id: "gmail",
        name: "Gmail",
        description: "Search and read emails from Gmail.",
        category: "Communication",
        auth_kind: AuthKind::OAuth2,
        client_id_env: "GOOGLE_CLIENT_ID",
        client_secret_env: "GOOGLE_CLIENT_SECRET",
        auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
        token_url: "https://oauth2.googleapis.com/token",
        scopes: &[
            "https://www.googleapis.com/auth/gmail.readonly",
        ],
        deep_link_id: "gmail",
    },
    ConnectorDef {
        id: "github",
        name: "GitHub",
        description: "Access repositories, code, issues, and pull requests.",
        category: "Dev Tools",
        auth_kind: AuthKind::OAuth2,
        client_id_env: "GITHUB_CLIENT_ID",
        client_secret_env: "GITHUB_CLIENT_SECRET",
        auth_url: "https://github.com/login/oauth/authorize",
        token_url: "https://github.com/login/oauth/access_token",
        scopes: &["repo", "read:user"],
        deep_link_id: "github",
    },
    ConnectorDef {
        id: "notion",
        name: "Notion",
        description: "Read pages, databases, and documents from Notion workspaces.",
        category: "Productivity",
        auth_kind: AuthKind::OAuth2,
        client_id_env: "NOTION_CLIENT_ID",
        client_secret_env: "NOTION_CLIENT_SECRET",
        auth_url: "https://api.notion.com/v1/oauth/authorize",
        token_url: "https://api.notion.com/v1/oauth/token",
        scopes: &[],
        deep_link_id: "notion",
    },
    ConnectorDef {
        id: "slack",
        name: "Slack",
        description: "Search and read messages and files from Slack channels.",
        category: "Communication",
        auth_kind: AuthKind::OAuth2,
        client_id_env: "SLACK_CLIENT_ID",
        client_secret_env: "SLACK_CLIENT_SECRET",
        auth_url: "https://slack.com/oauth/v2/authorize",
        token_url: "https://slack.com/api/oauth.v2.access",
        scopes: &["channels:history", "channels:read", "files:read", "search:read", "users:read"],
        deep_link_id: "slack",
    },
    ConnectorDef {
        id: "jira",
        name: "Jira",
        description: "Access issues, projects, and sprint data from Jira Cloud.",
        category: "Dev Tools",
        auth_kind: AuthKind::OAuth2,
        client_id_env: "JIRA_CLIENT_ID",
        client_secret_env: "JIRA_CLIENT_SECRET",
        auth_url: "https://auth.atlassian.com/authorize",
        token_url: "https://auth.atlassian.com/oauth/token",
        scopes: &["read:jira-work", "read:jira-user", "offline_access"],
        deep_link_id: "jira",
    },
];

pub fn find_def(id: &str) -> Option<&'static ConnectorDef> {
    CONNECTOR_DEFS.iter().find(|d| d.id == id)
}

const CONNECTOR_OAUTH_STATE_TTL: Duration = Duration::from_secs(600);

fn keyring_account_access(connector_id: &str) -> String {
    format!("connector_{connector_id}_access")
}

fn keyring_account_refresh(connector_id: &str) -> String {
    format!("connector_{connector_id}_refresh")
}

pub fn save_connector_access_token(connector_id: &str, token: &str) -> AppResult<()> {
    credentials::save(&keyring_account_access(connector_id), token)
        .map_err(|e| AppError::ConnectorAuthError(e.to_string()))
}

pub fn load_connector_access_token(connector_id: &str) -> Option<String> {
    credentials::load(&keyring_account_access(connector_id))
}

pub fn save_connector_refresh_token(connector_id: &str, token: &str) -> AppResult<()> {
    credentials::save(&keyring_account_refresh(connector_id), token)
        .map_err(|e| AppError::ConnectorAuthError(e.to_string()))
}

pub fn load_connector_refresh_token(connector_id: &str) -> Option<String> {
    credentials::load(&keyring_account_refresh(connector_id))
}

pub fn clear_connector_tokens(connector_id: &str) {
    credentials::delete(&keyring_account_access(connector_id));
    credentials::delete(&keyring_account_refresh(connector_id));
}

pub fn clear_all_connector_tokens_keyring() {
    for def in CONNECTOR_DEFS {
        clear_connector_tokens(def.id);
    }
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub token_type: Option<String>,
}

pub async fn exchange_code(
    def: &ConnectorDef,
    code: &str,
    redirect_uri: &str,
    http: &Client,
) -> AppResult<TokenResponse> {
    let client_id = def.client_id();
    let secret = def.client_secret();
    let mut params: Vec<(&str, &str)> = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", &client_id),
    ];
    if !secret.is_empty() {
        params.push(("client_secret", &secret));
    }

    let resp = http
        .post(def.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::ConnectorAuthError(e.to_string()))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::ConnectorAuthError(format!(
            "token exchange failed: {body}"
        )));
    }

    resp.json::<TokenResponse>()
        .await
        .map_err(|e| AppError::ConnectorAuthError(format!("token parse error: {e}")))
}

pub const CONNECTOR_REDIRECT_BASE: &str = "https://orch.live/oauth";

pub fn connector_redirect_uri(deep_link_id: &str) -> String {
    format!("{}/{}", CONNECTOR_REDIRECT_BASE, deep_link_id)
}

pub fn build_auth_url(def: &ConnectorDef, state: &str) -> AppResult<String> {
    if !def.is_configured() {
        return Err(AppError::ConnectorNotConfigured(def.id.to_string()));
    }

    let redirect_uri = connector_redirect_uri(def.deep_link_id);
    let mut url = Url::parse(def.auth_url)
        .map_err(|e| AppError::ConnectorAuthError(format!("invalid OAuth URL: {e}")))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", &def.client_id());
        query.append_pair("redirect_uri", &redirect_uri);
        query.append_pair("response_type", "code");
        query.append_pair("state", state);
        if !def.scopes.is_empty() {
            query.append_pair("scope", &def.scopes.join(" "));
        }
        match def.id {
            "google_drive" | "gmail" => {
                query.append_pair("access_type", "offline");
                query.append_pair("prompt", "consent");
            }
            "jira" => {
                query.append_pair("audience", "api.atlassian.com");
                query.append_pair("prompt", "consent");
            }
            _ => {}
        }
    }
    Ok(url.into())
}

#[derive(Debug, Clone, Default)]
struct ConnectorRuntimeState {
    access_token: Option<String>,
    expires_at: Option<i64>,
}

pub struct ConnectorManager {
    states: Arc<RwLock<HashMap<String, ConnectorRuntimeState>>>,
    pending_oauth: Mutex<HashMap<String, (String, Instant)>>,
    http: Client,
    refresh_locks: HashMap<String, Arc<tokio::sync::Mutex<()>>>,
}

impl ConnectorManager {
    pub fn new() -> Self {
        let refresh_locks = CONNECTOR_DEFS
            .iter()
            .map(|def| (def.id.to_string(), Arc::new(tokio::sync::Mutex::new(()))))
            .collect();
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            pending_oauth: Mutex::new(HashMap::new()),
            http: Client::builder()
                .user_agent(concat!("Orch/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("failed to build connector http client"),
            refresh_locks,
        }
    }

    pub async fn initialize(&self, memory: &SqliteMemory) -> AppResult<()> {
        let existing = memory.list_connectors().await?;
        let existing_ids: std::collections::HashSet<String> =
            existing.iter().map(|r| r.id.clone()).collect();

        for def in CONNECTOR_DEFS {
            if !existing_ids.contains(def.id) {
                let ts = now_ms();
                memory
                    .upsert_connector(ConnectorRecord {
                        id: def.id.to_string(),
                        name: def.name.to_string(),
                        enabled: false,
                        auth_kind: def.auth_kind.as_str().to_string(),
                        has_token: false,
                        token_expires_at: None,
                        error: None,
                        updated_at: ts,
                    })
                    .await?;
            }
        }

        let records = memory.list_connectors().await?;
        let mut loaded = Vec::new();
        for rec in records {
            let token = load_connector_access_token(&rec.id);
            let has_token = token.is_some();
            if rec.has_token != has_token || rec.enabled != has_token {
                memory
                    .set_connector_token_state(&rec.id, has_token, rec.token_expires_at, None)
                    .await?;
                memory.set_connector_enabled(&rec.id, has_token).await?;
            }
            if let Some(access_token) = token {
                loaded.push((
                    rec.id,
                    ConnectorRuntimeState {
                        access_token: Some(access_token),
                        expires_at: rec.token_expires_at,
                    },
                ));
            }
        }

        let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
        states.extend(loaded);

        Ok(())
    }

    pub fn begin_oauth(&self, connector_id: &str) -> AppResult<String> {
        if find_def(connector_id).is_none() {
            return Err(AppError::ConnectorNotFound(connector_id.to_string()));
        }
        let state = uuid::Uuid::new_v4().to_string();
        let mut pending = self.pending_oauth.lock().unwrap_or_else(|e| e.into_inner());
        pending.retain(|_, (_, created)| created.elapsed() <= CONNECTOR_OAUTH_STATE_TTL);
        pending.insert(state.clone(), (connector_id.to_string(), Instant::now()));
        Ok(state)
    }

    pub fn consume_oauth(&self, connector_id: &str, state: &str) -> AppResult<()> {
        let mut pending = self.pending_oauth.lock().unwrap_or_else(|e| e.into_inner());
        let Some((expected_connector, created)) = pending.remove(state) else {
            return Err(AppError::ConnectorAuthError("invalid OAuth state".to_string()));
        };
        if created.elapsed() > CONNECTOR_OAUTH_STATE_TTL || expected_connector != connector_id {
            return Err(AppError::ConnectorAuthError("invalid OAuth state".to_string()));
        }
        Ok(())
    }

    pub async fn store_tokens(
        &self,
        connector_id: &str,
        token_resp: &TokenResponse,
        memory: &SqliteMemory,
    ) -> AppResult<()> {
        save_connector_access_token(connector_id, &token_resp.access_token)?;
        if let Some(rt) = &token_resp.refresh_token {
            save_connector_refresh_token(connector_id, rt)?;
        }

        let expires_at = token_resp.expires_in.map(|secs| now_ms() + secs * 1000);

        {
            let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
            states.insert(
                connector_id.to_string(),
                ConnectorRuntimeState {
                    access_token: Some(token_resp.access_token.clone()),
                    expires_at,
                },
            );
        }

        memory
            .set_connector_token_state(connector_id, true, expires_at, None)
            .await?;
        memory.set_connector_enabled(connector_id, true).await?;

        Ok(())
    }

    async fn refresh_access_token(
        &self,
        connector_id: &str,
        memory: &SqliteMemory,
    ) -> AppResult<String> {
        let def = find_def(connector_id)
            .ok_or_else(|| AppError::ConnectorNotFound(connector_id.to_string()))?;

        let refresh_token = load_connector_refresh_token(connector_id)
            .ok_or_else(|| AppError::ConnectorAuthError("no refresh token stored".to_string()))?;

        let client_id = def.client_id();
        let secret = def.client_secret();
        let mut params: Vec<(&str, &str)> = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
            ("client_id", &client_id),
        ];
        if !secret.is_empty() {
            params.push(("client_secret", &secret));
        }

        let resp = self
            .http
            .post(def.token_url)
            .header("Accept", "application/json")
            .form(&params)
            .send()
            .await
            .map_err(|e| AppError::ConnectorAuthError(e.to_string()))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::ConnectorAuthError(format!("token refresh failed: {body}")));
        }

        let new_tokens = resp
            .json::<TokenResponse>()
            .await
            .map_err(|e| AppError::ConnectorAuthError(format!("token parse error: {e}")))?;

        self.store_tokens(connector_id, &new_tokens, memory).await?;
        Ok(new_tokens.access_token)
    }

    pub async fn get_access_token(
        &self,
        connector_id: &str,
        memory: &SqliteMemory,
    ) -> AppResult<String> {
        let threshold = now_ms() + 300_000;

        let (token, expires_at) = {
            let states = self.states.read().unwrap_or_else(|e| e.into_inner());
            let s = states.get(connector_id);
            (s.and_then(|s| s.access_token.clone()), s.and_then(|s| s.expires_at))
        };

        if let Some(tok) = token {
            if expires_at.map(|e| e > threshold).unwrap_or(true) {
                return Ok(tok);
            }
        }

        let lock = self
            .refresh_locks
            .get(connector_id)
            .ok_or_else(|| AppError::ConnectorNotFound(connector_id.to_string()))?
            .clone();
        let _refresh_guard = lock.lock().await;

        let (token2, expires_at2) = {
            let states = self.states.read().unwrap_or_else(|e| e.into_inner());
            let s = states.get(connector_id);
            (s.and_then(|s| s.access_token.clone()), s.and_then(|s| s.expires_at))
        };

        if let Some(tok) = token2 {
            if expires_at2.map(|e| e > threshold).unwrap_or(true) {
                return Ok(tok);
            }
        }

        self.refresh_access_token(connector_id, memory).await
    }

    pub async fn disconnect(&self, connector_id: &str, memory: &SqliteMemory) -> AppResult<()> {
        clear_connector_tokens(connector_id);

        {
            let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
            states.remove(connector_id);
        }

        memory
            .set_connector_token_state(connector_id, false, None, None)
            .await?;
        memory.set_connector_enabled(connector_id, false).await?;

        Ok(())
    }

    pub fn enabled_ids(&self) -> Vec<String> {
        let states = self.states.read().unwrap_or_else(|e| e.into_inner());
        states
            .iter()
            .filter(|(_, s)| s.access_token.is_some())
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub async fn logout_all(&self, memory: &SqliteMemory) -> AppResult<()> {
        clear_all_connector_tokens_keyring();
        {
            let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
            states.clear();
        }
        memory.clear_all_connector_tokens().await?;
        Ok(())
    }

    pub fn has_token(&self, connector_id: &str) -> bool {
        let states = self.states.read().unwrap_or_else(|e| e.into_inner());
        states
            .get(connector_id)
            .map(|s| s.access_token.is_some())
            .unwrap_or(false)
    }

    pub fn http(&self) -> &Client {
        &self.http
    }
}

impl Default for ConnectorManager {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> i64 {
    crate::document::now_ms()
}
