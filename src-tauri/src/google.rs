//! Google account: OAuth for installed apps + narrowly scoped API access.
//! One sign-in covers Calendar, Drive (only files Questline creates) and the
//! account's name and email. Drive sync itself lives in drive.rs.
//!
//! Flow (Google's recommended one for desktop apps):
//!   1. Bind a one-shot HTTP listener on 127.0.0.1:<random port>.
//!   2. Open the consent page in the default browser with a PKCE (S256) challenge.
//!   3. Google redirects back to the loopback address with ?code=…
//!   4. Exchange the code (+ PKCE verifier) for access and refresh tokens.
//!   5. Store the refresh token, DPAPI-encrypted, in the app data folder.
//!
//! The UI then calls `google_api` for Calendar v3 endpoints only, and the
//! drive_* commands for the Questline folder. Tokens never leave the Rust side.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
pub(crate) const API_BASE: &str = "https://www.googleapis.com";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
/// drive.file only reaches files and folders Questline itself created.
pub(crate) const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
/// Asked at sign-in: name/email and Questline's own Drive files. None of these
/// are "sensitive" to Google, so plain sign-ins show no unverified-app warning.
const BASE_SCOPES: &str = "openid email profile https://www.googleapis.com/auth/drive.file";
/// Asked only when you turn Google Calendar on (incremental authorization).
const CALENDAR_SCOPES: &str = "https://www.googleapis.com/auth/calendar.readonly \
                               https://www.googleapis.com/auth/calendar.events";
const TOKEN_FILE: &str = "google-token.bin";

/// Questline's own Google OAuth client, baked in at build time from the GitHub
/// secrets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (see the release workflow).
/// With it, users only ever see "Sign in with Google". Google treats desktop
/// client secrets as non-confidential, so shipping it inside the app is expected.
const BUILTIN_CLIENT_ID: Option<&str> = option_env!("QUESTLINE_GOOGLE_CLIENT_ID");
const BUILTIN_CLIENT_SECRET: Option<&str> = option_env!("QUESTLINE_GOOGLE_CLIENT_SECRET");

fn builtin_client() -> Option<(String, Option<String>)> {
    let id = BUILTIN_CLIENT_ID.map(str::trim).filter(|s| !s.is_empty())?;
    let secret = BUILTIN_CLIENT_SECRET.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    Some((id.to_string(), secret))
}

/// True when this build has Questline's own Google client inside.
#[tauri::command]
pub fn google_builtin() -> bool {
    builtin_client().is_some()
}
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize, Deserialize, Clone)]
struct Tokens {
    client_id: String,
    client_secret: Option<String>,
    refresh_token: String,
    access_token: String,
    /// Unix seconds.
    expires_at: u64,
    /// Space-separated scopes Google actually granted (empty for pre-0.4 sign-ins).
    #[serde(default)]
    scope: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
}

/// What the Settings page shows about the signed-in account.
#[derive(Serialize)]
pub struct Account {
    connected: bool,
    email: String,
    name: String,
    calendar: bool,
    drive: bool,
}

static CACHE: Mutex<Option<Tokens>> = Mutex::new(None);

pub(crate) fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .user_agent("Questline/0.1")
            .build()
            .expect("http client")
    })
}

pub(crate) fn now_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn token_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(TOKEN_FILE))
}

fn save_tokens(app: &AppHandle, t: &Tokens) -> Result<(), String> {
    let raw = serde_json::to_vec(t).map_err(|e| e.to_string())?;
    let enc = crate::secure::protect(&raw)?;
    std::fs::write(token_path(app)?, enc).map_err(|e| e.to_string())?;
    *CACHE.lock().map_err(|e| e.to_string())? = Some(t.clone());
    Ok(())
}

fn load_tokens(app: &AppHandle) -> Option<Tokens> {
    if let Ok(c) = CACHE.lock() {
        if let Some(t) = c.as_ref() {
            return Some(t.clone());
        }
    }
    let enc = std::fs::read(token_path(app).ok()?).ok()?;
    let raw = crate::secure::unprotect(&enc).ok()?;
    let t: Tokens = serde_json::from_slice(&raw).ok()?;
    if let Ok(mut c) = CACHE.lock() {
        *c = Some(t.clone());
    }
    Some(t)
}

pub(crate) fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

