'use strict';
/* Shared helpers: dates, formatting, ids, escaping. Everything lives on window.Q. */
window.Q = window.Q || {};

Q.util = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sameDay = (a, b) => ymd(a) === ymd(b);
  const diffDays = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
  const hmToMin = (s) => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const minToHm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /** The "game day": a 4 am day start means 1 am still counts as yesterday. */
  const gameDate = (now, dayStartHour) => ymd(new Date(now.getTime() - (dayStartHour || 0) * 3600000));

  /** Date + "HH:MM" -> Date */
  const at = (dateStr, hm) => {
    const d = parseYmd(dateStr);
    const m = hmToMin(hm) || 0;
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return d;
  };

  const clock24 = () => !!(Q.store && Q.store.state.settings.clock24);
  const fmtTime = (d) => {
    if (typeof d === 'string') { const m = hmToMin(d); d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60); }
    const h = d.getHours(), m = d.getMinutes();
    if (clock24()) return `${pad(h)}:${pad(m)}`;
    const hh = h % 12 || 12;
    return `${hh}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const fmtDate = (d, opts = {}) => {
    const s = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return opts.year ? `${s} ${d.getFullYear()}` : s;
  };
  /** "Today", "Tomorrow", "Fri 6 Nov" */
  const fmtDay = (d, now = new Date()) => {
    const dd = diffDays(d, now);
    if (dd === 0) return 'Today';
    if (dd === 1) return 'Tomorrow';
    if (dd === -1) return 'Yesterday';
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };
  const fmtDuration = (min) => {
    min = Math.round(Math.abs(min));
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`;
  };
  /** "in 3h 5m" / "15m ago" / "now" */
  const rel = (target, now = new Date()) => {
    const min = (target - now) / 60000;
    if (Math.abs(min) < 1) return 'now';
    return min > 0 ? `in ${fmtDuration(min)}` : `${fmtDuration(min)} ago`;
  };
  const fmtClock = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /** Start of the week containing d, as YYYY-MM-DD. weekStart: 0 Sun, 1 Mon. */
  const weekKey = (d, weekStart = 1) => {
    const x = startOfDay(d);
    const off = (x.getDay() - weekStart + 7) % 7;
    return ymd(addDays(x, -off));
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);

  /** Small deterministic hash -> int, used to pick colors and bosses stably. */
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  return {
    pad, uid, ymd, parseYmd, addDays, addMinutes, startOfDay, sameDay, diffDays, hmToMin, minToHm, clamp,
    DAYS, DAYS_LONG, MONTHS, MONTHS_LONG, gameDate, at, fmtTime, fmtDate, fmtDay, fmtDuration, rel, fmtClock,
    esc, debounce, weekKey, pick, sum, hash,
  };
})();
