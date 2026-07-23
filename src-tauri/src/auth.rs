use std::path::Path;
use serde::{Deserialize, Serialize};
use reqwest::Client;

use crate::config;
use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "orchcode";
const KEYRING_REFRESH_ACCOUNT: &str = "refresh_token";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMetadata {
    pub full_name: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub email: Option<String>,
    pub user_metadata: Option<UserMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDisplay {
    pub id: String,
    pub email: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub initial: String,
}

impl UserDisplay {
    pub fn from_profile(p: &UserProfile) -> Self {
        let m = p.user_metadata.as_ref();
        let display_name = m
            .and_then(|m| {
                m.full_name.as_deref().filter(|s| !s.is_empty())
                    .or_else(|| m.name.as_deref().filter(|s| !s.is_empty()))
            })
            .or_else(|| p.email.as_deref().and_then(|e| e.split('@').next()).filter(|s| !s.is_empty()))
            .unwrap_or("there")
            .to_string();

        let avatar_url = m.and_then(|m| {
            m.avatar_url.as_deref().filter(|s| !s.is_empty())
                .or_else(|| m.picture.as_deref().filter(|s| !s.is_empty()))
        }).map(str::to_string);

        let initial = display_name.chars().next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "?".to_string());

        Self { id: p.id.clone(), email: p.email.clone(), display_name, avatar_url, initial }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub user: Option<UserProfile>,
}

#[derive(Debug, Deserialize)]
struct GoTrueTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    user: Option<UserProfile>,
}

pub struct SupabaseAuthClient {
    client: Client,
    base_url: String,
    anon_key: String,
}

impl SupabaseAuthClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            base_url: config::supabase_url(),
            anon_key: config::supabase_anon_key(),
        }
    }

    pub fn get_google_oauth_url(&self, redirect_to: &str) -> String {
        format!(
            "{}/auth/v1/authorize?provider=google&redirect_to={}",
            self.base_url,
            urlencoding::encode(redirect_to)
        )
    }

    pub async fn get_user(&self, access_token: &str) -> AppResult<UserProfile> {
        let url = format!("{}/auth/v1/user", self.base_url);
        let resp = self.client
            .get(&url)
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| AppError::other(format!("user fetch network error: {e}")))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(AppError::other(format!("user fetch failed: {err}")));
        }

        let user: UserProfile = resp.json().await
            .map_err(|e| AppError::other(format!("user JSON parse error: {e}")))?;
        Ok(user)
    }

    pub async fn exchange_code(&self, code: &str) -> AppResult<AuthSession> {
        let url = format!("{}/auth/v1/token?grant_type=pkce", self.base_url);
        let payload = serde_json::json!({ "auth_code": code });

        let resp = self.client
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::other(format!("code exchange network error: {e}")))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(AppError::other(format!("code exchange failed: {err}")));
        }

        let token_resp: GoTrueTokenResponse = resp.json().await
            .map_err(|e| AppError::other(format!("token response parse error: {e}")))?;

        Ok(AuthSession {
            access_token: token_resp.access_token,
            refresh_token: token_resp.refresh_token,
            user: token_resp.user,
        })
    }

    pub async fn refresh_session(&self, refresh_token: &str) -> AppResult<AuthSession> {
        let url = format!("{}/auth/v1/token?grant_type=refresh_token", self.base_url);
        let payload = serde_json::json!({ "refresh_token": refresh_token });

        let resp = self.client
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::other(format!("session refresh network error: {e}")))?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(AppError::other(format!("session refresh failed: {err}")));
        }

        let token_resp: GoTrueTokenResponse = resp.json().await
            .map_err(|e| AppError::other(format!("refresh parse error: {e}")))?;

        Ok(AuthSession {
            access_token: token_resp.access_token,
            refresh_token: token_resp.refresh_token,
            user: token_resp.user,
        })
    }
}

pub fn save_refresh_token(token: &str) {
    if token.is_empty() {
        return;
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH_ACCOUNT);
    if let Ok(e) = entry {
        let _ = e.set_password(token);
    }
}

pub fn load_refresh_token() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH_ACCOUNT).ok()?;
    entry.get_password().ok().filter(|t| !t.is_empty())
}

pub fn clear_refresh_token() {
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH_ACCOUNT) {
        let _ = e.delete_credential();
    }
}

pub fn load_access_token(data_dir: &Path) -> Option<String> {
    let path = data_dir.join("access_token.bin");
    if !path.exists() {
        return None;
    }
    std::fs::read_to_string(&path).ok().filter(|t| !t.trim().is_empty()).map(|t| t.trim().to_string())
}

