//! Spotify control via Windows' Global System Media Transport Controls.
//!
//! Every media app on Windows registers a "session" (the same thing the volume
//! flyout shows). We pick only the session whose AppUserModelId contains
//! "spotify", so other players (browser tabs, VLC…) are ignored.
//!
//! Why not the Spotify Web API? Its playback-control endpoints require
//! Spotify Premium plus an OAuth app; GSMTC works with the free tier, needs
//! no keys, and talks to the desktop app directly.

use serde::Serialize;

#[derive(Serialize, Default, Clone, Debug)]
pub struct MediaState {
    /// A Spotify session exists (the desktop app is running).
    pub available: bool,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub position_ms: u64,
    pub duration_ms: u64,
    /// Unix ms when Spotify last reported the position (UI extrapolates).
    pub updated_ms: u64,
    /// Changes whenever the track changes; fetch art with `spotify_art`.
    pub art_key: String,
    pub can_next: bool,
    pub can_prev: bool,
    pub can_seek: bool,
    pub shuffle: Option<bool>,
    /// Where it's playing (Web API only), e.g. "Spotifast" or "iPhone".
    #[serde(default)]
    pub device: String,
}

#[tauri::command]
pub async fn spotify_state() -> MediaState {
    tauri::async_runtime::spawn_blocking(imp::state)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn spotify_art() -> Option<String> {
    imp::art()
}

/// action: "toggle" | "next" | "prev" | "seek" (value = ms) | "shuffle" (value = 0/1)
#[tauri::command]
pub async fn spotify_control(action: String, value: Option<f64>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || imp::control(&action, value))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod imp {
    use super::MediaState;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use std::sync::Mutex;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Props,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    /// (art_key, data URL) of the last track, so artwork is read once per track.
    static ART: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

    /// 100 ns ticks between 1601-01-01 and 1970-01-01.
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;

    fn com() {
        // Worker threads join the multithreaded apartment; repeat calls are harmless.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn session() -> windows::core::Result<Option<Session>> {
        let mgr = Manager::RequestAsync()?.get()?;
        let sessions = mgr.GetSessions()?;
        for i in 0..sessions.Size()? {
            let s = sessions.GetAt(i)?;
            if let Ok(id) = s.SourceAppUserModelId() {
                if id.to_string().to_ascii_lowercase().contains("spotify") {
                    return Ok(Some(s));
                }
            }
        }
        Ok(None)
    }

    fn read_art(props: &Props) -> Option<String> {
        let reference = props.Thumbnail().ok()?;
        let stream = reference.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 || size > 4_000_000 {
            return None;
        }
        let input = stream.GetInputStreamAt(0).ok()?;
        let reader = DataReader::CreateDataReader(&input).ok()?;
        reader.LoadAsync(size).ok()?.get().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;
        let ct = stream.ContentType().map(|h| h.to_string()).unwrap_or_default();
        let mime = if ct.starts_with("image/") { ct } else { "image/jpeg".to_string() };
        Some(format!("data:{mime};base64,{}", STANDARD.encode(&buf)))
    }

    fn read_state() -> windows::core::Result<MediaState> {
        let Some(s) = session()? else {
            return Ok(MediaState::default());
        };
        let mut st = MediaState { available: true, ..Default::default() };

        if let Ok(info) = s.GetPlaybackInfo() {
            st.playing = info.PlaybackStatus().map(|p| p == Status::Playing).unwrap_or(false);
            if let Ok(c) = info.Controls() {
                st.can_next = c.IsNextEnabled().unwrap_or(false);
                st.can_prev = c.IsPreviousEnabled().unwrap_or(false);
                st.can_seek = c.IsPlaybackPositionEnabled().unwrap_or(false);
            }
            st.shuffle = info.IsShuffleActive().ok().and_then(|r| r.Value().ok());
        }
        if let Ok(tl) = s.GetTimelineProperties() {
            let pos = tl.Position().map(|t| t.Duration).unwrap_or(0).max(0);
            let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0).max(0);
            st.position_ms = (pos / 10_000) as u64;
            st.duration_ms = (end / 10_000) as u64;
            if let Ok(dt) = tl.LastUpdatedTime() {
                let ms = (dt.UniversalTime - EPOCH_DIFF) / 10_000;
                st.updated_ms = ms.max(0) as u64;
            }
        }
        if let Ok(props) = s.TryGetMediaPropertiesAsync()?.get() {
            st.title = props.Title().map(|h| h.to_string()).unwrap_or_default();
            st.artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
            st.album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
            st.art_key = format!("{}|{}|{}", st.title, st.artist, st.album);
            let mut cache = ART.lock().unwrap_or_else(|p| p.into_inner());
            let stale = cache.as_ref().map(|(k, _)| k != &st.art_key).unwrap_or(true);
            if stale {
                *cache = Some((st.art_key.clone(), read_art(&props)));
            }
        }
        Ok(st)
    }

    pub fn state() -> MediaState {
        com();
        read_state().unwrap_or_default()
    }

    pub fn art() -> Option<String> {
        ART.lock().ok()?.as_ref()?.1.clone()
    }

    pub fn control(action: &str, value: Option<f64>) -> Result<bool, String> {
        com();
        let s = session()
            .map_err(|e| e.to_string())?
            .ok_or("Spotify isn't running.")?;
        let op = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "prev" => s.TrySkipPreviousAsync(),
            "seek" => {
                let ms = value.unwrap_or(0.0).max(0.0) as i64;
                s.TryChangePlaybackPositionAsync(ms * 10_000)
            }
            "shuffle" => s.TryChangeShuffleActiveAsync(value.unwrap_or(0.0) > 0.5),
            other => return Err(format!("Unknown action {other}")),
        };
        op.and_then(|o| o.get()).map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::MediaState;
    pub fn state() -> MediaState {
        MediaState::default()
    }
    pub fn art() -> Option<String> {
        None
    }
    pub fn control(_action: &str, _value: Option<f64>) -> Result<bool, String> {
        Err("Spotify control uses Windows media sessions and is only available on Windows.".into())
    }
}
