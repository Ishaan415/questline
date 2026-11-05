'use strict';
/*
 * Platform bridge. Inside the app (Tauri, on Windows or Android) this calls the
 * Rust side. In a browser it falls back to localStorage and the Notification
 * API; the web app (GitHub Pages) also gets Google, Drive and Spotify from
 * web.js, while the preview (sample data) gets a demo Spotify player instead.
 * Add ?phone to the address to see the phone layout.
 */

Q.platform = (() => {
  const T = window.__TAURI__;
  const isApp = !!(T && T.core && T.core.invoke);
  const isAndroid = isApp && /Android/i.test(navigator.userAgent);
  /** The browser version on GitHub Pages: real data, Google sign-in through web.js. */
  const isWeb = !isApp && !!(Q.web && Q.web.on);
  /** The preview with sample data (neither the app nor the web app). */
  const isDemo = !isApp && !isWeb;
  let phonePreview = false;
  try { phonePreview = !isApp && (/[?&#]phone\b/.test(location.search + location.hash) || !!window.QUESTLINE_PHONE); } catch (e) { /* sandboxed */ }
  // The web app on a phone (or a small window on a touch screen) gets the phone layout.
  let webPhone = false;
  try {
    const short = Math.min(screen.width, screen.height);
    webPhone = isWeb && (matchMedia('(max-width: 700px)').matches || (matchMedia('(pointer: coarse)').matches && short < 600));
  } catch (e) { /* no matchMedia */ }
  /** Phone layout: the Android app, a phone browser, or ?phone. */
  const isPhone = isAndroid || phonePreview || webPhone;
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  /** What to call this device in messages. */
  const deviceName = isPhone ? 'phone' : isWeb ? 'browser' : 'PC';
  const LS_KEY = 'questline-save-v1';

  const invoke = (cmd, args = {}) => (isApp ? T.core.invoke(cmd, args) : isWeb ? Q.web.invoke(cmd, args) : Promise.reject(new Error('Only available in the desktop app')));
  const listen = (ev, cb) => (isApp ? T.event.listen(ev, (e) => cb(e.payload)) : Promise.resolve(() => {}));
  const win = () => (isApp && T.window ? T.window.getCurrentWindow() : null);

  /* ---------- storage ---------- */
  async function load() {
    if (isApp) return invoke('load_state');
    try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
  }
  let storageWarned = false;
  async function save(json, day) {
    if (isApp) return invoke('save_state', { json, day });
    if (isWeb && Q.web.paused) return; // another tab has Questline now
    try { localStorage.setItem(LS_KEY, json); } catch (e) {
      // Storage full or blocked: say so once (the preview just runs for this session).
      if (isWeb && !storageWarned && Q.ui && Q.ui.toast) { storageWarned = true; Q.ui.toast('This browser won\'t let Questline save. Free up space or leave private browsing, and sign in with Google so Drive keeps a copy.', { kind: 'error', timeout: 15000 }); }
    }
  }
  /** Side files next to the save (only fixed names, e.g. 'sync-base'). */
  async function loadExtra(name) {
    if (isApp) return invoke('load_extra', { name });
    try { return localStorage.getItem(`questline-${name}`); } catch (e) { return null; }
  }
  async function saveExtra(name, json) {
    if (isApp) return invoke('save_extra', { name, json });
    if (isWeb && Q.web.paused) return;
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
            if (isWeb && Q.web.paused) continue;
            if (!a.silent && now > pausedUntil && 'Notification' in window && Notification.permission === 'granted') browserNotify(a.title, a.body);
            Q.app && Q.app.onAlarm(a);
          }
        }
      }, 10000);
    }
  }
  /** Phone browsers only show notifications through the service worker. */
  function browserNotify(title, body) {
    const icon = 'icon-192.png';
    if (isWeb && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, icon, tag: `ql-${title}` })).catch(() => {});
      return;
    }
    try { new Notification(title, { body }); } catch (e) { /* ignore */ }
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
    if ((phonePreview || webPhone) && navigator.vibrate) { try { navigator.vibrate(kind === 'tap' ? 6 : kind === 'error' ? [20, 40, 20] : 18); } catch (e) { /* ignore */ } }
  }
  /** Android focus mode: hide the system bars and use the whole screen, cutout included. */
  function setImmersive(on) {
    if (isAndroid) invoke('plugin:ql-mobile|set_immersive', { on: !!on }).catch(() => {});
    if (!on) document.documentElement.style.removeProperty('--ql-inset-l');
  }
  /** Hold the screen in 'portrait' or 'landscape' (focus mode); 'auto' follows the phone. */
  function setOrientation(mode) {
    if (isAndroid) { invoke('plugin:ql-mobile|set_orientation', { mode }).catch(() => {}); return; }
    try {
      if (mode === 'auto') screen.orientation && screen.orientation.unlock && screen.orientation.unlock();
      else if (screen.orientation && screen.orientation.lock) screen.orientation.lock(mode).catch(() => {});
    } catch (e) { /* browsers only allow this in full screen */ }
  }
  /** Colour Android's status and navigation bars (or the browser's bar) to match the theme. */
  function setBars(color, dark) {
    if (isAndroid) invoke('plugin:ql-mobile|set_bars', { color, dark: !!dark }).catch(() => {});
    // The web app: the browser's own bar (and an installed app's title bar) takes the colour too.
    if (isWeb && color) { const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = color; }
  }

  const autostart = {
    get: () => (isApp ? invoke('plugin:autostart|is_enabled') : Promise.resolve(false)),
    set: (on) => (isApp ? invoke(on ? 'plugin:autostart|enable' : 'plugin:autostart|disable') : Promise.resolve()),
  };

  return {
    isApp, isAndroid, isWeb, isDemo, isIos, isPhone, deviceName, haptic, setBars, setOrientation, setImmersive, invoke, listen, load, save, loadExtra, saveExtra, clearBrowserSave, win: w, setAlarms, setNotifyPause, askNotifyPermission,
    openExternal, autostart,
    ready: () => (isApp ? invoke('app_ready') : Promise.resolve()),
    setCloseToTray: (on) => isApp && invoke('set_close_to_tray', { enabled: !!on }),
    setTrayTooltip: (text) => isApp && invoke('set_tray_tooltip', { text }).catch(() => {}),
  };
})();
