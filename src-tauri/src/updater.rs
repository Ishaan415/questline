//! Self-updates from GitHub Releases.
//!
//! Windows: the release workflow publishes a signed installer plus `latest.json`.
//! `update_check` downloads that JSON (URL in tauri.conf.json → plugins.updater),
//! compares versions, and remembers the pending update. `update_install`
//! downloads it, verifies the signature against the public key baked into the
//! app, and runs the installer. On Windows the installer closes Questline,
//! updates it and starts it again.
//!
//! Android: the same release carries `Questline-android.apk` and `android.json`.
//! `update_install` downloads the APK into the app's cache folder and opens
//! Android's installer. Android itself refuses an APK that isn't signed with the
//! same key as the installed app.

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

    pub async fn install(app: &AppHandle) -> Result<(), String> {
        let update = PENDING
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("No update is waiting. Check for updates first.")?;
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
            .map_err(|e| format!("Update failed: {e}"))?;
        // Windows exits during install; this covers other platforms.
        app.restart();
    }
}

// ------------------------------------------------------------------ Android

/// Published next to every release by the workflow.
#[cfg_attr(desktop, allow(dead_code))]
const ANDROID_MANIFEST: &str = "https://github.com/Ishaan415/questline/releases/latest/download/android.json";
/// Only APKs from this repository's releases are downloaded.
#[cfg_attr(desktop, allow(dead_code))]
const RELEASE_PREFIX: &str = "https://github.com/Ishaan415/questline/releases/download/";

#[derive(Deserialize, Clone)]
#[cfg_attr(desktop, allow(dead_code))]
struct AndroidRelease {
    version: String,
    url: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

#[cfg_attr(desktop, allow(dead_code))]
static ANDROID_PENDING: Mutex<Option<AndroidRelease>> = Mutex::new(None);

/// "0.5.12" → (0, 5, 12). Anything unparsable sorts as 0.
#[cfg_attr(desktop, allow(dead_code))]
fn parse_version(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim().trim_start_matches('v').split(['.', '-', '+']).map(|p| p.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

#[cfg_attr(desktop, allow(dead_code))]
async fn android_check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    let res = crate::google::http()
        .get(ANDROID_MANIFEST)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    if res.status().as_u16() == 404 {
        // The newest release has no phone build (yet).
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(format!("GitHub returned {}", res.status()));
    }
    let rel: AndroidRelease = res.json().await.map_err(|e| e.to_string())?;
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
        .map_err(|e| format!("Download failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Download failed: GitHub returned {}", res.status()));
    }
    let total = res.content_length();
    let mut file = tokio::fs::File::create(&path).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("Download failed: {e}"))? {
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
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
}

async fn fetch_release(url: &str) -> Result<Option<GhRelease>, String> {
    let res = crate::google::http()
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    if res.status().as_u16() == 404 {
        return Ok(None);
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
