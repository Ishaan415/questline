'use strict';
/*
 * Side quests that sit on top of the core loop (game.js):
 *  - Daily bounties: three small rotating goals a day. Progress is worked out
 *    from what you actually did today, so undo and sync just work; rewards are
 *    paid when a goal is met and taken back if it's undone.
 *  - Pal expeditions: a pal from storage travels while you focus and comes back
 *    with gold, items, sometimes a Capsule Ticket, and EXP of its own.
 *  - Weekly review and perfect-week bonus, checked when a week ends.
 */

Q.quests = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const G = () => Q.game;

  /* ------------------------------------------------------------ helpers */
  const dayLog = (day) => (S().dayLog[day] = S().dayLog[day] || {});
  const bump = (key, n = 1, day = G().today()) => { const l = dayLog(day); l[key] = Math.max(0, (l[key] || 0) + n); };
  const noonOf = (day) => U.at(day, '12:00').getTime();

  /** What today looks like, for picking bounties and measuring them. */
  function ctx(day) {
    const st = S();
    const sched = G().todaysDailies();
    const done = sched.filter((d) => G().isDone(d, day));
    const log = st.dayLog[day] || {};
    return {
      day,
      sched: sched.length,
      timed: sched.filter((d) => d.time).length,
      hard: sched.filter((d) => d.difficulty === 'medium' || d.difficulty === 'hard').length,
      habits: st.habits.length,
      reminders: st.reminders.filter((r) => !r.done).length,
      doneN: done.length,
      doneBeforeNoon: done.filter((d) => (d.done[day].at || Infinity) < noonOf(day)).length,
      onTime: done.filter((d) => d.done[day].onTime).length,
      hardDone: done.filter((d) => d.difficulty === 'medium' || d.difficulty === 'hard').length,
      habitUps: st.habits.reduce((n, h) => n + (h.countDate === day && h.count ? h.count.up || 0 : 0), 0),
      focusMin: log.f || 0,
      focusN: log.fs || 0,
      remDone: log.r || 0,
      xp: log.x || 0,
      foe: !!(st.dailyBoss && st.dailyBoss.day === day && st.dailyBoss.defeated),
    };
  }

  /* ------------------------------------------------------------ bounties */
  // tier: 1 easy, 2 medium, 3 hard (sets the gold). group: at most one per group a day.
  const BOUNTIES = [
    { id: 'noon2', group: 'dailies', tier: 2, icon: 'sun', ok: (c) => c.sched >= 3, target: () => 2, text: (n) => `Finish ${n} dailies before noon`, progress: (c) => c.doneBeforeNoon },
    { id: 'most', group: 'dailies', tier: 2, icon: 'check', ok: (c) => c.sched >= 4, target: (c) => Math.max(3, Math.ceil(c.sched * 0.75)), text: (n) => `Finish ${n} dailies`, progress: (c) => c.doneN },
    { id: 'all', group: 'dailies', tier: 3, icon: 'star', ok: (c) => c.sched >= 2 && c.sched <= 6, target: (c) => c.sched, text: () => 'Finish every daily today', progress: (c) => c.doneN },
    { id: 'ontime', group: 'timed', tier: 2, icon: 'clock', ok: (c) => c.timed >= 2, target: () => 2, text: (n) => `Finish ${n} timed dailies on time`, progress: (c) => c.onTime },
    { id: 'hard', group: 'timed', tier: 1, icon: 'flame', ok: (c) => c.hard >= 1, target: () => 1, text: () => 'Finish a Medium or Hard daily', progress: (c) => c.hardDone },
    { id: 'focus', group: 'focus', tier: 2, icon: 'hourglass', ok: () => true, target: (c) => [25, 50, 50, 75][U.hash(`${c.day}fmin`) % 4], text: (n) => `Focus for ${n} minutes`, progress: (c) => c.focusMin },
    { id: 'focus2', group: 'focus', tier: 2, icon: 'hourglass', ok: () => true, target: () => 2, text: (n) => `Complete ${n} focus sessions`, progress: (c) => c.focusN },
    { id: 'rem2', group: 'reminders', tier: 1, icon: 'bell', ok: (c) => c.reminders >= 2, target: () => 2, text: (n) => `Complete ${n} reminders`, progress: (c) => c.remDone },
    { id: 'overdue', group: 'reminders', tier: 3, icon: 'bell', ok: (c, ov) => ov.length >= 1, target: (c, ov) => ov.length, text: (n) => (n === 1 ? 'Clear your overdue reminder' : `Clear all ${n} overdue reminders`), progress: (c, b) => (b.ids || []).filter((id) => (S().bounties.remDone || []).includes(id)).length },
    { id: 'habit3', group: 'habits', tier: 1, icon: 'plus', ok: (c) => c.habits >= 1, target: () => 3, text: (n) => `Tap + on your habits ${n} times`, progress: (c) => c.habitUps },
    { id: 'foe', group: 'foe', tier: 2, icon: 'sword', ok: (c) => c.sched >= 2, target: () => 1, text: () => "Beat today's foe", progress: (c) => (c.foe ? 1 : 0) },
    { id: 'xp', group: 'xp', tier: 2, icon: 'bolt', ok: () => true, target: () => Math.max(40, Math.round((G().xpToNext(S().hero.level) * 0.4) / 5) * 5), text: (n) => `Earn ${n} XP`, progress: (c) => c.xp },
  ];
  const byId = Object.fromEntries(BOUNTIES.map((b) => [b.id, b]));
  const goldFor = (tier) => [0, 15, 25, 35][tier] + S().hero.level;

  /** Overdue reminders at the start of the day (for "clear all overdue"). */
  function overdueIds(day) {
    const start = U.at(day, '00:00').getTime() + (S().settings.dayStart || 0) * 3600000;
    return S().reminders.filter((r) => !r.done && r.due && r.due < start).map((r) => r.id).slice(0, 5);
  }

  function ensureBounties() {
    const st = S(); const day = G().today();
    if (st.bounties && st.bounties.day === day) return st.bounties;
    const c = ctx(day); const ov = overdueIds(day);
    const order = BOUNTIES.filter((b) => b.ok(c, ov)).sort((a, b) => U.hash(day + a.id) - U.hash(day + b.id));
    const picked = []; const groups = new Set();
    for (const b of order) { if (picked.length < 3 && !groups.has(b.group)) { picked.push(b); groups.add(b.group); } }
    st.bounties = {
      day,
      list: picked.map((b) => ({ id: b.id, target: b.target(c, ov), gold: goldFor(b.tier), ...(b.id === 'overdue' ? { ids: ov } : {}), claimed: false })),
      remDone: [], board: false,
    };
    return st.bounties;
  }

  function progressOf(bt, c = ctx(G().today())) {
    const def = byId[bt.id];
    return def ? Math.min(bt.target, def.progress(c, bt)) : 0;
  }

  /** Pay out (or take back) bounties. Called after every game action. */
  function check() {
    const st = S();
    const bs = ensureBounties();
    const c = ctx(bs.day);
    for (const bt of bs.list) {
      const met = progressOf(bt, c) >= bt.target;
      if (met && !bt.claimed) {
        bt.claimed = true;
        st.hero.gold += bt.gold;
        bump('b', 1, bs.day);
        Q.store.log(`Bounty done: ${text(bt)} (+${bt.gold} gold)`, 'bounty');
        G().emit({ type: 'bounty', text: text(bt), gold: bt.gold });
      } else if (!met && bt.claimed) {
        bt.claimed = false;
        st.hero.gold = Math.max(0, st.hero.gold - bt.gold);
        bump('b', -1, bs.day);
      }
    }
    const all = bs.list.length >= 3 && bs.list.every((b) => b.claimed);
    if (all && !bs.board) {
      bs.board = true;
      st.inventory.ticket = (st.inventory.ticket || 0) + 1;
      st.counters.bountyBoards = (st.counters.bountyBoards || 0) + 1;
      Q.store.log('Bounty board cleared! +1 Capsule Ticket', 'bounty');
      G().emit({ type: 'bountyBoard' });
    } else if (!all && bs.board) {
      bs.board = false;
      if (st.inventory.ticket > 0) st.inventory.ticket--;
      st.counters.bountyBoards = Math.max(0, (st.counters.bountyBoards || 0) - 1);
    }
  }

  const text = (bt) => (byId[bt.id] ? byId[bt.id].text(bt.target) : bt.id);
  const icon = (bt) => (byId[bt.id] ? byId[bt.id].icon : 'star');

  function noteReminder(id) {
    const bs = ensureBounties();
    bs.remDone = bs.remDone || [];
    if (!bs.remDone.includes(id)) bs.remDone.push(id);
    bump('r');
  }

  /* ---------------------------------------------------------- expeditions */
  const TRIPS = {
    short: { name: 'Short trip', min: 25, gold: 30, ticket: 0.05, items: 0.4, place: 'the meadow' },
    mid: { name: 'Day trip', min: 50, gold: 70, ticket: 0.25, items: 1, place: 'the old forest' },
    long: { name: 'Grand voyage', min: 100, gold: 160, ticket: 0.6, items: 1.5, place: 'the far mountains' },
  };
  const away = (id) => !!(S().expedition && S().expedition.id === id);
  const canSend = (id) => Q.pals.isOwned(id) && !Q.pals.inTeam(id) && !S().expedition;

  function send(id, trip) {
    const t = TRIPS[trip];
    if (!t) return { ok: false, msg: 'Pick a trip' };
    if (S().expedition) return { ok: false, msg: `${Q.pals.name(S().expedition.id)} is still away` };
    if (!Q.pals.isOwned(id)) return { ok: false, msg: "You don't have that pal" };
    if (Q.pals.inTeam(id)) return { ok: false, msg: 'Only pals in storage can go. Take it out of your team first.' };
    S().expedition = { id, trip, need: t.min, progress: 0, start: Date.now() };
    Q.store.log(`${Q.pals.name(id)} set off on a ${t.name.toLowerCase()} to ${t.place}.`, 'pal');
    Q.store.commit('expedition');
    return { ok: true, msg: `${Q.pals.name(id)} set off! Focus for ${t.min} minutes to bring it home.` };
  }

  function recall() {
    const ex = S().expedition;
    if (!ex) return;
    Q.store.log(`${Q.pals.name(ex.id)} came home early with nothing.`, 'pal');
    S().expedition = null;
    Q.store.commit('expedition');
  }

  /** Focus minutes move the expedition along; it returns when they add up. */
  function onFocus(minutes) {
    const st = S(); const ex = st.expedition;
    if (!ex || minutes <= 0) return;
    ex.progress = Math.min(ex.need, (ex.progress || 0) + minutes);
    if (ex.progress < ex.need) return;
    const t = TRIPS[ex.trip] || TRIPS.short;
    const roll = (k) => (U.hash(`${ex.start}${k}`) % 1000) / 1000;
    const loot = { gold: t.gold + st.hero.level * 2, items: [], ticket: roll('t') < t.ticket ? 1 : 0, exp: ex.need * 4 };
    const pool = ['potion', 'potion', 'shield', 'charm', 'maxpotion'];
    let n = Math.floor(t.items) + (roll('i') < t.items % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) loot.items.push(pool[U.hash(`${ex.start}item${i}`) % pool.length]);
    st.hero.gold += loot.gold;
    for (const it of loot.items) st.inventory[it] = (st.inventory[it] || 0) + 1;
    st.inventory.ticket = (st.inventory.ticket || 0) + loot.ticket;
    Q.pals.gain(loot.exp, [ex.id]);
    st.counters.expeditions = (st.counters.expeditions || 0) + 1;
    const what = [`+${loot.gold} gold`, ...loot.items.map((k) => G().SHOP.items[k].name), loot.ticket ? 'a Capsule Ticket' : ''].filter(Boolean).join(', ');
    Q.store.log(`${Q.pals.name(ex.id)} came back from ${t.place}: ${what} and +${loot.exp} EXP.`, 'pal');
    G().emit({ type: 'expedition', id: ex.id, trip: ex.trip, loot });
    st.expedition = null;
  }

  /* -------------------------------------------- weeks: review + perfect week */
  const weekOf = (day) => U.weekKey(U.parseYmd(day), S().settings.weekStart);
  const weekDays = (wk) => Array.from({ length: 7 }, (_, i) => U.ymd(U.addDays(U.parseYmd(wk), i)));

  /** A week where every day with dailies was a perfect day (rest days don't count against it). */
  function perfectWeek(wk) {
    const st = S(); let counted = 0;
    for (const ds of weekDays(wk)) {
      const l = st.dayLog[ds];
      const rest = G().isRestDay(ds);
      if (!l) {
        // No record: fine on a rest day, or when nothing was scheduled.
        if (rest) continue;
        const sched = st.dailies.filter((d) => !d.archived && G().isScheduled(d, ds) && (d.createdAt || 0) < U.at(ds, '23:59').getTime());
        if (sched.length) return false;
        continue;
      }
      if (!l.t) continue;
      if (l.d < l.t) { if (rest) continue; return false; }
      counted++;
    }
    return counted >= 3;
  }

  /** Called once when a game week ends (from finalizeDay). */
  function endOfWeek(wk) {
    const st = S();
    st.weekly = st.weekly || {};
    if (st.weekly.checked && st.weekly.checked >= wk) return;
    st.weekly.checked = wk;
    if (perfectWeek(wk)) {
      st.hero.gold += 100;
      st.inventory.ticket = (st.inventory.ticket || 0) + 1;
      st.counters.perfectWeeks = (st.counters.perfectWeeks || 0) + 1;
      st.weekly.perfect = (st.weekly.perfect || []).concat(wk).slice(-60);
      Q.store.log('Perfect week! +100 gold and a Capsule Ticket.', 'perfect');
      G().emit({ type: 'perfectWeek' });
    }
  }

  /** Everything the weekly review shows, for the week starting `wk`. */
  function weekSummary(wk) {
    const st = S();
    const days = weekDays(wk).filter((ds) => ds < G().today());
    const per = st.dailies.filter((d) => !d.archived).map((d) => {
      let sched = 0; let done = 0;
      for (const ds of days) {
        if ((d.createdAt || 0) > U.at(ds, '23:59').getTime() || !G().isScheduled(d, ds)) continue;
        const did = !!(d.done && d.done[ds]);
        if (G().isRestDay(ds) && !did) continue;
        sched++; if (did) done++;
      }
      return { id: d.id, title: d.title, sched, done, rate: sched ? done / sched : null };
    }).filter((x) => x.sched > 0).sort((a, b) => a.rate - b.rate || b.sched - a.sched);
    const dayRows = days.map((ds) => ({ ds, ...(st.dayLog[ds] || {}) })).filter((x) => x.t);
    const ratio = (x) => (x.t ? x.d / x.t : 0);
    const best = dayRows.slice().sort((a, b) => ratio(b) - ratio(a) || b.d - a.d)[0] || null;
    const worst = dayRows.slice().sort((a, b) => ratio(a) - ratio(b) || b.t - a.t)[0] || null;
    const sum = (k) => days.reduce((n, ds) => n + ((st.dayLog[ds] || {})[k] || 0), 0);
    const totalSched = per.reduce((n, x) => n + x.sched, 0);
    const totalDone = per.reduce((n, x) => n + x.done, 0);
    const boss = st.lastBoss && st.lastBoss.week === wk ? st.lastBoss : st.boss && st.boss.week === wk ? st.boss : null;
    return {
      wk, days: days.length, per, best, worst,
      rate: totalSched ? totalDone / totalSched : null, totalDone, totalSched,
      focus: sum('f'), sessions: sum('fs'), xp: sum('x'), reminders: sum('r'), bounties: sum('b'),
      boss, perfect: (st.weekly && (st.weekly.perfect || []).includes(wk)) || false,
    };
  }

  /** Show last week's review once, on the first day of a new week. */
  function maybeShowWeekly() {
    const st = S();
    const cur = weekOf(G().today());
    st.weekly = st.weekly || {};
    if (st.weekly.seen === cur) return;
    const prev = U.ymd(U.addDays(U.parseYmd(cur), -7));
    st.weekly.seen = cur;
    // Nothing to review if you started late last week or didn't use the app.
    const used = weekDays(prev).filter((ds) => st.dayLog[ds] && (st.dayLog[ds].t || st.dayLog[ds].f)).length;
    if (used < 3 || (st.createdAt || Date.now()) > U.at(prev, '23:59').getTime() + 86400000 * 3) { Q.store.commit('weekly'); return; }
    Q.store.commit('weekly');
    if (Q.ui.modalOpen && Q.ui.modalOpen()) return;
    Q.views.journey.showWeekly(prev);
  }

  return {
    ensureBounties, check, progressOf, text, icon, noteReminder, bump,
    TRIPS, send, recall, onFocus, away, canSend,
    weekOf, weekDays, endOfWeek, weekSummary, perfectWeek, maybeShowWeekly,
  };
})();
