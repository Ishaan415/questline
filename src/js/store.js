'use strict';
/* Single source of truth: one JSON document, saved atomically (debounced). */

Q.store = (() => {
  const U = Q.util;
  const VERSION = 1;
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
      companion: { species: 'sprigg', name: 'Sprigg', xp: 0, friendship: 0, lastFed: null },
      dailies: [],
      habits: [],
      reminders: [],
      events: [],
      rewards: [
        { id: U.uid(), title: 'Watch one episode', cost: 30 },
        { id: U.uid(), title: 'Order a treat', cost: 100 },
        { id: U.uid(), title: 'Guilt-free gaming hour', cost: 60 },
      ],
      inventory: { potion: 1, maxpotion: 0, shield: 1, charm: 0, berry: 2 },
      owned: { skins: ['meadow'], scenes: ['meadow', 'rain'], outfits: ['classic'] },
      buffs: { charmUntil: 0, perfectDay: null },
      boss: null,
      achievements: {},
      counters: { completions: 0, remindersDone: 0, focusSessions: 0, focusMinutes: 0, perfectDays: 0, bossesDefeated: 0, faints: 0, drops: 0, maxStreak: 0, earlyBird: 0 },
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
        uiScale: 100,
        skin: 'meadow',
        inn: false,
        confirmDelete: true,
        showCompletedReminders: false,
        calView: 'month',
        calShowReminders: true,
        google: { clientId: '', clientSecret: '', connected: false, calendars: [], writeCalendar: 'primary', pushReminders: true, pushEvents: true },
        ics: [],
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
    replace(next) { state = merge(defaults(), next); persist(); emit('replace'); },
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
