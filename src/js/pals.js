'use strict';
/*
 * Pals: collection, team of 3, shared EXP, evolution, abilities, synergy,
 * type advantage against the weekly boss, team presets and the Capsule Machine.
 *
 * Save shape (state.pals):
 *   owned:   { [lineId]: { exp, nick, got, seen } }   seen = highest stage already celebrated
 *   team:    [lineId|null, lineId|null, lineId|null]
 *   presets: [{ name, team: [ids] }] (3 slots)
 *   pulls, evolutions
 */

Q.pals = (() => {
  const D = Q.PALS;
  const S = () => Q.store.state;
  const TEAM_SIZE = 3;
  const MAX_LEVEL = 50;

  const line = (id) => D.byId[id];
  const owned = () => S().pals.owned;
  const isOwned = (id) => !!owned()[id];
  const ownedIds = () => D.LINES.filter((l) => isOwned(l.id)).map((l) => l.id);
  const count = () => ownedIds().length;

  /* ------------------------------------------------------------ levels */
  const expMult = (id) => D.RARITY[line(id).r].exp;
  const expForLevel = (id, lvl) => Math.round(12 * (lvl - 1) ** 2 * expMult(id));
  function level(id, exp = owned()[id]?.exp || 0) {
    return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(exp / (12 * expMult(id)))) + 1);
  }
  const evoLevels = (id) => D.EVO[line(id).names.length];
  function stageAt(id, lvl) { const ev = evoLevels(id); let s = 1; ev.forEach((l, i) => { if (lvl >= l) s = i + 1; }); return s; }
  const stage = (id, exp) => stageAt(id, level(id, exp));
  const maxStage = (id) => line(id).names.length;
  const nextEvoLevel = (id) => { const st = stage(id); const ev = evoLevels(id); return st < ev.length ? ev[st] : null; };
  const speciesName = (id, st = stage(id)) => line(id).names[st - 1];
  const name = (id) => owned()[id]?.nick || speciesName(id);
  /** Progress inside the current level, 0..1. */
  function levelProgress(id) {
    const exp = owned()[id]?.exp || 0; const l = level(id, exp);
    if (l >= MAX_LEVEL) return { frac: 1, cur: exp, need: 0 };
    const a = expForLevel(id, l); const b = expForLevel(id, l + 1);
    return { frac: (exp - a) / (b - a), cur: Math.floor(exp - a), need: b - a };
  }

  /* ---------------------------------------------------------- abilities */
  function abilityValue(id, st = stage(id)) {
    const l = line(id); const n = l.names.length;
    const v = D.FX[l.fx].v * D.RARITY[l.r].mult * (0.4 + 0.6 * (n > 1 ? (st - 1) / (n - 1) : 1));
    return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  }
  const abilityText = (id, st) => D.FX[line(id).fx].fmt(abilityValue(id, st));

  /* --------------------------------------------------------------- team */
  const team = () => S().pals.team.filter((id) => id && isOwned(id));
  const inTeam = (id) => S().pals.team.includes(id);
  const lead = () => team()[0] || ownedIds()[0] || 'sprigg';

  function synergy() {
    const t = team();
    if (t.length < TEAM_SIZE) return null;
    const types = t.map((id) => line(id).type);
    if (types.every((x) => x === types[0])) return { kind: 'mono', name: `${D.TYPES[types[0]].name} bond`, text: '+15% pal EXP', palExpPct: 15, goldPct: 0 };
    if (new Set(types).size === TEAM_SIZE) return { kind: 'rainbow', name: 'Rainbow band', text: '+6% gold', palExpPct: 0, goldPct: 6 };
    return null;
  }

  const bossType = (b) => b && (b.type || (D.BOSSES.find((x) => x.id === b.id) || {}).type);
  const strongVs = (type) => Object.keys(D.TYPES).filter((t) => D.TYPES[t].strong.includes(type));
  /** Team pals with the type edge on this boss: +15% boss damage each. */
  function advantage(b = S().boss) {
    const bt = bossType(b);
    if (!bt) return { pals: [], pct: 0, type: null };
    const pals = team().filter((id) => D.TYPES[line(id).type].strong.includes(bt));
    return { pals, pct: pals.length * 15, type: bt };
  }

  /** Sum of every active effect: team abilities + synergy + Shop upgrades. */
  function fx() {
    const out = Object.fromEntries(Object.keys(D.FX).map((k) => [k, 0]));
    for (const id of team()) out[line(id).fx] += abilityValue(id);
    const syn = synergy();
    if (syn) { out.palExpPct += syn.palExpPct; out.goldPct += syn.goldPct; }
    // Permanent upgrades from the Shop stack on top.
    const ups = (Q.game && Q.game.SHOP && Q.game.SHOP.upgrades) || {};
    for (const [uid, u] of Object.entries(ups)) if (u.fx) out[u.fx] += u.per * (((S().upgrades || {})[uid]) || 0);
    out.dmgRed = Math.min(40, out.dmgRed);
    out.gachaDiscount = Math.min(30, out.gachaDiscount);
    out.critChance = Math.min(40, out.critChance);
    out.shieldSave = Math.min(60, out.shieldSave);
    out.streakGuard = Math.min(50, out.streakGuard);
    return out;
  }

  /* ---------------------------------------------------------------- EXP */
  /** Give every team pal the same EXP. Returns an undo record. */
  function gain(amount) {
    const st = S();
    const ids = team();
    amount = Math.max(0, Math.round(amount));
    if (!amount || !ids.length) return null;
    for (const id of ids) {
      const p = st.pals.owned[id];
      const before = stage(id, p.exp);
      p.exp += amount;
      const after = stage(id, p.exp);
      if (after > before && after > (p.seen || 1)) {
        for (let s = Math.max(before, p.seen || 1) + 1; s <= after; s++) {
          st.pals.evolutions = (st.pals.evolutions || 0) + 1;
          Q.store.log(`${p.nick || speciesName(id, s - 1)} evolved into ${speciesName(id, s)}!`, 'evolve');
          Q.game.emit({ type: 'palEvolve', id, from: s - 1, to: s });
        }
        p.seen = after;
      }
    }
    return { ids, amt: amount };
  }
  function revertGain(rec) {
    if (!rec) return;
    for (const id of rec.ids) { const p = owned()[id]; if (p) p.exp = Math.max(0, p.exp - rec.amt); }
  }

  /* ------------------------------------------------------- team editing */
  function addToTeam(id, slot = null) {
    const t = S().pals.team;
    if (!isOwned(id)) return false;
    const cur = t.indexOf(id);
    if (slot === null) slot = cur >= 0 ? cur : t.findIndex((x) => !x || !isOwned(x));
    if (slot < 0) return false;
    if (cur >= 0 && cur !== slot) t[cur] = t[slot] || null;
    t[slot] = id;
    Q.store.commit('pals');
    return true;
  }
  function removeFromTeam(id) {
    const t = S().pals.team;
    const i = t.indexOf(id);
    if (i < 0) return;
    if (team().length <= 1) return 'last';
    t[i] = null;
    // keep the lead slot filled: close gaps from the left
    const rest = t.filter((x) => x && isOwned(x));
    S().pals.team = [0, 1, 2].map((k) => rest[k] || null);
    Q.store.commit('pals');
    return true;
  }
  function makeLead(id) {
    const t = S().pals.team; const i = t.indexOf(id);
    if (i > 0) { [t[0], t[i]] = [t[i], t[0]]; Q.store.commit('pals'); }
  }
  function rename(id, nick) { const p = owned()[id]; if (p) { p.nick = nick.trim().slice(0, 16); Q.store.commit('pals'); } }

  /* ------------------------------------------------------------ presets */
  function savePreset(i, presetName) {
    const pr = S().pals.presets;
    pr[i] = { name: (presetName || pr[i]?.name || `Team ${i + 1}`).slice(0, 18), team: S().pals.team.slice() };
    Q.store.commit('pals');
  }
  function loadPreset(i) {
    const p = S().pals.presets[i];
    if (!p || !p.team) return false;
    const t = p.team.filter((id) => id && isOwned(id));
    if (!t.length) return false;
    S().pals.team = [0, 1, 2].map((k) => t[k] || null);
    Q.store.commit('pals');
    return true;
  }

  /* ---------------------------------------------------- capsule machine */
  const pool = () => D.LINES.filter((l) => !isOwned(l.id));
  function pullCost() {
    const base = 80 + 8 * Math.max(0, count() - 1);
    const disc = fx().gachaDiscount / 100;
    return Math.round((base * (1 - disc)) / 5) * 5;
  }
  /** Rarity odds among what is left, in %. */
  function odds() {
    const left = pool();
    const w = {};
    for (const r of Object.keys(D.RARITY)) { const n = left.filter((l) => l.r === r).length; w[r] = n ? D.RARITY[r].weight : 0; }
    const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(Object.keys(w).map((r) => [r, { pct: Math.round((w[r] / tot) * 1000) / 10, left: left.filter((l) => l.r === r).length }]));
  }
  function pull(useTicket) {
    const st = S();
    const left = pool();
    if (!left.length) return { ok: false, msg: 'You have every pal!' };
    if (useTicket) {
      if (!(st.inventory.ticket > 0)) return { ok: false, msg: 'No Capsule Tickets left' };
      st.inventory.ticket--;
    } else {
      const cost = pullCost();
      if (st.hero.gold < cost) return { ok: false, msg: `You need ${cost - st.hero.gold} more gold` };
      st.hero.gold -= cost;
    }
    const o = odds();
    let roll = Math.random() * 100; let rar = 'C';
    for (const r of ['L', 'E', 'R', 'C']) { if (roll < o[r].pct) { rar = r; break; } roll -= o[r].pct; }
    let choices = left.filter((l) => l.r === rar);
    if (!choices.length) choices = left;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    give(pick.id);
    st.pals.pulls = (st.pals.pulls || 0) + 1;
    const joined = team().length < TEAM_SIZE && addToTeam(pick.id);
    Q.store.log(`The Capsule Machine gave you ${pick.names[0]} (${D.RARITY[pick.r].name} ${D.TYPES[pick.type].name})!`, 'pal');
    Q.game.checkAchievements();
    Q.store.commit('pals');
    return { ok: true, id: pick.id, joined };
  }
  function give(id, exp = 0, nick = '') {
    const o = owned();
    if (!o[id]) o[id] = { exp, nick, got: Date.now(), seen: stageAt(id, level(id, exp)) };
  }

  /* -------------------------------------------------------------- stats */
  const countBy = (pred) => ownedIds().filter((id) => pred(line(id))).length;
  const finals = () => ownedIds().filter((id) => stage(id) === maxStage(id)).length;
  const typesOwned = () => new Set(ownedIds().map((id) => line(id).type)).size;
  const sameTypeTeam = () => synergy()?.kind === 'mono';

  /* ------------------------------------------------------------ sprites */
  const urlCache = new Map();
  function url(id, st, sil = false) {
    const key = `${id}|${st}|${sil ? 1 : 0}`;
    if (urlCache.has(key)) return urlCache.get(key);
    const spec = line(id) || D.BOSSES.find((b) => b.id === id);
    if (!spec) return '';
    const { px, pal, size } = Q.PalArt.paint(spec, st);
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d');
    for (let i = 0; i < px.length; i++) {
      const k = px[i]; if (!k) continue;
      if (sil && k === 'S') continue;
      g.fillStyle = sil ? '#000' : pal[k];
      g.fillRect(i % size, (i / size) | 0, 1, 1);
    }
    let out = '';
    try { out = c.toDataURL('image/png'); } catch (e) { out = ''; }
    urlCache.set(key, out);
    return out;
  }
  /** <img> for a pal. Unowned pals show as a silhouette unless `reveal`. */
  function sprite(id, size = 64, { st = null, cls = '', reveal = false } = {}) {
    const sil = !reveal && !isOwned(id);
    const s = st || (isOwned(id) ? stage(id) : 1);
    return `<img class="px pal-img ${sil ? 'pal-sil' : ''} ${cls}" src="${url(id, s, sil)}" width="${size}" height="${size}" alt="${sil ? 'Unknown pal' : Q.util.esc(speciesName(id, s))}" draggable="false">`;
  }

  return {
    TEAM_SIZE, MAX_LEVEL, line, isOwned, ownedIds, count, level, stage, maxStage, stageAt, evoLevels, nextEvoLevel, expForLevel,
    speciesName, name, levelProgress, abilityValue, abilityText, team, inTeam, lead, synergy, advantage, bossType, strongVs, fx,
    gain, revertGain, addToTeam, removeFromTeam, makeLead, rename, savePreset, loadPreset, pullCost, odds, pull, give, pool,
    countBy, finals, typesOwned, sameTypeTeam, url, sprite,
  };
})();
