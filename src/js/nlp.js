'use strict';
/*
 * Quick-add parser. Examples:
 *   book tickets for the show fri 10am          -> reminder, Fri 10:00
 *   pay electricity bill tomorrow 6pm !h #errands
 *   water plants every mon wed fri 8:30am       -> daily, those days
 *   stretch every day at 7                      -> daily, 07:00
 *   event: project review thu 2-3pm             -> calendar event
 *   call the bank in 2 hours
 *   renew bus pass 12/11 (DD/MM) · nov 12 · 2026-11-12
 */

Q.nlp = (() => {
  const U = Q.util;
  const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?';
  const dayIdx = (s) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(s.slice(0, 3).toLowerCase());
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

  function to24(h, m, ap) {
    h = Number(h); m = Number(m || 0);
    if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
    if (h > 23 || m > 59) return null;
    return `${U.pad(h)}:${U.pad(m)}`;
  }

  function parse(input, now = new Date()) {
    let s = ` ${input.trim()} `;
    const out = { type: null, title: '', date: null, time: null, endTime: null, schedule: null, repeat: 'none', difficulty: null, category: null, budget: null, explicitType: false };
    const take = (re, fn) => { const m = s.match(re); if (m) { s = s.replace(m[0], ' '); fn(m); return true; } return false; };

    // type markers
    take(/^\s*(event|e|ev)\s*:\s*/i, () => { out.type = 'event'; out.explicitType = true; });
    take(/^\s*(daily|d|chore)\s*:\s*/i, () => { out.type = 'daily'; out.explicitType = true; });
    take(/^\s*(remind|reminder|r|todo|task)\s*:\s*/i, () => { out.type = 'reminder'; out.explicitType = true; });

    // difficulty
    take(/\s!(t|trivial|e|easy|m|med|medium|h|hard)\b/i, (m) => {
      const k = m[1].toLowerCase()[0];
      out.difficulty = { t: 'trivial', e: 'easy', m: 'medium', h: 'hard' }[k];
    });
    // category
    take(/\s#([a-z-]+)/i, (m) => {
      const q = m[1].toLowerCase().replace('-', '');
      const cats = Q.store.CATEGORIES;
      out.category = Object.keys(cats).find((k) => k.startsWith(q) || cats[k].name.toLowerCase().replace('-', '').startsWith(q)) || null;
    });

    // time budget: "for 2 hours", "for 90 min", "for 1.5h", "for an hour", "for half an hour"
    take(/\sfor\s+(\d+(?:\.\d+)?|an?|one|half\s+an?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i, (m) => {
      const n = /^half/i.test(m[1]) ? 0.5 : /^(a|an|one)$/i.test(m[1]) ? 1 : Number(m[1]);
      const mins = Math.round(m[2][0].toLowerCase() === 'h' ? n * 60 : n);
      if (mins > 0 && mins <= 720) out.budget = mins;
    });

    // recurring (dailies)
    take(new RegExp(`\\severy\\s+((?:${DAY_RE}\\b(?:\\s*,\\s*|\\s+and\\s+|\\s+)?)+)`, 'i'), (m) => {
      const days = [...m[1].matchAll(new RegExp(DAY_RE, 'gi'))].map((x) => dayIdx(x[1]));
      out.schedule = { type: 'weekly', days: [...new Set(days)].sort() };
    }) ||
    take(/\s(every\s+weekday|on\s+weekdays|weekdays)\b/i, () => { out.schedule = { type: 'weekly', days: [1, 2, 3, 4, 5] }; }) ||
    take(/\s(every\s+weekend|on\s+weekends|weekends)\b/i, () => { out.schedule = { type: 'weekly', days: [0, 6] }; }) ||
    take(/\severy\s+other\s+day\b/i, () => { out.schedule = { type: 'interval', every: 2 }; }) ||
    take(/\severy\s+(\d+)\s+days?\b/i, (m) => { out.schedule = { type: 'interval', every: Math.max(1, Number(m[1])) }; }) ||
    take(/\s(every\s+day|everyday|daily|each\s+day)\b/i, () => { out.schedule = { type: 'daily' }; }) ||
    take(/\severy\s+(week|month|year)\b/i, (m) => { out.repeat = { week: 'weekly', month: 'monthly', year: 'yearly' }[m[1].toLowerCase()]; }) ||
    take(/\s(weekly|monthly|yearly)\b/i, (m) => { out.repeat = m[1].toLowerCase(); });

    // time range (events): 2-3pm, 14:00-15:30, 10am to 11:30am
    take(/\s(?:from\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i, (m) => {
      const ap2 = m[6]; const ap1 = m[3] || ap2;
      out.time = to24(m[1], m[2], ap1);
      out.endTime = to24(m[4], m[5], ap2);
      if (out.time && out.endTime && out.endTime <= out.time && !m[3] && ap2 === 'pm') {
        // "11-1pm": first half is AM
        out.time = to24(m[1], m[2], 'am');
      }
      if (!out.type) out.type = 'event';
    });

    // relative: in 2 hours / in 30 min / in 3 days
    take(/\sin\s+(\d+|an?|one|half\s+an?)\s*(min|mins|minutes?|m|h|hrs?|hours?|days?|weeks?)\b/i, (m) => {
      let n = m[1].toLowerCase();
      n = /^half/.test(n) ? 0.5 : /^(a|an|one)$/.test(n) ? 1 : Number(n);
      const u = m[2].toLowerCase()[0];
      const ms = u === 'm' ? n * 60000 : u === 'h' ? n * 3600000 : u === 'd' ? n * 86400000 : n * 604800000;
      const d = new Date(now.getTime() + ms);
      out.date = U.startOfDay(d);
      if (u === 'm' || u === 'h') out.time = `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
    });

    // clock times
    take(/\s(?:at\s+|@\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i, (m) => { out.time = out.time || to24(m[1], m[2], m[3]); }) ||
    take(/\s(?:at\s+|@\s*)?(\d{1,2})[:.](\d{2})\b/i, (m) => { out.time = out.time || to24(m[1], m[2]); }) ||
    take(/\s(?:at|@)\s*(\d{1,2})\b(?!\s*\/)/i, (m) => {
      let h = Number(m[1]);
      if (h >= 1 && h <= 6) h += 12; // "at 5" almost always means 5 pm
      out.time = out.time || to24(h, 0);
    });
    take(/\s(at\s+)?noon\b/i, () => { out.time = '12:00'; }) ||
    take(/\s(at\s+)?midnight\b/i, () => { out.time = '23:59'; });
    take(/\s(this\s+)?(morning)\b/i, () => { out.time = out.time || '09:00'; }) ||
    take(/\s(this\s+)?(afternoon)\b/i, () => { out.time = out.time || '14:00'; }) ||
    take(/\s(this\s+)?(evening)\b/i, () => { out.time = out.time || '18:00'; });

    // dates
    const base = U.startOfDay(now);
    take(/\s(day\s+after\s+tomorrow)\b/i, () => { out.date = U.addDays(base, 2); }) ||
    take(/\s(tomorrow|tmrw|tmr|tom)\b/i, () => { out.date = U.addDays(base, 1); }) ||
    take(/\s(tonight)\b/i, () => { out.date = base; out.time = out.time || '20:00'; }) ||
    take(/\s(today)\b/i, () => { out.date = base; }) ||
    take(new RegExp(`\\s(next\\s+)?(?:on\\s+)?${DAY_RE}\\b`, 'i'), (m) => {
      const target = dayIdx(m[2]);
      let diff = (target - base.getDay() + 7) % 7;
      if (m[1]) diff = diff === 0 ? 7 : diff + 7 * (diff < 7 && diff > 0 ? 1 : 0);
      out.date = U.addDays(base, diff);
    }) ||
    take(/\s(\d{4})-(\d{2})-(\d{2})\b/, (m) => { out.date = new Date(+m[1], +m[2] - 1, +m[3]); }) ||
    take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON_RE}\\b`, 'i'), (m) => { out.date = futureDate(+m[1], MON.indexOf(m[2].slice(0, 3).toLowerCase()), base); }) ||
    take(new RegExp(`\\s(?:on\\s+)?${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m) => { out.date = futureDate(+m[2], MON.indexOf(m[1].slice(0, 3).toLowerCase()), base); }) ||
    take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
      out.date = y ? new Date(y, +m[2] - 1, +m[1]) : futureDate(+m[1], +m[2] - 1, base);
    });

    // type inference
    if (!out.type) out.type = out.schedule ? 'daily' : 'reminder';
    if (out.type === 'daily' && !out.schedule) out.schedule = { type: 'daily' };
    if (out.time && !out.date && out.type !== 'daily') {
      const t = U.at(U.ymd(base), out.time);
      out.date = t > now ? base : U.addDays(base, 1);
    }
    if (out.type === 'event' && !out.date) out.date = base;

    out.title = s.replace(/\s+(on|at|by|for|from)\s*$/i, ' ').replace(/^\s*(to|remind me to)\s+/i, '').replace(/\s+/g, ' ').trim();
    if (out.title) out.title = out.title[0].toUpperCase() + out.title.slice(1);
    return out;
  }

  function futureDate(day, month, base) {
    let d = new Date(base.getFullYear(), month, day);
    if (d < base) d = new Date(base.getFullYear() + 1, month, day);
    return d;
  }

  /** Human summary chips for the preview line under the input. */
  function describe(p) {
    const chips = [];
    const typeName = { reminder: 'Reminder', daily: 'Daily', event: 'Event' }[p.type];
    chips.push({ k: 'type', v: typeName });
    if (p.schedule) chips.push({ k: 'repeat', v: Q.game.scheduleLabel({ schedule: p.schedule }) });
    if (p.date && p.type !== 'daily') chips.push({ k: 'date', v: U.fmtDay(p.date) });
    if (p.time) chips.push({ k: 'time', v: U.fmtTime(p.time) + (p.endTime ? ` – ${U.fmtTime(p.endTime)}` : '') });
    else if (p.date && p.type === 'reminder') chips.push({ k: 'time', v: 'Any time' });
    if (p.budget && p.type !== 'event') chips.push({ k: 'budget', v: `${U.fmtDuration(p.budget)} goal` });
    if (p.repeat && p.repeat !== 'none') chips.push({ k: 'repeat', v: p.repeat[0].toUpperCase() + p.repeat.slice(1) });
    if (p.difficulty) chips.push({ k: 'diff', v: Q.game.DIFF[p.difficulty].label });
    if (p.category) chips.push({ k: 'cat', v: Q.store.CATEGORIES[p.category].name });
    return chips;
  }

  return { parse, describe };
})();
