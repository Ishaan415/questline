'use strict';
/*
 * Part-based pixel-art generator for pals and bosses (32x32).
 * Each evolution line describes its body, colours and parts; every stage
 * grows the body and switches parts on (ears, crest, tail, wings, crown...).
 * Parts are painted back-to-front, each with its own 1px outline, so they
 * read as separate shapes like hand-made sprites.
 *
 * Stage tokens: "dot|sharp@3" means "dot" until stage 3, then "sharp".
 * A value may join parts with "+": "horn+crown@5".
 */

(function (root) {
  const N = 32;
  const GROUND = 30;

  /* ---------------------------------------------------------------- colour */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    let h = 0; let s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }
  /** Hue-shifted shading: shadows lean cool, highlights lean warm. */
  function tone(hex, dl) {
    const [h, s, l] = hexToHsl(hex);
    const toward = (target, amt) => { let d = ((target - h + 540) % 360) - 180; return h + clamp(d, -amt, amt); };
    if (dl < 0) return hslToHex(s < 0.08 ? h : toward(235, 12), s + 0.06, l + dl);
    return hslToHex(s < 0.08 ? h : toward(55, 8), s - 0.04, l + dl);
  }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16); const pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
  }

  function palette(a) {
    const M = a.m; const A = a.a || tone(a.m, -0.2); const C = a.a2 || tone(A, 0.2);
    const B = a.b || tone(M, 0.16);
    return {
      M, m: tone(M, -0.13), L: tone(M, 0.12),
      B, b: tone(B, -0.1),
      A, a: tone(A, -0.14),
      C, c: tone(C, -0.12),
      E: a.eye || '#23343B', W: '#FFFFFF', K: a.cheek || '#F4A0A0', X: '#3A2A30',
      G: '#F2C14E', g: '#C9922E', H: '#FFF1A8',
      o: mix(tone(M, -0.42), '#1C2130', 0.55),
      S: 'rgba(20,24,36,0.22)',
    };
  }

  /* ------------------------------------------------------------- tokens */
  function pick(v, stage) {
    if (v === undefined || v === null || v === '') return '';
    if (Array.isArray(v)) return v[Math.min(stage - 1, v.length - 1)] || '';
    if (typeof v !== 'string') return v;
    let out = '';
    for (const tok of v.split('|')) {
      const [val, at] = tok.split('@');
      if (stage >= (at ? +at : 1)) out = val === '' && at ? 'on' : val;
    }
    return out === 'none' ? '' : out;
  }
  const partsOf = (v, stage) => pick(v, stage).split('+').filter(Boolean).map((p) => { const [k, arg] = p.split(':'); return { k, arg }; });

  function rng(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ------------------------------------------------------------- layers */
  class Layer {
    constructor() { this.cells = new Map(); }
    set(x, y, k) { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < N && y < N) this.cells.set(y * N + x, k); }
    has(x, y) { return this.cells.has(Math.floor(y) * N + Math.floor(x)); }
    fill(x0, y0, x1, y1, fn) {
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(N - 1, Math.ceil(y1)); y++) {
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(N - 1, Math.ceil(x1)); x++) {
          const k = fn(x + 0.5, y + 0.5, x, y);
          if (k) this.set(x, y, k);
        }
      }
      return this;
    }
    merge(o) { for (const [i, k] of o.cells) this.cells.set(i, k); return this; }
  }

  /** Shaded fill key for a point inside an ellipse-ish box. */
  const shadeKey = (u, v, base = 'M', dark = 'm', light = 'L') =>
    (u * 0.55 + v * 0.85 > 0.6 ? dark : (u + 0.38) ** 2 + (v + 0.48) ** 2 < 0.06 ? light : base);

  function ellipse(L, cx, cy, rx, ry, key, rot = 0) {
    rx = Math.max(0.6, rx); ry = Math.max(0.6, ry);
    const c = Math.cos(rot); const s = Math.sin(rot); const R = Math.max(rx, ry) + 1;
    return L.fill(cx - R, cy - R, cx + R, cy + R, (x, y) => {
      const dx = x - cx; const dy = y - cy;
      const u = (dx * c + dy * s) / rx; const v = (-dx * s + dy * c) / ry;
      if (u * u + v * v > 1) return null;
      return typeof key === 'function' ? key(u, v) : key;
    });
  }
  function tri(L, a, b, c, key) {
    const [x0, x1] = [Math.min(a[0], b[0], c[0]), Math.max(a[0], b[0], c[0])];
    const [y0, y1] = [Math.min(a[1], b[1], c[1]), Math.max(a[1], b[1], c[1])];
    const area = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const A = area(a, b, c);
    return L.fill(x0, y0, x1, y1, (x, y) => {
      const p = [x, y];
      const w0 = area(b, c, p) / A; const w1 = area(c, a, p) / A; const w2 = area(a, b, p) / A;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) return null;
      return typeof key === 'function' ? key(w0, w1, w2) : key;
    });
  }
  function line(L, x0, y0, x1, y1, key, w = 1) {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t;
      if (w <= 1) L.set(Math.floor(x), Math.floor(y), key);
      else ellipse(L, x, y, w / 2, w / 2, key);
    }
    return L;
  }
  /** Flame/teardrop pointing up (or rotated), with a hot core. */
  function flame(L, cx, by, w, h, outer = 'A', inner = 'C', rot = 0) {
    const c = Math.cos(rot); const s = Math.sin(rot); const R = Math.max(w, h) + 1;
    const cy = by - h / 2;
    return L.fill(cx - R, cy - R, cx + R, cy + R, (x, y) => {
      const dx = x - cx; const dy = y - cy;
      const u = (dx * c + dy * s) / (w / 2); const v = (-dx * s + dy * c) / (h / 2);
      if (v < -1 || v > 1) return null;
      const hw = v > 0.25 ? Math.sqrt(Math.max(0, 1 - ((v - 0.25) / 0.75) ** 2)) : Math.pow((v + 1) / 1.25, 0.9) * (1 + 0.12 * Math.sin((v + 1) * 5));
      if (Math.abs(u) > hw) return null;
      return Math.abs(u) < hw * 0.5 && v > -0.35 ? inner : outer;
    });
  }

  /* -------------------------------------------------------------- body */
  const ASPECT = {
    round: [1, 1], wide: [1.18, 0.86], tall: [0.84, 1.16], egg: [0.95, 1.06], drop: [0.9, 1.12], slime: [1.14, 0.86],
    ghost: [0.9, 1.12], block: [1, 0.98], diamond: [0.92, 1.12], cloud: [1.22, 0.84], pear: [1, 1.06], bell: [0.98, 1.06],
  };
  function inside(shape, u, v) {
    switch (shape) {
      case 'egg': return Math.abs(u) <= Math.sqrt(Math.max(0, 1 - v * v)) * (0.86 + 0.14 * v);
      case 'pear': return Math.abs(u) <= Math.sqrt(Math.max(0, 1 - v * v)) * (0.78 + 0.22 * v);
      case 'drop': return v >= 0 ? u * u + v * v <= 1 : Math.abs(u) <= Math.pow(1 + v, 0.72);
      case 'slime': return v <= 1 && Math.abs(u) <= (v < 0.3 ? Math.sqrt(Math.max(0, 1 - ((v - 0.3) / 1.3) ** 2)) : 1 - ((v - 0.3) / 0.7) ** 6 * 0.25);
      case 'ghost': {
        if (v < -0.1) return Math.abs(u) <= Math.sqrt(Math.max(0, 1 - ((v + 0.1) / 0.9) ** 2));
        return Math.abs(u) <= 1 && v <= 1 - 0.3 * (0.5 + 0.5 * Math.cos(u * Math.PI * 3));
      }
      case 'block': return Math.abs(u) ** 3.2 + Math.abs(v) ** 3.2 <= 1;
      case 'diamond': return Math.abs(u) ** 1.35 + Math.abs(v) ** 1.35 <= 1;
      case 'bell': return v <= 1 && Math.abs(u) <= (v < 0.55 ? Math.sqrt(Math.max(0, 1 - ((v - 0.55) / 1.55) ** 2)) * (0.82 + 0.18 * (v + 1) / 1.55) : 1);
      case 'cloud': {
        const circ = [[-0.5, 0.25, 0.56], [0.5, 0.25, 0.56], [0, -0.22, 0.68], [-0.28, 0.5, 0.5], [0.28, 0.5, 0.5]];
        return circ.some(([a, b, r]) => (u - a) ** 2 + ((v - b) * 1.05) ** 2 <= r * r);
      }
      default: return u * u + v * v <= 1;
    }
  }

  /* ----------------------------------------------------------- compose */
  function outlineRing(layer) {
    const ring = [];
    for (const i of layer.cells.keys()) {
      const x = i % N; const y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (!layer.cells.has(ny * N + nx)) ring.push(ny * N + nx);
      }
    }
    return ring;
  }

  /**
   * Paint one sprite. Returns { px: Array(N*N) of colour keys or null, pal }.
   * spec: an evolution line ({ id, art, stages }) or a boss ({ id, art, boss: true }).
   */
  function paint(spec, stage, opts = {}) {
    const a = spec.art;
    const n = spec.names ? spec.names.length : 1;
    stage = clamp(stage || 1, 1, n);
    const f = n > 1 ? (stage - 1) / (n - 1) : 1;
    const R = rng(spec.id);
    const P = (k) => pick(a[k], stage);
    const shape = P('body') || 'round';
    const [ax, ay] = ASPECT[shape] || ASPECT.round;
    const sz = (a.sz || 1) * (spec.boss ? 1.18 : 1);
    let W = Math.min(25, (10 + 9.5 * f) * ax * sz);
    let H = Math.min(23, (9 + 9 * f) * ay * sz);
    W = Math.round(W); H = Math.round(H);
    const floats = !!pick(a.float, stage) || /ghost|cloud/.test(shape) && !P('feet');
    const feet = floats ? '' : (P('feet') || 'stubby');
    const cx = 16;
    const bottom = GROUND - (feet ? 1.2 : 0) - (floats ? 3.5 : 0);
    const top = bottom - H;
    const cy = bottom - H / 2;
    const k = W / 20;
    const ctx = { cx, cy, top, bottom, W, H, k, f, stage, R };

    const back = []; const front = []; const inner = new Layer(); const deco = new Layer();

    /* shadow for floaters */
    const shadow = new Layer();
    if (floats) ellipse(shadow, cx, GROUND, Math.max(2.5, W * 0.32), 1.1, 'S');

    /* body */
    const body = new Layer();
    body.fill(cx - W / 2 - 1, top - 1, cx + W / 2 + 1, bottom + 1, (x, y) => {
      const u = (x - cx) / (W / 2); const v = (y - cy) / (H / 2);
      return inside(shape, u, v) ? shadeKey(u, v) : null;
    });
    if (feet) {
      const fk = feet.includes(':') ? feet.split(':')[1] : 'm';
      for (const s of [-1, 1]) ellipse(body, cx + s * Math.max(2, W * 0.22), bottom + 0.4, Math.max(1.4, W * 0.13), 1.6, fk);
    }

    /* ears */
    for (const { k: e } of partsOf(a.ears, stage)) {
      const L = new Layer();
      for (const s of [-1, 1]) {
        if (e === 'point' || e === 'tuft' || e === 'flame') {
          const sc = e === 'tuft' ? 0.6 : 1;
          const b0 = [cx + s * W * 0.1, top + H * 0.26]; const b1 = [cx + s * W * 0.44, top + H * 0.3];
          const ap = [cx + s * W * 0.36, top - H * 0.3 * sc];
          if (e === 'flame') { flame(L, cx + s * W * 0.3, top + H * 0.3, W * 0.3, H * 0.62, 'A', 'C', s * 0.35); continue; }
          tri(L, b0, b1, ap, (w0, w1, w2) => (w2 > 0.25 && w0 > 0.2 && w1 > 0.2 && e !== 'tuft' ? 'B' : s > 0 ? 'm' : 'M'));
        } else if (e === 'round') {
          const r = Math.max(1.8, W * 0.17);
          ellipse(L, cx + s * W * 0.33, top + H * 0.1, r, r, (u, v) => (u * u + v * v < 0.3 ? 'B' : 'M'));
        } else if (e === 'long') {
          ellipse(L, cx + s * W * 0.2, top - H * 0.22, Math.max(1.5, W * 0.11), H * 0.45, (u) => (Math.abs(u) < 0.4 ? 'B' : 'M'), s * 0.15);
        } else if (e === 'fin') {
          tri(L, [cx + s * W * 0.4, cy - H * 0.2], [cx + s * W * 0.4, cy + H * 0.12], [cx + s * (W * 0.5 + 4 * k + 1), cy - H * 0.3], (w0, w1, w2) => (w2 > 0.4 ? 'C' : 'A'));
        } else if (e === 'leaf') {
          ellipse(L, cx + s * W * 0.36, top - H * 0.02, Math.max(1.3, W * 0.1), H * 0.3, (u) => (Math.abs(u) < 0.25 ? 'a' : 'A'), s * 0.7);
        } else if (e === 'gills') {
          for (let i = 0; i < 3; i++) {
            const y0 = top + H * (0.18 + i * 0.16); const x0 = cx + s * W * 0.42;
            line(L, x0, y0, x0 + s * (2 + 2.5 * k), y0 - 1.5 - i * 0.3, 'A', 1.6);
            L.set(Math.floor(x0 + s * (2 + 2.5 * k)), Math.floor(y0 - 1.5), 'C');
          }
        }
      }
      back.push(L);
    }

    /* crest / head parts */
    const crestParts = partsOf(a.crest, stage);
    for (const { k: c, arg } of crestParts) {
      const L = new Layer();
      const hx = cx; const ty = top + H * 0.14;
      switch (c) {
        case 'sprout': {
          const h = 2.5 + 3 * k;
          line(L, hx, ty, hx, ty - h, 'a', 1);
          ellipse(L, hx - 1.6 - k, ty - h + 0.5, 1.6 + k * 1.2, 0.9 + k * 0.6, 'A', -0.4);
          ellipse(L, hx + 1.6 + k, ty - h + 0.5, 1.6 + k * 1.2, 0.9 + k * 0.6, 'A', 0.4);
          back.push(L); break;
        }
        case 'flame': flame(L, hx, ty + 1, W * 0.36, H * (0.5 + 0.12 * f), 'A', 'C'); back.push(L); break;
        case 'drop': {
          const w = W * 0.22; const h = H * 0.34;
          L.fill(hx - w, ty - h, hx + w, ty + 1, (x, y) => { const u = (x - hx) / w; const v = (y - (ty - h / 2)) / (h / 2); return inside('drop', u, v) ? (u < -0.2 && v < 0.2 ? 'C' : 'A') : null; });
          back.push(L); break;
        }
        case 'horn': tri(L, [hx - Math.max(1.2, W * 0.08), ty + 1], [hx + Math.max(1.2, W * 0.08), ty + 1], [hx, ty - H * 0.42], (w0) => (w0 > 0.5 ? 'c' : 'C')); back.push(L); break;
        case 'horns': {
          for (const s of [-1, 1]) tri(L, [cx + s * W * 0.14, ty + 1], [cx + s * W * 0.32, ty + 1.5], [cx + s * W * 0.38, ty - H * 0.36], (w0, w1) => (w1 > 0.45 ? 'c' : 'C'));
          back.push(L); break;
        }
        case 'antlers': {
          for (const s of [-1, 1]) {
            const x0 = cx + s * W * 0.2; const x1 = cx + s * W * 0.42; const y1 = ty - H * 0.42;
            line(L, x0, ty + 1, x1, y1, 'C', 1.6);
            line(L, cx + s * W * 0.3, ty - H * 0.18, cx + s * W * 0.16, ty - H * 0.4, 'C', 1.4);
            if (f > 0.6) line(L, cx + s * W * 0.38, ty - H * 0.32, cx + s * W * 0.55, ty - H * 0.42, 'C', 1.4);
            if (arg === 'leaf') ellipse(L, x1, y1, 1.6 + k, 1.2 + k * 0.6, 'A');
          }
          back.push(L); break;
        }
        case 'crystal': {
          const w = Math.max(2, W * 0.16); const h = H * 0.42;
          L.fill(hx - w, ty - h, hx + w, ty + 1, (x, y) => { const u = (x - hx) / w; const v = (y - (ty - h / 2)) / (h / 2); return Math.abs(u) + Math.abs(v) <= 1.05 ? (u < 0 ? 'C' : 'A') : null; });
          if (f > 0.5) for (const s of [-1, 1]) { const x2 = hx + s * W * 0.22; L.fill(x2 - w * 0.6, ty - h * 0.6, x2 + w * 0.6, ty + 1, (x, y) => { const u = (x - x2) / (w * 0.6); const v = (y - (ty - h * 0.3)) / (h * 0.3); return Math.abs(u) + Math.abs(v) <= 1.05 ? (u < 0 ? 'C' : 'A') : null; }); }
          back.push(L); break;
        }
        case 'antenna':
        case 'eyestalks': {
          for (const s of [-1, 1]) {
            const x1 = cx + s * W * 0.28; const y1 = ty - H * 0.32;
            line(L, cx + s * W * 0.12, ty + 1, x1, y1, c === 'eyestalks' ? 'M' : 'a', 1);
            if (c === 'eyestalks') { ellipse(L, x1, y1, 1.7 + k * 0.4, 1.7 + k * 0.4, 'W'); L.set(Math.floor(x1 + s * 0.4), Math.floor(y1), 'E'); }
            else ellipse(L, x1, y1, 1.1 + k * 0.4, 1.1 + k * 0.4, 'A');
          }
          back.push(L); break;
        }
        case 'flower': {
          const fy = ty - H * 0.12; const r = 1.3 + k * 1.1; const d = 1.4 + k * 1.3;
          const petal = arg || 'C';
          for (let i = 0; i < 5; i++) { const ang = -Math.PI / 2 + i * (Math.PI * 2 / 5); ellipse(L, hx + Math.cos(ang) * d, fy + Math.sin(ang) * d, r, r, petal); }
          ellipse(L, hx, fy, r * 0.8, r * 0.8, 'G');
          back.push(L); break;
        }
        case 'bush': {
          const by = ty - H * 0.12;
          for (const [dx, dy, r] of [[-0.3, 0.05, 0.3], [0.3, 0.05, 0.3], [0, -0.18, 0.36], [-0.15, -0.05, 0.3], [0.15, -0.05, 0.3]]) ellipse(L, hx + dx * W, by + dy * H, r * W, r * W * 0.85, (u, v) => shadeKey(u, v, 'A', 'a', 'C'));
          if (arg === 'fruit') for (const [dx, dy] of [[-0.28, -0.05], [0.22, -0.2], [0.05, 0.05]]) L.set(Math.floor(hx + dx * W), Math.floor(by + dy * H), 'K');
          back.push(L); break;
        }
        case 'mane': {
          const my = top + H * 0.42; const r = W * 0.64;
          L.fill(cx - r - 3, my - r - 3, cx + r + 3, my + r + 3, (x, y) => {
            const dx = x - cx; const dy = (y - my) * 1.05; const ang = Math.atan2(dy, dx); const rr = r * (1 + 0.13 * Math.cos(ang * 9));
            const d = Math.sqrt(dx * dx + dy * dy);
            return d <= rr ? (d > rr - 1.6 ? 'C' : 'A') : null;
          });
          back.push(L); break;
        }
        case 'volcano': {
          const w = W * 0.3; const h = H * 0.5;
          L.fill(hx - w, ty - h, hx + w, ty + 1, (x, y) => { const v = (y - (ty - h)) / h; const hw = w * (0.45 + 0.55 * v); if (Math.abs(x - hx) > hw) return null; return v < 0.25 ? (Math.abs(x - hx) < hw * 0.6 ? 'C' : 'A') : (x < hx ? 'L' : 'm'); });
          back.push(L); break;
        }
        case 'spikes': {
          const cnt = 3 + Math.round(f * 2);
          for (let i = 0; i < cnt; i++) { const t = cnt === 1 ? 0 : i / (cnt - 1) - 0.5; const x = cx + t * W * 0.62; tri(L, [x - 1.6 - k, ty + 1 + Math.abs(t) * 3], [x + 1.6 + k, ty + 1 + Math.abs(t) * 3], [x + t * 2, ty - H * 0.22 + Math.abs(t) * 3], 'a'); }
          back.push(L); break;
        }
        case 'tuft': {
          for (const dx of [-1.5, 0, 1.5]) line(L, hx + dx * 0.6, ty + 1, hx + dx * (1 + k), ty - 2 - 2 * k - (dx === 0 ? 1 : 0), 'm', 1.4);
          back.push(L); break;
        }
        case 'stem': {
          line(L, hx, ty + 1, hx + 1, ty - 2 - 2 * k, 'a', 2); ellipse(L, hx + 2.5 + k, ty - 1.5 - k, 1.6 + k, 0.9 + k * 0.4, 'C', 0.5);
          back.push(L); break;
        }
        case 'moon': {
          const mx = cx - W * 0.42; const my = top - H * 0.08; const r = 2 + 2 * k;
          L.fill(mx - r, my - r, mx + r, my + r, (x, y) => ((x - mx) ** 2 + (y - my) ** 2 <= r * r && (x - mx - r * 0.55) ** 2 + (y - my + r * 0.2) ** 2 > (r * 0.8) ** 2 ? 'G' : null));
          back.push(L); break;
        }
        case 'cap': {
          const cy2 = top + H * 0.18; const rx = W * 0.66 + 1; const ry = H * 0.5;
          const spots = [[-0.45, -0.35], [0.2, -0.55], [0.5, -0.1], [-0.1, -0.05]];
          L.fill(cx - rx, cy2 - ry, cx + rx, cy2 + ry * 0.4, (x, y) => {
            const u = (x - cx) / rx; const v = (y - cy2) / ry;
            if (v > 0.32 || u * u + v * v > 1) return null;
            if (spots.some(([su, sv]) => (u - su) ** 2 + (v - sv) ** 2 < 0.028 + 0.01 * f)) return 'W';
            return v > 0.16 ? 'a' : shadeKey(u, v, 'A', 'a', 'C');
          });
          front.push(L); break;
        }
        case 'crown': {
          const cw = Math.max(3, W * 0.22); const by = top + 1.5;
          L.fill(cx - cw, by - 3.5 - k, cx + cw, by, (x, y) => {
            const u = (x - cx) / cw; const h = by - y;
            if (Math.abs(u) > 1) return null;
            if (h <= 1.6) return y > by - 0.8 ? 'g' : 'G';
            const peaks = [-0.8, 0, 0.8];
            return peaks.some((p) => Math.abs(u - p) < 0.28 - (h - 1.6) * 0.06) ? 'G' : null;
          });
          L.set(cx - 1, Math.floor(by - 1.2), 'A'); L.set(cx, Math.floor(by - 1.2), 'A');
          front.push(L); break;
        }
        case 'halo': {
          const hy = top - 2.5 - k; const rx = W * 0.3 + 1;
          for (let x = -rx; x <= rx; x += 0.5) { const yy = hy + Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) * 0.01; deco.set(Math.floor(cx + x), Math.floor(yy + (Math.abs(x) > rx * 0.7 ? 1 : 0)), 'H'); }
          break;
        }
        case 'gem': {
          const gy = Math.floor(top + H * 0.22);
          for (const [dx, dy, kk] of [[0, 0, 'A'], [-1, 1, 'A'], [0, 1, 'W'], [1, 1, 'A'], [0, 2, 'a'], [-1, 0, 'a'], [1, 0, 'a']]) inner.set(cx - 1 + dx + 1, gy + dy, kk);
          break;
        }
        case 'hood': {
          const ry = H * 0.62; const rx = W * 0.58 + 1;
          L.fill(cx - rx, top - 2, cx + rx, top + ry, (x, y) => {
            const u = (x - cx) / rx; const v = (y - (top + ry * 0.55)) / ry;
            if (u * u + v * v > 1) return null;
            const iu = (x - cx) / (rx * 0.62); const iv = (y - (top + ry * 0.78)) / (ry * 0.62);
            if (iu * iu + iv * iv < 1) return null;
            return shadeKey(u, v, 'A', 'a', 'C');
          });
          front.push(L); break;
        }
        default: break;
      }
    }

    /* tail */
    for (const { k: t, arg } of partsOf(a.tail, stage)) {
      const L = new Layer();
      const tx = cx + W * 0.42; const tyy = bottom - H * 0.32;
      switch (t) {
        case 'flame': flame(L, cx + W * 0.5 + k * 1.5, tyy + 1, W * 0.3, H * 0.6, 'A', 'C', 0.35); break;
        case 'leaf': ellipse(L, tx + 2 + 2 * k, tyy - 2 - 2 * k, Math.max(1.4, W * 0.11), H * 0.32, (u) => (Math.abs(u) < 0.25 ? 'a' : 'A'), 0.7); break;
        case 'fish': {
          const fx = tx + 1;
          tri(L, [fx, tyy - 1], [fx + 3 + 4 * k, tyy - 4 - 3 * k], [fx + 2 + 3 * k, tyy + 0.5], 'A');
          tri(L, [fx, tyy], [fx + 3 + 4 * k, tyy + 3 + 2 * k], [fx + 2 + 3 * k, tyy - 0.5], 'a');
          break;
        }
        case 'curl': {
          const ccx = tx + 2 + 2 * k; const ccy = tyy - 2; const r = 2 + 1.5 * k;
          L.fill(ccx - r - 1, ccy - r - 1, ccx + r + 1, ccy + r + 1, (x, y) => { const d = Math.hypot(x - ccx, y - ccy); return d <= r && d >= r - 1.6 ? 'M' : null; });
          line(L, tx - 1, tyy + 1, ccx - r * 0.5, ccy + r * 0.8, 'M', 1.6);
          break;
        }
        case 'fluffy': {
          const count = +(arg || 1);
          for (let i = 0; i < count; i++) {
            const multi = count > 1;
            const ox = multi ? cx : tx; const oy = multi ? cy + H * 0.1 : tyy;
            const ang = !multi ? 0.75 : -1.25 + i * (2.5 / (count - 1));
            const len = multi ? H * 0.62 + 2 : H * 0.36; const ex = ox + Math.sin(ang) * len; const ey = oy - Math.cos(ang) * len;
            ellipse(L, (ox + ex) / 2 + Math.sin(ang) * len * 0.15, (oy + ey) / 2 - Math.cos(ang) * len * 0.15, Math.max(1.4, W * (count > 2 ? 0.09 : 0.13)), len * 0.62, (u, v) => (v < -0.45 ? 'B' : shadeKey(u, v, i % 2 ? 'm' : 'M', 'm', 'L')), ang);
          }
          break;
        }
        case 'long': {
          const pts = [[tx - 1, tyy + 1], [tx + 3 + 2 * k, tyy], [tx + 4 + 3 * k, tyy - 3 - 2 * k], [tx + 3 + 3 * k, tyy - 6 - 3 * k]];
          for (let i = 0; i < pts.length - 1; i++) line(L, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 'M', 1.5 + k * 0.5);
          const [ex, ey] = pts[pts.length - 1];
          ellipse(L, ex, ey, 1.4 + k * 0.6, 1.4 + k * 0.6, arg === 'flame' ? 'C' : 'A');
          break;
        }
        case 'spike': {
          tri(L, [tx - 1, tyy - 2], [tx - 1, tyy + 2], [tx + 4 + 5 * k, tyy + 1], (w0, w1, w2) => (w2 > 0.55 ? 'm' : 'M'));
          tri(L, [tx + 1 + k, tyy - 1], [tx + 2.5 + 2 * k, tyy - 1], [tx + 2 + 1.5 * k, tyy - 3 - 1.5 * k], 'a');
          break;
        }
        case 'rain': {
          for (const [dx, dy] of [[-0.25, 2], [0.05, 3.5], [0.3, 1.8]]) { const x = Math.floor(cx + dx * W); const y = Math.floor(bottom + dy); if (y < N - 1) { deco.set(x, y, 'A'); deco.set(x, y + 1, 'A'); } }
          break;
        }
        case 'tentacles': {
          const cnt = 3 + Math.round(f * 2);
          for (let i = 0; i < cnt; i++) {
            const x0 = cx + (cnt === 1 ? 0 : (i / (cnt - 1) - 0.5)) * W * 0.62;
            for (let y = bottom - 1; y < Math.min(GROUND + 1, bottom + 3 + H * 0.3); y++) L.set(Math.floor(x0 + Math.sin((y + i * 2) * 0.9) * 0.8), y, i % 2 ? 'A' : 'M');
          }
          break;
        }
        case 'ribbon': {
          let x = tx; let y = tyy;
          for (let i = 0; i < 4 + Math.round(f * 2); i++) { const nx = x + 2; const ny = y + (i % 2 ? -2 : 2); line(L, x, y, nx, ny, 'M', 1); x = nx; y = ny; if (i % 2) { L.set(Math.floor(x), Math.floor(y) - 1, 'A'); L.set(Math.floor(x), Math.floor(y) + 1, 'A'); L.set(Math.floor(x) + 1, Math.floor(y), 'C'); } }
          break;
        }
        default: break;
      }
      back.unshift(L);
    }

    /* wings (sized so they never run off the 32px canvas) */
    for (const { k: w } of partsOf(a.wings, stage)) {
      const L = new Layer();
      const wy = top + H * 0.42;
      const avail = Math.max(2.5, 15.2 - W * 0.5);
      const reach = { feather: 1.25, leaf: 1.25, tiny: 0.8, bat: 1.3, fairy: 1.45, insect: 1.7, flame: 1.15, fin: 1.25, cosmic: 1.4 }[w] || 1.3;
      const ww = Math.min(W * 0.3 * (0.75 + 0.45 * f) + 1.2, avail / reach);
      const wh = Math.min(H * 0.3 + 1, 9);
      for (const s of [-1, 1]) {
        const edge = cx + s * W * 0.5;
        if (w === 'feather' || w === 'leaf' || w === 'tiny') {
          const sc = w === 'tiny' ? 0.6 : 1;
          ellipse(L, edge + s * (ww * 0.55 * sc - 0.5), wy + 0.5, ww * 0.62 * sc + 0.4, wh * sc, (u, v) => {
            if (w === 'leaf') return Math.abs(u) < 0.2 ? 'a' : 'A';
            if (v > 0.3 && Math.abs(Math.sin(v * 9)) > 0.8) return 'm';
            return u * s < -0.2 ? 'm' : v < -0.4 ? 'L' : 'M';
          }, s * 0.5);
        } else if (w === 'bat') {
          const sx = cx + s * W * 0.36; const sy = wy - H * 0.18;
          const tipx = edge + s * ww * 1.25; const tipy = wy - H * 0.45;
          const b1 = [edge + s * ww * 1.05, wy + H * 0.14]; const b2 = [edge + s * ww * 0.55, wy + H * 0.04]; const b3 = [sx, wy + H * 0.2];
          tri(L, [sx, sy], [tipx, tipy], b1, 'A'); tri(L, [sx, sy], b1, b2, 'A'); tri(L, [sx, sy], b2, b3, 'A');
          line(L, sx, sy, tipx, tipy, 'a', 1); line(L, sx, sy, b2[0], b2[1], 'a', 1);
        } else if (w === 'fairy') {
          ellipse(L, edge + s * ww * 0.55, wy - H * 0.16, ww * 0.85, wh * 0.9, (u, v) => (u * u + v * v > 0.55 ? 'C' : 'W'), s * -0.6);
          ellipse(L, edge + s * ww * 0.4, wy + H * 0.18, ww * 0.55, wh * 0.55, (u, v) => (u * u + v * v > 0.5 ? 'C' : 'W'), s * 0.5);
        } else if (w === 'insect') {
          for (const [dy, rot] of [[-0.16, -0.25], [0.12, 0.25]]) ellipse(L, edge + s * ww * 0.7, wy + dy * H, ww * 0.95, Math.max(1.3, wh * 0.36), (u, v) => (Math.abs(v) < 0.3 && u * s > 0 ? 'W' : 'C'), s * rot);
        } else if (w === 'flame') {
          flame(L, edge + s * ww * 0.45, wy + wh * 0.5, ww * 1.0, wh * 1.8, 'A', 'C', s * 1.0);
        } else if (w === 'fin') {
          tri(L, [cx + s * W * 0.4, wy - H * 0.2], [cx + s * W * 0.4, wy + H * 0.2], [edge + s * ww * 1.2, wy - H * 0.38], (w0, w1, w2) => (w2 > 0.45 ? 'C' : 'A'));
        } else if (w === 'cosmic') {
          ellipse(L, edge + s * ww * 0.5, wy - H * 0.05, ww * 0.85, wh * 1.05, (u, v) => (((Math.floor((u + 2) * 5) * 7 + Math.floor((v + 2) * 5) * 3) % 11 === 0) ? 'H' : u * u + v * v > 0.62 ? 'A' : 'm'), s * -0.5);
        }
      }
      back.push(L);
    }

    /* arms (in front of the body) */
    for (const { k: ar } of partsOf(a.arms, stage)) {
      const L = new Layer();
      for (const s of [-1, 1]) {
        if (ar === 'nubs') ellipse(L, cx + s * W * 0.47, cy + H * 0.1, Math.max(1.4, W * 0.09), Math.max(1.6, H * 0.12), (u, v) => shadeKey(u, v));
        else if (ar === 'claws') {
          const r = Math.max(2, W * 0.15); const ccx = cx + s * (W * 0.5 + r * 0.4); const ccy = cy + H * 0.05;
          ellipse(L, ccx, ccy, r, r, (u, v) => (v < 0 && Math.abs(u) < 0.28 ? null : shadeKey(u, v, 'A', 'a', 'C')));
        }
      }
      front.unshift(L);
    }

    /* belly + patterns (clipped to the body) */
    const inBody = (x, y) => body.has(x, y);
    const pat = P('pat');
    const belly = pat.includes('belly');
    if (belly) {
      const by = cy + H * 0.2; const rx = W * 0.3; const ry = H * 0.27;
      for (const [i] of body.cells) {
        const x = i % N; const y = (i / N) | 0;
        const u = (x + 0.5 - cx) / rx; const v = (y + 0.5 - by) / ry;
        if (u * u + v * v <= 1) inner.set(x, y, v > 0.55 ? 'b' : 'B');
      }
    }
    for (const p of pat.split('+')) {
      if (p === 'spots' || p === 'cracks' || p === 'stars') {
        const cnt = 3 + Math.round(f * 3);
        for (let i = 0; i < cnt; i++) {
          const x = Math.floor(cx + (R() - 0.5) * W * 0.8); const y = Math.floor(top + H * (0.15 + R() * 0.75));
          const keyc = p === 'stars' ? 'W' : p === 'cracks' ? 'C' : 'A';
          if (inBody(x, y) && !inner.has(x, y)) inner.set(x, y, keyc);
          if (p !== 'stars' && inBody(x + 1, y) && !inner.has(x + 1, y) && R() > 0.4) inner.set(x + 1, y, p === 'cracks' ? 'A' : 'a');
        }
      } else if (p === 'stripes') {
        for (const dx of [-0.24, 0, 0.24]) {
          const x = Math.floor(cx + dx * W);
          for (let y = Math.floor(top); y < top + 2 + 2 * k; y++) if (inBody(x, y)) inner.set(x, y, 'a');
        }
      } else if (p === 'bands') {
        for (let y = Math.floor(top + H * 0.2); y < bottom - 1; y += 3) for (let x = 0; x < N; x++) if (inBody(x, y) && !inner.has(x, y)) inner.set(x, y, 'a');
      } else if (p === 'mask') {
        const ey = Math.floor(top + H * 0.38);
        for (let y = ey; y < ey + 3 + Math.round(k); y++) for (let x = 0; x < N; x++) if (inBody(x, y) && Math.abs(x + 0.5 - cx) > 1) inner.set(x, y, 'A');
      } else if (p === 'chest') {
        const y0 = Math.floor(cy + H * 0.02);
        for (let i = 0; i < 3 + Math.round(k * 2); i++) for (let x = Math.floor(cx - i * 0.7 - 1); x <= Math.ceil(cx + i * 0.7); x++) if (inBody(x, y0 + i) && Math.abs(x + 0.5 - cx) <= (2.5 + k * 2) - i * 0.6) inner.set(x, y0 + i, 'C');
      } else if (p === 'shell') {
        const y0 = Math.floor(top + H * 0.08);
        for (const [i] of body.cells) { const x = i % N; const y = (i / N) | 0; if (y < cy + H * 0.12 && y >= y0) { const hex = ((x + (y % 2) * 2) % 4 === 0) || y === Math.floor(cy + H * 0.1); inner.set(x, y, hex ? 'a' : (y < top + H * 0.22 ? 'L' : 'A')); } }
      }
    }

    /* face */
    const eyes = P('eyes') || 'dot';
    const small = W < 14;
    const ey = Math.round(top + H * (shape === 'cloud' ? 0.42 : shape === 'slime' ? 0.4 : shape === 'drop' ? 0.5 : 0.4));
    const gap = Math.max(1.5, Math.round(W * 0.18));
    const eyeKey = a.eye ? 'E' : 'E';
    const setF = (x, y, kk) => { if (inBody(x, y) || kk === 'W') inner.set(x, y, kk); };
    const ew = eyes === 'big' || eyes === 'happy' || eyes === 'sharp' || eyes === 'angry' ? 3 : 2;
    const eh = eyes === 'sleepy' || eyes === 'happy' ? 2 : small ? 2 : 3;
    let mouthY = ey + eh + (small ? 0 : 1);
    if (eyes === 'cyclops') {
      const r = small ? 2 : 3;
      for (let dy = -r; dy < r; dy++) for (let dx = -r; dx < r; dx++) { const d = (dx + 0.5) ** 2 + (dy + 0.5) ** 2; if (d < r * r) setF(cx + dx, ey + dy + 1, d < (r - 1.2) ** 2 ? 'E' : 'W'); }
      setF(cx - 1, ey, 'W');
      mouthY = ey + r + 2;
    } else {
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? cx - gap - ew : cx + gap;
        const mir = (i) => (s < 0 ? x0 + i : x0 + ew - 1 - i); // i counted from the outer side
        if (eyes === 'happy') { setF(mir(0), ey + 1, eyeKey); setF(mir(1), ey, eyeKey); setF(mir(2), ey + 1, eyeKey); }
        else if (eyes === 'sleepy') { for (let i = 0; i < ew; i++) setF(x0 + i, ey + 1, eyeKey); }
        else if (eyes === 'sharp' || eyes === 'angry') {
          setF(mir(0), ey, eyeKey); setF(mir(1), ey, eyeKey);
          for (let i = 0; i < 3; i++) setF(mir(i), ey + 1, eyeKey);
          if (!small) { setF(mir(1), ey + 2, eyeKey); setF(mir(2), ey + 2, eyeKey); }
          if (eyes === 'angry') { setF(mir(0), ey - 3, 'X'); setF(mir(1), ey - 2, 'X'); setF(mir(2), ey - 1, 'X'); setF(mir(2), ey - 2, 'X'); }
        } else {
          const ek = eyes === 'glow' && !a.eye ? 'C' : eyeKey;
          for (let dy = 0; dy < eh; dy++) for (let i = 0; i < ew; i++) setF(x0 + i, ey + dy, ek);
          setF(mir(0), ey, 'W');
          if (eyes === 'big') setF(mir(1), ey, 'W');
        }
      }
    }
    // cheeks
    if (a.cheeks !== false && !spec.boss && !small && eyes !== 'cyclops') for (const s of [-1, 1]) { const x = s < 0 ? cx - gap - 3 : cx + gap + 2; setF(x, ey + eh, 'K'); if (W > 17) setF(x + (s < 0 ? -1 : 1), ey + eh, 'K'); }
    // mouth
    const mouth = P('mouth') || 'smile';
    const my = mouthY;
    if (mouth === 'smile') { if (small) { setF(15, my, 'X'); setF(16, my, 'X'); } else { setF(14, my, 'X'); setF(15, my + 1, 'X'); setF(16, my + 1, 'X'); setF(17, my, 'X'); } }
    else if (mouth === 'cat') { setF(14, my + 1, 'X'); setF(15, my, 'X'); setF(16, my, 'X'); setF(17, my + 1, 'X'); }
    else if (mouth === 'fang') { setF(14, my, 'X'); setF(15, my, 'X'); setF(16, my, 'X'); setF(17, my, 'X'); setF(16, my + 1, 'W'); setF(14, my + 1, 'W'); }
    else if (mouth === 'open') { setF(15, my, 'X'); setF(16, my, 'X'); setF(15, my + 1, 'K'); setF(16, my + 1, 'K'); }
    else if (mouth === 'beak') { for (let x = 14; x <= 17; x++) setF(x, my - 1, 'G'); setF(15, my, 'g'); setF(16, my, 'g'); }
    else if (mouth === 'snout') { setF(15, my - 1, 'K'); setF(16, my - 1, 'K'); setF(15, my, 'X'); setF(16, my, 'X'); }
    else if (mouth === 'grin') { for (let x = 13; x <= 18; x++) setF(x, my, 'X'); for (let x = 14; x <= 17; x++) setF(x, my + 1, x % 2 ? 'W' : 'X'); }

    /* aura sparkles for the strongest forms */
    const auraOn = !!pick(a.aura, stage);
    if (auraOn) {
      for (const [x, y] of [[4, 8], [27, 6], [2, 20], [29, 18], [8, 2], [24, 26]]) {
        deco.set(x, y, 'H'); if (x > 1) deco.set(x - 1, y, 'C'); if (x < N - 1) deco.set(x + 1, y, 'C'); deco.set(x, y - 1, 'C'); deco.set(x, y + 1, 'C');
      }
    }

    /* composite */
    const px = new Array(N * N).fill(null);
    for (const [i, kk] of shadow.cells) px[i] = kk;
    const put = (L) => { for (const i of outlineRing(L)) px[i] = 'o'; for (const [i, kk] of L.cells) px[i] = kk; };
    for (const L of back) put(L);
    put(body);
    for (const [i, kk] of inner.cells) px[i] = kk;
    for (const L of front) put(L);
    for (const [i, kk] of deco.cells) if (!px[i] || px[i] === 'S') px[i] = kk;
    return { px, pal: palette(a), size: N };
  }

  root.PalArt = { paint, palette, pick, N };
})(typeof window !== 'undefined' ? (window.Q = window.Q || {}) : module.exports);
