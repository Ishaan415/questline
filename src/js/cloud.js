'use strict';
/*
 * Google Drive sync and backups.
 *
 * Drive layout (a normal, visible folder; Questline can only see what it made):
 *   My Drive/Questline/questline-sync.json      the shared save all devices merge into
 *   My Drive/Questline/Backups/questline-YYYY-MM-DD-HHMM.json   never overwritten, last 40 kept
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
  const KEEP_BACKUPS = 40;
  const AFTER_CHANGE = 15000;     // sync this long after your last change
  const EVERY = 3 * 60000;        // and every 3 minutes while the app is visible

  /** Never synced: per-device or derived. */
  const LOCAL_TOP = ['calCache', 'lastAlarm', 'demo'];
  const LOCAL_SETTINGS = ['closeToTray', 'startMinimized', 'uiScale', 'sounds', 'volume', 'notifications', 'muteInFocus',
    'quietOn', 'quietFrom', 'quietTo', 'autoUpdate', 'lastUpdateCheck', 'google', 'spotify', 'reducedMotion',
    'themeMode', 'skin', 'darkSkin', 'fontStyle', 'calView', 'showCompletedReminders', 'haptics'];
  /** Device settings worth bringing back when you restore a backup (not synced live). */
  const PORTABLE = ['themeMode', 'skin', 'darkSkin', 'fontStyle', 'sounds', 'volume', 'notifications', 'muteInFocus',
    'quietOn', 'quietFrom', 'quietTo', 'reducedMotion', 'uiScale', 'calView', 'showCompletedReminders', 'haptics'];

  let account = null;            // { connected, email, name, calendar, drive }
  let base; let baseLoaded = false;
  let busy = false; let again = false; let applying = false;
  let timer = null;
  let status = { state: 'off', msg: '' };
  let ready = false;             // first pull finished (or skipped)

  const deviceName = () => (P.isApp ? (/android/i.test(navigator.userAgent) ? 'Android phone' : 'Windows PC') : P.isWeb ? (P.isPhone ? 'phone browser' : 'web browser') : 'Web preview');
  const canDrive = () => !P.isDemo && G().connected && account && account.connected && account.drive;
  const syncOn = () => canDrive() && G().syncOn !== false;

  /* ------------------------------------------------------------ helpers */
  function payload(st) {
    const o = M.clone(st);
    for (const k of LOCAL_TOP) delete o[k];
    for (const k of LOCAL_SETTINGS) delete o.settings[k];
    // Your Spotify app's Client ID follows you (the sign-in itself stays on each device).
    if (st.settings.spotify && st.settings.spotify.clientId) o.settings.spotifyClientId = st.settings.spotify.clientId;
    o._meta = { editedAt: G().editedAt || st.createdAt || 0, device: deviceName() };
    return o;
  }
  /** Backups also carry this device's look & sound, so a restore brings them back. */
  function backupPayload(st) {
    const o = payload(st);
    o._prefs = Object.fromEntries(PORTABLE.filter((k) => st.settings[k] !== undefined).map((k) => [k, M.clone(st.settings[k])]));
    return o;
  }
  const strip = (o) => { const c = M.clone(o); delete c._meta; delete c._prefs; return c; };

  /** Put a merged save into the app, keeping this device's own settings.
   *  With prefs: also take the backup's look & sound (restores). */
  function apply(remote, { prefs = false } = {}) {
    const st = S();
    const next = strip(remote);
    for (const k of LOCAL_TOP) next[k] = M.clone(st[k]);
    const sets = next.settings || {};
    const spId = sets.spotifyClientId;
    delete sets.spotifyClientId;
    next.settings = Object.assign(sets, Object.fromEntries(LOCAL_SETTINGS.map((k) => [k, M.clone(st.settings[k])])));
    if (prefs && remote._prefs) for (const k of PORTABLE) if (remote._prefs[k] !== undefined) next.settings[k] = M.clone(remote._prefs[k]);
    if (spId && !(next.settings.spotify && next.settings.spotify.clientId)) next.settings.spotify = Object.assign({}, next.settings.spotify, { clientId: spId });
    applying = true;
    try { Q.store.replace(next, 'cloud'); } finally { applying = false; }
    if (prefs) Q.app.applySettings();
  }

  /** How much is in a save: used to spot wipes and to describe backups. */
  const itemCount = (o) => ['dailies', 'reminders', 'habits', 'events'].reduce((n, k) => n + ((o && o[k]) || []).length, 0);

  async function loadBase() {
    if (baseLoaded) return;
    try { const raw = await P.loadExtra('sync-base'); base = raw ? JSON.parse(raw) : null; } catch (e) { base = null; }
    baseLoaded = true;
  }
  /**
   * The base only means something for the save it was made from. After
   * "Start over", a reinstall, or a sign-in on a fresh save, an old base would
   * make the merge read every missing task as "deleted here", so drop it and
   * treat the sync as a first sync instead.
   */
  function baseFits(local) {
    if (!base) return false;
    if (base.createdAt !== local.createdAt) return false;
    if (!G().syncFileId) return false;
    return true;
  }
  /** Forget the base (e.g. after Start over). */
  async function dropBase() {
    base = null; baseLoaded = true;
    try { await P.saveExtra('sync-base', ''); } catch (e) { /* ignore */ }
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
          if (base && !baseFits(local)) base = null;
          const remoteSame = base && meta.version === G().syncVersion;
          if (remoteSame && M.eq(strip(local), strip(base))) return; // nothing new on either side
          const remote = remoteSame ? base : JSON.parse((await P.invoke('drive_read', { id: meta.id })).content);
          if (!base) {
            const choice = await firstSyncChoice(local, remote);
            if (choice === 'cancel') { G().syncOn = false; Q.store.commit('cloud'); return; }
            if (!(choice === 'cloud' && looksFresh(S()))) await backupNow({ quiet: true, obj: choice === 'cloud' ? local : remote, tag: choice === 'cloud' ? 'this-device' : 'drive' });
            if (choice === 'cloud') {
              const fresh = looksFresh(S());
              apply(remote);
              await setBase(remote, meta);
              if (fresh) await lookFromBackups();
              if (fresh && itemCount(remote)) Q.ui.toast(`Your progress is back from Google Drive: ${summary(remote)}.`, { kind: 'ok', icon: Q.sprites.icon('cloud'), timeout: 7000 });
            }
            else await setBase(local, await write(meta.id, folder, SYNC_FILE, local));
            return;
          }
          const merged = M.merge3(base, local, remote, {
            xpToNext: Q.game.xpToNext,
            maxHp: (o) => 50 + Q.game.statLevel((o.stats && o.stats.str) || 0) * 2 + (((o.upgrades || {}).vitality) || 0) * 5,
          });
          // Safety net: if this merge would remove most of Drive's tasks, keep a copy first.
          const had = itemCount(remote);
          if (had >= 3 && itemCount(merged) < had / 2) await backupNow({ quiet: true, obj: remote, tag: 'before-big-change' });
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
      // Every backup is a new file (date + time): a later, emptier save can never replace a good one.
      const now = new Date();
      const name = `questline-${U.ymd(now)}-${U.pad(now.getHours())}${U.pad(now.getMinutes())}${tag ? `-${tag}` : ''}.json`;
      await write(null, folder, name, obj || backupPayload(S()));
      const list = (await P.invoke('drive_list', { parent: folder }))
        .filter((f) => /^questline-\d{4}-\d{2}-\d{2}(-\d{4})?(-[a-z-]+)?\.json$/.test(f.name))
        .sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
      for (const f of list.slice(KEEP_BACKUPS)) await P.invoke('drive_trash', { id: f.id }).catch(() => {});
      if (!tag) { G().lastBackupDay = U.ymd(new Date()); Q.store.commit('cloud'); }
      if (!quiet) Q.ui.toast('Backed up to Google Drive', { kind: 'ok', icon: Q.sprites.icon('cloud') });
      return true;
    } catch (e) {
      if (!quiet) Q.ui.toast(String(e), { kind: 'error', timeout: 8000 });
      return false;
    }
  }
  let dailyRunning = false;
  async function maybeDailyBackup() {
    // A brand-new, empty save isn't worth a backup (and would only crowd out real ones).
    if (dailyRunning || !canDrive() || G().backupOn === false || G().lastBackupDay === U.ymd(new Date()) || looksFresh(S())) return;
    dailyRunning = true;
    try { await backupNow({ quiet: true }); } finally { dailyRunning = false; }
  }

  /** Backups newest first, each with a short description of what's inside. */
  async function listBackups() {
    const list = (await P.invoke('drive_list', { parent: await backupsFolder() }))
      .filter((f) => /\.json$/.test(f.name))
      .sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
    await Promise.all(list.map(async (f) => {
      try {
        const o = JSON.parse((await P.invoke('drive_read', { id: f.id })).content);
        f.summary = `Lv ${o.hero.level} · ${o.dailies.length} dailies · ${(o.reminders || []).length} reminders · ${o.hero.gold} gold`;
        f.device = (o._meta && o._meta.device) || '';
        f.items = itemCount(o);
      } catch (e) { f.summary = 'Couldn\'t read this file'; f.items = -1; }
    }));
    return list;
  }

  /** A fresh device also takes the look & sound from your newest backup (they don't sync live). */
  async function lookFromBackups() {
    try {
      const list = (await P.invoke('drive_list', { parent: await backupsFolder() }))
        .filter((f) => /\.json$/.test(f.name))
        .sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
      for (const f of list.slice(0, 5)) {
        const o = JSON.parse((await P.invoke('drive_read', { id: f.id })).content);
        if (!o || !o._prefs) continue;
        const sets = S().settings;
        for (const k of PORTABLE) if (o._prefs[k] !== undefined) sets[k] = M.clone(o._prefs[k]);
        applying = true;
        try { Q.store.commit('cloud'); } finally { applying = false; }
        Q.app.applySettings();
        return;
      }
    } catch (e) { /* the look is a nice-to-have */ }
  }

  /** Take this device's save as the truth everywhere (after a restore or an import). */
  async function adoptLocal() {
    G().editedAt = Date.now();
    if (!syncOn()) { await dropBase(); return; }
    await withFolder(async (folder) => {
      const meta = await P.invoke('drive_find', { name: SYNC_FILE, parent: folder });
      const local = payload(S());
      await setBase(local, await write(meta && meta.id, folder, SYNC_FILE, local));
    });
    G().lastSync = Date.now(); Q.store.commit('cloud');
    setStatus('ok');
  }

  /** Import a backup file (Settings → Import): same as a restore, from a file. */
  async function importSave(data) {
    if (!data || !data.hero || !Array.isArray(data.dailies)) throw new Error('Not a Questline backup');
    const o = M.clone(data);
    const sets = o.settings || {};
    o._prefs = Object.fromEntries(PORTABLE.filter((k) => sets[k] !== undefined).map((k) => [k, sets[k]]));
    if (sets.spotify && sets.spotify.clientId) sets.spotifyClientId = sets.spotify.clientId;
    if (canDrive() && !looksFresh(S())) await backupNow({ quiet: true, tag: 'before-import' });
    apply(o, { prefs: true });
    await adoptLocal();
  }

  /** Replace progress everywhere with a backup (this device first, then Drive). */
  async function restore(id) {
    const raw = await P.invoke('drive_read', { id });
    const data = JSON.parse(raw.content);
    if (!data || !data.hero || !Array.isArray(data.dailies)) throw new Error('That file isn\'t a Questline backup.');
    if (!looksFresh(S())) await backupNow({ quiet: true, tag: 'before-restore' });
    apply(data, { prefs: true });
    await adoptLocal();
    return data;
  }

  /* ----------------------------------------------------------- account */
  async function refreshAccount() {
    if (P.isDemo || !G().connected) { account = null; setStatus('off'); return null; }
    try { account = await P.invoke('google_account'); } catch (e) { account = null; }
    if (account && !account.connected) { G().connected = false; Q.store.commit('cloud'); }
    // Sign-ins from before Calendar became optional already allowed it: keep it on.
    if (account && account.connected && (G().calendarOn === null || G().calendarOn === undefined)) { G().calendarOn = !!account.calendar; Q.store.commit('cloud'); }
    setStatus(syncOn() ? (status.state === 'off' ? 'ok' : status.state) : canDrive() ? 'paused' : 'off');
    return account;
  }

  async function forget() {
    account = null;
    Object.assign(G(), { folderId: '', backupsFolderId: '', syncFileId: '', syncVersion: '', lastSync: 0 });
    await dropBase();
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
    if (P.isDemo) return;
    await refreshAccount();
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, EVERY);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - (G().lastSync || 0) > 60000) syncNow();
    });
    if (syncOn()) await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 8000))]);
    else maybeDailyBackup();
  }

  return {
    start, ready: () => ready, syncNow, backupNow, listBackups, restore, importSave, adoptLocal, dropBase, refreshAccount, forget, summary,
    account: () => account, status: () => status, canDrive, syncOn,
    driveFolderUrl: () => (G().folderId ? `https://drive.google.com/drive/folders/${G().folderId}` : 'https://drive.google.com/drive/my-drive'),
    // for tests
    _payload: payload, _apply: apply,
  };
})();
