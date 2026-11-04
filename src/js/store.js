'use strict';
/* Single source of truth: one JSON document, saved atomically (debounced). */

Q.store = (() => {
  const U = Q.util;
  const VERSION = 2;
  const listeners = new Set();
  let state = null;
  let undoSnap = null;

  const CATEGORIES = {
    home: { name: 'Home', stat: 'end', color: '#D9A86C' },
    health: { name: 'Health', stat: 'str', color: '#E8604C' },
    study: { name: 'Study', stat: 'int', color: '#3C82C8' },
    work: { name: 'Work', stat: 'int', color: '#5B6FB8' },
    errands: { name: 'Errands', stat: 'cha', color: '#F29A4E' },
    social: { name: 'Social', stat: 'cha', color: '#E879A8' },
    selfcare: { name: 'Self-care', stat: 'spi', color: '#2FA58A' },
    creative: { name: 'Creative', stat: 'spi', color: '#8E6BD1' },
  };

  function defaults() {
    const today = U.ymd(new Date());
    return {
      version: VERSION,
      createdAt: Date.now(),
      onboarded: false,
      demo: false,
      profile: { name: 'Trainer', outfit: 'classic', trainerId: String(10000 + Math.floor(Math.random() * 89999)) },
      hero: { level: 1, xp: 0, gold: 20, hp: 50, totalXp: 0 },
      stats: { str: 0, int: 0, end: 0, cha: 0, spi: 0 },
      pals: { owned: {}, team: [null, null, null], presets: [null, null, null], pulls: 0, evolutions: 0 },
      dailies: [],
      habits: [],
      reminders: [],
      events: [],
      rewards: [
        { id: U.uid(), title: 'Watch one episode', cost: 30 },
        { id: U.uid(), title: 'Order a treat', cost: 100 },
        { id: U.uid(), title: 'Guilt-free gaming hour', cost: 60 },
      ],
      inventory: { potion: 1, maxpotion: 0, shield: 1, charm: 0, ticket: 1 },
      owned: { skins: ['meadow', 'night'], scenes: ['meadow', 'rain'], outfits: ['classic'] },
      buffs: { charmUntil: 0, perfectDay: null },
      upgrades: {},
      boss: null,
      dailyBoss: null,
      achievements: {},
      counters: { completions: 0, remindersDone: 0, focusSessions: 0, focusMinutes: 0, perfectDays: 0, bossesDefeated: 0, dailyBossesDefeated: 0, faints: 0, drops: 0, maxStreak: 0, earlyBird: 0 },
      dayLog: {},
      log: [],
      day: { last: today, dropsToday: 0, dropsDate: today },
      lastAlarm: null,
      calCache: { google: [], ics: [], syncedAt: 0, error: null },
      focus: { work: 25, short: 5, long: 15, rounds: 4, scene: 'meadow', rain: false, lastTaskId: null },
      settings: {
        dayStart: 4,
        clock24: false,
        weekStart: 1,
        sounds: true,
        volume: 0.5,
        notifications: true,
        defaultLead: 10,
        quietOn: false,
        quietFrom: '23:00',
        quietTo: '07:00',
        muteInFocus: true,
        closeToTray: true,
        startMinimized: false,
        reducedMotion: false,
        haptics: true,
        uiScale: 100,
        skin: 'meadow',
        darkSkin: 'night',
        themeMode: 'light',
        fontStyle: 'mixed',
        inn: false,
        weekendMode: 'off',
        confirmDelete: true,
        autoUpdate: true,
        lastUpdateCheck: 0,
        showCompletedReminders: false,
        calView: 'month',
        calShowReminders: true,
        google: {
          clientId: '', clientSecret: '', connected: false, calendars: [], writeCalendar: 'primary', pushReminders: true, pushEvents: true,
          // Drive sync & backups (this device only; see cloud.js)
          calendarOn: null, syncOn: true, backupOn: true, folderId: '', backupsFolderId: '', syncFileId: '', syncVersion: '', lastSync: 0, lastBackupDay: '', editedAt: 0,
        },
        ics: [],
        spotify: { clientId: '', webConnected: false },
      },
    };
  }

  /* Fill any missing keys from defaults (forward-compatible saves). */
  function merge(base, saved) {
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return saved === undefined ? base : saved;
    const out = Object.assign({}, base);
    for (const k of Object.keys(saved || {})) {
      out[k] = (k in base) ? merge(base[k], saved[k]) : saved[k];
    }
    return out;
  }

  /** Bring older saves up to date. */
  function migrate(st) {
    for (const k of ['meadow', 'night']) if (!st.owned.skins.includes(k)) st.owned.skins.push(k);
    // v0.1 had one theme slot; "dusk" was its only dark theme.
    if (st.settings.skin === 'dusk') { st.settings.skin = 'meadow'; st.settings.darkSkin = 'dusk'; st.settings.themeMode = 'dark'; }
    // v0.3: the single companion becomes your first pal; berries (feeding) are gone.
    if (st.companion) {
      const c = st.companion;
      const species = Q.PALS.byId[c.species] ? c.species : 'sprigg';
      const defName = Q.PALS.byId[species].names[0];
      // companions earned half of your XP; pals earn all of it
      st.pals.owned = { [species]: { exp: Math.round((c.xp || 0) * 2), nick: c.name && c.name !== defName ? c.name : '', got: st.createdAt || Date.now(), seen: Q.pals.stageAt(species, Q.pals.level(species, Math.round((c.xp || 0) * 2))) } };
      st.pals.team = [species, null, null];
      delete st.companion;
    }
    if (st.inventory.berry !== undefined) {
      const refund = (st.inventory.berry || 0) * 10;
      if (refund) { st.hero.gold += refund; st.log.unshift({ t: Date.now(), text: `Berries were retired: +${refund} gold refunded.`, kind: 'shop' }); }
      delete st.inventory.berry;
    }
    if ((st.version || 1) < 2) {
      // (the free ticket arrives through defaults: older saves had no `ticket` key)
      st.log.unshift({ t: Date.now(), text: 'Pals have arrived! Here is a free Capsule Ticket.', kind: 'pal' });
      st.version = 2;
    }
    // never leave the team empty
    const ownedIds = Object.keys(st.pals.owned).filter((id) => Q.PALS.byId[id]);
    if (!ownedIds.length) st.pals.owned.sprigg = { exp: 0, nick: '', got: Date.now(), seen: 1 };
    st.pals.team = [0, 1, 2].map((i) => (st.pals.team[i] && st.pals.owned[st.pals.team[i]] ? st.pals.team[i] : null));
    if (!st.pals.team.some(Boolean)) st.pals.team[0] = Object.keys(st.pals.owned)[0];
    // v0.6: boss log, rebuilt from the activity log the first time.
    if (!st.bossLog || typeof st.bossLog !== 'object') {
      const byName = new Map(Q.PALS.BOSSES.map((b) => [b.name, b.id]));
      const log = {};
      const add = (name, what) => { const id = byName.get(name); if (!id) return; const e = log[id] || (log[id] = { met: 0, beat: 0, last: '' }); e[what]++; };
      for (const e of st.log || []) {
        const m = /^Defeated (.+?)! /.exec(e.text || ''); if (m) { add(m[1], 'beat'); add(m[1], 'met'); continue; }
        const s = /^(.+) slipped away at the end of the week\./.exec(e.text || ''); if (s) add(s[1], 'met');
      }
      const b = st.boss;
      if (b && b.id) {
        const e = log[b.id] || (log[b.id] = { met: 0, beat: 0, last: '' });
        if (!b.defeated) e.met++;
        else if (!e.beat) { e.beat = 1; e.met = Math.max(1, e.met); }
        e.last = b.week || '';
      }
      st.bossLog = log;
    }
    if (!Array.isArray(st.pals.presets) || st.pals.presets.length < 3) st.pals.presets = [0, 1, 2].map((i) => (st.pals.presets || [])[i] || null);
  }

  function emit(reason) { for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } } }

  const persist = U.debounce(() => {
    const day = U.ymd(new Date());
    Q.platform.save(JSON.stringify(state), day).catch((e) => console.error('save failed', e));
  }, 350);

  async function init() {
    let raw = null;
    try { raw = await Q.platform.load(); } catch (e) { console.error(e); }
    if (raw) {
      try { state = merge(defaults(), JSON.parse(raw)); } catch (e) { console.error('bad save, starting fresh', e); state = defaults(); }
    } else {
      state = defaults();
    }
    migrate(state);
    return state;
  }

  return {
    CATEGORIES,
    get state() { return state; },
    init,
    defaults,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Call after mutating state. */
    commit(reason = 'change') { persist(); emit(reason); },
    saveNow() { Q.platform.save(JSON.stringify(state), U.ymd(new Date())); },
    replace(next, reason = 'replace') { state = merge(defaults(), next); migrate(state); persist(); emit(reason); },
    snapshot() { undoSnap = JSON.stringify(state); },
    undo() {
      if (!undoSnap) return false;
      state = JSON.parse(undoSnap); undoSnap = null; persist(); emit('undo'); return true;
    },
    exportJson: () => JSON.stringify(state, null, 2),
    log(text, kind = 'info', extra = {}) {
      state.log.unshift(Object.assign({ t: Date.now(), text, kind }, extra));
      if (state.log.length > 150) state.log.length = 150;
    },
  };
})();
