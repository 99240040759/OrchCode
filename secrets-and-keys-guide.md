# Production Secrets & Keys — Full Reference

## Mental Model First

For a **compiled Tauri desktop app**, the security model is different from a web app:

- **OAuth Client IDs** → Not secret. Visible in network traffic. Bake into binary.
- **OAuth Client Secrets** → Weakly secret (extractable from binary). Still bake into binary — this is the industry standard for desktop apps (Slack, Notion, VS Code all do this). Real security comes from PKCE + state validation, not the secret.
- **User access/refresh tokens** → Never in code. Runtime-only. Already stored in OS keychain correctly. ✅
- **Firebase API Key** → Semi-public by Google's design, but keep in secrets anyway.
- **Sentry DSN** → Semi-public, keep in secrets.

> [!IMPORTANT]
> GitHub Secrets inject values as env vars during `cargo build`. Your `option_env!()` macro bakes them into the binary at compile time. This is the correct production flow.

---

## Every Secret You Need

### 1. Google (covers both Drive + Gmail — same OAuth app)

**Where to get it:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (e.g. "Orch")
3. APIs & Services → Enable APIs → enable **Google Drive API** and **Gmail API**
4. APIs & Services → Credentials → Create Credentials → **OAuth 2.0 Client ID**
5. Application type: **Desktop app**
6. Download the JSON — you need `client_id` and `client_secret`
7. OAuth consent screen → set app name, logo, support email
8. Add scopes: `drive.readonly`, `drive.metadata.readonly`, `gmail.readonly`
9. Add redirect URI: `https://orch.live/oauth/google_drive` and `https://orch.live/oauth/gmail`

**Secrets:**
```
GOOGLE_CLIENT_ID      = 123456789-abc...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET  = GOCSPX-abc123...
```

---

### 2. GitHub

**Where to get it:**
1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
2. Homepage URL: `https://orch.live`
3. Authorization callback URL: `https://orch.live/oauth/github`
4. Register → get Client ID → Generate a new client secret

**Secrets:**
```
GITHUB_CLIENT_ID      = Ov23liABCDEF123456
GITHUB_CLIENT_SECRET  = abc123def456...40chars
```

---

### 3. Notion

