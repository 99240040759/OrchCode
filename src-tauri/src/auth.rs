use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::{AppError, AppResult};

const KEYRING_REFRESH_ACCOUNT: &str = "refresh_token";
const CACHED_USER_FILE: &str = "user.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub photo_url: Option<String>,
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
        let display_name = p
            .display_name
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                p.email
                    .as_deref()
                    .and_then(|e| e.split('@').next())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or("there")
            .to_string();

        let avatar_url = p
            .photo_url
            .as_deref()
            .filter(|s| !s.is_empty())
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
    pub access_token: SecretString,
    pub refresh_token: Option<SecretString>,
    pub user: Option<UserProfile>,
}

pub struct OAuthStart {
    pub auth_uri: String,
    pub session_id: Option<String>,
}

pub struct FirebaseAuthClient {
    client: reqwest::Client,
}

impl Default for FirebaseAuthClient {
    fn default() -> Self {
        Self::new()
    }
}

fn request_timeout() -> Duration {
    Duration::from_secs(config::AUTH_REQUEST_TIMEOUT_SECS)
}

fn network_error(context: &str, error: reqwest::Error) -> AppError {
    AppError::Network(format!("{context}: {error}"))
}

impl FirebaseAuthClient {
    pub fn new() -> Self {
        Self {
            client: crate::util::http_client(),
        }
    }

