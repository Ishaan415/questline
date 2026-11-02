'use strict';
/*
 * Platform bridge. Inside the desktop app (Tauri) this calls the Rust side;
 * in a plain browser (the web preview) it falls back to localStorage, the
 * Notification API and a demo Spotify player, so the same UI runs in both.
 */

Q.platform = (() => {
  const T = window.__TAURI__;
  const isApp = !!(T && T.core && T.core.invoke);
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
  function clearBrowserSave() { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } }

  /* ---------- window ---------- */
  const w = {
    minimize: () => win()?.minimize(),
    toggleMax: () => win()?.toggleMaximize(),
    hide: () => (isApp ? invoke('hide_main') : null),
    quit: () => (isApp ? invoke('quit_app') : null),
    async setFullscreen(on) {
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
  const autostart = {
    get: () => (isApp ? invoke('plugin:autostart|is_enabled') : Promise.resolve(false)),
    set: (on) => (isApp ? invoke(on ? 'plugin:autostart|enable' : 'plugin:autostart|disable') : Promise.resolve()),
  };

  return {
    isApp, invoke, listen, load, save, clearBrowserSave, win: w, setAlarms, setNotifyPause, askNotifyPermission,
    openExternal, autostart,
    ready: () => (isApp ? invoke('app_ready') : Promise.resolve()),
    setCloseToTray: (on) => isApp && invoke('set_close_to_tray', { enabled: !!on }),
    setTrayTooltip: (text) => isApp && invoke('set_tray_tooltip', { text }).catch(() => {}),
  };
})();
