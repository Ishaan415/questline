'use strict';
/* First-run setup, starter packs, demo data (web preview) and the "Record yesterday" review. */

Q.onboarding = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;

  const D = (title, time, schedule, difficulty, category, extra = {}) => Object.assign({ title, time, schedule, difficulty, category, checklist: [], notes: '' }, extra);
  const W = (...days) => ({ type: 'weekly', days });
  const EVERY = { type: 'daily' };
  const PACKS = {
    morning: { name: 'Morning routine', desc: 'Bed, stretch, water, plan', items: [
      D('Make the bed', '07:30', EVERY, 'trivial', 'home'),
      D('Morning stretch', '07:45', EVERY, 'easy', 'health', { checklist: ['Neck rolls', 'Back twist', 'Hamstrings'].map((t) => ({ id: U.uid(), text: t, done: false })) }),
      D('Glass of water', '08:00', EVERY, 'trivial', 'health'),
      D('Plan the day', '08:15', W(1, 2, 3, 4, 5), 'easy', 'work'),
    ] },
    chores: { name: 'Home chores', desc: 'Dishes, plants, laundry, trash', items: [
      D('Do the dishes', '21:00', EVERY, 'easy', 'home'),
      D('Water the plants', '08:30', W(1, 4), 'trivial', 'home'),
      D('Laundry', '11:00', W(0), 'medium', 'home', { checklist: ['Wash', 'Dry', 'Fold & put away'].map((t) => ({ id: U.uid(), text: t, done: false })) }),
      D('Take out the trash', '21:30', W(2, 5), 'easy', 'home'),
      D('Tidy the desk', '20:30', EVERY, 'trivial', 'home'),
    ] },
    student: { name: 'Study', desc: 'Study blocks, review, reading', items: [
      D('Study block (90 min)', '18:00', W(1, 2, 3, 4, 5), 'hard', 'study'),
      D('Review today\'s notes', '21:45', W(1, 2, 3, 4, 5), 'easy', 'study'),
      D('Language practice (20 min)', '19:30', EVERY, 'easy', 'study'),
      D('Read 20 pages', '22:30', EVERY, 'easy', 'selfcare'),
    ] },
    fitness: { name: 'Fitness', desc: 'Workouts, steps, sleep', items: [
      D('Workout', '19:00', W(1, 3, 5), 'hard', 'health'),
      D('Walk 6,000 steps', null, EVERY, 'easy', 'health'),
      D('Lights out by 11:30', '23:30', EVERY, 'medium', 'selfcare'),
    ] },
  };
  const HABITS = [
    { title: 'Drank a glass of water', up: true, down: false, difficulty: 'trivial', category: 'health' },
    { title: 'Took the stairs', up: true, down: true, difficulty: 'easy', category: 'health' },
    { title: 'Doomscrolled', up: false, down: true, difficulty: 'easy', category: 'selfcare' },
  ];

  function addPack(key) {
    const st = S();
    let n = 0;
    for (const it of PACKS[key].items) {
      if (st.dailies.some((d) => d.title === it.title)) continue;
      st.dailies.push(Object.assign(JSON.parse(JSON.stringify(it)), { id: U.uid(), createdAt: Date.now(), streak: 0, best: 0, done: {}, order: st.dailies.length }));
      n++;
    }
    return n;
  }

  function packsModal() {
    Q.ui.modal({
      title: 'Starter packs', cls: 'modal-form',
      body: `<p class="small muted">Add a ready-made set of dailies. You can edit or delete any of them later. Tip: start small.</p>
        <div class="packs">${Object.entries(PACKS).map(([k, p]) => `<label class="pack"><input type="checkbox" name="p" value="${k}"><div><b>${p.name}</b><span class="small muted">${p.items.map((i) => esc(i.title)).join(' · ')}</span></div></label>`).join('')}
        <label class="pack"><input type="checkbox" name="p" value="habits"><div><b>Habits</b><span class="small muted">${HABITS.map((h) => esc(h.title)).join(' · ')}</span></div></label></div>
        <div class="modal-actions"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-add>Add selected</button></div>`,
      onMount(m, close) {
        m.querySelector('[data-add]').onclick = () => {
          const keys = [...m.querySelectorAll('input:checked')].map((i) => i.value);
          let n = 0;
          for (const k of keys) {
            if (k === 'habits') { for (const h of HABITS) if (!S().habits.some((x) => x.title === h.title)) { S().habits.push(Object.assign({ id: U.uid(), createdAt: Date.now() }, h)); n++; } }
            else n += addPack(k);
          }
          Q.game.ensureBoss();
          Q.store.commit('packs'); close();
          Q.ui.toast(n ? `Added ${n} ${n === 1 ? 'item' : 'items'}` : 'Nothing new to add', { kind: 'ok' });
        };
      },
    });
  }

  /* ---------------------------------------------------------- onboarding */
  const STARTERS = ['sprigg', 'coalby', 'drizzle'];

  function start() {
    let step = 0; let species = 'sprigg';
    const picks = new Set(['morning']);
    Q.ui.modal({
      cls: 'modal-onboard', dismissable: false, title: '',
      body: '<div class="ob"></div>',
      onMount(m, close) {
        const box = m.querySelector('.ob');
        const draw = () => {
          if (step === 0) {
            box.innerHTML = `<div class="ob-hero">${Q.sprites.trainer('classic', 96, 'bounce')}</div>
              <div class="textbox"><p>Welcome to <b>Questline</b>! Here, chores and plans become quests. Finish them to earn XP, gold and badges. What should we call you?</p></div>
              <label class="field"><span class="field-label">Your name</span><input id="ob-name" maxlength="24" placeholder="Trainer" value="${esc(S().profile.name === 'Trainer' ? '' : S().profile.name)}"></label>
              <div class="modal-actions"><span class="spacer"></span><button class="btn btn-primary" data-next>Next</button></div>`;
          } else if (step === 1) {
            box.innerHTML = `<div class="textbox"><p>Every trainer needs a partner pal. Pals earn EXP from every task you finish and evolve as they grow. You can collect 49 more later. Pick your first:</p></div>
              <div class="starters">${STARTERS.map((k) => { const l = Q.PALS.byId[k]; return `<button class="starter ${species === k ? 'on' : ''}" data-sp="${k}" style="--c:${Q.PALS.TYPES[l.type].color}">${Q.pals.sprite(k, 80, { reveal: true })}<b>${l.names[0]}</b><span class="small muted">${Q.PALS.TYPES[l.type].name} · ${esc(l.ab)}</span></button>`; }).join('')}</div>
              <div class="modal-actions"><button class="btn" data-back>Back</button><span class="spacer"></span><button class="btn btn-primary" data-next>Choose ${Q.PALS.byId[species].names[0]}</button></div>`;
          } else if (step === 2) {
            box.innerHTML = `<div class="textbox"><p>Want some dailies to start with? Pick a pack or two. Keeping it to a handful at first is the secret.</p></div>
              <div class="packs">${Object.entries(PACKS).map(([k, p]) => `<label class="pack"><input type="checkbox" value="${k}" ${picks.has(k) ? 'checked' : ''}><div><b>${p.name}</b><span class="small muted">${p.desc}</span></div></label>`).join('')}</div>
              <div class="modal-actions"><button class="btn" data-back>Back</button><span class="spacer"></span><button class="btn btn-primary" data-next>Start my journey</button></div>`;
          }
          const nm = box.querySelector('#ob-name'); if (nm) setTimeout(() => nm.focus(), 30);
        };
        box.addEventListener('click', (e) => {
          const sp = e.target.closest('[data-sp]');
          if (sp) { species = sp.dataset.sp; draw(); return; }
          if (e.target.closest('[data-back]')) { step--; draw(); return; }
          if (!e.target.closest('[data-next]')) return;
          if (step === 0) { const v = box.querySelector('#ob-name').value.trim(); S().profile.name = v || 'Trainer'; }
          if (step === 2) {
            box.querySelectorAll('input').forEach((i) => (i.checked ? picks.add(i.value) : picks.delete(i.value)));
            const st = S();
            st.pals.owned = {}; Q.pals.give(species); st.pals.team = [species, null, null];
            for (const k of picks) addPack(k);
            st.onboarded = true;
            Q.game.ensureBoss();
            Q.store.commit('onboarded');
            close();
            Q.platform.askNotifyPermission();
            Q.ui.toast(`${Q.PALS.byId[species].names[0]} joined your party! You also have a free Capsule Ticket in the Pals tab.`, { kind: 'ok', icon: I('paw'), timeout: 7000 });
            return;
          }
          step++; draw();
        });
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && step === 0) box.querySelector('[data-next]').click(); });
        draw();
      },
    });
  }

  /* ---------------------------------------------------------- record yesterday */
  function review(rv) {
    const st = S();
    const d = U.parseYmd(rv.date);
    const dmg = U.sum(rv.missed, (x) => Q.game.DIFF[x.difficulty]?.dmg || 2);
    Q.ui.modal({
      title: '', cls: 'modal-review', dismissable: false,
      body: `<div class="rv-head">${Q.sprites.companion(64)}
          <div class="textbox"><p>Welcome back! Before the new day starts: did you do any of these on <b>${U.DAYS_LONG[d.getDay()]}</b> and forget to tick them?</p></div></div>
        <div class="rv-list">${rv.missed.map((x) => `<label class="rv-item"><input type="checkbox" value="${x.id}"><span class="cbox">${I('check')}</span><span>${esc(x.title)}${x.time ? ` <span class="small muted">${U.fmtTime(x.time)}</span>` : ''}</span></label>`).join('')}</div>
        <p class="small muted rv-note">${st.settings.inn ? 'You\'re resting at the Inn, so nothing here will hurt you.' : Q.game.isRestDay(rv.date) ? 'That was a weekend rest day, so missed dailies cost nothing and streaks are safe. Ticking them still earns rewards.' : `Unticked ones cost about ${Math.round(dmg)} HP in total${st.inventory.shield ? ' (your Streak Shield will protect streaks)' : ''}.`}</p>
        <div class="modal-actions"><span class="spacer"></span><button class="btn btn-primary" data-go>Start today</button></div>`,
      onMount(m, close) {
        m.querySelector('[data-go]').onclick = () => {
          const ticked = [...m.querySelectorAll('input:checked')].map((i) => i.value);
          const res = Q.game.finalizeDay(rv, ticked);
          close();
          Q.app.flushGame();
          if (res.missed && res.rest) Q.ui.toast('New day! Yesterday was a rest day, so nothing was lost.', { kind: 'ok' });
          else if (res.missed && !st.settings.inn) Q.ui.toast(`New day! Missed dailies cost ${Math.round(res.totalDmg * 10) / 10} HP${res.shieldUsed ? '; a shield saved your streaks' : ''}.`, { kind: 'info', timeout: 6000 });
          else Q.ui.toast('A fresh day begins. Good luck!', { kind: 'ok' });
        };
      },
    });
  }

  /* ---------------------------------------------------------- demo data */
  function demo() {
    const st = Q.store.defaults();
    const now = new Date();
    const todayD = U.startOfDay(now);
    const ymd = (n) => U.ymd(U.addDays(todayD, n));
    const at = (n, hm) => U.at(ymd(n), hm).getTime();
    const nextDow = (dow) => (dow - todayD.getDay() + 7) % 7 || 7;
    let seed = 42; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    st.demo = true; st.onboarded = true;
    st.profile = { name: 'Ishaan', outfit: 'classic', trainerId: '04217' };
    st.createdAt = U.addDays(todayD, -62).getTime();
    st.pals = {
      owned: { sprigg: { exp: 2600, nick: '', got: st.createdAt, seen: 2 }, emberkit: { exp: 1150, nick: 'Mochi', got: st.createdAt, seen: 2 }, peeplet: { exp: 640, nick: '', got: st.createdAt, seen: 2 }, boolet: { exp: 220, nick: '', got: st.createdAt, seen: 1 }, splotter: { exp: 90, nick: '', got: st.createdAt, seen: 1 }, pebbit: { exp: 0, nick: '', got: st.createdAt, seen: 1 } },
      team: ['sprigg', 'emberkit', 'peeplet'], presets: [{ name: 'Focus team', team: ['sprigg', 'emberkit', 'peeplet'] }, null, null], pulls: 5, evolutions: 3,
    };
    st.hero = { level: 7, xp: 212, gold: 186, hp: 41, totalXp: 2890 };
    st.stats = { str: 420, int: 690, end: 520, cha: 160, spi: 240 };
    st.inventory = { potion: 2, maxpotion: 0, shield: 1, charm: 1, ticket: 1 };
    st.owned = { skins: ['meadow', 'ember'], scenes: ['meadow', 'rain', 'night'], outfits: ['classic', 'meadow'] };
    st.counters = { completions: 214, remindersDone: 23, focusSessions: 12, focusMinutes: 395, perfectDays: 6, bossesDefeated: 2, faints: 0, drops: 31, maxStreak: 19, earlyBird: 9, rewardsBought: 3 };
    st.settings.calShowReminders = true;

    const add = (it, streak, rate) => {
      const d = Object.assign(JSON.parse(JSON.stringify(it)), { id: U.uid(), createdAt: st.createdAt, streak: 0, best: 0, done: {}, order: st.dailies.length });
      st.dailies.push(d);
      d._rate = rate; d._streak = streak;
      return d;
    };
    for (const it of PACKS.morning.items.slice(0, 3)) add(it, 0, 0.85);
    add(PACKS.chores.items[0], 0, 0.8); add(PACKS.chores.items[1], 0, 0.9); add(PACKS.chores.items[2], 0, 0.75);
    add(PACKS.student.items[0], 0, 0.7); add(PACKS.student.items[3], 0, 0.8); add(PACKS.fitness.items[0], 0, 0.65);

    // 60 days of history for streaks and the heatmap.
    for (let n = -60; n <= -1; n++) {
      const ds = ymd(n);
      let tot = 0; let dn = 0;
      for (const d of st.dailies) {
        if (!Q.game.isScheduled(d, ds)) continue;
        tot++;
        if (rand() < d._rate || n > -6) { d.done[ds] = { xp: 12, gold: 5, stat: 'end' }; dn++; d.streak++; d.best = Math.max(d.best, d.streak); } else d.streak = 0;
      }
      st.dayLog[ds] = { d: dn, t: tot, f: rand() < 0.35 ? Math.round(25 + rand() * 60) : 0 };
    }
    // Today: the morning is done.
    const today = ymd(0);
    for (const d of st.dailies) {
      delete d._rate; delete d._streak;
      if (Q.game.isScheduled(d, today) && d.time && d.time < '09:00' && now.getHours() >= 9) {
        d.done[today] = { xp: 12, gold: 5, stat: 'end' }; d.streak++; d.best = Math.max(d.best, d.streak);
      }
    }
    st.dailies[1].checkDate = today; st.dailies[1].checklist.forEach((c) => { c.done = now.getHours() >= 9; });

    const R = (title, due, extra = {}) => Object.assign({ id: U.uid(), createdAt: Date.now() - 3 * 86400000, title, notes: '', due, repeat: 'none', lead: null, difficulty: 'easy', category: 'errands', done: false }, extra);
    st.reminders = [
      R('Book tickets for the show', at(nextDow(5) === 7 ? 0 : nextDow(5), '10:00'), { notes: 'Two seats, evening show. Check the student discount.', lead: 30 }),
      R('Pay the electricity bill', at(1, '18:00'), { difficulty: 'trivial', repeat: 'monthly' }),
      R('Return library books', at(-1, '17:00'), { difficulty: 'easy' }),
      R('Submit internship report', at(nextDow(3), '17:00'), { difficulty: 'hard', category: 'work', lead: 60 }),
      R('Renew the bus pass', at(nextDow(4), '09:00'), { difficulty: 'trivial' }),
      R('Call the bank about the new card', null, { category: 'errands' }),
      R('Plan a weekend trip', null, { category: 'social', difficulty: 'medium' }),
      R('Order a new notebook', at(0, '08:00'), { done: true, doneAt: Date.now() - 2 * 3600000 }),
    ];
    st.events = [
      { id: U.uid(), title: 'Robotics club meetup', start: at(nextDow(4), '16:00'), end: at(nextDow(4), '17:30'), allDay: false, location: 'Lab 3', notes: '', color: '#2FA58A', repeat: 'none' },
      { id: U.uid(), title: 'Movie night', start: at(nextDow(6), '20:00'), end: at(nextDow(6), '22:30'), allDay: false, location: '', notes: '', color: '#E879A8', repeat: 'none' },
      { id: U.uid(), title: 'Dentist', start: at(10, '11:00'), end: at(10, '11:30'), allDay: false, location: '', notes: '', color: '#F29A4E', repeat: 'none' },
      { id: U.uid(), title: 'Cousin\'s birthday', start: U.addDays(todayD, 13).getTime(), end: U.addDays(todayD, 14).getTime(), allDay: true, location: '', notes: '', color: '#8E6BD1', repeat: 'none' },
    ];
    const g = [];
    for (let n = -14; n < 40; n++) {
      const d = U.addDays(todayD, n); const dow = d.getDay();
      if (dow >= 1 && dow <= 5) g.push({ t: 'Team stand-up', s: '10:00', e: '10:15', n });
      if (dow === 2) g.push({ t: 'Lab session', s: '14:00', e: '16:00', n });
      if (dow === 3 && n % 14 < 7) g.push({ t: 'Project review', s: '11:00', e: '12:00', n });
    }
    st.calCache.google = g.map((x, i) => ({ id: `g:demo:${i}`, remoteId: `demo${i}`, calendarId: 'demo', source: 'google', demo: true, title: x.t, start: at(x.n, x.s), end: at(x.n, x.e), allDay: false, location: x.t === 'Lab session' ? 'Building B' : '', notes: '', color: '#3C82C8', editable: false }));
    st.calCache.syncedAt = Date.now() - 4 * 60000;
    st.habits = HABITS.map((h) => Object.assign({ id: U.uid(), createdAt: st.createdAt }, h));
    st.habits[0].countDate = today; st.habits[0].count = { up: 3, down: 0 };
    st.achievements = { first: st.createdAt + 3600000, sprout: st.createdAt + 86400000 * 2, dawn: st.createdAt + 86400000 * 9, tide: st.createdAt + 86400000 * 30, lantern: st.createdAt + 86400000 * 40, stone: st.createdAt + 86400000 * 13, early: st.createdAt + 86400000 * 20, treat: st.createdAt + 86400000 * 15, grown: st.createdAt + 86400000 * 33, century: st.createdAt + 86400000 * 28 };
    st.day = { last: today, dropsToday: 1, dropsDate: today };
    st.log = [
      { t: Date.now() - 2 * 3600000, text: 'Order a new notebook', kind: 'reminder', xp: 14, gold: 6 },
      { t: Date.now() - 3 * 3600000, text: 'Morning stretch', kind: 'daily', xp: 15, gold: 5 },
      { t: Date.now() - 3.2 * 3600000, text: 'Make the bed', kind: 'daily', xp: 7, gold: 2 },
      { t: Date.now() - 20 * 3600000, text: 'Focused for 50 min on Study block (90 min)', kind: 'focus', xp: 44, gold: 13 },
      { t: Date.now() - 26 * 3600000, text: 'Defeated Snooze Slime! +80 gold and a Streak Shield', kind: 'boss' },
    ];
    Q.store.replace(st);
    const b = Q.game.ensureBoss();
    b.hp = Math.round(b.maxHp * 0.58);
    Q.store.commit('demo');
  }

  return { start, review, packsModal, demo, PACKS };
})();