async fn post_token(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = http()
        .post(TOKEN_URL)
        .form(form)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Google: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Google rejected the sign-in ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Reads one HTTP request from the loopback socket and returns its path.
pub(crate) async fn read_request_path(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buf = vec![0u8; 8192];
    let mut len = 0;
    while len < buf.len() {
        let n = stream.read(&mut buf[len..]).await.ok()?;
        if n == 0 {
            break;
        }
        len += n;
        if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf[..len]);
    let first = head.lines().next()?;
    let mut parts = first.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    Some(parts.next()?.to_string())
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Questline</title>\
<body style=\"font-family:system-ui;background:#EAF4E4;color:#23343B;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"background:#FFFDF4;border:4px solid #2F4858;border-radius:14px;padding:28px 36px;text-align:center\">\
<h2 style=\"margin:0 0 8px\">Google account linked!</h2><p style=\"margin:0\">You can close this tab and return to Questline.</p></div>";

#[tauri::command]
pub async fn google_connect(
    app: AppHandle,
    client_id: Option<String>,
    client_secret: Option<String>,
    calendar: Option<bool>,
) -> Result<(), String> {
    // Asking for Calendar on top of an existing sign-in keeps the account and
    // the permissions already granted (include_granted_scopes below).
    let calendar = calendar.unwrap_or(false);
    let previous = load_tokens(&app);
    let scopes = if calendar { format!("{BASE_SCOPES} {CALENDAR_SCOPES}") } else { BASE_SCOPES.to_string() };
    // Your own client from Settings (advanced) wins; otherwise the built-in one.
    let (client_id, client_secret) = match client_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(id) => (id, client_secret),
        None => builtin_client().ok_or(
            "This build of Questline has no Google sign-in built in. Add your own client under Settings → Google account → Use my own Google app.",
        )?,
    };
    if !client_id.ends_with(".apps.googleusercontent.com") {
        return Err("That doesn't look like a Google OAuth client ID. It should end in .apps.googleusercontent.com".into());
    }
    let client_secret = client_secret
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");

    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);

    let mut params: Vec<(&str, &str)> = vec![
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", scopes.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state.as_str()),
        ("access_type", "offline"),
        ("include_granted_scopes", "true"),
        ("prompt", "consent"),
    ];
    // Same account as before when only adding Calendar.
    let hint = previous.as_ref().map(|t| t.email.clone()).unwrap_or_default();
    if calendar && !hint.is_empty() {
        params.push(("login_hint", hint.as_str()));
    }
    let auth = url::Url::parse_with_params(AUTH_URL, &params).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_url(auth.as_str(), None::<&str>).map_err(|e| e.to_string())?;

    // Wait for the redirect. Browsers may also ask for /favicon.ico, so loop.
    let code = tokio::time::timeout(LOGIN_TIMEOUT, async {
        loop {
            let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let Some(path) = read_request_path(&mut stream).await else { continue };
            let parsed = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
            let mut code = None;
            let mut err = None;
            let mut got_state = None;
            for (k, v) in parsed.query_pairs() {
                match k.as_ref() {
                    "code" => code = Some(v.into_owned()),
                    "error" => err = Some(v.into_owned()),
                    "state" => got_state = Some(v.into_owned()),
                    _ => {}
                }
            }
            if code.is_none() && err.is_none() {
                let _ = stream
                    .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await;
                continue;
            }
            let body = DONE_PAGE;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.shutdown().await;
            if let Some(e) = err {
                return Err(format!("Sign-in was cancelled ({e})."));
            }
            if got_state.as_deref() != Some(state.as_str()) {
                return Err("Sign-in response didn't match this request. Please try again.".to_string());
            }
            return Ok::<String, String>(code.unwrap_or_default());
        }
    })
    .await
    .map_err(|_| "Sign-in timed out after 5 minutes.".to_string())??;

    let mut form: Vec<(&str, &str)> = vec![
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier.as_str()),
    ];
    if let Some(s) = client_secret.as_deref() {
        form.push(("client_secret", s));
    }
    let tr = post_token(&form).await?;
    let refresh = tr
        .refresh_token
        .ok_or("Google didn't return a refresh token. Remove Questline's access at myaccount.google.com/permissions and connect again.")?;

    // Name and email for Settings; failure here isn't fatal.
    let (email, name) = userinfo(&tr.access_token).await.unwrap_or_default();
    save_tokens(
        &app,
        &Tokens {
            client_id,
            client_secret,
            refresh_token: refresh,
            access_token: tr.access_token,
            expires_at: now_s() + tr.expires_in,
            scope: tr.scope.unwrap_or_default(),
            email,
            name,
        },
    )
}

async fn userinfo(token: &str) -> Option<(String, String)> {
    let v: Value = http().get(USERINFO_URL).bearer_auth(token).send().await.ok()?.json().await.ok()?;
    Some((
        v["email"].as_str().unwrap_or_default().to_string(),
        v["name"].as_str().unwrap_or_default().to_string(),
    ))
}

