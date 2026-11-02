//! Spotify Web API: see and control playback on *any* device on your account
//! (Spotifast, the phone app, the web player…), not just the desktop app.
//!
//! Questline uses this when the official Spotify desktop app isn't the one
//! playing; the Windows media-session path in media.rs stays the first choice
//! because it is instant and works offline. Control endpoints need Premium.
//!
//! Sign-in is Authorization Code + PKCE (no client secret) with a loopback
//! redirect on a fixed port that you register in the Spotify dashboard.
//! The refresh token is DPAPI-encrypted like the Google one.

use crate::google::{http, now_s, random_string, read_request_path};
use crate::media::MediaState;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

const AUTH_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const API: &str = "https://api.spotify.com/v1";
pub const REDIRECT_PORT: u16 = 43821;
const REDIRECT_URI: &str = "http://127.0.0.1:43821/callback";
const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const TOKEN_FILE: &str = "spotify-token.bin";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize, Deserialize, Clone)]
struct Tokens {
    client_id: String,
    refresh_token: String,
    access_token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

static CACHE: Mutex<Option<Tokens>> = Mutex::new(None);
/// (image URL, data URL) for the current cover, fetched once per track.
static ART: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn token_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(TOKEN_FILE))
}

fn save_tokens(app: &AppHandle, t: &Tokens) -> Result<(), String> {
    let raw = serde_json::to_vec(t).map_err(|e| e.to_string())?;
    std::fs::write(token_path(app)?, crate::secure::protect(&raw)?).map_err(|e| e.to_string())?;
    *CACHE.lock().map_err(|e| e.to_string())? = Some(t.clone());
    Ok(())
}

fn load_tokens(app: &AppHandle) -> Option<Tokens> {
    if let Some(t) = CACHE.lock().ok()?.as_ref() {
        return Some(t.clone());
    }
    let enc = std::fs::read(token_path(app).ok()?).ok()?;
    let t: Tokens = serde_json::from_slice(&crate::secure::unprotect(&enc).ok()?).ok()?;
    *CACHE.lock().ok()? = Some(t.clone());
    Some(t)
}

async fn post_token(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = http()
        .post(TOKEN_URL)
        .form(form)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Spotify: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Spotify rejected the sign-in ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Questline</title>\
<body style=\"font-family:system-ui;background:#EAF4E4;color:#23343B;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"background:#FFFDF4;border:4px solid #2F4858;border-radius:14px;padding:28px 36px;text-align:center\">\
<h2 style=\"margin:0 0 8px\">Spotify linked!</h2><p style=\"margin:0\">You can close this tab and return to Questline.</p></div>";

#[tauri::command]
pub async fn spotify_web_connect(app: AppHandle, client_id: String) -> Result<(), String> {
    let client_id = client_id.trim().to_string();
    if client_id.len() != 32 || !client_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("That doesn't look like a Spotify Client ID (32 letters and numbers from your app's Settings page).".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).await.map_err(|e| {
        format!("Port {REDIRECT_PORT} is busy, so Spotify can't send you back to Questline ({e}). Close other apps using it and try again.")
    })?;

    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);
    let auth = url::Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", client_id.as_str()),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT_URI),
            ("scope", SCOPES),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge.as_str()),
            ("state", state.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_url(auth.as_str(), None::<&str>).map_err(|e| e.to_string())?;

    let code = tokio::time::timeout(LOGIN_TIMEOUT, async {
        loop {
            let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let Some(path) = read_request_path(&mut stream).await else { continue };
            if !path.starts_with("/callback") {
                let _ = stream
                    .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await;
                continue;
            }
            let parsed = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
            let (mut code, mut err, mut got_state) = (None, None, None);
            for (k, v) in parsed.query_pairs() {
                match k.as_ref() {
                    "code" => code = Some(v.into_owned()),
                    "error" => err = Some(v.into_owned()),
                    "state" => got_state = Some(v.into_owned()),
                    _ => {}
                }
            }
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                DONE_PAGE.len(),
                DONE_PAGE
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.shutdown().await;
            if let Some(e) = err {
                return Err(format!("Spotify sign-in was cancelled ({e})."));
            }
            if got_state.as_deref() != Some(state.as_str()) {
                return Err("Sign-in response didn't match this request. Please try again.".to_string());
            }
            return Ok::<String, String>(code.unwrap_or_default());
        }
    })
    .await
    .map_err(|_| "Sign-in timed out after 5 minutes.".to_string())??;

    let tr = post_token(&[
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", client_id.as_str()),
        ("code_verifier", verifier.as_str()),
    ])
    .await?;
    let refresh = tr.refresh_token.ok_or("Spotify didn't return a refresh token. Please try again.")?;
    save_tokens(
        &app,
        &Tokens { client_id, refresh_token: refresh, access_token: tr.access_token, expires_at: now_s() + tr.expires_in },
    )
}

async fn access_token(app: &AppHandle, force: bool) -> Result<String, String> {
    let mut t = load_tokens(app).ok_or("Spotify account isn't connected.")?;
    if !force && t.expires_at > now_s() + 60 {
        return Ok(t.access_token);
    }
    let tr = post_token(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", t.refresh_token.as_str()),
        ("client_id", t.client_id.as_str()),
    ])
    .await?;
    t.access_token = tr.access_token;
    t.expires_at = now_s() + tr.expires_in;
    if let Some(r) = tr.refresh_token {
        t.refresh_token = r; // Spotify may rotate it
    }
    save_tokens(app, &t)?;
    Ok(t.access_token)
}

