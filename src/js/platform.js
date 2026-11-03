'use strict';
/*
 * Platform bridge. Inside the app (Tauri, on Windows or Android) this calls the
 * Rust side; in a plain browser (the web preview) it falls back to localStorage,
 * the Notification API and a demo Spotify player, so the same UI runs in both.
 * Add ?phone to the preview's address to see the phone layout.
 */

Q.platform = (() => {
  const T = window.__TAURI__;
  const isApp = !!(T && T.core && T.core.invoke);
  const isAndroid = isApp && /Android/i.test(navigator.userAgent);
  let phonePreview = false;
  try { phonePreview = !isApp && (/[?&#]phone\b/.test(location.search + location.hash) || !!window.QUESTLINE_PHONE); } catch (e) { /* sandboxed */ }
  /** Phone layout: the Android app, or the preview with ?phone. */
  const isPhone = isAndroid || phonePreview;
  /** What to call this device in messages. */
  const deviceName = isPhone ? 'phone' : 'PC';
  const LS_KEY = 'questline-save-v1';

  const invoke = (cmd, args = {}) => (isApp ? T.core.invoke(cmd, args) : Promise.reject(new Error('Only available in the desktop app')));
  const listen = (ev, cb) => (isApp ? T.event.listen(ev, (e) => cb(e.payload)) : Promise.resolve(() => {}));
  const win = () => (isApp && T.window ? T.window.getCurrentWindow() : null);

  /* ---------- storage ---------- */
  async function load() {
    if (isApp) return invoke('load_state');
    try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
  }
  async function save(json, day) {
    if (isApp) return invoke('save_state', { json, day });
    try { localStorage.setItem(LS_KEY, json); } catch (e) { /* storage unavailable: session-only */ }
  }
  /** Side files next to the save (only fixed names, e.g. 'sync-base'). */
  async function loadExtra(name) {
    if (isApp) return invoke('load_extra', { name });
    try { return localStorage.getItem(`questline-${name}`); } catch (e) { return null; }
  }
  async function saveExtra(name, json) {
    if (isApp) return invoke('save_extra', { name, json });
    try { localStorage.setItem(`questline-${name}`, json); } catch (e) { /* ignore */ }
  }
  function clearBrowserSave() { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } }

  /* ---------- window ---------- */
  const w = {
    minimize: () => win()?.minimize(),
    toggleMax: () => win()?.toggleMaximize(),
    hide: () => (isApp ? invoke('hide_main') : null),
    quit: () => (isApp ? invoke('quit_app') : null),
    async setFullscreen(on) {
      if (isAndroid) return undefined; // the phone app is already full screen
      if (isApp) return win()?.setFullscreen(on);
      try {
        if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
        if (!on && document.fullscreenElement) await document.exitFullscreen();
      } catch (e) { /* fullscreen not allowed here; focus mode still works in-window */ }
    },
    async setMini(on) {
      const ww = win();
      if (!ww) return;
      const LogicalSize = (T.dpi && T.dpi.LogicalSize) || T.window.LogicalSize;
      await ww.setAlwaysOnTop(on);
      if (on) { await ww.setSize(new LogicalSize(380, 600)); }
      else { await ww.setSize(new LogicalSize(1320, 840)); await ww.center(); }
    },
  };

  /* ---------- alarms / notifications ---------- */
  let browserAlarms = [];
  let fired = new Set();
  let browserTimer = null;
  let pausedUntil = 0;
  function setAlarms(list) {
    if (isApp) return invoke('set_alarms', { alarms: list }).catch(() => {});
    browserAlarms = list;
    if (!browserTimer) {
      browserTimer = setInterval(() => {
        const now = Date.now();
        for (const a of browserAlarms) {
          if (a.at <= now && !fired.has(a.id)) {
            fired.add(a.id);
            if (now - a.at > 15 * 60000) continue;
            if (!a.silent && now > pausedUntil && 'Notification' in window && Notification.permission === 'granted') {
              try { new Notification(a.title, { body: a.body }); } catch (e) { /* ignore */ }
            }
            Q.app && Q.app.onAlarm(a);
          }
        }
      }, 10000);
    }
  }
  function setNotifyPause(untilMs) {
    pausedUntil = untilMs;
    if (isApp) invoke('set_notify_pause', { untilMs }).catch(() => {});
  }
  async function askNotifyPermission() {
    // Android 13+ asks once; older phones and Windows just allow it.
    if (isAndroid) {
      try { return (await invoke('plugin:notification|request_permission')) === 'granted'; } catch (e) { return false; }
    }
    if (isApp) return true;
    if (!('Notification' in window)) return false;
    try { return (await Notification.requestPermission()) === 'granted'; } catch (e) { return false; }
  }

  /* ---------- misc ---------- */
  function openExternal(url) {
    if (isApp) return invoke('open_external', { url }).catch((e) => Q.ui.toast(String(e), { kind: 'error' }));
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  /* ---------- phone ---------- */
  /** Vibration feedback: 'tap' (light), 'success', 'error', 'heavy'. */
  function haptic(kind = 'tap') {
    if (isAndroid) { invoke('plugin:ql-mobile|haptic', { kind }).catch(() => {}); return; }
    if (phonePreview && navigator.vibrate) { try { navigator.vibrate(kind === 'tap' ? 6 : kind === 'error' ? [20, 40, 20] : 18); } catch (e) { /* ignore */ } }
  }
  /** Hold the screen in 'portrait' or 'landscape' (focus mode); 'auto' follows the phone. */
  function setOrientation(mode) {
    if (isAndroid) { invoke('plugin:ql-mobile|set_orientation', { mode }).catch(() => {}); return; }
    try {
      if (mode === 'auto') screen.orientation && screen.orientation.unlock && screen.orientation.unlock();
      else if (screen.orientation && screen.orientation.lock) screen.orientation.lock(mode).catch(() => {});
    } catch (e) { /* browsers only allow this in full screen */ }
  }
  /** Colour Android's status and navigation bars to match the theme. */
  function setBars(color, dark) {
    if (isAndroid) invoke('plugin:ql-mobile|set_bars', { color, dark: !!dark }).catch(() => {});
  }

  const autostart = {
    get: () => (isApp ? invoke('plugin:autostart|is_enabled') : Promise.resolve(false)),
    set: (on) => (isApp ? invoke(on ? 'plugin:autostart|enable' : 'plugin:autostart|disable') : Promise.resolve()),
  };

  return {
    isApp, isAndroid, isPhone, deviceName, haptic, setBars, setOrientation, invoke, listen, load, save, loadExtra, saveExtra, clearBrowserSave, win: w, setAlarms, setNotifyPause, askNotifyPermission,
    openExternal, autostart,
    ready: () => (isApp ? invoke('app_ready') : Promise.resolve()),
    setCloseToTray: (on) => isApp && invoke('set_close_to_tray', { enabled: !!on }),
    setTrayTooltip: (text) => isApp && invoke('set_tray_tooltip', { text }).catch(() => {}),
  };
})();
