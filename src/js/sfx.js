'use strict';
/* Chiptune sound effects synthesized with WebAudio (no audio files to ship). */

Q.sfx = (() => {
  let ctx = null;
  let noiseBuf = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const vol = () => {
    const s = Q.store && Q.store.state.settings;
    return s && s.sounds ? (s.volume ?? 0.5) * 0.22 : 0;
  };

  function tone(freq, start, dur, { type = 'square', gain = 1, slide = 0 } = {}) {
    const a = ac(); const v = vol();
    if (!a || !v) return;
    const t0 = a.currentTime + start;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v * gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(start, dur, gain = 0.6) {
    const a = ac(); const v = vol();
    if (!a || !v) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = a.createBufferSource();
    const g = a.createGain();
    const t0 = a.currentTime + start;
    src.buffer = noiseBuf;
    g.gain.setValueAtTime(v * gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g).connect(a.destination);
    src.start(t0); src.stop(t0 + dur);
  }

  const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

  const play = {
    click: () => tone(1200, 0, 0.03, { gain: 0.4 }),
    complete: () => { tone(N.E5, 0, 0.07); tone(N.C6, 0.07, 0.12); },
    coin: () => { tone(N.B5, 0, 0.06); tone(N.E6, 0.06, 0.18); },
    uncheck: () => tone(N.C5, 0, 0.1, { slide: -120, gain: 0.6 }),
    hurt: () => { noise(0, 0.18, 0.5); tone(220, 0, 0.18, { slide: -120, type: 'sawtooth', gain: 0.5 }); },
    levelup: () => {
      [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.09, 0.12));
      tone(N.E6, 0.38, 0.12); tone(N.G6, 0.48, 0.3);
      tone(N.C5 / 2, 0, 0.6, { type: 'triangle', gain: 0.8 });
    },
    drop: () => { tone(N.G5, 0, 0.05); tone(N.C6, 0.05, 0.05); tone(N.E6, 0.1, 0.1); },
    alarm: () => { for (let i = 0; i < 3; i++) { tone(N.A5, i * 0.22, 0.09); tone(N.E6, i * 0.22 + 0.1, 0.09); } },
    timer: () => { [N.G5, N.C6, N.E6, N.G6, N.E6, N.G6, N.C7].forEach((f, i) => tone(f, i * 0.11, 0.14, { gain: 0.8 })); },
    boss: () => { noise(0, 0.08, 0.7); tone(180, 0, 0.12, { slide: 140, type: 'square', gain: 0.7 }); },
    victory: () => {
      const seq = [N.G5, N.G5, N.G5, N.C6, N.G5, N.C6, N.E6];
      const len = [0.1, 0.1, 0.1, 0.3, 0.12, 0.12, 0.5];
      let t = 0; seq.forEach((f, i) => { tone(f, t, len[i]); t += len[i] * 0.9; });
    },
    open: () => tone(880, 0, 0.05, { slide: 300, gain: 0.5 }),
  };

  /* Optional ambient rain for focus mode: filtered noise loop. */
  let ambient = null;
  function ambientRain(on) {
    const a = ac();
    if (!a) return;
    if (!on) {
      if (ambient) { try { ambient.src.stop(); } catch (e) { /* already stopped */ } ambient = null; }
      return;
    }
    if (ambient) return;
    const len = a.sampleRate * 2;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = a.createGain(); g.gain.value = Math.max(0.02, vol() * 1.6);
    src.connect(f).connect(g).connect(a.destination);
    src.start();
    ambient = { src, g };
  }

  const safe = (fn) => (...args) => { try { fn(...args); } catch (e) { /* audio is optional */ } };
  const out = {};
  for (const k of Object.keys(play)) out[k] = safe(play[k]);
  out.ambientRain = safe(ambientRain);
  out.unlock = () => { try { ac(); } catch (e) { /* ignore */ } };
  return out;
})();
