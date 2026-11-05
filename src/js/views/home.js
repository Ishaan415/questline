'use strict';
/* Home: trainer + companion, today's timeline, boss, Spotify and what's next. */

Q.views.home = (() => {
  const U = Q.util;
  const G = Q.game;
  const C = Q.comp;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;

  function timeline() {
    const st = S();
    const now = new Date();
    const day = G.today();
    const dayStart = U.parseYmd(day); dayStart.setHours(st.settings.dayStart, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const rows = [];
    for (const d of G.todaysDailies()) rows.push({ t: d.time ? G.dueAt(d, day).getTime() : null, kind: 'daily', html: C.dailyRow(d, { compact: true }) });
    for (const r of st.reminders) {
      if (!r.due) continue;
      if (G.remAllDay(r)) {
        // All-day: today's go under "Any time today"; earlier ones are overdue.
        const d = G.remDay(r);
        const show = r.done ? r.doneAt >= dayStart.getTime() && d <= day : d <= day;
        if (show) rows.push({ t: d < day && !r.done ? dayStart.getTime() - 1 : null, kind: 'reminder', html: C.reminderRow(r, { compact: true }) });
        continue;
      }
      if (r.done ? r.doneAt >= dayStart.getTime() && r.due < dayEnd.getTime() : r.due < dayEnd.getTime()) {
        rows.push({ t: r.due < dayStart.getTime() ? dayStart.getTime() - 1 : r.due, kind: 'reminder', html: C.reminderRow(r, { compact: true }) });
      }
    }
    for (const ev of Q.sync.itemsBetween(dayStart.getTime(), dayEnd.getTime() - 1, { reminders: false })) {
      // When the day starts after midnight, the end of "today" already overlaps the next
      // date. An all-day event for that next date belongs at midnight in the timeline,
      // after tonight's tasks, not at the top with today's all-day events.
      const nextDate = ev.allDay && U.ymd(new Date(ev.start)) > day;
      rows.push({ t: ev.allDay && !nextDate ? dayStart.getTime() - 2 : ev.start, kind: 'event', allDay: ev.allDay, html: C.eventRow(ev) });
    }
    const timed = rows.filter((r) => r.t != null).sort((a, b) => a.t - b.t);
    // Things on the next calendar date (after midnight, before the day resets) get the weekday.
    const timeLabel = (r) => {
      if (r.t < dayStart.getTime()) return r.kind === 'event' ? 'All day' : 'Overdue';
      const d = new Date(r.t);
      const when = r.allDay ? 'All day' : U.fmtTime(d);
      return U.ymd(d) > day ? `<b class="tl-next">${U.DAYS[d.getDay()]}</b> ${when}` : when;
    };
    const anytime = rows.filter((r) => r.t == null);
    let html = '';
    let nowPlaced = false;
    for (const r of timed) {
      if (!nowPlaced && r.t > now.getTime()) { html += nowLine(now); nowPlaced = true; }
      html += `<div class="tl-row tl-${r.kind}"><span class="tl-time">${timeLabel(r)}</span><span class="tl-dot"></span>${r.html}</div>`;
    }
    if (!nowPlaced && timed.length) html += nowLine(now);
    if (anytime.length) html += `<div class="tl-sub">Any time today</div>${anytime.map((r) => `<div class="tl-row tl-${r.kind}"><span class="tl-time">—</span><span class="tl-dot"></span>${r.html}</div>`).join('')}`;
    if (!rows.length) html = C.empty('A quiet day', 'Nothing scheduled. Add a daily chore or a reminder to start earning XP.', `<button class="btn btn-primary" data-act="quick-add">${I('plus')} Quick add</button>`);
    return html;
  }
  const nowLine = (now) => `<div class="tl-now"><span>${U.fmtTime(now)}</span></div>`;

  function upcoming() {
    const st = S();
    const now = Date.now();
    const tomorrowEnd = U.addDays(U.startOfDay(new Date()), 2).getTime();
    const list = st.reminders.filter((r) => !r.done && r.due && r.due >= tomorrowEnd - 86400000 && (G.remAllDay(r) || r.due >= now)).sort((a, b) => a.due - b.due).slice(0, 4);
    const nodate = st.reminders.filter((r) => !r.done && !r.due).length;
    return `<section class="panel upcoming">
      <div class="panel-title">${I('bell')} Coming up <button class="link" data-act="go" data-view="reminders">All reminders</button></div>
      ${list.length ? list.map((r) => C.reminderRow(r, { compact: true })).join('') : '<p class="muted small pad">No reminders after today. Enjoy the calm.</p>'}
      ${nodate ? `<p class="small muted pad">${nodate} undated ${nodate === 1 ? 'to-do' : 'to-dos'} waiting in Reminders.</p>` : ''}
    </section>`;
  }

  function render(root) {
    const st = S();
    const list = G.todaysDailies();
    const done = list.filter((d) => G.isDone(d)).length;
    const now = new Date();
    const hour = now.getHours();
    const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    root.innerHTML = `
      <div class="home">
        <div class="home-left">
          ${C.trainerCard()}
          ${C.companionBox()}
        </div>
        <section class="panel home-today">
          <div class="today-head">
            <div>
              <div class="eyebrow">${greet}, ${esc(st.profile.name)}</div>
              <h1 class="page-title">${U.DAYS_LONG[now.getDay()]} <span>${now.getDate()} ${U.MONTHS_LONG[now.getMonth()]}</span></h1>
            </div>
            <div class="today-progress" title="${done} of ${list.length} dailies done">
              <div class="ring" style="--p:${list.length ? done / list.length : 0}"><span>${done}/${list.length}</span></div>
              <div class="small muted">dailies</div>
            </div>
          </div>
          <div class="qa-inline" data-act="quick-add" role="button" tabindex="0">${I('plus')}<span>Add a task, reminder or event… <kbd>N</kbd></span></div>
          <div class="timeline">${timeline()}</div>
        </section>
        <div class="home-right">
          ${C.bountyCard()}
          ${C.dailyBossCard()}
          ${C.bossCard()}
          <section class="panel">
            <div class="panel-title">${I('note')} Now playing</div>
            ${Q.spotify.markup('full')}
          </section>
          ${upcoming()}
          <button class="panel focus-cta" data-act="focus-open">
            <span class="fc-ico">${I('hourglass')}</span>
            <span><b>Enter focus mode</b><span class="small muted">Pomodoro, timer or stopwatch with ambient scenes</span></span>
            <kbd>F</kbd>
          </button>
        </div>
      </div>`;
    Q.spotify.render();
  }

  return { render, timeline };
})();
