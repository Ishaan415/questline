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

  const ABOUT_LINKS = [
    ['Homepage', 'https://ishaan415.github.io/questline/'],
    ['Privacy policy', 'https://ishaan415.github.io/questline/privacy.html'],
    ['Source code', 'https://github.com/Ishaan415/questline'],
    ['Release notes', 'https://github.com/Ishaan415/questline/releases'],
  ];
  /* Third-party parts bundled into the app, with their licences. */
  const CREDITS = [
    { name: 'Tiny5', what: 'pixel font for titles and numbers', notice: 'Copyright 2022-2024 The Tiny5 Project Authors', license: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/open-font-license-official-text/' },
    { name: 'Nunito', what: 'font for text', notice: 'Copyright 2014 The Nunito Project Authors', license: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/open-font-license-official-text/' },
    { name: 'Fredoka', what: 'rounded font style', notice: 'Copyright 2016 The Fredoka Project Authors', license: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/open-font-license-official-text/' },
    { name: 'ical.js', what: 'reads iCal calendar feeds', notice: 'The ical.js contributors', license: 'Mozilla Public License 2.0', url: 'https://www.mozilla.org/en-US/MPL/2.0/' },
    { name: 'Tauri', what: 'desktop app framework, plus open-source Rust libraries', notice: 'The Tauri Programme within The Commons Conservancy', license: 'MIT / Apache-2.0', url: 'https://github.com/tauri-apps/tauri/blob/dev/LICENSE_MIT' },
  ];

  let accountAsked = false;
  let builtin = null;        // does this build have Questline's own Google client?
  let ownClient = false;     // advanced: use your own client instead
  function google() {
    const st = S(); const g = st.settings.google;
    if (P.isDemo) {
      return `<p class="small muted">Google sign-in, Drive sync and Calendar run in the app. The calendar here shows sample events.</p>`;
    }
    if (P.isWeb && !Q.web.googleReady() && !g.connected) {
      return `<p class="small muted">Google sign-in isn't set up for this web version yet. It works in the Windows and Android apps.</p>`;
    }
    if (g.connected) {
      const acc = Q.cloud.account();
      if (!acc && !accountAsked) { accountAsked = true; Q.cloud.refreshAccount().then(() => Q.app.render()); }
      const who = acc && (acc.name || acc.email) ? `<div class="acct">
          <span class="acct-av">${esc((acc.name || acc.email || '?').trim()[0].toUpperCase())}</span>
          <div class="acct-id"><b>${esc(acc.name || acc.email)}</b>${acc.name && acc.email ? `<span class="small muted">${esc(acc.email)}</span>` : ''}</div>
        </div>` : '<div class="sync-ok">' + I('check') + ' Signed in with Google</div>';
      const drive = acc && acc.drive;
      const cs = Q.cloud.status();
      const last = g.lastSync ? `Last synced ${U.rel(new Date(g.lastSync))}` : 'Not synced yet';
      return `${who}
        <div class="acct-feats">
          <span class="feat ${Q.sync.calendarActive() ? 'on' : ''}">${I('calendar')} Calendar${Q.sync.calendarActive() ? '' : ' · off'}</span>
          <span class="feat ${drive ? 'on' : ''}">${I('cloud')} Drive ${drive ? '' : '· not allowed'}</span>
        </div>
        ${acc && !drive ? `<div class="notice small">Drive sync and backups need one more permission. Sign in again and tick <b>"See, edit, create and delete only the specific Google Drive files you use with this app"</b>.
          <div class="row-btns"><button class="btn btn-small btn-primary" data-act="g-connect">${I('cloud')} Allow Drive</button></div></div>` : ''}
        ${drive ? `
          ${toggle('settings.google.syncOn', 'Sync across devices', 'Tasks, progress, pals and settings stay the same on every device signed in with this account')}
          ${toggle('settings.google.backupOn', 'Daily backup to Google Drive', 'Saved in Drive → Questline → Backups; the last 30 days are kept')}
          <div class="sync-line small ${cs.state === 'error' ? 'err' : 'muted'}">${cs.state === 'error' ? `${I('cloud')} ${esc(cs.msg)}` : cs.state === 'syncing' ? 'Syncing…' : esc(last)}</div>
          <div class="row-btns">
            <button class="btn btn-small" data-act="cloud-sync" ${g.syncOn === false ? 'disabled' : ''}>${I('sync')} Sync now</button>
            <button class="btn btn-small" data-act="cloud-backup">${I('down')} Back up now</button>
            <button class="btn btn-small" data-act="cloud-restore">${I('chest')} Restore…</button>
            <button class="btn btn-small" data-act="cloud-open">${I('expand')} Open in Drive</button>
          </div>` : ''}
        <div class="panel-title sub">${I('calendar')} Google Calendar</div>
        ${Q.sync.calendarActive() ? `
        ${g.calendars.length ? `<div class="cal-checks">${g.calendars.map((c) => `<label class="check-line"><input type="checkbox" data-change="gcal-sel" data-id="${esc(c.id)}" ${c.selected ? 'checked' : ''}><i class="dot" style="--c:${c.color}"></i>${esc(c.name)}${c.writable ? '' : ' <span class="small muted">(read-only)</span>'}</label>`).join('')}</div>` : '<p class="small muted">Calendars load on first sync.</p>'}
        ${select('settings.google.writeCalendar', 'Save new events to', [['primary', 'Primary calendar'], ...g.calendars.filter((c) => c.writable && !c.primary).map((c) => [c.id, c.name])])}
        ${toggle('settings.google.pushEvents', 'Send my events to Google', 'Events you create here appear on your phone too')}
        ${toggle('settings.google.pushReminders', 'Send reminders to Google', 'Added as 30-minute entries, without duplicate Google alerts')}
        <div class="row-btns"><button class="btn btn-small" data-act="cal-sync">${I('sync')} Sync calendar</button><button class="btn btn-small" data-act="g-calendar-off">Turn off Calendar</button></div>`
        : `<p class="small muted">Show your Google Calendar events on the Calendar page, and send events and reminders you create here to Google. Turning it on asks Google for Calendar permission (you'll see the "unverified app" screen once: Advanced → Go to Questline).</p>
        <div class="row-btns"><button class="btn btn-small btn-primary" data-act="g-calendar-on">${I('calendar')} Turn on Google Calendar</button></div>`}
        <div class="row-btns acct-out"><button class="btn btn-small btn-danger-ghost" data-act="g-disconnect">Sign out of Google</button></div>`;
    }
    if (P.isWeb) {
      return `<p class="small">Sign in to <b>sync Questline between your devices</b> and keep <b>daily backups in your Google Drive</b>. You can add <b>Google Calendar</b> afterwards.</p>
        <button class="btn btn-primary btn-google" data-act="g-connect">${I('cloud')} Sign in with Google</button>
        <p class="small muted">This page goes to Google's sign-in and comes back. Questline can only see the files it creates in your Drive, never the rest. Already use Questline on your PC or phone? Sign in with the same account and your progress comes here.</p>`;
    }
    if (builtin === null) { builtin = false; P.invoke('google_builtin').then((v) => { builtin = !!v; Q.app.render(); }).catch(() => {}); }
    const own = !builtin || ownClient;
    return `<p class="small">Sign in to <b>sync Questline between your devices</b> and keep <b>daily backups in your Google Drive</b>. You can add <b>Google Calendar</b> afterwards.</p>
      ${own ? `${builtin ? '' : '<p class="small muted">This build has no Google sign-in built in, so it needs your own Google Cloud app (steps in the README).</p>'}
      <label class="field"><span class="field-label">Client ID</span><input data-change="set" data-path="settings.google.clientId" value="${esc(g.clientId)}" placeholder="1234-abc.apps.googleusercontent.com" spellcheck="false"></label>
      <label class="field"><span class="field-label">Client secret</span><input data-change="set" data-path="settings.google.clientSecret" value="${esc(g.clientSecret)}" placeholder="GOCSPX-…" spellcheck="false"></label>` : ''}
      <button class="btn btn-primary btn-google" data-act="g-connect" ${own && !g.clientId ? 'disabled' : ''}>${I('cloud')} Sign in with Google</button>
      <p class="small muted">${P.isAndroid ? 'Google\'s account picker opens: pick your account and allow access. Questline can only see the files it creates in your Drive, never the rest. No password is stored; Android renews access by itself.' : 'Your browser opens Google\'s account chooser: pick your account and allow access. Questline can only see the files it creates in your Drive, never the rest. The sign-in is stored encrypted on this device.'}</p>
      ${builtin && !P.isAndroid ? `<button class="link small" data-act="g-own">${ownClient ? 'Use Questline\'s built-in sign-in' : 'Advanced: use my own Google Cloud app'}</button>` : ''}`;
  }

  /** The web app: links to the Windows and Android apps, which can do more. */
  function getApps() {
    const win = 'https://github.com/Ishaan415/questline/releases/latest';
    const apk = 'https://github.com/Ishaan415/questline/releases/latest/download/Questline-android.apk';
    return `<div class="get-apps">
        <p class="small"><b>Get the apps.</b> They add notifications when Questline is closed, the Android home-screen widget and, on Windows, the tray and quick add from anywhere. Sign in with the same Google account and they share your progress with this page.</p>
        <div class="row-btns">
          <button class="btn btn-small" data-act="open-url" data-url="${win}">${I('down')} Download for Windows</button>
          <button class="btn btn-small" data-act="open-url" data-url="${apk}">${I('down')} Download for Android</button>
        </div>
        ${P.isIos ? '<p class="small muted">On iPhone and iPad, add this page to your Home Screen instead: Share → Add to Home Screen.</p>' : ''}
      </div>`;
  }

  let spWebLinked = null;
  function spotifyPanel() {
    const sp = S().settings.spotify;
    if (P.isDemo) return '<p class="small muted">The desktop app shows the official Spotify app automatically, and can also follow Spotifast or your phone after you connect your account.</p>';
    if (spWebLinked === null) P.invoke('spotify_web_status').then((v) => { spWebLinked = !!v; if (sp.webConnected !== spWebLinked) { sp.webConnected = spWebLinked; Q.store.commit('settings'); } Q.app.render(); }).catch(() => { spWebLinked = false; });
    const intro = P.isWeb ? '<p class="small">Connect your Spotify account (Premium) to see and control what plays in <b>Spotify, Spotifast or on your phone</b>, right here and in focus mode.</p>' : '<p class="small">The <b>official Spotify app</b> is picked up automatically, instantly and offline. To also see and control <b>Spotifast, your phone or the web player</b>, connect your Spotify account (Premium). Questline switches between the two by itself.</p>';
    if (sp.webConnected) {
      return `${intro}<div class="sync-ok">${I('check')} Spotify account connected</div>
        <p class="small muted">${P.isWeb ? 'Questline follows whatever your account plays and shows the device, like "on Spotifast".' : 'When the desktop app isn\'t playing, Questline follows whatever your account plays and shows the device, like "on Spotifast".'}</p>
        <div class="row-btns"><button class="btn btn-small btn-danger-ghost" data-act="sp-web-disconnect">Disconnect</button></div>`;
    }
    const redirect = P.isWeb ? Q.web.spotifyRedirect : 'http://127.0.0.1:43821/callback';
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
      <p class="small muted">Works with Google's "secret address in iCal format", Outlook "Publish calendar", iCloud public calendars, university timetables and holiday calendars. Read-only.</p>
      ${P.isWeb ? '<p class="small muted">In the browser, only feeds whose server allows web pages to read them can load; many don\'t (Google\'s secret address doesn\'t). For those, use Google Calendar above or the apps.</p>' : ''}`;
  }

  function render(root) {
    const st = S(); const s = st.settings;
    if (P.isApp && !P.isPhone && autostartOn === null) P.autostart.get().then((v) => { autostartOn = !!v; Q.app.render(); }).catch(() => { autostartOn = false; });
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
          ${toggle('settings.notifications', P.isPhone || P.isWeb ? 'Notifications' : 'Desktop notifications', P.isWeb ? 'Dailies, reminders and events while Questline is open in a tab. The apps also notify when closed.' : P.isPhone ? 'Dailies, reminders and events, even when Questline is closed' : 'Dailies, reminders and events, even with the window closed')}
          ${select('settings.defaultLead', 'Default heads-up', [[0, 'At the time only'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']])}
          ${toggle('settings.quietOn', 'Quiet hours', 'Notifications still show inside the app, silently')}
          <div class="row2 ${s.quietOn ? '' : 'dim'}"><label class="field"><span class="field-label">From</span><input type="time" data-change="set" data-path="settings.quietFrom" value="${s.quietFrom}"></label>
            <label class="field"><span class="field-label">To</span><input type="time" data-change="set" data-path="settings.quietTo" value="${s.quietTo}"></label></div>
          ${toggle('settings.muteInFocus', 'Mute during focus mode')}
          <div class="row-btns"><button class="btn btn-small" data-act="test-notify">${I('bell')} Send a test</button></div>
        </section>

        <section class="panel" id="sync">
          <div class="panel-title">${I('cloud')} Google account</div>
          ${google()}
          <div class="panel-title sub">${I('sync')} Subscribed calendars (iCal)</div>
          ${ics()}
        </section>

        <section class="panel">
          <div class="panel-title">${I('sun')} Look & sound</div>
          <div class="mode-row"><span><b>Mode</b><span class="small muted">${P.isPhone ? 'Also under More at the bottom right' : 'Press <kbd>D</kbd> or the moon/sun button in the title bar to switch quickly'}</span></span>
            <div class="seg seg-small" role="radiogroup" aria-label="Light or dark mode">${[['light', 'Light'], ['dark', 'Dark'], ['auto', P.isPhone ? 'Match phone' : P.isWeb ? 'Match device' : 'Match Windows']].map(([k, n]) => `<button class="seg-btn ${s.themeMode === k ? 'on' : ''}" data-act="set-mode" data-mode="${k}">${n}</button>`).join('')}</div></div>
          ${['light', 'dark'].map((mode) => `<div class="theme-group"><span class="field-label">${mode === 'light' ? 'Light theme' : 'Dark theme'}</span>
            <div class="skin-row">${st.owned.skins.filter((k) => Q.game.SHOP.skins[k] && Q.game.SHOP.skins[k].mode === mode).map((k) => { const sk = Q.game.SHOP.skins[k]; const on = (mode === 'dark' ? s.darkSkin : s.skin) === k; return `<button class="skin-pick ${on ? 'on' : ''}" data-act="equip-skin" data-key="${k}" title="${sk.name}">${sk.sw.map((c) => `<i style="background:${c}"></i>`).join('')}<span>${sk.name}</span></button>`; }).join('')}
              <button class="skin-pick more" data-act="go-shop-looks">${I('bag')}<span>More in Shop</span></button></div></div>`).join('')}
          ${select('settings.fontStyle', 'Font style', [['mixed', 'Pixel titles'], ['pixel', 'All pixel'], ['rounded', 'Rounded'], ['clean', 'Clean']], 'Pixel titles keeps the retro look for headings and numbers but uses a clean font for small text')}
          ${select('settings.uiScale', 'Interface size', [[90, 'Compact (90%)'], [100, 'Normal'], [110, 'Large (110%)'], [125, 'Extra large (125%)']])}
          ${toggle('settings.reducedMotion', 'Reduce motion', 'Calmer animations, static focus scenes')}
          ${toggle('settings.sounds', 'Sound effects')}
          ${P.isPhone ? toggle('settings.haptics', 'Vibration', 'A light buzz on taps, completed tasks and damage') : ''}
          <label class="toggle-row"><span><b>Volume</b></span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-change="set" data-path="settings.volume" data-num="true"></label>
        </section>

        <section class="panel">
          <div class="panel-title">${I('gear')} App</div>
          ${P.isWeb ? getApps() : ''}
          ${P.isApp && !P.isPhone ? `<label class="toggle-row"><span><b>Start with Windows</b><span class="small muted">Launches quietly into the tray</span></span><input type="checkbox" class="switch" data-change="autostart" ${autostartOn ? 'checked' : ''}></label>` : ''}
          ${P.isPhone || !P.isApp ? '' : toggle('settings.closeToTray', 'Close button hides to tray', 'Keeps reminders working. Quit from the tray menu.')}
          ${toggle('settings.confirmDelete', 'Undo bar after deleting')}
          ${P.isPhone ? '' : `<div class="keys"><b>Shortcuts</b>
            ${P.isWeb ? '' : `<div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Q</kbd> quick add from anywhere${P.isApp ? '' : ' (desktop app)'}</div>
            <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> focus mode · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> show/hide</div>`}
            <div><kbd>N</kbd> quick add · <kbd>Ctrl</kbd>+<kbd>K</kbd> command palette · <kbd>1</kbd>–<kbd>9</kbd> pages · <kbd>F</kbd> focus · <kbd>?</kbd> help</div>
          </div>`}
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
          <p class="small muted">${P.isApp ? `Saved on this ${P.deviceName} with a daily backup (last 14 days kept).` : P.isWeb ? `Saved in this browser. Browsers can clear site data, so sign in with Google to keep a copy in your Drive${P.isIos ? ', and on iPhone add Questline to your Home Screen' : ''}.` : 'The preview keeps data in this browser only.'}</p>
          <div class="row-btns">
            <button class="btn btn-small" data-act="export">${I('down')} Export backup</button>
            <label class="btn btn-small file-btn">${I('up')} Import backup<input type="file" accept=".json,application/json" data-change="import" hidden></label>
            ${P.isApp && !P.isPhone ? `<button class="btn btn-small" data-act="open-data">Open data folder</button>` : ''}
            <button class="btn btn-small" data-act="starter-packs">Starter packs</button>
          </div>
          <div class="row-btns"><button class="btn btn-small btn-danger-ghost" data-act="reset-all">Start over</button></div>
          <p class="small muted">Questline v${esc(Q.updates.version())} · made for you, runs offline.</p>
        </section>

        <section class="panel" id="about">
          <div class="panel-title">${I('list')} About & licences</div>
          <p class="small">Questline is a personal, open-source project. It has no servers: your data stays on this device and, if you sign in, in your own Google Drive.</p>
          <div class="row-btns">
            ${ABOUT_LINKS.map(([label, url]) => `<button class="btn btn-small" data-act="open-url" data-url="${esc(url)}">${esc(label)}</button>`).join('')}
          </div>
          <div class="panel-title sub">${I('star')} Made with</div>
          <ul class="credits small">${CREDITS.map((c) => `<li><b>${esc(c.name)}</b> · ${esc(c.what)}<br><span class="muted">${esc(c.notice)}</span> · <button class="link small" data-act="open-url" data-url="${esc(c.url)}">${esc(c.license)}</button></li>`).join('')}</ul>
          <p class="small muted">The full licence texts are included with the app (src/fonts/*-OFL.txt and src/vendor/ical.LICENSE in the source code). All sprites, pals and bosses are original artwork made for Questline.</p>
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
          if (!(await Q.ui.confirm(`Replace everything with this backup (${Q.cloud.summary(data)})? ${Q.cloud.canDrive() ? 'Your current progress is backed up to Drive first, and your other devices get the backup too.' : 'Export first if you want to keep the current data.'}`, { ok: 'Import', danger: true }))) return;
          await Q.cloud.importSave(data);
          Q.ui.toast(`Backup imported: ${Q.cloud.summary(data)}`, { kind: 'ok' });
        } catch (e) { Q.ui.toast(`Couldn't import: ${e.message}`, { kind: 'error' }); }
      };
      r.readAsText(file);
    });
    on('g-connect', async (el) => {
      const g = S().settings.google;
      el.disabled = true; el.textContent = 'Waiting for Google sign-in…';
      const mine = !builtin || ownClient;
      try { await Q.sync.connectGoogle(mine ? g.clientId : '', mine ? g.clientSecret : ''); Q.ui.toast('Signed in with Google', { kind: 'ok' }); }
      catch (e) { Q.ui.toast(String(e), { kind: 'error', timeout: 9000 }); }
      Q.app.render();
    });
    on('g-disconnect', async () => { if (await Q.ui.confirm('Sign out of Google on this device? Sync and backups stop here; your progress on this device and in Drive stays.', { ok: 'Sign out', danger: true })) { await Q.sync.disconnectGoogle(); accountAsked = false; Q.ui.toast('Signed out'); } });
    on('g-own', () => { ownClient = !ownClient; Q.app.render(); });
    on('open-url', (el) => P.openExternal(el.dataset.url));
    on('g-calendar-on', async (el) => {
      const g = S().settings.google; const mine = !builtin || ownClient;
      el.disabled = true; el.textContent = 'Waiting for Google…';
      try { await Q.sync.connectCalendar(mine ? g.clientId : '', mine ? g.clientSecret : ''); Q.ui.toast('Google Calendar is on', { kind: 'ok', icon: I('calendar') }); }
      catch (e) { Q.ui.toast(String(e), { kind: 'error', timeout: 9000 }); }
      Q.app.render();
    });
    on('g-calendar-off', async () => {
      if (!(await Q.ui.confirm('Stop showing and syncing Google Calendar? Your Questline events and reminders stay. To remove the permission completely, use myaccount.google.com/permissions.', { ok: 'Turn off' }))) return;
      Q.sync.disconnectCalendar(); Q.ui.toast('Google Calendar turned off');
    });
    on('cloud-backup', () => Q.cloud.backupNow());
    on('cloud-open', () => P.openExternal(Q.cloud.driveFolderUrl()));
    on('cloud-restore', async () => {
      let list = [];
      Q.ui.toast('Reading your backups…', { timeout: 2500 });
      try { list = await Q.cloud.listBackups(); } catch (e) { return Q.ui.toast(String(e), { kind: 'error' }); }
      if (!list.length) return Q.ui.toast('No backups in Drive yet. Use "Back up now" first.');
      const label = (n) => {
        const m = n.match(/^questline-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2}))?(?:-([a-z-]+))?\.json$/);
        return m ? `${m[1]}${m[2] ? ` ${m[2]}:${m[3]}` : ''}${m[4] ? ` · ${m[4].replace(/-/g, ' ')}` : ''}` : n;
      };
      Q.ui.modal({
        title: 'Restore a backup', cls: 'modal-form',
        body: `<p class="small muted">Brings back your dailies, reminders, habits, events, progress and pals, plus that device's look & sound. It replaces your progress on every device; your current progress is backed up first.</p>
          <div class="backup-list">${list.map((f) => `<button class="backup-row ${f.items === 0 ? 'empty' : ''}" data-id="${esc(f.id)}"><b>${esc(label(f.name))}</b><span class="small">${esc(f.summary)}${f.items === 0 ? ' · empty' : ''}</span><span class="small muted">${esc(new Date(f.modifiedTime).toLocaleString())}${f.device ? ` · from ${esc(f.device)}` : ''}</span></button>`).join('')}</div>`,
        onMount(m, close) {
          m.querySelectorAll('[data-id]').forEach((b) => {
            b.onclick = async () => {
              if (!(await Q.ui.confirm(`Restore ${b.querySelector('b').textContent}? This replaces your current progress on all devices.`, { ok: 'Restore', danger: true }))) return;
              close();
              try { const d = await Q.cloud.restore(b.dataset.id); Q.ui.toast(`Backup restored: ${Q.cloud.summary(d)}`, { kind: 'ok', timeout: 6000 }); }
              catch (e) { Q.ui.toast(String(e), { kind: 'error', timeout: 8000 }); }
            };
          });
        },
      });
    });
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
      if (!ok && !P.isApp) return Q.ui.toast(P.isWeb && P.isIos ? 'On iPhone, add Questline to your Home Screen first (Share → Add to Home Screen), then turn notifications on there.' : 'Notifications are blocked for this page. Allow them in your browser\'s site settings. The apps always show them.', { kind: 'error', timeout: 9000 });
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
      // The sync "base" belongs to the old save: drop it, or signing in again would sync the empty save over Drive.
      await Q.cloud.dropBase();
      Q.store.replace(Q.store.defaults()); Q.app.applySettings(); Q.app.go('home'); Q.onboarding.start();
    });
  }

  return { render, bind };
})();
