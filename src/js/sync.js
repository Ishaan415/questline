'use strict';
/*
 * Calendar data: local events, Google Calendar (two-way) and iCal feeds (read-only).
 * Reminders appear on the calendar; dailies never do.
 */

Q.sync = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const P = Q.platform;
  let syncing = false;

  const GOOGLE_COLOR = '#3C82C8';
  const LOCAL_COLOR = '#2FA58A';
  const REMINDER_COLOR = '#F29A4E';

  /* ------------------------------------------------------------ helpers */
  const gEventToItem = (ev, cal) => {
    const allDay = !!(ev.start && ev.start.date);
    const start = allDay ? U.parseYmd(ev.start.date).getTime() : new Date(ev.start.dateTime).getTime();
    const end = allDay ? U.parseYmd(ev.end.date).getTime() : new Date(ev.end.dateTime).getTime();
    return {
      id: `g:${cal.id}:${ev.id}`, remoteId: ev.id, calendarId: cal.id, source: 'google',
      title: ev.summary || '(No title)', start, end, allDay, location: ev.location || '', notes: ev.description || '',
      color: cal.color || GOOGLE_COLOR, editable: cal.writable,
    };
  };

  function expandLocal(ev, from, to) {
    const out = [];
    const dur = ev.end - ev.start;
    if (!ev.repeat || ev.repeat === 'none') {
      if (ev.end >= from && ev.start <= to) out.push(ev);
      return out;
    }
    let d = new Date(ev.start);
    for (let i = 0; i < 800 && d.getTime() <= to; i++) {
      const s = d.getTime();
      if (s + dur >= from) out.push(Object.assign({}, ev, { start: s, end: s + dur, occurrence: i }));
      if (ev.repeat === 'daily') d.setDate(d.getDate() + 1);
      else if (ev.repeat === 'weekly') d.setDate(d.getDate() + 7);
      else if (ev.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
      else d.setFullYear(d.getFullYear() + 1);
    }
    return out;
  }

  /** Everything to draw on the calendar between two timestamps. */
  function itemsBetween(from, to, { reminders = true } = {}) {
    const st = S();
    const out = [];
    for (const ev of st.events) for (const x of expandLocal(ev, from, to)) out.push(Object.assign({ source: 'local', color: LOCAL_COLOR, editable: true }, x));
    const gSel = new Set(st.settings.google.calendars.filter((c) => c.selected).map((c) => c.id));
    for (const ev of st.calCache.google) if (ev.end >= from && ev.start <= to && (gSel.size === 0 || gSel.has(ev.calendarId) || ev.demo)) out.push(ev);
    const icsOn = new Set(st.settings.ics.filter((f) => f.on !== false).map((f) => f.url));
    for (const ev of st.calCache.ics) if (ev.end >= from && ev.start <= to && icsOn.has(ev.feed)) out.push(ev);
    if (reminders && st.settings.calShowReminders) {
      for (const r of st.reminders) {
        if (!r.due || (r.done && !st.settings.showCompletedReminders && r.doneAt < from)) continue;
        if (r.due >= from && r.due <= to) {
          const allDay = Q.game.remAllDay(r);
          out.push({ id: `r:${r.id}`, reminderId: r.id, source: 'reminder', title: r.title, start: r.due, end: r.due + (allDay ? 86400000 : 30 * 60000), allDay, color: REMINDER_COLOR, done: r.done, editable: true });
        }
      }
    }
    return out.sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
  }

  /* --------------------------------------------------------------- Google */
  const g = (method, path, query, body) => P.invoke('google_api', { method, path, query: query || null, body: body || null });

  /** Sign in for sync & backups. Calendar permission is asked separately. */
  async function connectGoogle(clientId, clientSecret) {
    await P.invoke('google_connect', { clientId: clientId || null, clientSecret: clientSecret || null, calendar: false });
    const st = S();
    st.settings.google.connected = true;
    st.settings.google.syncOn = true;
    Q.store.commit('settings');
    await Q.cloud.refreshAccount();
    await Q.cloud.syncNow({ manual: true });
  }

  /** Turn Google Calendar on: asks Google for the Calendar permission only now. */
  async function connectCalendar(clientId, clientSecret) {
    const acc = Q.cloud.account();
    if (!(acc && acc.calendar)) {
      await P.invoke('google_connect', { clientId: clientId || null, clientSecret: clientSecret || null, calendar: true });
      await Q.cloud.refreshAccount();
      const now = Q.cloud.account();
      if (!(now && now.calendar)) throw new Error('Google didn\'t grant Calendar access. Turn it on again and tick both Calendar boxes.');
    }
    S().settings.google.calendarOn = true;
    Q.store.commit('settings');
    await syncAll(true);
  }

  function disconnectCalendar() {
    const st = S();
    st.settings.google.calendarOn = false;
    st.calCache.google = [];
    Q.store.commit('settings');
  }

  /** Google Calendar is used only when turned on and permitted. */
  function calendarActive() {
    const gs = S().settings.google;
    const acc = Q.cloud.account();
    return !!(gs.connected && gs.calendarOn === true && (!acc || acc.calendar));
  }

  async function disconnectGoogle() {
    try { await P.invoke('google_disconnect'); } catch (e) { /* already gone */ }
    await Q.cloud.forget();
    const st = S();
    st.settings.google.connected = false;
    st.settings.google.calendarOn = null;
    st.settings.google.calendars = [];
    st.calCache.google = [];
    Q.store.commit('settings');
  }

  async function pullGoogle() {
    const st = S();
    const gs = st.settings.google;
    const list = await g('GET', '/calendar/v3/users/me/calendarList', [['maxResults', '100']]);
    const prev = new Map(gs.calendars.map((c) => [c.id, c]));
    gs.calendars = (list.items || []).map((c) => ({
      id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || GOOGLE_COLOR,
      writable: c.accessRole === 'owner' || c.accessRole === 'writer', primary: !!c.primary,
      selected: prev.has(c.id) ? prev.get(c.id).selected : (c.primary || c.selected !== false),
    }));
    const now = Date.now();
    const timeMin = new Date(now - 45 * 86400000).toISOString();
    const timeMax = new Date(now + 120 * 86400000).toISOString();
    const items = [];
    for (const cal of gs.calendars.filter((c) => c.selected)) {
      let pageToken = null;
      let pages = 0;
      do {
        const q = [['timeMin', timeMin], ['timeMax', timeMax], ['singleEvents', 'true'], ['orderBy', 'startTime'], ['maxResults', '2500']];
        if (pageToken) q.push(['pageToken', pageToken]);
        const res = await g('GET', `/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`, q);
        for (const ev of res.items || []) {
          if (ev.status === 'cancelled' || !ev.start) continue;
          // Skip copies of our own reminders/events: they're already shown locally.
          if (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.questline) continue;
          items.push(gEventToItem(ev, cal));
        }
        pageToken = res.nextPageToken;
      } while (pageToken && ++pages < 5);
    }
    st.calCache.google = items;
  }

  /** Push local events and reminders that changed since the last sync. */
  async function pushGoogle() {
    const st = S();
    const gs = st.settings.google;
    const cal = encodeURIComponent(gs.writeCalendar || 'primary');
    const body = (title, start, end, allDay, notes, tag, location) => ({
      summary: title,
      description: notes || '',
      location: location || '',
      start: allDay ? { date: U.ymd(new Date(start)) } : { dateTime: new Date(start).toISOString() },
      end: allDay ? { date: U.ymd(new Date(Math.max(end, start + 86400000))) } : { dateTime: new Date(end).toISOString() },
      extendedProperties: { private: { questline: tag } },
      reminders: { useDefault: false, overrides: [] }, // Questline notifies you itself
    });
    const upsert = async (obj, payload) => {
      if (obj.gcalId) {
        try { await g('PATCH', `/calendar/v3/calendars/${cal}/events/${encodeURIComponent(obj.gcalId)}`, null, payload); }
        catch (e) { if (/404|410/.test(String(e))) { obj.gcalId = null; } else throw e; }
      }
      if (!obj.gcalId) {
        const res = await g('POST', `/calendar/v3/calendars/${cal}/events`, null, payload);
        obj.gcalId = res.id;
      }
      obj.gcalDirty = false;
    };
    if (gs.pushEvents) {
      for (const ev of st.events) {
        if (ev.gcalId && !ev.gcalDirty) continue;
        const payload = body(ev.title, ev.start, ev.end, ev.allDay, ev.notes, `ev:${ev.id}`, ev.location);
        if (ev.repeat && ev.repeat !== 'none') payload.recurrence = [`RRULE:FREQ=${ev.repeat.toUpperCase()}`];
        await upsert(ev, payload);
      }
    }
    if (gs.pushReminders) {
      for (const r of st.reminders) {
        if (!r.due || (r.gcalId && !r.gcalDirty)) continue;
        if (r.done && !r.gcalId) continue;
        const allDay = Q.game.remAllDay(r);
        await upsert(r, body((r.done ? '✓ ' : '') + r.title, r.due, r.due + (allDay ? 86400000 : 30 * 60000), allDay, 'Reminder from Questline', `rem:${r.id}`));
      }
    }
    // Deletions queued while offline or before connecting.
    const dels = st.calCache.pendingDeletes || [];
    while (dels.length) {
      const d = dels[0];
      try { await g('DELETE', `/calendar/v3/calendars/${encodeURIComponent(d.cal || gs.writeCalendar || 'primary')}/events/${encodeURIComponent(d.id)}`); }
      catch (e) { if (!/404|410/.test(String(e))) throw e; }
      dels.shift();
    }
  }

  /* ----------------------------------------------------------------- ICS */
  function parseIcs(text, feed, color, from, to) {
    if (!window.ICAL) throw new Error('iCal parser missing');
    const comp = new ICAL.Component(ICAL.parse(text));
    const out = [];
    const rangeEnd = ICAL.Time.fromJSDate(new Date(to), true);
    for (const ve of comp.getAllSubcomponents('vevent')) {
      const ev = new ICAL.Event(ve);
      const allDay = ev.startDate && ev.startDate.isDate;
      const push = (s, e) => {
        const start = s.toJSDate().getTime();
        const end = e ? e.toJSDate().getTime() : start + (allDay ? 86400000 : 3600000);
        if (end >= from && start <= to) out.push({ id: `i:${feed}:${ev.uid}:${start}`, source: 'ics', feed, title: ev.summary || '(No title)', start, end, allDay, location: ev.location || '', notes: ev.description || '', color, editable: false });
      };
      if (ev.isRecurring()) {
        const it = ev.iterator();
        let next; let n = 0;
        while ((next = it.next()) && n++ < 1000) {
          if (next.compare(rangeEnd) > 0) break;
          const det = ev.getOccurrenceDetails(next);
          push(det.startDate, det.endDate);
        }
      } else if (ev.startDate) {
        push(ev.startDate, ev.endDate);
      }
    }
    return out;
  }

  async function pullIcs() {
    const st = S();
    const now = Date.now();
    const from = now - 45 * 86400000; const to = now + 120 * 86400000;
    const all = [];
    for (const f of st.settings.ics) {
      try {
        const text = await P.invoke('fetch_ics', { url: f.url });
        all.push(...parseIcs(text, f.url, f.color || '#8E6BD1', from, to));
        f.error = null;
      } catch (e) { f.error = String(e); }
    }
    st.calCache.ics = all;
  }

  /* ---------------------------------------------------------------- sync */
  async function syncAll(manual = false) {
    if (P.isDemo) {
      if (manual) Q.ui.toast('Calendar sync runs in the app. The preview shows sample events.', { kind: 'info' });
      return;
    }
    if (syncing) return;
    const st = S();
    syncing = true;
    st.calCache.error = null;
    Q.store.commit('sync-start');
    try {
      if (calendarActive()) {
        await pushGoogle();
        await pullGoogle();
      }
      if (st.settings.ics.length) await pullIcs();
      st.calCache.syncedAt = Date.now();
      if (manual) Q.ui.toast('Calendar synced', { kind: 'ok' });
    } catch (e) {
      st.calCache.error = String(e);
      if (/isn't connected|rejected the saved sign-in/.test(String(e))) st.settings.google.connected = false;
      if (manual) Q.ui.toast(String(e), { kind: 'error' });
    } finally {
      syncing = false;
      Q.store.commit('sync');
    }
  }

  /** Remember remote deletions for the next sync. */
  function queueDelete(gcalId, cal) {
    if (!gcalId) return;
    const st = S();
    st.calCache.pendingDeletes = st.calCache.pendingDeletes || [];
    st.calCache.pendingDeletes.push({ id: gcalId, cal });
  }

  async function saveGoogleEvent(item, fields) {
    const payload = {
      summary: fields.title, description: fields.notes || '', location: fields.location || '',
      start: fields.allDay ? { date: U.ymd(new Date(fields.start)) } : { dateTime: new Date(fields.start).toISOString() },
      end: fields.allDay ? { date: U.ymd(new Date(Math.max(fields.end, fields.start + 86400000))) } : { dateTime: new Date(fields.end).toISOString() },
    };
    await g('PATCH', `/calendar/v3/calendars/${encodeURIComponent(item.calendarId)}/events/${encodeURIComponent(item.remoteId)}`, null, payload);
    Object.assign(item, fields);
    Q.store.commit('event');
  }
  async function deleteGoogleEvent(item) {
    await g('DELETE', `/calendar/v3/calendars/${encodeURIComponent(item.calendarId)}/events/${encodeURIComponent(item.remoteId)}`);
    const st = S();
    st.calCache.google = st.calCache.google.filter((x) => x.id !== item.id);
    Q.store.commit('event');
  }

  return {
    itemsBetween, connectGoogle, connectCalendar, disconnectCalendar, calendarActive, disconnectGoogle, syncAll, queueDelete, saveGoogleEvent, deleteGoogleEvent,
    isSyncing: () => syncing, parseIcs, LOCAL_COLOR, REMINDER_COLOR, GOOGLE_COLOR,
  };
})();
