'use strict';
/* Reminders: one-off (or repeating) things with a date and time, plus undated to-dos. */

Q.views.reminders = (() => {
  const U = Q.util;
  const C = Q.comp;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  let showDone = false;

  function render(root) {
    const st = S();
    const now = new Date();
    const t0 = U.startOfDay(now).getTime();
    const day = 86400000;
    const open = st.reminders.filter((r) => !r.done);
    const weekEnd = U.addDays(U.startOfDay(now), 7).getTime();
    const groups = [
      ['Overdue', 'late', open.filter((r) => r.due && r.due < now.getTime())],
      ['Today', '', open.filter((r) => r.due && r.due >= now.getTime() && r.due < t0 + day)],
      ['Tomorrow', '', open.filter((r) => r.due && r.due >= t0 + day && r.due < t0 + 2 * day)],
      ['Next 7 days', '', open.filter((r) => r.due && r.due >= t0 + 2 * day && r.due < weekEnd)],
      ['Later', '', open.filter((r) => r.due && r.due >= weekEnd)],
      ['No date', '', open.filter((r) => !r.due)],
    ];
    const done = st.reminders.filter((r) => r.done).sort((a, b) => b.doneAt - a.doneAt);
    const body = groups.filter(([, , l]) => l.length).map(([name, cls, list]) => `
      <div class="group ${cls ? `group-${cls}` : ''}">
        <div class="group-head"><span>${name}</span><span class="muted small">${list.length}</span>
          ${name === 'Overdue' && list.length > 1 ? `<button class="link" data-act="rem-bulk-tomorrow">Move all to tomorrow</button>` : ''}</div>
        ${list.sort((a, b) => (a.due || 0) - (b.due || 0)).map((r) => C.reminderRow(r)).join('')}
      </div>`).join('');

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">One-off tasks with a date</div><h1 class="page-title">Reminders</h1></div>
        <div class="head-stats">
          <div class="stat-pill"><b>${open.length}</b><span>open</span></div>
          <div class="stat-pill"><b>${st.counters.remindersDone}</b><span>completed</span></div>
        </div>
        <div class="head-actions"><button class="btn btn-primary" data-act="new" data-type="reminder">${I('plus')} New reminder</button></div>
      </div>
      <div class="rem-layout">
        <section class="panel rem-list">
          <div class="qa-inline" data-act="quick-add" role="button" tabindex="0">${I('plus')}<span>Try “book tickets for the show fri 10am” <kbd>N</kbd></span></div>
          ${body || C.empty('All clear', 'No open reminders. Add one with a date and time and it will ping you, even with the window closed.', '')}
          ${done.length ? `<button class="group-toggle" data-act="rem-showdone">${showDone ? '▾' : '▸'} Completed (${done.length})</button>
            ${showDone ? `<div class="group">${done.slice(0, 30).map((r) => C.reminderRow(r)).join('')}${done.length > 30 ? `<p class="muted small pad">Showing the latest 30.</p>` : ''}
              <button class="link pad" data-act="rem-clear-done">Clear completed</button></div>` : ''}` : ''}
        </section>
        <div class="rem-side">
          <section class="panel">
            <div class="panel-title">${I('calendar')} Next 7 days</div>
            <div class="week-strip">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const d = U.addDays(U.startOfDay(now), i);
              const n = open.filter((r) => r.due && U.sameDay(new Date(r.due), d)).length;
              return `<div class="ws-day ${i === 0 ? 'today' : ''}" data-act="go-cal-day" data-date="${U.ymd(d)}"><span>${U.DAYS[d.getDay()].slice(0, 2)}</span><b>${d.getDate()}</b><i>${n ? '●'.repeat(Math.min(n, 3)) : ''}</i></div>`;
            }).join('')}</div>
          </section>
          <section class="panel tips">
            <div class="panel-title">${I('star')} Reminder tips</div>
            <ul class="tip-list">
              <li>Finishing before the due time pays a <b>20% bonus</b>. Late ones still pay full XP.</li>
              <li>Hit ${I('snooze')} to snooze 10 min, an hour, tonight or tomorrow.</li>
              <li>Reminders show on your Calendar${st.settings.google.connected ? ' and sync to Google' : ''}. Dailies don't, so the calendar stays readable.</li>
            </ul>
          </section>
        </div>
      </div>`;
  }

  function snoozeMenu(id) {
    const r = S().reminders.find((x) => x.id === id);
    if (!r) return;
    const now = new Date();
    const tonight = new Date(now); tonight.setHours(20, 0, 0, 0);
    const tmrw = U.addDays(U.startOfDay(now), 1); tmrw.setHours(9, 0, 0, 0);
    const nextWeek = U.addDays(U.startOfDay(now), 7); nextWeek.setHours(9, 0, 0, 0);
    const opts = [
      ['10 minutes', 'snooze', Date.now() + 10 * 60000], ['1 hour', 'snooze', Date.now() + 3600000],
      ...(tonight > now ? [['Tonight 8 PM', 'move', tonight.getTime()]] : []),
      ['Tomorrow 9 AM', 'move', tmrw.getTime()], ['Next week', 'move', nextWeek.getTime()],
    ];
    Q.ui.modal({
      title: 'Snooze', cls: 'modal-small',
      body: `<p class="dialog-text">${U.esc(r.title)}</p><div class="snooze-opts">${opts.map(([l, k, t], i) =>
        `<button class="btn" data-i="${i}"><b>${l}</b><span class="small muted">${k === 'snooze' ? 'ping again' : 'move due date'} · ${U.fmtDay(new Date(t))} ${U.fmtTime(new Date(t))}</span></button>`).join('')}</div>`,
      onMount(m, close) {
        m.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
          const [, kind, t] = opts[+b.dataset.i];
          if (kind === 'snooze') r.snoozedUntil = t; else { r.due = t; r.snoozedUntil = null; r.gcalDirty = true; }
          Q.store.commit('snooze'); close();
          Q.ui.toast(kind === 'snooze' ? `Snoozed until ${U.fmtTime(new Date(t))}` : `Moved to ${U.fmtDay(new Date(t))}`, { kind: 'ok' });
        }));
      },
    });
  }

  function bind() {
    Q.ui.on('rem-showdone', () => { showDone = !showDone; Q.app.render(); });
    Q.ui.on('rem-snooze', (el) => snoozeMenu(el.dataset.id));
    Q.ui.on('rem-clear-done', () => {
      Q.store.snapshot();
      const st = S(); st.reminders = st.reminders.filter((r) => !r.done); Q.store.commit('clear');
      Q.ui.toast('Cleared completed reminders', { actions: [{ label: 'Undo', fn: () => Q.store.undo() }] });
    });
    Q.ui.on('rem-bulk-tomorrow', () => {
      const st = S(); const now = Date.now();
      Q.store.snapshot();
      for (const r of st.reminders) if (!r.done && r.due && r.due < now) {
        const d = new Date(r.due); const t = U.addDays(U.startOfDay(new Date()), 1); t.setHours(d.getHours(), d.getMinutes());
        r.due = t.getTime(); r.snoozedUntil = null; r.gcalDirty = true;
      }
      Q.store.commit('bulk');
      Q.ui.toast('Moved overdue reminders to tomorrow', { actions: [{ label: 'Undo', fn: () => Q.store.undo() }] });
    });
  }

  return { render, bind, snoozeMenu };
})();
