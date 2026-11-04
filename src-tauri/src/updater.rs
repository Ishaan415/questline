//! Self-updates from GitHub Releases.
//!
//! Windows: the release workflow publishes a signed installer plus `latest.json`.
//! `update_check` downloads that JSON (URL in tauri.conf.json → plugins.updater),
//! compares versions, and remembers the pending update. `update_install`
//! downloads it, verifies the signature against the public key baked into the
//! app, and runs the installer. On Windows the installer closes Questline,
//! updates it and starts it again.
//!
//! Android: `update_check` asks the GitHub API for the newest release (the same
//! endpoint the "What's new" notes use) and looks for `Questline-android.apk`
//! among its files. `update_install` downloads the APK into the app's cache
//! folder and opens Android's installer. Android itself refuses an APK that
//! isn't signed with the same key as the installed app.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

// ------------------------------------------------------------------ desktop

#[cfg(desktop)]
mod desktop {
    use super::*;
    use tauri_plugin_updater::{Update, UpdaterExt};

    static PENDING: Mutex<Option<Update>> = Mutex::new(None);

    /// latest.json (written by tauri-action) points the installer at GitHub's API
    /// (`api.github.com/repos/…/releases/assets/<id>`). Unauthenticated API calls
    /// are limited to 60 an hour per network, and on shared or mobile networks
    /// that limit is often used up, which shows as "403 Forbidden". The normal
    /// download link has no such limit, so we use it instead. The file name comes
    /// from the update's signature ("file:Questline_0.6.1_x64-setup.exe"), and
    /// the signature is still checked against the downloaded bytes.
    fn direct_url(u: &Update) -> Option<tauri::Url> {
        use base64::Engine;
        let prefix = format!("https://api.github.com/repos/{REPO}/releases/assets/");
        if !u.download_url.as_str().starts_with(&prefix) {
            return None;
        }
        let sig = base64::engine::general_purpose::STANDARD.decode(u.signature.trim()).ok()?;
        let text = String::from_utf8_lossy(&sig);
        let file = text
            .split(|c: char| c == '\t' || c.is_whitespace())
            .find_map(|part| part.strip_prefix("file:"))?;
        let safe = !file.is_empty() && file.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
        if !safe {
            return None;
        }
        let version: String = u.version.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').collect();
        tauri::Url::parse(&format!("https://github.com/{REPO}/releases/download/v{version}/{file}")).ok()
    }

    pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
        let updater = app.updater().map_err(|e| e.to_string())?;
        let found = updater.check().await.map_err(|e| e.to_string())?;
        let info = found.as_ref().map(|u| UpdateInfo {
            version: u.version.clone(),
            current_version: u.current_version.clone(),
            notes: u.body.clone(),
            date: u.date.map(|d| d.to_string()),
        });
        *PENDING.lock().map_err(|e| e.to_string())? = found;
        Ok(info)
    }

    async fn run(app: &AppHandle, update: &Update) -> Result<(), String> {
        let mut downloaded: u64 = 0;
        let emitter = app.clone();
        update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let _ = emitter.emit("update-progress", Progress { downloaded, total });
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn install(app: &AppHandle) -> Result<(), String> {
        let update = PENDING
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("No update is waiting. Check for updates first.")?;
        // Direct download first; GitHub's API link only if that fails.
        let mut result = Err(String::new());
        if let Some(url) = direct_url(&update) {
            let mut direct = update.clone();
            direct.download_url = url;
            result = run(app, &direct).await;
        }
        if result.is_err() {
            result = run(app, &update).await;
        }
        if let Err(e) = result {
            return Err(if e.contains("403") {
                "Update failed: GitHub is limiting downloads from your network right now. Try again in an hour, or download the installer from the release page.".into()
            } else {
                format!("Update failed: {e}")
            });
        }
        // Windows exits during install; this covers other platforms.
        app.restart();
    }
}

// ------------------------------------------------------------------ Android

/// This app's GitHub repository (releases and update files live here).
const REPO: &str = "Ishaan415/questline";

/// The phone build's file name in every release.
#[cfg_attr(desktop, allow(dead_code))]
const ANDROID_APK: &str = "Questline-android.apk";
/// Only APKs from this repository's releases are downloaded.
#[cfg_attr(desktop, allow(dead_code))]
const RELEASE_PREFIX: &str = "https://github.com/Ishaan415/questline/releases/download/";

#[derive(Clone)]
#[cfg_attr(desktop, allow(dead_code))]
struct AndroidRelease {
    version: String,
    url: String,
    notes: Option<String>,
    date: Option<String>,
}

/// "error sending request: client error (Connect): dns error: …": the whole
/// chain of causes, so a failure says what actually went wrong.
pub(crate) fn why(e: reqwest::Error) -> String {
    let e = e.without_url();
    let mut out = e.to_string();
    let mut src = std::error::Error::source(&e);
    while let Some(s) = src {
        let t = s.to_string();
        if !out.contains(&t) {
            out.push_str(": ");
            out.push_str(&t);
        }
        src = s.source();
    }
    out
}

#[cfg_attr(desktop, allow(dead_code))]
static ANDROID_PENDING: Mutex<Option<AndroidRelease>> = Mutex::new(None);

