//! Save file + rolling daily backups in the app data folder
//! (%APPDATA%\com.questline.app on Windows).

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// `npm run dev` builds use their own save file, so experiments never touch
/// the data of the installed app.
#[cfg(debug_assertions)]
const SAVE_FILE: &str = "questline-save-dev.json";
#[cfg(not(debug_assertions))]
const SAVE_FILE: &str = "questline-save.json";
const KEEP_BACKUPS: usize = 14;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid_day(day: &str) -> bool {
    day.len() == 10
        && day.chars().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == '-'
            } else {
                c.is_ascii_digit()
            }
        })
}

#[tauri::command]
pub fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(SAVE_FILE);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic write (temp file + rename) so a crash can never corrupt the save.
/// The first save of each day also copies the file into backups/.
#[tauri::command]
pub fn save_state(app: AppHandle, json: String, day: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let path = dir.join(SAVE_FILE);
    let tmp = dir.join(format!("{SAVE_FILE}.tmp"));
    fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;

    if valid_day(&day) {
        let bdir = dir.join(if cfg!(debug_assertions) { "backups-dev" } else { "backups" });
        fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
        let bfile = bdir.join(format!("questline-{day}.json"));
        if !bfile.exists() {
            let _ = fs::copy(&path, &bfile);
            prune_backups(&bdir);
        }
    }
    Ok(())
}

fn prune_backups(bdir: &PathBuf) {
    let Ok(rd) = fs::read_dir(bdir) else { return };
    let mut files: Vec<PathBuf> = rd
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("questline-") && n.ends_with(".json"))
                .unwrap_or(false)
        })
        .collect();
    // File names embed YYYY-MM-DD, so lexical order is chronological.
    files.sort();
    while files.len() > KEEP_BACKUPS {
        let old = files.remove(0);
        let _ = fs::remove_file(old);
    }
}

/// Writes a copy of the save into the Downloads folder and returns its path.
#[tauri::command]
pub fn export_backup(app: AppHandle, json: String, stamp: String) -> Result<String, String> {
    let safe: String = stamp
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(32)
        .collect();
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| data_dir(&app))
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!("questline-export-{safe}.json"));
    fs::write(&path, json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    tauri_plugin_opener::open_path(dir, None::<&str>).map_err(|e| e.to_string())
}
