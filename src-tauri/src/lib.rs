//! Questline native shell.
//!
//! The UI (HTML/CSS/JS in ../src) owns all game logic and data. This crate
//! only provides what a web page can't do on its own:
//!   * tray icon, close-to-tray, single instance, autostart, global hotkeys
//!   * a tiny alarm thread so notifications fire even while the window is hidden
//!   * file storage with daily rolling backups
//!   * Google Calendar OAuth (loopback + PKCE) and a scoped API proxy
//!   * Spotify control through Windows' system media sessions (GSMTC), with the
//!     Spotify Web API as a fallback for other players (Spotifast, phone…)
//!   * self-updates from GitHub Releases (signed)

mod alarms;
mod google;
mod media;
mod secure;
mod spotify_web;
mod storage;
mod updater;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// When true, the window's close button hides to tray instead of quitting.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);
/// Set when the app was launched by autostart with `--minimized`.
static START_HIDDEN: AtomicBool = AtomicBool::new(false);

const TRAY_ID: &str = "questline-tray";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

/// Show the window and ask the UI to perform an action (quick add, focus...).
fn show_and_emit(app: &AppHandle, action: &str) {
    show_main(app);
    let _ = app.emit("tray-action", action.to_string());
}

// ---------------------------------------------------------------- commands

/// Called by the UI once it has rendered, so the window never flashes blank.
#[tauri::command]
fn app_ready(app: AppHandle) {
    if !START_HIDDEN.swap(false, Ordering::SeqCst) {
        show_main(&app);
    }
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(text));
    }
}

#[tauri::command]
fn hide_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Open an external link. Only web links and the Spotify app are allowed.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let ok = url.starts_with("https://") || url == "spotify:" || url.starts_with("spotify:");
    if !ok {
        return Err("Only https:// and spotify: links can be opened.".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

// --------------------------------------------------------------------- run

pub fn run() {
    if std::env::args().any(|a| a == "--minimized") {
        START_HIDDEN.store(true, Ordering::SeqCst);
    }

    let quick_add = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyQ);
    let focus_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyF);
    let toggle_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);

    tauri::Builder::default()
        // Must be registered first: a second launch just focuses the first one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &quick_add {
                        show_and_emit(app, "quick-add");
                    } else if shortcut == &focus_key {
                        show_and_emit(app, "focus");
                    } else if shortcut == &toggle_key {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();

            // Hotkeys: failure (e.g. another app owns the combo) is not fatal.
            for sc in [quick_add, focus_key, toggle_key] {
                if let Err(e) = app.global_shortcut().register(sc) {
                    eprintln!("hotkey registration failed: {e}");
                }
            }

            // ---- tray
            let open = MenuItem::with_id(app, "open", "Open Questline", true, None::<&str>)?;
            let add = MenuItem::with_id(app, "quick-add", "Quick add…   Ctrl+Alt+Q", true, None::<&str>)?;
            let focus = MenuItem::with_id(app, "focus", "Start focus   Ctrl+Alt+F", true, None::<&str>)?;
            let mini = MenuItem::with_id(app, "mini", "Mini window", true, None::<&str>)?;
            let snooze = MenuItem::with_id(app, "snooze-last", "Snooze last reminder 10 min", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause-1h", "Pause notifications for 1 hour", true, None::<&str>)?;
            let resume = MenuItem::with_id(app, "resume", "Resume notifications", true, None::<&str>)?;
            let updates = MenuItem::with_id(app, "check-updates", "Check for updates", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&open, &add, &focus, &mini, &sep1, &snooze, &pause, &resume, &sep2, &updates, &quit],
            )?;

            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("Questline")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    "pause-1h" => {
                        alarms::pause_for_minutes(60);
                        let _ = app.emit("tray-action", "paused");
                    }
                    "resume" => {
                        alarms::pause_for_minutes(0);
                        let _ = app.emit("tray-action", "resumed");
                    }
                    // Snoozing needs the UI's data, but not a visible window.
                    "snooze-last" => {
                        let _ = app.emit("tray-action", "snooze-last");
                    }
                    other => show_and_emit(app, other),
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // ---- background alarm thread (notifications while hidden)
            alarms::start(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            set_close_to_tray,
            set_tray_tooltip,
            hide_main,
            quit_app,
            open_external,
            storage::load_state,
            storage::save_state,
            storage::export_backup,
            storage::open_data_dir,
            alarms::set_alarms,
            alarms::set_notify_pause,
            google::google_connect,
            google::google_status,
            google::google_disconnect,
            google::google_api,
            google::fetch_ics,
            media::spotify_state,
            media::spotify_art,
            media::spotify_control,
            spotify_web::spotify_web_connect,
            spotify_web::spotify_web_status,
            spotify_web::spotify_web_disconnect,
            spotify_web::spotify_web_state,
            spotify_web::spotify_web_art,
            spotify_web::spotify_web_control,
            updater::update_check,
            updater::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Questline");
}
