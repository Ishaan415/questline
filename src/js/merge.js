'use strict';
/*
 * Three-way merge of two saves that both changed since they last agreed
 * ("base"). Used by Drive sync so a phone and a PC can both be used offline.
 *
 *   - Lists of things with ids (dailies, reminders, events, habits, rewards)
 *     merge item by item. A new item on either side is kept; a deletion wins
 *     only if the other side didn't edit that item.
 *   - Running totals (gold, XP, HP, stats, counters, items, pal EXP) add up:
 *     result = remote + (local - base). Gold earned on both devices is kept.
 *   - "Done on this day" maps, achievements, owned cosmetics and pals are
 *     unions: nothing earned on either side is lost.
 *   - Anything else: whichever side changed it wins; if both changed the same
 *     value, the side edited most recently wins.
 *
 * Pure functions, no DOM: also runs under Node for tests.
 */

(function (root) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  /** JSON with sorted keys, so key order never counts as a change. */
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    return v === undefined ? 'null' : JSON.stringify(v);
  }
  const eq = (a, b) => canon(a) === canon(b);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  /** Running total: keep both sides' changes. */
  function delta(b, l, r) {
    if (typeof l !== 'number' && typeof r !== 'number') return generic(b, l, r, [], {});
    if (typeof b !== 'number') return Math.max(num(l), num(r)); // new on both sides: don't double it
    return Math.round((num(r) + (num(l) - num(b))) * 1000) / 1000;
  }
  const max = (b, l, r) => {
    if (l === undefined) return clone(r);
    if (r === undefined) return clone(l);
    return typeof l === 'number' || typeof r === 'number' ? Math.max(num(l), num(r)) : (String(l) > String(r) ? l : r);
  };
  /** Map of key -> value where both sides' keys are kept. */
  function unionMap(b, l, r, path, ctx, inner) {
    const out = {};
    const keys = new Set([...Object.keys(l || {}), ...Object.keys(r || {})]);
    for (const k of keys) {
      const inL = l && k in l; const inR = r && k in r;
      if (inL && inR) out[k] = inner ? inner((b || {})[k], l[k], r[k], path.concat(k), ctx) : merge((b || {})[k], l[k], r[k], path.concat(k), ctx);
      else out[k] = clone(inL ? l[k] : r[k]);
    }
    return out;
  }
  const unionList = (b, l, r) => {
    const out = [...(r || [])];
    for (const x of l || []) if (!out.some((y) => eq(x, y))) out.push(clone(x));
    return out;
  };

  /** Arrays of objects with an `id`, merged item by item. */
  function byId(b, l, r, path, ctx) {
    const map = (a) => new Map((a || []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
    const B = map(b); const L = map(l); const R = map(r);
    const out = [];
    const decide = (id) => {
      const inB = B.has(id); const inL = L.has(id); const inR = R.has(id);
      if (inL && inR) return merge(B.get(id), L.get(id), R.get(id), path.concat('*'), ctx);
      if (inL) return !inB ? clone(L.get(id)) : eq(L.get(id), B.get(id)) ? null : clone(L.get(id)); // deleted remotely unless edited here
      if (inR) return !inB ? clone(R.get(id)) : eq(R.get(id), B.get(id)) ? null : clone(R.get(id));
      return null;
    };
    const seen = new Set();
    for (const id of [...R.keys(), ...L.keys()]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const v = decide(id);
      if (v) out.push(v);
    }
    return out;
  }

  function boss(b, l, r, path, ctx) {
    if (!l || !r) return clone(l || r);
    if (l.week !== r.week) return clone(l.week > r.week ? l : r);
    const out = generic(b && b.week === l.week ? b : null, l, r, path, ctx);
    if (b && b.week === l.week) out.hp = delta(b.hp, l.hp, r.hp);
    out.defeated = !!(l.defeated || r.defeated);
    out.hp = out.defeated ? 0 : Math.max(0, Math.min(num(out.maxHp) || num(l.maxHp), num(out.hp)));
    return out;
  }

  function log(b, l, r) {
    const key = (e) => `${e.t}|${e.text}`;
    const seen = new Set(); const out = [];
    for (const e of [...(l || []), ...(r || [])]) { const k = key(e); if (!seen.has(k)) { seen.add(k); out.push(clone(e)); } }
    return out.sort((a, c) => c.t - a.t).slice(0, 150);
  }

  /* Path rules. '*' matches one id or key. First match wins. */
  const RULES = [
    ['dailies', byId], ['habits', byId], ['reminders', byId], ['events', byId], ['rewards', byId],
    ['dailies.*.done', (b, l, r, p, c) => unionMap(b, l, r, p, c, (bb, ll, rr) => clone(bb !== undefined && eq(ll, bb) ? rr : ll))],
    ['dailies.*.streak', max], ['dailies.*.best', max],
    ['hero.gold', delta], ['hero.hp', delta], ['hero.totalXp', delta],
    ['stats.*', delta], ['counters.*', delta], ['inventory.*', delta],
    ['achievements', (b, l, r, p, c) => unionMap(b, l, r, p, c, (bb, ll, rr) => Math.min(num(ll) || num(rr), num(rr) || num(ll)))],
    ['owned.*', unionList],
    ['dayLog', (b, l, r, p, c) => unionMap(b, l, r, p, c, (bb, ll, rr) => unionMap(bb, ll, rr, p, c, max))],
    ['pals.owned', (b, l, r, p, c) => unionMap(b, l, r, p, c)],
    ['pals.owned.*.exp', delta], ['pals.owned.*.seen', max], ['pals.pulls', delta], ['pals.evolutions', delta],
    ['buffs.charmUntil', max], ['buffs.perfectDay', max], ['day.last', max],
    ['boss', boss], ['log', log],
    ['_meta', (b, l, r) => ({ editedAt: Math.max(num(l && l.editedAt), num(r && r.editedAt)), device: (num(l && l.editedAt) >= num(r && r.editedAt) ? l : r || {}).device || '' })],
  ];
  function rule(path) {
    for (const [pat, fn] of RULES) {
      const ps = pat.split('.');
      if (ps.length === path.length && ps.every((x, i) => x === '*' || x === String(path[i]))) return fn;
    }
    return null;
  }

  /** True when some rule applies further down this path (e.g. 'hero' has 'hero.gold'). */
  function rulesBelow(path) {
    return RULES.some(([pat]) => {
      const ps = pat.split('.');
      return ps.length > path.length && path.every((x, i) => ps[i] === '*' || ps[i] === String(x));
    });
  }

  /** Default: one-sided changes win; both-sided object changes merge key by key. */
  function generic(b, l, r, path, ctx) {
    // Objects holding running totals must be walked even when both sides look
    // the same: +1 on each device is still +2 in total.
    const walk = isObj(l) && isObj(r) && rulesBelow(path);
    if (!walk) {
      if (eq(l, r)) return clone(l);
      if (b !== undefined && eq(l, b)) return clone(r);
      if (b !== undefined && eq(r, b)) return clone(l);
    }
    if (isObj(l) && isObj(r)) {
      const out = {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
        const inL = k in l; const inR = k in r;
        const bk = isObj(b) ? b[k] : undefined;
        if (inL && inR) out[k] = merge(bk, l[k], r[k], path.concat(k), ctx);
        else if (inL) { if (!(isObj(b) && k in b && eq(l[k], bk))) out[k] = clone(l[k]); }
        else if (!(isObj(b) && k in b && eq(r[k], bk))) out[k] = clone(r[k]);
      }
      return out;
    }
    return clone(ctx.localWins ? l : r);
  }

  function merge(b, l, r, path, ctx) {
    if (l === undefined) return clone(r);
    if (r === undefined) return clone(l);
    const fn = rule(path);
    return fn ? fn(b, l, r, path, ctx) : generic(b, l, r, path, ctx);
  }

  /**
   * merge3(base, local, remote) -> merged save.
   * opts.xpToNext(level) lets hero level/XP be rebuilt from the merged total XP.
   * opts.maxHp caps HP after adding both sides' changes.
   */
  function merge3(base, local, remote, opts = {}) {
    const lt = num(local && local._meta && local._meta.editedAt);
    const rt = num(remote && remote._meta && remote._meta.editedAt);
    const ctx = { localWins: lt >= rt };
    const out = merge(base || undefined, local, remote, [], ctx);
    // Level and in-level XP: start from this device's level and add the XP the
    // other device earned, levelling up (or down, after an undo) as the game does.
    if (out.hero && local.hero && remote.hero && !eq(out.hero.totalXp, local.hero.totalXp) && !eq(out.hero.totalXp, remote.hero.totalXp) && opts.xpToNext) {
      let lvl = Math.max(1, num(local.hero.level)); let xp = num(local.hero.xp) + (num(out.hero.totalXp) - num(local.hero.totalXp));
      while (xp >= opts.xpToNext(lvl) && lvl < 999) { xp -= opts.xpToNext(lvl); lvl++; }
      while (xp < 0 && lvl > 1) { lvl--; xp += opts.xpToNext(lvl); }
      out.hero.level = lvl; out.hero.xp = Math.max(0, xp);
    } else if (out.hero && local.hero && remote.hero) {
      const src = eq(out.hero.totalXp, local.hero.totalXp) ? local.hero : remote.hero;
      out.hero.level = src.level; out.hero.xp = src.xp;
    }
    if (out.hero) {
      out.hero.gold = Math.max(0, Math.round(num(out.hero.gold)));
      const cap = opts.maxHp ? opts.maxHp(out) : 999;
      out.hero.hp = Math.max(1, Math.min(cap, num(out.hero.hp)));
    }
    for (const k of Object.keys(out.inventory || {})) out.inventory[k] = Math.max(0, out.inventory[k]);
    return out;
  }

  root.merge = { merge3, eq, canon, clone };
})(typeof window !== 'undefined' ? (window.Q = window.Q || {}) : module.exports);
