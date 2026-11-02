//! Self-updates from GitHub Releases.
//!
//! The release workflow publishes a signed installer plus `latest.json`.
//! `update_check` downloads that JSON (URL in tauri.conf.json → plugins.updater),
//! compares versions, and remembers the pending update. `update_install`
//! downloads it, verifies the signature against the public key baked into the
//! app, and runs the installer. On Windows the installer closes Questline,
//! updates it and starts it again.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

static PENDING: Mutex<Option<Update>> = Mutex::new(None);

#[derive(Serialize)]
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

/// Returns the newer version if one is published, otherwise None.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
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

/// Downloads and installs the update found by `update_check`.
/// Emits `update-progress` events while downloading.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
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
