'use strict';
/*
 * Phone layout (Android app, or the preview with ?phone).
 *   - bottom tab bar with labels: Home, Dailies, Reminders, Calendar, More
 *   - "More" sheet: your hero, Focus, Pals, Shop, Journey, Settings, light/dark, Inn
 *   - a big + button in thumb reach for quick add
 *   - dialogs open as bottom sheets (CSS, body.phone)
 *   - Android back button: closes the top sheet, then goes Home, then leaves the app
 *   - haptics and status/navigation bar colours that follow the theme
 */

Q.mobile = (() => {
  const P = Q.platform;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const on = P.isPhone;

  const TABS = [
    { k: 'home', name: 'Home', icon: 'home' },
    { k: 'dailies', name: 'Dailies', icon: 'list' },
    { k: 'reminders', name: 'Reminders', icon: 'bell' },
    { k: 'calendar', name: 'Calendar', icon: 'calendar' },
  ];
  const MORE = [
    { k: 'focus', name: 'Focus', icon: 'hourglass', act: 'focus-open' },
    { k: 'pals', name: 'Pals', icon: 'paw' },
    { k: 'shop', name: 'Shop', icon: 'bag' },
    { k: 'journey', name: 'Journey', icon: 'trophy' },
    { k: 'settings', name: 'Settings', icon: 'gear' },
  ];
  const NAMES = { home: 'Questline', dailies: 'Dailies', reminders: 'Reminders', calendar: 'Calendar', shop: 'Shop', pals: 'Pals', journey: 'Journey', settings: 'Settings' };
  /** Actions whose result already buzzes (rewards), so the tap itself stays quiet. */
  const QUIET_TAP = new Set(['daily-toggle', 'rem-done', 'habit', 'cl-toggle']);
  let moreClose = null;

  /* ---------------------------------------------------------- shell */
  function shellHtml() {
    return `
      <header class="titlebar phonebar">
        <div class="pb-title"><img class="px" src="${Q.sprites.render('sprigg')}" width="22" height="22" alt=""><span id="pb-name">Questline</span></div>
        <button class="pb-stats" id="pb-stats" data-act="go" data-view="journey" aria-label="Your hero: open Journey"></button>
        <button class="tb-btn tb-cloud cloud-off" id="tb-cloud" data-act="cloud-sync" hidden aria-label="Sync with Google Drive">${I('cloud')}</button>
        <button class="tb-btn" data-act="palette" aria-label="Search">${I('search')}</button>
      </header>
      <div class="shell">
        <main id="view" class="view" tabindex="-1"></main>
        <nav class="tabbar" aria-label="Main">
          ${TABS.map((t) => `<button class="tab" data-act="go" data-view="${t.k}" data-tab="${t.k}">${I(t.icon)}<span>${t.name}</span></button>`).join('')}
          <button class="tab" data-act="m-more" data-tab="more">${I('more')}<span>More</span></button>
        </nav>
      </div>
      <button class="fab" data-act="quick-add" aria-label="Quick add">${I('plus')}<span>Add</span></button>`;
  }

  /** After every render: highlight the tab, title the page, refresh the hero chip. */
  function update(current) {
    if (!on) return;
    const inTabs = TABS.some((t) => t.k === current);
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', inTabs ? b.dataset.tab === current : b.dataset.tab === 'more'));
    const name = document.getElementById('pb-name');
    if (name) name.textContent = NAMES[current] || 'Questline';
    const st = S();
    const stats = document.getElementById('pb-stats');
    if (stats) {
      const max = Q.game.maxHp();
      const hp = Math.ceil(st.hero.hp);
      stats.innerHTML = `<span class="${hp <= max * 0.3 ? 'low' : ''}">${I('heart')}${hp}</span><span>${I('coin')}${st.hero.gold.toLocaleString()}</span><span class="lv">Lv ${st.hero.level}</span>`;
    }
    document.body.classList.toggle('fab-hidden', current === 'settings');
  }

  /* ---------------------------------------------------------- More sheet */
  function openMore() {
    if (moreClose) return;
    const st = S();
    const dark = Q.app.effectiveMode() === 'dark';
    moreClose = Q.ui.modal({
      title: 'More', cls: 'modal-more',
      body: `<div class="side-hud more-hud" data-act="go" data-view="journey" role="button" tabindex="0">${Q.app.hudHtml()}</div>
        <div class="more-grid">${MORE.map((m) => `<button class="more-tile" data-act="${m.act || 'go'}" data-view="${m.k}">${I(m.icon)}<span>${m.name}</span></button>`).join('')}
          <button class="more-tile" data-act="toggle-mode">${I(dark ? 'sun' : 'moon')}<span>${dark ? 'Light' : 'Dark'}</span></button></div>
        <button class="btn more-inn ${st.settings.inn ? 'on' : ''}" data-act="toggle-inn">${I('moon')} ${st.settings.inn ? 'Leave the Inn' : 'Rest at the Inn'}<span class="small muted">${st.settings.inn ? 'Dailies count again' : 'Sick or away: no HP loss, streaks safe'}</span></button>`,
      onMount(m, close) {
        // Any choice in the sheet closes it (the action itself still runs).
        m.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) close(); });
      },
      onClose: () => { moreClose = null; },
    });
  }

  /* ---------------------------------------------------------- back button */
  /** Called by the Android back button. true = handled here, false = leave the app. */
  function back() {
    if (document.getElementById('preview-bar')) { Q.app.applySettings(); return true; }
    if (Q.ui.modalOpen()) { Q.ui.closeTop(); return true; }
    if (Q.focus.isOpen()) { Q.focus.close(); return true; }
    if (Q.app.current() !== 'home') { Q.app.go('home'); return true; }
    return false;
  }

  /* ---------------------------------------------------------- haptics & bars */
  function buzz(kind = 'tap') {
    if (!on || S().settings.haptics === false) return;
    P.haptic(kind);
  }

  /** Status and navigation bars take the colour of the top bar. */
  function syncBars() {
    if (!P.isAndroid) return;
    const css = getComputedStyle(document.documentElement);
    const color = (css.getPropertyValue('--panel') || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) P.setBars(color, document.documentElement.dataset.mode === 'dark');
  }

  function init() {
    if (!on) return;
    document.body.classList.add('phone');
    Q.ui.on('m-more', openMore);
    // A light tick on every button press (skipped for actions that buzz on their own).
    document.addEventListener('click', (e) => {
      const el = e.target.closest('button, [data-act], .switch, input[type=checkbox], input[type=radio]');
      if (!el || el.disabled) return;
      if (el.dataset && QUIET_TAP.has(el.dataset.act)) return;
      buzz('tap');
    }, true);
    // Notifications on Android 13+ need a one-time "Allow".
    if (P.isAndroid && S().onboarded && S().settings.notifications) P.askNotifyPermission();
  }

  return { on, init, shellHtml, update, openMore, back, buzz, syncBars };
})();
