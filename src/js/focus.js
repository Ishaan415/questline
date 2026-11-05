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
    combo: 0, // Pomodoro focus rounds finished in a row this session
  };

  /* Combo: each finished round in a row pays 25% more (up to 3x). Every 4th
     round in a row adds a bonus item. Reset, skipping a focus round, switching
     mode, or leaving focus mode between rounds starts the combo over. */
  const comboMult = (done) => Math.min(3, 1 + 0.25 * done);
  const BONUS_ITEMS = ['charm', 'potion', 'shield'];
  const bonusFor = (roundNo) => (roundNo % 4 === 0 ? BONUS_ITEMS[(roundNo / 4 - 1) % BONUS_ITEMS.length] : null);
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
    autumn: {
      base: '#C98A3E',
      bake(g) {
        bands(g, 0, ['#F3C894', '#F6D3A2', '#F8DDB0', '#FAE6C0', '#FBEED0'], 0, 92);
        g.fillStyle = '#FFE9B8'; g.fillRect(36, 20, 12, 12); g.fillStyle = '#FFF4D6'; g.fillRect(38, 22, 8, 8);
        hill(g, '#D9A15A', 90, 6, 0.03, 2); hill(g, '#C98A3E', 102, 5, 0.045, 0.7);
        // Round-topped trees in reds, oranges and gold.
        const cols = ['#E8742E', '#C8382E', '#E3A21A', '#D2562A'];
        for (let i = 0; i < 8; i++) {
          const x = 12 + i * 30 + Math.floor(rnd() * 8); const y = 78 + Math.floor(rnd() * 12); const r = 9 + Math.floor(rnd() * 4);
          g.fillStyle = '#5B3A2E'; g.fillRect(x - 1, y, 3, 22);
          g.fillStyle = cols[i % cols.length];
          for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(x - w, y + dy - 4, w * 2 + 1, 1); }
          g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x - r + 3, y - r - 1, r, 2);
        }
        g.fillStyle = '#8C5A2A'; g.fillRect(0, 114, W, 21);
        for (let i = 0; i < 90; i++) { g.fillStyle = cols[i % 4]; g.fillRect(Math.floor(rnd() * W), 115 + Math.floor(rnd() * 20), 2, 1); }
        g.fillStyle = '#A8763E'; for (let x = 0; x < W; x++) { const y = 124 + Math.round(Math.sin(x * 0.04 + 1) * 2); g.fillRect(x, y, 1, 3); }
      },
      init() { particles = Array.from({ length: 34 }, (_, i) => ({ x: rnd() * W, y: rnd() * H, v: 0.25 + rnd() * 0.35, p: rnd() * 6, c: ['#E8742E', '#C8382E', '#E3A21A', '#F29A4E'][i % 4] })); },
      draw(g, t, dt) {
        for (const p of particles) {
          p.y += p.v * dt * 0.02; p.x += Math.sin(t / 700 + p.p) * 0.12 + 0.05;
          if (p.y > H) { p.y = -3; p.x = rnd() * W; }
          if (p.x > W) p.x -= W;
          const flip = Math.floor(t / 260 + p.p) % 2;
          g.fillStyle = p.c; g.fillRect(Math.floor(p.x), Math.floor(p.y), flip ? 2 : 1, flip ? 1 : 2);
        }
      },
    },
    blossom: {
      base: '#9ED68C',
      bake(g) {
        bands(g, 0, ['#F8D3E2', '#FADCE8', '#FBE4ED', '#FCEBF1', '#FDF2F6'], 0, 88);
        // Far mountain with a snowy top.
        g.fillStyle = '#C9B5D8';
        for (let x = 0; x < W; x++) { const y = Math.floor(70 - Math.max(0, 34 - Math.abs(x - 150) * 0.45)); g.fillRect(x, y, 1, 90 - y); }
        g.fillStyle = '#FFFFFF'; for (let x = 140; x <= 160; x++) { const y = Math.floor(70 - Math.max(0, 34 - Math.abs(x - 150) * 0.45)); g.fillRect(x, y, 1, 4); }
        hill(g, '#9ED68C', 92, 4, 0.035, 1.2); hill(g, '#7CC66A', 104, 3, 0.05, 2.4);
        // Pond.
        g.fillStyle = '#7CC1D9'; g.fillRect(70, 112, 110, 12); g.fillRect(76, 110, 98, 2); g.fillRect(76, 124, 98, 2);
        g.fillStyle = '#A8DCEB'; g.fillRect(84, 115, 30, 1); g.fillRect(130, 119, 26, 1);
        // Cherry trees.
        for (const [x, y, r] of [[28, 80, 13], [214, 76, 15], [120, 86, 8]]) {
          g.fillStyle = '#6B4436'; g.fillRect(x - 1, y, 3, 30); g.fillRect(x - 5, y + 6, 5, 2); g.fillRect(x + 2, y + 9, 5, 2);
          for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy) * 1.3); g.fillStyle = dy < -r / 3 ? '#FBC8DC' : '#F48FB1'; g.fillRect(x - w, y + dy - 2, w * 2 + 1, 1); }
          for (let i = 0; i < 12; i++) { g.fillStyle = '#FFFFFF'; g.fillRect(x - r + Math.floor(rnd() * r * 2), y - r + Math.floor(rnd() * r * 1.6), 1, 1); }
        }
        g.fillStyle = '#58B368'; g.fillRect(0, 126, W, 9);
      },
      init() { particles = Array.from({ length: 40 }, () => ({ x: rnd() * W, y: rnd() * H, v: 0.15 + rnd() * 0.3, p: rnd() * 6 })); },
      draw(g, t, dt) {
        for (const p of particles) {
          p.y += p.v * dt * 0.018; p.x += 0.08 + Math.sin(t / 800 + p.p) * 0.1;
          if (p.y > H) { p.y = -2; p.x = rnd() * W; }
          if (p.x > W) p.x -= W;
          g.fillStyle = (Math.floor(t / 300 + p.p) % 2) ? '#F7B6D0' : '#FFFFFF';
          g.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
        }
        g.fillStyle = '#C8EAF3';
        for (const [cx, cy] of [[100, 117], [150, 121]]) { const r = Math.floor((t / 160) % 9); g.fillRect(cx - r, cy, r * 2 + 1, 1); }
        // A koi now and then.
        const kx = 72 + Math.floor((t * 0.01) % 106); g.fillStyle = '#F29A4E'; g.fillRect(kx, 118, 3, 1); g.fillStyle = '#FFFDF4'; g.fillRect(kx - 1, 118, 1, 1);
      },
    },
    desert: {
      base: '#E9B672',
      bake(g) {
        bands(g, 0, ['#E8865A', '#F09A64', '#F6AE70', '#F8C084', '#F9D19A', '#FADEB0'], 0, 80);
        g.fillStyle = '#FFE08A'; g.fillRect(160, 34, 18, 18); g.fillStyle = '#FFF1A8'; g.fillRect(163, 37, 12, 12);
        // Mesas.
        g.fillStyle = '#C47048'; g.fillRect(14, 58, 40, 24); g.fillRect(20, 54, 28, 4); g.fillRect(196, 62, 34, 20); g.fillRect(200, 58, 24, 4);
        g.fillStyle = '#A85A38'; g.fillRect(14, 70, 40, 2); g.fillRect(196, 72, 34, 2);
        hill(g, '#F0C88A', 86, 5, 0.025, 0.5); hill(g, '#E9B672', 98, 6, 0.04, 2); hill(g, '#D69A55', 114, 4, 0.05, 4);
        // Oasis pool + palm.
        g.fillStyle = '#3C9EC8'; g.fillRect(150, 110, 52, 6); g.fillRect(154, 108, 44, 2); g.fillRect(154, 116, 44, 2);
        g.fillStyle = '#7FD0EE'; g.fillRect(158, 111, 14, 1);
        g.fillStyle = '#7CB85A'; g.fillRect(150, 107, 4, 2); g.fillRect(198, 107, 5, 2); g.fillRect(146, 116, 5, 2);
        // Palm: a leaning trunk and drooping fronds.
        const top = [212, 74];
        g.fillStyle = '#8A6A4A'; for (let i = 0; i < 34; i++) g.fillRect(206 + Math.round(Math.sin(i / 34 * 1.4) * 6), 108 - i, 3, 1);
        g.fillStyle = '#6E5236'; for (let i = 2; i < 34; i += 4) g.fillRect(206 + Math.round(Math.sin(i / 34 * 1.4) * 6), 108 - i, 3, 1);
        for (const [dx, col] of [[-16, '#3E9E5A'], [-9, '#58B368'], [9, '#58B368'], [16, '#3E9E5A'], [-3, '#7CC66A'], [4, '#7CC66A']]) {
          g.fillStyle = col;
          for (let k = 0; k <= 12; k++) { const t = k / 12; g.fillRect(top[0] + Math.round(dx * t), top[1] - 3 + Math.round(-4 * t + 14 * t * t * (Math.abs(dx) > 6 ? 1 : 0.4)), 2, 2); }
        }
        g.fillStyle = '#6E5236'; g.fillRect(top[0] - 1, top[1] - 1, 3, 3);
        // Cactus.
        g.fillStyle = '#4E8C4A'; g.fillRect(48, 96, 3, 16); g.fillRect(44, 100, 2, 6); g.fillRect(44, 100, 4, 2); g.fillRect(53, 98, 2, 6); g.fillRect(51, 103, 4, 2);
      },
      init() { particles = Array.from({ length: 40 }, () => ({ x: rnd() * W, y: 90 + rnd() * 45, v: 0.5 + rnd() * 0.8, p: rnd() * 6 })); },
      draw(g, t, dt) {
        // Heat shimmer over the dunes.
        g.fillStyle = 'rgba(255,241,200,.35)';
        for (let i = 0; i < 4; i++) { const y = 84 + i * 3; const off = Math.floor(Math.sin(t / 400 + i) * 3); for (let x = (i * 9 + off + 60) % 18; x < W; x += 18) g.fillRect(x, y, 6, 1); }
        g.fillStyle = '#F6DDB0';
        for (const p of particles) { p.x += p.v * dt * 0.03; if (p.x > W) { p.x = -2; p.y = 90 + rnd() * 45; } g.fillRect(Math.floor(p.x), Math.floor(p.y + Math.sin(t / 300 + p.p)), 1, 1); }
        // Tumbleweed.
        const tx = Math.floor((t * 0.02) % (W + 40)) - 20; const ty = 118 - Math.abs(Math.round(Math.sin(t / 220) * 4));
        g.fillStyle = '#A8763E'; g.fillRect(tx, ty, 5, 5); g.fillStyle = '#C99A5E'; g.fillRect(tx + 1, ty + 1, 3, 3); g.fillStyle = '#8A6A4A'; g.fillRect(tx + ((Math.floor(t / 120)) % 4), ty + 2, 1, 1);
        g.fillStyle = '#9FE0F6'; g.fillRect(158 + Math.floor((t / 250) % 32), 113, 4, 1);
      },
    },
    aurora: {
      base: '#DDE8F2',
      bake(g) {
        bands(g, 0, ['#0B1426', '#0F1A2E', '#132036', '#17263F', '#1C2D49', '#223553'], 0, 96);
        g.fillStyle = '#4E6E94';
        for (let x = 0; x < W; x++) { const y = Math.floor(96 - Math.max(0, 30 - Math.abs(x - 60) * 0.6) - Math.max(0, 22 - Math.abs(x - 180) * 0.5)); g.fillRect(x, y, 1, 100 - y); }
        g.fillStyle = '#F4F8FC';
        for (let x = 0; x < W; x++) {
          const a = 30 - Math.abs(x - 60) * 0.6; const b = 22 - Math.abs(x - 180) * 0.5;
          if (a > 14) g.fillRect(x, Math.floor(96 - a), 1, Math.floor((a - 14) * 0.6) + 2);
          if (b > 10) g.fillRect(x, Math.floor(96 - b), 1, Math.floor((b - 10) * 0.6) + 2);
        }
        g.fillStyle = '#DDE8F2'; g.fillRect(0, 98, W, 14);
        g.fillStyle = '#2B4466'; g.fillRect(0, 112, W, 23); // frozen lake
        g.fillStyle = '#3E5F86'; for (let i = 0; i < 12; i++) g.fillRect(Math.floor(rnd() * W), 114 + Math.floor(rnd() * 20), 10 + Math.floor(rnd() * 14), 1);
        for (let i = 0; i < 5; i++) pine(g, 16 + i * 52 + Math.floor(rnd() * 10), 86 + Math.floor(rnd() * 6), 14, '#16283A', true);
      },
      init() { particles = Array.from({ length: 60 }, () => ({ x: rnd() * W, y: rnd() * 80, p: rnd() * 10 })); },
      draw(g, t) {
        for (const p of particles) if (Math.sin(t / 700 + p.p * 3) > -0.2) { g.fillStyle = '#FFF6DA'; g.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1); }
        // Two rippling curtains of light.
        for (const [col, y0, sp, ph] of [['rgba(95,227,176,', 26, 1400, 0], ['rgba(178,139,245,', 40, 1900, 2]]) {
          for (let x = 0; x < W; x += 2) {
            const y = Math.floor(y0 + Math.sin(x * 0.035 + t / sp + ph) * 8 + Math.sin(x * 0.09 - t / (sp * 0.7)) * 3);
            const h = 10 + Math.floor((Math.sin(x * 0.05 + t / 900 + ph) + 1) * 6);
            g.fillStyle = col + '.10)'; g.fillRect(x, y - h, 2, h);
            g.fillStyle = col + '.22)'; g.fillRect(x, y - Math.floor(h / 2), 2, Math.floor(h / 2));
            g.fillStyle = col + '.45)'; g.fillRect(x, y, 2, 2);
            // Faint reflection on the ice.
            g.fillStyle = col + '.10)'; g.fillRect(x, 134 - Math.floor((y - y0 + 8) / 2), 2, 1);
          }
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

  function finishWork(minutes, { mult = 1, bonus = null, roundNo = 0 } = {}) {
    const g = Q.game.focusComplete(minutes, f.taskId, mult, bonus);
    if (!g) return null;
    Q.ui.present(Q.game.flush());
    const head = roundNo ? `Round ${roundNo} in a row done!` : 'Focus session complete!';
    const combo = mult > 1 ? ` · combo ×${mult.toFixed(2)}` : '';
    Q.ui.toast(`${head} +${g.xp} XP, +${g.gold} gold${combo}`, { kind: 'ok', icon: I('hourglass'), timeout: 6000 });
    if (bonus) setTimeout(() => { Q.sfx.drop(); Q.ui.toast(`Combo bonus: a ${Q.game.SHOP.items[bonus].name}!`, { kind: 'drop', icon: I(Q.game.SHOP.items[bonus].icon) }); }, 700);
    return g;
  }

  function complete() {
    f.running = false;
    Q.sfx.timer();
    if (f.mode === 'pomo') {
      if (f.phase === 'work') {
        const roundNo = f.combo + 1;
        finishWork(S().focus.work, { mult: comboMult(f.combo), bonus: bonusFor(roundNo), roundNo });
        f.combo = roundNo;
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
    const nowEl = root.querySelector('.fx-now');
    if (nowEl) { const d = new Date(); const txt = window.innerWidth < 560 ? U.fmtTime(d) : `${U.fmtTime(d)} · ${U.DAYS[d.getDay()]} ${d.getDate()} ${U.MONTHS[d.getMonth()]}`; if (nowEl.textContent !== txt) nowEl.textContent = txt; }
    const secs = f.mode === 'stop' ? elapsedSw() : f.remaining;
    tEl.textContent = U.fmtClock(secs);
    const frac = f.mode === 'stop' ? (secs % 3600) / 3600 : 1 - f.remaining / Math.max(1, f.total);
    const cells = root.querySelectorAll('.fx-cell');
    const on = Math.round(frac * cells.length);
    cells.forEach((c, i) => c.classList.toggle('on', i < on));
    document.title = f.running ? `${U.fmtClock(secs)} · Questline` : 'Questline';
  }

  /* ---------------------------------------------------------- render */
  /** The picked task's time goal ("Study AI courses · 45m of 2h today"). */
  function goalLine() {
    const G = Q.game; const st = S();
    const d = f.taskId && st.dailies.find((x) => x.id === f.taskId);
    const t = d || (f.taskId && st.reminders.find((x) => x.id === f.taskId));
    if (!t || !G.budgetOf(t)) return '';
    const kind = d ? 'daily' : 'reminder';
    const s = G.spentOn(kind, t); const b = G.budgetOf(t);
    return `<div class="fx-goal"><span>${I('hourglass')} <b>${U.esc(t.title)}</b> · ${U.fmtDuration(s)} of ${U.fmtDuration(b)}${d ? ' today' : ''}</span><i style="--p:${Math.min(100, (s / b) * 100)}%"></i></div>`;
  }

  function comboHtml() {
    const done = f.combo;
    const mult = comboMult(done);
    const p = Q.game.focusPreview(S().focus.work, mult);
    const nextBonus = bonusFor(done + 1);
    const toBonus = 4 - (done % 4);
    return `<div class="fx-combo">
      <div class="fx-combo-top"><span class="fx-pips" aria-label="${done % 4} of 4 rounds toward a bonus">${[0, 1, 2, 3].map((i) => `<i class="${i < done % 4 ? 'on' : ''}"></i>`).join('')}</span>
        <b>${done ? `Combo ×${mult.toFixed(2)}` : 'No combo yet'}</b><span class="fx-streak">${done} in a row</span></div>
      <div class="fx-next">Next round: <b>+${p.xp} XP · +${p.gold} gold</b>${nextBonus ? ` <span class="fx-bonus">+ ${Q.game.SHOP.items[nextBonus].name}</span>` : ` <span class="muted-fx">· bonus item in ${toBonus}</span>`}</div>
    </div>`;
  }

  function taskOptions() {
    const st = S();
    const opts = ['<option value="">No specific task</option>'];
    const G = Q.game;
    const goal = (kind, t) => (G.budgetOf(t) ? ` (${U.fmtDuration(G.spentOn(kind, t))} / ${U.fmtDuration(G.budgetOf(t))})` : '');
    // Tasks with a time goal first: they're the ones focus time counts toward.
    const dailies = G.todaysDailies().filter((x) => !G.isDone(x)).sort((a, b) => G.budgetOf(b) - G.budgetOf(a));
    const rems = st.reminders.filter((x) => !x.done).sort((a, b) => G.budgetOf(b) - G.budgetOf(a)).slice(0, 15);
    for (const d of dailies) opts.push(`<option value="${d.id}" ${f.taskId === d.id ? 'selected' : ''}>Daily · ${esc(d.title)}${goal('daily', d)}</option>`);
    for (const r of rems) opts.push(`<option value="${r.id}" ${f.taskId === r.id ? 'selected' : ''}>Reminder · ${esc(r.title)}${goal('reminder', r)}</option>`);
    return opts.join('');
  }

  function render() {
    const root = document.getElementById('focus');
    const st = S();
    const fs = st.focus;
    const phaseName = f.mode === 'pomo' ? { work: 'Focus', short: 'Short break', long: 'Long break' }[f.phase] : f.mode === 'timer' ? 'Timer' : 'Stopwatch';
    root.querySelector('.fx-ui').innerHTML = `
      <div class="fx-top">
        <button class="fx-pill fx-scene-btn ${f.scenePick ? 'on' : ''}" data-act="fx-scenes" aria-expanded="${!!f.scenePick}" title="Change the scene"><i class="fx-thumb scene-${fs.scene}"></i><span>${Q.game.SHOP.scenes[fs.scene]?.name || 'Scene'}</span>${I('down')}</button>
        <div class="fx-now" title="Current time"></div>
        <div class="fx-top-right">
          <button class="fx-pill ${fs.rain ? 'on' : ''}" data-act="fx-rain" title="Soft rain sound" aria-label="Rain sound">${I('note')}<span class="fx-lbl">Rain</span></button>
          ${Q.platform.isPhone ? `<button class="fx-pill" data-act="fx-rotate" title="Turn the screen" aria-label="Turn the screen">${I('sync')}<span class="fx-lbl">${fs.orientation === 'landscape' ? 'Portrait' : 'Landscape'}</span></button>` : ''}
          <button class="fx-pill" data-act="fx-close" title="Exit (Esc)" aria-label="Exit">${I('close')}<span class="fx-lbl">Exit</span></button>
        </div>
        ${f.scenePick ? `<div class="fx-scene-pick" role="menu">${Object.keys(Q.game.SHOP.scenes).map((k) => {
          const owned = st.owned.scenes.includes(k);
          return `<button class="fx-sc ${fs.scene === k ? 'on' : ''}" data-act="fx-scene" data-k="${k}" ${owned ? '' : 'disabled'} role="menuitem"><i class="fx-thumb scene-${k}"></i><span>${Q.game.SHOP.scenes[k].name}</span>${owned ? '' : `<small>${I('lock')} Shop</small>`}</button>`;
        }).join('')}</div>` : ''}
      </div>
      <div class="fx-card ${f.mode === 'pomo' && f.phase !== 'work' ? 'is-break' : ''}">
        <div class="fx-side">
        <div class="seg seg-small fx-modes">${[['pomo', 'Pomodoro'], ['timer', 'Timer'], ['stop', 'Stopwatch']].map(([k, n]) => `<button class="seg-btn ${f.mode === k ? 'on' : ''}" data-act="fx-mode" data-m="${k}" ${f.running ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        </div>
        <div class="fx-main">
        <div class="fx-phase">${phaseName}${f.mode === 'pomo' ? ` <span>· round ${f.round} of ${fs.rounds}</span>` : ''}</div>
        <div class="fx-time" aria-live="off">00:00</div>
        <div class="fx-bar">${Array.from({ length: 24 }, () => '<i class="fx-cell"></i>').join('')}</div>
        ${f.mode === 'pomo' ? comboHtml() : ''}
        ${goalLine()}
        ${st.expedition ? `<div class="fx-exp"><img class="px" src="${Q.pals.url(st.expedition.id, Q.pals.stage(st.expedition.id))}" width="28" height="28" alt=""><span><b>${U.esc(Q.pals.name(st.expedition.id))}</b> is exploring · ${Math.floor(st.expedition.progress)}/${st.expedition.need} min</span></div>` : ''}
        </div>
        <div class="fx-side">
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
            <label>Custom <input type="number" min="1" max="600" value="${f.timerMin}" data-change="fx-tmin-in" aria-label="Timer minutes"></label></div>` : '<p class="fx-note">Stopwatch sessions over 5 minutes earn XP when you press Finish.</p>') : `<p class="fx-note">Notifications are muted while you focus. ${Q.platform.isPhone ? 'Tap the screen' : 'Move the mouse'} to show controls.</p>`}
        </div>
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
    if (Q.platform.isPhone) Q.platform.setOrientation(st.focus.orientation === 'landscape' ? 'landscape' : 'portrait');
    // Android: hide the status and navigation bars and draw under the camera cutout.
    Q.platform.setImmersive(true);
    Q.scheduler.setFocus(true);
    if (st.focus.rain) Q.sfx.ambientRain(true);
    root.addEventListener('mousemove', wake);
    root.addEventListener('pointerdown', wake);
    root.addEventListener('pointerdown', pickAway);
    wake();
    if (opts.autostart && !f.running) start();
    document.body.classList.add('in-focus');
  }
  /** Tapping outside the scene picker closes it. */
  function pickAway(e) {
    if (f.scenePick && !e.target.closest('.fx-top')) { f.scenePick = false; render(); }
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
    if (!f.running) f.combo = 0;
    cancelAnimationFrame(raf); clearInterval(tickT); clearTimeout(idleT);
    root.hidden = true; root.innerHTML = '';
    Q.platform.win.setFullscreen(false);
    if (Q.platform.isPhone) Q.platform.setOrientation('auto');
    Q.platform.setImmersive(false);
    f.scenePick = false;
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
    on('fx-reset', () => { if (f.mode === 'pomo') { f.phase = 'work'; f.round = 1; f.combo = 0; } resetPhase(); render(); });
    on('fx-skip', () => {
      if (f.mode === 'pomo' && f.phase === 'work') {
        // Skipping a focus round pays nothing and breaks the combo.
        const had = f.combo;
        f.combo = 0; f.running = false; clearExtraAlarm();
        f.phase = f.round % S().focus.rounds === 0 ? 'long' : 'short';
        f.total = f.remaining = lengths()[f.phase];
        if (had) Q.ui.toast('Round skipped: combo reset.');
        render();
        return;
      }
      if (f.mode === 'timer') { const done = (f.total - f.remaining) / 60; f.running = false; clearExtraAlarm(); if (done >= 5) finishWork(done); resetPhase(); render(); } else complete(); });
    on('fx-finish', () => { const min = elapsedSw() / 60; f.running = false; if (min >= 5) finishWork(min); else Q.ui.toast('Sessions under 5 minutes don\'t earn XP.'); f.swAcc = 0; render(); });
    on('fx-mode', (el) => { f.mode = el.dataset.m; f.phase = 'work'; f.round = 1; f.combo = 0; resetPhase(); render(); });
    on('fx-tmin', (el) => { f.timerMin = +el.dataset.m; resetPhase(); render(); });
    on('fx-scenes', () => { f.scenePick = !f.scenePick; render(); });
    on('fx-scene', (el) => { f.scenePick = false; S().focus.scene = el.dataset.k; Q.store.commit('focus-scene'); setScene(el.dataset.k); render(); if (S().settings.reducedMotion) { ctx.drawImage(bg, 0, 0); f.scene.draw(ctx, 0, 0); } });
    on('fx-rotate', () => {
      const fs = S().focus;
      fs.orientation = fs.orientation === 'landscape' ? 'portrait' : 'landscape';
      Q.store.commit('focus');
      Q.platform.setOrientation(fs.orientation);
      render();
    });
    on('fx-rain', () => { const st = S(); st.focus.rain = !st.focus.rain; Q.sfx.ambientRain(st.focus.rain); Q.store.commit('focus'); render(); });
    Q.ui.onChange('fx-task', (el) => { f.taskId = el.value || null; S().focus.lastTaskId = f.taskId; Q.store.commit('focus'); render(); });
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