**Where to get it:**
1. Go to [www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. New integration → **Public integration** (not internal — you need OAuth for end users)
3. Set redirect URI: `https://orch.live/oauth/notion`
4. Capabilities: Read content, Read user info

**Secrets:**
```
NOTION_CLIENT_ID      = abc12345-1234-...
NOTION_CLIENT_SECRET  = secret_abc123...
```

> [!WARNING]
> Notion's public OAuth requires **manual review and approval** before real users can connect. Submit early — can take 1–4 weeks.

---

### 4. Slack

**Where to get it:**
1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
2. OAuth & Permissions → Redirect URLs → add `https://orch.live/oauth/slack`
3. **User Token Scopes** (NOT Bot Token Scopes): `channels:history`, `channels:read`, `files:read`, `search:read`, `users:read`, `users.profile:read`
4. Basic Information → get App Credentials

**Secrets:**
```
SLACK_CLIENT_ID       = 1234567890.9876543210
SLACK_CLIENT_SECRET   = abc123def456abc123def456abc123de
```

> [!IMPORTANT]
> Scopes **must** be under **User Token Scopes**, not Bot Token Scopes. `search:read` only works with user tokens.

> [!WARNING]
> For distribution outside your workspace: Slack requires app review/approval before external users can connect. Submit at api.slack.com when ready.

---

### 5. Jira / Atlassian

**Where to get it:**
1. Go to [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/)
2. Create → OAuth 2.0 integration
3. Permissions → Jira API → add scopes: `read:jira-work`, `read:jira-user`, `offline_access`
4. Authorization → Callback URL: `https://orch.live/oauth/jira`
5. Settings → get Client ID and Secret

**Secrets:**
```
JIRA_CLIENT_ID        = abc123ABC...32chars
JIRA_CLIENT_SECRET    = abc123DEF...64chars
```

---

### 6. Firebase (Main App Auth — Google Sign-In)

**Where to get it:**
1. [console.firebase.google.com](https://console.firebase.google.com) → your project
2. Project Settings → General → Your apps → Web app → copy `apiKey`
3. Authentication → Sign-in method → Google → enable
4. Authorized domains → add `orch.live` and `localhost`

**Secret:**
```
FIREBASE_API_KEY      = AIzaSyABC123...39chars
```

---

### 7. Sentry (Error Reporting)

**Where to get it:**
1. [sentry.io](https://sentry.io) → New Project → Rust
2. Copy the DSN from project settings

**Secret:**
```
SENTRY_DSN            = https://abc123@o123456.ingest.sentry.io/789012
```

---

## The Redirect Server — Critical Infrastructure

Your app uses `https://orch.live/oauth/{connector}` as the redirect URI. You **must** host this server. It does exactly one thing:

When an OAuth provider sends the user to `https://orch.live/oauth/github?code=ABC&state=XYZ`, your server redirects to the Tauri deep link:

```
orch://oauth/github?code=ABC&state=XYZ
```

**Option A — nginx (1 rule):**
```nginx
location ~ ^/oauth/(.+)$ {
    return 302 orch://oauth/$1$is_args$args;
}
```

**Option B — Cloudflare Worker (free, zero infra, recommended):**
```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const deep = "orch://oauth" + url.pathname + url.search;
    return Response.redirect(deep, 302);
  }
}
```

Deploy the Cloudflare Worker to `orch.live/oauth/*` in the Cloudflare dashboard. Free tier is more than sufficient.

> [!CAUTION]
> Without this relay running at `orch.live`, **all connector OAuth flows fail** for every user. It is a live production dependency.

---

## GitHub Actions — CI/CD Build Injection

### Step 1: Add all secrets to your repo

Repo → Settings → Secrets and variables → Actions → New repository secret:

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
NOTION_CLIENT_ID
NOTION_CLIENT_SECRET
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
JIRA_CLIENT_ID
JIRA_CLIENT_SECRET
FIREBASE_API_KEY
SENTRY_DSN
```

### Step 2: Inject in your build workflow

```yaml
- name: Build Tauri App
  env:
    GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}
    GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
    GITHUB_CLIENT_ID: ${{ secrets.GITHUB_CLIENT_ID }}
    GITHUB_CLIENT_SECRET: ${{ secrets.GITHUB_CLIENT_SECRET }}
    NOTION_CLIENT_ID: ${{ secrets.NOTION_CLIENT_ID }}
    NOTION_CLIENT_SECRET: ${{ secrets.NOTION_CLIENT_SECRET }}
    SLACK_CLIENT_ID: ${{ secrets.SLACK_CLIENT_ID }}
    SLACK_CLIENT_SECRET: ${{ secrets.SLACK_CLIENT_SECRET }}
    JIRA_CLIENT_ID: ${{ secrets.JIRA_CLIENT_ID }}
    JIRA_CLIENT_SECRET: ${{ secrets.JIRA_CLIENT_SECRET }}
    FIREBASE_API_KEY: ${{ secrets.FIREBASE_API_KEY }}
    SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
  run: cargo tauri build
```

`option_env!()` reads these at **compile time** and bakes them in. ✅

---

## Local Development

Create `src-tauri/.env` (already in `.gitignore`):

```env
GOOGLE_CLIENT_ID=your_dev_client_id
GOOGLE_CLIENT_SECRET=your_dev_secret
GITHUB_CLIENT_ID=your_dev_client_id
GITHUB_CLIENT_SECRET=your_dev_secret
NOTION_CLIENT_ID=your_dev_client_id
NOTION_CLIENT_SECRET=your_dev_secret
SLACK_CLIENT_ID=your_dev_client_id
SLACK_CLIENT_SECRET=your_dev_secret
JIRA_CLIENT_ID=your_dev_client_id
JIRA_CLIENT_SECRET=your_dev_secret
FIREBASE_API_KEY=your_dev_key
SENTRY_DSN=your_dev_dsn
```

Your `build.rs` already uses `dotenvy` — these load automatically on `cargo tauri dev`. The runtime override in `option_env_static()` also picks them up live. ✅

---

## What Goes Where — Master Table

| Secret | Baked in binary | GitHub Secret | OS Keychain | .env (dev only) |
|---|:---:|:---:|:---:|:---:|
| OAuth Client IDs | ✅ | ✅ | ❌ | ✅ |
| OAuth Client Secrets | ✅ | ✅ | ❌ | ✅ |
| Firebase API Key | ✅ | ✅ | ❌ | ✅ |
| Sentry DSN | ✅ | ✅ | ❌ | ✅ |
| User access tokens | ❌ never | ❌ | ✅ runtime | ❌ |
| User refresh tokens | ❌ never | ❌ | ✅ runtime | ❌ |

---

## Platform Checklist Before Shipping

### macOS
- [ ] Deep link scheme `orch://` declared in `tauri.conf.json` under `bundle.macOS.schemes`
- [ ] App code-signed with Apple Developer certificate
- [ ] App notarized (required for macOS 13+ for OAuth callbacks to work reliably)
- [ ] Google OAuth consent screen verified for production

### Windows
- [ ] `register_all()` already in `lib.rs` ✅
- [ ] Code signed (EV certificate preferred — removes SmartScreen warnings)
- [ ] Windows Defender SmartScreen tested

### Linux
- [ ] `.desktop` file with MIME handler for `orch://` scheme
- [ ] Tested on GNOME and KDE (different deep link handling)

### All Platforms
- [ ] Redirect server at `orch.live` live and tested
- [ ] Slack app submitted for review if distributing externally
- [ ] Notion integration submitted for review
- [ ] Google OAuth consent screen verified (unverified = 100 user limit)
- [ ] All provider redirect URIs registered (production URLs, not localhost)