pub fn save_access_token(data_dir: &Path, token: &str) {
    let path = data_dir.join("access_token.bin");
    if token.is_empty() {
        let _ = std::fs::remove_file(&path);
        return;
    }
    let _ = std::fs::write(&path, token.as_bytes());
}

pub fn clear_access_token(data_dir: &Path) {
    let path = data_dir.join("access_token.bin");
    let _ = std::fs::remove_file(&path);
    let legacy = data_dir.join("auth.json");
    if legacy.exists() {
        let _ = std::fs::remove_file(legacy);
    }
}

pub fn migrate_legacy_tokens(data_dir: &Path) {
    let legacy = data_dir.join("auth.json");
    if !legacy.exists() {
        return;
    }
    #[derive(Deserialize)]
    struct Legacy {
        access_token: Option<String>,
        refresh_token: Option<String>,
    }
    if let Ok(data) = std::fs::read_to_string(&legacy) {
        if let Ok(t) = serde_json::from_str::<Legacy>(&data) {
            if let Some(rt) = t.refresh_token.filter(|s| !s.is_empty()) {
                save_refresh_token(&rt);
            }
            if let Some(at) = t.access_token.filter(|s| !s.is_empty()) {
                save_access_token(data_dir, &at);
            }
        }
    }
    let _ = std::fs::remove_file(legacy);
}

#[derive(Default)]
pub struct AuthCallbackParams {
    pub code: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

fn assign_param(params: &mut AuthCallbackParams, key: &str, value: &str) {
    if value.is_empty() {
        return;
    }
    match key {
        "code" if params.code.is_none() => params.code = Some(value.to_string()),
        "access_token" if params.access_token.is_none() => params.access_token = Some(value.to_string()),
        "refresh_token" if params.refresh_token.is_none() => params.refresh_token = Some(value.to_string()),
        "state" if params.state.is_none() => params.state = Some(value.to_string()),
        "error_description" | "error" if params.error.is_none() => params.error = Some(value.to_string()),
        _ => {}
    }
}

pub fn parse_auth_callback(raw: &str) -> AuthCallbackParams {
    let normalized = raw.replacen("orchcode://", "http://localhost/", 1);
    let mut params = AuthCallbackParams::default();

    if let Ok(url) = reqwest::Url::parse(&normalized) {
        for (k, v) in url.query_pairs() {
            assign_param(&mut params, k.as_ref(), v.as_ref());
        }
        if let Some(fragment) = url.fragment() {
            for pair in fragment.split('&') {
                if let Some((k, v)) = pair.split_once('=') {
                    let decoded = urlencoding::decode(v).map(|c| c.into_owned()).unwrap_or_else(|_| v.to_string());
                    assign_param(&mut params, k, &decoded);
                }
            }
        }
    }

    params
}

pub async fn handle_auth_callback(
    data_dir: &Path,
    token: &crate::gateway::TokenHandle,
    raw_url: &str,
) -> Result<UserDisplay, String> {
    let params = parse_auth_callback(raw_url);

    if let Some(err) = params.error {
        return Err(err);
    }

    let client = SupabaseAuthClient::new();

    if let Some(code) = params.code {
        let session = client.exchange_code(&code).await.map_err(|e| e.to_string())?;
        let user = match session.user {
            Some(ref u) => UserDisplay::from_profile(u),
            None => {
                let u = client.get_user(&session.access_token).await.map_err(|e| e.to_string())?;
                UserDisplay::from_profile(&u)
            }
        };
        if let Some(rt) = session.refresh_token.as_deref().filter(|s| !s.is_empty()) {
            save_refresh_token(rt);
        }
        save_access_token(data_dir, &session.access_token);
        if let Ok(mut guard) = token.write() {
            *guard = Some(session.access_token);
        }
        return Ok(user);
    }

    if let Some(access_token) = params.access_token {
        let u = client.get_user(&access_token).await.map_err(|e| e.to_string())?;
        let user = UserDisplay::from_profile(&u);
        if let Some(rt) = params.refresh_token.as_deref().filter(|s| !s.is_empty()) {
            save_refresh_token(rt);
        }
        save_access_token(data_dir, &access_token);
        if let Ok(mut guard) = token.write() {
            *guard = Some(access_token);
        }
        return Ok(user);
    }

    Err("No authorization code or access token found in sign-in callback".to_string())
}
