'use strict';
/*
 * In-app updates. Checks GitHub Releases shortly after start and every
 * 6 hours (if enabled), offers the update in a toast, and shows download
 * progress. The signature check and the actual install happen in Rust
 * (src-tauri/src/updater.rs). On Android the APK is downloaded the same way
 * and then handed to Android's installer, which asks you to confirm.
 *
 * "What's new": the notes of the installed version come from its GitHub
 * release, are cached on this device, and are shown once after an update.
 */

Q.updates = (() => {
  const U = Q.util;
  const P = Q.platform;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const RELEASES_URL = 'https://github.com/Ishaan415/questline/releases';
  let version = '';
  let available = null;
  let checking = false;
  let lastError = null;
  let offeredVersion = null;
  let current = null; // { version, notes, date, url } for the installed version
  const NOTES_KEY = 'questline.releaseNotes';
  const SEEN_KEY = 'questline.lastVersion';
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  /** Release notes are a commit message: plain lines and "- " bullets. */
  function notesHtml(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n')
      .filter((l) => !/^\s*(co-authored-by|claude-session|signed-off-by)\s*:/i.test(l));
    const inline = (s) => U.esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    let out = ''; let list = false;
    for (const raw of lines) {
      const l = raw.trim();
      const bullet = /^[-*•]\s+(.*)$/.exec(l);
      if (bullet) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(bullet[1])}</li>`; continue; }
      if (list) { out += '</ul>'; list = false; }
      if (!l) continue;
      const head = /^#{1,4}\s+(.*)$/.exec(l) || (/:$/.test(l) && l.length < 60 ? [l, l.replace(/:$/, '')] : null);
      out += head ? `<h4>${inline(head[1])}</h4>` : `<p>${inline(l)}</p>`;
    }
    if (list) out += '</ul>';
    return out || '<p>Bug fixes and improvements.</p>';
  }

  async function loadNotes() {
    const cached = ls.get(NOTES_KEY);
    if (cached && cached.version === version && cached.notes) current = cached;
    if (current) return current;
    try {
      const r = await P.invoke('release_notes', { version });
      if (r && r.notes) { current = r; if (r.version === version) ls.set(NOTES_KEY, r); }
    } catch (e) { /* offline: try again next start */ }
    rerender();
    return current;
  }

  function showCurrentNotes() {
    if (!current) return;
    Q.ui.modal({
      title: `What's new in v${U.esc(current.version)}`, cls: 'modal-small',
      body: `<div class="update-notes">${notesHtml(current.notes)}</div>
        ${current.version !== version ? `<p class="small muted">Notes for the newest release; you have v${U.esc(version)}.</p>` : ''}
        <div class="modal-actions"><span class="spacer"></span><button class="btn btn-primary" data-close>Nice</button></div>`,
    });
  }

  async function init() {
    try { version = P.isApp ? await P.invoke('plugin:app|version') : '0.1.0 (web preview)'; } catch (e) { version = '?'; }
    if (!P.isApp) return;
    P.listen('update-progress', onProgress);
    // One "Updated to vX" note after an update (not on a fresh install).
    const seen = ls.get(SEEN_KEY);
    ls.set(SEEN_KEY, version);
    loadNotes().then(() => {
      if (!seen || seen === version) return;
      Q.ui.toast(`Updated to v${version}.`, { kind: 'badge', icon: I('star'), timeout: 12000, actions: current ? [{ label: "See what's new", fn: showCurrentNotes }] : [] });
    });
    setTimeout(() => { if (S().settings.autoUpdate) check(); }, 15000);
    setInterval(() => { if (S().settings.autoUpdate) check(); }, 6 * 3600000);
  }

  async function check({ manual = false } = {}) {
    if (!P.isApp) {
      if (manual) Q.ui.toast('Updates are checked in the desktop app.');
      return null;
    }
    if (checking) return null;
    checking = true; lastError = null;
    rerender();
    try {
      available = await P.invoke('update_check');
      S().settings.lastUpdateCheck = Date.now();
      Q.store.commit('update-check');
      if (available && (manual || offeredVersion !== available.version)) offer(available);
      else if (manual && !available) Q.ui.toast(`You're on the latest version (v${version}).`, { kind: 'ok' });
    } catch (e) {
      lastError = String(e);
      if (manual) Q.ui.toast(`Couldn't check for updates: ${lastError}`, { kind: 'error', timeout: 8000 });
    } finally {
      checking = false;
      rerender();
    }
    return available;
  }

  function offer(info) {
    offeredVersion = info.version;
    Q.sfx.drop();
    Q.ui.toast(`Questline v${info.version} is ready to install.`, {
      kind: 'badge', icon: I('star'), timeout: 0,
      actions: [{ label: 'Update now', fn: install }, { label: "What's new", fn: () => notes(info) }],
    });
  }

  function notes(info) {
    Q.ui.modal({
      title: `What's new in v${info.version}`, cls: 'modal-small',
      body: `<div class="update-notes">${notesHtml(info.notes)}</div>
        <p class="small muted">You have v${U.esc(info.current_version)}.</p>
        <div class="modal-actions"><button class="btn" data-close>Later</button><span class="spacer"></span><button class="btn btn-primary" data-go>Update now</button></div>`,
      onMount(m, close) { m.querySelector('[data-go]').onclick = () => { close(); install(); }; },
    });
  }

  let progressModal = null;
  async function install() {
    if (!available) return;
    if (Q.focus.isRunning()) Q.ui.toast('Heads up: updating restarts Questline and stops the focus timer.');
    Q.store.saveNow();
    progressModal = Q.ui.modal({
      title: `Updating to v${available.version}`, cls: 'modal-small', dismissable: false,
      body: `<p class="dialog-text">${P.isAndroid ? 'Downloading the update. Android will then ask you to install it: tap Update, and Questline reopens with everything kept.' : 'Downloading the update. Questline will close, install it, and open again by itself.'}</p>
        <div class="bar-row"><div class="bar bar-xp"><div class="bar-fill" id="upd-fill" style="width:0%"></div></div><span class="bar-num" id="upd-num">0%</span></div>`,
    });
    try {
      await P.invoke('update_install');
      // Android: the installer is open now; this app stays behind it.
      if (P.isAndroid && progressModal) { progressModal(); progressModal = null; }
    } catch (e) {
      if (progressModal) { progressModal(); progressModal = null; }
      Q.ui.toast(String(e), { kind: 'error', timeout: 10000 });
    }
  }

  function onProgress({ downloaded, total }) {
    const fill = document.getElementById('upd-fill');
    const num = document.getElementById('upd-num');
    if (!fill) return;
    const pct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
    fill.style.width = `${pct}%`;
    num.textContent = total ? `${pct}%` : `${(downloaded / 1048576).toFixed(1)} MB`;
  }

  function rerender() { if (Q.app.current() === 'settings') Q.app.render(); }

  /** Markup for the Settings page. */
  function panel() {
    const st = S();
    const last = st.settings.lastUpdateCheck;
    let status;
    if (!P.isApp) status = 'The app checks GitHub for new versions.';
    else if (checking) status = 'Checking…';
    else if (available) status = `<b>v${U.esc(available.version)} is available.</b>`;
    else if (lastError) status = `<span class="err">Last check failed: ${U.esc(lastError)}</span>`;
    else status = last ? `Up to date · checked ${U.rel(new Date(last))}` : 'Not checked yet';
    return `
      <div class="toggle-row"><span><b>Version ${U.esc(version)}</b><span class="small muted">${status}</span></span>
        ${available ? `<button class="btn btn-small btn-primary" data-act="upd-install">Update now</button>` : `<button class="btn btn-small" data-act="upd-check" ${checking || !P.isApp ? 'disabled' : ''}>${I('sync')} Check now</button>`}</div>
      <label class="toggle-row"><span><b>Check automatically</b><span class="small muted">On start and every 6 hours. Nothing installs without your ${P.isPhone ? 'tap' : 'click'}.</span></span>
        <input type="checkbox" class="switch" data-change="set" data-path="settings.autoUpdate" ${st.settings.autoUpdate ? 'checked' : ''}></label>
 ${current ? `<details class="whats-new"><summary><b>What's new in v${U.esc(current.version)}</b>${current.date ? `<span class="small muted"> · ${U.esc(new Date(current.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>` : ''}</summary>
        <div class="update-notes">${notesHtml(current.notes)}</div></details>` : ''}
      <div class="row-btns"><a class="link" href="${RELEASES_URL}" target="_blank" rel="noopener" data-act="upd-releases">${I('list')} Release history</a></div>`;
  }

  function bind() {
    Q.ui.on('upd-check', () => check({ manual: true }));
    Q.ui.on('upd-install', () => (available ? notes(available) : null));
    Q.ui.on('upd-releases', () => P.openExternal(RELEASES_URL));
  }

  return {
    init, check, install, panel, bind, version: () => version, notesHtml, showNotes: showCurrentNotes,
    /** Web preview / tests: show these notes as if they came from GitHub. */
    previewNotes(n) { current = n; rerender(); },
  };
})();
