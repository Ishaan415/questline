'use strict';
/*
 * Spotify widget, hybrid:
 *  1. "local": the official Spotify desktop app via Windows media sessions.
 *     Instant, offline, no login. Used whenever it is the one playing.
 *  2. "web": the Spotify Web API (optional sign-in, Premium). Sees whatever
 *     your account plays anywhere: Spotifast, phone, web player. Used when the
 *     desktop app isn't playing.
 * Browser preview: a demo player. Polls only while a widget is visible.
 */

Q.spotify = (() => {
  const U = Q.util;
  const P = Q.platform;
  let state = { available: false };
  let art = null;
  let artKey = '';
  let pollTimer = null;
  let tickTimer = null;
  let lastFetch = 0;
  let source = 'local';       // which backend the widget is showing
  let webState = null;        // last Web API answer
  let lastWeb = 0;            // when we last asked the Web API
  const WEB_EVERY = 2400;     // ms between Web API calls (rate-limit friendly)
  let volHold = 0;            // until then, keep the volume you just set (polls may still report the old one)
  let volWanted = null;
  let volTimer = null;
  let lastVol = 60;           // restored when you un-mute
  const webOn = () => P.isApp && Q.store.state.settings.spotify && Q.store.state.settings.spotify.webConnected;

  /* ---------- demo player (preview only) ---------- */
  const DEMO = [
    { title: 'Route Two at Sunset', artist: 'Pixel Pines', album: 'Overworld Tapes', dur: 192000, hue: 28 },
    { title: 'Rainy Window', artist: 'Lofi Lantern', album: 'Indoor Days', dur: 171000, hue: 205 },
    { title: 'Campfire Keys', artist: 'Moss & Ember', album: 'Night Camp', dur: 214000, hue: 265 },
    { title: 'Morning Market', artist: 'Pixel Pines', album: 'Overworld Tapes', dur: 158000, hue: 125 },
  ];
  const demo = { i: 0, playing: false, pos: 42000, at: Date.now(), shuffle: false, volume: 70 };
  function demoArt(t) {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const g = c.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = (U.hash(t.title + x + y) % 30);
      const sky = y < 5;
      g.fillStyle = sky ? `hsl(${t.hue + v / 3},65%,${68 + v / 3 - y * 3}%)` : `hsl(${t.hue + 90},${40 + v}%,${38 + v / 2}%)`;
      g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = '#FFF6DA'; g.fillRect(5, 1, 2, 2);
    return c.toDataURL();
  }
  function demoState() {
    const t = DEMO[demo.i];
    let pos = demo.pos + (demo.playing ? Date.now() - demo.at : 0);
    if (pos >= t.dur) { demo.i = (demo.i + 1) % DEMO.length; demo.pos = 0; demo.at = Date.now(); return demoState(); }
    return { available: true, demo: true, playing: demo.playing, title: t.title, artist: t.artist, album: t.album, position_ms: pos, duration_ms: t.dur, updated_ms: Date.now(), art_key: t.title, can_next: true, can_prev: true, can_seek: true, shuffle: demo.shuffle, volume: demo.volume };
  }
  function demoControl(action, value) {
    const cur = demoState();
    demo.pos = cur.position_ms; demo.at = Date.now();
    if (action === 'toggle') demo.playing = !demo.playing;
    if (action === 'next') { demo.i = (demo.i + 1) % DEMO.length; demo.pos = 0; }
    if (action === 'prev') { if (cur.position_ms > 3000) demo.pos = 0; else { demo.i = (demo.i + DEMO.length - 1) % DEMO.length; demo.pos = 0; } }
    if (action === 'seek') demo.pos = value;
    if (action === 'shuffle') demo.shuffle = !!value;
    if (action === 'volume') demo.volume = value;
  }

  /* ---------- polling ---------- */
  async function fetchState(forceWeb = false) {
    lastFetch = Date.now();
    if (!P.isApp) { state = demoState(); source = 'demo'; }
    else {
      let local;
      try { local = await P.invoke('spotify_state'); } catch (e) { local = { available: false }; }
      if (local.available && local.playing) {
        state = local; source = 'local';
      } else if (webOn()) {
        if (forceWeb || source !== 'web' || Date.now() - lastWeb >= WEB_EVERY) {
          lastWeb = Date.now();
          try { webState = await P.invoke('spotify_web_state'); } catch (e) { webState = { available: false, error: String(e) }; }
        }
        // Prefer the account-wide view if something is playing there, or if the desktop app isn't open.
        if (webState && webState.available && (webState.playing || !local.available)) { state = webState; source = 'web'; }
        else { state = local; source = 'local'; }
      } else {
        state = local; source = 'local';
      }
    }
    if (Date.now() < volHold && volWanted !== null && state.available) state.volume = volWanted;
    const key = `${source}|${state.art_key}`;
    if (state.available && key !== artKey) {
      artKey = key;
      if (!P.isApp) art = demoArt(DEMO[demo.i]);
      else { try { art = await P.invoke(source === 'web' ? 'spotify_web_art' : 'spotify_art'); } catch (e) { art = null; } }
    }
    render();
  }

  const positionNow = () => position();
  const position = () => {
    if (!state.available) return 0;
    let p = state.position_ms || 0;
    if (state.playing && state.updated_ms) p += Date.now() - state.updated_ms;
    return state.duration_ms ? Math.min(p, state.duration_ms) : p;
  };

  function start() {
    if (pollTimer) return;
    fetchState();
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && document.querySelector('[data-spotify]')) fetchState(); }, P.isApp ? 1500 : 1000);
    tickTimer = setInterval(tickProgress, 500);
  }
  function stop() { clearInterval(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null; }

  /** Volume changes while dragging: show at once, send at most every 250 ms. */
  function setVolume(v, now = false) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    volWanted = v; volHold = Date.now() + 4000;
    state.volume = v;
    document.querySelectorAll('[data-spotify]').forEach(tickOne);
    clearTimeout(volTimer);
    const send = async () => {
      if (!P.isApp) return demoControl('volume', v);
      try { await P.invoke('spotify_web_control', { action: 'volume', value: v }); }
      catch (e) { Q.ui.toast(String(e), { kind: 'error' }); }
    };
    if (now) send(); else volTimer = setTimeout(send, 250);
  }
  const hasVolume = () => state.available && typeof state.volume === 'number' && (source === 'web' || source === 'demo');

  async function control(action, value) {
    Q.sfx.click();
    if (!P.isApp) demoControl(action, value);
    else if (source === 'web') {
      const a = action === 'toggle' ? (state.playing ? 'pause' : 'play') : action;
      // Show the change right away; the next poll confirms it.
      if (a === 'pause' || a === 'play') { const pos = positionNow(); state.position_ms = pos; state.updated_ms = Date.now(); state.playing = a === 'play'; render(); }
      try { await P.invoke('spotify_web_control', { action: a, value: value ?? null }); }
      catch (e) { Q.ui.toast(String(e), { kind: 'error' }); }
      setTimeout(() => fetchState(true), 450);
      return;
    } else {
      try { await P.invoke('spotify_control', { action, value: value ?? null }); }
      catch (e) { Q.ui.toast(String(e), { kind: 'error' }); }
    }
    setTimeout(fetchState, P.isApp ? 250 : 10);
  }

  /* ---------- rendering ---------- */
  function markup(size = 'full') {
    return `<div class="spotify spotify-${size}" data-spotify="${size}"></div>`;
  }

  function render() {
    const nodes = document.querySelectorAll('[data-spotify]');
    nodes.forEach((el) => {
      const size = el.dataset.spotify;
      if (!state.available) {
        el.innerHTML = `
          <div class="sp-empty">
            <div class="sp-art sp-art-empty">${Q.sprites.icon('note')}</div>
            <div class="sp-meta"><div class="sp-title">Nothing playing</div>
            <div class="sp-artist">${!P.isApp ? 'Spotify control works in the desktop app.' : webOn() ? 'Press play in Spotify, Spotifast or on your phone.' : 'Press play in the Spotify app. Using Spotifast or your phone? Connect your account in Settings.'}</div></div>
            <button class="btn btn-small" data-act="sp-open">Open Spotify</button>
          </div>`;
        return;
      }
      const key = `${source}|${state.art_key}|${state.playing}|${state.shuffle}|${state.device}|${hasVolume()}|${size}`;
      if (el.dataset.key === key) return tickOne(el);
      el.dataset.key = key;
      el.innerHTML = `
        <div class="sp-art">${art ? `<img src="${art}" alt="">` : Q.sprites.icon('note')}</div>
        <div class="sp-main">
          <div class="sp-meta">
            <div class="sp-title" title="${U.esc(state.title)}">${U.esc(state.title || 'Unknown track')}</div>
            <div class="sp-artist">${U.esc(state.artist || '')}${size === 'full' && state.album && !(source === 'web' && state.device) ? ` · ${U.esc(state.album)}` : ''}</div>
            ${source === 'web' && state.device ? `<div class="sp-device" title="Playing through your Spotify account">${Q.sprites.icon('note')} on ${U.esc(state.device)}</div>` : ''}
          </div>
          <div class="sp-progress ${state.can_seek ? 'seekable' : ''}" data-act="sp-seek" role="slider" aria-label="Track position">
            <div class="sp-bar"><div class="sp-fill"></div></div>
            <div class="sp-times"><span class="sp-pos"></span><span class="sp-dur">${U.fmtClock((state.duration_ms || 0) / 1000)}</span></div>
          </div>
          <div class="sp-controls">
            <button class="icon-btn" data-act="sp-prev" title="Previous" aria-label="Previous">${Q.sprites.icon('prev')}</button>
            <button class="icon-btn sp-play" data-act="sp-toggle" title="${state.playing ? 'Pause' : 'Play'}" aria-label="${state.playing ? 'Pause' : 'Play'}">${Q.sprites.icon(state.playing ? 'pause' : 'play')}</button>
            <button class="icon-btn" data-act="sp-next" title="Next" aria-label="Next">${Q.sprites.icon('next')}</button>
            ${hasVolume() && size !== 'mini' ? `<div class="sp-vol" title="Volume on ${U.esc(state.device || 'Spotify')}">
              <button class="icon-btn sp-mute" data-act="sp-mute" aria-label="Mute or unmute">${Q.sprites.icon(state.volume > 0 ? 'vol' : 'mute')}</button>
              <input type="range" min="0" max="100" step="1" value="${state.volume}" data-change="sp-vol" data-live aria-label="Volume"></div>` : ''}
            ${state.demo && size !== 'mini' && !hasVolume() ? '<span class="sp-demo">Demo</span>' : ''}
          </div>
        </div>`;
      tickOne(el);
    });
  }
  function tickOne(el) {
    const fill = el.querySelector('.sp-fill'); const pos = el.querySelector('.sp-pos');
    if (!fill) return;
    const p = position();
    fill.style.width = `${state.duration_ms ? (p / state.duration_ms) * 100 : 0}%`;
    pos.textContent = U.fmtClock(p / 1000);
    // Keep the volume slider in step with Spotify, but never fight a drag.
    const vol = el.querySelector('[data-change="sp-vol"]');
    if (vol && typeof state.volume === 'number') {
      if (document.activeElement !== vol && +vol.value !== state.volume) vol.value = state.volume;
      const ic = el.querySelector('.sp-mute');
      const want = state.volume > 0 ? 'vol' : 'mute';
      if (ic && ic.dataset.ic !== want) { ic.dataset.ic = want; ic.innerHTML = Q.sprites.icon(want); }
    }
  }
  function tickProgress() {
    if (!P.isApp && state.available) state = demoState();
    document.querySelectorAll('[data-spotify]').forEach((el) => state.available && tickOne(el));
    if (Date.now() - lastFetch > 4000 && document.visibilityState === 'visible') fetchState();
  }

  function bind() {
    const on = Q.ui.on;
    on('sp-toggle', () => control('toggle'));
    on('sp-next', () => control('next'));
    on('sp-prev', () => control('prev'));
    on('sp-open', () => P.openExternal(P.isApp ? 'spotify:' : 'https://open.spotify.com'));
    on('sp-mute', () => {
      Q.sfx.click();
      if (state.volume > 0) { lastVol = state.volume; setVolume(0, true); } else setVolume(lastVol || 60, true);
    });
    Q.ui.onChange('sp-vol', (el, e) => setVolume(+el.value, e.type === 'change'));
    on('sp-seek', (el, ev) => {
      if (!state.can_seek || !state.duration_ms) return;
      const bar = el.querySelector('.sp-bar').getBoundingClientRect();
      const f = U.clamp((ev.clientX - bar.left) / bar.width, 0, 1);
      control('seek', Math.round(f * state.duration_ms));
    });
  }

  return { markup, start, stop, render, bind, refresh: fetchState };
})();
