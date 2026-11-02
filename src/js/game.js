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
 *  - A companion that grows with you is the emotional hook (Finch); a weekly
 *    boss gives a medium-term goal (Habitica quests, solo).
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
  const maxHp = () => 50 + sl('str') * 2;
  const title = (lvl) => TITLES.filter(([l]) => lvl >= l).pop()[1];
  const today = () => U.gameDate(new Date(), S().settings.dayStart);

  const companionLevel = () => Math.floor(Math.sqrt((S().companion.xp || 0) / 20)) + 1;
  const companionStage = () => { const l = companionLevel(); return l >= 20 ? 3 : l >= 8 ? 2 : 1; };
  const STAGE_NAMES = { 1: 'Baby', 2: 'Teen', 3: 'Grown' };

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

  function companionGain(xp) {
    const c = S().companion;
    const before = companionStage();
    c.xp = Math.max(0, (c.xp || 0) + xp);
    const after = companionStage();
    if (after > before) {
      Q.store.log(`${c.name} grew into its ${STAGE_NAMES[after]} form!`, 'evolve');
      push({ type: 'evolve', stage: after });
    }
  }

  function rollDrop() {
    const st = S();
    if (st.day.dropsDate !== today()) { st.day.dropsDate = today(); st.day.dropsToday = 0; }
    if (st.day.dropsToday >= 6) return null;
    if (Math.random() > 0.11 + sl('spi') * 0.01) return null;
    st.day.dropsToday++;
    st.counters.drops++;
    const r = Math.random();
    if (r < 0.55) { st.inventory.berry++; return { item: 'berry', text: 'Found a Berry!' }; }
    if (r < 0.72) { st.inventory.potion++; return { item: 'potion', text: 'Found a Potion!' }; }
    if (r < 0.95) { const g = 12 + Math.floor(Math.random() * 18); st.hero.gold += g; return { item: 'gold', gold: g, text: `Found a gold pouch (+${g})!` }; }
    st.inventory.shield++; return { item: 'shield', text: 'Found a Streak Shield!' };
  }

  function revertDrop(drop) {
    if (!drop) return;
    const inv = S().inventory;
    if (drop.item === 'gold') S().hero.gold = Math.max(0, S().hero.gold - drop.gold);
    else if (inv[drop.item] > 0) inv[drop.item]--;
  }

  /** Apply a reward and return the grant record (for undo). */
  function grant({ base = 10, diff = 'easy', category = 'home', onTime = false, streak = 0, kind = 'task', drops = true }) {
    const st = S();
    const mult = (DIFF[diff] || DIFF.easy).mult;
    const streakB = 1 + Math.min(streak, 50) * 0.01;
    const onTimeB = onTime ? 1.2 : 1;
    const xp = Math.max(1, Math.round(base * mult * streakB * onTimeB * bonusMult()));
    const variance = 0.85 + Math.random() * 0.3;
    const gold = Math.max(1, Math.round(base * 0.4 * mult * (1 + sl('cha') * 0.02) * variance * onTimeB));
    const stat = (Q.store.CATEGORIES[category] || Q.store.CATEGORIES.home).stat;
    const bossDmg = Math.round(xp * 0.9);

    gainXp(xp);
    st.hero.gold += gold;
    st.stats[stat] = (st.stats[stat] || 0) + xp;
    companionGain(Math.round(xp * 0.5));
    const hit = damageBoss(bossDmg);
    const drop = drops ? rollDrop() : null;
    if (drop) push({ type: 'drop', drop });
    push({ type: 'reward', xp, gold, onTime, kind, bossDmg: hit });
    return { xp, gold, stat, bossDmg: hit, drop, comp: Math.round(xp * 0.5) };
  }

  function revert(g) {
    if (!g) return;
    const st = S();
    gainXp(-g.xp);
    st.hero.gold = Math.max(0, st.hero.gold - g.gold);
    st.stats[g.stat] = Math.max(0, (st.stats[g.stat] || 0) - g.xp);
    companionGain(-(g.comp || 0));
    if (st.boss && !st.boss.defeated) st.boss.hp = Math.min(st.boss.maxHp, st.boss.hp + (g.bossDmg || 0));
    revertDrop(g.drop);
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
      const g = grant({ base: 10, diff: d.difficulty, category: d.category, onTime, streak: d.streak, kind: 'daily' });
      g.at = Date.now();
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
    const onTime = r.due ? Date.now() <= r.due + 30 * 60000 : true;
    const g = grant({ base: 12, diff: r.difficulty, category: r.category, onTime: onTime && !!r.due, kind: 'reminder' });
    st.counters.completions++;
    st.counters.remindersDone++;
    Q.store.log(r.title, 'reminder', { xp: g.xp, gold: g.gold });
    const next = r.due && r.repeat && r.repeat !== 'none' ? nextOccurrence(r) : null;
    if (next) {
      // Repeating reminders roll forward instead of piling up.
      r.due = next; r.snoozedUntil = null; r.gcalDirty = true;
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
    const red = Math.min(0.45, sl('end') * 0.03);
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
    Q.store.log(`You fainted and lost ${lost} gold. Your companion carried you back to the Inn.`, 'faint');
    push({ type: 'faint', lost });
  }

  function heal(n) {
    const h = S().hero;
    const before = h.hp;
    h.hp = Math.min(maxHp(), h.hp + n);
    return Math.round((h.hp - before) * 10) / 10;
  }

  /* ------------------------------------------------------------------ boss */
  function ensureBoss() {
    const st = S();
    const wk = U.weekKey(U.parseYmd(today()), st.settings.weekStart);
    if (st.boss && st.boss.week === wk) return st.boss;
    if (st.boss && !st.boss.defeated) Q.store.log(`${st.boss.name} slipped away at the end of the week.`, 'boss');
    let expected = 0;
    for (let i = 0; i < 7; i++) {
      const ds = U.ymd(U.addDays(U.parseYmd(wk), i));
      expected += st.dailies.filter((d) => !d.archived && isScheduled(d, ds)).length;
    }
    const pickB = Q.sprites.BOSSES[U.hash(wk) % Q.sprites.BOSSES.length];
    const maxHpB = U.clamp(Math.round(expected * 8 + 40), 80, 1200);
    st.boss = { week: wk, id: pickB.id, name: pickB.name, taunt: pickB.taunt, maxHp: maxHpB, hp: maxHpB, defeated: false };
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
      const gold = 50 + st.hero.level * 5;
      const items = ['shield', 'potion', 'charm', 'maxpotion'];
      const item = items[U.hash(b.week + 'loot') % items.length];
      st.hero.gold += gold;
      st.inventory[item] = (st.inventory[item] || 0) + 1;
      Q.store.log(`Defeated ${b.name}! +${gold} gold and a ${SHOP.items[item].name}`, 'boss');
      push({ type: 'boss', name: b.name, gold, item });
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
      d.done[day] = grant({ base: 10, diff: d.difficulty, category: d.category, streak: d.streak, kind: 'daily' });
      st.counters.completions++;
    }
    const missed = review.missed.filter((d) => !tickedIds.includes(d.id));
    const inn = st.settings.inn;
    let shieldUsed = false;
    let totalDmg = 0;
    if (missed.length && !inn) {
      const needShield = missed.some((d) => (d.streak || 0) >= 3);
      if (needShield && st.inventory.shield > 0) { st.inventory.shield--; shieldUsed = true; }
      for (const d of missed) {
        const dd = st.dailies.find((x) => x.id === d.id);
        const done = (dd.checklist || []).filter((c) => c.done).length;
        const frac = dd.checklist && dd.checklist.length && dd.checkDate === day ? 1 - done / dd.checklist.length : 1;
        totalDmg += (DIFF[dd.difficulty] || DIFF.easy).dmg * frac;
        if (!shieldUsed) dd.streak = 0;
        const b = ensureBoss();
        if (!b.defeated) b.hp = Math.min(b.maxHp, b.hp + 6);
      }
      if (totalDmg > 0) {
        const dealt = damage(totalDmg, `Missed ${missed.length} ${missed.length === 1 ? 'daily' : 'dailies'}`);
        push({ type: 'hurt', dmg: dealt, rollover: true });
      }
      if (shieldUsed) Q.store.log('A Streak Shield protected your streaks.', 'shield');
    }
    // Days the app wasn't opened: streaks break, but no damage.
    for (let x = U.addDays(U.parseYmd(day), 1); U.ymd(x) < t; x = U.addDays(x, 1)) {
      const ds = U.ymd(x);
      if (inn) break;
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
    st.day.last = t;
    st.day.dropsToday = 0; st.day.dropsDate = t;
    st.hero.hp = Math.min(maxHp(), st.hero.hp + 2); // a good night's sleep
    ensureBoss();
    afterAction();
    return { totalDmg, shieldUsed, missed: missed.length };
  }

  /* ------------------------------------------------------------------ focus */
  /** Focus rewards: 0.8 base per minute, times the Pomodoro combo multiplier. */
  function focusComplete(minutes, taskId, mult = 1, bonusItem = null) {
    const st = S();
    minutes = Math.round(minutes);
    if (minutes < 5) return null;
    const linked = taskId && (st.dailies.find((d) => d.id === taskId) || st.reminders.find((r) => r.id === taskId));
    const g = grant({ base: minutes * 0.8 * mult, diff: 'easy', category: linked ? linked.category : 'study', kind: 'focus' });
    if (bonusItem) {
      st.inventory[bonusItem] = (st.inventory[bonusItem] || 0) + 1;
      g.bonusItem = bonusItem;
    }
    st.counters.focusSessions++;
    st.counters.focusMinutes += minutes;
    const day = today();
    st.dayLog[day] = Object.assign(st.dayLog[day] || {}, { f: ((st.dayLog[day] || {}).f || 0) + minutes });
    const comboTxt = mult > 1 ? ` (combo ×${mult.toFixed(2)})` : '';
    Q.store.log(`Focused for ${minutes} min${linked ? ` on ${linked.title}` : ''}${comboTxt}`, 'focus', { xp: g.xp, gold: g.gold });
    afterAction();
    return g;
  }

  /** What a focus session of this length would pay right now (no random gold spread). */
  function focusPreview(minutes, mult = 1) {
    const base = Math.round(minutes) * 0.8 * mult;
    return {
      xp: Math.max(1, Math.round(base * bonusMult())),
      gold: Math.max(1, Math.round(base * 0.4 * (1 + sl('cha') * 0.02))),
    };
  }

  /* ------------------------------------------------------------------- shop */
  const SHOP = {
    items: {
      potion: { name: 'Potion', price: 25, desc: 'Restores 15 HP.', icon: 'potion', color: '#E879A8' },
      maxpotion: { name: 'Max Potion', price: 70, desc: 'Restores all HP.', icon: 'potion', color: '#8E6BD1' },
      shield: { name: 'Streak Shield', price: 40, desc: 'Auto-used on a missed day. Keeps every streak alive.', icon: 'shield', color: '#3C82C8' },
      charm: { name: 'Lucky Charm', price: 60, desc: '1.5× XP for the next 2 hours.', icon: 'star', color: '#F2C14E' },
      berry: { name: 'Berry', price: 10, desc: 'Feed your companion. It grows faster and loves you more.', icon: 'berry', color: '#E8604C' },
    },
    skins: {
      meadow: { mode: 'light', name: 'Meadow', price: 0, desc: 'Fresh greens and sky blue.', sw: ['#EAF4E4', '#58B368', '#3C82C8'] },
      ember: { mode: 'light', name: 'Ember Town', price: 150, desc: 'Warm brick reds and cream.', sw: ['#FBEFE6', '#E8604C', '#F2C14E'] },
      emerald: { mode: 'light', name: 'Emerald Coast', price: 150, desc: 'Teal greens with a gold trim.', sw: ['#E4F4EE', '#2FA58A', '#F2C14E'] },
      tide: { mode: 'light', name: 'Tide Route', price: 150, desc: 'Ocean blues and sea-foam.', sw: ['#E6F0FA', '#3C82C8', '#2FA58A'] },
      sakura: { mode: 'light', name: 'Blossom Lane', price: 200, desc: 'Cherry pinks with leaf green.', sw: ['#FBEFF3', '#E879A8', '#58B368'] },
      night: { mode: 'dark', name: 'Night Meadow', price: 0, desc: 'Meadow after sunset: mossy greens.', sw: ['#1C2724', '#6CCB7F', '#74B9F0'] },
      dusk: { mode: 'dark', name: 'Dusk Village', price: 200, desc: 'Twilight purples with lantern gold.', sw: ['#232B44', '#A68BE8', '#F2C14E'] },
      lava: { mode: 'dark', name: 'Lava Cave', price: 200, desc: 'Warm embers glowing in the dark.', sw: ['#271D1C', '#F2826A', '#F2C14E'] },
      deepsea: { mode: 'dark', name: 'Deep Sea', price: 200, desc: 'Midnight navy with bioluminescent teal.', sw: ['#15212E', '#5DB8EC', '#52D3B3'] },
      moonblossom: { mode: 'dark', name: 'Moonlit Blossom', price: 250, desc: 'Plum night with cherry-pink glow.', sw: ['#261E2C', '#F293BC', '#8ED69C'] },
    },
    scenes: {
      meadow: { name: 'Sunny Meadow', price: 0 },
      rain: { name: 'Rainy Route', price: 0 },
      night: { name: 'Firefly Camp', price: 150 },
      sea: { name: 'Seaside Dock', price: 150 },
      snow: { name: 'Snowy Pass', price: 150 },
    },
    outfits: {
      classic: { price: 0, lvl: 1 }, meadow: { price: 80, lvl: 1 }, tide: { price: 80, lvl: 3 },
      sunset: { price: 120, lvl: 5 }, sakura: { price: 120, lvl: 8 }, royal: { price: 300, lvl: 20 },
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
    else if (key === 'berry') {
      const c = st.companion;
      c.friendship = Math.min(100, (c.friendship || 0) + 8);
      c.lastFed = Date.now();
      companionGain(25);
      msg = `${c.name} loved it!`;
    } else return { ok: false, msg: 'Shields are used automatically.' };
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
  const ACH = [
    { id: 'first', name: 'First Steps', desc: 'Complete your first task.', test: (s) => s.counters.completions >= 1 },
    { id: 'sprout', name: 'Sprout Badge', badge: '#58B368', desc: 'Complete 10 tasks.', test: (s) => s.counters.completions >= 10 },
    { id: 'dawn', name: 'Dawn Badge', badge: '#F29A4E', desc: 'Reach a 7-day streak on any daily.', test: (s) => s.counters.maxStreak >= 7 },
    { id: 'tide', name: 'Tide Badge', badge: '#3C82C8', desc: 'Have 5 perfect days.', test: (s) => s.counters.perfectDays >= 5 },
    { id: 'lantern', name: 'Lantern Badge', badge: '#F2C14E', desc: 'Finish 10 focus sessions.', test: (s) => s.counters.focusSessions >= 10 },
    { id: 'stone', name: 'Stone Badge', badge: '#7D8597', desc: 'Defeat a weekly boss.', test: (s) => s.counters.bossesDefeated >= 1 },
    { id: 'ember', name: 'Ember Badge', badge: '#E8604C', desc: 'Reach a 30-day streak.', test: (s) => s.counters.maxStreak >= 30 },
    { id: 'gale', name: 'Gale Badge', badge: '#2FA58A', desc: 'Complete 50 reminders.', test: (s) => s.counters.remindersDone >= 50 },
    { id: 'crown', name: 'Crown Badge', badge: '#8E6BD1', desc: 'Reach level 25.', test: (s) => s.hero.level >= 25 },
    { id: 'early', name: 'Early Bird', desc: 'Finish 5 timed dailies on time before 8 AM.', test: (s) => s.counters.earlyBird >= 5 },
    { id: 'deep', name: 'Deep Diver', desc: 'Focus for 10 hours in total.', test: (s) => s.counters.focusMinutes >= 600 },
    { id: 'grown', name: 'All Grown Up', desc: 'Help your companion reach its Teen form.', test: () => companionStage() >= 2 },
    { id: 'hoard', name: 'Treasure Keeper', desc: 'Hold 500 gold at once.', test: (s) => s.hero.gold >= 500 },
    { id: 'treat', name: 'Earned It', desc: 'Buy one of your own rewards.', test: (s) => (s.counters.rewardsBought || 0) >= 1 },
    { id: 'century', name: 'Centurion', desc: 'Complete 100 tasks.', test: (s) => s.counters.completions >= 100 },
    { id: 'phoenix', name: 'Back on Your Feet', desc: 'Faint once, and keep going.', test: (s) => s.counters.faints >= 1 },
  ];

  function checkAchievements() {
    const st = S();
    for (const a of ACH) {
      if (!st.achievements[a.id] && a.test(st)) {
        st.achievements[a.id] = Date.now();
        Q.store.log(`Unlocked: ${a.name}`, 'badge');
        push({ type: 'badge', ach: a });
      }
    }
  }

  function afterAction() {
    checkAchievements();
    Q.store.commit('game');
  }

  /* ------------------------------------------------------------- companion */
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
    const c = st.companion;
    const list = todaysDailies();
    const left = list.filter((d) => !isDone(d));
    const next = left.filter((d) => d.time).sort((a, b) => a.time.localeCompare(b.time))[0];
    const mood = companionMood();
    const n = c.name;
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
    if (st.settings.inn) line = `${n} is relaxing at the Inn with you. Dailies can't hurt you while you rest.`;
    return { line, mood };
  }

  return {
    DIFF, STATS, SHOP, ACH, STAGE_NAMES,
    xpToNext, statLevel, maxHp, title, today, isScheduled, scheduleLabel, dueAt, isDone, todaysDailies,
    toggleDaily, toggleCheckItem, checklistState, habit, completeReminder, reopenReminder, nextOccurrence,
    checkRollover, finalizeDay, focusComplete, focusPreview, buy, useItem, buyReward, ensureBoss, heal,
    companionLevel, companionStage, companionMood, companionLine, checkAchievements,
    flush: () => pending.splice(0, pending.length),
  };
})();