    pub async fn get_google_oauth_url(&self, redirect_to: &str) -> AppResult<OAuthStart> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key={}",
            config::firebase_api_key()
        );
        let resp = self
            .client
            .post(&url)
            .timeout(request_timeout())
            .json(&serde_json::json!({
                "providerId": "google.com",
                "continueUri": redirect_to,
                "authFlowType": "CODE_FLOW"
            }))
            .send()
            .await
            .map_err(|e| network_error("auth uri request failed", e))?;

        let body = check_status_text(resp, "auth uri").await?;

        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "authUri")]
            auth_uri: Option<String>,
            #[serde(rename = "sessionId")]
            session_id: Option<String>,
        }
        let res: Resp = serde_json::from_str(&body)
            .map_err(|e| AppError::other(format!("auth uri parse error: {e}")))?;
        let auth_uri = res
            .auth_uri
            .ok_or_else(|| AppError::other("no authUri returned from Firebase"))?;
        Ok(OAuthStart {
            auth_uri,
            session_id: res.session_id.filter(|s| !s.is_empty()),
        })
    }

    pub async fn get_user(&self, id_token: &str) -> AppResult<UserProfile> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={}",
            config::firebase_api_key()
        );
        let resp = self
            .client
            .post(&url)
            .timeout(request_timeout())
            .json(&serde_json::json!({ "idToken": id_token }))
            .send()
            .await
            .map_err(|e| network_error("user lookup failed", e))?;
        let body = check_status_text(resp, "user lookup").await?;

        #[derive(Deserialize)]
        struct FirebaseAccount {
            #[serde(rename = "localId")]
            local_id: String,
            email: Option<String>,
            #[serde(rename = "displayName")]
            display_name: Option<String>,
            #[serde(rename = "photoUrl")]
            photo_url: Option<String>,
        }
        #[derive(Deserialize)]
        struct LookupResponse {
            users: Option<Vec<FirebaseAccount>>,
        }

        let lookup: LookupResponse = serde_json::from_str(&body)
            .map_err(|e| AppError::other(format!("user JSON parse error: {e}")))?;
        let user = lookup
            .users
            .and_then(|u| u.into_iter().next())
            .ok_or_else(|| AppError::Gateway {
                status: 401,
                body: "user not found in Firebase response".to_string(),
            })?;

        Ok(UserProfile {
            id: user.local_id,
            email: user.email,
            display_name: user.display_name,
            photo_url: user.photo_url,
        })
    }

    pub async fn sign_in_with_idp(
        &self,
        token_or_code: &str,
        is_code: bool,
        request_uri: &str,
        session_id: Option<&str>,
    ) -> AppResult<(AuthSession, UserProfile)> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={}",
            config::firebase_api_key()
        );
        let post_body = {
            let key = if is_code { "code" } else { "id_token" };
            url::form_urlencoded::Serializer::new(String::new())
                .append_pair(key, token_or_code)
                .append_pair("providerId", "google.com")
                .finish()
        };
        let mut payload = serde_json::json!({
            "postBody": post_body,
            "requestUri": request_uri,
            "returnIdpCredential": true,
            "returnSecureToken": true
        });
        if let Some(session) = session_id {
            payload["sessionId"] = serde_json::Value::String(session.to_string());
        }
        let resp = self
            .client
            .post(&url)
            .timeout(request_timeout())
            .json(&payload)
            .send()
            .await
            .map_err(|e| network_error("signInWithIdp failed", e))?;
        let body = check_status_text(resp, "signInWithIdp").await?;

        #[derive(Deserialize)]
        struct FirebaseIdpResponse {
            #[serde(rename = "idToken")]
            id_token: String,
            #[serde(rename = "refreshToken")]
            refresh_token: String,
            #[serde(rename = "localId")]
            local_id: String,
            email: Option<String>,
            #[serde(rename = "displayName")]
            display_name: Option<String>,
            #[serde(rename = "photoUrl")]
            photo_url: Option<String>,
        }

        let res: FirebaseIdpResponse = serde_json::from_str(&body)
            .map_err(|e| AppError::other(format!("signInWithIdp parse error: {e}")))?;
        let profile = UserProfile {
            id: res.local_id,
            email: res.email,
            display_name: res.display_name,
            photo_url: res.photo_url,
        };
        let session = AuthSession {
            access_token: SecretString::from(res.id_token),
            refresh_token: Some(SecretString::from(res.refresh_token)),
            user: Some(profile.clone()),
        };
        Ok((session, profile))
    }

    pub async fn refresh_session(&self, refresh_token: &str) -> AppResult<AuthSession> {
        let url = format!(
            "https://securetoken.googleapis.com/v1/token?key={}",
            config::firebase_api_key()
        );

        let resp = self
            .client
            .post(&url)
            .timeout(request_timeout())
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(|e| AppError::Network(format!("token refresh network error: {e}")))?;

        let body = check_status_text(resp, "token refresh").await?;

        #[derive(Deserialize)]
        struct TokenResp {
            id_token: Option<String>,
            access_token: Option<String>,
            refresh_token: Option<String>,
        }
        let parsed: TokenResp = serde_json::from_str(&body)
            .map_err(|e| AppError::other(format!("token refresh parse error: {e}")))?;

        let access_token = parsed
            .id_token
            .or(parsed.access_token)
            .ok_or_else(|| AppError::other("token refresh: no id_token in response"))?;
        let new_refresh = parsed
            .refresh_token
            .filter(|r| !r.is_empty())
            .map(SecretString::from)
            .or_else(|| Some(SecretString::from(refresh_token.to_string())));

        Ok(AuthSession {
            access_token: SecretString::from(access_token),
            refresh_token: new_refresh,
            user: None,
        })
    }
}

async fn check_status_text(resp: reqwest::Response, context: &str) -> AppResult<String> {
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| network_error(&format!("{context} response"), e))?;
    if status.is_success() {
        Ok(body)
    } else {
        Err(AppError::Gateway {
            status: status.as_u16(),
            body: format!("{context}: {body}"),
        })
    }
}

pub async fn save_refresh_token_async(token: &str) -> AppResult<()> {
    if token.is_empty() {
        return Ok(());
    }
    crate::credentials::save_async(KEYRING_REFRESH_ACCOUNT, token).await
}

pub async fn load_refresh_token_async() -> AppResult<Option<SecretString>> {
    Ok(crate::credentials::load_async(KEYRING_REFRESH_ACCOUNT)
        .await?
        .map(SecretString::from))
}

pub async fn clear_tokens_async() {
    crate::credentials::delete_async(KEYRING_REFRESH_ACCOUNT).await;
}

