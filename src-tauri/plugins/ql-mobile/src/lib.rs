//! Questline's phone bridge. The Kotlin side (android/) does what only Android
//! can: Google sign-in through Google Play services, haptics, system-bar
//! colours, the back button, and handing a downloaded APK to the installer.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Handle for calling the Kotlin plugin from Rust (Android only).
#[cfg(target_os = "android")]
pub struct QlMobile<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ql-mobile")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("com.questline.mobile", "QuestlinePlugin")?;
                _app.manage(QlMobile(handle));
            }
            Ok(())
        })
        .build()
}
