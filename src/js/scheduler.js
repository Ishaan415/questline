'use strict';
/* Builds the next 48 h of notifications and hands them to the native alarm thread. */

Q.scheduler = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  let focusActive = false;
  let extra = [];

  function inQuiet(date) {
    const s = S().settings;
    if (!s.quietOn) return false;
    const m = date.getHours() * 60 + date.getMinutes();
    const a = U.hmToMin(s.quietFrom); const b = U.hmToMin(s.quietTo);
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }

  function build() {
    const st = S();
    const now = Date.now();
    const horizon = now + 48 * 3600000;
    const alarms = [];
    const add = (id, at, title, body) => {
      if (at < now - 60000 || at > horizon) return;
      const silent = !st.settings.notifications || focusActive && st.settings.muteInFocus || inQuiet(new Date(at));
      alarms.push({ id, at: Math.round(at), title, body, silent });
    };

    // Dailies with a time: heads-up + on time.
    const today = Q.game.today();
    for (const ds of [today, U.ymd(U.addDays(U.parseYmd(today), 1))]) {
      for (const d of st.dailies) {
        if (d.archived || !d.time || !Q.game.isScheduled(d, ds) || Q.game.isDone(d, ds)) continue;
        if (st.settings.inn) continue;
        const due = Q.game.dueAt(d, ds).getTime();
        const lead = d.lead ?? st.settings.defaultLead;
        if (lead > 0) add(`d:${d.id}:${ds}:${lead}`, due - lead * 60000, `Coming up: ${d.title}`, `Daily at ${U.fmtTime(new Date(due))} · ${lead} min from now`);
        add(`d:${d.id}:${ds}:0`, due, `Time for: ${d.title}`, d.notes ? d.notes.slice(0, 90) : 'Tick it off for XP and gold.');
      }
    }

    // Reminders (with snooze).
    for (const r of st.reminders) {
      if (r.done || !r.due) continue;
      if (r.snoozedUntil && r.snoozedUntil > now) {
        add(`r:${r.id}:snz:${r.snoozedUntil}`, r.snoozedUntil, `Reminder: ${r.title}`, `Snoozed reminder · due ${U.fmtDay(new Date(r.due))} ${U.fmtTime(new Date(r.due))}`);
        continue;
      }
      if (Q.game.remAllDay(r)) {
        // All-day: one nudge in the morning of that day.
        const at = U.at(Q.game.remDay(r), st.settings.allDayAt || '09:00').getTime();
        add(`r:${r.id}:${r.due}:day`, at, `Today: ${r.title}`, r.notes ? r.notes.slice(0, 90) : 'Any time today. Tick it off for XP and gold.');
        continue;
      }
      const lead = r.lead ?? st.settings.defaultLead;
      if (lead > 0) add(`r:${r.id}:${r.due}:${lead}`, r.due - lead * 60000, `Soon: ${r.title}`, `Due at ${U.fmtTime(new Date(r.due))}`);
      add(`r:${r.id}:${r.due}:0`, r.due, `Reminder: ${r.title}`, r.notes ? r.notes.slice(0, 90) : 'Mark it done to collect your reward.');
    }

    // Calendar events: 10 minutes before.
    for (const ev of Q.sync.itemsBetween(now, horizon, { reminders: false })) {
      if (ev.allDay) continue;
      add(`e:${ev.id}:${ev.start}`, ev.start - 10 * 60000, `${ev.title}`, `Starts at ${U.fmtTime(new Date(ev.start))}${ev.location ? ` · ${ev.location}` : ''}`);
    }
    for (const x of extra) alarms.push(x);
    return alarms.sort((a, b) => a.at - b.at);
  }

  function tooltip() {
    const st = S();
    const list = Q.game.todaysDailies();
    const left = list.filter((d) => !Q.game.isDone(d)).length;
    const next = build().find((a) => a.at > Date.now());
    let t = `Questline · Lv ${st.hero.level} · ${left ? `${left} dailies left` : 'all dailies done'}`;
    if (next) t += `\nNext: ${next.title.replace(/^(Coming up|Time for|Soon|Reminder): /, '')} at ${U.fmtTime(new Date(next.at))}`;
    return t;
  }

  const refresh = U.debounce(() => {
    try {
      Q.platform.setAlarms(build());
      Q.platform.setTrayTooltip(tooltip());
    } catch (e) { console.error('scheduler', e); }
  }, 800);

  return {
    build, refresh,
    setFocus(on) { focusActive = on; refresh(); },
    /** One-off alarms owned by other modules (e.g. the focus timer). */
    setExtra(list) { extra = list; refresh(); },
  };
})();
