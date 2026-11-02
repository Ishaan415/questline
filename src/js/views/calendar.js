'use strict';
/* Full-page calendar: month / week / agenda. Shows events and reminders, never dailies. */

Q.views.calendar = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;
  let cursor = U.startOfDay(new Date());
  let selected = null;
  const HOUR_PX = 46;

  const view = () => S().settings.calView || 'month';
  const weekStart = () => S().settings.weekStart;
  const dayIdx = (i) => (weekStart() + i) % 7;

  function bucket(items, from, days) {
    const map = new Map();
    for (let i = 0; i < days; i++) map.set(U.ymd(U.addDays(from, i)), []);
    for (const it of items) {
      let d = U.startOfDay(new Date(it.start));
      const last = new Date(it.allDay ? it.end - 1 : Math.max(it.start, it.end - 1));
      for (let n = 0; n < 62 && d <= last; n++, d = U.addDays(d, 1)) {
        const k = U.ymd(d);
        if (map.has(k)) map.get(k).push(it);
      }
    }
    return map;
  }

  const chip = (it, showTime = true) => `<div class="mchip ${it.allDay ? 'allday' : ''} ${it.source === 'reminder' ? 'rem' : ''} ${it.done ? 'done' : ''}" data-act="cal-item" data-id="${esc(it.id)}" style="--c:${it.color}" title="${esc(it.title)}">
    ${it.source === 'reminder' ? I('bell') : '<span class="mchip-dot"></span>'}${showTime && !it.allDay ? `<span class="mchip-time">${U.fmtTime(new Date(it.start)).replace(':00', '').replace(' ', '').toLowerCase()}</span>` : ''}<span class="mchip-title">${esc(it.title)}</span></div>`;

  /* ---------------------------------------------------------- month */
  function month() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const off = (first.getDay() - weekStart() + 7) % 7;
    const gridStart = U.addDays(first, -off);
    const dim = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((off + dim) / 7);
    const days = weeks * 7;
    const items = Q.sync.itemsBetween(gridStart.getTime(), U.addDays(gridStart, days).getTime() - 1);
    const map = bucket(items, gridStart, days);
    const today = U.ymd(new Date());
    let cells = '';
    for (let i = 0; i < days; i++) {
      const d = U.addDays(gridStart, i); const k = U.ymd(d);
      const list = map.get(k);
      const out = d.getMonth() !== cursor.getMonth();
      cells += `<div class="mc ${out ? 'out' : ''} ${k === today ? 'today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'wknd' : ''} ${selected === k ? 'sel' : ''}" data-act="cal-day" data-date="${k}">
        <div class="mc-head"><span class="mc-num">${d.getDate() === 1 ? `${U.MONTHS[d.getMonth()]} ` : ''}${d.getDate()}</span></div>
        <div class="mc-items">${list.map((it) => chip(it)).join('')}</div></div>`;
    }
    return `<div class="month" style="--weeks:${weeks}">
      <div class="month-dow">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<div>${U.DAYS[dayIdx(i)]}</div>`).join('')}</div>
      <div class="month-grid">${cells}</div></div>`;
  }

  /** Hide chips that don't fit and add "+N more". */
  function fitMonth(root) {
    root.querySelectorAll('.mc').forEach((cell) => {
      const box = cell.querySelector('.mc-items');
      const chips = [...box.querySelectorAll('.mchip')];
      box.querySelector('.mc-more')?.remove();
      chips.forEach((c) => { c.hidden = false; });
      if (!chips.length) return;
      const avail = box.clientHeight;
      const h = chips[0].offsetHeight + 3;
      const cap = Math.max(1, Math.floor(avail / h));
      if (chips.length > cap) {
        chips.slice(cap - 1).forEach((c) => { c.hidden = true; });
        box.insertAdjacentHTML('beforeend', `<div class="mc-more">+${chips.length - cap + 1} more</div>`);
      }
    });
  }

  /* ----------------------------------------------------------- week */
  function week() {
    const off = (cursor.getDay() - weekStart() + 7) % 7;
    const start = U.addDays(cursor, -off);
    const items = Q.sync.itemsBetween(start.getTime(), U.addDays(start, 7).getTime() - 1);
    const map = bucket(items, start, 7);
    const today = U.ymd(new Date());
    const now = new Date();
    const cols = [];
    let allday = '';
    for (let i = 0; i < 7; i++) {
      const d = U.addDays(start, i); const k = U.ymd(d);
      const list = map.get(k);
      allday += `<div class="wk-allday-cell">${list.filter((x) => x.allDay).map((x) => chip(x, false)).join('')}</div>`;
      const timed = list.filter((x) => !x.allDay).map((x) => {
        const ds = U.startOfDay(d).getTime();
        const s = Math.max(x.start, ds); const e = Math.min(Math.max(x.end, x.start + 20 * 60000), ds + 86400000);
        return { x, s: (s - ds) / 60000, e: (e - ds) / 60000 };
      }).sort((a, b) => a.s - b.s);
      const lanes = [];
      for (const t of timed) {
        let li = lanes.findIndex((end) => end <= t.s);
        if (li < 0) { li = lanes.length; lanes.push(0); }
        lanes[li] = t.e; t.lane = li;
      }
      const n = Math.max(1, lanes.length);
      const evs = timed.map((t) => `<div class="wk-ev ${t.x.source === 'reminder' ? 'rem' : ''} ${t.x.done ? 'done' : ''}" data-act="cal-item" data-id="${esc(t.x.id)}"
          style="--c:${t.x.color};top:${(t.s / 60) * HOUR_PX}px;height:${Math.max(20, ((t.e - t.s) / 60) * HOUR_PX - 2)}px;left:calc(${(t.lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)">
          <b>${t.x.source === 'reminder' ? I('bell') : ''}${esc(t.x.title)}</b><span>${U.fmtTime(new Date(t.x.start))}</span></div>`).join('');
      const nowLine = k === today ? `<div class="wk-now" style="top:${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX}px"></div>` : '';
      cols.push(`<div class="wk-col ${k === today ? 'today' : ''}" data-date="${k}">${Array.from({ length: 24 }, (_, h) => `<div class="wk-slot" data-act="cal-slot" data-date="${k}" data-hour="${h}"></div>`).join('')}${evs}${nowLine}</div>`);
    }
    return `<div class="week">
      <div class="wk-head"><div class="wk-gutter"></div>${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = U.addDays(start, i); return `<div class="wk-day ${U.ymd(d) === today ? 'today' : ''}" data-act="cal-day" data-date="${U.ymd(d)}"><span>${U.DAYS[d.getDay()]}</span><b>${d.getDate()}</b></div>`; }).join('')}</div>
      <div class="wk-allday"><div class="wk-gutter small muted">all-day</div>${allday}</div>
      <div class="wk-scroll"><div class="wk-body" style="--hour:${HOUR_PX}px">
        <div class="wk-hours">${Array.from({ length: 24 }, (_, h) => `<div>${h ? U.fmtTime(`${U.pad(h)}:00`).replace(':00', '') : ''}</div>`).join('')}</div>
        ${cols.join('')}</div></div></div>`;
  }

  /* --------------------------------------------------------- agenda */
  function agenda() {
    const start = U.startOfDay(cursor);
    const items = Q.sync.itemsBetween(start.getTime(), U.addDays(start, 60).getTime());
    const map = bucket(items, start, 60);
    let html = '';
    for (const [k, list] of map) {
      if (!list.length) continue;
      const d = U.parseYmd(k);
      html += `<div class="ag-day"><div class="ag-date ${k === U.ymd(new Date()) ? 'today' : ''}"><b>${d.getDate()}</b><span>${U.DAYS[d.getDay()]} · ${U.MONTHS[d.getMonth()]}</span></div>
        <div class="ag-items">${list.map((it) => `<div class="ag-item ${it.source === 'reminder' ? 'rem' : ''} ${it.done ? 'done' : ''}" data-act="cal-item" data-id="${esc(it.id)}" style="--c:${it.color}">
          <span class="ag-time">${it.allDay ? 'All day' : U.fmtTime(new Date(it.start))}</span><span class="ag-bar"></span>
          <span class="ag-title">${it.source === 'reminder' ? I('bell') : ''}${esc(it.title)}</span>${it.location ? `<span class="muted small">${esc(it.location)}</span>` : ''}</div>`).join('')}</div></div>`;
    }
    return `<div class="agenda">${html || '<p class="muted pad">Nothing in the next 60 days.</p>'}</div>`;
  }

  /* ------------------------------------------------------ day panel */
  function dayPanel() {
    if (!selected) return '';
    const d = U.parseYmd(selected);
    const list = Q.sync.itemsBetween(d.getTime(), U.addDays(d, 1).getTime() - 1);
    return `<aside class="panel cal-side">
      <div class="panel-title">${U.DAYS_LONG[d.getDay()]}, ${d.getDate()} ${U.MONTHS_LONG[d.getMonth()]}<button class="icon-btn" data-act="cal-close-day" aria-label="Close">${I('close')}</button></div>
      <div class="cal-side-list">${list.length ? list.map((it) => `<div class="ag-item ${it.source === 'reminder' ? 'rem' : ''} ${it.done ? 'done' : ''}" data-act="cal-item" data-id="${esc(it.id)}" style="--c:${it.color}">
        <span class="ag-time">${it.allDay ? 'All day' : U.fmtTime(new Date(it.start))}</span><span class="ag-bar"></span><span class="ag-title">${it.source === 'reminder' ? I('bell') : ''}${esc(it.title)}</span></div>`).join('') : '<p class="muted small pad">Nothing planned.</p>'}</div>
      <div class="cal-side-actions"><button class="btn btn-small" data-act="cal-new" data-kind="event">${I('calendar')} Event</button><button class="btn btn-small" data-act="cal-new" data-kind="reminder">${I('bell')} Reminder</button></div>
    </aside>`;
  }

  function title() {
    if (view() === 'week') {
      const off = (cursor.getDay() - weekStart() + 7) % 7;
      const s = U.addDays(cursor, -off); const e = U.addDays(s, 6);
      return s.getMonth() === e.getMonth() ? `${U.MONTHS_LONG[s.getMonth()]} <span>${s.getDate()}–${e.getDate()}, ${s.getFullYear()}</span>` : `${U.MONTHS[s.getMonth()]} ${s.getDate()} – ${U.MONTHS[e.getMonth()]} ${e.getDate()} <span>${e.getFullYear()}</span>`;
    }
    if (view() === 'agenda') return `Agenda <span>from ${U.fmtDay(cursor)}</span>`;
    return `${U.MONTHS_LONG[cursor.getMonth()]} <span>${cursor.getFullYear()}</span>`;
  }

  function sources() {
    const st = S();
    const g = st.settings.google;
    const chips = [
      `<button class="src ${st.settings.calShowReminders ? 'on' : ''}" data-act="cal-src" data-src="reminders" style="--c:${Q.sync.REMINDER_COLOR}">${I('bell')}Reminders</button>`,
      `<span class="src on static" style="--c:${Q.sync.LOCAL_COLOR}"><i></i>My events</span>`,
    ];
    for (const c of g.calendars) chips.push(`<button class="src ${c.selected ? 'on' : ''}" data-act="cal-src" data-src="g:${esc(c.id)}" style="--c:${c.color}"><i></i>${esc(c.name)}</button>`);
    if (!g.calendars.length && st.calCache.google.some((x) => x.demo)) chips.push(`<span class="src on static" style="--c:${Q.sync.GOOGLE_COLOR}"><i></i>Google (sample)</span>`);
    for (const f of st.settings.ics) chips.push(`<button class="src ${f.on !== false ? 'on' : ''}" data-act="cal-src" data-src="ics:${esc(f.url)}" style="--c:${f.color}"><i></i>${esc(f.name)}</button>`);
    return chips.join('');
  }

  function syncStatus() {
    const st = S();
    const c = st.calCache;
    if (Q.sync.isSyncing()) return 'Syncing…';
    if (c.error) return `<span class="err" title="${esc(c.error)}">Sync failed</span>`;
    if (!st.settings.google.connected && !st.settings.ics.length) return Q.platform.isApp ? '<button class="link" data-act="go" data-view="settings" data-anchor="sync">Connect a calendar</button>' : 'Sample data';
    return c.syncedAt ? `Synced ${U.rel(new Date(c.syncedAt))}` : 'Not synced yet';
  }

  function render(root) {
    const v = view();
    root.innerHTML = `<div class="cal-page cal-${v}">
      <div class="cal-head">
        <h1 class="page-title cal-title">${title()}</h1>
        <div class="cal-nav">
          <button class="icon-btn" data-act="cal-prev" aria-label="Previous" title="Previous (←)">${I('left')}</button>
          <button class="btn btn-small" data-act="cal-today" title="Today (T)">Today</button>
          <button class="icon-btn" data-act="cal-next" aria-label="Next" title="Next (→)">${I('right')}</button>
        </div>
        <div class="seg seg-small" role="tablist">${[['month', 'Month', 'M'], ['week', 'Week', 'W'], ['agenda', 'Agenda', 'A']].map(([k, n, key]) => `<button class="seg-btn ${v === k ? 'on' : ''}" data-act="cal-view" data-v="${k}" title="${n} (${key})">${n}</button>`).join('')}</div>
        <div class="cal-sync"><span class="small muted">${syncStatus()}</span><button class="icon-btn" data-act="cal-sync" title="Sync now" aria-label="Sync now">${I('sync')}</button>
          <button class="btn btn-small btn-primary" data-act="cal-new" data-kind="event">${I('plus')} Event</button></div>
      </div>
      <div class="cal-sources">${sources()}</div>
      <div class="cal-body ${selected ? 'with-side' : ''}">
        <div class="panel cal-main">${v === 'week' ? week() : v === 'agenda' ? agenda() : month()}</div>
        ${dayPanel()}
      </div>
    </div>`;
    if (v === 'month') requestAnimationFrame(() => fitMonth(root));
    if (v === 'week') {
      const sc = root.querySelector('.wk-scroll');
      if (sc && !sc.dataset.scrolled) { sc.scrollTop = 7 * HOUR_PX; sc.dataset.scrolled = '1'; }
    }
  }

  function shift(n) {
    const v = view();
    if (v === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
    else if (v === 'week') cursor = U.addDays(cursor, 7 * n);
    else cursor = U.addDays(cursor, 30 * n);
    Q.app.render();
  }

  function openItem(id) {
    const st = S();
    if (id.startsWith('r:')) return Q.editors.open('reminder', id.slice(2));
    if (st.events.find((e) => e.id === id)) return Q.editors.open('event', id);
    return Q.editors.open('event', id); // Google / feed items open read-only or editable
  }

  function bind() {
    const on = Q.ui.on;
    on('cal-prev', () => shift(-1));
    on('cal-next', () => shift(1));
    on('cal-today', () => { cursor = U.startOfDay(new Date()); selected = U.ymd(cursor); Q.app.render(); });
    on('cal-view', (el) => { S().settings.calView = el.dataset.v; Q.store.commit('settings'); });
    on('cal-day', (el, e) => {
      if (e.target.closest('[data-act="cal-item"]')) return;
      selected = el.dataset.date === selected ? null : el.dataset.date;
      Q.app.render();
    });
    on('cal-close-day', () => { selected = null; Q.app.render(); });
    on('cal-item', (el, e) => { e.stopPropagation(); openItem(el.dataset.id); });
    on('cal-slot', (el) => {
      const s = U.at(el.dataset.date, `${U.pad(+el.dataset.hour)}:00`).getTime();
      Q.editors.open('event', null, { start: s, end: s + 3600000 });
    });
    on('cal-new', (el) => {
      const base = selected ? U.parseYmd(selected) : U.startOfDay(new Date());
      const h = new Date(); const start = new Date(base); start.setHours(selected ? 9 : h.getHours() + 1, 0, 0, 0);
      if (el.dataset.kind === 'reminder') Q.editors.open('reminder', null, { due: start.getTime() });
      else Q.editors.open('event', null, { start: start.getTime(), end: start.getTime() + 3600000 });
    });
    on('cal-sync', () => Q.sync.syncAll(true));
    on('cal-src', (el) => {
      const st = S(); const k = el.dataset.src;
      if (k === 'reminders') st.settings.calShowReminders = !st.settings.calShowReminders;
      else if (k.startsWith('g:')) { const c = st.settings.google.calendars.find((x) => x.id === k.slice(2)); if (c) { c.selected = !c.selected; Q.sync.syncAll(); } }
      else if (k.startsWith('ics:')) { const f = st.settings.ics.find((x) => x.url === k.slice(4)); if (f) f.on = f.on === false; }
      Q.store.commit('settings');
    });
    on('go-cal-day', (el) => { cursor = U.parseYmd(el.dataset.date); selected = el.dataset.date; Q.app.go('calendar'); });
    window.addEventListener('resize', U.debounce(() => { if (Q.app.current() === 'calendar' && view() === 'month') fitMonth(document.getElementById('view')); }, 120));
  }

  function key(e) {
    if (e.key === 'ArrowLeft') { shift(-1); return true; }
    if (e.key === 'ArrowRight') { shift(1); return true; }
    if (e.key === 't' || e.key === 'T') { cursor = U.startOfDay(new Date()); Q.app.render(); return true; }
    const v = { m: 'month', w: 'week', a: 'agenda' }[e.key.toLowerCase()];
    if (v) { S().settings.calView = v; Q.store.commit('settings'); return true; }
    return false;
  }

  return { render, bind, key, focusDate: (d) => { cursor = U.startOfDay(d); selected = U.ymd(d); } };
})();
