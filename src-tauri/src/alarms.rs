//! Notification scheduler.
//!
//! The UI computes the next ~48 h of alarms (dailies, reminders, events) and
//! hands them over with `set_alarms` whenever data changes. A single thread
//! wakes every few seconds and fires due ones. Doing this natively means
//! notifications stay on time even when the hidden webview is throttled.
//!
//! On Android the app can be closed at any time, so the same alarms are also
//! handed to Android's alarm clock (scheduled notifications) and arrive even
//! when Questline isn't open. The thread then only drives the in-app toasts.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
pub fn set_alarms(app: AppHandle, alarms: Vec<Alarm>) {
    if let Ok(mut a) = ALARMS.lock() {
        *a = alarms;
    }
    phone_resync(app);
}

#[tauri::command]
pub fn set_notify_pause(app: AppHandle, until_ms: u64) {
    PAUSED_UNTIL.store(until_ms, Ordering::SeqCst);
    phone_resync(app);
}

// ------------------------------------------------------------ phone scheduling

/// Same text and time → same id, so rescheduling replaces instead of duplicating.
fn notif_id(key: &str) -> i32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in key.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    ((h & 0x7fff_ffff) as i32).max(1)
}

fn alarm_key(a: &Alarm) -> String {
    format!("{}|{}|{}|{}", a.id, a.at, a.title, a.body)
}

/// What should be scheduled with Android right now: future, not silent, and not
/// inside a "pause notifications" window.
#[cfg_attr(not(mobile), allow(dead_code))]
fn wanted(list: &[Alarm], now: u64, paused_until: u64) -> HashMap<String, (i32, Alarm)> {
    list.iter()
        .filter(|a| !a.silent && a.at > now + 2_000 && a.at > paused_until)
        .map(|a| {
            let k = alarm_key(a);
            (k.clone(), (notif_id(&k), a.clone()))
        })
        .collect()
}

#[cfg(mobile)]
fn phone_resync(app: AppHandle) {
    use tauri_plugin_notification::Schedule;

    /// key → notification id, as scheduled by this run of the app.
    static SCHEDULED: Mutex<Option<HashMap<String, i32>>> = Mutex::new(None);
    /// One resync at a time, off the main thread (the plugin call blocks).
    static WORKER: Mutex<()> = Mutex::new(());

    std::thread::spawn(move || {
        let Ok(_one) = WORKER.lock() else { return };
        let list = ALARMS.lock().map(|a| a.clone()).unwrap_or_default();
        let want = wanted(&list, now_ms(), PAUSED_UNTIL.load(Ordering::SeqCst));
        let Ok(mut guard) = SCHEDULED.lock() else { return };
        let first_run = guard.is_none();
        let sched = guard.get_or_insert_with(HashMap::new);
        let keep: HashSet<i32> = want.values().map(|(id, _)| *id).collect();

        // After a restart we don't remember what was scheduled: ask Android.
        let mut cancel: Vec<i32> = if first_run {
            app.notification()
                .pending()
                .map(|p| p.iter().map(|n| n.id()).filter(|id| !keep.contains(id)).collect())
                .unwrap_or_default()
        } else {
            sched.iter().filter(|(k, _)| !want.contains_key(*k)).map(|(_, id)| *id).collect()
        };
        cancel.sort_unstable();
        cancel.dedup();
        if !cancel.is_empty() {
            let _ = app.notification().cancel(cancel);
        }
        sched.retain(|k, _| want.contains_key(k));

        for (k, (id, a)) in want {
            if sched.contains_key(&k) {
                continue;
            }
            let Ok(date) = time::OffsetDateTime::from_unix_timestamp_nanos(a.at as i128 * 1_000_000) else {
                continue;
            };
            let shown = app
                .notification()
                .builder()
                .id(id)
                .title(&a.title)
                .body(&a.body)
                .schedule(Schedule::At { date, repeating: false, allow_while_idle: true })
                .show();
            if shown.is_ok() {
                sched.insert(k, id);
            }
        }
    });
}

#[cfg(not(mobile))]
fn phone_resync(_app: AppHandle) {}

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
        // On phones Android already showed it (scheduled in phone_resync).
        if !a.silent && !paused && cfg!(not(mobile)) {
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
