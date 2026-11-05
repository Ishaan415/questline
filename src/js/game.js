'use strict';
/*
 * Game rules. Design notes (from comparing Habitica, Finch, Duolingo, LifeRPG):
 *  - Rewards are immediate and visible (XP, gold, boss damage, a sound).
 *  - Misses hurt a little but never wipe progress: fainting costs half your
 *    gold, not levels. Streak Shields and "Rest at the Inn" prevent the
 *    all-or-nothing streak collapse that makes people quit.
 *  - "Record yesterday" lets you tick off things you did but forgot to log
 *    before any damage lands.
 *  - Doing a timed daily on time pays a bonus, which ties the RPG to your clock.
 *  - A team of pals that grows with you is the emotional hook (Finch); a weekly
 *    boss gives a medium-term goal (Habitica quests, solo). Pal logic: pals.js.
 *  - Weekend mode: Sundays (or Sat + Sun) are rest days; missed dailies there
 *    cost no HP and break no streaks.
 */

Q.game = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const pending = [];
  const push = (e) => pending.push(e);

  const DIFF = {
    trivial: { mult: 0.5, dmg: 1, label: 'Trivial', stars: 1 },
    easy: { mult: 1, dmg: 2, label: 'Easy', stars: 2 },
    medium: { mult: 1.5, dmg: 3.5, label: 'Medium', stars: 3 },
    hard: { mult: 2, dmg: 5, label: 'Hard', stars: 4 },
  };

  const STATS = {
    str: { name: 'Strength', short: 'STR', perk: (l) => `+${l * 2} max HP`, color: '#E8604C' },
    int: { name: 'Intellect', short: 'INT', perk: (l) => `+${l * 2}% XP`, color: '#3C82C8' },
    end: { name: 'Endurance', short: 'END', perk: (l) => `−${Math.min(45, l * 3)}% damage taken`, color: '#D9A86C' },
    cha: { name: 'Charm', short: 'CHA', perk: (l) => `+${l * 2}% gold`, color: '#F29A4E' },
    spi: { name: 'Spirit', short: 'SPI', perk: (l) => `+${l}% item find`, color: '#2FA58A' },
  };

  const TITLES = [[1, 'Rookie'], [5, 'Route Walker'], [10, 'Town Helper'], [15, 'Badge Seeker'], [20, 'Ace Trainer'], [30, 'Veteran'], [40, 'Champion'], [50, 'Legend']];

  const xpToNext = (lvl) => Math.round(25 * Math.pow(lvl, 1.35) + 60);
  const statLevel = (xp) => Math.floor(Math.sqrt((xp || 0) / 15));
  const sl = (k) => statLevel(S().stats[k]);
  /* Permanent upgrades (Shop → Upgrades). */
  const UPGRADE_HP = 5;
  const upgradeLevel = (id) => Math.max(0, Math.floor((S().upgrades || {})[id] || 0));
  const upgradePrice = (id) => { const u = SHOP.upgrades[id]; return Math.round(u.base * Math.pow(1.6, upgradeLevel(id)) / 5) * 5; };
  const upgradeValue = (id, lvl = upgradeLevel(id)) => SHOP.upgrades[id].per * lvl;
  function upgradeText(id, lvl = upgradeLevel(id)) {
    const u = SHOP.upgrades[id];
    if (u.hp) return `+${upgradeValue(id, lvl)} max HP`;
    return Q.PALS.FX[u.fx].fmt(upgradeValue(id, lvl));
  }
  function buyUpgrade(id) {
    const st = S(); const u = SHOP.upgrades[id];
    if (!u) return { ok: false, msg: 'Unknown upgrade' };
    if (upgradeLevel(id) >= u.max) return { ok: false, msg: `${u.name} is already at its best` };
    const price = upgradePrice(id);
    if (st.hero.gold < price) return { ok: false, msg: `You need ${price - st.hero.gold} more gold` };
    st.hero.gold -= price;
    st.upgrades = st.upgrades || {};
    st.upgrades[id] = upgradeLevel(id) + 1;
    if (u.hp) st.hero.hp = Math.min(maxHp(), st.hero.hp + UPGRADE_HP);
    Q.store.log(`Upgraded ${u.name} to level ${st.upgrades[id]} (${upgradeText(id)})`, 'shop');
    afterAction();
    return { ok: true, msg: `${u.name} level ${st.upgrades[id]}: ${upgradeText(id)}` };
  }
  const maxHp = () => 50 + sl('str') * 2 + upgradeLevel('vitality') * UPGRADE_HP;
  const title = (lvl) => TITLES.filter(([l]) => lvl >= l).pop()[1];
  const today = () => U.gameDate(new Date(), S().settings.dayStart);

  /** Weekend mode: is this game day a rest day? */
  function isRestDay(dateStr) {
    const m = S().settings.weekendMode;
    if (!m || m === 'off') return false;
    const dow = U.parseYmd(dateStr).getDay();
    return dow === 0 || (m === 'satsun' && dow === 6);
  }

  /* ------------------------------------------------------------ schedule */
  function isScheduled(d, dateStr) {
    const sch = d.schedule || { type: 'daily' };
    const date = U.parseYmd(dateStr);
    if (d.startDate && dateStr < d.startDate) return false;
    if (d.paused) return false;
    switch (sch.type) {
      case 'weekly': return (sch.days || []).includes(date.getDay());
      case 'interval': {
        const start = U.parseYmd(sch.start || d.startDate || U.ymd(new Date(d.createdAt || Date.now())));
        const diff = U.diffDays(date, start);
        return diff >= 0 && diff % Math.max(1, sch.every || 1) === 0;
      }
      case 'monthly': return date.getDate() === (sch.dom || 1);
      default: return true;
    }
  }
  const scheduleLabel = (d) => {
    const s = d.schedule || { type: 'daily' };
    if (s.type === 'weekly') {
      const days = (s.days || []).slice().sort();
      if (days.join() === '1,2,3,4,5') return 'Weekdays';
      if (days.join() === '0,6') return 'Weekends';
      return days.map((x) => U.DAYS[x]).join(' ');
    }
    if (s.type === 'interval') return s.every === 1 ? 'Every day' : `Every ${s.every} days`;
    if (s.type === 'monthly') return `Monthly on the ${s.dom}${['th', 'st', 'nd', 'rd'][(s.dom % 10 < 4 && Math.floor(s.dom / 10) !== 1) ? s.dom % 10 : 0]}`;
    return 'Every day';
  };
  const dueAt = (d, dateStr) => (d.time ? U.at(dateStr, d.time) : null);
  const isDone = (d, dateStr = today()) => !!(d.done && d.done[dateStr]);
  const todaysDailies = () => S().dailies.filter((d) => !d.archived && isScheduled(d, today()));

  /* ------------------------------------------------------------- rewards */
  function bonusMult() {
    const st = S();
    let m = 1 + sl('int') * 0.02;
    if (st.buffs.charmUntil > Date.now()) m *= 1.5;
    if (st.buffs.perfectDay === today()) m *= 1.1;
    return m;
  }

  function gainXp(xp) {
    const h = S().hero;
    h.xp += xp; h.totalXp += xp;
    while (h.xp >= xpToNext(h.level)) {
      h.xp -= xpToNext(h.level);
      h.level += 1;
      h.hp = maxHp();
      const bonus = 10 + h.level * 2;
      h.gold += bonus;
      Q.store.log(`Reached level ${h.level}! +${bonus} gold`, 'level');
      push({ type: 'levelup', level: h.level, bonus });
    }
    while (h.xp < 0 && h.level > 1) { h.level -= 1; h.xp += xpToNext(h.level); }
    if (h.xp < 0) h.xp = 0;
  }

  function rollDrop() {
    const st = S();
    if (st.day.dropsDate !== today()) { st.day.dropsDate = today(); st.day.dropsToday = 0; }
    if (st.day.dropsToday >= 6) return null;
    if (Math.random() > (0.11 + sl('spi') * 0.01) * (1 + Q.pals.fx().dropPct / 100)) return null;
    st.day.dropsToday++;
    st.counters.drops++;
    const r = Math.random();
    if (r < 0.6) { const g = 12 + Math.floor(Math.random() * 18); st.hero.gold += g; return { item: 'gold', gold: g, text: `Found a gold pouch (+${g})!` }; }
    if (r < 0.85) { st.inventory.potion++; return { item: 'potion', text: 'Found a Potion!' }; }
    if (r < 0.985) { st.inventory.shield++; return { item: 'shield', text: 'Found a Streak Shield!' }; }
    st.inventory.ticket = (st.inventory.ticket || 0) + 1; return { item: 'ticket', text: 'Found a Capsule Ticket!' };
  }

  function revertDrop(drop) {
    if (!drop) return;
    const inv = S().inventory;
    if (drop.item === 'gold') S().hero.gold = Math.max(0, S().hero.gold - drop.gold);
    else if (inv[drop.item] > 0) inv[drop.item]--;
  }

  /** Apply a reward and return the grant record (for undo). */
  /** Extra reward % from team abilities for this kind of task at this hour. */
  function palRewardPct(fx, kind) {
    const h = new Date().getHours();
    const byKind = { daily: fx.dailyPct, reminder: fx.reminderPct, habit: fx.habitPct, focus: fx.focusPct }[kind] || 0;
    return byKind + (h < 10 ? fx.earlyPct : 0) + (h >= 20 ? fx.nightPct : 0);
  }

  function grant({ base = 10, diff = 'easy', category = 'home', onTime = false, streak = 0, kind = 'task', drops = true }) {
    const st = S();
    const fx = Q.pals.fx();
    const mult = (DIFF[diff] || DIFF.easy).mult;
    const streakB = 1 + Math.min(streak, 50) * 0.01;
    const onTimeB = onTime ? 1.2 : 1;
    const palB = 1 + palRewardPct(fx, kind) / 100;
    const xp = Math.max(1, Math.round(base * mult * streakB * onTimeB * bonusMult() * palB * (1 + fx.xpPct / 100)));
    const variance = 0.85 + Math.random() * 0.3;
    let gold = Math.max(1, Math.round(base * 0.4 * mult * (1 + sl('cha') * 0.02) * variance * onTimeB * palB * (1 + fx.goldPct / 100)));
    const lucky = Math.random() * 100 < fx.critChance;
    if (lucky) gold *= 2;
    const stat = (Q.store.CATEGORIES[category] || Q.store.CATEGORIES.home).stat;
    const adv = Q.pals.advantage(ensureBoss());
    const bossDmg = Math.round(xp * 0.9 * (1 + (fx.bossPct + adv.pct) / 100));
    const advDay = Q.pals.advantage(ensureDailyBoss());
    const dayDmg = Math.round(xp * 0.9 * (1 + (fx.bossPct + advDay.pct) / 100));

    gainXp(xp);
    st.hero.gold += gold;
    Q.quests.bump('x', xp);
    st.stats[stat] = (st.stats[stat] || 0) + xp;
    // Every pal in the team gets the same EXP; pals in storage get none.
    const pals = Q.pals.gain(xp * (1 + fx.palExpPct / 100));
    const hit = damageBoss(bossDmg);
    const dayHit = damageDailyBoss(dayDmg);
    const drop = drops ? rollDrop() : null;
    if (drop) push({ type: 'drop', drop });
    push({ type: 'reward', xp, gold, onTime, kind, bossDmg: hit || dayHit, lucky, palExp: pals ? pals.amt : 0 });
    return { xp, gold, stat, bossDmg: hit, dayDmg: dayHit, day: today(), drop, pals };
  }

  function revert(g) {
    if (!g) return;
    const st = S();
    gainXp(-g.xp);
    st.hero.gold = Math.max(0, st.hero.gold - g.gold);
    if (g.day) Q.quests.bump('x', -g.xp, g.day);
    st.stats[g.stat] = Math.max(0, (st.stats[g.stat] || 0) - g.xp);
    Q.pals.revertGain(g.pals);
    if (st.boss && !st.boss.defeated) st.boss.hp = Math.min(st.boss.maxHp, st.boss.hp + (g.bossDmg || 0));
    const db = st.dailyBoss;
    if (db && !db.defeated && db.day === g.day) db.hp = Math.min(db.maxHp, db.hp + (g.dayDmg || 0));
    revertDrop(g.drop);
  }

  /* ----------------------------------------------------- reminder due times */
  // All-day reminders (r.allDay) keep `due` at midnight of their date and can be
  // done any time that day; they only become overdue when the game day ends.
  const remAllDay = (r) => !!(r && r.allDay && r.due);
  const remDay = (r) => U.ymd(new Date(r.due));
  function remDeadline(r) {
    if (!r || !r.due) return null;
    if (!remAllDay(r)) return r.due;
    const e = U.at(remDay(r), '00:00'); e.setHours((S().settings.dayStart || 0) + 24, 0, 0, 0);
    return e.getTime();
  }
  const remOverdue = (r, now = Date.now()) => !!(r && !r.done && r.due && now > remDeadline(r));
  const remWhen = (r) => (!r.due ? 'No date' : remAllDay(r) ? `${U.fmtDay(new Date(r.due))} · Any time` : `${U.fmtDay(new Date(r.due))} · ${U.fmtTime(new Date(r.due))}`);

  /* ------------------------------------------------------------ time budgets */
  // A daily or reminder can have a time budget in minutes ("study for 2 h").
  // Focus sessions on it and time you log add up; reaching the budget ticks it off.
  const budgetOf = (t) => Math.max(0, Math.round(+(t && t.budget) || 0));
  /** Minutes spent: today's for a daily, the running total for a reminder. */
  const spentOn = (kind, t, day = today()) => Math.round(kind === 'daily' ? ((t.spent || {})[day] || 0) : (+t.spent || 0));
  /** Longer tasks pay more when you finish them: +1 base per 6 minutes, up to +30. */
  const budgetBonus = (t) => Math.min(30, Math.round(budgetOf(t) / 6));
  function logTime(kind, id, minutes, source = 'manual') {
    const st = S();
    minutes = Math.round(minutes);
    if (!(minutes > 0)) return null;
    const t = (kind === 'daily' ? st.dailies : st.reminders).find((x) => x.id === id);
    if (!t) return null;
    const day = today();
    if (kind === 'daily') {
      t.spent = t.spent || {};
      t.spent[day] = (t.spent[day] || 0) + minutes;
      const keys = Object.keys(t.spent).sort();
      while (keys.length > 60) delete t.spent[keys.shift()];
    } else t.spent = (+t.spent || 0) + minutes;
    const b = budgetOf(t); const spent = spentOn(kind, t, day);
    if (source === 'manual') Q.store.log(`Logged ${U.fmtDuration(minutes)} on ${t.title}`, 'focus');
    let completed = false;
    if (b && spent >= b && spent - minutes < b) {
      push({ type: 'budgetDone', title: t.title, minutes: b });
      if (kind === 'daily' && !isDone(t)) { toggleDaily(id); completed = true; }
      else if (kind === 'reminder' && !t.done) { completeReminder(id); completed = true; }
    }
    if (!completed) afterAction();
    return { spent, budget: b, completed };
  }

  /**
   * Set the time spent (today's for a daily, the total for a reminder) to an
   * exact amount, e.g. "I did 2 h of 3". Going up works like logging time;
   * going down just corrects the number (a task already ticked off stays done).
   */
  function setTime(kind, id, minutes) {
    const st = S();
    const t = (kind === 'daily' ? st.dailies : st.reminders).find((x) => x.id === id);
    if (!t) return null;
    minutes = Math.max(0, Math.round(minutes));
    const cur = spentOn(kind, t);
    if (minutes > cur) return logTime(kind, id, minutes - cur);
    if (kind === 'daily') { t.spent = t.spent || {}; t.spent[today()] = minutes; } else t.spent = minutes;
    if (minutes < cur) Q.store.log(`Set time on ${t.title} to ${U.fmtDuration(minutes)}`, 'focus');
    afterAction();
    return { spent: minutes, budget: budgetOf(t), completed: false };
  }

  /* --------------------------------------------------------------- dailies */
  function toggleDaily(id) {
    const st = S();
    const d = st.dailies.find((x) => x.id === id);
    if (!d) return;
    const day = today();
    d.done = d.done || {};
    if (d.done[day]) {
      revert(d.done[day]);
      delete d.done[day];
      d.streak = Math.max(0, (d.streak || 0) - 1);
      st.counters.completions = Math.max(0, st.counters.completions - 1);
      push({ type: 'uncheck' });
    } else {
      const now = new Date();
      const due = dueAt(d, day);
      const onTime = !!due && now <= U.addMinutes(due, 30);
      if (onTime && now.getHours() < 8) st.counters.earlyBird++;
      d.streak = (d.streak || 0) + 1;
      d.best = Math.max(d.best || 0, d.streak);
      st.counters.maxStreak = Math.max(st.counters.maxStreak, d.streak);
      const g = grant({ base: 10 + budgetBonus(d), diff: d.difficulty, category: d.category, onTime, streak: d.streak, kind: 'daily' });
      g.at = Date.now();
      if (onTime) g.onTime = true;
      d.done[day] = g;
      st.counters.completions++;
      pruneDone(d);
      Q.store.log(`${d.title}`, 'daily', { xp: g.xp, gold: g.gold });
      checkPerfectToday();
    }
    afterAction();
  }

  function pruneDone(d) {
    const keys = Object.keys(d.done || {}).sort();
    while (keys.length > 200) delete d.done[keys.shift()];
  }

  function toggleCheckItem(dailyId, itemId) {
    const d = S().dailies.find((x) => x.id === dailyId);
    if (!d) return;
    const day = today();
    d.checkDate = d.checkDate === day ? day : (d.checklist.forEach((c) => (c.done = false)), day);
    const it = d.checklist.find((c) => c.id === itemId);
    if (!it) return;
    it.done = !it.done;
    if (d.checklist.length && d.checklist.every((c) => c.done) && !isDone(d)) toggleDaily(d.id);
    else Q.store.commit('check');
  }
  /** Checklists reset each game day. */
  const checklistState = (d) => (d.checkDate === today() ? d.checklist : d.checklist.map((c) => Object.assign({}, c, { done: false })));

  function checkPerfectToday() {
    const list = todaysDailies();
    if (list.length >= 2 && list.every((d) => isDone(d))) {
      const st = S();
      if (st.day.perfectAnnounced !== today()) {
        st.day.perfectAnnounced = today();
        push({ type: 'perfect' });
      }
    }
  }

  /* ---------------------------------------------------------------- habits */
  function habit(id, dir) {
    const st = S();
    const h = st.habits.find((x) => x.id === id);
    if (!h) return;
    const day = today();
    h.count = h.countDate === day ? h.count || { up: 0, down: 0 } : { up: 0, down: 0 };
    h.countDate = day;
    if (dir > 0) {
      h.count.up++;
      const g = grant({ base: 5, diff: h.difficulty, category: h.category, kind: 'habit', drops: h.count.up <= 3 });
      Q.store.log(`+ ${h.title}`, 'habit', { xp: g.xp, gold: g.gold });
      st.counters.completions++;
    } else {
      h.count.down++;
      const dmg = damage((DIFF[h.difficulty] || DIFF.easy).dmg * 0.75, `− ${h.title}`);
      push({ type: 'hurt', dmg });
    }
    afterAction();
  }

  /* ------------------------------------------------------------- reminders */
  function nextOccurrence(r) {
    const d = new Date(r.due);
    switch (r.repeat) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
      default: return null;
    }
    return d.getTime();
  }

  function completeReminder(id) {
    const st = S();
    const r = st.reminders.find((x) => x.id === id);
    if (!r || r.done) return;
    Q.store.snapshot();
    const onTime = r.due ? Date.now() <= (remAllDay(r) ? remDeadline(r) : r.due + 30 * 60000) : true;
    const g = grant({ base: 12 + budgetBonus(r), diff: r.difficulty, category: r.category, onTime: onTime && !!r.due, kind: 'reminder' });
    st.counters.completions++;
    st.counters.remindersDone++;
    Q.quests.noteReminder(r.id);
    Q.store.log(r.title, 'reminder', { xp: g.xp, gold: g.gold });
    const next = r.due && r.repeat && r.repeat !== 'none' ? nextOccurrence(r) : null;
    if (next) {
      // Repeating reminders roll forward instead of piling up.
      r.due = next; r.snoozedUntil = null; r.gcalDirty = true; r.spent = 0;
    } else {
      r.done = true; r.doneAt = Date.now();
    }
    afterAction();
    return g;
  }

  function reopenReminder(id) {
    const r = S().reminders.find((x) => x.id === id);
    if (r) { r.done = false; r.doneAt = null; Q.store.commit('reminder'); }
  }

  /* ---------------------------------------------------------------- damage */
  function damage(amount, reason) {
    const st = S();
    const red = Math.min(0.6, Math.min(0.45, sl('end') * 0.03) + Q.pals.fx().dmgRed / 100);
    const dmg = Math.max(1, Math.round(amount * (1 - red) * 10) / 10);
    st.hero.hp = Math.round((st.hero.hp - dmg) * 10) / 10;
    Q.store.log(`${reason}: −${dmg} HP`, 'hurt');
    if (st.hero.hp <= 0) faint();
    return dmg;
  }

  function faint() {
    const st = S();
    const lost = Math.floor(st.hero.gold / 2);
    st.hero.gold -= lost;
    st.hero.hp = maxHp();
    st.counters.faints++;
    Q.store.log(`You fainted and lost ${lost} gold. ${Q.pals.name(Q.pals.lead())} carried you back to the Inn.`, 'faint');
    push({ type: 'faint', lost });
  }

  function heal(n) {
    const h = S().hero;
    const before = h.hp;
    h.hp = Math.min(maxHp(), h.hp + n);
    return Math.round((h.hp - before) * 10) / 10;
  }

  /* ------------------------------------------------------------------ boss */
  /**
   * Boss health is measured in "dailies' worth of damage": a daily hits for about
   * 9 × its difficulty multiplier (more with streak and on-time bonuses).
   *   - Weekly boss: 1.15 × the whole week's scheduled dailies, so it takes the
   *     week's dailies plus some reminders or focus sessions.
   *   - Daily foe: 0.8 × today's dailies, so it falls to most of one day's work.
   * Both get a little tougher as you level up.
   */
  const BOSS = { weekFactor: 1.15, weekMin: 200, weekMax: 3000, dayFactor: 0.8, dayMin: 30, dayMax: 500 };
  const levelScale = () => 1 + Math.min(0.6, Math.max(0, S().hero.level - 1) * 0.03);
  function dailiesDamage(ds) {
    let dmg = 0;
    for (const d of S().dailies) if (!d.archived && isScheduled(d, ds)) dmg += 9 * (DIFF[d.difficulty] || DIFF.easy).mult;
    return dmg;
  }
  function bossHpFor(wk) {
    let dmg = 0;
    for (let i = 0; i < 7; i++) dmg += dailiesDamage(U.ymd(U.addDays(U.parseYmd(wk), i)));
    return U.clamp(Math.round(dmg * BOSS.weekFactor * levelScale()), BOSS.weekMin, BOSS.weekMax);
  }
  function dailyBossHpFor(day) {
    return U.clamp(Math.round(dailiesDamage(day) * BOSS.dayFactor * levelScale()), BOSS.dayMin, BOSS.dayMax);
  }

  /**
   * Today's foe: a wild pal (Common or Rare) that changes every day. Smaller than the
   * weekly boss and with smaller loot; it simply leaves at the day reset if not beaten.
   */
  function ensureDailyBoss() {
    const st = S();
    const day = today();
    const cur = st.dailyBoss;
    if (cur && cur.day === day) {
      if (!cur.defeated) {
        const target = dailyBossHpFor(day);
        if (target > cur.maxHp) { cur.hp += target - cur.maxHp; cur.maxHp = target; }
      }
      return cur;
    }
    const pool = Q.PALS.LINES.filter((l) => l.r === 'C' || l.r === 'R');
    const line = pool[U.hash(`${day}foe`) % pool.length];
    const stage = 1 + (U.hash(`${day}stage`) % 2);
    const maxHp = dailyBossHpFor(day);
    st.dailyBoss = { day, id: line.id, stage, name: `Wild ${line.names[stage - 1]}`, type: line.type, maxHp, hp: maxHp, defeated: false };
    return st.dailyBoss;
  }

  function damageDailyBoss(n) {
    const st = S();
    const b = ensureDailyBoss();
    if (b.defeated || n <= 0) return 0;
    const hit = Math.min(b.hp, n);
    b.hp -= hit;
    if (b.hp <= 0) {
      b.hp = 0; b.defeated = true;
      st.counters.dailyBossesDefeated = (st.counters.dailyBossesDefeated || 0) + 1;
      const gold = 15 + st.hero.level * 2;
      st.hero.gold += gold;
      // Every third foe also drops a Potion.
      const potion = st.counters.dailyBossesDefeated % 3 === 0;
      if (potion) st.inventory.potion = (st.inventory.potion || 0) + 1;
      Q.store.log(`Beat today's foe, ${b.name}! +${gold} gold${potion ? ' and a Potion' : ''}`, 'boss');
      push({ type: 'dailyBoss', name: b.name, gold, potion });
      gainXp(10);
    }
    return hit;
  }

  /** Boss log for the Pals page: how often you met and beat each weekly boss. */
  function noteBoss(id, what, week) {
    const st = S();
    st.bossLog = st.bossLog || {};
    const e = st.bossLog[id] || (st.bossLog[id] = { met: 0, beat: 0, last: '' });
    e[what] = (e[what] || 0) + 1;
    if (what === 'beat' && e.met < e.beat) e.met = e.beat;
    if (week > (e.last || '')) e.last = week;
  }

  function ensureBoss() {
    const st = S();
    const wk = U.weekKey(U.parseYmd(today()), st.settings.weekStart);
    if (st.boss && st.boss.week === wk) {
      // Dailies added mid-week make the boss tougher too (it never gets weaker).
      const b = st.boss;
      if (!b.defeated) {
        const target = bossHpFor(wk);
        if (target > b.maxHp) { b.hp += target - b.maxHp; b.maxHp = target; }
      }
      return b;
    }
    if (st.boss && !st.boss.defeated) Q.store.log(`${st.boss.name} slipped away at the end of the week.`, 'boss');
    // Kept for the weekly review.
    if (st.boss) st.lastBoss = { week: st.boss.week, id: st.boss.id, name: st.boss.name, defeated: !!st.boss.defeated, maxHp: st.boss.maxHp, hp: st.boss.hp };
    const list = Q.PALS.BOSSES;
    let pickB = list[U.hash(wk) % list.length];
    if (st.boss && st.boss.id === pickB.id) pickB = list[(list.indexOf(pickB) + 1) % list.length];
    const maxHpB = bossHpFor(wk);
    noteBoss(pickB.id, 'met', wk);
    st.boss = { week: wk, id: pickB.id, name: pickB.name, taunt: pickB.taunt, type: pickB.type, maxHp: maxHpB, hp: maxHpB, defeated: false };
    return st.boss;
  }

  function damageBoss(n) {
    const st = S();
    const b = ensureBoss();
    if (b.defeated || n <= 0) return 0;
    const hit = Math.min(b.hp, n);
    b.hp -= hit;
    if (b.hp <= 0) {
      b.hp = 0; b.defeated = true;
      st.counters.bossesDefeated++;
      noteBoss(b.id, 'beat', b.week);
      const gold = 50 + st.hero.level * 5;
      const items = ['shield', 'potion', 'charm', 'maxpotion'];
      const item = items[U.hash(b.week + 'loot') % items.length];
      st.hero.gold += gold;
      st.inventory[item] = (st.inventory[item] || 0) + 1;
      st.inventory.ticket = (st.inventory.ticket || 0) + 1;
      if (Q.pals.advantage(b).pals.length) st.counters.advantageWins = (st.counters.advantageWins || 0) + 1;
      Q.store.log(`Defeated ${b.name}! +${gold} gold, a ${SHOP.items[item].name} and a Capsule Ticket`, 'boss');
      push({ type: 'boss', name: b.name, gold, item, ticket: 1 });
      gainXp(40);
    }
    return hit;
  }

  /* -------------------------------------------------------------- rollover */
  /**
   * Called on start and every minute. If the game day changed, returns the
   * day to review (dailies left unticked). The UI shows "Record yesterday",
   * then calls finalizeDay with what you actually did.
   */
  function checkRollover() {
    const st = S();
    const t = today();
    if (st.day.last >= t) return null;
    const last = st.day.last;
    const missed = st.dailies.filter((d) => !d.archived && isScheduled(d, last) && !isDone(d, last) && (d.createdAt || 0) < U.at(last, '23:59').getTime());
    return { date: last, missed };
  }

  function finalizeDay(review, tickedIds = []) {
    const st = S();
    const t = today();
    const day = review.date;
    // Things you did but forgot to log count as done (full reward).
    for (const id of tickedIds) {
      const d = st.dailies.find((x) => x.id === id);
      if (!d) continue;
      d.streak = (d.streak || 0) + 1;
      d.best = Math.max(d.best || 0, d.streak);
      d.done = d.done || {};
      d.done[day] = grant({ base: 10 + budgetBonus(d), diff: d.difficulty, category: d.category, streak: d.streak, kind: 'daily' });
      st.counters.completions++;
    }
    const missed = review.missed.filter((d) => !tickedIds.includes(d.id));
    const inn = st.settings.inn;
    const rest = isRestDay(day);
    const fx = Q.pals.fx();
    let shieldUsed = false;
    let totalDmg = 0;
    const saved = [];
    if (missed.length && rest && !inn) Q.store.log('Weekend rest day: missed dailies cost nothing and streaks are safe.', 'shield');
    if (missed.length && !inn && !rest) {
      const needShield = missed.some((d) => (d.streak || 0) >= 3);
      if (needShield && st.inventory.shield > 0) {
        shieldUsed = true;
        if (Math.random() * 100 < fx.shieldSave) Q.store.log('Your team kept the Streak Shield intact. It still protected your streaks.', 'shield');
        else st.inventory.shield--;
      }
      for (const d of missed) {
        const dd = st.dailies.find((x) => x.id === d.id);
        const done = (dd.checklist || []).filter((c) => c.done).length;
        const frac = dd.checklist && dd.checklist.length && dd.checkDate === day ? 1 - done / dd.checklist.length : 1;
        totalDmg += (DIFF[dd.difficulty] || DIFF.easy).dmg * frac;
        if (!shieldUsed) {
          if ((dd.streak || 0) > 0 && Math.random() * 100 < fx.streakGuard) saved.push(dd.title);
          else dd.streak = 0;
        }
        const b = ensureBoss();
        if (!b.defeated) b.hp = Math.min(b.maxHp, b.hp + 6);
      }
      if (totalDmg > 0) {
        const dealt = damage(totalDmg, `Missed ${missed.length} ${missed.length === 1 ? 'daily' : 'dailies'}`);
        push({ type: 'hurt', dmg: dealt, rollover: true });
      }
      if (shieldUsed) Q.store.log('A Streak Shield protected your streaks.', 'shield');
      if (saved.length) Q.store.log(`Your team saved the streak on ${saved.join(', ')}.`, 'shield');
    }
    // Days the app wasn't opened: streaks break (except on rest days), but no damage.
    for (let x = U.addDays(U.parseYmd(day), 1); U.ymd(x) < t; x = U.addDays(x, 1)) {
      const ds = U.ymd(x);
      if (inn) break;
      if (isRestDay(ds)) continue;
      for (const d of st.dailies) if (!d.archived && isScheduled(d, ds)) d.streak = 0;
    }
    // Day log for the heatmap.
    const sched = st.dailies.filter((d) => !d.archived && isScheduled(d, day));
    const doneN = sched.filter((d) => isDone(d, day)).length;
    st.dayLog[day] = Object.assign(st.dayLog[day] || {}, { d: doneN, t: sched.length });
    if (sched.length >= 2 && doneN === sched.length) {
      st.counters.perfectDays++;
      st.buffs.perfectDay = t;
      st.hero.gold += 15;
      Q.store.log('Perfect day! +15 gold and +10% XP today.', 'perfect');
    }
    // A week just ended: perfect-week bonus (the review shows on the next check).
    const wkDone = U.weekKey(U.parseYmd(day), st.settings.weekStart);
    if (wkDone !== U.weekKey(U.parseYmd(t), st.settings.weekStart)) Q.quests.endOfWeek(wkDone);
    st.day.last = t;
    st.day.dropsToday = 0; st.day.dropsDate = t;
    st.hero.hp = Math.min(maxHp(), st.hero.hp + 2 + fx.healDay); // a good night's sleep (+ team healing)
    ensureBoss();
    afterAction();
    return { totalDmg, shieldUsed, missed: missed.length, rest, saved };
  }

  /* ------------------------------------------------------------------ focus */
  /** Focus rewards: 0.8 base per minute, times the Pomodoro combo multiplier. */
  function focusComplete(minutes, taskId, mult = 1, bonusItem = null) {
    const st = S();
    minutes = Math.round(minutes);
    if (minutes < 5) return null;
    const linkedDaily = taskId && st.dailies.find((d) => d.id === taskId);
    const linked = linkedDaily || (taskId && st.reminders.find((r) => r.id === taskId));
    const g = grant({ base: minutes * 0.8 * mult, diff: 'easy', category: linked ? linked.category : 'study', kind: 'focus' });
    if (bonusItem) {
      st.inventory[bonusItem] = (st.inventory[bonusItem] || 0) + 1;
      g.bonusItem = bonusItem;
    }
    st.counters.focusSessions++;
    st.counters.focusMinutes += minutes;
    const day = today();
    st.dayLog[day] = Object.assign(st.dayLog[day] || {}, { f: ((st.dayLog[day] || {}).f || 0) + minutes, fs: ((st.dayLog[day] || {}).fs || 0) + 1 });
    Q.quests.onFocus(minutes);
    // Time spent on a task with a time budget counts toward it.
    if (linked && budgetOf(linked)) logTime(linkedDaily ? 'daily' : 'reminder', linked.id, minutes, 'focus');
    const comboTxt = mult > 1 ? ` (combo ×${mult.toFixed(2)})` : '';
    Q.store.log(`Focused for ${minutes} min${linked ? ` on ${linked.title}` : ''}${comboTxt}`, 'focus', { xp: g.xp, gold: g.gold });
    afterAction();
    return g;
  }

  /** What a focus session of this length would pay right now (no random gold spread). */
  function focusPreview(minutes, mult = 1) {
    const fx = Q.pals.fx();
    const base = Math.round(minutes) * 0.8 * mult * (1 + palRewardPct(fx, 'focus') / 100);
    return {
      xp: Math.max(1, Math.round(base * bonusMult() * (1 + fx.xpPct / 100))),
      gold: Math.max(1, Math.round(base * 0.4 * (1 + sl('cha') * 0.02) * (1 + fx.goldPct / 100))),
    };
  }

  /* ------------------------------------------------------------------- shop */
  const SHOP = {
    items: {
      potion: { name: 'Potion', price: 25, desc: 'Restores 15 HP.', icon: 'potion', color: '#E879A8' },
      maxpotion: { name: 'Max Potion', price: 70, desc: 'Restores all HP.', icon: 'potion', color: '#8E6BD1' },
      shield: { name: 'Streak Shield', price: 40, desc: 'Auto-used on a missed day. Keeps every streak alive.', icon: 'shield', color: '#3C82C8' },
      charm: { name: 'Lucky Charm', price: 60, desc: '1.5× XP for the next 2 hours.', icon: 'star', color: '#F2C14E' },
    },
    /*
     * Permanent upgrades: each level adds a passive effect that stacks with pal
     * abilities and team synergy (see Q.pals.fx). Price goes up each level.
     */
    upgrades: {
      satchel: { name: "Scholar's Satchel", icon: 'note', color: '#3C82C8', fx: 'xpPct', per: 3, max: 5, base: 120, desc: 'More XP from everything.' },
      purse: { name: "Merchant's Purse", icon: 'coin', color: '#E3A21A', fx: 'goldPct', per: 4, max: 5, base: 120, desc: 'More gold from everything.' },
      blade: { name: "Hero's Blade", icon: 'sword', color: '#E8604C', fx: 'bossPct', per: 5, max: 5, base: 100, desc: 'Hit bosses and daily foes harder.' },
      whistle: { name: "Trainer's Whistle", icon: 'paw', color: '#58B368', fx: 'palExpPct', per: 5, max: 5, base: 100, desc: 'Your team levels up faster.' },
      vest: { name: 'Iron Vest', icon: 'shield', color: '#7D8597', fx: 'dmgRed', per: 4, max: 5, base: 110, desc: 'Take less HP damage for missed dailies.' },
      vitality: { name: 'Vitality Charm', icon: 'heart', color: '#E85848', hp: true, per: 5, max: 5, base: 90, desc: 'Raises your maximum HP.' },
      clover: { name: 'Four-Leaf Clover', icon: 'leaf', color: '#2FA58A', fx: 'dropPct', per: 10, max: 3, base: 150, desc: 'Find items more often.' },
      lantern: { name: 'Focus Lantern', icon: 'hourglass', color: '#8E6BD1', fx: 'focusPct', per: 8, max: 3, base: 90, desc: 'Bigger rewards from focus rounds.' },
      stew: { name: 'Hearty Stew', icon: 'potion', color: '#C9702E', fx: 'healDay', per: 1, max: 3, base: 140, desc: 'Heal a little more every new day.' },
    },
    skins: {
      meadow: { mode: 'light', name: 'Meadow', price: 0, desc: 'Fresh greens and sky blue.', sw: ['#EAF4E4', '#58B368', '#3C82C8'] },
      ember: { mode: 'light', name: 'Ember Town', price: 150, desc: 'Warm brick reds and cream.', sw: ['#FBEFE6', '#E8604C', '#F2C14E'] },
      emerald: { mode: 'light', name: 'Emerald Coast', price: 150, desc: 'Teal greens with a gold trim.', sw: ['#E4F4EE', '#2FA58A', '#F2C14E'] },
      tide: { mode: 'light', name: 'Tide Route', price: 150, desc: 'Ocean blues and sea-foam.', sw: ['#E6F0FA', '#3C82C8', '#2FA58A'] },
      sakura: { mode: 'light', name: 'Blossom Lane', price: 200, desc: 'Cherry pinks with leaf green.', sw: ['#FBEFF3', '#E879A8', '#58B368'] },
      sunflower: { mode: 'light', name: 'Sunflower Field', price: 200, desc: 'Golden yellows with a sky-blue trim.', sw: ['#FBF4DE', '#D99A1E', '#3C82C8'] },
      lavender: { mode: 'light', name: 'Lavender Hill', price: 220, desc: 'Soft purples with mint.', sw: ['#F2EEFA', '#7E5FC4', '#3FAF8E'] },
      autumn: { mode: 'light', name: 'Autumn Grove', price: 220, desc: 'Pumpkin orange and fallen-leaf browns.', sw: ['#F8EEE2', '#C8622A', '#8C6A2E'] },
      night: { mode: 'dark', name: 'Night Meadow', price: 0, desc: 'Meadow after sunset: mossy greens.', sw: ['#1C2724', '#6CCB7F', '#74B9F0'] },
      dusk: { mode: 'dark', name: 'Dusk Village', price: 200, desc: 'Twilight purples with lantern gold.', sw: ['#232B44', '#A68BE8', '#F2C14E'] },
      lava: { mode: 'dark', name: 'Lava Cave', price: 200, desc: 'Warm embers glowing in the dark.', sw: ['#271D1C', '#F2826A', '#F2C14E'] },
      deepsea: { mode: 'dark', name: 'Deep Sea', price: 200, desc: 'Midnight navy with bioluminescent teal.', sw: ['#15212E', '#5DB8EC', '#52D3B3'] },
      moonblossom: { mode: 'dark', name: 'Moonlit Blossom', price: 250, desc: 'Plum night with cherry-pink glow.', sw: ['#261E2C', '#F293BC', '#8ED69C'] },
      aurora: { mode: 'dark', name: 'Aurora Peak', price: 250, desc: 'Polar night lit by green and violet lights.', sw: ['#141F27', '#5FE3B0', '#B28BF5'] },
      crystal: { mode: 'dark', name: 'Crystal Cave', price: 250, desc: 'Deep slate with glowing cyan crystals.', sw: ['#1A1D2A', '#62D6EE', '#F07DC8'] },
      harvest: { mode: 'dark', name: 'Harvest Moon', price: 250, desc: 'Woodsmoke browns under an amber moon.', sw: ['#241F1A', '#F0A84A', '#9CCB6B'] },
    },
    scenes: {
      meadow: { name: 'Sunny Meadow', price: 0 },
      rain: { name: 'Rainy Route', price: 0 },
      night: { name: 'Firefly Camp', price: 150 },
      sea: { name: 'Seaside Dock', price: 150 },
      snow: { name: 'Snowy Pass', price: 150 },
      autumn: { name: 'Autumn Grove', price: 180 },
      blossom: { name: 'Blossom Garden', price: 180 },
      desert: { name: 'Desert Oasis', price: 200 },
      aurora: { name: 'Aurora Peak', price: 250 },
    },
    outfits: {
      classic: { price: 0, lvl: 1 }, meadow: { price: 80, lvl: 1 }, tide: { price: 80, lvl: 3 },
      sunset: { price: 120, lvl: 5 }, sakura: { price: 120, lvl: 8 }, forest: { price: 140, lvl: 6 },
      ember: { price: 160, lvl: 10 }, frost: { price: 180, lvl: 12 }, shadow: { price: 220, lvl: 15 },
      royal: { price: 300, lvl: 20 }, aurora: { price: 400, lvl: 25 },
    },
  };

  function buy(kind, key) {
    const st = S();
    const cat = SHOP[kind]; const it = cat && cat[key];
    if (!it) return { ok: false, msg: 'Unknown item' };
    if (it.lvl && st.hero.level < it.lvl) return { ok: false, msg: `Unlocks at level ${it.lvl}` };
    if (st.hero.gold < it.price) return { ok: false, msg: `You need ${it.price - st.hero.gold} more gold` };
    st.hero.gold -= it.price;
    if (kind === 'items') st.inventory[key] = (st.inventory[key] || 0) + 1;
    else { const list = st.owned[kind]; if (!list.includes(key)) list.push(key); }
    Q.store.log(`Bought ${it.name || Q.sprites.OUTFITS[key]?.name}`, 'shop');
    afterAction();
    return { ok: true };
  }

  function useItem(key) {
    const st = S();
    if (!(st.inventory[key] > 0)) return { ok: false, msg: 'None left' };
    let msg = '';
    if (key === 'potion') { if (st.hero.hp >= maxHp()) return { ok: false, msg: 'HP is already full' }; msg = `Restored ${heal(15)} HP`; }
    else if (key === 'maxpotion') { if (st.hero.hp >= maxHp()) return { ok: false, msg: 'HP is already full' }; msg = `Restored ${heal(999)} HP`; }
    else if (key === 'charm') { st.buffs.charmUntil = Math.max(Date.now(), st.buffs.charmUntil) + 2 * 3600000; msg = '1.5× XP for 2 hours'; }
    else return { ok: false, msg: 'Shields are used automatically.' };
    st.inventory[key]--;
    Q.store.log(`Used ${SHOP.items[key].name}: ${msg}`, 'item');
    afterAction();
    return { ok: true, msg };
  }

  function buyReward(id) {
    const st = S();
    const r = st.rewards.find((x) => x.id === id);
    if (!r) return { ok: false, msg: 'Missing reward' };
    if (st.hero.gold < r.cost) return { ok: false, msg: `You need ${r.cost - st.hero.gold} more gold` };
    st.hero.gold -= r.cost;
    st.counters.rewardsBought = (st.counters.rewardsBought || 0) + 1;
    Q.store.log(`Treated yourself: ${r.title}`, 'shop');
    afterAction();
    return { ok: true };
  }

  /* ---------------------------------------------------------- achievements */
  // reward: { gold, ticket } paid when the achievement unlocks.
  const P = () => Q.pals;
  const ACH = [
    { id: 'first', name: 'First Steps', desc: 'Complete your first task.', reward: { gold: 10 }, test: (s) => s.counters.completions >= 1 },
    { id: 'sprout', name: 'Sprout Badge', badge: '#58B368', desc: 'Complete 10 tasks.', reward: { gold: 25 }, test: (s) => s.counters.completions >= 10 },
    { id: 'dawn', name: 'Dawn Badge', badge: '#F29A4E', desc: 'Reach a 7-day streak on any daily.', reward: { gold: 40 }, test: (s) => s.counters.maxStreak >= 7 },
    { id: 'tide', name: 'Tide Badge', badge: '#3C82C8', desc: 'Have 5 perfect days.', reward: { gold: 50 }, test: (s) => s.counters.perfectDays >= 5 },
    { id: 'lantern', name: 'Lantern Badge', badge: '#F2C14E', desc: 'Finish 10 focus sessions.', reward: { gold: 40 }, test: (s) => s.counters.focusSessions >= 10 },
    { id: 'stone', name: 'Stone Badge', badge: '#7D8597', desc: 'Defeat a weekly boss.', reward: { gold: 50 }, test: (s) => s.counters.bossesDefeated >= 1 },
    { id: 'skirmish', name: 'Skirmisher', desc: 'Beat a daily foe.', reward: { gold: 15 }, test: (s) => (s.counters.dailyBossesDefeated || 0) >= 1 },
    { id: 'foes20', name: 'Foe Hunter', desc: 'Beat 20 daily foes.', reward: { gold: 80, ticket: 1 }, test: (s) => (s.counters.dailyBossesDefeated || 0) >= 20 },
    { id: 'ember', name: 'Ember Badge', badge: '#E8604C', desc: 'Reach a 30-day streak.', reward: { gold: 100, ticket: 1 }, test: (s) => s.counters.maxStreak >= 30 },
    { id: 'gale', name: 'Gale Badge', badge: '#2FA58A', desc: 'Complete 50 reminders.', reward: { gold: 60 }, test: (s) => s.counters.remindersDone >= 50 },
    { id: 'crown', name: 'Crown Badge', badge: '#8E6BD1', desc: 'Reach level 25.', reward: { gold: 100, ticket: 1 }, test: (s) => s.hero.level >= 25 },
    { id: 'early', name: 'Early Bird', desc: 'Finish 5 timed dailies on time before 8 AM.', reward: { gold: 40 }, test: (s) => s.counters.earlyBird >= 5 },
    { id: 'deep', name: 'Deep Diver', desc: 'Focus for 10 hours in total.', reward: { gold: 60 }, test: (s) => s.counters.focusMinutes >= 600 },
    { id: 'hoard', name: 'Treasure Keeper', desc: 'Hold 500 gold at once.', reward: { gold: 25 }, test: (s) => s.hero.gold >= 500 },
    { id: 'treat', name: 'Earned It', desc: 'Buy one of your own rewards.', reward: { gold: 20 }, test: (s) => (s.counters.rewardsBought || 0) >= 1 },
    { id: 'century', name: 'Centurion', desc: 'Complete 100 tasks.', reward: { gold: 75 }, test: (s) => s.counters.completions >= 100 },
    { id: 'bounty1', name: 'Bounty Hunter', desc: 'Clear a whole bounty board in one day.', reward: { gold: 20 }, test: (s) => (s.counters.bountyBoards || 0) >= 1 },
    { id: 'bounty15', name: 'Most Wanted', desc: 'Clear 15 bounty boards.', reward: { gold: 100, ticket: 1 }, test: (s) => (s.counters.bountyBoards || 0) >= 15 },
    { id: 'pweek', name: 'Perfect Week', desc: 'Every daily done, every day of a week.', reward: { gold: 50 }, test: (s) => (s.counters.perfectWeeks || 0) >= 1 },
    { id: 'phoenix', name: 'Back on Your Feet', desc: 'Faint once, and keep going.', reward: { gold: 30 }, test: (s) => s.counters.faints >= 1 },
    // Pals
    { id: 'team3', pal: true, name: 'Full Party', desc: 'Fill all 3 team slots.', reward: { gold: 30 }, test: () => P().team().length >= 3 },
    { id: 'pal5', pal: true, name: 'Pal Pals', desc: 'Collect 5 pals.', reward: { gold: 100 }, test: () => P().count() >= 5 },
    { id: 'pal10', pal: true, name: 'Collector', desc: 'Collect 10 pals.', reward: { gold: 100, ticket: 1 }, test: () => P().count() >= 10 },
    { id: 'pal20', pal: true, name: 'Pal Curator', desc: 'Collect 20 pals.', reward: { gold: 150, ticket: 1 }, test: () => P().count() >= 20 },
    { id: 'pal35', pal: true, name: 'Living Paldex', desc: 'Collect 35 pals.', reward: { gold: 250, ticket: 1 }, test: () => P().count() >= 35 },
    { id: 'pal50', pal: true, name: 'Completionist', desc: 'Collect all 50 pals.', reward: { gold: 1000 }, test: () => P().count() >= 50 },
    { id: 'type9', pal: true, name: 'Rainbow Trainer', desc: 'Own a pal of every type.', reward: { gold: 100, ticket: 1 }, test: () => P().typesOwned() >= 9 },
    { id: 'rare1', pal: true, name: 'Rare Find', desc: 'Get a Rare pal.', reward: { gold: 50 }, test: () => P().countBy((l) => l.r === 'R') >= 1 },
    { id: 'epic1', pal: true, name: 'Epic Encounter', desc: 'Get an Epic pal.', reward: { gold: 50, ticket: 1 }, test: () => P().countBy((l) => l.r === 'E') >= 1 },
    { id: 'leg1', pal: true, name: 'Legend Found', desc: 'Get a Legendary pal.', reward: { gold: 300 }, test: () => P().countBy((l) => l.r === 'L') >= 1 },
    { id: 'leg3', pal: true, name: 'Myth Keeper', desc: 'Own all 3 Legendary pals.', reward: { gold: 500 }, test: () => P().countBy((l) => l.r === 'L') >= 3 },
    { id: 'evo1', pal: true, name: 'First Evolution', desc: 'Evolve any pal.', reward: { gold: 50 }, test: (s) => (s.pals.evolutions || 0) >= 1 },
    { id: 'grown', pal: true, name: 'All Grown Up', desc: 'A pal reaches its third stage.', reward: { gold: 75 }, test: () => P().ownedIds().some((id) => P().stage(id) >= 3) },
    { id: 'evo10', pal: true, name: 'Evolution Expert', desc: 'Evolve pals 10 times.', reward: { gold: 100, ticket: 1 }, test: (s) => (s.pals.evolutions || 0) >= 10 },
    { id: 'evo25', pal: true, name: 'Metamorphosis', desc: 'Evolve pals 25 times.', reward: { gold: 200, ticket: 1 }, test: (s) => (s.pals.evolutions || 0) >= 25 },
    { id: 'final1', pal: true, name: 'Final Form', desc: 'A pal reaches its final evolution.', reward: { gold: 150, ticket: 1 }, test: () => P().finals() >= 1 },
    { id: 'final5', pal: true, name: 'Apex Team', desc: '5 pals at their final evolution.', reward: { gold: 300, ticket: 1 }, test: () => P().finals() >= 5 },
    { id: 'mono', pal: true, name: 'Type Specialist', desc: 'Field a team of 3 pals of one type.', reward: { gold: 50, ticket: 1 }, test: () => P().sameTypeTeam() },
    { id: 'trip1', pal: true, name: 'Scout', desc: 'Bring a pal home from an expedition.', reward: { gold: 20 }, test: (s) => (s.counters.expeditions || 0) >= 1 },
    { id: 'trip10', pal: true, name: 'Globetrotter', desc: 'Finish 10 expeditions.', reward: { gold: 80, ticket: 1 }, test: (s) => (s.counters.expeditions || 0) >= 10 },
    { id: 'advantage', pal: true, name: 'Super Effective', desc: 'Defeat a boss with a type advantage in your team.', reward: { gold: 50, ticket: 1 }, test: (s) => (s.counters.advantageWins || 0) >= 1 },
  ];
  const rewardText = (r) => (r ? [r.gold ? `+${r.gold} gold` : '', r.ticket ? `+${r.ticket} Capsule Ticket${r.ticket > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') : '');

  function checkAchievements() {
    const st = S();
    for (const a of ACH) {
      if (!st.achievements[a.id] && a.test(st)) {
        st.achievements[a.id] = Date.now();
        if (a.reward) {
          st.hero.gold += a.reward.gold || 0;
          st.inventory.ticket = (st.inventory.ticket || 0) + (a.reward.ticket || 0);
        }
        Q.store.log(`Unlocked: ${a.name}${a.reward ? ` (${rewardText(a.reward)})` : ''}`, 'badge');
        push({ type: 'badge', ach: a });
      }
    }
  }

  function afterAction() {
    Q.quests.check();
    checkAchievements();
    Q.store.commit('game');
  }

  /* ------------------------------------------------------- lead pal chatter */
  function companionMood() {
    const st = S();
    const list = todaysDailies();
    const done = list.filter((d) => isDone(d)).length;
    const ratio = list.length ? done / list.length : 1;
    const hpR = st.hero.hp / maxHp();
    const hour = new Date().getHours();
    if (hpR < 0.3) return 'worried';
    if (ratio >= 0.99 && list.length) return 'ecstatic';
    if (hour >= 23 || hour < 6) return 'sleepy';
    if (ratio >= 0.5) return 'happy';
    return 'okay';
  }

  function companionLine() {
    const st = S();
    const list = todaysDailies();
    const left = list.filter((d) => !isDone(d));
    const next = left.filter((d) => d.time).sort((a, b) => a.time.localeCompare(b.time))[0];
    const mood = companionMood();
    const n = Q.pals.name(Q.pals.lead());
    const lines = {
      worried: [`${n} looks worried. Your HP is low. A Potion or an easy win would help.`, `${n} tugs your sleeve. Maybe tackle something small first?`],
      ecstatic: [`${n} is doing a happy dance! Every daily is done.`, `${n} beams at you. Perfect day so far!`],
      sleepy: [`${n} yawns. It's late. Rest counts as progress too.`, `${n} is curled up and dozing. Big day tomorrow!`],
      happy: [`${n} is cheering you on! ${left.length} ${left.length === 1 ? 'daily' : 'dailies'} to go.`, `${n} hums along. You're on a roll today.`],
      okay: [`${n} is ready when you are. ${left.length} dailies waiting.`, `${n} points at your list. One at a time!`],
    }[mood];
    let line = lines[U.hash(today() + new Date().getHours()) % lines.length];
    if (next && mood !== 'sleepy') {
      const due = dueAt(next, today());
      const mins = (due - new Date()) / 60000;
      if (mins < 0 && mins > -180) line = `${n} reminds you: “${next.title}” was due ${U.rel(due)}.`;
      else if (mins >= 0 && mins < 60) line = `${n} perks up: “${next.title}” is due ${U.rel(due)}.`;
    }
    if (isRestDay(today()) && mood !== 'ecstatic') line = `${n} is enjoying the weekend. Anything you do today is a bonus, and missed dailies won't count.`;
    if (st.settings.inn) line = `${n} is relaxing at the Inn with you. Dailies can't hurt you while you rest.`;
    return { line, mood };
  }

  return {
    DIFF, STATS, SHOP, ACH, rewardText, isRestDay,
    remAllDay, remDay, remDeadline, remOverdue, remWhen, budgetOf, spentOn, logTime, setTime,
    ensureDailyBoss, BOSS, upgradeLevel, upgradePrice, upgradeText, buyUpgrade,
    xpToNext, statLevel, maxHp, title, today, isScheduled, scheduleLabel, dueAt, isDone, todaysDailies,
    toggleDaily, toggleCheckItem, checklistState, habit, completeReminder, reopenReminder, nextOccurrence,
    checkRollover, finalizeDay, focusComplete, focusPreview, buy, useItem, buyReward, ensureBoss, heal,
    companionMood, companionLine, checkAchievements,
    emit: push,
    flush: () => pending.splice(0, pending.length),
  };
})();
