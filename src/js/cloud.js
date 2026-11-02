'use strict';
/*
 * Google Drive sync and backups.
 *
 * Drive layout (a normal, visible folder; Questline can only see what it made):
 *   My Drive/Questline/questline-sync.json      the shared save all devices merge into
 *   My Drive/Questline/Backups/questline-YYYY-MM-DD.json   one per day, last 30 kept
 *
 * Sync = pull, three-way merge (merge.js), push. "base" is the last version
 * this device and Drive agreed on, kept in a side file. Device-only things
 * (window, sound, theme, notifications, sign-ins, calendar cache) never sync.
 */

Q.cloud = (() => {
  const U = Q.util;
  const P = Q.platform;
  const M = Q.merge;
  const S = () => Q.store.state;
  const G = () => S().settings.google;

  const FOLDER = 'Questline';
  const BACKUPS = 'Backups';
  const SYNC_FILE = 'questline-sync.json';
  const KEEP_BACKUPS = 30;
  const AFTER_CHANGE = 15000;     // sync this long after your last change
  const EVERY = 3 * 60000;        // and every 3 minutes while the app is visible

  /** Never synced: per-device or derived. */
  const LOCAL_TOP = ['calCache', 'lastAlarm', 'demo'];
  const LOCAL_SETTINGS = ['closeToTray', 'startMinimized', 'uiScale', 'sounds', 'volume', 'notifications', 'muteInFocus',
    'quietOn', 'quietFrom', 'quietTo', 'autoUpdate', 'lastUpdateCheck', 'google', 'spotify', 'reducedMotion',
    'themeMode', 'skin', 'darkSkin', 'fontStyle', 'calView', 'showCompletedReminders'];

  let account = null;            // { connected, email, name, calendar, drive }
  let base; let baseLoaded = false;
  let busy = false; let again = false; let applying = false;
  let timer = null;
  let status = { state: 'off', msg: '' };
  let ready = false;             // first pull finished (or skipped)

  const deviceName = () => (P.isApp ? (/android/i.test(navigator.userAgent) ? 'Android phone' : 'Windows PC') : 'Web preview');
  const canDrive = () => P.isApp && G().connected && account && account.connected && account.drive;
  const syncOn = () => canDrive() && G().syncOn !== false;

  /* ------------------------------------------------------------ helpers */
  function payload(st) {
    const o = M.clone(st);
    for (const k of LOCAL_TOP) delete o[k];
    for (const k of LOCAL_SETTINGS) delete o.settings[k];
    o._meta = { editedAt: G().editedAt || st.createdAt || 0, device: deviceName() };
    return o;
  }
  const strip = (o) => { const c = M.clone(o); delete c._meta; return c; };

  /** Put a merged save into the app, keeping this device's own settings. */
  function apply(remote) {
    const st = S();
    const next = strip(remote);
    for (const k of LOCAL_TOP) next[k] = M.clone(st[k]);
    next.settings = Object.assign(next.settings || {}, Object.fromEntries(LOCAL_SETTINGS.map((k) => [k, M.clone(st.settings[k])])));
    applying = true;
    try { Q.store.replace(next, 'cloud'); } finally { applying = false; }
  }

  async function loadBase() {
    if (baseLoaded) return;
    try { const raw = await P.loadExtra('sync-base'); base = raw ? JSON.parse(raw) : null; } catch (e) { base = null; }
    baseLoaded = true;
  }
  async function setBase(obj, file) {
    base = obj;
    G().syncVersion = file.version; G().syncFileId = file.id;
    await P.saveExtra('sync-base', JSON.stringify(obj));
    Q.store.commit('cloud');
  }

  function setStatus(state, msg = '') {
    status = { state, msg };
    const b = document.getElementById('tb-cloud');
    if (!b) return;
    b.className = `tb-btn tb-cloud cloud-${state}`;
    b.hidden = state === 'off';
    b.title = { ok: `Synced with Google Drive${G().lastSync ? ` · ${U.rel(new Date(G().lastSync))}` : ''}`, syncing: 'Syncing with Google Drive…', error: `Sync problem: ${msg}`, paused: 'Drive sync is off (backups only)' }[state] || '';
  }

  async function ensureFolders() {
    const g = G();
    if (!g.folderId) { g.folderId = await P.invoke('drive_ensure_folder', { name: FOLDER, parent: null }); Q.store.commit('cloud'); }
    return g.folderId;
  }
  /** Retry once with fresh folder ids if the user deleted or moved the folder. */
  async function withFolder(fn) {
    try { return await fn(await ensureFolders()); }
    catch (e) {
      if (!/404|not found/i.test(String(e))) throw e;
      G().folderId = ''; G().backupsFolderId = ''; G().syncFileId = ''; G().syncVersion = '';
      return fn(await ensureFolders());
    }
  }

  const write = (id, folder, name, obj) => P.invoke('drive_write', { id: id || null, name, parent: folder, content: JSON.stringify(obj) });

  /* ------------------------------------------------------- first sync */
  const looksFresh = (st) => !st.counters.completions && !st.dailies.length && !st.reminders.length && st.hero.level <= 1;
  const summary = (o) => `Level ${o.hero.level} · ${o.hero.gold} gold · ${o.dailies.length} dailies · ${Object.keys((o.pals || {}).owned || {}).length} pals`;

  function firstSyncChoice(local, remote) {
    if (looksFresh(S())) return Promise.resolve('cloud');
    return new Promise((resolve) => {
      let done = false;
      const pick = (v) => { if (!done) { done = true; resolve(v); } };
      Q.ui.modal({
        title: 'Progress found in Google Drive', cls: 'modal-form',
        body: `<p>Questline is already saved in your Drive, and this device has its own progress. Which one should both use from now on?</p>
          <div class="sync-choice">
            <button class="sync-opt" data-c="cloud"><b>${Q.sprites.icon('cloud')} Use the Drive copy</b><span class="small">${U.esc(summary(remote))}</span><span class="small muted">Last changed on ${U.esc((remote._meta && remote._meta.device) || 'another device')}${remote._meta && remote._meta.editedAt ? `, ${U.esc(U.rel(new Date(remote._meta.editedAt)))}` : ''}</span></button>
            <button class="sync-opt" data-c="device"><b>${Q.sprites.icon('home')} Use this device's copy</b><span class="small">${U.esc(summary(local))}</span><span class="small muted">Replaces the Drive copy</span></button>
          </div>
          <p class="small muted">The other copy isn't thrown away: a backup of it goes to Drive → Questline → Backups first.</p>
          <div class="modal-actions"><span class="spacer"></span><button class="btn" data-c="cancel">Decide later</button></div>`,
        onMount(m, close) { m.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { pick(b.dataset.c); close(); }; }); },
        onClose: () => pick('cancel'),
      });
    });
  }

  /* ------------------------------------------------------------- sync */
  async function syncNow({ manual = false } = {}) {
    if (!syncOn()) {
      if (manual) Q.ui.toast(canDrive() ? 'Sync is turned off in Settings.' : 'Sign in with Google in Settings to sync.', { kind: 'info' });
      return false;
    }
    if (busy) { again = true; return false; }
    busy = true; clearTimeout(timer);
    setStatus('syncing');
    try {
      await loadBase();
      await withFolder(async (folder) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const meta = await P.invoke('drive_find', { name: SYNC_FILE, parent: folder });
          const local = payload(S());
          if (!meta) { // first device to sync
            await setBase(local, await write(null, folder, SYNC_FILE, local));
            return;
          }
          const remoteSame = base && meta.version === G().syncVersion;
          if (remoteSame && M.eq(strip(local), strip(base))) return; // nothing new on either side
          const remote = remoteSame ? base : JSON.parse((await P.invoke('drive_read', { id: meta.id })).content);
          if (!base) {
            const choice = await firstSyncChoice(local, remote);
            if (choice === 'cancel') { G().syncOn = false; Q.store.commit('cloud'); return; }
            if (!(choice === 'cloud' && looksFresh(S()))) await backupNow({ quiet: true, obj: choice === 'cloud' ? local : remote, tag: choice === 'cloud' ? 'this-device' : 'drive' });
            if (choice === 'cloud') { apply(remote); await setBase(remote, meta); }
            else await setBase(local, await write(meta.id, folder, SYNC_FILE, local));
            return;
          }
          const merged = M.merge3(base, local, remote, {
            xpToNext: Q.game.xpToNext,
            maxHp: (o) => 50 + Q.game.statLevel((o.stats && o.stats.str) || 0) * 2,
          });
          if (!M.eq(strip(merged), strip(local))) apply(merged);
          if (M.eq(strip(merged), strip(remote))) { await setBase(merged, meta); return; }
          // Someone uploaded while we merged? Start over with their version.
          const now = await P.invoke('drive_find', { name: SYNC_FILE, parent: folder });
          if (now && now.version !== meta.version) continue;
          await setBase(merged, await write(meta.id, folder, SYNC_FILE, merged));
          return;
        }
      });
      G().lastSync = Date.now(); Q.store.commit('cloud');
      setStatus('ok');
      if (manual) Q.ui.toast('Synced with Google Drive', { kind: 'ok', icon: Q.sprites.icon('cloud') });
      maybeDailyBackup();
      return true;
    } catch (e) {
      setStatus('error', String(e));
      if (manual) Q.ui.toast(String(e), { kind: 'error', timeout: 8000 });
      return false;
    } finally {
      busy = false;
      if (again) { again = false; schedule(2000); }
    }
  }

  function schedule(ms = AFTER_CHANGE) {
    clearTimeout(timer);
    if (syncOn()) timer = setTimeout(() => syncNow(), ms);
  }

  /* ----------------------------------------------------------- backups */
  async function backupsFolder() {
    return withFolder(async (folder) => {
      const g = G();
      if (!g.backupsFolderId) { g.backupsFolderId = await P.invoke('drive_ensure_folder', { name: BACKUPS, parent: folder }); Q.store.commit('cloud'); }
      return g.backupsFolderId;
    });
  }

  async function backupNow({ quiet = false, obj = null, tag = '' } = {}) {
    if (!canDrive()) { if (!quiet) Q.ui.toast('Sign in with Google in Settings first.', { kind: 'info' }); return false; }
    try {
      const folder = await backupsFolder();
      const name = `questline-${U.ymd(new Date())}${tag ? `-${tag}` : ''}.json`;
      const existing = await P.invoke('drive_find', { name, parent: folder });
      await write(existing && existing.id, folder, name, obj || payload(S()));
      const list = await P.invoke('drive_list', { parent: folder });
      const daily = list.filter((f) => /^questline-\d{4}-\d{2}-\d{2}(-[a-z-]+)?\.json$/.test(f.name));
      for (const f of daily.slice(KEEP_BACKUPS)) await P.invoke('drive_trash', { id: f.id }).catch(() => {});
      if (!tag) { G().lastBackupDay = U.ymd(new Date()); Q.store.commit('cloud'); }
      if (!quiet) Q.ui.toast('Backed up to Google Drive', { kind: 'ok', icon: Q.sprites.icon('cloud') });
      return true;
    } catch (e) {
      if (!quiet) Q.ui.toast(String(e), { kind: 'error', timeout: 8000 });
      return false;
    }
  }
  function maybeDailyBackup() {
    if (canDrive() && G().backupOn !== false && G().lastBackupDay !== U.ymd(new Date())) backupNow({ quiet: true });
  }

  const listBackups = async () => P.invoke('drive_list', { parent: await backupsFolder() });

  /** Replace progress everywhere with a backup (this device first, then Drive). */
  async function restore(id) {
    const raw = await P.invoke('drive_read', { id });
    const data = JSON.parse(raw.content);
    if (!data || !data.hero || !Array.isArray(data.dailies)) throw new Error('That file isn\'t a Questline backup.');
    await backupNow({ quiet: true, tag: 'before-restore' });
    G().editedAt = Date.now();
    apply(data);
    if (syncOn()) {
      await withFolder(async (folder) => {
        const meta = await P.invoke('drive_find', { name: SYNC_FILE, parent: folder });
        const local = payload(S());
        await setBase(local, await write(meta && meta.id, folder, SYNC_FILE, local));
      });
      G().lastSync = Date.now(); Q.store.commit('cloud');
      setStatus('ok');
    }
  }

  /* ----------------------------------------------------------- account */
  async function refreshAccount() {
    if (!P.isApp || !G().connected) { account = null; setStatus('off'); return null; }
    try { account = await P.invoke('google_account'); } catch (e) { account = null; }
    if (account && !account.connected) { G().connected = false; Q.store.commit('cloud'); }
    setStatus(syncOn() ? (status.state === 'off' ? 'ok' : status.state) : canDrive() ? 'paused' : 'off');
    return account;
  }

  async function forget() {
    account = null; base = null; baseLoaded = true;
    Object.assign(G(), { folderId: '', backupsFolderId: '', syncFileId: '', syncVersion: '', lastSync: 0 });
    try { await P.saveExtra('sync-base', ''); } catch (e) { /* ignore */ }
    setStatus('off');
  }

  /* -------------------------------------------------------------- boot */
  /** Called before the day rollover so two devices never both settle the same day. */
  async function start() {
    try { await startInner(); } finally { ready = true; }
  }
  async function startInner() {
    Q.store.on((reason) => {
      if (applying || reason === 'cloud' || reason === 'sync-start' || reason === 'replace-quiet') return;
      G().editedAt = Date.now();
      schedule();
    });
    if (!P.isApp) return;
    await refreshAccount();
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, EVERY);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - (G().lastSync || 0) > 60000) syncNow();
    });
    if (syncOn()) await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 8000))]);
    else maybeDailyBackup();
  }

  return {
    start, ready: () => ready, syncNow, backupNow, listBackups, restore, refreshAccount, forget,
    account: () => account, status: () => status, canDrive, syncOn,
    driveFolderUrl: () => (G().folderId ? `https://drive.google.com/drive/folders/${G().folderId}` : 'https://drive.google.com/drive/my-drive'),
    // for tests
    _payload: payload, _apply: apply,
  };
})();
