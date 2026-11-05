'use strict';
/*
 * Android home-screen widget bridge.
 *
 * The widget itself is native (plugins/ql-mobile/android: QlWidget.kt). It
 * can't run this app's code, so:
 *  - the app writes a small snapshot of today (dailies, reminders, HP, level)
 *    whenever something changes, and the widget draws from it;
 *  - ticking a row on the widget marks it done there at once and queues the
 *    tick; the app applies queued ticks (with their rewards) the next time it
 *    opens or comes back to the front.
 */

Q.widget = (() => {
  const U = Q.util;
  const P = Q.platform;
  const S = () => Q.store.state;
  const G = () => Q.game;
  const yesterday = new Map(); // day -> Set of daily ids ticked on the widget before the day was recorded
  let last = '';

  /** Today as the widget shows it. */
  function snapshot() {
    const st = S(); const day = G().today();
    const end = U.at(day, '00:00'); end.setHours(st.settings.dayStart + 24, 0, 0, 0);
    const now = Date.now();
    const dailies = G().todaysDailies().slice().sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));
    const items = dailies.map((d) => {
      const due = G().dueAt(d, day);
      return { kind: 'daily', id: d.id, title: d.title, time: d.time ? U.fmtTime(d.time) : '', done: G().isDone(d, day), late: !!due && !G().isDone(d, day) && now > due.getTime() + 30 * 60000 };
    });
    const dayStartTs = end.getTime() - 86400000;
    const rems = st.reminders.filter((r) => !r.done && r.due && (G().remAllDay(r) ? G().remDay(r) <= day : r.due < end.getTime())).sort((a, b) => a.due - b.due).slice(0, 12);
    for (const r of rems) {
      const over = G().remOverdue(r, now) || (G().remAllDay(r) && G().remDay(r) < day);
      const time = over && (G().remAllDay(r) || r.due < dayStartTs) ? 'Overdue' : G().remAllDay(r) ? 'Today' : U.fmtTime(new Date(r.due));
      items.push({ kind: 'reminder', id: r.id, title: r.title, time, done: false, late: over || (!G().remAllDay(r) && r.due < now) });
    }
    const done = dailies.filter((d) => G().isDone(d, day)).length;
    return {
      v: 1, day, dayEnd: end.getTime(), updated: now,
      title: `${U.DAYS_LONG[U.parseYmd(day).getDay()]} ${U.parseYmd(day).getDate()} ${U.MONTHS[U.parseYmd(day).getMonth()]}`,
      level: st.hero.level, hp: Math.ceil(st.hero.hp), maxHp: G().maxHp(), gold: st.hero.gold,
      done, total: dailies.length, items: items.slice(0, 40),
    };
  }

  const push = U.debounce(() => {
    if (!P.isAndroid) return;
    let json;
    try { json = JSON.stringify(snapshot()); } catch (e) { return; }
    // Same content as last time (ignoring the timestamp): nothing to redraw.
    const key = json.replace(/"updated":\d+,/, '');
    if (key === last) return;
    last = key;
    P.invoke('plugin:ql-mobile|widget_update', { json }).catch(() => {});
  }, 1200);

  /** Apply ticks made on the widget, then open Quick add if its + was tapped. */
  async function pull() {
    if (!P.isAndroid) return;
    let res;
    try { res = await P.invoke('plugin:ql-mobile|widget_take'); } catch (e) { return; }
    const st = S(); const day = G().today();
    let changed = false;
    for (const q of (res && res.queue) || []) {
      if (q.kind === 'daily') {
        const d = st.dailies.find((x) => x.id === q.id);
        if (!d) continue;
        if (q.day === day) {
          if (!!q.done !== G().isDone(d, day)) { G().toggleDaily(d.id); changed = true; }
        } else if (q.day === st.day.last && q.done) {
          // Ticked before the app recorded that day: pre-tick it in "Record yesterday".
          if (!yesterday.has(q.day)) yesterday.set(q.day, new Set());
          yesterday.get(q.day).add(q.id);
        }
      } else if (q.kind === 'reminder' && q.done) {
        const r = st.reminders.find((x) => x.id === q.id);
        if (r && !r.done) { G().completeReminder(r.id); changed = true; }
      }
    }
    if (changed) { Q.app.flushGame(); Q.ui.toast('Ticks from your home-screen widget were added.', { kind: 'ok', icon: Q.sprites.icon('check') }); }
    last = ''; push();
    if (res && res.action === 'quickadd') setTimeout(() => Q.ui.quickAdd(), 250);
  }

  function init() {
    if (!P.isAndroid) return;
    Q.store.on(() => push());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
    setInterval(() => push(), 5 * 60000); // "late" marks and the clock move on
    pull();
  }

  return { init, pull, push, snapshot, pendingYesterday: (day) => yesterday.get(day) || new Set() };
})();