/// Calls the Web API. Ok(None) means "204 No Content" (e.g. nothing playing).
async fn api(app: &AppHandle, method: reqwest::Method, path: &str) -> Result<Option<Value>, String> {
    for attempt in 0..2 {
        let token = access_token(app, attempt == 1).await?;
        let mut req = http().request(method.clone(), format!("{API}{path}")).bearer_auth(token);
        if method != reqwest::Method::GET {
            req = req.header("Content-Length", "0");
        }
        let res = req.send().await.map_err(|e| format!("Network error: {e}"))?;
        let status = res.status().as_u16();
        if status == 401 && attempt == 0 {
            continue;
        }
        let text = res.text().await.unwrap_or_default();
        if status == 204 || (status < 300 && text.trim().is_empty()) {
            return Ok(None);
        }
        if status >= 300 {
            let reason = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["error"]["reason"].as_str().map(str::to_string))
                .unwrap_or_default();
            return Err(match (status, reason.as_str()) {
                (404, _) | (_, "NO_ACTIVE_DEVICE") => "Nothing is playing on your Spotify account. Press play in Spotifast or any Spotify app first.".into(),
                (403, "PREMIUM_REQUIRED") => "Spotify needs Premium to control playback.".into(),
                (429, _) => "Spotify asked Questline to slow down. Try again in a moment.".into(),
                _ => format!("Spotify error {status}: {text}"),
            });
        }
        return serde_json::from_str(&text).map(Some).map_err(|e| e.to_string());
    }
    Err("Spotify rejected the saved sign-in. Reconnect in Settings.".into())
}

async fn fetch_art(url: &str) -> Option<String> {
    let res = http().get(url).send().await.ok()?;
    let mime = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = res.bytes().await.ok()?;
    if bytes.len() > 2_000_000 {
        return None;
    }
    Some(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
}

#[tauri::command]
pub fn spotify_web_status(app: AppHandle) -> bool {
    load_tokens(&app).is_some()
}

#[tauri::command]
pub async fn spotify_web_disconnect(app: AppHandle) -> Result<(), String> {
    if let Ok(mut c) = CACHE.lock() {
        *c = None;
    }
    let _ = std::fs::remove_file(token_path(&app)?);
    Ok(())
}

/// Playback on whichever device your account is using right now.
#[tauri::command]
pub async fn spotify_web_state(app: AppHandle) -> Result<MediaState, String> {
    let Some(v) = api(&app, reqwest::Method::GET, "/me/player?additional_types=episode").await? else {
        return Ok(MediaState::default());
    };
    let item = &v["item"];
    if item.is_null() {
        return Ok(MediaState::default());
    }
    let is_episode = item["type"].as_str() == Some("episode");
    let artist = if is_episode {
        item["show"]["name"].as_str().unwrap_or_default().to_string()
    } else {
        item["artists"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", "))
            .unwrap_or_default()
    };
    let album = if is_episode { "" } else { item["album"]["name"].as_str().unwrap_or_default() };
    let images = if is_episode { &item["images"] } else { &item["album"]["images"] };
    // Pick the ~300 px cover (index 1) when present: sharp enough, small to transfer.
    let img_url = images
        .as_array()
        .and_then(|a| a.get(1).or_else(|| a.first()))
        .and_then(|i| i["url"].as_str())
        .unwrap_or_default()
        .to_string();
    let disallows = &v["actions"]["disallows"];
    let mut st = MediaState {
        available: true,
        playing: v["is_playing"].as_bool().unwrap_or(false),
        title: item["name"].as_str().unwrap_or_default().to_string(),
        artist,
        album: album.to_string(),
        position_ms: v["progress_ms"].as_u64().unwrap_or(0),
        duration_ms: item["duration_ms"].as_u64().unwrap_or(0),
        updated_ms: now_ms(),
        art_key: img_url.clone(),
        can_next: !disallows["skipping_next"].as_bool().unwrap_or(false),
        can_prev: !disallows["skipping_prev"].as_bool().unwrap_or(false),
        can_seek: !disallows["seeking"].as_bool().unwrap_or(false),
        shuffle: v["shuffle_state"].as_bool(),
        device: v["device"]["name"].as_str().unwrap_or_default().to_string(),
    };
    // Fetch the cover once per track and keep it as a data URL, so the page
    // never needs to load images from the internet.
    let stale = ART.lock().map(|a| a.as_ref().map(|(u, _)| u != &img_url).unwrap_or(true)).unwrap_or(true);
    if stale && !img_url.is_empty() {
        let data = fetch_art(&img_url).await;
        if let Ok(mut a) = ART.lock() {
            *a = Some((img_url, data));
        }
    }
    if st.title.is_empty() {
        st.title = "Unknown track".into();
    }
    Ok(st)
}

#[tauri::command]
pub fn spotify_web_art() -> Option<String> {
    ART.lock().ok()?.as_ref()?.1.clone()
}

/// action: "play" | "pause" | "next" | "prev" | "seek" (value = ms) | "shuffle" (value = 0/1)
#[tauri::command]
pub async fn spotify_web_control(app: AppHandle, action: String, value: Option<f64>) -> Result<(), String> {
    use reqwest::Method;
    let v = value.unwrap_or(0.0).max(0.0) as u64;
    let (method, path) = match action.as_str() {
        "play" => (Method::PUT, "/me/player/play".to_string()),
        "pause" => (Method::PUT, "/me/player/pause".to_string()),
        "next" => (Method::POST, "/me/player/next".to_string()),
        "prev" => (Method::POST, "/me/player/previous".to_string()),
        "seek" => (Method::PUT, format!("/me/player/seek?position_ms={v}")),
        "shuffle" => (Method::PUT, format!("/me/player/shuffle?state={}", v > 0)),
        other => return Err(format!("Unknown action {other}")),
    };
    api(&app, method, &path).await.map(|_| ())
}
