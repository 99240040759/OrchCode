use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::gateway::TokenHandle;

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
                m.full_name
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .or_else(|| m.name.as_deref().filter(|s| !s.is_empty()))
            })
            .or_else(|| {
                p.email
                    .as_deref()
                    .and_then(|e| e.split('@').next())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or("there")
            .to_string();

        let avatar_url = m
            .and_then(|m| {
                m.avatar_url
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .or_else(|| m.picture.as_deref().filter(|s| !s.is_empty()))
            })
            .map(str::to_string);

        let initial = display_name
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "?".to_string());

        Self {
            id: p.id.clone(),
            email: p.email.clone(),
            display_name,
            avatar_url,
            initial,
        }
    }
}

#[derive(Debug, Clone)]
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
}

impl SupabaseAuthClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub fn get_google_oauth_url(&self, redirect_to: &str) -> String {
        format!(
            "{}/auth/v1/authorize?provider=google&redirect_to={}",
            config::supabase_url(),
            urlencoding::encode(redirect_to)
        )
    }

    pub async fn get_user(&self, access_token: &str) -> AppResult<UserProfile> {
        let url = format!("{}/auth/v1/user", config::supabase_url());
        let resp = self
            .client
            .get(&url)
            .header("apikey", config::supabase_anon_key())
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| AppError::other(format!("user fetch network error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Gateway { status, body });
        }

        resp.json()
            .await
            .map_err(|e| AppError::other(format!("user JSON parse error: {e}")))
    }

    pub async fn refresh_session(&self, refresh_token: &str) -> AppResult<AuthSession> {
        let url = format!(
            "{}/auth/v1/token?grant_type=refresh_token",
            config::supabase_url()
        );
        let resp = self
            .client
            .post(&url)
            .header("apikey", config::supabase_anon_key())
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await
            .map_err(|e| AppError::other(format!("session refresh network error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Gateway { status, body });
        }

        let token_resp: GoTrueTokenResponse = resp
            .json()
            .await
            .map_err(|e| AppError::other(format!("refresh parse error: {e}")))?;

        Ok(AuthSession {
            access_token: token_resp.access_token,
            refresh_token: token_resp.refresh_token,
            user: token_resp.user,
        })
    }
}

fn keyring_entry(account: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| {
        AppError::other(format!("credential store unavailable for {account}: {e}"))
    })
}

fn store_secret(account: &str, value: &str) -> AppResult<()> {
    keyring_entry(account)?.set_password(value).map_err(|e| {
        AppError::other(format!("could not save {account} to the credential store: {e}"))
    })
}

fn read_secret(account: &str) -> Option<String> {
    let entry = keyring_entry(account).ok()?;
    match entry.get_password() {
        Ok(value) if !value.is_empty() => Some(value),
        Ok(_) => None,
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            eprintln!("[auth] could not read {account} from the credential store: {e}");
            None
        }
    }
}

fn delete_secret(account: &str) {
    let Ok(entry) = keyring_entry(account) else {
        return;
    };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => eprintln!("[auth] could not delete {account} from the credential store: {e}"),
    }
}

pub fn save_refresh_token(token: &str) -> AppResult<()> {
    if token.is_empty() {
        delete_secret(KEYRING_REFRESH_ACCOUNT);
        return Ok(());
    }
    store_secret(KEYRING_REFRESH_ACCOUNT, token)
}

pub fn load_refresh_token() -> Option<String> {
    read_secret(KEYRING_REFRESH_ACCOUNT)
}

pub fn clear_tokens() {
    delete_secret(KEYRING_REFRESH_ACCOUNT);
}

pub fn jwt_expiry(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("exp")?.as_i64()
}

#[derive(Default)]
pub struct AuthCallbackParams {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub error: Option<String>,
}

fn assign_param(params: &mut AuthCallbackParams, key: &str, value: &str) {
    if value.is_empty() {
        return;
    }
    match key {
        "access_token" if params.access_token.is_none() => {
            params.access_token = Some(value.to_string())
        }
        "refresh_token" if params.refresh_token.is_none() => {
            params.refresh_token = Some(value.to_string())
        }
        "error_description" | "error" if params.error.is_none() => {
            params.error = Some(value.to_string())
        }
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
                    let decoded = urlencoding::decode(v)
                        .map(|c| c.into_owned())
                        .unwrap_or_else(|_| v.to_string());
                    assign_param(&mut params, k, &decoded);
                }
            }
        }
    }

    params
}

pub async fn handle_auth_callback(
    token: &TokenHandle,
    raw_url: &str,
) -> Result<UserDisplay, String> {
    let params = parse_auth_callback(raw_url);

    if let Some(err) = params.error {
        return Err(err);
    }

    let access_token = params
        .access_token
        .ok_or_else(|| "No access token found in sign-in callback".to_string())?;

    let client = SupabaseAuthClient::new();
    let profile = client
        .get_user(&access_token)
        .await
        .map_err(|e| e.to_string())?;
    let user = UserDisplay::from_profile(&profile);

    let refresh_token = params.refresh_token.ok_or_else(|| {
        "Sign-in callback carried no refresh token, so the session could not be saved".to_string()
    })?;
    save_refresh_token(&refresh_token).map_err(|e| e.to_string())?;

    if let Ok(mut guard) = token.write() {
        *guard = Some(access_token);
    }

    Ok(user)
}
