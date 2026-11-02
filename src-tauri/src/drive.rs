//! Google Drive: the visible "Questline" folder that holds the sync file and
//! daily backups. Uses the drive.file scope, so Questline can only see files
//! and folders it created itself, never the rest of your Drive.
//!
//! The page decides *what* to sync (see cloud.js); these commands only move
//! JSON files in and out of folders, with ids validated before use.

use crate::google::{access_token, http, API_BASE};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const FIELDS: &str = "id,name,version,modifiedTime,size";
const MAX_FILE: usize = 20 * 1024 * 1024;

#[derive(Serialize, Clone, Debug)]
pub struct DriveFile {
    id: String,
    name: String,
    /// Increases on every change; used to notice another device's upload.
    version: String,
    #[serde(rename = "modifiedTime")]
    modified_time: String,
    size: u64,
}

impl DriveFile {
    fn from(v: &Value) -> Self {
        DriveFile {
            id: v["id"].as_str().unwrap_or_default().to_string(),
            name: v["name"].as_str().unwrap_or_default().to_string(),
            version: v["version"].as_str().unwrap_or_default().to_string(),
            modified_time: v["modifiedTime"].as_str().unwrap_or_default().to_string(),
            size: v["size"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
        }
    }
}

#[derive(Serialize)]
pub struct DriveContent {
    content: String,
    version: String,
}

fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 200 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid Drive file id.".into());
    }
    Ok(())
}

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 120 || name.contains(['/', '\\']) {
        return Err("Invalid Drive file name.".into());
    }
    Ok(())
}

/// Escapes a value for a Drive search query string literal.
fn q_lit(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

enum Body {
    None,
    Json(Value),
    Raw(String, String),
}

/// One Drive request with a single retry after refreshing an expired token.
async fn call(
    app: &AppHandle,
    method: reqwest::Method,
    url: &str,
    query: &[(&str, &str)],
    body: Body,
) -> Result<String, String> {
    for attempt in 0..2 {
        let token = access_token(app, attempt == 1).await?;
        let mut req = http().request(method.clone(), url).bearer_auth(token).query(query);
        req = match &body {
            Body::None => req,
            Body::Json(v) => req.json(v),
            Body::Raw(ct, s) => req.header("Content-Type", ct.as_str()).body(s.clone()),
        };
        let res = req.send().await.map_err(|e| format!("Network error: {e}"))?;
        let status = res.status();
        if status.as_u16() == 401 && attempt == 0 {
            continue;
        }
        let text = res.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
                .unwrap_or(text);
            if status.as_u16() == 403 && msg.to_lowercase().contains("scope") {
                return Err("Drive access wasn't granted. Reconnect your Google account in Settings and allow Drive.".into());
            }
            return Err(format!("Google Drive error {}: {msg}", status.as_u16()));
        }
        return Ok(text);
    }
    Err("Google rejected the saved sign-in. Reconnect your Google account in Settings.".into())
}

async fn search(app: &AppHandle, q: &str, order: &str) -> Result<Vec<DriveFile>, String> {
    let fields = format!("files({FIELDS})");
    let text = call(
        app,
        reqwest::Method::GET,
        &format!("{API_BASE}/drive/v3/files"),
        &[("q", q), ("fields", fields.as_str()), ("spaces", "drive"), ("orderBy", order), ("pageSize", "200")],
        Body::None,
    )
    .await?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(v["files"].as_array().map(|a| a.iter().map(DriveFile::from).collect()).unwrap_or_default())
}

fn parent_clause(parent: &Option<String>) -> Result<String, String> {
    match parent {
        Some(p) => {
            check_id(p)?;
            Ok(format!("'{p}' in parents"))
        }
        None => Ok("'root' in parents".into()),
    }
}

