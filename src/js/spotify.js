'use strict';
/*
 * Spotify widget. Desktop app: reads and controls the Spotify desktop app via
 * Windows media sessions (Rust side). Browser preview: a demo player.
 * Polls only while a widget is on screen and the window is visible.
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

  /* ---------- demo player (preview only) ---------- */
  const DEMO = [
    { title: 'Route Two at Sunset', artist: 'Pixel Pines', album: 'Overworld Tapes', dur: 192000, hue: 28 },
    { title: 'Rainy Window', artist: 'Lofi Lantern', album: 'Indoor Days', dur: 171000, hue: 205 },
    { title: 'Campfire Keys', artist: 'Moss & Ember', album: 'Night Camp', dur: 214000, hue: 265 },
    { title: 'Morning Market', artist: 'Pixel Pines', album: 'Overworld Tapes', dur: 158000, hue: 125 },
  ];
  const demo = { i: 0, playing: false, pos: 42000, at: Date.now(), shuffle: false };
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
    return { available: true, demo: true, playing: demo.playing, title: t.title, artist: t.artist, album: t.album, position_ms: pos, duration_ms: t.dur, updated_ms: Date.now(), art_key: t.title, can_next: true, can_prev: true, can_seek: true, shuffle: demo.shuffle };
  }
  function demoControl(action, value) {
    const cur = demoState();
    demo.pos = cur.position_ms; demo.at = Date.now();
    if (action === 'toggle') demo.playing = !demo.playing;
    if (action === 'next') { demo.i = (demo.i + 1) % DEMO.length; demo.pos = 0; }
    if (action === 'prev') { if (cur.position_ms > 3000) demo.pos = 0; else { demo.i = (demo.i + DEMO.length - 1) % DEMO.length; demo.pos = 0; } }
    if (action === 'seek') demo.pos = value;
    if (action === 'shuffle') demo.shuffle = !!value;
  }

  /* ---------- polling ---------- */
  async function fetchState() {
    lastFetch = Date.now();
    if (!P.isApp) { state = demoState(); }
    else {
      try { state = await P.invoke('spotify_state'); } catch (e) { state = { available: false }; }
    }
    if (state.available && state.art_key !== artKey) {
      artKey = state.art_key;
      if (!P.isApp) art = demoArt(DEMO[demo.i]);
      else { try { art = await P.invoke('spotify_art'); } catch (e) { art = null; } }
    }
    render();
  }

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

  async function control(action, value) {
    Q.sfx.click();
    if (!P.isApp) demoControl(action, value);
    else {
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
            <div class="sp-meta"><div class="sp-title">Spotify isn't playing</div>
            <div class="sp-artist">${P.isApp ? 'Open the Spotify app and press play.' : 'Spotify control works in the desktop app.'}</div></div>
            <button class="btn btn-small" data-act="sp-open">Open Spotify</button>
          </div>`;
        return;
      }
      const key = `${state.art_key}|${state.playing}|${state.shuffle}|${size}`;
      if (el.dataset.key === key) return tickOne(el);
      el.dataset.key = key;
      el.innerHTML = `
        <div class="sp-art">${art ? `<img src="${art}" alt="">` : Q.sprites.icon('note')}</div>
        <div class="sp-main">
          <div class="sp-meta">
            <div class="sp-title" title="${U.esc(state.title)}">${U.esc(state.title || 'Unknown track')}</div>
            <div class="sp-artist">${U.esc(state.artist || '')}${size === 'full' && state.album ? ` · ${U.esc(state.album)}` : ''}</div>
          </div>
          <div class="sp-progress ${state.can_seek ? 'seekable' : ''}" data-act="sp-seek" role="slider" aria-label="Track position">
            <div class="sp-bar"><div class="sp-fill"></div></div>
            <div class="sp-times"><span class="sp-pos"></span><span class="sp-dur">${U.fmtClock((state.duration_ms || 0) / 1000)}</span></div>
          </div>
          <div class="sp-controls">
            ${size !== 'mini' ? `<button class="icon-btn ${state.shuffle ? 'on' : ''}" data-act="sp-shuffle" title="Shuffle" aria-label="Shuffle">${Q.sprites.icon('shuffle')}</button>` : ''}
            <button class="icon-btn" data-act="sp-prev" title="Previous" aria-label="Previous">${Q.sprites.icon('prev')}</button>
            <button class="icon-btn sp-play" data-act="sp-toggle" title="${state.playing ? 'Pause' : 'Play'}" aria-label="${state.playing ? 'Pause' : 'Play'}">${Q.sprites.icon(state.playing ? 'pause' : 'play')}</button>
            <button class="icon-btn" data-act="sp-next" title="Next" aria-label="Next">${Q.sprites.icon('next')}</button>
            ${state.demo && size !== 'mini' ? '<span class="sp-demo">Demo</span>' : ''}
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
    on('sp-shuffle', () => control('shuffle', state.shuffle ? 0 : 1));
    on('sp-open', () => P.openExternal(P.isApp ? 'spotify:' : 'https://open.spotify.com'));
    on('sp-seek', (el, ev) => {
      if (!state.can_seek || !state.duration_ms) return;
      const bar = el.querySelector('.sp-bar').getBoundingClientRect();
      const f = U.clamp((ev.clientX - bar.left) / bar.width, 0, 1);
      control('seek', Math.round(f * state.duration_ms));
    });
  }

  return { markup, start, stop, render, bind, refresh: fetchState };
})();