/// "0.5.12" → (0, 5, 12). Anything unparsable sorts as 0.
#[cfg_attr(desktop, allow(dead_code))]
fn parse_version(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim().trim_start_matches('v').split(['.', '-', '+']).map(|p| p.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

/// android.json, published next to every release by the workflow.
#[cfg_attr(desktop, allow(dead_code))]
async fn android_manifest() -> Result<Option<AndroidRelease>, String> {
    #[derive(Deserialize)]
    struct Manifest {
        version: String,
        url: String,
        #[serde(default)]
        notes: Option<String>,
        #[serde(default)]
        date: Option<String>,
    }
    let res = crate::google::http()
        .get(format!("https://github.com/{REPO}/releases/latest/download/android.json"))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {}", why(e)))?;
    if res.status().as_u16() == 404 {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(format!("GitHub returned {}", res.status()));
    }
    let m: Manifest = res.json().await.map_err(|e| format!("Couldn't read android.json: {}", why(e)))?;
    Ok(Some(AndroidRelease { version: m.version, url: m.url, notes: m.notes, date: m.date }))
}

/// The newest release as GitHub's API describes it.
#[cfg_attr(desktop, allow(dead_code))]
async fn android_from_api() -> Result<Option<AndroidRelease>, String> {
    let Some(gh) = fetch_release(&format!("{RELEASES_API}/latest")).await? else {
        return Ok(None);
    };
    let Some(apk) = gh.assets.iter().find(|a| a.name == ANDROID_APK) else {
        return Ok(None);
    };
    Ok(Some(AndroidRelease {
        version: gh.tag_name.trim_start_matches('v').to_string(),
        url: apk.browser_download_url.clone(),
        notes: gh.body.clone(),
        date: gh.published_at.clone(),
    }))
}

#[cfg_attr(desktop, allow(dead_code))]
async fn android_check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    // android.json first (a plain download, no limit); GitHub's API if that fails.
    let rel = match android_manifest().await {
        Ok(rel) => rel,
        Err(first) => match android_from_api().await {
            Ok(rel) => rel,
            Err(second) => return Err(format!("{second} (also tried android.json: {first})")),
        },
    };
    // The newest release has no phone build (yet): nothing to offer.
    let Some(rel) = rel else { return Ok(None) };
    let newer = parse_version(&rel.version) > parse_version(&current) && rel.url.starts_with(RELEASE_PREFIX);
    let info = newer.then(|| UpdateInfo {
        version: rel.version.clone(),
        current_version: current,
        notes: rel.notes.clone(),
        date: rel.date.clone(),
    });
    *ANDROID_PENDING.lock().map_err(|e| e.to_string())? = if newer { Some(rel) } else { None };
    Ok(info)
}

#[cfg_attr(desktop, allow(dead_code))]
async fn android_install(app: &AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tokio::io::AsyncWriteExt;

    let rel = ANDROID_PENDING
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No update is waiting. Check for updates first.")?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
    // Old downloads are useless once a newer one starts.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = rel.version.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.').collect();
    let path = dir.join(format!("Questline-{safe}.apk"));

    let mut res = crate::google::http()
        .get(&rel.url)
        // The default 25 s timeout is for API calls; an APK can take longer.
        .timeout(std::time::Duration::from_secs(15 * 60))
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", why(e)))?;
    if !res.status().is_success() {
        return Err(format!("Download failed: GitHub returned {}", res.status()));
    }
    let total = res.content_length();
    let mut file = tokio::fs::File::create(&path).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("Download failed: {}", why(e)))? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit("update-progress", Progress { downloaded, total });
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    crate::mobile::install_apk(app, &path.to_string_lossy()).await
}

// ------------------------------------------------------------- release notes

const RELEASES_API: &str = "https://api.github.com/repos/Ishaan415/questline/releases";

#[derive(Serialize, Clone)]
pub struct ReleaseNotes {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
    pub url: Option<String>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

async fn fetch_release(url: &str) -> Result<Option<GhRelease>, String> {
    let res = crate::google::http()
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {}", why(e)))?;
    if res.status().as_u16() == 404 {
        return Ok(None);
    }
    if res.status().as_u16() == 403 || res.status().as_u16() == 429 {
        return Err("GitHub is limiting checks from this network right now. Try again in an hour.".into());
    }
    if !res.status().is_success() {
        return Err(format!("GitHub returned {}", res.status()));
    }
    res.json::<GhRelease>().await.map(Some).map_err(|e| e.to_string())
}

/// Release notes for the installed version (or `version`), falling back to
/// the newest release when that tag has none.
#[tauri::command]
pub async fn release_notes(app: AppHandle, version: Option<String>) -> Result<Option<ReleaseNotes>, String> {
    let v = version.unwrap_or_else(|| app.package_info().version.to_string());
    let v: String = v.trim().trim_start_matches('v').chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').collect();
    let mut rel = fetch_release(&format!("{RELEASES_API}/tags/v{v}")).await?;
    if rel.is_none() {
        rel = fetch_release(&format!("{RELEASES_API}/latest")).await?;
    }
    Ok(rel.map(|r| ReleaseNotes {
        version: r.tag_name.trim_start_matches('v').to_string(),
        notes: r.body.unwrap_or_default(),
        date: r.published_at,
        url: r.html_url,
    }))
}

// ------------------------------------------------------------------ commands

/// Returns the newer version if one is published, otherwise None.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[cfg(desktop)]
    return desktop::check(&app).await;
    #[cfg(mobile)]
    return android_check(&app).await;
}

/// Downloads and installs the update found by `update_check`.
/// Emits `update-progress` events while downloading.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    return desktop::install(&app).await;
    #[cfg(mobile)]
    return android_install(&app).await;
}
