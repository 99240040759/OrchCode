use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use base64::Engine;
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::Url;

use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::persistence::{ConnectorRecord, SqliteMemory};
use crate::util::now_ms;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenAuthStyle {
    FormSecret,
    BasicJson,
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
    pub pkce: bool,
    pub token_auth: TokenAuthStyle,
}

impl ConnectorDef {
    pub fn client_id(&self) -> String {
        if self.client_id_env.is_empty() {
            return String::new();
        }
        compiled_env(self.client_id_env)
    }

    pub fn client_secret(&self) -> String {
        if self.client_secret_env.is_empty() {
            return String::new();
        }
        compiled_env(self.client_secret_env)
    }

    pub fn is_configured(&self) -> bool {
        match self.auth_kind {
            AuthKind::None => true,
            _ => !self.client_id().is_empty(),
        }
    }
}

fn compiled_env(key: &str) -> String {
    let value = match key {
        "GOOGLE_CLIENT_ID" => option_env!("GOOGLE_CLIENT_ID"),
        "GOOGLE_CLIENT_SECRET" => option_env!("GOOGLE_CLIENT_SECRET"),
        "GITHUB_CLIENT_ID" => option_env!("GITHUB_CLIENT_ID"),
        "GITHUB_CLIENT_SECRET" => option_env!("GITHUB_CLIENT_SECRET"),
        "NOTION_CLIENT_ID" => option_env!("NOTION_CLIENT_ID"),
        "NOTION_CLIENT_SECRET" => option_env!("NOTION_CLIENT_SECRET"),
        "SLACK_CLIENT_ID" => option_env!("SLACK_CLIENT_ID"),
        "SLACK_CLIENT_SECRET" => option_env!("SLACK_CLIENT_SECRET"),
        "JIRA_CLIENT_ID" => option_env!("JIRA_CLIENT_ID"),
        "JIRA_CLIENT_SECRET" => option_env!("JIRA_CLIENT_SECRET"),
        _ => None,
    };
    value.unwrap_or("").to_string()
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
        pkce: true,
        token_auth: TokenAuthStyle::FormSecret,
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
        scopes: &["https://www.googleapis.com/auth/gmail.readonly"],
        deep_link_id: "gmail",
        pkce: true,
        token_auth: TokenAuthStyle::FormSecret,
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
        pkce: true,
        token_auth: TokenAuthStyle::FormSecret,
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
        pkce: false,
        token_auth: TokenAuthStyle::BasicJson,
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
        scopes: &[
            "channels:history",
            "channels:read",
            "groups:history",
            "groups:read",
            "files:read",
            "search:read",
            "users:read",
            "users.profile:read",
        ],
        deep_link_id: "slack",
        pkce: false,
        token_auth: TokenAuthStyle::FormSecret,
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
        pkce: false,
        token_auth: TokenAuthStyle::FormSecret,
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

pub fn load_connector_access_token(connector_id: &str) -> AppResult<Option<String>> {
    credentials::load(&keyring_account_access(connector_id))
}

pub fn save_connector_refresh_token(connector_id: &str, token: &str) -> AppResult<()> {
    credentials::save(&keyring_account_refresh(connector_id), token)
        .map_err(|e| AppError::ConnectorAuthError(e.to_string()))
}

pub fn load_connector_refresh_token(connector_id: &str) -> AppResult<Option<String>> {
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
    #[serde(default)]
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub token_type: Option<String>,
    #[serde(default)]
    pub authed_user: Option<AuthedUser>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AuthedUser {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
}

impl TokenResponse {
    pub fn effective_access_token(&self) -> Option<String> {
        self.authed_user
            .as_ref()
            .and_then(|u| u.access_token.clone())
            .filter(|t| !t.is_empty())
            .or_else(|| {
                if self.access_token.is_empty() {
                    None
                } else {
                    Some(self.access_token.clone())
                }
            })
    }

    pub fn effective_refresh_token(&self) -> Option<String> {
        self.authed_user
            .as_ref()
            .and_then(|u| u.refresh_token.clone())
            .or_else(|| self.refresh_token.clone())
            .filter(|t| !t.is_empty())
    }

    pub fn effective_expires_in(&self) -> Option<i64> {
        self.authed_user
            .as_ref()
            .and_then(|u| u.expires_in)
            .or(self.expires_in)
    }

    fn provider_error(&self) -> Option<String> {
        self.error.as_ref().map(|error| match &self.error_description {
            Some(description) if !description.is_empty() => format!("{error}: {description}"),
            _ => error.clone(),
        })
    }
}

async fn post_token_request(
    def: &ConnectorDef,
    http: &Client,
    fields: Vec<(&str, String)>,
    context: &str,
) -> AppResult<TokenResponse> {
    let client_id = def.client_id();
    let secret = def.client_secret();
    let request = match def.token_auth {
        TokenAuthStyle::BasicJson => {
            let body: serde_json::Map<String, serde_json::Value> = fields
                .into_iter()
                .map(|(k, v)| (k.to_string(), serde_json::Value::String(v)))
                .collect();
            http.post(def.token_url)
                .basic_auth(&client_id, Some(&secret))
                .header("Accept", "application/json")
                .json(&body)
        }
        TokenAuthStyle::FormSecret => {
            let mut form = fields;
            form.push(("client_id", client_id));
            if !secret.is_empty() {
                form.push(("client_secret", secret));
            }
            http.post(def.token_url)
                .header("Accept", "application/json")
                .form(&form)
        }
    };

    let resp = request
        .send()
        .await
        .map_err(|e| AppError::ConnectorAuthError(format!("{context} request failed: {e}")))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::ConnectorAuthError(format!("{context} response failed: {e}")))?;
    if !status.is_success() {
        return Err(AppError::ConnectorAuthError(format!(
            "{context} failed ({}): {}",
            status.as_u16(),
            crate::util::truncate_chars(&body, 500)
        )));
    }
    let parsed: TokenResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::ConnectorAuthError(format!("{context} parse error: {e}")))?;
    if let Some(error) = parsed.provider_error() {
        return Err(AppError::ConnectorAuthError(format!("{context} failed: {error}")));
    }
    Ok(parsed)
}

