//! Notification scheduler.
//!
//! The UI computes the next ~48 h of alarms (dailies, reminders, events) and
//! hands them over with `set_alarms` whenever data changes. A single thread
//! wakes every few seconds and fires due ones. Doing this natively means
//! notifications stay on time even when the hidden webview is throttled.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Alarm {
    /// Unique per firing, e.g. "rem:abc:15" (reminder abc, 15 min before).
    pub id: String,
    /// Unix epoch milliseconds.
    pub at: u64,
    pub title: String,
    pub body: String,
    /// Show in-app only (quiet hours, focus mode).
    #[serde(default)]
    pub silent: bool,
}

static ALARMS: Mutex<Vec<Alarm>> = Mutex::new(Vec::new());
static FIRED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static PAUSED_UNTIL: AtomicU64 = AtomicU64::new(0);

/// Alarms older than this when first noticed (e.g. PC was asleep) are dropped
/// instead of producing a burst of stale notifications.
const STALE_MS: u64 = 15 * 60 * 1000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn pause_for_minutes(min: u64) {
    let until = if min == 0 { 0 } else { now_ms() + min * 60_000 };
    PAUSED_UNTIL.store(until, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_alarms(alarms: Vec<Alarm>) {
    if let Ok(mut a) = ALARMS.lock() {
        *a = alarms;
    }
}

#[tauri::command]
pub fn set_notify_pause(until_ms: u64) {
    PAUSED_UNTIL.store(until_ms, Ordering::SeqCst);
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        tick(&app);
        std::thread::sleep(Duration::from_secs(5));
    });
}

fn tick(app: &AppHandle) {
    let now = now_ms();
    let due: Vec<Alarm> = {
        let Ok(list) = ALARMS.lock() else { return };
        let Ok(mut fired_guard) = FIRED.lock() else { return };
        let fired = fired_guard.get_or_insert_with(HashSet::new);
        let mut out = Vec::new();
        for a in list.iter() {
            if a.at <= now && !fired.contains(&a.id) {
                fired.insert(a.id.clone());
                if now - a.at <= STALE_MS {
                    out.push(a.clone());
                }
            }
        }
        // Forget fired ids that are no longer scheduled, so memory stays flat.
        let live: HashSet<&String> = list.iter().map(|a| &a.id).collect();
        fired.retain(|id| live.contains(id));
        out
    };

    let paused = PAUSED_UNTIL.load(Ordering::SeqCst) > now;
    for a in due {
        if !a.silent && !paused {
            let _ = app
                .notification()
                .builder()
                .title(&a.title)
                .body(&a.body)
                .show();
        }
        // The UI shows an in-app toast with Done / Snooze buttons and plays a chime.
        let _ = app.emit("alarm", &a);
    }
}