fn cached_user_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CACHED_USER_FILE)
}

pub fn save_cached_user(data_dir: &Path, profile: &UserProfile) {
    if let Ok(json) = serde_json::to_vec(profile) {
        let path = cached_user_path(data_dir);
        if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(data_dir) {
            use std::io::Write;
            if tmp.write_all(&json).is_ok() {
                let _ = tmp.persist(&path);
            }
        }
    }
}

pub async fn save_cached_user_async(data_dir: PathBuf, profile: UserProfile) {
    let _ = tokio::task::spawn_blocking(move || save_cached_user(&data_dir, &profile)).await;
}

pub fn load_cached_user(data_dir: &Path) -> Option<UserProfile> {
    let raw = std::fs::read(cached_user_path(data_dir)).ok()?;
    serde_json::from_slice(&raw).ok()
}

pub async fn load_cached_user_async(data_dir: PathBuf) -> Option<UserProfile> {
    tokio::task::spawn_blocking(move || load_cached_user(&data_dir))
        .await
        .ok()
        .flatten()
}

pub fn clear_cached_user(data_dir: &Path) {
    let _ = std::fs::remove_file(cached_user_path(data_dir));
}

pub async fn clear_cached_user_async(data_dir: PathBuf) {
    let _ = tokio::task::spawn_blocking(move || clear_cached_user(&data_dir)).await;
}

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn jwt_expiry(token: &str) -> Option<i64> {
    decode_jwt_payload(token)?.get("exp")?.as_i64()
}

pub fn jwt_user_id(token: &str) -> Option<String> {
    let value = decode_jwt_payload(token)?;
    value
        .get("user_id")
        .or_else(|| value.get("sub"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

#[derive(Default)]
pub struct AuthCallbackParams {
    pub code: Option<String>,
    pub error: Option<String>,
}

fn assign_param(params: &mut AuthCallbackParams, key: &str, value: &str) {
    if value.is_empty() {
        return;
    }
    match key {
        "code" if params.code.is_none() => {
            params.code = Some(value.to_string());
        }
        "error_description" | "error" if params.error.is_none() => {
            params.error = Some(value.to_string());
        }
        _ => {}
    }
}

pub fn parse_auth_callback(raw: &str) -> AuthCallbackParams {
    let normalized = match crate::util::strip_prefix_ignore_ascii_case(raw, "orch://") {
        Some(rest) => format!("http://localhost/{rest}"),
        None => raw.to_string(),
    };
    let mut params = AuthCallbackParams::default();

    if let Ok(url) = reqwest::Url::parse(&normalized) {
        for (k, v) in url.query_pairs() {
            assign_param(&mut params, k.as_ref(), v.as_ref());
        }
    }

    params
}

pub struct CompletedSignIn {
    pub id_token: SecretString,
    pub refresh_token: Option<SecretString>,
    pub profile: UserProfile,
}

pub async fn handle_auth_callback(
    raw_url: &str,
    session_id: Option<&str>,
) -> Result<CompletedSignIn, String> {
    let params = parse_auth_callback(raw_url);

    if let Some(err) = params.error {
        return Err(err);
    }

    let session_id = session_id.ok_or_else(|| "Missing sign-in session".to_string())?;
    let code = params
        .code
        .ok_or_else(|| "No authorization code found in sign-in callback".to_string())?;
    let client = FirebaseAuthClient::new();
    let (session, profile) = client
        .sign_in_with_idp(
            &code,
            true,
            config::AUTH_REDIRECT_URL,
            Some(session_id),
        )
        .await
        .map_err(|e| e.to_string())?;
    let completed = CompletedSignIn {
        id_token: session.access_token,
        refresh_token: session.refresh_token,
        profile,
    };

    if let Some(rt) = completed.refresh_token.as_ref() {
        save_refresh_token_async(rt.expose_secret()).await.map_err(|e| e.to_string())?;
    }

    Ok(completed)
}