/// Finds (or creates) a folder by name, at the top of My Drive or inside `parent`.
#[tauri::command]
pub async fn drive_ensure_folder(app: AppHandle, name: String, parent: Option<String>) -> Result<String, String> {
    check_name(&name)?;
    let q = format!(
        "name = '{}' and mimeType = '{FOLDER_MIME}' and trashed = false and {}",
        q_lit(&name),
        parent_clause(&parent)?
    );
    if let Some(f) = search(&app, &q, "createdTime").await?.into_iter().next() {
        return Ok(f.id);
    }
    let meta = json!({ "name": name, "mimeType": FOLDER_MIME, "parents": [parent.unwrap_or_else(|| "root".into())] });
    let text = call(&app, reqwest::Method::POST, &format!("{API_BASE}/drive/v3/files"), &[("fields", "id")], Body::Json(meta)).await?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    v["id"].as_str().map(str::to_string).ok_or_else(|| "Drive didn't return a folder id.".into())
}

/// Metadata of a file by name inside a folder, if it exists.
#[tauri::command]
pub async fn drive_find(app: AppHandle, name: String, parent: String) -> Result<Option<DriveFile>, String> {
    check_name(&name)?;
    check_id(&parent)?;
    let q = format!("name = '{}' and '{parent}' in parents and trashed = false", q_lit(&name));
    Ok(search(&app, &q, "modifiedTime desc").await?.into_iter().next())
}

/// Files (not folders) inside a folder, newest name first.
#[tauri::command]
pub async fn drive_list(app: AppHandle, parent: String) -> Result<Vec<DriveFile>, String> {
    check_id(&parent)?;
    let q = format!("'{parent}' in parents and trashed = false and mimeType != '{FOLDER_MIME}'");
    search(&app, &q, "name desc").await
}

#[tauri::command]
pub async fn drive_read(app: AppHandle, id: String) -> Result<DriveContent, String> {
    check_id(&id)?;
    let url = format!("{API_BASE}/drive/v3/files/{id}");
    let meta = call(&app, reqwest::Method::GET, &url, &[("fields", "version,size")], Body::None).await?;
    let meta: Value = serde_json::from_str(&meta).map_err(|e| e.to_string())?;
    let size: usize = meta["size"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
    if size > MAX_FILE {
        return Err("That Drive file is too large to be a Questline save.".into());
    }
    let content = call(&app, reqwest::Method::GET, &url, &[("alt", "media")], Body::None).await?;
    Ok(DriveContent { content, version: meta["version"].as_str().unwrap_or_default().to_string() })
}

/// Creates a JSON file in `parent` (when `id` is None) or replaces the content of `id`.
#[tauri::command]
pub async fn drive_write(
    app: AppHandle,
    id: Option<String>,
    name: String,
    parent: String,
    content: String,
) -> Result<DriveFile, String> {
    check_name(&name)?;
    check_id(&parent)?;
    if content.len() > MAX_FILE {
        return Err("The save is too large to upload.".into());
    }
    let text = match id {
        Some(id) => {
            check_id(&id)?;
            call(
                &app,
                reqwest::Method::PATCH,
                &format!("{API_BASE}/upload/drive/v3/files/{id}"),
                &[("uploadType", "media"), ("fields", FIELDS)],
                Body::Raw("application/json; charset=UTF-8".into(), content),
            )
            .await?
        }
        None => {
            let boundary = format!("questline{}", crate::google::random_string(16));
            let meta = json!({ "name": name, "parents": [parent], "mimeType": "application/json" });
            let body = format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n\
                 --{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{content}\r\n--{boundary}--"
            );
            call(
                &app,
                reqwest::Method::POST,
                &format!("{API_BASE}/upload/drive/v3/files"),
                &[("uploadType", "multipart"), ("fields", FIELDS)],
                Body::Raw(format!("multipart/related; boundary={boundary}"), body),
            )
            .await?
        }
    };
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(DriveFile::from(&v))
}

/// Moves a file Questline created to the Drive bin (used to prune old backups).
#[tauri::command]
pub async fn drive_trash(app: AppHandle, id: String) -> Result<(), String> {
    check_id(&id)?;
    call(
        &app,
        reqwest::Method::PATCH,
        &format!("{API_BASE}/drive/v3/files/{id}"),
        &[("fields", "id")],
        Body::Json(json!({ "trashed": true })),
    )
    .await
    .map(|_| ())
}