pub async fn exchange_code(
    def: &ConnectorDef,
    code: &str,
    redirect_uri: &str,
    code_verifier: Option<&str>,
    http: &Client,
) -> AppResult<TokenResponse> {
    let mut fields = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
    ];
    if let Some(verifier) = code_verifier {
        fields.push(("code_verifier", verifier.to_string()));
    }
    post_token_request(def, http, fields, "token exchange").await
}

pub const CONNECTOR_REDIRECT_BASE: &str = "https://orch.live/oauth";

pub fn connector_redirect_uri(deep_link_id: &str) -> String {
    format!("{}/{}", CONNECTOR_REDIRECT_BASE, deep_link_id)
}

fn pkce_pair() -> (String, String) {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub fn build_auth_url(def: &ConnectorDef, state: &str, code_challenge: Option<&str>) -> AppResult<String> {
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
            let scope_param = if def.id == "slack" { "user_scope" } else { "scope" };
            query.append_pair(scope_param, &def.scopes.join(" "));
        }
        if let Some(challenge) = code_challenge {
            query.append_pair("code_challenge", challenge);
            query.append_pair("code_challenge_method", "S256");
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
            "notion" => {
                query.append_pair("owner", "user");
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

struct PendingOAuth {
    connector_id: String,
    created: Instant,
    code_verifier: Option<String>,
}

pub struct ConnectorManager {
    states: Arc<RwLock<HashMap<String, ConnectorRuntimeState>>>,
    pending_oauth: Mutex<HashMap<String, PendingOAuth>>,
    http: Client,
    refresh_locks: HashMap<String, Arc<tokio::sync::Mutex<()>>>,
    jira_cloud_id: RwLock<Option<String>>,
    slack_users: Mutex<HashMap<String, String>>,
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
            http: crate::util::http_client(),
            refresh_locks,
            jira_cloud_id: RwLock::new(None),
            slack_users: Mutex::new(HashMap::new()),
        }
    }

    pub async fn initialize(&self, memory: &SqliteMemory) -> AppResult<()> {
        let existing = memory.list_connectors().await?;
        let existing_ids: std::collections::HashSet<String> =
            existing.iter().map(|r| r.id.clone()).collect();

        for def in CONNECTOR_DEFS {
            if !existing_ids.contains(def.id) {
                memory
                    .upsert_connector(ConnectorRecord {
                        id: def.id.to_string(),
                        name: def.name.to_string(),
                        enabled: false,
                        auth_kind: def.auth_kind.as_str().to_string(),
                        has_token: false,
                        token_expires_at: None,
                        error: None,
                        updated_at: now_ms(),
                    })
                    .await?;
            }
        }

        let records = memory.list_connectors().await?;
        let mut loaded = Vec::new();
        for rec in records {
            let token = match load_connector_access_token(&rec.id) {
                Ok(token) => token,
                Err(error) => {
                    eprintln!("[connectors] keychain read failed for {}: {error}", rec.id);
                    continue;
                }
            };
            let has_token = token.is_some();
            if rec.has_token != has_token || rec.enabled != has_token {
                memory
                    .set_connector_token_state(&rec.id, has_token, rec.token_expires_at, rec.error.as_deref())
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

    pub fn begin_oauth(&self, connector_id: &str) -> AppResult<(String, Option<String>)> {
        let def = find_def(connector_id)
            .ok_or_else(|| AppError::ConnectorNotFound(connector_id.to_string()))?;
        let state = uuid::Uuid::new_v4().to_string();
        let (verifier, challenge) = if def.pkce {
            let (verifier, challenge) = pkce_pair();
            (Some(verifier), Some(challenge))
        } else {
            (None, None)
        };
        let mut pending = self.pending_oauth.lock().unwrap_or_else(|e| e.into_inner());
        pending.retain(|_, entry| entry.created.elapsed() <= CONNECTOR_OAUTH_STATE_TTL);
        pending.insert(
            state.clone(),
            PendingOAuth {
                connector_id: connector_id.to_string(),
                created: Instant::now(),
                code_verifier: verifier,
            },
        );
        Ok((state, challenge))
    }

    pub fn consume_oauth(&self, connector_id: &str, state: &str) -> AppResult<Option<String>> {
        let mut pending = self.pending_oauth.lock().unwrap_or_else(|e| e.into_inner());
        let Some(entry) = pending.remove(state) else {
            return Err(AppError::ConnectorAuthError(
                "this sign-in link expired or was already used; start the connection again".to_string(),
            ));
        };
        if entry.created.elapsed() > CONNECTOR_OAUTH_STATE_TTL || entry.connector_id != connector_id {
            return Err(AppError::ConnectorAuthError(
                "this sign-in link expired or does not match the connector".to_string(),
            ));
        }
        Ok(entry.code_verifier)
    }

    pub async fn store_tokens(
        &self,
        connector_id: &str,
        token_resp: &TokenResponse,
        memory: &SqliteMemory,
    ) -> AppResult<()> {
        let access_token = token_resp.effective_access_token().ok_or_else(|| {
            AppError::ConnectorAuthError("token response contained no access token".to_string())
        })?;
        save_connector_access_token(connector_id, &access_token)?;
        if let Some(rt) = token_resp.effective_refresh_token() {
            save_connector_refresh_token(connector_id, &rt)?;
        }

        let expires_at = token_resp
            .effective_expires_in()
            .map(|secs| now_ms() + secs * 1000);

        {
            let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
            states.insert(
                connector_id.to_string(),
                ConnectorRuntimeState {
                    access_token: Some(access_token),
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

    async fn refresh_access_token(&self, connector_id: &str, memory: &SqliteMemory) -> AppResult<String> {
        let def = find_def(connector_id)
            .ok_or_else(|| AppError::ConnectorNotFound(connector_id.to_string()))?;

        let refresh_token = load_connector_refresh_token(connector_id)?.ok_or_else(|| {
            AppError::ConnectorAuthError(format!(
                "{} access expired and cannot be renewed; reconnect it in Integrations",
                def.name
            ))
        })?;

        let fields = vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token),
        ];
        let new_tokens = post_token_request(def, &self.http, fields, "token refresh").await?;
        let access_token = new_tokens.effective_access_token().ok_or_else(|| {
            AppError::ConnectorAuthError("refresh response contained no access token".to_string())
        })?;
        self.store_tokens(connector_id, &new_tokens, memory).await?;
        Ok(access_token)
    }

    pub async fn get_access_token(&self, connector_id: &str, memory: &SqliteMemory) -> AppResult<String> {
        let threshold = now_ms() + 300_000;

        let read_state = || {
            let states = self.states.read().unwrap_or_else(|e| e.into_inner());
            let s = states.get(connector_id);
            (
                s.and_then(|s| s.access_token.clone()),
                s.and_then(|s| s.expires_at),
            )
        };

        let (token, expires_at) = read_state();
        let Some(_) = token.as_ref() else {
            return Err(AppError::ConnectorAuthError(format!(
                "{connector_id} is not connected; connect it in Integrations"
            )));
        };
        if let Some(tok) = token.clone() {
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

        let (token2, expires_at2) = read_state();
        if let Some(tok) = token2 {
            if expires_at2.map(|e| e > threshold).unwrap_or(true) {
                return Ok(tok);
            }
        }

        match self.refresh_access_token(connector_id, memory).await {
            Ok(token) => Ok(token),
            Err(error) => {
                let message = error.to_string();
                let _ = memory.set_connector_error(connector_id, Some(&message)).await;
                Err(error)
            }
        }
    }

    pub async fn disconnect(&self, connector_id: &str, memory: &SqliteMemory) -> AppResult<()> {
        clear_connector_tokens(connector_id);

        {
            let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
            states.remove(connector_id);
        }
        if connector_id == "jira" {
            *self.jira_cloud_id.write().unwrap_or_else(|e| e.into_inner()) = None;
        }
        if connector_id == "slack" {
            self.slack_users.lock().unwrap_or_else(|e| e.into_inner()).clear();
        }

        memory
            .set_connector_token_state(connector_id, false, None, None)
            .await?;
        memory.set_connector_enabled(connector_id, false).await?;

        Ok(())
    }

    pub fn enabled_ids(&self) -> Vec<String> {
        let states = self.states.read().unwrap_or_else(|e| e.into_inner());
        let mut ids: Vec<String> = states
            .iter()
            .filter(|(_, s)| s.access_token.is_some())
            .map(|(id, _)| id.clone())
            .collect();
        ids.sort();
        ids
    }

    pub async fn logout_all(&self, memory: &SqliteMemory) -> AppResult<()> {
        clear_all_connector_tokens_keyring();
        {
            let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
            states.clear();
        }
        *self.jira_cloud_id.write().unwrap_or_else(|e| e.into_inner()) = None;
        self.slack_users.lock().unwrap_or_else(|e| e.into_inner()).clear();
        memory.clear_all_connector_tokens().await?;
        Ok(())
    }

    pub fn cached_jira_cloud_id(&self) -> Option<String> {
        self.jira_cloud_id
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn set_jira_cloud_id(&self, id: &str) {
        *self.jira_cloud_id.write().unwrap_or_else(|e| e.into_inner()) = Some(id.to_string());
    }

    pub fn cached_slack_user(&self, id: &str) -> Option<String> {
        self.slack_users
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }

    pub fn cache_slack_user(&self, id: &str, name: &str) {
        self.slack_users
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), name.to_string());
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