pub(crate) async fn access_token(app: &AppHandle, force_refresh: bool) -> Result<String, String> {
    let mut t = load_tokens(app).ok_or("Your Google account isn't connected.")?;
    if !force_refresh && t.expires_at > now_s() + 60 {
        return Ok(t.access_token);
    }
    let mut form: Vec<(&str, &str)> = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", t.refresh_token.as_str()),
        ("client_id", t.client_id.as_str()),
    ];
    if let Some(s) = t.client_secret.as_deref() {
        form.push(("client_secret", s));
    }
    let tr = post_token(&form).await?;
    t.access_token = tr.access_token;
    t.expires_at = now_s() + tr.expires_in;
    if let Some(r) = tr.refresh_token {
        t.refresh_token = r;
    }
    if let Some(sc) = tr.scope {
        t.scope = sc;
    }
    save_tokens(app, &t)?;
    Ok(t.access_token)
}

#[tauri::command]
pub fn google_status(app: AppHandle) -> bool {
    load_tokens(&app).is_some()
}

/// Granted scopes are only known after a token refresh for older sign-ins,
/// so this refreshes once when the list is empty.
#[tauri::command]
pub async fn google_account(app: AppHandle) -> Result<Account, String> {
    let Some(mut t) = load_tokens(&app) else {
        return Ok(Account { connected: false, email: String::new(), name: String::new(), calendar: false, drive: false });
    };
    if t.scope.is_empty() || t.email.is_empty() {
        if let Ok(tok) = access_token(&app, t.scope.is_empty()).await {
            if t.email.is_empty() {
                if let Some((email, name)) = userinfo(&tok).await {
                    if let Some(mut fresh) = load_tokens(&app) {
                        fresh.email = email;
                        fresh.name = name;
                        let _ = save_tokens(&app, &fresh);
                    }
                }
            }
        }
        t = load_tokens(&app).unwrap_or(t);
    }
    // Pre-0.4 sign-ins never recorded scopes: they only ever had Calendar.
    let has = |s: &str| t.scope.split_whitespace().any(|x| x == s);
    Ok(Account {
        connected: true,
        calendar: t.scope.is_empty() || has("https://www.googleapis.com/auth/calendar.events"),
        drive: has(DRIVE_SCOPE),
        email: t.email,
        name: t.name,
    })
}

#[tauri::command]
pub async fn google_disconnect(app: AppHandle) -> Result<(), String> {
    if let Some(t) = load_tokens(&app) {
        let _ = http()
            .post(REVOKE_URL)
            .form(&[("token", t.refresh_token.as_str())])
            .send()
            .await;
    }
    if let Ok(mut c) = CACHE.lock() {
        *c = None;
    }
    let _ = std::fs::remove_file(token_path(&app)?);
    Ok(())
}

/// Calendar v3 proxy. `path` must start with /calendar/v3/.
#[tauri::command]
pub async fn google_api(
    app: AppHandle,
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<Value, String> {
    if !path.starts_with("/calendar/v3/") || path.contains("..") {
        return Err("Only Google Calendar API paths are allowed.".into());
    }
    let m = match method.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        other => return Err(format!("Unsupported method {other}")),
    };
    let url = format!("{API_BASE}{path}");

    for attempt in 0..2 {
        let token = access_token(&app, attempt == 1).await?;
        let mut req = http().request(m.clone(), &url).bearer_auth(token);
        if let Some(q) = &query {
            req = req.query(q);
        }
        if let Some(b) = &body {
            req = req.json(b);
        }
        let res = req.send().await.map_err(|e| format!("Network error: {e}"))?;
        let status = res.status();
        if status.as_u16() == 401 && attempt == 0 {
            continue; // token expired early: refresh once and retry
        }
        let text = res.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
                .unwrap_or(text);
            return Err(format!("Google Calendar error {}: {msg}", status.as_u16()));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        return serde_json::from_str(&text).map_err(|e| e.to_string());
    }
    Err("Google Calendar rejected the saved sign-in. Reconnect in Settings.".into())
}

/// Downloads a read-only iCal feed (Google "secret address", Outlook, iCloud…).
#[tauri::command]
pub async fn fetch_ics(url: String) -> Result<String, String> {
    let url = url.trim();
    let url = if let Some(rest) = url.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        url.to_string()
    };
    if !url.starts_with("https://") {
        return Err("Calendar links must start with https:// or webcal://".into());
    }
    let res = http().get(&url).send().await.map_err(|e| format!("Network error: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("The calendar link returned {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("That calendar feed is larger than 8 MB.".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
