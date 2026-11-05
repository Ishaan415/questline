// Only these commands can be called from the page. Sign-in tokens and
// installing updates go through Rust (run_mobile_plugin), never the page.
const COMMANDS: &[&str] = &["haptic", "set_bars", "set_orientation", "set_immersive", "widget_update", "widget_take"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
