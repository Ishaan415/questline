'use strict';
/*
 * The browser version (https://ishaan415.github.io/questline/app/).
 *
 * In the Windows and Android apps, Rust does the Google, Drive, Calendar and
 * Spotify work (src-tauri/src). In the browser this file does the same jobs
 * with fetch, answering the same commands, so the rest of the app doesn't care
 * where it runs (platform.js sends invoke() here when running on the web).
 *
 * Google sign-in: the browser flow for apps without a server. Questline goes to
 * Google's sign-in page and comes back with an access token that lasts an hour.
 * There is no refresh token in a browser, so when it runs out Questline goes
 * back to Google for a new one; with your Google session still open that takes
 * a second and shows nothing (prompt=none). It does that when the page opens
 * and when you come back to the tab; while you use the page it asks with a tap.
 * The token stays in this browser only and is used only to talk to Google.
 *
 * Spotify: the standard PKCE sign-in, which in a browser does come with a
 * refresh token, so it stays connected.
 *
 * Does nothing in the apps or the preview (no window.QUESTLINE_WEB).
 */

Q.web = (() => {
  const CFG = window.QUESTLINE_WEB || null;
  const T = window.__TAURI__;
  const on = !!CFG && !(T && T.core && T.core.invoke);
  if (!on) return { on: false };

  /* ---------------------------------------------------------- constants */
  const APP_URL = CFG.appUrl || `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
  const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
  const API = 'https://www.googleapis.com';
  const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
  const BASE_SCOPES = `openid email profile ${DRIVE_SCOPE}`;
  const CALENDAR_SCOPES = `https://www.googleapis.com/auth/calendar.readonly ${CAL_SCOPE}`;
  const SP_AUTH = 'https://accounts.spotify.com/authorize';
  const SP_TOKEN = 'https://accounts.spotify.com/api/token';
  const SP_API = 'https://api.spotify.com/v1';
  const SP_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
  const RELEASES_API = 'https://api.github.com/repos/Ishaan415/questline/releases';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const FIELDS = 'id,name,version,modifiedTime,size';
  const MAX_FILE = 20 * 1024 * 1024;
  const K_GOOGLE = 'questline-web-google';
  const K_SPOTIFY = 'questline-web-spotify';
  const K_PENDING = 'questline-web-pending';  // sessionStorage: a sign-in on its way
  const K_RENEW = 'questline-web-renew';      // sessionStorage: last silent renewal
  const RENEW_GAP = 10 * 60000;               // never retry a silent renewal sooner than this
  const EXPIRED = 'Your Google sign-in timed out. Tap Renew in the message, or reload the page.';

  /* ------------------------------------------------------------ storage */
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const rand = (n = 32) => {
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.from(a, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
  };
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  /** { token, expires (ms), scope, email, name } once signed in. */
  let google = ls.get(K_GOOGLE);
  const saveGoogle = () => ls.set(K_GOOGLE, google);
  const hasScope = (s) => !!google && String(google.scope || '').split(/\s+/).includes(s);
  const tokenFresh = () => !!(google && google.token && google.expires > Date.now() + 60000);

  /* ------------------------------------------------- leaving for sign-in */
  let leaving = false;
  /** Go to a sign-in page; the promise never settles because the page unloads. */
  function leave(url, pending) {
    leaving = true;
    ss.set(K_PENDING, Object.assign({ at: Date.now(), back: location.hash || '' }, pending));
    try { if (Q.store && Q.store.state) Q.store.saveNow(); } catch (e) { /* not loaded yet */ }
    location.assign(url);
    return new Promise(() => {});
  }

  function googleUrl({ scopes, prompt, state }) {
    const p = new URLSearchParams({
      client_id: CFG.googleClientId, redirect_uri: APP_URL, response_type: 'token', scope: scopes,
      include_granted_scopes: 'true', state,
    });
    if (prompt) p.set('prompt', prompt);
    if (google && google.email) p.set('login_hint', google.email);
    return `${AUTH_URL}?${p}`;
  }

  /** Back to Google for a fresh token without showing anything (if the Google session is open). */
  function renewSilently() {
    if (!google || !CFG.googleClientId) return false;
    const last = ss.get(K_RENEW) || 0;
    if (Date.now() - last < RENEW_GAP) return false;
    ss.set(K_RENEW, Date.now());
    const state = rand(24);
    leave(googleUrl({ scopes: google.scope || BASE_SCOPES, prompt: 'none', state }), { kind: 'google', purpose: 'renew', state });
    return true;
  }
  /** Same, after a tap: Google may show its account page if it needs to. */
  function renewNow() {
    if (!google) return;
    const state = rand(24);
    leave(googleUrl({ scopes: google.scope || BASE_SCOPES, prompt: '', state }), { kind: 'google', purpose: 'renew', state });
  }

  /* ---------------------------------------------- coming back from sign-in */
  let result = null; // { kind, purpose, ok, error, calendar }
  async function readReturn() {
    const pending = ss.get(K_PENDING);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(location.search);
    const isGoogle = hash.has('state') && (hash.has('access_token') || hash.has('error'));
    const isSpotify = query.has('state') && (query.has('code') || query.has('error'));
    if (!isGoogle && !isSpotify) return;
    const back = (pending && pending.back) || '';
    // Take the sign-in reply out of the address bar (and history) at once.
    try { history.replaceState(null, '', `${location.pathname}${back}`); } catch (e) { /* ignore */ }
    ss.set(K_PENDING, null);
    const got = isGoogle ? hash : query;
    if (!pending || got.get('state') !== pending.state || (isGoogle ? pending.kind !== 'google' : pending.kind !== 'spotify')) {
      result = { kind: isGoogle ? 'google' : 'spotify', ok: false, error: 'That sign-in reply didn\'t match a sign-in from this page. Please try again.' };
      return;
    }
    if (isGoogle) {
      const err = hash.get('error');
      if (err) {
        // A silent renewal that needs you to click something: keep the account, ask later.
        if (pending.purpose === 'renew') { if (google) { google.expires = 0; saveGoogle(); } result = { kind: 'google', purpose: 'renew', ok: false, error: err }; return; }
        result = { kind: 'google', purpose: pending.purpose, ok: false, error: err === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${err}).` };
        return;
      }
      const prev = google || {};
      const fresh = pending.purpose === 'connect';
      google = {
        token: hash.get('access_token'),
        expires: Date.now() + (+hash.get('expires_in') || 3600) * 1000,
        scope: hash.get('scope') || prev.scope || BASE_SCOPES,
        email: fresh ? '' : prev.email || '', name: fresh ? '' : prev.name || '',
      };
      saveGoogle();
      ss.set(K_RENEW, null);
      result = { kind: 'google', purpose: pending.purpose, ok: true, calendar: hasScope(CAL_SCOPE), drive: hasScope(DRIVE_SCOPE) };
      return;
    }
    // Spotify: swap the code for tokens.
    if (query.get('error')) { result = { kind: 'spotify', ok: false, error: query.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : `Spotify sign-in failed (${query.get('error')}).` }; return; }
    try {
      const tr = await spotifyToken({
        grant_type: 'authorization_code', code: query.get('code'), redirect_uri: APP_URL,
        client_id: pending.clientId, code_verifier: pending.verifier,
      });
      if (!tr.refresh_token) throw new Error('Spotify didn\'t return a refresh token. Please try again.');
      spotify = { clientId: pending.clientId, refresh: tr.refresh_token, token: tr.access_token, expires: Date.now() + tr.expires_in * 1000 };
      ls.set(K_SPOTIFY, spotify);
      result = { kind: 'spotify', ok: true };
    } catch (e) { result = { kind: 'spotify', ok: false, error: String(e.message || e) }; }
  }

  /* ------------------------------------------------------ Google requests */
  async function token() {
    if (!google) throw new Error('Your Google account isn\'t connected.');
    if (tokenFresh()) return google.token;
    noteExpired();
    throw new Error(EXPIRED);
  }

  let expiredToast = 0;
  /** Once per expiry: offer the renewal (it needs a tap while you're using the page). */
  function noteExpired() {
    if (leaving || Date.now() - expiredToast < 30 * 60000) return;
    expiredToast = Date.now();
    if (!(Q.ui && Q.ui.toast)) return;
    Q.ui.toast('Your Google sign-in timed out, so syncing is paused.', { kind: 'info', icon: Q.sprites.icon('cloud'), timeout: 15000, actions: [{ label: 'Renew', fn: renewNow }] });
  }

  /** One Google request; returns text (or null for an empty reply). */
  async function gfetch(method, url, { query, json, raw, contentType, label = 'Google' } = {}) {
    const tok = await token();
    const u = new URL(url);
    for (const [k, v] of query || []) u.searchParams.append(k, v);
    const headers = { Authorization: `Bearer ${tok}` };
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (raw !== undefined) { headers['Content-Type'] = contentType; body = raw; }
    let res;
    try { res = await fetch(u, { method, headers, body }); }
    catch (e) { throw new Error(`Network error: ${navigator.onLine === false ? 'you\'re offline' : 'couldn\'t reach Google'}`); }
    if (res.status === 401) { google.expires = 0; saveGoogle(); noteExpired(); throw new Error(EXPIRED); }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error.message || text; } catch (e) { /* not JSON */ }
      if (res.status === 403 && /scope/i.test(msg) && label === 'Google Drive') throw new Error('Drive access wasn\'t granted. Reconnect your Google account in Settings and allow Drive.');
      throw new Error(`${label} error ${res.status}: ${msg}`);
    }
    return text.trim() ? text : null;
  }

  /* ---------------------------------------------------------------- Drive */
  const checkId = (id) => { if (!id || id.length > 200 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid Drive file id.'); };
  const checkName = (n) => { if (!n || n.length > 120 || /[/\\]/.test(n)) throw new Error('Invalid Drive file name.'); };
  const qLit = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const fileOf = (v) => ({ id: v.id || '', name: v.name || '', version: v.version || '', modifiedTime: v.modifiedTime || '', size: +v.size || 0 });
  const parentClause = (p) => { if (p) { checkId(p); return `'${p}' in parents`; } return "'root' in parents"; };
  const dcall = (method, url, opts) => gfetch(method, url, Object.assign({ label: 'Google Drive' }, opts));

  async function search(q, order) {
    const text = await dcall('GET', `${API}/drive/v3/files`, { query: [['q', q], ['fields', `files(${FIELDS})`], ['spaces', 'drive'], ['orderBy', order], ['pageSize', '200']] });
    return ((text && JSON.parse(text).files) || []).map(fileOf);
  }

  const drive = {
    async drive_ensure_folder({ name, parent }) {
      checkName(name);
      const found = await search(`name = '${qLit(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false and ${parentClause(parent)}`, 'createdTime');
      if (found.length) return found[0].id;
      const text = await dcall('POST', `${API}/drive/v3/files`, { query: [['fields', 'id']], json: { name, mimeType: FOLDER_MIME, parents: [parent || 'root'] } });
      return JSON.parse(text).id;
    },
    async drive_find({ name, parent }) {
      checkName(name); checkId(parent);
      const found = await search(`name = '${qLit(name)}' and '${parent}' in parents and trashed = false`, 'modifiedTime desc');
      return found[0] || null;
    },
    async drive_list({ parent }) {
      checkId(parent);
      return search(`'${parent}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`, 'name desc');
    },
    async drive_read({ id }) {
      checkId(id);
      const meta = JSON.parse(await dcall('GET', `${API}/drive/v3/files/${id}`, { query: [['fields', 'version,size']] }));
      if (+meta.size > MAX_FILE) throw new Error('That Drive file is too large to be a Questline save.');
      const content = await dcall('GET', `${API}/drive/v3/files/${id}`, { query: [['alt', 'media']] });
      return { content: content || '', version: meta.version || '' };
    },
    async drive_write({ id, name, parent, content }) {
      checkName(name); checkId(parent);
      if (content.length > MAX_FILE) throw new Error('The save is too large to upload.');
      let text;
      if (id) {
        checkId(id);
        text = await dcall('PATCH', `${API}/upload/drive/v3/files/${id}`, { query: [['uploadType', 'media'], ['fields', FIELDS]], raw: content, contentType: 'application/json; charset=UTF-8' });
      } else {
        const boundary = `questline${rand(16)}`;
        const meta = JSON.stringify({ name, parents: [parent], mimeType: 'application/json' });
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
        text = await dcall('POST', `${API}/upload/drive/v3/files`, { query: [['uploadType', 'multipart'], ['fields', FIELDS]], raw: body, contentType: `multipart/related; boundary=${boundary}` });
      }
      return fileOf(JSON.parse(text));
    },
    async drive_trash({ id }) {
      checkId(id);
      await dcall('PATCH', `${API}/drive/v3/files/${id}`, { query: [['fields', 'id']], json: { trashed: true } });
      return null;
    },
  };

  /* ------------------------------------------------------ Google account */
  async function account() {
    if (!google) return { connected: false, email: '', name: '', calendar: false, drive: false };
    if (!google.email && tokenFresh()) {
      try {
        const r = await fetch(USERINFO, { headers: { Authorization: `Bearer ${google.token}` } });
        if (r.ok) { const v = await r.json(); google.email = v.email || ''; google.name = v.name || ''; saveGoogle(); }
      } catch (e) { /* offline: try next time */ }
    }
    return { connected: true, email: google.email || '', name: google.name || '', calendar: hasScope(CAL_SCOPE), drive: hasScope(DRIVE_SCOPE) };
  }

  const googleCmds = {
    google_builtin: () => !!CFG.googleClientId,
    google_status: () => !!google,
    google_account: account,
    google_connect({ calendar }) {
      if (!CFG.googleClientId) throw new Error('This web build has no Google sign-in set up.');
      const state = rand(24);
      if (calendar) return leave(googleUrl({ scopes: `${google ? google.scope : BASE_SCOPES} ${CALENDAR_SCOPES}`, prompt: 'consent', state }), { kind: 'google', purpose: 'calendar', state });
      return leave(googleUrl({ scopes: BASE_SCOPES, prompt: 'select_account', state }), { kind: 'google', purpose: 'connect', state });
    },
    async google_disconnect() {
      if (google && google.token) {
        // Ends Questline's access for this account (Google's own sign-in stays).
        try { await fetch(`${REVOKE_URL}?token=${encodeURIComponent(google.token)}`, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); } catch (e) { /* offline */ }
      }
      google = null; saveGoogle();
      return null;
    },
    async google_api({ method, path, query, body }) {
      if (!String(path).startsWith('/calendar/v3/') || path.includes('..')) throw new Error('Only Google Calendar API paths are allowed.');
      const text = await gfetch(String(method).toUpperCase(), `${API}${path}`, { query: query || [], json: body == null ? undefined : body, label: 'Google Calendar' });
      return text ? JSON.parse(text) : null;
    },
  };

  /* -------------------------------------------------------------- Spotify */
  let spotify = ls.get(K_SPOTIFY); // { clientId, refresh, token, expires }
  async function spotifyToken(form) {
    let res;
    try { res = await fetch(SP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) }); }
    catch (e) { throw new Error('Couldn\'t reach Spotify.'); }
    const text = await res.text();
    if (!res.ok) throw new Error(`Spotify rejected the sign-in (${res.status}): ${text}`);
    return JSON.parse(text);
  }
  async function spToken(force) {
    if (!spotify) throw new Error('Spotify account isn\'t connected.');
    if (!force && spotify.expires > Date.now() + 60000) return spotify.token;
    const tr = await spotifyToken({ grant_type: 'refresh_token', refresh_token: spotify.refresh, client_id: spotify.clientId });
    spotify.token = tr.access_token; spotify.expires = Date.now() + tr.expires_in * 1000;
    if (tr.refresh_token) spotify.refresh = tr.refresh_token; // Spotify may rotate it
    ls.set(K_SPOTIFY, spotify);
    return spotify.token;
  }
  async function spApi(method, path) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await spToken(attempt === 1);
      let res;
      try { res = await fetch(`${SP_API}${path}`, { method, headers: { Authorization: `Bearer ${tok}` } }); }
      catch (e) { throw new Error('Network error: couldn\'t reach Spotify'); }
      if (res.status === 401 && attempt === 0) continue;
      const text = await res.text();
      if (res.status === 204 || (res.ok && !text.trim())) return null;
      if (!res.ok) {
        let reason = '';
        try { reason = JSON.parse(text).error.reason || ''; } catch (e) { /* not JSON */ }
        if (res.status === 404 || reason === 'NO_ACTIVE_DEVICE') throw new Error('Nothing is playing on your Spotify account. Press play in Spotifast or any Spotify app first.');
        if (res.status === 403 && reason === 'PREMIUM_REQUIRED') throw new Error('Spotify needs Premium to control playback.');
        if (res.status === 429) throw new Error('Spotify asked Questline to slow down. Try again in a moment.');
        throw new Error(`Spotify error ${res.status}: ${text}`);
      }
      return method === 'GET' ? JSON.parse(text) : null;
    }
    throw new Error('Spotify rejected the saved sign-in. Reconnect in Settings.');
  }
  let spArt = null;
  const EMPTY_MEDIA = { available: false, playing: false, title: '', artist: '', album: '', position_ms: 0, duration_ms: 0, updated_ms: 0, art_key: '', can_next: false, can_prev: false, can_seek: false, shuffle: null, device: '', volume: null };
  const spotifyCmds = {
    spotify_state: () => EMPTY_MEDIA,          // no desktop Spotify app to read in a browser
    spotify_art: () => null,
    spotify_web_status: () => !!spotify,
    async spotify_web_connect({ clientId }) {
      const id = String(clientId || '').trim();
      if (!/^[0-9a-fA-F]{32}$/.test(id)) throw new Error('That doesn\'t look like a Spotify Client ID (32 letters and numbers from your app\'s Settings page).');
      const verifier = rand(64);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const state = rand(24);
      const p = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: APP_URL, scope: SP_SCOPES, code_challenge_method: 'S256', code_challenge: challenge, state });
      return leave(`${SP_AUTH}?${p}`, { kind: 'spotify', state, verifier, clientId: id });
    },
    spotify_web_disconnect() { spotify = null; ls.set(K_SPOTIFY, null); return null; },
    async spotify_web_state() {
      const v = await spApi('GET', '/me/player?additional_types=episode');
      if (!v || !v.item) return EMPTY_MEDIA;
      const item = v.item; const ep = item.type === 'episode';
      const images = (ep ? item.images : item.album && item.album.images) || [];
      const img = (images[1] || images[0] || {}).url || '';
      const dis = (v.actions && v.actions.disallows) || {};
      spArt = img || null;
      return {
        available: true, playing: !!v.is_playing, title: item.name || 'Unknown track',
        artist: ep ? (item.show && item.show.name) || '' : (item.artists || []).map((a) => a.name).join(', '),
        album: ep ? '' : (item.album && item.album.name) || '',
        position_ms: v.progress_ms || 0, duration_ms: item.duration_ms || 0, updated_ms: Date.now(), art_key: img,
        can_next: !dis.skipping_next, can_prev: !dis.skipping_prev, can_seek: !dis.seeking,
        shuffle: typeof v.shuffle_state === 'boolean' ? v.shuffle_state : null,
        device: (v.device && v.device.name) || '',
        volume: v.device && v.device.supports_volume !== false && typeof v.device.volume_percent === 'number' ? Math.min(100, v.device.volume_percent) : null,
      };
    },
    spotify_web_art: () => spArt,
    async spotify_web_control({ action, value }) {
      const n = Math.max(0, Math.round(+value || 0));
      const map = {
        play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], prev: ['POST', '/me/player/previous'],
        seek: ['PUT', `/me/player/seek?position_ms=${n}`], shuffle: ['PUT', `/me/player/shuffle?state=${n > 0}`], volume: ['PUT', `/me/player/volume?volume_percent=${Math.min(100, n)}`],
      };
      if (!map[action]) throw new Error(`Unknown action ${action}`);
      await spApi(...map[action]);
      return null;
    },
  };

  /* ---------------------------------------------------------------- other */
  const otherCmds = {
    async fetch_ics({ url }) {
      let u = String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
      if (!/^https:\/\//i.test(u)) throw new Error('Calendar links must start with https:// or webcal://');
      let res;
      try { res = await fetch(u); }
      catch (e) { throw new Error('This calendar\'s server doesn\'t let web pages read it. It works in the Windows and Android apps; in the browser, use Google Calendar instead.'); }
      if (!res.ok) throw new Error(`The calendar link returned ${res.status}`);
      const text = await res.text();
      if (text.length > 8 * 1024 * 1024) throw new Error('That calendar feed is larger than 8 MB.');
      return text;
    },
    async release_notes({ version }) {
      const v = String(version || '').replace(/^v/, '').replace(/[^0-9A-Za-z.-]/g, '');
      const get = async (url) => { const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } }); return r.ok ? r.json() : null; };
      const rel = (v && (await get(`${RELEASES_API}/tags/v${v}`))) || (await get(`${RELEASES_API}/latest`));
      return rel ? { version: String(rel.tag_name || '').replace(/^v/, ''), notes: rel.body || '', date: rel.published_at, url: rel.html_url } : null;
    },
    open_external({ url }) { window.open(url, '_blank', 'noopener'); return null; },
  };

  const CMDS = Object.assign({}, googleCmds, drive, spotifyCmds, otherCmds);

  /** platform.invoke() in the browser. */
  async function invoke(cmd, args = {}) {
    if (paused) throw new Error('Questline is open in another tab.');
    const fn = CMDS[cmd];
    if (!fn) throw new Error('Only available in the Windows and Android apps');
    return fn(args || {});
  }

  /* -------------------------------------------- one tab at a time */
  // Two tabs would each save their own copy over the other. The newest tab
  // wins; older ones stop saving and offer to take over again.
  let paused = false;
  const TAB = rand(8);
  let channel = null;
  try { channel = new BroadcastChannel('questline'); } catch (e) { /* old browser */ }
  function pauseHere() {
    if (paused) return;
    paused = true;
    const box = document.createElement('div');
    box.className = 'web-paused';
    box.innerHTML = `<div class="web-paused-card"><b>Questline is open in another tab</b>
      <p>This tab has stopped so the two don't overwrite each other's progress.</p>
      <button class="btn btn-primary" type="button">Use Questline here</button></div>`;
    box.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(box);
  }
  if (channel) {
    channel.onmessage = (e) => { if (e.data && e.data.hello && e.data.tab !== TAB) pauseHere(); };
    channel.postMessage({ hello: true, tab: TAB });
  }

  /* ---------------------------------------------------------------- boot */
  /** Called by the app right after the save loads: finish a sign-in that just came back. */
  async function boot() {
    await returned;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* not offered */ }
    const st = Q.store.state;
    // Spotify linked in another tab of this browser (or a sign-in on another device's settings).
    if (st.settings.spotify) st.settings.spotify.webConnected = !!spotify;
    if (st.settings.google.connected && !google) st.settings.google.connected = false;
    if (!result) return;
    if (result.kind === 'google' && result.ok) {
      const g = st.settings.google;
      if (result.purpose === 'connect') { g.connected = true; g.syncOn = true; }
      if (result.purpose === 'calendar') g.calendarOn = !!result.calendar;
      Q.store.commit('settings');
    }
    if (result.kind === 'spotify' && result.ok) { st.settings.spotify.webConnected = true; Q.store.commit('settings'); }
  }

  /** Called once the app is on screen (and the first Drive sync has started). */
  function afterStart() {
    const r = result; result = null;
    const toast = (m, o) => Q.ui.toast(m, o);
    if (r) {
      if (!r.ok && r.purpose === 'renew') noteExpired();
      else if (!r.ok) toast(r.error, { kind: 'error', timeout: 9000 });
      else if (r.kind === 'google' && r.purpose === 'connect') toast(r.drive ? 'Signed in with Google' : 'Signed in, but Drive wasn\'t allowed, so sync is off. Sign in again and tick the Drive box.', { kind: r.drive ? 'ok' : 'error', icon: Q.sprites.icon('cloud'), timeout: r.drive ? 4000 : 10000 });
      else if (r.kind === 'google' && r.purpose === 'calendar') {
        if (r.calendar) Q.sync.syncAll(true);
        else toast('Google didn\'t grant Calendar access. Turn it on again and tick both Calendar boxes.', { kind: 'error', timeout: 9000 });
      } else if (r.kind === 'spotify') { toast('Spotify account connected', { kind: 'ok' }); Q.spotify.refresh(); }
    }
    // Back on the tab after the hour ran out: renew quietly, unless you're in the middle of something.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || paused || !google || tokenFresh() || !Q.store.state.settings.google.connected) return;
      const busy = Q.ui.modalOpen() || Q.focus.isOpen() || (document.activeElement && document.activeElement.matches('input, textarea, select'));
      if (!busy) renewSilently();
    });
  }

  // On load: finish a sign-in reply, or renew an expired token before the app starts.
  const returned = readReturn().catch((e) => { result = { kind: 'google', ok: false, error: String(e.message || e) }; });
  if (!result && google && !tokenFresh() && !location.hash.includes('state=') && !new URLSearchParams(location.search).has('state')) {
    // Only when the save says we're signed in (the renewal reloads the page, so it happens before anything is on screen).
    let signedIn = false;
    try { signedIn = !!(JSON.parse(localStorage.getItem('questline-save-v1')) || { settings: {} }).settings.google.connected; } catch (e) { signedIn = false; }
    if (signedIn) renewSilently();
  }

  return {
    on: true, invoke, boot, afterStart, renewNow,
    get leaving() { return leaving; },
    get paused() { return paused; },
    /** True right after coming back from Google's sign-in for a new account (the first sync decides what to show). */
    get justSignedIn() { return !!(result && result.kind === 'google' && result.ok && result.purpose === 'connect'); },
    googleReady: () => !!CFG.googleClientId,
    spotifyRedirect: APP_URL,
    appUrl: APP_URL,
  };
})();
