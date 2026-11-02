'use strict';
/* Settings: profile, time, notifications, calendar sync, looks, app behaviour, data. */

Q.views.settings = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;
  const P = Q.platform;
  let autostartOn = null;

  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S());
  const toggle = (path, label, hint = '') => `<label class="toggle-row"><span><b>${label}</b>${hint ? `<span class="small muted">${hint}</span>` : ''}</span>
    <input type="checkbox" class="switch" data-change="set" data-path="${path}" ${get(path) ? 'checked' : ''}></label>`;
  const select = (path, label, opts, hint = '') => `<label class="toggle-row"><span><b>${label}</b>${hint ? `<span class="small muted">${hint}</span>` : ''}</span>
    <select data-change="set" data-path="${path}" data-num="${typeof get(path) === 'number'}">${opts.map(([v, l]) => `<option value="${v}" ${String(get(path)) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;

  function google() {
    const st = S(); const g = st.settings.google;
    if (!P.isApp) {
      return `<p class="small muted">Google Calendar sync runs in the desktop app. The calendar here shows sample events.</p>`;
    }
    if (g.connected) {
      return `<div class="sync-ok">${I('check')} Connected to Google Calendar</div>
        ${g.calendars.length ? `<div class="cal-checks">${g.calendars.map((c) => `<label class="check-line"><input type="checkbox" data-change="gcal-sel" data-id="${esc(c.id)}" ${c.selected ? 'checked' : ''}><i class="dot" style="--c:${c.color}"></i>${esc(c.name)}${c.writable ? '' : ' <span class="small muted">(read-only)</span>'}</label>`).join('')}</div>` : '<p class="small muted">Calendars load on first sync.</p>'}
        ${select('settings.google.writeCalendar', 'Save new events to', [['primary', 'Primary calendar'], ...g.calendars.filter((c) => c.writable && !c.primary).map((c) => [c.id, c.name])])}
        ${toggle('settings.google.pushEvents', 'Send my events to Google', 'Events you create here appear on your phone too')}
        ${toggle('settings.google.pushReminders', 'Send reminders to Google', 'Added as 30-minute entries, without duplicate Google alerts')}
        <div class="row-btns"><button class="btn btn-small" data-act="cal-sync">${I('sync')} Sync now</button><button class="btn btn-small btn-danger-ghost" data-act="g-disconnect">Disconnect</button></div>`;
    }
    return `<p class="small">Two-way sync needs a free Google Cloud OAuth client (5 minutes, once). Steps are in the README.</p>
      <ol class="small steps"><li>Create a project at console.cloud.google.com and enable the <b>Google Calendar API</b>.</li>
      <li>OAuth consent screen: External, add yourself as a test user.</li><li>Credentials → Create OAuth client ID → <b>Desktop app</b>. Paste the ID and secret below.</li></ol>
      <label class="field"><span class="field-label">Client ID</span><input data-change="set" data-path="settings.google.clientId" value="${esc(g.clientId)}" placeholder="1234-abc.apps.googleusercontent.com" spellcheck="false"></label>
      <label class="field"><span class="field-label">Client secret</span><input data-change="set" data-path="settings.google.clientSecret" value="${esc(g.clientSecret)}" placeholder="GOCSPX-…" spellcheck="false"></label>
      <button class="btn btn-primary" data-act="g-connect" ${g.clientId ? '' : 'disabled'}>${I('calendar')} Connect Google Calendar</button>
      <p class="small muted">Your browser opens Google's sign-in. The token is stored encrypted with your Windows account and never leaves this PC except to talk to Google.</p>`;
  }

  let spWebLinked = null;
  function spotifyPanel() {
    const sp = S().settings.spotify;
    if (!P.isApp) return '<p class="small muted">The desktop app shows the official Spotify app automatically, and can also follow Spotifast or your phone after you connect your account.</p>';
    if (spWebLinked === null) P.invoke('spotify_web_status').then((v) => { spWebLinked = !!v; if (sp.webConnected !== spWebLinked) { sp.webConnected = spWebLinked; Q.store.commit('settings'); } Q.app.render(); }).catch(() => { spWebLinked = false; });
    const intro = '<p class="small">The <b>official Spotify app</b> is picked up automatically, instantly and offline. To also see and control <b>Spotifast, your phone or the web player</b>, connect your Spotify account (Premium). Questline switches between the two by itself.</p>';
    if (sp.webConnected) {
      return `${intro}<div class="sync-ok">${I('check')} Spotify account connected</div>
        <p class="small muted">When the desktop app isn't playing, Questline follows whatever your account plays and shows the device, like "on Spotifast".</p>
        <div class="row-btns"><button class="btn btn-small btn-danger-ghost" data-act="sp-web-disconnect">Disconnect</button></div>`;
    }
    const redirect = 'http://127.0.0.1:43821/callback';
    return `${intro}
      <ol class="small steps">
        <li>Open <button class="link" data-act="sp-dashboard">developer.spotify.com/dashboard</button> and log in with your Spotify account.</li>
        <li><b>Create app</b>: any name (e.g. Questline) and description. Under <b>Redirect URIs</b> add exactly:
          <span class="copy-line"><code>${redirect}</code><button class="btn btn-small" data-act="sp-copy" data-text="${redirect}">Copy</button></span>
          Tick <b>Web API</b>, accept the terms, and save.</li>
        <li>Open the app's <b>Settings</b>, copy the <b>Client ID</b> and paste it below. No secret needed.</li>
      </ol>
      <label class="field"><span class="field-label">Client ID</span><input data-change="set" data-path="settings.spotify.clientId" value="${esc(sp.clientId)}" placeholder="32 letters and numbers" spellcheck="false"></label>
      <button class="btn btn-primary" data-act="sp-web-connect" ${sp.clientId ? '' : 'disabled'}>${I('note')} Connect Spotify account</button>`;
  }

  function ics() {
    const st = S();
    return `${st.settings.ics.map((f, i) => `<div class="feed"><i class="dot" style="--c:${f.color}"></i><div class="feed-main"><b>${esc(f.name)}</b><span class="small muted">${esc(f.url.replace(/^(https?|webcal):\/\//, '').slice(0, 48))}…</span>${f.error ? `<span class="small err">${esc(f.error)}</span>` : ''}</div>
      <button class="icon-btn" data-act="ics-del" data-i="${i}" aria-label="Remove feed">${I('trash')}</button></div>`).join('')}
      <form class="ics-add" data-ics-form><input name="name" placeholder="Name (e.g. Holidays)" maxlength="40" required><input name="url" placeholder="https://… or webcal://… .ics link" required spellcheck="false">
      <button class="btn btn-small">${I('plus')} Add feed</button></form>
      <p class="small muted">Works with Google's "secret address in iCal format", Outlook "Publish calendar", iCloud public calendars, university timetables and holiday calendars. Read-only.</p>`;
  }

  function render(root) {
    const st = S(); const s = st.settings;
    if (P.isApp && autostartOn === null) P.autostart.get().then((v) => { autostartOn = !!v; Q.app.render(); }).catch(() => { autostartOn = false; });
    root.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Make it yours</div><h1 class="page-title">Settings</h1></div></div>
      <div class="settings">
        <section class="panel">
          <div class="panel-title">${I('star')} Profile</div>
          <label class="field"><span class="field-label">Your name</span><input data-change="set" data-path="profile.name" value="${esc(st.profile.name)}" maxlength="24"></label>
          <div class="row-btns"><button class="btn btn-small" data-act="go" data-view="pals">${I('paw')} Manage pals</button><button class="btn btn-small" data-act="go-shop-looks">${I('bag')} Change outfit</button></div>
        </section>

        <section class="panel">
          <div class="panel-title">${I('clock')} Day & time</div>
          ${select('settings.dayStart', 'New day starts at', [0, 1, 2, 3, 4, 5, 6].map((h) => [h, U.fmtTime(`${U.pad(h)}:00`)]), 'Night owl? Finish yesterday\'s dailies before this hour.')}
          ${toggle('settings.clock24', '24-hour clock')}
          ${select('settings.weekStart', 'Week starts on', [[1, 'Monday'], [0, 'Sunday']])}
          ${select('settings.weekendMode', 'Weekend mode', [['off', 'Off'], ['sun', 'Sundays are rest days'], ['satsun', 'Saturdays and Sundays']], 'On rest days, missed dailies cost no HP and streaks are kept. Anything you do still counts.')}
          ${toggle('settings.inn', 'Rest at the Inn', 'Sick or travelling? Missed dailies won\'t hurt and streaks are kept.')}
        </section>

        <section class="panel">
          <div class="panel-title">${I('bell')} Notifications</div>
          ${toggle('settings.notifications', 'Desktop notifications', 'Dailies, reminders and events, even with the window closed')}
          ${select('settings.defaultLead', 'Default heads-up', [[0, 'At the time only'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']])}
          ${toggle('settings.quietOn', 'Quiet hours', 'Notifications still show inside the app, silently')}
          <div class="row2 ${s.quietOn ? '' : 'dim'}"><label class="field"><span class="field-label">From</span><input type="time" data-change="set" data-path="settings.quietFrom" value="${s.quietFrom}"></label>
            <label class="field"><span class="field-label">To</span><input type="time" data-change="set" data-path="settings.quietTo" value="${s.quietTo}"></label></div>
          ${toggle('settings.muteInFocus', 'Mute during focus mode')}
          <div class="row-btns"><button class="btn btn-small" data-act="test-notify">${I('bell')} Send a test</button></div>
        </section>

        <section class="panel" id="sync">
          <div class="panel-title">${I('calendar')} Google Calendar</div>
          ${google()}
          <div class="panel-title sub">${I('sync')} Subscribed calendars (iCal)</div>
          ${ics()}
        </section>

        <section class="panel">
          <div class="panel-title">${I('sun')} Look & sound</div>
          <div class="mode-row"><span><b>Mode</b><span class="small muted">Press <kbd>D</kbd> or the moon/sun button in the title bar to switch quickly</span></span>
            <div class="seg seg-small" role="radiogroup" aria-label="Light or dark mode">${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match Windows']].map(([k, n]) => `<button class="seg-btn ${s.themeMode === k ? 'on' : ''}" data-act="set-mode" data-mode="${k}">${n}</button>`).join('')}</div></div>
          ${['light', 'dark'].map((mode) => `<div class="theme-group"><span class="field-label">${mode === 'light' ? 'Light theme' : 'Dark theme'}</span>
            <div class="skin-row">${st.owned.skins.filter((k) => Q.game.SHOP.skins[k] && Q.game.SHOP.skins[k].mode === mode).map((k) => { const sk = Q.game.SHOP.skins[k]; const on = (mode === 'dark' ? s.darkSkin : s.skin) === k; return `<button class="skin-pick ${on ? 'on' : ''}" data-act="equip-skin" data-key="${k}" title="${sk.name}">${sk.sw.map((c) => `<i style="background:${c}"></i>`).join('')}<span>${sk.name}</span></button>`; }).join('')}
              <button class="skin-pick more" data-act="go-shop-looks">${I('bag')}<span>More in Shop</span></button></div></div>`).join('')}
          ${select('settings.fontStyle', 'Font style', [['mixed', 'Pixel titles'], ['pixel', 'All pixel'], ['rounded', 'Rounded'], ['clean', 'Clean']], 'Pixel titles keeps the retro look for headings and numbers but uses a clean font for small text')}
          ${select('settings.uiScale', 'Interface size', [[90, 'Compact (90%)'], [100, 'Normal'], [110, 'Large (110%)'], [125, 'Extra large (125%)']])}
          ${toggle('settings.reducedMotion', 'Reduce motion', 'Calmer animations, static focus scenes')}
          ${toggle('settings.sounds', 'Sound effects')}
          <label class="toggle-row"><span><b>Volume</b></span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-change="set" data-path="settings.volume" data-num="true"></label>
        </section>

        <section class="panel">
          <div class="panel-title">${I('gear')} App</div>
          ${P.isApp ? `<label class="toggle-row"><span><b>Start with Windows</b><span class="small muted">Launches quietly into the tray</span></span><input type="checkbox" class="switch" data-change="autostart" ${autostartOn ? 'checked' : ''}></label>` : ''}
          ${toggle('settings.closeToTray', 'Close button hides to tray', 'Keeps reminders working. Quit from the tray menu.')}
          ${toggle('settings.confirmDelete', 'Undo bar after deleting')}
          <div class="keys"><b>Shortcuts</b>
            <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Q</kbd> quick add from anywhere${P.isApp ? '' : ' (desktop app)'}</div>
            <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> focus mode · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> show/hide</div>
            <div><kbd>N</kbd> quick add · <kbd>Ctrl</kbd>+<kbd>K</kbd> command palette · <kbd>1</kbd>–<kbd>9</kbd> pages · <kbd>F</kbd> focus · <kbd>?</kbd> help</div>
          </div>
        </section>

        <section class="panel" id="spotify">
          <div class="panel-title">${I('note')} Spotify</div>
          ${spotifyPanel()}
        </section>

        <section class="panel" id="updates">
          <div class="panel-title">${I('star')} Updates</div>
          ${Q.updates.panel()}
        </section>

        <section class="panel">
          <div class="panel-title">${I('chest')} Your data</div>
          <p class="small muted">${P.isApp ? 'Saved on this PC with a daily backup (last 14 days kept).' : 'The preview keeps data in this browser only.'}</p>
          <div class="row-btns">
            <button class="btn btn-small" data-act="export">${I('down')} Export backup</button>
            <label class="btn btn-small file-btn">${I('up')} Import backup<input type="file" accept=".json,application/json" data-change="import" hidden></label>
            ${P.isApp ? `<button class="btn btn-small" data-act="open-data">Open data folder</button>` : ''}
            <button class="btn btn-small" data-act="starter-packs">Starter packs</button>
          </div>
          <div class="row-btns"><button class="btn btn-small btn-danger-ghost" data-act="reset-all">Start over</button></div>
          <p class="small muted">Questline v${esc(Q.updates.version())} · made for you, runs offline.</p>
        </section>
      </div>`;
  }

  function bind() {
    const on = Q.ui.on;
    Q.ui.onChange('set', (el) => {
      const path = el.dataset.path.split('.');
      let o = S(); for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      const k = path[path.length - 1];
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.num === 'true' || el.type === 'range' || typeof o[k] === 'number') v = Number(v);
      o[k] = v;
      Q.store.commit('settings');
      Q.app.applySettings();
      if (el.type === 'checkbox' || el.tagName === 'SELECT') Q.app.render();
    });
    Q.ui.onChange('gcal-sel', (el) => { const c = S().settings.google.calendars.find((x) => x.id === el.dataset.id); if (c) { c.selected = el.checked; Q.store.commit('settings'); Q.sync.syncAll(); } });
    Q.ui.onChange('autostart', async (el) => { try { await P.autostart.set(el.checked); autostartOn = el.checked; Q.ui.toast(el.checked ? 'Questline will start with Windows' : 'Autostart off', { kind: 'ok' }); } catch (e) { Q.ui.toast(String(e), { kind: 'error' }); } });
    Q.ui.onChange('import', (el) => {
      const file = el.files && el.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          const data = JSON.parse(r.result);
          if (!data.hero || !data.dailies) throw new Error('Not a Questline backup');
          if (!(await Q.ui.confirm('Replace everything with this backup? Export first if you want to keep the current data.', { ok: 'Import', danger: true }))) return;
          Q.store.replace(data); Q.app.applySettings(); Q.ui.toast('Backup imported', { kind: 'ok' });
        } catch (e) { Q.ui.toast(`Couldn't import: ${e.message}`, { kind: 'error' }); }
      };
      r.readAsText(file);
    });
    on('g-connect', async (el) => {
      const g = S().settings.google;
      el.disabled = true; el.textContent = 'Waiting for Google sign-in…';
      try { await Q.sync.connectGoogle(g.clientId, g.clientSecret); Q.ui.toast('Google Calendar connected', { kind: 'ok' }); }
      catch (e) { Q.ui.toast(String(e), { kind: 'error', timeout: 9000 }); }
      Q.app.render();
    });
    on('g-disconnect', async () => { if (await Q.ui.confirm('Disconnect Google Calendar? Your local events and reminders stay.', { ok: 'Disconnect', danger: true })) { await Q.sync.disconnectGoogle(); Q.ui.toast('Disconnected'); } });
    on('ics-del', (el) => { S().settings.ics.splice(+el.dataset.i, 1); Q.store.commit('settings'); Q.sync.syncAll(); });
    document.addEventListener('submit', (e) => {
      if (!e.target.matches('[data-ics-form]')) return;
      e.preventDefault();
      const fd = new FormData(e.target);
      const url = String(fd.get('url')).trim();
      if (!/^(https|webcal):\/\//i.test(url)) return Q.ui.toast('Use an https:// or webcal:// link', { kind: 'error' });
      const colors = ['#8E6BD1', '#E879A8', '#F29A4E', '#58B368', '#7D8597'];
      S().settings.ics.push({ name: String(fd.get('name')).trim(), url, color: colors[S().settings.ics.length % colors.length], on: true });
      Q.store.commit('settings'); Q.sync.syncAll(true);
    });
    on('test-notify', async () => {
      const ok = await P.askNotifyPermission();
      if (!ok && !P.isApp) return Q.ui.toast('Notifications are blocked here. In the desktop app they always work.', { kind: 'error' });
      Q.scheduler.setExtra([{ id: `test:${Date.now()}`, at: Date.now() + 3000, title: 'Questline test', body: 'Notifications are working. Nice!', silent: false }]);
      Q.ui.toast('A test notification arrives in a few seconds');
    });
    on('sp-dashboard', () => P.openExternal('https://developer.spotify.com/dashboard'));
    on('sp-copy', (el) => {
      const t = el.dataset.text;
      navigator.clipboard.writeText(t).then(() => Q.ui.toast('Copied', { kind: 'ok' })).catch(() => Q.ui.toast(t));
    });
    on('sp-web-connect', async (el) => {
      const sp = S().settings.spotify;
      el.disabled = true; el.textContent = 'Waiting for Spotify sign-in…';
      try {
        await P.invoke('spotify_web_connect', { clientId: sp.clientId });
        sp.webConnected = true; spWebLinked = true; Q.store.commit('settings');
        Q.ui.toast('Spotify account connected', { kind: 'ok' });
        Q.spotify.refresh();
      } catch (e) { Q.ui.toast(String(e), { kind: 'error', timeout: 10000 }); }
      Q.app.render();
    });
    on('sp-web-disconnect', async () => {
      if (!(await Q.ui.confirm('Disconnect your Spotify account? The official Spotify app keeps working without it.', { ok: 'Disconnect', danger: true }))) return;
      try { await P.invoke('spotify_web_disconnect'); } catch (e) { /* already gone */ }
      S().settings.spotify.webConnected = false; spWebLinked = false; Q.store.commit('settings');
      Q.spotify.refresh();
    });
    on('export', () => Q.app.exportData());
    on('open-data', () => P.invoke('open_data_dir').catch((e) => Q.ui.toast(String(e), { kind: 'error' })));
    on('set-mode', (el) => { S().settings.themeMode = el.dataset.mode; Q.store.commit('settings'); Q.app.applySettings(); });
    on('go-shop-looks', () => { Q.views.shop.setTab('looks'); Q.app.go('shop'); });
    on('reset-all', async () => {
      if (!(await Q.ui.confirm('Erase all dailies, reminders, events and progress? A backup is exported first.', { ok: 'Erase everything', danger: true }))) return;
      await Q.app.exportData();
      Q.store.replace(Q.store.defaults()); Q.app.applySettings(); Q.app.go('home'); Q.onboarding.start();
    });
  }

  return { render, bind };
})();
