'use strict';
/*
 * Focus mode: full-screen Pomodoro / timer / stopwatch over a slow pixel-art
 * scene, with Spotify controls only. Timing is timestamp-based, so it stays
 * correct even if the window is throttled. The scene renders at ~12 fps on a
 * 240x135 canvas and stops when hidden.
 */

Q.focus = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;

  const f = {
    open: false, mode: 'pomo', phase: 'work', round: 1, running: false,
    endAt: 0, remaining: 25 * 60, total: 25 * 60, swStart: 0, swAcc: 0, timerMin: 30, taskId: null,
  };
  let raf = 0; let tickT = 0; let idleT = 0; let lastFrame = 0;
  let canvas, ctx, bg, particles = [];

  /* ---------------------------------------------------------- scenes */
  const W = 240, H = 135;
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  function bands(g, top, colors, y0 = 0, y1 = H) {
    const n = colors.length; const h = (y1 - y0) / n;
    colors.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, Math.floor(y0 + i * h), W, Math.ceil(h) + 1); });
  }
  function hill(g, color, base, amp, freq, phase) {
    g.fillStyle = color;
    for (let x = 0; x < W; x++) { const y = Math.floor(base - amp * Math.sin(x * freq + phase) - amp * 0.5 * Math.sin(x * freq * 2.3 + phase * 2)); g.fillRect(x, y, 1, H - y); }
  }
  function pine(g, x, y, h, c, snow) {
    g.fillStyle = c;
    for (let i = 0; i < h; i++) { const w = Math.floor((i / h) * h * 0.45) + 1; g.fillRect(x - w, y + i, w * 2 + 1, 1); if (snow && i % 4 === 0) { g.fillStyle = '#FFFFFF'; g.fillRect(x - w, y + i, w * 2 + 1, 1); g.fillStyle = c; } }
    g.fillStyle = '#5B3A2E'; g.fillRect(x, y + h, 1, 3);
  }
  function cloud(g, x, y, s, c = '#FFFFFF') {
    g.fillStyle = c;
    g.fillRect(x, y + 2 * s, 12 * s, 3 * s); g.fillRect(x + 2 * s, y + s, 5 * s, 2 * s); g.fillRect(x + 5 * s, y, 4 * s, 2 * s);
  }

  const SCENES = {
    meadow: {
      base: '#9ED68C',
      bake(g) {
        bands(g, 0, ['#8FCFF2', '#9FD6F4', '#AFDDF6', '#BFE4F8', '#CFEBFA', '#DDF1FB'], 0, 90);
        g.fillStyle = '#FFF1A8'; g.fillRect(190, 14, 14, 14); g.fillStyle = '#FFE08A'; g.fillRect(192, 16, 10, 10);
        hill(g, '#9ED68C', 92, 6, 0.03, 1); hill(g, '#7CC66A', 104, 5, 0.045, 3); hill(g, '#58B368', 116, 3, 0.06, 0.5);
        for (let i = 0; i < 70; i++) { g.fillStyle = ['#F48FB1', '#FFF6DA', '#F2C14E'][i % 3]; g.fillRect(Math.floor(rnd() * W), 108 + Math.floor(rnd() * 26), 1, 1); }
        g.fillStyle = '#C9A06A'; for (let x = 0; x < W; x++) { const y = 124 + Math.round(Math.sin(x * 0.05) * 2); g.fillRect(x, y, 1, 3); }
      },
      init() { particles = Array.from({ length: 5 }, (_, i) => ({ x: i * 55, y: 8 + (i % 3) * 14, s: i % 2 ? 1 : 2, v: 0.04 + (i % 3) * 0.02 })).concat(Array.from({ length: 3 }, () => ({ b: 1, x: rnd() * W, y: 95 + rnd() * 20, p: rnd() * 6 }))); },
      draw(g, t) {
        for (const p of particles) {
          if (p.b) {
            const x = Math.floor((p.x + t * 0.008) % W); const y = Math.floor(p.y + Math.sin(t / 400 + p.p) * 4);
            const flap = Math.floor(t / 150 + p.p) % 2;
            g.fillStyle = '#FFFFFF'; g.fillRect(x, y, 1, 1); g.fillRect(x - 1, y - flap, 1, 1); g.fillRect(x + 1, y - flap, 1, 1);
            continue;
          }
          cloud(g, Math.floor(((p.x + t * p.v * 0.2) % (W + 40)) - 40), p.y, p.s);
        }
        g.fillStyle = '#3A8C4E';
        for (let x = 2; x < W; x += 7) { const sw = Math.round(Math.sin(t / 700 + x * 0.3)); g.fillRect(x + sw, 129, 1, 3); g.fillRect(x + 2 + sw, 128, 1, 4); }
      },
    },
    rain: {
      base: '#5E8A6E',
      bake(g) {
        bands(g, 0, ['#6E879E', '#7A93A9', '#869EB3', '#93A9BC', '#A0B4C6'], 0, 95);
        cloud(g, 10, 6, 3, '#8296AA'); cloud(g, 120, 2, 4, '#7B8FA3'); cloud(g, 70, 18, 2, '#8EA2B5');
        hill(g, '#5E8A6E', 98, 6, 0.035, 2); hill(g, '#4C7A5C', 110, 4, 0.05, 4);
        g.fillStyle = '#3F6B4F'; g.fillRect(0, 118, W, 17);
        g.fillStyle = '#6F8FA8'; g.fillRect(40, 124, 50, 4); g.fillRect(150, 127, 40, 3);
      },
      init() { particles = Array.from({ length: 140 }, () => ({ x: rnd() * W, y: rnd() * H, v: 1.6 + rnd() * 1.2 })); },
      draw(g, t, dt) {
        g.fillStyle = '#D6E6F2';
        for (const p of particles) {
          p.y += p.v * dt * 0.06; p.x -= p.v * dt * 0.012;
          if (p.y > H) { p.y = -4; p.x = rnd() * (W + 20); }
          g.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 3);
        }
        g.fillStyle = '#9FB8CC';
        for (const [cx, cy] of [[60, 126], [170, 128]]) { const r = Math.floor((t / 120) % 8); g.fillRect(cx - r, cy, r * 2 + 1, 1); }
        g.fillStyle = '#2E5A3E';
        for (let x = 1; x < W; x += 5) { const sw = Math.round(Math.sin(t / 500 + x) * 1.2); g.fillRect(x + sw, 114, 1, 6); }
      },
    },
    night: {
      base: '#24324F',
      bake(g) {
        bands(g, 0, ['#1B2445', '#202B50', '#26325B', '#2D3A66', '#354472', '#3E4E7E'], 0, 100);
        g.fillStyle = '#FFF6DA'; g.fillRect(36, 14, 10, 10); g.fillStyle = '#1B2445'; g.fillRect(40, 13, 8, 8);
        hill(g, '#24324F', 100, 7, 0.03, 1.5);
        for (let i = 0; i < 9; i++) pine(g, 8 + i * 28 + Math.floor(rnd() * 8), 76 + Math.floor(rnd() * 12), 26, '#18233A');
        g.fillStyle = '#2A3B4E'; g.fillRect(0, 112, W, 23);
        g.fillStyle = '#5B3A2E'; g.fillRect(112, 120, 16, 2); g.fillRect(114, 118, 12, 2);
      },
      init() { particles = Array.from({ length: 50 }, () => ({ star: 1, x: rnd() * W, y: rnd() * 70, p: rnd() * 10 })).concat(Array.from({ length: 14 }, () => ({ fly: 1, x: rnd() * W, y: 80 + rnd() * 40, p: rnd() * 10 }))); },
      draw(g, t) {
        for (const p of particles) {
          if (p.star) { if (Math.sin(t / 600 + p.p * 3) > -0.3) { g.fillStyle = '#FFF6DA'; g.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1); } continue; }
          const x = Math.floor(p.x + Math.sin(t / 1300 + p.p) * 10); const y = Math.floor(p.y + Math.cos(t / 900 + p.p) * 5);
          if (Math.sin(t / 300 + p.p * 2) > 0) { g.fillStyle = '#F2E66B'; g.fillRect(x, y, 1, 1); g.fillStyle = 'rgba(242,230,107,.25)'; g.fillRect(x - 1, y - 1, 3, 3); }
        }
        const fl = Math.floor(t / 110) % 3;
        g.fillStyle = 'rgba(242,154,78,.18)'; g.fillRect(100, 104, 40, 20);
        g.fillStyle = '#E8604C'; g.fillRect(116, 110 - fl, 8, 8 + fl);
        g.fillStyle = '#F29A4E'; g.fillRect(117, 113 - fl, 6, 5 + fl);
        g.fillStyle = '#F2C14E'; g.fillRect(119, 114, 2, 4 - (fl % 2));
      },
    },
    sea: {
      base: '#EBD9AE',
      bake(g) {
        bands(g, 0, ['#8FCFF2', '#AED9EE', '#CDE3E6', '#E9DCC8', '#F6CFA8', '#F7BE94'], 0, 72);
        g.fillStyle = '#FFE08A'; g.fillRect(150, 58, 22, 14); g.fillStyle = '#FFF1A8'; g.fillRect(154, 60, 14, 12);
        bands(g, 72, ['#3C82C8', '#3678BC', '#2F6EAF', '#2A64A2', '#265B95'], 72, 112);
        g.fillStyle = '#EBD9AE'; g.fillRect(0, 112, W, 23); g.fillStyle = '#D9C292'; g.fillRect(0, 112, W, 2);
        g.fillStyle = '#8A6A4A'; g.fillRect(20, 104, 70, 3); for (let x = 24; x < 90; x += 12) g.fillRect(x, 107, 2, 10);
      },
      init() { particles = Array.from({ length: 30 }, () => ({ x: rnd() * W, y: 74 + rnd() * 36, p: rnd() * 6 })); },
      draw(g, t) {
        g.fillStyle = '#BFE6F8';
        for (const p of particles) { const x = Math.floor((p.x + t * 0.004 * (p.y / 90)) % W); const len = 2 + Math.floor(2 + Math.sin(t / 500 + p.p) * 2); g.fillRect(x, Math.floor(p.y), len, 1); }
        g.fillStyle = '#FFF1A8'; for (let i = 0; i < 6; i++) g.fillRect(156 + ((i * 7 + Math.floor(t / 200)) % 12), 74 + i * 4, 6 - (i % 3), 1);
        const bx = Math.floor((t * 0.006) % (W + 30)) - 30; const by = 80 + Math.round(Math.sin(t / 600));
        g.fillStyle = '#FFFDF4'; g.fillRect(bx + 4, by - 9, 1, 9); g.fillRect(bx + 5, by - 8, 5, 6);
        g.fillStyle = '#E8604C'; g.fillRect(bx, by, 12, 2); g.fillRect(bx + 1, by + 2, 10, 1);
        g.fillStyle = '#FFFFFF'; const gx = Math.floor((t * 0.012) % (W + 20)) - 10; const gy = 30 + Math.round(Math.sin(t / 300) * 2); const w = Math.floor(t / 220) % 2;
        g.fillRect(gx, gy, 1, 1); g.fillRect(gx - 1, gy - w, 1, 1); g.fillRect(gx + 1, gy - w, 1, 1);
      },
    },
    snow: {
      base: '#F5F9FC',
      bake(g) {
        bands(g, 0, ['#BCD3EA', '#C8DBEE', '#D4E3F2', '#E0EBF6', '#EAF2F9'], 0, 92);
        hill(g, '#F5F9FC', 96, 8, 0.028, 1); hill(g, '#E3EDF5', 108, 5, 0.04, 2.5);
        for (let i = 0; i < 8; i++) pine(g, 14 + i * 30 + Math.floor(rnd() * 10), 80 + Math.floor(rnd() * 14), 22, '#3E6B5A', true);
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 118, W, 17); g.fillStyle = '#D8E6F1'; g.fillRect(0, 118, W, 1);
      },
      init() { particles = Array.from({ length: 110 }, () => ({ x: rnd() * W, y: rnd() * H, v: 0.3 + rnd() * 0.5, p: rnd() * 6 })); },
      draw(g, t, dt) {
        g.fillStyle = '#FFFFFF';
        for (const p of particles) {
          p.y += p.v * dt * 0.02; if (p.y > H) { p.y = -2; p.x = rnd() * W; }
          g.fillRect(Math.floor(p.x + Math.sin(t / 900 + p.p) * 3), Math.floor(p.y), p.v > 0.6 ? 2 : 1, p.v > 0.6 ? 2 : 1);
        }
      },
    },
  };

  function setScene(key) {
    const sc = SCENES[key] || SCENES.meadow;
    bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    // Paint the horizon colour first so hill curves never leave see-through gaps.
    g.fillStyle = sc.base || '#9ED68C'; g.fillRect(0, 0, W, H);
    sc.bake(g); sc.init();
    f.scene = sc;
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (document.visibilityState !== 'visible') return;
    if (ts - lastFrame < 80) return; // ~12 fps is plenty for ambience
    const dt = Math.min(200, ts - (lastFrame || ts));
    lastFrame = ts;
    ctx.drawImage(bg, 0, 0);
    f.scene.draw(ctx, ts, dt);
  }

  /* ---------------------------------------------------------- timer */
  const lengths = () => { const st = S().focus; return { work: st.work * 60, short: st.short * 60, long: st.long * 60 }; };
  function resetPhase() {
    f.running = false;
    if (f.mode === 'pomo') { f.total = f.remaining = lengths()[f.phase]; }
    else if (f.mode === 'timer') { f.total = f.remaining = f.timerMin * 60; }
    else { f.swAcc = 0; f.swStart = 0; }
    clearExtraAlarm();
  }
  function start() {
    Q.sfx.click();
    if (f.mode === 'stop') { f.swStart = Date.now(); }
    else { f.endAt = Date.now() + f.remaining * 1000; scheduleEndAlarm(); }
    f.running = true;
    render();
  }
  function pause() {
    if (f.mode === 'stop') { f.swAcc += Date.now() - f.swStart; }
    else { f.remaining = Math.max(0, (f.endAt - Date.now()) / 1000); }
    f.running = false; clearExtraAlarm();
    render();
  }
  function elapsedSw() { return (f.swAcc + (f.running ? Date.now() - f.swStart : 0)) / 1000; }

  function scheduleEndAlarm() {
    const label = f.mode === 'pomo' ? (f.phase === 'work' ? 'Focus session done!' : 'Break is over') : 'Timer done!';
    Q.scheduler.setExtra([{ id: `focus:${f.endAt}`, at: f.endAt, title: label, body: f.phase === 'work' ? 'Nice work. Take a breather.' : 'Ready for the next round?', silent: false }]);
  }
  const clearExtraAlarm = () => Q.scheduler.setExtra([]);

  function finishWork(minutes) {
    const g = Q.game.focusComplete(minutes, f.taskId);
    if (g) {
      const ev = Q.game.flush();
      Q.ui.present(ev.map((e) => (e.type === 'reward' ? Object.assign(e, {}) : e)));
      Q.ui.toast(`Focus session complete: +${g.xp} XP, +${g.gold} gold`, { kind: 'ok', icon: I('hourglass') });
    }
  }

  function complete() {
    f.running = false;
    Q.sfx.timer();
    if (f.mode === 'pomo') {
      if (f.phase === 'work') {
        finishWork(S().focus.work);
        f.phase = f.round % S().focus.rounds === 0 ? 'long' : 'short';
      } else {
        if (f.phase === 'long') f.round = 0;
        f.round++; f.phase = 'work';
      }
      f.total = f.remaining = lengths()[f.phase];
      if (S().focus.autoNext !== false) start();
    } else if (f.mode === 'timer') {
      finishWork(f.timerMin);
      f.remaining = 0;
    }
    render();
  }

  function tick() {
    if (!f.open) return;
    if (f.running && f.mode !== 'stop') {
      f.remaining = Math.max(0, (f.endAt - Date.now()) / 1000);
      if (f.remaining <= 0) complete();
    }
    paintTime();
  }

  function paintTime() {
    const root = document.getElementById('focus');
    const tEl = root.querySelector('.fx-time'); if (!tEl) return;
    const secs = f.mode === 'stop' ? elapsedSw() : f.remaining;
    tEl.textContent = U.fmtClock(secs);
    const frac = f.mode === 'stop' ? (secs % 3600) / 3600 : 1 - f.remaining / Math.max(1, f.total);
    const cells = root.querySelectorAll('.fx-cell');
    const on = Math.round(frac * cells.length);
    cells.forEach((c, i) => c.classList.toggle('on', i < on));
    document.title = f.running ? `${U.fmtClock(secs)} · Questline` : 'Questline';
  }

  /* ---------------------------------------------------------- render */
  function taskOptions() {
    const st = S();
    const opts = ['<option value="">No specific task</option>'];
    for (const d of Q.game.todaysDailies().filter((x) => !Q.game.isDone(x))) opts.push(`<option value="${d.id}" ${f.taskId === d.id ? 'selected' : ''}>Daily · ${esc(d.title)}</option>`);
    for (const r of st.reminders.filter((x) => !x.done).slice(0, 15)) opts.push(`<option value="${r.id}" ${f.taskId === r.id ? 'selected' : ''}>Reminder · ${esc(r.title)}</option>`);
    return opts.join('');
  }

  function render() {
    const root = document.getElementById('focus');
    const st = S();
    const fs = st.focus;
    const phaseName = f.mode === 'pomo' ? { work: 'Focus', short: 'Short break', long: 'Long break' }[f.phase] : f.mode === 'timer' ? 'Timer' : 'Stopwatch';
    root.querySelector('.fx-ui').innerHTML = `
      <div class="fx-top">
        <div class="fx-scenes">${Object.keys(Q.game.SHOP.scenes).map((k) => {
          const owned = st.owned.scenes.includes(k);
          return `<button class="fx-pill ${fs.scene === k ? 'on' : ''}" data-act="fx-scene" data-k="${k}" ${owned ? '' : 'disabled title="Unlock in the Shop"'}>${owned ? '' : I('lock')}${Q.game.SHOP.scenes[k].name}</button>`;
        }).join('')}</div>
        <div class="fx-top-right">
          <button class="fx-pill ${fs.rain ? 'on' : ''}" data-act="fx-rain" title="Soft rain sound">${I('note')} Rain sound</button>
          <button class="fx-pill" data-act="fx-close" title="Exit (Esc)">${I('close')} Exit</button>
        </div>
      </div>
      <div class="fx-card ${f.mode === 'pomo' && f.phase !== 'work' ? 'is-break' : ''}">
        <div class="seg seg-small fx-modes">${[['pomo', 'Pomodoro'], ['timer', 'Timer'], ['stop', 'Stopwatch']].map(([k, n]) => `<button class="seg-btn ${f.mode === k ? 'on' : ''}" data-act="fx-mode" data-m="${k}" ${f.running ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        <div class="fx-phase">${phaseName}${f.mode === 'pomo' ? ` <span>· round ${f.round} of ${fs.rounds}</span>` : ''}</div>
        <div class="fx-time" aria-live="off">00:00</div>
        <div class="fx-bar">${Array.from({ length: 24 }, () => '<i class="fx-cell"></i>').join('')}</div>
        <select class="fx-task" data-change="fx-task" aria-label="What are you focusing on?">${taskOptions()}</select>
        <div class="fx-ctrl">
          <button class="btn" data-act="fx-reset" title="Reset (R)">Reset</button>
          <button class="btn btn-primary fx-go" data-act="fx-toggle" title="Start / pause (Space)">${f.running ? 'Pause' : (f.mode === 'stop' && f.swAcc ? 'Resume' : 'Start')}</button>
          ${f.mode === 'stop' ? `<button class="btn" data-act="fx-finish" ${f.swAcc || f.running ? '' : 'disabled'}>Finish</button>` : `<button class="btn" data-act="fx-skip" title="Skip (S)">${f.mode === 'pomo' ? 'Skip' : 'Done'}</button>`}
        </div>
        ${!f.running ? (f.mode === 'pomo' ? `<div class="fx-presets">
            <label>Focus <input type="number" min="5" max="120" value="${fs.work}" data-change="fx-len" data-k="work" aria-label="Focus minutes"></label>
            <label>Break <input type="number" min="1" max="30" value="${fs.short}" data-change="fx-len" data-k="short" aria-label="Short break minutes"></label>
            <label>Long <input type="number" min="5" max="60" value="${fs.long}" data-change="fx-len" data-k="long" aria-label="Long break minutes"></label>
            <label>Rounds <input type="number" min="2" max="8" value="${fs.rounds}" data-change="fx-len" data-k="rounds" aria-label="Rounds before a long break"></label></div>`
          : f.mode === 'timer' ? `<div class="fx-presets">${[15, 25, 45, 60, 90].map((m) => `<button class="fx-pill ${f.timerMin === m ? 'on' : ''}" data-act="fx-tmin" data-m="${m}">${m}m</button>`).join('')}
            <label>Custom <input type="number" min="1" max="600" value="${f.timerMin}" data-change="fx-tmin-in" aria-label="Timer minutes"></label></div>` : '<p class="fx-note">Stopwatch sessions over 5 minutes earn XP when you press Finish.</p>') : '<p class="fx-note">Notifications are muted while you focus. Move the mouse to show controls.</p>'}
      </div>
      <div class="fx-bottom">${Q.spotify.markup('focus')}</div>`;
    paintTime();
    Q.spotify.render();
  }

  /* ---------------------------------------------------------- open/close */
  function open(opts = {}) {
    if (f.open) return;
    const root = document.getElementById('focus');
    const st = S();
    f.open = true;
    if (!f.running) { f.taskId = opts.taskId || st.focus.lastTaskId || null; resetPhase(); }
    root.innerHTML = '<canvas class="fx-canvas" width="240" height="135"></canvas><div class="fx-ui"></div>';
    root.hidden = false;
    canvas = root.querySelector('canvas'); ctx = canvas.getContext('2d');
    if (!st.owned.scenes.includes(st.focus.scene)) st.focus.scene = 'meadow';
    setScene(st.focus.scene);
    lastFrame = 0;
    if (st.settings.reducedMotion) { ctx.drawImage(bg, 0, 0); f.scene.draw(ctx, 0, 0); } else raf = requestAnimationFrame(frame);
    render();
    tickT = setInterval(tick, 250);
    Q.platform.win.setFullscreen(true);
    Q.scheduler.setFocus(true);
    if (st.focus.rain) Q.sfx.ambientRain(true);
    root.addEventListener('mousemove', wake);
    wake();
    if (opts.autostart && !f.running) start();
    document.body.classList.add('in-focus');
  }
  function wake() {
    const root = document.getElementById('focus');
    root.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (f.running) root.classList.add('idle'); }, 4000);
  }
  function close() {
    if (!f.open) return;
    const root = document.getElementById('focus');
    f.open = false;
    cancelAnimationFrame(raf); clearInterval(tickT); clearTimeout(idleT);
    root.hidden = true; root.innerHTML = '';
    Q.platform.win.setFullscreen(false);
    Q.scheduler.setFocus(false);
    Q.sfx.ambientRain(false);
    document.title = 'Questline';
    document.body.classList.remove('in-focus');
    Q.app.render();
    if (f.running) Q.ui.toast('Your timer keeps running in the background.', { actions: [{ label: 'Back to focus', fn: () => open() }] });
  }

  function bind() {
    const on = Q.ui.on;
    on('focus-open', () => open());
    on('fx-close', close);
    on('fx-toggle', () => (f.running ? pause() : start()));
    on('fx-reset', () => { if (f.mode === 'pomo') { f.phase = 'work'; f.round = 1; } resetPhase(); render(); });
    on('fx-skip', () => { if (f.mode === 'timer') { const done = (f.total - f.remaining) / 60; f.running = false; clearExtraAlarm(); if (done >= 5) finishWork(done); resetPhase(); render(); } else complete(); });
    on('fx-finish', () => { const min = elapsedSw() / 60; f.running = false; if (min >= 5) finishWork(min); else Q.ui.toast('Sessions under 5 minutes don\'t earn XP.'); f.swAcc = 0; render(); });
    on('fx-mode', (el) => { f.mode = el.dataset.m; f.phase = 'work'; f.round = 1; resetPhase(); render(); });
    on('fx-tmin', (el) => { f.timerMin = +el.dataset.m; resetPhase(); render(); });
    on('fx-scene', (el) => { S().focus.scene = el.dataset.k; Q.store.commit('focus-scene'); setScene(el.dataset.k); render(); if (S().settings.reducedMotion) { ctx.drawImage(bg, 0, 0); f.scene.draw(ctx, 0, 0); } });
    on('fx-rain', () => { const st = S(); st.focus.rain = !st.focus.rain; Q.sfx.ambientRain(st.focus.rain); Q.store.commit('focus'); render(); });
    Q.ui.onChange('fx-task', (el) => { f.taskId = el.value || null; S().focus.lastTaskId = f.taskId; Q.store.commit('focus'); });
    Q.ui.onChange('fx-len', (el) => { const st = S(); st.focus[el.dataset.k] = U.clamp(+el.value || 1, +el.min, +el.max); Q.store.commit('focus'); resetPhase(); render(); });
    Q.ui.onChange('fx-tmin-in', (el) => { f.timerMin = U.clamp(+el.value || 1, 1, 600); resetPhase(); render(); });
  }

  function key(e) {
    if (!f.open) return false;
    if (e.target.matches('input, select, textarea')) return false;
    if (e.key === 'Escape') { close(); return true; }
    if (e.key === ' ') { f.running ? pause() : start(); return true; }
    if (e.key === 'r' || e.key === 'R') { document.querySelector('[data-act="fx-reset"]')?.click(); return true; }
    if (e.key === 's' || e.key === 'S') { document.querySelector('[data-act="fx-skip"]')?.click(); return true; }
    wake();
    return false;
  }

  return { open, close, bind, key, isOpen: () => f.open, isRunning: () => f.running };
})();
