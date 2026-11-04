//! "Open Spotify" on Windows.
//!
//! Opening the bare `spotify:` link starts Spotify when it's closed. When it is
//! already running, Windows hands that empty link to the running copy, which
//! ignores it, so its window never comes forward. So instead:
//!
//! 1. Spotify's window is open (or minimised): restore it and bring it to the front.
//! 2. Spotify runs but is hidden in the tray: start its .exe again; the running
//!    copy then shows its window (same as clicking it in the Start menu).
//! 3. Not running: the caller opens `spotify:` and Windows starts it.

#[cfg(windows)]
mod imp {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, BOOL, FALSE, HWND, LPARAM, TRUE};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, BringWindowToTop, EnumWindows, GetClassNameW, GetWindow, GetWindowTextLengthW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, ASFW_ANY, GW_OWNER,
        SW_RESTORE, SW_SHOW,
    };

    #[derive(Default)]
    struct Found {
        window: Option<HWND>,
        exe: Option<String>,
    }

    /// Full path of the program that owns this window.
    fn exe_of(hwnd: HWND) -> Option<String> {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return None;
        }
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let res = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) };
        unsafe {
            let _ = CloseHandle(process);
        }
        res.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }

    unsafe extern "system" fn each_window(hwnd: HWND, data: LPARAM) -> BOOL {
        let found = &mut *(data.0 as *mut Found);
        // Main app windows only: no owner window and a title.
        if matches!(GetWindow(hwnd, GW_OWNER), Ok(owner) if !owner.is_invalid()) {
            return TRUE;
        }
        if GetWindowTextLengthW(hwnd) == 0 {
            return TRUE;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(hwnd, &mut class).max(0) as usize;
        if !String::from_utf16_lossy(&class[..n]).starts_with("Chrome_WidgetWin") {
            return TRUE;
        }
        let Some(exe) = exe_of(hwnd) else { return TRUE };
        if !exe.to_ascii_lowercase().ends_with("\\spotify.exe") {
            return TRUE;
        }
        found.exe.get_or_insert(exe);
        if IsWindowVisible(hwnd).as_bool() {
            found.window = Some(hwnd);
            return FALSE; // stop: this is the one
        }
        TRUE
    }

    /// True when Spotify was running and has been brought forward.
    pub fn bring_to_front() -> bool {
        let mut found = Found::default();
        unsafe {
            // Returns an error when the callback stops early; that's expected.
            let _ = EnumWindows(Some(each_window), LPARAM(&mut found as *mut Found as isize));
        }
        if let Some(hwnd) = found.window {
            unsafe {
                let _ = ShowWindow(hwnd, if IsIconic(hwnd).as_bool() { SW_RESTORE } else { SW_SHOW });
                let _ = BringWindowToTop(hwnd);
                let _ = SetForegroundWindow(hwnd);
            }
            return true;
        }
        if let Some(exe) = found.exe {
            // Hidden in the tray: let the new process hand focus to the running one.
            unsafe {
                let _ = AllowSetForegroundWindow(ASFW_ANY);
            }
            return std::process::Command::new(exe).spawn().is_ok();
        }
        false
    }
}

#[cfg(windows)]
pub use imp::bring_to_front;

/// Other platforms open the `spotify:` link directly.
#[cfg(not(windows))]
pub fn bring_to_front() -> bool {
    false
}
