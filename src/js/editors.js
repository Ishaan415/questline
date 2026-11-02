'use strict';
/* Create/edit forms for dailies, reminders, events, habits and custom rewards. */

Q.editors = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;

  const field = (label, inner, cls = '') => `<label class="field ${cls}"><span class="field-label">${label}</span>${inner}</label>`;
  const diffPicker = (val) => `<div class="seg" role="radiogroup" aria-label="Difficulty">${Object.entries(Q.game.DIFF).map(([k, d]) =>
    `<label class="seg-opt"><input type="radio" name="difficulty" value="${k}" ${k === val ? 'checked' : ''}><span>${'★'.repeat(d.stars)}<small>${d.label}</small></span></label>`).join('')}</div>`;
  const catPicker = (val) => `<div class="cat-pick">${Object.entries(Q.store.CATEGORIES).map(([k, c]) =>
    `<label class="cat-opt" style="--c:${c.color}"><input type="radio" name="category" value="${k}" ${k === val ? 'checked' : ''}><span>${c.name}</span></label>`).join('')}</div>`;
  const leadSelect = (val, name = 'lead') => `<select name="${name}">${[['', 'Default'], ['0', 'At the time only'], ['5', '5 min before'], ['10', '10 min before'], ['15', '15 min before'], ['30', '30 min before'], ['60', '1 hour before'], ['1440', '1 day before']]
    .map(([v, l]) => `<option value="${v}" ${String(val ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const form = (m) => {
    const f = m.querySelector('form');
    const fd = new FormData(f);
    const get = (k) => fd.get(k);
    return { f, get, all: (k) => fd.getAll(k) };
  };
  const actions = (isNew, extra = '') => `<div class="modal-actions">${!isNew ? `<button type="button" class="btn btn-danger-ghost" data-del>${I('trash')} Delete</button>` : ''}${extra}<span class="spacer"></span>
    <button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">${isNew ? 'Create' : 'Save'}</button></div>`;

  /* ------------------------------------------------------------- daily */
  function dailyForm(id) {
    const st = S();
    const d = id ? st.dailies.find((x) => x.id === id) : null;
    const v = d || { title: '', notes: '', time: '', schedule: { type: 'daily' }, difficulty: 'easy', category: 'home', checklist: [], lead: null };
    const sch = v.schedule || { type: 'daily' };
    const days = sch.type === 'weekly' ? sch.days : [1, 2, 3, 4, 5];
    Q.ui.modal({
      title: d ? 'Edit daily' : 'New daily', cls: 'modal-form',
      body: `<form autocomplete="off">
        ${field('Title', `<input name="title" required maxlength="120" value="${esc(v.title)}" placeholder="Water the plants">`)}
        <div class="row2">
          ${field('Time', `<input type="time" name="time" value="${esc(v.time || '')}">`, 'grow')}
          ${field('Heads-up', leadSelect(v.lead))}
        </div>
        <p class="hint">Leave time empty for an any-time chore. Finishing within 30 minutes of the time gives a 20% on-time bonus.</p>
        ${field('Repeats', `<select name="stype" data-stype>
          <option value="daily" ${sch.type === 'daily' ? 'selected' : ''}>Every day</option>
          <option value="weekly" ${sch.type === 'weekly' ? 'selected' : ''}>On certain days</option>
          <option value="interval" ${sch.type === 'interval' ? 'selected' : ''}>Every few days</option>
          <option value="monthly" ${sch.type === 'monthly' ? 'selected' : ''}>Once a month</option></select>`)}
        <div class="sched sched-weekly" ${sch.type === 'weekly' ? '' : 'hidden'}><div class="daypick">${[1, 2, 3, 4, 5, 6, 0].map((i) =>
          `<label><input type="checkbox" name="days" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${U.DAYS[i].slice(0, 2)}</span></label>`).join('')}</div></div>
        <div class="sched sched-interval" ${sch.type === 'interval' ? '' : 'hidden'}>${field('Every', `<input type="number" name="every" min="2" max="60" value="${sch.every || 2}"> <span>days, starting</span> <input type="date" name="istart" value="${esc(sch.start || Q.game.today())}">`, 'inline')}</div>
        <div class="sched sched-monthly" ${sch.type === 'monthly' ? '' : 'hidden'}>${field('Day of month', `<input type="number" name="dom" min="1" max="28" value="${sch.dom || 1}">`, 'inline')}</div>
        ${field('Difficulty', diffPicker(v.difficulty))}
        ${field('Category', catPicker(v.category))}
        ${field('Checklist', `<div class="checklist-edit" data-cl>${(v.checklist || []).map((c) => clRow(c.text)).join('')}</div><button type="button" class="btn btn-small" data-cl-add>${I('plus')} Add step</button>`)}
        ${field('Notes', `<textarea name="notes" rows="2" maxlength="500">${esc(v.notes || '')}</textarea>`)}
        ${d ? `<label class="check-line"><input type="checkbox" name="paused" ${d.paused ? 'checked' : ''}> Pause this daily (it won't appear or hurt you)</label>
          <p class="hint">Streak ${d.streak || 0} · best ${d.best || 0}</p>` : ''}
        ${actions(!d)}
      </form>`,
      onMount(m, close) {
        const sel = m.querySelector('[data-stype]');
        sel.onchange = () => m.querySelectorAll('.sched').forEach((el) => { el.hidden = !el.classList.contains(`sched-${sel.value}`); });
        bindChecklist(m);
        m.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          const { get, all } = form(m);
          const type = get('stype');
          const schedule = { type };
          if (type === 'weekly') { schedule.days = all('days').map(Number); if (!schedule.days.length) return Q.ui.toast('Pick at least one day', { kind: 'error' }); }
          if (type === 'interval') { schedule.every = U.clamp(+get('every') || 2, 2, 60); schedule.start = get('istart') || Q.game.today(); }
          if (type === 'monthly') schedule.dom = U.clamp(+get('dom') || 1, 1, 28);
          const texts = [...m.querySelectorAll('[data-cl] input')].map((i) => i.value.trim()).filter(Boolean);
          const old = d ? d.checklist : [];
          const data = {
            title: get('title').trim(), time: get('time') || null, lead: get('lead') === '' ? null : +get('lead'), schedule,
            difficulty: get('difficulty') || 'easy', category: get('category') || 'home', notes: get('notes').trim(),
            checklist: texts.map((t) => old.find((c) => c.text === t) || { id: U.uid(), text: t, done: false }),
            paused: !!get('paused'),
          };
          if (d) Object.assign(d, data);
          else st.dailies.push(Object.assign({ id: U.uid(), createdAt: Date.now(), streak: 0, best: 0, done: {}, order: st.dailies.length }, data));
          Q.game.ensureBoss();
          Q.store.commit('daily');
          close();
          Q.ui.toast(d ? 'Daily saved' : `Daily added: ${data.title}`, { kind: 'ok' });
        };
        const del = m.querySelector('[data-del]');
        if (del) del.onclick = () => removeWithUndo('dailies', d.id, d.title, close);
      },
    });
  }
  const clRow = (t) => `<div class="cl-row">${I('drag')}<input value="${esc(t)}" maxlength="80" placeholder="Step"><button type="button" class="icon-btn" data-cl-del aria-label="Remove step">${I('close')}</button></div>`;
  function bindChecklist(m) {
    const box = m.querySelector('[data-cl]');
    m.querySelector('[data-cl-add]').onclick = () => { box.insertAdjacentHTML('beforeend', clRow('')); box.lastElementChild.querySelector('input').focus(); };
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-cl-del]'); if (b) b.parentElement.remove(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.querySelector('[data-cl-add]').click(); } });
  }

  /* ---------------------------------------------------------- reminder */
  function reminderForm(id, preset = {}) {
    const st = S();
    const r = id ? st.reminders.find((x) => x.id === id) : null;
    const due = r ? (r.due ? new Date(r.due) : null) : preset.due ? new Date(preset.due) : U.addMinutes(new Date(), 60);
    const v = r || Object.assign({ title: '', notes: '', repeat: 'none', difficulty: 'easy', category: 'errands', lead: null }, preset);
    Q.ui.modal({
      title: r ? 'Edit reminder' : 'New reminder', cls: 'modal-form',
      body: `<form autocomplete="off">
        ${field('Title', `<input name="title" required maxlength="140" value="${esc(v.title)}" placeholder="Book tickets for the show">`)}
        <label class="check-line"><input type="checkbox" name="nodate" ${due ? '' : 'checked'} data-nodate> No date (a to-do for whenever)</label>
        <div class="row2" data-datefields ${due ? '' : 'hidden'}>
          ${field('Date', `<input type="date" name="date" value="${due ? U.ymd(due) : Q.game.today()}">`, 'grow')}
          ${field('Time', `<input type="time" name="time" value="${due ? `${U.pad(due.getHours())}:${U.pad(due.getMinutes())}` : '09:00'}">`, 'grow')}
        </div>
        <div class="row2" data-datefields ${due ? '' : 'hidden'}>
          ${field('Notify', leadSelect(v.lead), 'grow')}
          ${field('Repeat', `<select name="repeat">${['none', 'daily', 'weekly', 'monthly', 'yearly'].map((x) => `<option value="${x}" ${v.repeat === x ? 'selected' : ''}>${x === 'none' ? 'Does not repeat' : x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select>`, 'grow')}
        </div>
        ${field('Difficulty', diffPicker(v.difficulty))}
        ${field('Category', catPicker(v.category))}
        ${field('Notes', `<textarea name="notes" rows="2" maxlength="800">${esc(v.notes || '')}</textarea>`)}
        ${actions(!r, r && r.done ? '<button type="button" class="btn" data-reopen>Mark not done</button>' : '')}
      </form>`,
      onMount(m, close) {
        const nd = m.querySelector('[data-nodate]');
        nd.onchange = () => m.querySelectorAll('[data-datefields]').forEach((el) => { el.hidden = nd.checked; });
        m.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          const { get } = form(m);
          const dueMs = get('nodate') ? null : U.at(get('date'), get('time') || '09:00').getTime();
          const data = {
            title: get('title').trim(), notes: get('notes').trim(), due: dueMs, repeat: dueMs ? get('repeat') : 'none',
            lead: get('lead') === '' || get('lead') == null ? null : +get('lead'), difficulty: get('difficulty') || 'easy', category: get('category') || 'errands',
          };
          if (r) { if (r.due !== data.due) r.snoozedUntil = null; Object.assign(r, data, { gcalDirty: true }); }
          else st.reminders.push(Object.assign({ id: U.uid(), createdAt: Date.now(), done: false, gcalDirty: true }, data));
          Q.store.commit('reminder');
          close();
          Q.ui.toast(r ? 'Reminder saved' : `Reminder set${dueMs ? ` for ${U.fmtDay(new Date(dueMs))} ${U.fmtTime(new Date(dueMs))}` : ''}`, { kind: 'ok' });
        };
        const del = m.querySelector('[data-del]');
        if (del) del.onclick = () => removeWithUndo('reminders', r.id, r.title, close);
        const ro = m.querySelector('[data-reopen]');
        if (ro) ro.onclick = () => { Q.game.reopenReminder(r.id); close(); };
      },
    });
  }

  /* ------------------------------------------------------------- event */
  const EVENT_COLORS = ['#2FA58A', '#3C82C8', '#E8604C', '#F29A4E', '#8E6BD1', '#E879A8', '#58B368', '#7D8597'];
  function eventForm(id, preset = {}) {
    const st = S();
    let item = id ? st.events.find((x) => x.id === id) : null;
    let remote = null;
    if (!item && id) { remote = st.calCache.google.find((x) => x.id === id) || st.calCache.ics.find((x) => x.id === id); item = remote; }
    const readOnly = remote && !remote.editable;
    const start = item ? new Date(item.start) : preset.start ? new Date(preset.start) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
    const end = item ? new Date(item.end) : preset.end ? new Date(preset.end) : U.addMinutes(start, 60);
    const v = item || Object.assign({ title: '', allDay: false, location: '', notes: '', color: EVENT_COLORS[0], repeat: 'none' }, preset);
    const hm = (d) => `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
    const endDay = v.allDay ? U.addDays(end, -1) : end;
    const srcLabel = remote ? (remote.source === 'google' ? `Google Calendar${remote.editable ? '' : ' (read-only)'}` : 'Subscribed calendar (read-only)') : '';
    Q.ui.modal({
      title: readOnly ? 'Event' : item ? 'Edit event' : 'New event', cls: 'modal-form',
      body: `<form autocomplete="off" ${readOnly ? 'class="readonly"' : ''}>
        ${srcLabel ? `<p class="src-pill" style="--c:${v.color}">${esc(srcLabel)}</p>` : ''}
        ${field('Title', `<input name="title" required maxlength="160" value="${esc(v.title)}" placeholder="Movie night" ${readOnly ? 'readonly' : ''}>`)}
        <label class="check-line"><input type="checkbox" name="allDay" ${v.allDay ? 'checked' : ''} data-allday ${readOnly ? 'disabled' : ''}> All day</label>
        <div class="row2">
          ${field('Starts', `<input type="date" name="sdate" value="${U.ymd(start)}" ${readOnly ? 'readonly' : ''}><input type="time" name="stime" value="${hm(start)}" data-timef ${v.allDay ? 'hidden' : ''} ${readOnly ? 'readonly' : ''}>`, 'grow dt')}
          ${field('Ends', `<input type="date" name="edate" value="${U.ymd(endDay)}" ${readOnly ? 'readonly' : ''}><input type="time" name="etime" value="${hm(end)}" data-timef ${v.allDay ? 'hidden' : ''} ${readOnly ? 'readonly' : ''}>`, 'grow dt')}
        </div>
        ${!remote ? field('Repeat', `<select name="repeat">${['none', 'daily', 'weekly', 'monthly', 'yearly'].map((x) => `<option value="${x}" ${v.repeat === x ? 'selected' : ''}>${x === 'none' ? 'Does not repeat' : x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select>`) : ''}
        ${field('Location', `<input name="location" maxlength="200" value="${esc(v.location || '')}" ${readOnly ? 'readonly' : ''}>`)}
        ${!remote ? field('Color', `<div class="swatches">${EVENT_COLORS.map((c) => `<label style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === v.color ? 'checked' : ''}><span></span></label>`).join('')}</div>`) : ''}
        ${field('Notes', `<textarea name="notes" rows="3" maxlength="2000" ${readOnly ? 'readonly' : ''}>${esc(v.notes || '')}</textarea>`)}
        ${readOnly ? '<div class="modal-actions"><span class="spacer"></span><button type="button" class="btn btn-primary" data-close>Close</button></div>' : actions(!item)}
      </form>`,
      onMount(m, close) {
        if (readOnly) return;
        const ad = m.querySelector('[data-allday]');
        ad.onchange = () => m.querySelectorAll('[data-timef]').forEach((el) => { el.hidden = ad.checked; });
        m.querySelector('form').onsubmit = async (e) => {
          e.preventDefault();
          const { get } = form(m);
          const allDay = !!get('allDay');
          let s = allDay ? U.parseYmd(get('sdate')).getTime() : U.at(get('sdate'), get('stime')).getTime();
          let en = allDay ? U.addDays(U.parseYmd(get('edate')), 1).getTime() : U.at(get('edate'), get('etime')).getTime();
          if (en <= s) en = allDay ? s + 86400000 : s + 3600000;
          const data = { title: get('title').trim(), allDay, start: s, end: en, location: get('location').trim(), notes: get('notes').trim() };
          if (remote) {
            try { await Q.sync.saveGoogleEvent(remote, data); close(); Q.ui.toast('Saved to Google Calendar', { kind: 'ok' }); }
            catch (err) { Q.ui.toast(String(err), { kind: 'error' }); }
            return;
          }
          Object.assign(data, { color: get('color') || EVENT_COLORS[0], repeat: get('repeat') || 'none' });
          if (item) Object.assign(item, data, { gcalDirty: true });
          else st.events.push(Object.assign({ id: U.uid(), createdAt: Date.now(), gcalDirty: true }, data));
          Q.store.commit('event');
          close();
          Q.ui.toast(item ? 'Event saved' : `Event added for ${U.fmtDay(new Date(s))}`, { kind: 'ok' });
          if (st.settings.google.connected) Q.sync.syncAll();
        };
        const del = m.querySelector('[data-del]');
        if (del) del.onclick = async () => {
          if (remote) {
            if (!(await Q.ui.confirm(`Delete “${remote.title}” from Google Calendar?`, { ok: 'Delete', danger: true }))) return;
            try { await Q.sync.deleteGoogleEvent(remote); close(); } catch (err) { Q.ui.toast(String(err), { kind: 'error' }); }
            return;
          }
          removeWithUndo('events', item.id, item.title, close);
        };
      },
    });
  }

  /* ------------------------------------------------------------- habit */
  function habitForm(id) {
    const st = S();
    const h = id ? st.habits.find((x) => x.id === id) : null;
    const v = h || { title: '', up: true, down: false, difficulty: 'easy', category: 'health' };
    Q.ui.modal({
      title: h ? 'Edit habit' : 'New habit', cls: 'modal-form',
      body: `<form autocomplete="off">
        ${field('Title', `<input name="title" required maxlength="100" value="${esc(v.title)}" placeholder="Drank a glass of water">`)}
        <p class="hint">Habits have no schedule. Tap <b>+</b> when you do a good one for XP; tap <b>−</b> when you slip and take a little damage.</p>
        <label class="check-line"><input type="checkbox" name="up" ${v.up ? 'checked' : ''}> Positive (+)</label>
        <label class="check-line"><input type="checkbox" name="down" ${v.down ? 'checked' : ''}> Negative (−)</label>
        ${field('Difficulty', diffPicker(v.difficulty))}
        ${field('Category', catPicker(v.category))}
        ${actions(!h)}
      </form>`,
      onMount(m, close) {
        m.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          const { get } = form(m);
          const data = { title: get('title').trim(), up: !!get('up'), down: !!get('down'), difficulty: get('difficulty'), category: get('category') };
          if (!data.up && !data.down) data.up = true;
          if (h) Object.assign(h, data); else st.habits.push(Object.assign({ id: U.uid(), createdAt: Date.now() }, data));
          Q.store.commit('habit'); close();
        };
        const del = m.querySelector('[data-del]');
        if (del) del.onclick = () => removeWithUndo('habits', h.id, h.title, close);
      },
    });
  }

  /* ------------------------------------------------------------ reward */
  function rewardForm(id) {
    const st = S();
    const r = id ? st.rewards.find((x) => x.id === id) : null;
    Q.ui.modal({
      title: r ? 'Edit reward' : 'New reward', cls: 'modal-form modal-small',
      body: `<form autocomplete="off">
        ${field('Treat', `<input name="title" required maxlength="80" value="${esc(r ? r.title : '')}" placeholder="Order biryani">`)}
        ${field('Price in gold', `<input type="number" name="cost" min="1" max="99999" value="${r ? r.cost : 50}">`)}
        <p class="hint">Price treats honestly: a typical easy task pays about 4 gold.</p>
        ${actions(!r)}
      </form>`,
      onMount(m, close) {
        m.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          const { get } = form(m);
          const data = { title: get('title').trim(), cost: U.clamp(+get('cost') || 1, 1, 99999) };
          if (r) Object.assign(r, data); else st.rewards.push(Object.assign({ id: U.uid() }, data));
          Q.store.commit('reward'); close();
        };
        const del = m.querySelector('[data-del]');
        if (del) del.onclick = () => removeWithUndo('rewards', r.id, r.title, close);
      },
    });
  }

  /* ------------------------------------------------------------ shared */
  async function removeWithUndo(coll, id, title, close) {
    const st = S();
    Q.store.snapshot();
    const item = st[coll].find((x) => x.id === id);
    if (item && item.gcalId) Q.sync.queueDelete(item.gcalId);
    st[coll] = st[coll].filter((x) => x.id !== id);
    Q.store.commit('delete');
    close && close();
    Q.ui.toast(`Deleted “${title}”`, { actions: [{ label: 'Undo', fn: () => Q.store.undo() }], timeout: 7000 });
  }

  function createFromParsed(p) {
    const st = S();
    let item;
    if (p.type === 'daily') {
      item = { id: U.uid(), createdAt: Date.now(), title: p.title, time: p.time, lead: null, schedule: p.schedule || { type: 'daily' }, difficulty: p.difficulty || 'easy', category: p.category || 'home', checklist: [], notes: '', streak: 0, best: 0, done: {}, order: st.dailies.length };
      st.dailies.push(item);
      Q.game.ensureBoss();
      Q.ui.toast(`Daily added: ${p.title}`, { kind: 'ok' });
    } else if (p.type === 'event') {
      const date = p.date || new Date();
      const allDay = !p.time;
      const s = allDay ? U.startOfDay(date).getTime() : U.at(U.ymd(date), p.time).getTime();
      const e = allDay ? s + 86400000 : p.endTime ? U.at(U.ymd(date), p.endTime).getTime() : s + 3600000;
      item = { id: U.uid(), createdAt: Date.now(), title: p.title, start: s, end: e > s ? e : s + 3600000, allDay, location: '', notes: '', color: EVENT_COLORS[0], repeat: p.repeat || 'none', gcalDirty: true };
      st.events.push(item);
      Q.ui.toast(`Event added for ${U.fmtDay(new Date(s))}`, { kind: 'ok' });
    } else {
      const due = p.date ? U.at(U.ymd(p.date), p.time || '09:00').getTime() : null;
      item = { id: U.uid(), createdAt: Date.now(), title: p.title, notes: '', due, repeat: due ? p.repeat || 'none' : 'none', lead: null, difficulty: p.difficulty || 'easy', category: p.category || 'errands', done: false, gcalDirty: true };
      st.reminders.push(item);
      Q.ui.toast(due ? `Reminder set for ${U.fmtDay(new Date(due))} ${U.fmtTime(new Date(due))}` : `Added: ${p.title}`, { kind: 'ok' });
    }
    Q.store.commit('add');
    if ((p.type !== 'daily') && st.settings.google.connected) Q.sync.syncAll();
    return item;
  }

  function open(type, id, preset) {
    if (type === 'daily') return dailyForm(id);
    if (type === 'reminder') return reminderForm(id, preset);
    if (type === 'event') return eventForm(id, preset);
    if (type === 'habit') return habitForm(id);
    if (type === 'reward') return rewardForm(id);
  }

  return { open, createFromParsed, EVENT_COLORS };
})();
