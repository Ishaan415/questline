//! Calls into the Android side of the app (plugins/ql-mobile). On Windows these
//! are never reached; they return an error so callers stay simple.

use serde::Deserialize;
use tauri::AppHandle;

/// A Google access token from Google Play services, plus the scopes it covers.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub struct Grant {
    pub access_token: String,
    #[serde(default)]
    pub granted_scopes: Vec<String>,
}

#[cfg(target_os = "android")]
mod imp {
    use super::Grant;
    use serde_json::json;
    use tauri::{AppHandle, Manager, Wry};
    use tauri_plugin_ql_mobile::QlMobile;

    fn handle(app: &AppHandle) -> Result<tauri::plugin::PluginHandle<Wry>, String> {
        app.try_state::<QlMobile<Wry>>()
            .map(|s| s.0.clone())
            .ok_or_else(|| "The phone bridge isn't ready yet.".to_string())
    }

    pub async fn authorize(app: &AppHandle, scopes: Vec<String>, interactive: bool) -> Result<Grant, String> {
        let h = handle(app)?;
        h.run_mobile_plugin_async::<Grant>("authorize", json!({ "scopes": scopes, "interactive": interactive }))
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn clear_token(app: &AppHandle, token: &str) -> Result<(), String> {
        let h = handle(app)?;
        h.run_mobile_plugin_async::<serde_json::Value>("clearToken", json!({ "token": token }))
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub async fn install_apk(app: &AppHandle, path: &str) -> Result<(), String> {
        let h = handle(app)?;
        h.run_mobile_plugin_async::<serde_json::Value>("installApk", json!({ "path": path }))
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "android"))]
#[allow(dead_code)]
mod imp {
    use super::Grant;
    use tauri::AppHandle;

    const ONLY: &str = "Only available in the Android app.";

    pub async fn authorize(_app: &AppHandle, _scopes: Vec<String>, _interactive: bool) -> Result<Grant, String> {
        Err(ONLY.into())
    }
    pub async fn clear_token(_app: &AppHandle, _token: &str) -> Result<(), String> {
        Err(ONLY.into())
    }
    pub async fn install_apk(_app: &AppHandle, _path: &str) -> Result<(), String> {
        Err(ONLY.into())
    }
}

/// Google access token via Google Play services. `interactive = false` never shows UI.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub async fn authorize(app: &AppHandle, scopes: Vec<String>, interactive: bool) -> Result<Grant, String> {
    imp::authorize(app, scopes, interactive).await
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub async fn clear_token(app: &AppHandle, token: &str) -> Result<(), String> {
    imp::clear_token(app, token).await
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub async fn install_apk(app: &AppHandle, path: &str) -> Result<(), String> {
    imp::install_apk(app, path).await
}
