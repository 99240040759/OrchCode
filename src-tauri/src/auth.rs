use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserProfile {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub onboarding_complete: Option<bool>,
}
#[derive(Serialize, Deserialize)]
struct AuthData {
    token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    user: UserProfile,
}
fn auth_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("orchcode").join("auth.json"))
}
fn supabase_url() -> Result<String> { Ok(env!("SUPABASE_URL").to_string()) }
fn anon_key() -> Result<String> { Ok(env!("SUPABASE_ANON_KEY").to_string()) }
pub async fn require_token_async() -> Result<String> {
    let path = auth_path().ok_or_else(|| anyhow!("No data dir"))?;
    let raw = tokio::fs::read_to_string(&path).await?;
    let mut data: AuthData = serde_json::from_str(&raw)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    let needs_refresh = data.expires_at.map(|exp| now + 60 >= exp).unwrap_or(false);
    if needs_refresh {
        if let Some(rt) = data.refresh_token.clone() {
            if let Ok(refreshed) = refresh_token_async(&rt).await {
                data.token = refreshed.0;
                data.refresh_token = Some(refreshed.1);
                data.expires_at = Some(refreshed.2);
                let _ = tokio::fs::write(&path, serde_json::to_string(&data)?).await;
            }
        }
    }
    Ok(data.token)
}
async fn refresh_token_async(refresh_token: &str) -> Result<(String, String, u64)> {
    let supabase_url = supabase_url()?;
    let anon_key = anon_key()?;
    let resp: serde_json::Value = reqwest::Client::new()
        .post(format!("{supabase_url}/auth/v1/token?grant_type=refresh_token"))
        .header("apikey", &anon_key)
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send().await?.error_for_status()?.json().await?;
    let access = resp["access_token"].as_str().ok_or_else(|| anyhow!("No access_token"))?.to_string();
    let new_rt = resp["refresh_token"].as_str().unwrap_or(refresh_token).to_string();
    let expires_in = resp["expires_in"].as_u64().unwrap_or(3600);
    let expires_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs() + expires_in;
    Ok((access, new_rt, expires_at))
}
fn store(token: &str, refresh_token: Option<&str>, expires_at: Option<u64>, user: &UserProfile) -> Result<()> {
    let path = auth_path().ok_or_else(|| anyhow!("No data dir"))?;
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(path, serde_json::to_string(&AuthData {
        token: token.to_string(),
        refresh_token: refresh_token.map(|s| s.to_string()),
        expires_at,
        user: user.clone(),
    })?)?;
    Ok(())
}
pub fn get_user() -> Option<UserProfile> {
    let data: AuthData = serde_json::from_str(&std::fs::read_to_string(auth_path()?).ok()?).ok()?;
    Some(data.user)
}
pub fn clear() -> Result<()> {
    if let Some(p) = auth_path() { let _ = std::fs::remove_file(p); }
    Ok(())
}
pub async fn login(app: AppHandle) -> Result<UserProfile> {
    use sha2::{Sha256, Digest};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let supabase_url = supabase_url()?;
    let anon_key = anon_key()?;
    let code_verifier = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://localhost:{port}/callback");
    let auth_url = format!(
        "{supabase_url}/auth/v1/authorize?provider=google&redirect_to={redirect_uri}&code_challenge={code_challenge}&code_challenge_method=S256"
    );
    open::that(&auth_url)?;
    let code = tokio::time::timeout(std::time::Duration::from_secs(180), async {
        let (mut s, _) = listener.accept().await?;
        let mut r = BufReader::new(&mut s);
        let mut line = String::new();
        r.read_line(&mut line).await?;
        let path = line.split_whitespace().nth(1).unwrap_or("");
        let qs = path.split('?').nth(1).unwrap_or("");
        let code = url::form_urlencoded::parse(qs.as_bytes())
            .find(|(k, _)| k == "code")
            .map(|(_, v)| v.to_string())
            .ok_or_else(|| anyhow!("No code in callback"))?;
        // L6: use proper Unicode em-dash, not raw bytes
        let html = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>Orch Code</title>\
<style>*{margin:0;padding:0;box-sizing:border-box}\
body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;\
background:#141210;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;gap:12px}\
span{font-size:13px;font-weight:700;letter-spacing:.08em;color:#e8a262;text-transform:uppercase}\
p{font-size:13px;color:#6b5e52}</style></head>\
<body><span>Orch Code</span><p>Signed in \xe2\x80\x94 you can close this tab</p></body></html>";
        let _ = s.write_all(html).await;
        Ok::<String, anyhow::Error>(code)
    }).await.map_err(|_| anyhow!("Login timed out"))??;
    let token_resp: serde_json::Value = reqwest::Client::new()
        .post(format!("{supabase_url}/auth/v1/token?grant_type=pkce"))
        .header("apikey", &anon_key)
        .json(&serde_json::json!({ "auth_code": code, "code_verifier": code_verifier }))
        .send().await?.error_for_status()?.json().await?;
    let access_token = token_resp["access_token"].as_str()
        .ok_or_else(|| anyhow!("No access_token in token response"))?;
    let refresh_token = token_resp["refresh_token"].as_str();
    let expires_in = token_resp["expires_in"].as_u64().unwrap_or(3600);
    let expires_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs() + expires_in;
    let user: serde_json::Value = reqwest::Client::new()
        .get(format!("{supabase_url}/auth/v1/user"))
        .bearer_auth(access_token)
        .header("apikey", &anon_key)
        .send().await?.error_for_status()?.json().await?;
    let profile = UserProfile {
        id: user["id"].as_str().unwrap_or("").to_string(),
        email: user["email"].as_str().unwrap_or("").to_string(),
        name: user["user_metadata"]["full_name"].as_str().map(|s| s.to_string()),
        avatar_url: user["user_metadata"]["avatar_url"].as_str().map(|s| s.to_string()),
        onboarding_complete: user["user_metadata"]["onboarding_complete"].as_bool(),
    };
    store(access_token, refresh_token, Some(expires_at), &profile)?;
    app.emit("auth://changed", &profile)?;
    Ok(profile)
}
pub async fn complete_onboarding() -> Result<()> {
    let token = require_token_async().await?;
    let supabase_url = supabase_url()?;
    let anon_key = anon_key()?;
    reqwest::Client::new()
        .put(format!("{supabase_url}/auth/v1/user"))
        .bearer_auth(&token)
        .header("apikey", &anon_key)
        .json(&serde_json::json!({"data": {"onboarding_complete": true}}))
        .send().await?.error_for_status()?;
    if let Some(mut user) = get_user() {
        user.onboarding_complete = Some(true);
        let path = auth_path().ok_or_else(|| anyhow!("No data dir"))?;
        let existing: AuthData = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
        store(&token, existing.refresh_token.as_deref(), existing.expires_at, &user)?;
    }
    Ok(())
}
pub fn logout(app: &AppHandle) -> Result<()> {
    clear()?;
    app.emit("auth://changed", Option::<UserProfile>::None)?;
    Ok(())
}
