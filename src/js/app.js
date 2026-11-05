'use strict';
/* App shell: boot, routing, sidebar HUD, global actions, shortcuts, alarms, tray, mini mode. */

Q.app = (() => {
  const U = Q.util;
  const G = Q.game;
  const P = Q.platform;
  const S = () => Q.store.state;
  const I = (n, c) => Q.sprites.icon(n, c);
  const esc = U.esc;

  const VIEWS = [
    { k: 'home', name: 'Home', icon: 'home', hash: 'home' },
    { k: 'dailies', name: 'Dailies', icon: 'list', hash: 'dailies' },
    { k: 'reminders', name: 'Reminders', icon: 'bell', hash: 'reminders' },
    { k: 'calendar', name: 'Calendar', icon: 'calendar', hash: 'calendar' },
    { k: 'focus', name: 'Focus', icon: 'hourglass', hash: null },
    { k: 'shop', name: 'Shop', icon: 'bag', hash: 'shop' },
    { k: 'pals', name: 'Pals', icon: 'paw', hash: 'pals' },
    { k: 'journey', name: 'Journey', icon: 'trophy', hash: 'journey' },
    { k: 'settings', name: 'Settings', icon: 'gear', hash: 'options' },
  ];
  let current = 'home';
  let mini = false;
  let reviewing = false;
  let renderQueued = false;
  let lastToggled = null;

  /* ---------------------------------------------------------- shell */
  function shell() {
    if (Q.mobile.on) { document.getElementById('app').innerHTML = Q.mobile.shellHtml(); return; }
    document.getElementById('app').innerHTML = `
      <header class="titlebar" data-tauri-drag-region>
        <div class="tb-brand" data-tauri-drag-region><img class="px" src="${Q.sprites.render('sprigg')}" width="20" height="20" alt="">Questline</div>
        ${P.isDemo ? '<span class="tb-demo" title="This web preview uses sample data. The desktop app starts fresh.">Preview · sample data</span>' : ''}
        <div class="tb-clock" data-tauri-drag-region id="tb-clock"></div>
        <div class="tb-actions">
          <button class="tb-btn" data-act="quick-add" title="Quick add (N)" aria-label="Quick add">${I('plus')}</button>
          <button class="tb-btn" data-act="palette" title="Command palette (Ctrl+K)" aria-label="Command palette">${I('search')}</button>
          <button class="tb-btn tb-cloud cloud-off" id="tb-cloud" data-act="cloud-sync" hidden aria-label="Sync with Google Drive">${I('cloud')}</button>
          <button class="tb-btn" data-act="toggle-mode" id="tb-mode" title="Switch light / dark (D)" aria-label="Switch light or dark mode">${I('moon')}</button>
          ${P.isWeb ? '' : `<button class="tb-btn" data-act="mini-toggle" title="Mini window" aria-label="Mini window">${I('mini')}</button>`}
          ${P.isApp ? `<span class="tb-sep"></span>
          <button class="tb-btn" data-act="win-min" aria-label="Minimize">${I('min')}</button>
          <button class="tb-btn" data-act="win-max" aria-label="Maximize">${I('max')}</button>
          <button class="tb-btn tb-close" data-act="win-close" aria-label="Close">${I('close')}</button>` : ''}
        </div>
      </header>
      <div class="shell">
        <nav class="sidebar" aria-label="Main">
          <div class="nav">${VIEWS.map((v, i) => `<button class="nav-btn" data-act="${v.k === 'focus' ? 'focus-open' : 'go'}" data-view="${v.k}" title="${v.name} (${i + 1})">${I(v.icon)}<span>${v.name}</span><kbd>${i + 1}</kbd></button>`).join('')}</div>
          <div class="side-hud" id="side-hud" data-act="go" data-view="journey" role="button" tabindex="0" title="Open your Journey: stats, badges and progress"></div>
        </nav>
        <main id="view" class="view" tabindex="-1"></main>
      </div>`;
    clock();
  }

  function sideHud() {
    const el = document.getElementById('side-hud');
    if (el) el.innerHTML = hudHtml();
  }
  /** Hero card: sidebar on PC, top of the "More" sheet on phones. */
  function hudHtml() {
    const st = S();
    return `
      <div class="sh-top">${Q.sprites.trainer(st.profile.outfit, 40)}<div><b>${esc(st.profile.name)}</b><span class="small">Lv ${st.hero.level} ${G.title(st.hero.level)}</span></div></div>
      ${Q.comp.hpBar(true)}${Q.comp.xpBar(true)}
      <div class="sh-row">${Q.comp.gold()}<span class="sh-items" title="Potions · Shields · Capsule Tickets">${I('potion')}${st.inventory.potion} ${I('shield')}${st.inventory.shield} ${I('ticket')}${st.inventory.ticket || 0}</span></div>
      ${st.settings.inn ? `<button class="inn-pill" data-act="toggle-inn">${I('moon')} Resting at the Inn</button>` : ''}`;
  }

  function clock() {
    const el = document.getElementById('tb-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = `${U.DAYS[now.getDay()]} ${now.getDate()} ${U.MONTHS[now.getMonth()]} · ${U.fmtTime(now)}`;
  }

  /* ---------------------------------------------------------- routing */
  function go(view) {
    if (view === 'focus') return Q.focus.open();
    if (!Q.views[view]) view = 'home';
    if (view !== current) document.getElementById('view').scrollTop = 0;
    current = view;
    const v = VIEWS.find((x) => x.k === view);
    try { if (v && v.hash && location.hash !== `#${v.hash}`) history.replaceState(null, '', `#${v.hash}`); } catch (e) { /* sandboxed */ }
    render();
  }

  function render() {
    renderQueued = false;
    if (mini) return renderMini();
    const root = document.getElementById('view');
    if (!root) return;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === current));
    const keep = root.scrollTop;
    try { Q.views[current].render(root); } catch (e) { console.error(e); root.innerHTML = `<div class="panel pad">Something went wrong drawing this page: ${esc(e.message)}</div>`; }
    root.scrollTop = keep;
    root.dataset.view = current;
    sideHud();
    Q.mobile.update(current);
    if (lastToggled) {
      root.querySelectorAll(`[data-id="${lastToggled}"] > .cbox.on`).forEach((b) => b.classList.add('pop'));
      lastToggled = null;
    }
  }
  const queueRender = () => { if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); } };

  /* ---------------------------------------------------------- mini mode */
  function renderMini() {
    const root = document.getElementById('view');
    const list = G.todaysDailies().sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    const now = Date.now();
    const rem = S().reminders.filter((r) => !r.done && r.due && (G.remAllDay(r) ? G.remDay(r) <= G.today() : r.due < now + 36 * 3600000)).sort((a, b) => a.due - b.due);
    root.innerHTML = `<div class="mini">
      <div class="mini-hud">${Q.comp.hpBar(true)}${Q.comp.xpBar(true)}</div>
      <div class="mini-list">${list.map((d) => Q.comp.dailyRow(d, { compact: true })).join('')}
        ${rem.length ? `<div class="tl-sub">Reminders</div>${rem.map((r) => Q.comp.reminderRow(r, { compact: true })).join('')}` : ''}</div>
      ${Q.spotify.markup('mini')}
      <button class="btn btn-small" data-act="mini-toggle">${I('expand')} Full window</button></div>`;
    Q.spotify.render();
  }
  async function toggleMini() {
    mini = !mini;
    document.body.classList.toggle('mini', mini);
    await P.win.setMini(mini);
    render();
  }

  /* ---------------------------------------------------------- settings */
  /* ---------------------------------------------------------- themes */
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveMode() {
    const m = S().settings.themeMode;
    if (m === 'auto') return darkQuery && darkQuery.matches ? 'dark' : 'light';
    return m === 'dark' ? 'dark' : 'light';
  }
  function toggleMode() {
    const s = S().settings;
    s.themeMode = effectiveMode() === 'dark' ? 'light' : 'dark';
    Q.store.commit('settings');
    applySettings();
  }
  /** Equip a theme into its light or dark slot, and show it. */
  function equipSkin(key) {
    const s = S().settings;
    const sk = G.SHOP.skins[key];
    if (!sk) return;
    if (sk.mode === 'dark') s.darkSkin = key; else s.skin = key;
    if (s.themeMode !== 'auto') s.themeMode = sk.mode;
    else if (effectiveMode() !== sk.mode) Q.ui.toast(`${sk.name} will show when your ${P.isPhone ? 'phone' : 'PC'} is in ${sk.mode} mode.`);
    Q.store.commit('settings');
    applySettings();
  }

  /* Try a theme on without buying it. Any applySettings() call ends the preview. */
  function previewSkin(key) {
    const sk = G.SHOP.skins[key];
    if (!sk) return;
    const root = document.documentElement;
    root.dataset.mode = sk.mode; root.dataset.skin = key;
    let bar = document.getElementById('preview-bar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'preview-bar'; bar.className = 'preview-bar'; document.body.appendChild(bar); }
    const owned = S().owned.skins.includes(key);
    bar.innerHTML = `<span>${I(sk.mode === 'dark' ? 'moon' : 'sun')} Previewing <b>${esc(sk.name)}</b></span>
      ${owned ? `<button class="btn btn-small btn-primary" data-pv="equip">Equip</button>` : `<button class="btn btn-small btn-primary" data-pv="buy" ${S().hero.gold < sk.price ? 'disabled' : ''}>${I('coin')} Buy · ${sk.price}</button>`}
      <button class="btn btn-small" data-pv="exit">Exit preview</button>`;
    bar.onclick = (e) => {
      const b = e.target.closest('[data-pv]'); if (!b) return;
      if (b.dataset.pv === 'buy') {
        const r = G.buy('skins', key);
        if (!r.ok) return Q.ui.toast(r.msg, { kind: 'error' });
        Q.sfx.coin(); flushGame(); equipSkin(key); Q.ui.toast(`${sk.name} is yours!`, { kind: 'ok', icon: I('bag') });
      } else if (b.dataset.pv === 'equip') equipSkin(key);
      else applySettings();
    };
  }
  function endPreview() { const bar = document.getElementById('preview-bar'); if (bar) bar.remove(); }

  function applySettings() {
    endPreview();
    const s = S().settings;
    const mode = effectiveMode();
    const root = document.documentElement;
    root.dataset.mode = mode;
    root.dataset.skin = mode === 'dark' ? (s.darkSkin || 'night') : (s.skin || 'meadow');
    root.dataset.font = s.fontStyle || 'mixed';
    const btn = document.getElementById('tb-mode');
    if (btn) btn.innerHTML = I(mode === 'dark' ? 'sun' : 'moon');
    document.documentElement.style.setProperty('--ui-scale', (s.uiScale || 100) / 100);
    document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
    P.setCloseToTray(s.closeToTray);
    Q.mobile.syncBars();
    Q.scheduler.refresh();
  }

  /* ---------------------------------------------------------- game glue */
  function flushGame() { const ev = G.flush(); if (ev.length) Q.ui.present(ev); }

  function useItem(key) {
    const r = G.useItem(key);
    if (!r.ok) return Q.ui.toast(r.msg, { kind: 'error' });
    Q.sfx.drop(); flushGame();
    Q.ui.toast(r.msg, { kind: 'ok', icon: I(G.SHOP.items[key].icon) });
  }

  function toggleInn() {
    const st = S();
    st.settings.inn = !st.settings.inn;
    Q.store.commit('inn');
    Q.ui.toast(st.settings.inn ? 'Resting at the Inn. Missed dailies won\'t hurt you and streaks are safe.' : 'You left the Inn. Dailies count again from today.', { kind: 'info', icon: I('moon') });
  }

  function pauseNotifications(min) {
    P.setNotifyPause(Date.now() + min * 60000);
    Q.ui.toast(`Notifications paused for ${U.fmtDuration(min)}`, { actions: [{ label: 'Resume', fn: () => P.setNotifyPause(0) }] });
  }

  async function exportData() {
    const json = Q.store.exportJson();
    const stamp = `${U.ymd(new Date())}-${U.pad(new Date().getHours())}${U.pad(new Date().getMinutes())}`;
    // Phones keep app files private, so they get the copy-the-text dialog instead.
    if (P.isApp && !P.isPhone) {
      try { const path = await P.invoke('export_backup', { json, stamp }); Q.ui.toast(`Backup saved to ${path}`, { kind: 'ok', timeout: 7000 }); }
      catch (e) { Q.ui.toast(String(e), { kind: 'error' }); }
      return;
    }
    // The web app: a normal download.
    if (P.isWeb) {
      try {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `questline-${stamp}.json`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        Q.ui.toast('Backup downloaded', { kind: 'ok' });
        return;
      } catch (e) { /* fall back to the copy box */ }
    }
    Q.ui.modal({
      title: 'Export backup', cls: 'modal-form',
      body: `<p class="small muted">Copy this text and save it as a .json file. Import it later in Settings.</p><textarea class="export-box" rows="10" readonly>${esc(json)}</textarea>
        <div class="modal-actions"><span class="spacer"></span><button class="btn btn-primary" data-copy>Copy</button></div>`,
      onMount(m) {
        const ta = m.querySelector('textarea');
        m.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(json).then(() => Q.ui.toast('Copied', { kind: 'ok' })).catch(() => { ta.focus(); ta.select(); });
      },
    });
  }

  /* ---------------------------------------------------------- alarms */
  function onAlarm(a) {
    const st = S();
    st.lastAlarm = a.id;
    Q.sfx.alarm();
    const [kind, id] = a.id.split(':');
    const actions = [];
    if (kind === 'r') {
      actions.push({ label: 'Done', fn: () => { G.completeReminder(id); flushGame(); } });
      actions.push({ label: 'Snooze 10m', fn: () => snooze(id, 10) });
    } else if (kind === 'd') {
      const d = st.dailies.find((x) => x.id === id);
      if (d && !G.isDone(d)) actions.push({ label: 'Done', fn: () => { lastToggled = id; G.toggleDaily(id); flushGame(); } });
    }
    Q.ui.toast(`${a.title}${a.body ? ` · ${a.body}` : ''}`, { kind: 'alarm', icon: I(kind === 'r' ? 'bell' : kind === 'd' ? 'clock' : kind === 'focus' ? 'hourglass' : 'calendar'), actions, timeout: 20000 });
  }
  function snooze(id, min) {
    const r = S().reminders.find((x) => x.id === id);
    if (!r) return;
    r.snoozedUntil = Date.now() + min * 60000;
    Q.store.commit('snooze');
    Q.ui.toast(`Snoozed “${r.title}” for ${min} minutes`);
  }

  /* ---------------------------------------------------------- rollover */
  function checkDay() {
    if (reviewing || !Q.cloud.ready()) return;
    const rv = G.checkRollover();
    if (!rv) { Q.quests.maybeShowWeekly(); return; }
    if (!rv.missed.length) { G.finalizeDay(rv, []); flushGame(); return; }
    reviewing = true;
    Q.onboarding.review(rv);
    const unwatch = Q.store.on(() => { if (S().day.last >= G.today()) { reviewing = false; unwatch(); } });
  }

  /* ---------------------------------------------------------- actions */
  function bindActions() {
    const on = Q.ui.on;
    on('go', (el) => { go(el.dataset.view); if (el.dataset.anchor) setTimeout(() => document.getElementById(el.dataset.anchor)?.scrollIntoView({ behavior: 'smooth' }), 50); });
    on('quick-add', () => Q.ui.quickAdd());
    on('palette', () => Q.ui.palette());
    on('new', (el) => Q.editors.open(el.dataset.type));
    on('edit', (el, e) => { if (e.target.closest('button')) return; Q.editors.open(el.dataset.type, el.dataset.id); });
    on('daily-toggle', (el) => { lastToggled = el.dataset.id; G.toggleDaily(el.dataset.id); flushGame(); });
    on('cl-toggle', (el) => { G.toggleCheckItem(el.dataset.id, el.dataset.item); flushGame(); });
    on('rem-done', (el) => {
      lastToggled = el.dataset.id;
      const r = S().reminders.find((x) => x.id === el.dataset.id);
      const rolled = r && r.repeat && r.repeat !== 'none';
      G.completeReminder(el.dataset.id); flushGame();
      Q.ui.toast(rolled ? `Done! Next one: ${U.fmtDay(new Date(r.due))}` : 'Reminder done', { actions: [{ label: 'Undo', fn: () => Q.store.undo() }] });
    });
    on('rem-reopen', (el) => G.reopenReminder(el.dataset.id));
    on('log-time', (el) => Q.editors.logTimeSheet(el.dataset.kind, el.dataset.id));
    on('habit', (el) => { G.habit(el.dataset.id, +el.dataset.dir); flushGame(); });
    on('use-item', (el) => useItem(el.dataset.item));
    on('toggle-inn', toggleInn);
    on('toggle-mode', toggleMode);
    on('cloud-sync', () => Q.cloud.syncNow({ manual: true }));
    on('starter-packs', () => Q.onboarding.packsModal());
    on('mini-toggle', toggleMini);
    on('win-min', () => P.win.minimize());
    on('win-max', () => P.win.toggleMax());
    on('win-close', () => (S().settings.closeToTray ? P.win.hide() : P.win.quit()));
    for (const k of Object.keys(Q.views)) Q.views[k].bind && Q.views[k].bind();
    Q.spotify.bind();
    Q.focus.bind();
    Q.updates.bind();
  }

  function helpModal() {
    Q.ui.modal({
      title: 'Keyboard shortcuts', cls: 'modal-small',
      body: `<div class="keys keys-big">
        <div><kbd>N</kbd> Quick add (type naturally: “dentist fri 3pm”)</div><div><kbd>Ctrl</kbd>+<kbd>K</kbd> Command palette & search</div>
        <div><kbd>1</kbd>–<kbd>9</kbd> Switch pages · <kbd>F</kbd> Focus mode</div><div><kbd>←</kbd> <kbd>→</kbd> <kbd>T</kbd> <kbd>M</kbd> <kbd>W</kbd> <kbd>A</kbd> Calendar navigation</div>
        <div><kbd>Space</kbd> Start/pause timer · <kbd>Esc</kbd> Leave focus</div>
        <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Q</kbd> Quick add from any app (desktop)</div></div>`,
    });
  }

  function keys(e) {
    if (e.key === 'Escape' && Q.ui.closeTop()) { e.preventDefault(); return; }
    if (e.key === 'Escape' && document.getElementById('preview-bar')) { e.preventDefault(); applySettings(); return; }
    if (Q.focus.isOpen()) { if (Q.focus.key(e)) e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!Q.ui.modalOpen()) Q.ui.palette(); return; }
    if (Q.ui.modalOpen()) return;
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); go(VIEWS[+e.key - 1].k); return; }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); Q.ui.quickAdd(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); Q.focus.open(); return; }
    if (e.key === '/') { e.preventDefault(); Q.ui.palette(); return; }
    if (e.key === '?') { e.preventDefault(); helpModal(); return; }
    if (e.key === 'd' || e.key === 'D') { if (current !== 'calendar') { e.preventDefault(); toggleMode(); return; } }
    if (current === 'calendar' && !mini && Q.views.calendar.key(e)) e.preventDefault();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
  }

  /* ---------------------------------------------------------- boot */
  async function boot() {
    if (P.isWeb && Q.web.leaving) return; // on the way to Google to renew the sign-in
    await Q.store.init();
    if (P.isWeb) await Q.web.boot();
    if (!S().onboarded && window.QUESTLINE_DEMO) Q.onboarding.demo();
    G.ensureBoss();
    applySettings();
    shell();
    Q.ui.initDelegation();
    Q.mobile.init();
    Q.widget.init();
    bindActions();
    document.addEventListener('keydown', keys);
    if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => { if (S().settings.themeMode === 'auto') applySettings(); });
    Q.store.on((reason) => { queueRender(); if (reason !== 'sync-start') Q.scheduler.refresh(); });

    const fromHash = VIEWS.find((v) => v.hash && `#${v.hash}` === location.hash);
    go(fromHash ? fromHash.k : 'home');
    window.addEventListener('hashchange', () => { const v = VIEWS.find((x) => x.hash && `#${x.hash}` === location.hash); if (v && v.k !== current) go(v.k); });

    // Pull other devices' progress before settling yesterday, so a day is never
    // settled twice (checkDay waits for Q.cloud.ready()).
    // Just signed in on a fresh browser: the first sync may bring your progress
    // in, so the welcome only shows if it doesn't.
    const waitForDrive = P.isWeb && Q.web.justSignedIn && !S().onboarded;
    Q.cloud.start().finally(() => { if (S().onboarded) checkDay(); else if (waitForDrive) Q.onboarding.start(); });
    if (!S().onboarded && !waitForDrive) Q.onboarding.start();
    if (P.isWeb) Q.web.afterStart();
    Q.scheduler.refresh();
    Q.spotify.start();
    Q.updates.init();

    // Minute tick: day rollover, live "in 5m" chips, clock, notifications horizon.
    setInterval(() => {
      clock();
      checkDay();
      Q.scheduler.refresh();
      const typing = document.activeElement && document.activeElement.matches('input, textarea, select');
      if (!Q.ui.modalOpen() && !typing && !Q.focus.isOpen() && ['home', 'dailies', 'reminders'].includes(current)) queueRender();
    }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { clock(); checkDay(); queueRender(); Q.spotify.refresh(); } });

    // Calendar sync: shortly after start, then every 10 minutes.
    setTimeout(() => Q.sync.syncAll(), 2500);
    setInterval(() => Q.sync.syncAll(), 10 * 60000);

    // Native events.
    P.listen('alarm', onAlarm);
    P.listen('tray-action', (a) => {
      if (a === 'quick-add') { Q.ui.closeTop(); Q.ui.quickAdd(); }
      else if (a === 'focus') Q.focus.open();
      else if (a === 'mini') { if (!mini) toggleMini(); }
      else if (a === 'snooze-last') { const id = S().lastAlarm; if (id && id.startsWith('r:')) snooze(id.split(':')[1], 10); }
      else if (a === 'paused') Q.ui.toast('Notifications paused for 1 hour');
      else if (a === 'resumed') { P.setNotifyPause(0); Q.ui.toast('Notifications resumed'); }
      else if (a === 'check-updates') Q.updates.check({ manual: true });
    });
    window.addEventListener('beforeunload', () => Q.store.saveNow());
    await P.ready();
    document.body.classList.add('booted');
  }

  return {
    boot, go, render, hudHtml, applySettings, equipSkin, previewSkin, toggleMode, effectiveMode, flushGame, useItem, toggleInn, pauseNotifications, exportData, toggleMini, onAlarm,
    current: () => current,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  Q.app.boot().catch((e) => {
    console.error(e);
    document.getElementById('app').innerHTML = `<div class="boot-error"><b>Questline couldn't start.</b><pre>${Q.util.esc(e.stack || e)}</pre></div>`;
    Q.platform.ready();
  });
});
