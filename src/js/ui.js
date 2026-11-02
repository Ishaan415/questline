'use strict';
/* UI toolkit: event delegation, dialogs, toasts, reward pop-ups, command palette, quick add. */

Q.ui = (() => {
  const U = Q.util;
  const I = (n, c) => Q.sprites.icon(n, c);
  const handlers = {};
  const changeHandlers = {};
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let modalStack = [];

  /* ---------- delegation ---------- */
  function on(act, fn) { handlers[act] = fn; }
  function onChange(act, fn) { changeHandlers[act] = fn; }
  function initDelegation() {
    document.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; Q.sfx.unlock(); }, true);
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const fn = handlers[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
    const ch = (e) => {
      const el = e.target.closest('[data-change]');
      if (!el) return;
      const fn = changeHandlers[el.dataset.change];
      if (fn) fn(el, e);
    };
    document.addEventListener('change', ch);
    document.addEventListener('input', (e) => { if (e.target.closest('[data-live]')) ch(e); });
  }

  /* ---------- modals ---------- */
  function modal({ title, body, cls = '', onMount, onClose, dismissable = true }) {
    const root = document.getElementById('modals');
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${U.esc(title || 'Dialog')}">
        ${title ? `<div class="modal-head"><h2>${U.esc(title)}</h2>${dismissable ? `<button class="icon-btn" data-close aria-label="Close">${I('close')}</button>` : ''}</div>` : ''}
        <div class="modal-body">${body}</div>
      </div>`;
    root.appendChild(wrap);
    const close = (result) => {
      if (!wrap.isConnected) return;
      wrap.classList.add('leaving');
      setTimeout(() => wrap.remove(), 140);
      modalStack = modalStack.filter((m) => m !== entry);
      onClose && onClose(result);
    };
    const entry = { wrap, close, dismissable };
    modalStack.push(entry);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && dismissable) close(); });
    wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
    onMount && onMount(wrap.querySelector('.modal'), close);
    const first = wrap.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), select, textarea, button.btn-primary');
    setTimeout(() => first && first.focus(), 30);
    Q.sfx.open();
    return close;
  }
  const closeTop = () => { const m = modalStack[modalStack.length - 1]; if (m && m.dismissable) { m.close(); return true; } return false; };
  const modalOpen = () => modalStack.length > 0;

  function confirm(text, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      modal({
        title, cls: 'modal-small',
        body: `<p class="dialog-text">${U.esc(text)}</p>
          <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${U.esc(ok)}</button></div>`,
        onMount(m, close) {
          m.querySelector('[data-yes]').onclick = () => { answered = true; close(); resolve(true); };
          m.querySelector('[data-no]').onclick = () => { answered = true; close(); resolve(false); };
        },
        onClose: () => { if (!answered) resolve(false); },
      });
    });
  }

  /* ---------- toasts ---------- */
  function toast(text, { kind = 'info', icon, actions = [], timeout = 4200 } = {}) {
    const root = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.setAttribute('role', 'status');
    t.innerHTML = `${icon ? `<span class="toast-ico">${icon}</span>` : ''}<span class="toast-text">${U.esc(text)}</span>
      ${actions.map((a, i) => `<button class="toast-btn" data-i="${i}">${U.esc(a.label)}</button>`).join('')}
      <button class="toast-x" aria-label="Dismiss">${I('close')}</button>`;
    root.appendChild(t);
    const kill = () => { t.classList.add('leaving'); setTimeout(() => t.remove(), 180); };
    t.querySelector('.toast-x').onclick = kill;
    t.querySelectorAll('.toast-btn').forEach((b) => b.addEventListener('click', () => { actions[+b.dataset.i].fn(); kill(); }));
    if (timeout) setTimeout(kill, timeout);
    while (root.children.length > 4) root.firstChild.remove();
    return kill;
  }

  function float(text, cls = 'xp', pos = lastPointer) {
    if (Q.store.state.settings.reducedMotion) return;
    const f = document.createElement('div');
    f.className = `floater floater-${cls}`;
    f.textContent = text;
    f.style.left = `${pos.x}px`; f.style.top = `${pos.y}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }

  function shake() {
    if (Q.store.state.settings.reducedMotion) return;
    const app = document.getElementById('app');
    app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake');
  }

  /* ---------- game event presentation ---------- */
  function present(events) {
    const st = Q.store.state;
    let floatY = 0;
    for (const e of events) {
      switch (e.type) {
        case 'reward': {
          const p = { x: lastPointer.x, y: lastPointer.y - floatY };
          float(`+${e.xp} XP`, 'xp', p);
          setTimeout(() => float(`+${e.gold} G`, 'gold', { x: p.x + 46, y: p.y + 6 }), 120);
          if (e.onTime) setTimeout(() => float('On time!', 'ontime', { x: p.x - 10, y: p.y - 26 }), 200);
          floatY += 22;
          Q.sfx.complete(); setTimeout(Q.sfx.coin, 90);
          if (e.bossDmg) setTimeout(() => document.querySelectorAll('.boss-sprite').forEach((b) => { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); }), 50);
          break;
        }
        case 'uncheck': Q.sfx.uncheck(); break;
        case 'hurt': Q.sfx.hurt(); shake(); if (!e.rollover) float(`−${e.dmg} HP`, 'hurt'); break;
        case 'drop':
          setTimeout(() => { Q.sfx.drop(); toast(e.drop.text, { kind: 'drop', icon: I(e.drop.item === 'gold' ? 'coin' : Q.game.SHOP.items[e.drop.item].icon) }); }, 350);
          break;
        case 'perfect':
          setTimeout(() => toast('Every daily done today! Perfect-day bonus arrives tomorrow.', { kind: 'ok', icon: I('star') }), 400);
          break;
        case 'badge':
          setTimeout(() => {
            Q.sfx.victory();
            toast(`${e.ach.badge ? 'Badge earned' : 'Achievement'}: ${e.ach.name}`, { kind: 'badge', icon: badgeIcon(e.ach, 18), timeout: 6000 });
          }, 700);
          break;
        case 'levelup':
          setTimeout(() => {
            Q.sfx.levelup();
            modal({
              cls: 'modal-celebrate', dismissable: true,
              body: `<div class="celebrate">
                <div class="burst"></div>
                ${Q.sprites.trainer(st.profile.outfit, 96, 'bounce')}
                <div class="big-title">LEVEL UP!</div>
                <p>You reached <b>level ${e.level}</b>${Q.game.title(e.level) !== Q.game.title(e.level - 1) ? ` and earned the title <b>${Q.game.title(e.level)}</b>` : ''}.</p>
                <p class="muted">HP fully restored · +${e.bonus} gold</p>
                <button class="btn btn-primary" data-close>Onward!</button></div>`,
            });
          }, 500);
          break;
        case 'evolve':
          setTimeout(() => {
            Q.sfx.victory();
            const c = st.companion;
            modal({
              cls: 'modal-celebrate',
              body: `<div class="celebrate">
                <div class="evolve-stage">${Q.sprites.companion(c.species, e.stage - 1, 96, 'evolve-from')}${Q.sprites.companion(c.species, e.stage, 96, 'evolve-to')}</div>
                <div class="big-title">What's this?</div>
                <p><b>${U.esc(c.name)}</b> grew into its <b>${Q.game.STAGE_NAMES[e.stage]}</b> form!</p>
                <button class="btn btn-primary" data-close>Amazing</button></div>`,
            });
          }, 900);
          break;
        case 'boss':
          setTimeout(() => {
            Q.sfx.victory();
            modal({
              cls: 'modal-celebrate',
              body: `<div class="celebrate">${Q.sprites.boss(st.boss.id, 96, 'defeated')}
                <div class="big-title">Victory!</div>
                <p>You defeated <b>${U.esc(e.name)}</b>.</p>
                <p class="muted">+${e.gold} gold · +40 XP · ${Q.game.SHOP.items[e.item].name}</p>
                <button class="btn btn-primary" data-close>Collect loot</button></div>`,
            });
          }, 600);
          break;
        case 'faint':
          setTimeout(() => {
            modal({
              cls: 'modal-celebrate modal-faint', title: '',
              body: `<div class="celebrate">${Q.sprites.companion(st.companion.species, Q.game.companionStage(), 80)}
                <div class="big-title faint-title">You fainted…</div>
                <p>${U.esc(st.companion.name)} carried you back to the Inn. You dropped <b>${e.lost} gold</b> on the way, but your levels, streak records and items are safe.</p>
                <p class="muted">Tip: fewer, realistic dailies beat a long list. You can also rest at the Inn when you're sick or travelling.</p>
                <button class="btn btn-primary" data-close>Try again</button></div>`,
            });
          }, 300);
          break;
        default: break;
      }
    }
  }

  function badgeIcon(ach, size = 40) {
    const col = ach.badge || '#A3A8B5';
    return `<svg class="badge-svg" width="${size}" height="${size}" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true">
      <path d="M3 0h4v1h1v1h1v1h1v4h-1v1h-1v1h-1v1h-4v-1h-1v-1h-1v-1h-1v-4h1v-1h1v-1h1z" fill="#23343B"/>
      <path d="M3 1h4v1h1v1h1v4h-1v1h-1v1h-4v-1h-1v-1h-1v-4h1v-1h1z" fill="${col}"/>
      <path d="M3 2h2v1h-1v1h-1v1h-1v-2h1z" fill="#FFFFFF" opacity=".6"/>
      <path d="M4 4h2v2h-2z" fill="#FFFDF4"/></svg>`;
  }

  /* ---------- quick add ---------- */
  function quickAdd(prefill = '') {
    let parsed = null;
    modal({
      title: 'Quick add', cls: 'modal-quick',
      body: `
        <div class="qa-input-row">${I('plus')}<input id="qa-input" class="qa-input" autocomplete="off" spellcheck="false" placeholder="Book tickets for the show fri 10am" value="${U.esc(prefill)}"></div>
        <div class="qa-preview" id="qa-preview"></div>
        <div class="qa-help">
          <div><kbd>every mon wed 7pm</kbd> makes a daily · <kbd>event: lunch thu 1-2pm</kbd> makes an event</div>
          <div><kbd>!h</kbd> hard · <kbd>#study</kbd> category · <kbd>in 2 hours</kbd> · <kbd>12/11</kbd> or <kbd>nov 12</kbd></div>
          <div><kbd>Tab</kbd> switches type · <kbd>Enter</kbd> saves · <kbd>Shift+Enter</kbd> saves and opens details</div>
        </div>`,
      onMount(m, close) {
        const inp = m.querySelector('#qa-input');
        const prev = m.querySelector('#qa-preview');
        let forced = null;
        const update = () => {
          parsed = Q.nlp.parse(inp.value);
          if (forced) { parsed.type = forced; if (forced === 'daily' && !parsed.schedule) parsed.schedule = { type: 'daily' }; }
          const chips = Q.nlp.describe(parsed);
          prev.innerHTML = inp.value.trim()
            ? `<span class="qa-title">${U.esc(parsed.title || '…')}</span>${chips.map((c) => `<span class="chip chip-${c.k}">${U.esc(c.v)}</span>`).join('')}`
            : '<span class="muted">Type what you need to do. Dates and times are understood.</span>';
        };
        inp.addEventListener('input', update);
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const order = ['reminder', 'daily', 'event'];
            forced = order[(order.indexOf(parsed.type) + 1) % 3];
            update();
          }
          if (e.key === 'Enter' && parsed && parsed.title) {
            e.preventDefault();
            const item = Q.editors.createFromParsed(parsed);
            close();
            if (e.shiftKey) Q.editors.open(parsed.type, item.id);
          }
        });
        update();
      },
    });
  }

  /* ---------- command palette ---------- */
  function commands() {
    const st = Q.store.state;
    const go = (v) => () => Q.app.go(v);
    const list = [
      ['Go to Home', 'home', go('home'), '1'], ['Go to Dailies', 'list', go('dailies'), '2'], ['Go to Reminders', 'bell', go('reminders'), '3'],
      ['Go to Calendar', 'calendar', go('calendar'), '4'], ['Open Focus mode', 'hourglass', () => Q.focus.open(), '5'], ['Go to Shop', 'bag', go('shop'), '6'],
      ['Go to Journey', 'trophy', go('journey'), '7'], ['Go to Settings', 'gear', go('settings'), '8'],
      ['Quick add…', 'plus', () => quickAdd(), 'N'], ['New daily', 'list', () => Q.editors.open('daily')], ['New reminder', 'bell', () => Q.editors.open('reminder')],
      ['New calendar event', 'calendar', () => Q.editors.open('event')], ['New habit', 'up', () => Q.editors.open('habit')],
      ['Start 25-minute focus', 'hourglass', () => Q.focus.open({ autostart: true })],
      [st.settings.inn ? 'Leave the Inn (resume dailies)' : 'Rest at the Inn (pause damage)', 'moon', () => Q.app.toggleInn()],
      ['Sync calendars now', 'sync', () => Q.sync.syncAll(true)],
      ['Use a Potion', 'potion', () => Q.app.useItem('potion')], [`Feed ${st.companion.name} a Berry`, 'berry', () => Q.app.useItem('berry')],
      ['Mini window', 'mini', () => Q.app.toggleMini()],
      ['Pause notifications for 1 hour', 'snooze', () => Q.app.pauseNotifications(60)],
      ['Export backup', 'chest', () => Q.app.exportData()],
    ];
    for (const d of st.dailies.filter((x) => !x.archived)) list.push([`Daily: ${d.title}`, 'list', () => Q.editors.open('daily', d.id)]);
    for (const r of st.reminders.filter((x) => !x.done)) list.push([`Reminder: ${r.title}`, 'bell', () => Q.editors.open('reminder', r.id)]);
    return list;
  }

  function palette() {
    let sel = 0; let items = [];
    modal({
      cls: 'modal-palette', title: '',
      body: `<div class="qa-input-row">${I('search')}<input id="pal-input" class="qa-input" placeholder="Type a command or search your tasks" autocomplete="off"></div><div class="pal-list" id="pal-list" role="listbox"></div>`,
      onMount(m, close) {
        const inp = m.querySelector('#pal-input'); const listEl = m.querySelector('#pal-list');
        const all = commands();
        const draw = () => {
          const q = inp.value.trim().toLowerCase();
          items = all.filter(([n]) => !q || q.split(' ').every((w) => n.toLowerCase().includes(w))).slice(0, 12);
          sel = Math.min(sel, Math.max(0, items.length - 1));
          listEl.innerHTML = items.map(([n, ic, , key], i) => `<div class="pal-item ${i === sel ? 'sel' : ''}" data-i="${i}" role="option">${I(ic)}<span>${U.esc(n)}</span>${key ? `<kbd>${key}</kbd>` : ''}</div>`).join('') || '<div class="muted pal-empty">No matches</div>';
        };
        const run = (i) => { const it = items[i]; if (it) { close(); setTimeout(it[2], 10); } };
        inp.addEventListener('input', () => { sel = 0; draw(); });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
          if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
          if (e.key === 'Enter') { run(sel); e.preventDefault(); }
        });
        listEl.addEventListener('click', (e) => { const it = e.target.closest('.pal-item'); if (it) run(+it.dataset.i); });
        draw();
      },
    });
  }

  return { on, onChange, initDelegation, modal, closeTop, modalOpen, confirm, toast, float, shake, present, badgeIcon, quickAdd, palette };
})();
