use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::gateway::TokenHandle;

const KEYRING_REFRESH_ACCOUNT: &str = "refresh_token";

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
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub user: Option<UserProfile>,
}

pub struct FirebaseAuthClient {
    client: Client,
}

impl FirebaseAuthClient {
    pub fn new() -> Self {
        Self {
            client: crate::util::http_client(),
        }
    }

    pub async fn get_google_oauth_url(&self, redirect_to: &str) -> AppResult<String> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key={}",
            config::firebase_api_key()
        );
        let resp = self
            .client
            .post(&url)
            .json(&serde_json::json!({
                "providerId": "google.com",
                "continueUri": redirect_to
            }))
            .send()
            .await
            .map_err(|e| AppError::other(format!("auth uri fetch network error: {e}")))?;

        check_status_text(resp, "auth uri").await.and_then(|body| {
            #[derive(Deserialize)]
            struct Resp {
                #[serde(rename = "authUri")]
                auth_uri: Option<String>,
            }
            let res: Resp = serde_json::from_str(&body)
                .map_err(|e| AppError::other(format!("auth uri parse error: {e}")))?;
            res.auth_uri
                .ok_or_else(|| AppError::other("no authUri returned from Firebase".to_string()))
        })
    }

    pub async fn get_user(&self, id_token: &str) -> AppResult<UserProfile> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={}",
            config::firebase_api_key()
        );
        let body = check_status_text(
            self.client
                .post(&url)
                .json(&serde_json::json!({ "idToken": id_token }))
                .send()
                .await
                .map_err(|e| AppError::other(format!("user fetch network error: {e}")))?,
            "user lookup",
        )
        .await?;

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
            .ok_or_else(|| AppError::other("user not found in Firebase response".to_string()))?;

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
    ) -> AppResult<(AuthSession, UserProfile)> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={}",
            config::firebase_api_key()
        );
        let encoded_token = urlencoding::encode(token_or_code);
        let post_body = if is_code {
            format!("code={}&providerId=google.com", encoded_token)
        } else {
            format!("id_token={}&providerId=google.com", encoded_token)
        };
        let body = check_status_text(
            self.client
                .post(&url)
                .json(&serde_json::json!({
                    "postBody": post_body,
                    "requestUri": request_uri,
                    "returnIdpCredential": true,
                    "returnSecureToken": true
                }))
                .send()
                .await
                .map_err(|e| AppError::other(format!("signInWithIdp network error: {e}")))?,
            "signInWithIdp",
        )
        .await?;

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
            access_token: res.id_token,
            refresh_token: Some(res.refresh_token),
            user: Some(profile.clone()),
        };
        Ok((session, profile))
    }

    pub async fn refresh_session(&self, refresh_token: &str) -> AppResult<AuthSession> {
        let url = format!(
            "https://securetoken.googleapis.com/v1/token?key={}",
            config::firebase_api_key()
        );
        let body_str = format!(
            "grant_type=refresh_token&refresh_token={}",
            urlencoding::encode(refresh_token)
        );
        let body = check_status_text(
            self.client
                .post(&url)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body_str)
                .send()
                .await
                .map_err(|e| AppError::other(format!("session refresh network error: {e}")))?,
            "token refresh",
        )
        .await?;

        #[derive(Deserialize)]
        struct FirebaseTokenResponse {
            id_token: String,
            refresh_token: Option<String>,
        }

        let token_resp: FirebaseTokenResponse = serde_json::from_str(&body)
            .map_err(|e| AppError::other(format!("refresh parse error: {e}")))?;
        let new_refresh = token_resp
            .refresh_token
            .or_else(|| Some(refresh_token.to_string()));

        Ok(AuthSession {
            access_token: token_resp.id_token,
            refresh_token: new_refresh,
            user: None,
        })
    }
}

async fn check_status_text(
    resp: reqwest::Response,
    context: &str,
) -> AppResult<String> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.is_success() {
        Ok(body)
    } else {
        Err(AppError::Gateway { status: status.as_u16(), body: format!("{context}: {body}") })
    }
}

pub fn save_refresh_token(token: &str) -> AppResult<()> {
    if token.is_empty() {
        return Ok(());
    }
    crate::credentials::save(KEYRING_REFRESH_ACCOUNT, token)
}

pub fn load_refresh_token() -> Option<String> {
    crate::credentials::load(KEYRING_REFRESH_ACCOUNT)
}

pub fn clear_tokens() {
    crate::credentials::delete(KEYRING_REFRESH_ACCOUNT);
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
    pub is_code: bool,
}

fn assign_param(params: &mut AuthCallbackParams, key: &str, value: &str) {
    if value.is_empty() {
        return;
    }
    match key {
        "code" | "id_token" | "access_token" if params.access_token.is_none() => {
            params.access_token = Some(value.to_string());
            params.is_code = key == "code";
        }
        "refresh_token" if params.refresh_token.is_none() => {
            params.refresh_token = Some(value.to_string());
        }
        "error_description" | "error" if params.error.is_none() => {
            params.error = Some(value.to_string());
        }
        _ => {}
    }
}

pub fn parse_auth_callback(raw: &str) -> AuthCallbackParams {
    let raw_lower = raw.to_lowercase();
    let normalized = if raw_lower.starts_with("orch://") {
        raw.replacen(&raw[..7], "http://localhost/", 1)
    } else {
        raw.to_string()
    };
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

    let id_or_access_token = params
        .access_token
        .ok_or_else(|| "No token found in sign-in callback".to_string())?;

    let client = FirebaseAuthClient::new();

    let (firebase_id_token, firebase_refresh_token, user_display) =
        if let Some(rt) = params.refresh_token {
            let profile = client
                .get_user(&id_or_access_token)
                .await
                .map_err(|e| e.to_string())?;
            (id_or_access_token, Some(rt), UserDisplay::from_profile(&profile))
        } else {
            let (session, profile) = client
                .sign_in_with_idp(
                    &id_or_access_token,
                    params.is_code,
                    config::AUTH_REDIRECT_URL,
                )
                .await
                .map_err(|e| e.to_string())?;
            (session.access_token, session.refresh_token, UserDisplay::from_profile(&profile))
        };

    if let Some(rt) = firebase_refresh_token {
        save_refresh_token(&rt).map_err(|e| e.to_string())?;
    }

    if let Ok(mut guard) = token.write() {
        *guard = Some(firebase_id_token);
    }

    Ok(user_display)
}
