'use strict';
/* Journey: trainer card, badges, stats & perks, companion, activity heatmap, log. */

Q.views.journey = (() => {
  const U = Q.util;
  const G = Q.game;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;

  function dayStats(ds) {
    const st = S();
    if (ds === G.today()) {
      const list = G.todaysDailies();
      return { d: list.filter((x) => G.isDone(x)).length, t: list.length, f: (st.dayLog[ds] || {}).f || 0 };
    }
    return st.dayLog[ds] || { d: 0, t: 0, f: 0 };
  }

  function heatmap() {
    const weeks = 20;
    const today = U.parseYmd(G.today());
    const end = U.addDays(today, 6 - ((today.getDay() - S().settings.weekStart + 7) % 7));
    const start = U.addDays(end, -(weeks * 7 - 1));
    let cells = '';
    for (let w = 0; w < weeks; w++) {
      cells += '<div class="hm-col">';
      for (let i = 0; i < 7; i++) {
        const d = U.addDays(start, w * 7 + i); const ds = U.ymd(d);
        const s = dayStats(ds);
        const future = d > today;
        const lvl = future || !s.t ? 0 : s.d === s.t ? 4 : s.d / s.t >= 0.66 ? 3 : s.d / s.t >= 0.33 ? 2 : s.d ? 1 : 0;
        cells += `<i class="hm l${lvl} ${future ? 'future' : ''} ${ds === G.today() ? 'today' : ''}" title="${U.fmtDate(d)}: ${s.t ? `${s.d}/${s.t} dailies` : 'no dailies'}${s.f ? ` · ${s.f} min focus` : ''}"></i>`;
      }
      cells += '</div>';
    }
    return `<div class="heatmap">${cells}</div><div class="hm-legend small muted">Less <i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i> More</div>`;
  }

  function chart14() {
    const today = U.parseYmd(G.today());
    const days = Array.from({ length: 14 }, (_, i) => U.addDays(today, i - 13));
    const data = days.map((date) => ({ date, ...dayStats(U.ymd(date)) }));
    const maxT = Math.max(1, ...data.map((x) => x.t));
    const maxF = Math.max(30, ...data.map((x) => x.f || 0));
    const w = 560, h = 150, pad = 26, bw = (w - pad * 2) / 14;
    const bars = data.map((x, i) => {
      const x0 = pad + i * bw + 3;
      const th = (x.t / maxT) * (h - 50); const dh = (x.d / maxT) * (h - 50);
      return `<rect x="${x0}" y="${h - 24 - th}" width="${bw - 6}" height="${th}" class="c-sched"/><rect x="${x0}" y="${h - 24 - dh}" width="${bw - 6}" height="${dh}" class="c-done"/>
        <text x="${x0 + (bw - 6) / 2}" y="${h - 8}" class="c-lbl">${U.DAYS[x.date.getDay()][0]}</text>`;
    }).join('');
    const pts = data.map((x, i) => `${pad + i * bw + bw / 2},${h - 24 - ((x.f || 0) / maxF) * (h - 50)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" class="chart14" role="img" aria-label="Dailies done vs scheduled over 14 days, with focus minutes">
      <line x1="${pad}" x2="${w - pad}" y1="${h - 24}" y2="${h - 24}" class="c-axis"/>${bars}
      <polyline points="${pts}" class="c-focus"/>${data.map((x, i) => `<rect x="${pad + i * bw + bw / 2 - 2}" y="${h - 24 - ((x.f || 0) / maxF) * (h - 50) - 2}" width="4" height="4" class="c-focus-pt"/>`).join('')}
    </svg>
    <div class="chart-legend small"><span><i class="lg-done"></i>Dailies done</span><span><i class="lg-sched"></i>Scheduled</span><span><i class="lg-focus"></i>Focus minutes (max ${maxF})</span></div>`;
  }

  function render(root) {
    const st = S(); const h = st.hero; const c = st.companion;
    const badges = G.ACH.filter((a) => a.badge);
    const days = Math.max(1, U.diffDays(new Date(), new Date(st.createdAt)) + 1);
    const clvl = G.companionLevel(); const stage = G.companionStage();
    const nextStage = stage === 1 ? 8 : stage === 2 ? 20 : null;
    root.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Your progress</div><h1 class="page-title">Journey</h1></div></div>
      <div class="journey">
        <section class="panel tcard">
          <div class="tcard-head"><span>TRAINER CARD</span><span>ID No. ${esc(st.profile.trainerId)}</span></div>
          <div class="tcard-body">
            <dl>
              <dt>Name</dt><dd>${esc(st.profile.name)}</dd>
              <dt>Title</dt><dd>${G.title(h.level)} · Lv ${h.level}</dd>
              <dt>Gold</dt><dd>${h.gold.toLocaleString()}</dd>
              <dt>Total XP</dt><dd>${Math.floor(h.totalXp).toLocaleString()}</dd>
              <dt>Adventure</dt><dd>${days} ${days === 1 ? 'day' : 'days'}</dd>
              <dt>Tasks done</dt><dd>${st.counters.completions.toLocaleString()}</dd>
            </dl>
            <div class="tcard-sprite">${Q.sprites.trainer(st.profile.outfit, 96)}</div>
          </div>
          <div class="badge-case">${badges.map((a) => `<div class="badge-slot ${st.achievements[a.id] ? 'got' : ''}" title="${a.name}: ${a.desc}">${st.achievements[a.id] ? Q.ui.badgeIcon(a, 34) : '<span></span>'}</div>`).join('')}</div>
        </section>

        <section class="panel stats-panel">
          <div class="panel-title">${I('bolt')} Stats & perks</div>
          <p class="small muted pad-x">Each category you complete trains a stat. Stat levels unlock permanent perks.</p>
          ${Object.entries(G.STATS).map(([k, s]) => {
            const xp = st.stats[k] || 0; const l = G.statLevel(xp);
            const cur = 15 * l * l; const nxt = 15 * (l + 1) * (l + 1);
            const cats = Object.values(Q.store.CATEGORIES).filter((c) => c.stat === k).map((c) => c.name).join(', ');
            return `<div class="stat-row"><span class="stat-name" style="--c:${s.color}">${s.short}</span>
              <div class="stat-main"><div class="stat-top"><b>${s.name}</b><span class="small muted">${cats}</span><span class="stat-lv">Lv ${l}</span></div>
              <div class="bar bar-stat" style="--c:${s.color}"><div class="bar-fill" style="width:${((xp - cur) / (nxt - cur)) * 100}%"></div></div>
              <div class="small">${l ? s.perk(l) : `<span class="muted">Perk at Lv 1: ${s.perk(1)}</span>`}</div></div></div>`;
          }).join('')}
        </section>

        <section class="panel comp-panel">
          <div class="panel-title">${I('heart')} ${esc(c.name)}</div>
          <div class="comp-body">
            <div class="comp-sprite">${Q.sprites.companion(c.species, stage, 112)}</div>
            <div>
              <p><b>${Q.sprites.COMPANIONS[c.species].kind}</b> · Lv ${clvl} · ${G.STAGE_NAMES[stage]} form</p>
              <p class="small muted">Loves ${Q.sprites.COMPANIONS[c.species].likes}. ${nextStage ? `Grows again at level ${nextStage}.` : 'Fully grown!'}</p>
              <div class="hearts big" title="Friendship">${[0, 1, 2, 3, 4].map((i) => `<i class="${(c.friendship || 0) >= (i + 1) * 20 ? 'on' : ''}">${I('heart')}</i>`).join('')}</div>
              <div class="row-btns"><button class="btn btn-small" data-act="use-item" data-item="berry" ${st.inventory.berry ? '' : 'disabled'}>${I('berry')} Feed (${st.inventory.berry})</button>
              <button class="btn btn-small" data-act="rename-companion">${I('edit')} Rename</button></div>
            </div>
          </div>
        </section>

        <section class="panel wide">
          <div class="panel-title">${I('calendar')} Last 20 weeks</div>
          ${heatmap()}
        </section>
        <section class="panel wide">
          <div class="panel-title">${I('bolt')} Last 14 days</div>
          ${chart14()}
        </section>

        <section class="panel wide">
          <div class="panel-title">${I('trophy')} Achievements <span class="small muted">${Object.keys(st.achievements).length}/${G.ACH.length}</span></div>
          <div class="ach-grid">${G.ACH.map((a) => `<div class="ach ${st.achievements[a.id] ? 'got' : ''}">${a.badge ? Q.ui.badgeIcon(st.achievements[a.id] ? a : { badge: '#C9CCD6' }, 30) : `<span class="ach-ico">${I(st.achievements[a.id] ? 'star' : 'lock')}</span>`}
            <div><b>${a.name}</b><p class="small muted">${a.desc}</p>${st.achievements[a.id] ? `<span class="small">${U.fmtDate(new Date(st.achievements[a.id]))}</span>` : ''}</div></div>`).join('')}</div>
        </section>

        <section class="panel wide">
          <div class="panel-title">${I('list')} Adventure log</div>
          <div class="log">${st.log.slice(0, 40).map((l) => `<div class="log-row log-${l.kind}"><span class="log-t">${U.fmtDay(new Date(l.t))} ${U.fmtTime(new Date(l.t))}</span><span>${esc(l.text)}</span>${l.xp ? `<span class="log-r">+${l.xp} XP · +${l.gold} G</span>` : ''}</div>`).join('') || '<p class="muted small pad">Your story starts with the first task you finish.</p>'}</div>
        </section>
      </div>`;
  }

  function bind() {
    Q.ui.on('rename-companion', () => {
      const c = S().companion;
      Q.ui.modal({
        title: 'Rename companion', cls: 'modal-small modal-form',
        body: `<form><label class="field"><span class="field-label">Name</span><input name="n" maxlength="16" value="${esc(c.name)}" required></label>
          <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></form>`,
        onMount(m, close) { m.querySelector('form').onsubmit = (e) => { e.preventDefault(); c.name = m.querySelector('input').value.trim() || c.name; Q.store.commit('companion'); close(); }; },
      });
    });
  }

  return { render, bind };
})();
