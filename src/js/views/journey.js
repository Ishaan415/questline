'use strict';
/* Journey: trainer card, badges, stats & perks, team, weekly review, streak calendar, heatmap, log. */

Q.views.journey = (() => {
  const U = Q.util;
  const G = Q.game;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;
  let calMonth = null;   // first day of the month shown in the streak calendar
  let calDaily = 'all';  // 'all' or a daily id

  function dayStats(ds) {
    const st = S();
    if (ds === G.today()) {
      const list = G.todaysDailies();
      return { d: list.filter((x) => G.isDone(x)).length, t: list.length, f: (st.dayLog[ds] || {}).f || 0 };
    }
    return st.dayLog[ds] || { d: 0, t: 0, f: 0 };
  }

  // Phones show fewer weeks so the grid fits the screen.
  const heatWeeks = () => (Q.platform.isPhone ? 10 : 20);
  function heatmap() {
    const weeks = heatWeeks();
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

  /* ------------------------------------------------------- weekly review */
  const pct = (x) => `${Math.round(x * 100)}%`;
  const weekLabel = (wk) => { const a = U.parseYmd(wk); const b = U.addDays(a, 6); return `${a.getDate()} ${U.MONTHS[a.getMonth()]} – ${b.getDate()} ${U.MONTHS[b.getMonth()]}`; };

  function reviewHtml(sum, { full = true } = {}) {
    const QQ = Q.quests;
    const tiles = [
      ['check', sum.rate === null ? '–' : pct(sum.rate), `dailies done (${sum.totalDone}/${sum.totalSched})`],
      ['hourglass', `${sum.focus}`, `focus minutes · ${sum.sessions} ${sum.sessions === 1 ? 'session' : 'sessions'}`],
      ['bell', `${sum.reminders}`, 'reminders done'],
      ['list', `${sum.bounties}`, 'bounties done'],
    ];
    if (sum.xp) tiles.push(['bolt', `${sum.xp}`, 'XP earned']);
    const day = (x) => (x ? `${U.fmtDate(U.parseYmd(x.ds))} · ${x.d}/${x.t}` : '–');
    const boss = sum.boss ? `${Q.sprites.boss(sum.boss.id, 40)}<span><b>${esc(sum.boss.name)}</b> ${sum.boss.defeated ? '<span class="good">defeated</span>' : `<span class="muted">got away with ${Math.ceil(sum.boss.hp)}/${sum.boss.maxHp} HP</span>`}</span>` : '<span class="muted">No boss record for this week.</span>';
    const struggling = sum.per.filter((x) => x.sched >= 3 && x.rate < 0.5);
    return `<div class="wr">
      <div class="wr-tiles">${tiles.map(([ic, v, l]) => `<div class="wr-tile"><span class="wr-ico">${I(ic)}</span><b>${v}</b><span class="small muted">${l}</span></div>`).join('')}</div>
      <div class="wr-row"><div class="wr-cell"><span class="eyebrow">Best day</span><span>${day(sum.best)}</span></div><div class="wr-cell"><span class="eyebrow">Toughest day</span><span>${day(sum.worst)}</span></div></div>
      <div class="wr-boss">${boss}</div>
      ${sum.perfect ? `<div class="wr-perfect">${I('star')} Perfect week! +100 gold and a Capsule Ticket.</div>` : ''}
      ${full && sum.per.length ? `<div class="wr-dailies"><div class="eyebrow">Each daily</div>
        ${sum.per.map((x) => `<div class="wr-d ${x.rate < 0.5 && x.sched >= 3 ? 'weak' : ''}"><span class="wr-dt">${esc(x.title)}</span><div class="wr-bar"><i style="width:${x.rate * 100}%"></i></div><span class="small wr-dn">${x.done}/${x.sched}</span>
          ${x.rate < 0.5 && x.sched >= 3 ? `<button class="btn btn-small" data-act="edit" data-type="daily" data-id="${x.id}">Adjust</button>` : '<span></span>'}</div>`).join('')}
      </div>` : ''}
      ${full && struggling.length ? `<p class="small muted wr-tip">${I('note')} ${struggling.length === 1 ? `“${esc(struggling[0].title)}” was done less than half the time.` : `${struggling.length} dailies were done less than half the time.`} Making them easier, moving them to a better time or giving them fewer days usually beats dropping them.</p>` : ''}
    </div>`;
  }

  function showWeekly(wk) {
    const sum = Q.quests.weekSummary(wk);
    Q.ui.modal({
      title: `Your week · ${weekLabel(wk)}`, cls: 'modal-form modal-review',
      body: `${reviewHtml(sum)}<div class="modal-actions"><span class="spacer"></span><button class="btn btn-primary" data-close>Start the new week</button></div>`,
      onMount(m, close) { m.querySelectorAll('[data-act="edit"]').forEach((b) => b.addEventListener('click', () => close())); },
    });
  }

  function reviewPanel() {
    const cur = Q.quests.weekOf(G.today());
    const prev = U.ymd(U.addDays(U.parseYmd(cur), -7));
    const sum = Q.quests.weekSummary(prev);
    return `<section class="panel wide">
      <div class="panel-title">${I('calendar')} Last week <span class="small muted">${weekLabel(prev)} · ${S().counters.perfectWeeks || 0} perfect ${S().counters.perfectWeeks === 1 ? 'week' : 'weeks'} so far</span>
        <button class="btn btn-small pt-btn" data-act="weekly-open" data-wk="${prev}">Full review</button></div>
      ${sum.totalSched || sum.focus ? reviewHtml(sum, { full: false }) : '<p class="small muted pad-x">Your first weekly review shows up on the first day of next week.</p>'}
    </section>`;
  }

  /* ------------------------------------------------------ streak calendar */
  function perfectStreak() {
    const st = S(); let cur = 0; let best = 0; let run = 0;
    const days = Object.keys(st.dayLog).sort();
    for (const ds of days) {
      const l = st.dayLog[ds];
      if (!l.t) continue;
      if (l.d >= l.t) { run++; best = Math.max(best, run); } else if (!G.isRestDay(ds)) run = 0;
    }
    // Current: walk back from yesterday (today counts once it's perfect).
    const t = dayStats(G.today());
    if (t.t && t.d >= t.t) cur++;
    for (let d = U.addDays(U.parseYmd(G.today()), -1); ; d = U.addDays(d, -1)) {
      const l = st.dayLog[U.ymd(d)];
      if (!l) break;
      if (!l.t) continue;
      if (l.d >= l.t) cur++; else if (G.isRestDay(U.ymd(d))) continue; else break;
    }
    return { cur, best: Math.max(best, cur) };
  }

  function streakCalendar() {
    const st = S(); const today = G.today();
    if (!calMonth) { const t = U.parseYmd(today); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); }
    const daily = calDaily === 'all' ? null : st.dailies.find((d) => d.id === calDaily);
    if (calDaily !== 'all' && !daily) calDaily = 'all';
    const first = calMonth; const lead = (first.getDay() - st.settings.weekStart + 7) % 7;
    const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const heads = Array.from({ length: 7 }, (_, i) => U.DAYS[(i + st.settings.weekStart) % 7].slice(0, 2));
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="sc-cell blank"></span>';
    for (let k = 1; k <= n; k++) {
      const ds = U.ymd(new Date(first.getFullYear(), first.getMonth(), k));
      const future = ds > today; const rest = G.isRestDay(ds);
      let cls = ''; let tip = U.fmtDate(U.parseYmd(ds));
      if (future) cls = 'future';
      else if (daily) {
        const sched = G.isScheduled(daily, ds) && (daily.createdAt || 0) <= U.at(ds, '23:59').getTime();
        const did = !!(daily.done && daily.done[ds]);
        cls = did ? 'hit' : !sched ? 'off' : ds === today ? 'open' : rest ? 'rest' : 'miss';
        tip += did ? ': done' : !sched ? ': not scheduled' : ds === today ? ': not yet' : rest ? ': rest day' : ': missed';
      } else {
        const s = dayStats(ds);
        if (!s.t) cls = 'off';
        else if (s.d >= s.t) cls = 'perfect';
        else cls = ds === today ? `open l${s.d ? 2 : 0}` : s.d / s.t >= 0.5 ? 'part' : s.d ? 'low' : rest ? 'rest' : 'miss';
        tip += s.t ? `: ${s.d}/${s.t} dailies` : ': no dailies';
      }
      cells += `<span class="sc-cell ${cls} ${ds === today ? 'today' : ''}" title="${tip}"><b>${k}</b>${cls === 'perfect' || cls === 'hit' ? I(cls === 'perfect' ? 'star' : 'check') : ''}</span>`;
    }
    const ps = perfectStreak();
    const stat = daily ? `Current streak <b>${daily.streak || 0}</b> · best <b>${daily.best || 0}</b>` : `Perfect-day streak <b>${ps.cur}</b> · best <b>${ps.best}</b>`;
    const atNow = U.ymd(first) === U.ymd(new Date(U.parseYmd(today).getFullYear(), U.parseYmd(today).getMonth(), 1));
    return `<section class="panel wide streak-cal">
      <div class="panel-title">${I('flame')} Streak calendar <span class="small muted sc-stat">${stat}</span></div>
      <div class="sc-bar">
        <select data-change="sc-daily" aria-label="Show"><option value="all">All dailies (perfect days)</option>${st.dailies.filter((d) => !d.archived).map((d) => `<option value="${d.id}" ${calDaily === d.id ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select>
        <div class="sc-nav"><button class="icon-btn" data-act="sc-month" data-d="-1" aria-label="Previous month">${I('left')}</button><b>${U.MONTHS_LONG[first.getMonth()]} ${first.getFullYear()}</b><button class="icon-btn" data-act="sc-month" data-d="1" aria-label="Next month" ${atNow ? 'disabled' : ''}>${I('right')}</button></div>
      </div>
      <div class="sc-grid">${heads.map((h) => `<span class="sc-head">${h}</span>`).join('')}${cells}</div>
      <div class="sc-legend small muted">${daily
        ? '<span><i class="sc-cell hit"></i>Done</span><span><i class="sc-cell miss"></i>Missed</span><span><i class="sc-cell rest"></i>Rest day</span><span><i class="sc-cell off"></i>Not scheduled</span>'
        : '<span><i class="sc-cell perfect"></i>Perfect day</span><span><i class="sc-cell part"></i>Half or more</span><span><i class="sc-cell low"></i>Some</span><span><i class="sc-cell miss"></i>None</span><span><i class="sc-cell rest"></i>Rest day</span>'}</div>
    </section>`;
  }

  function render(root) {
    const st = S(); const h = st.hero;
    const badges = G.ACH.filter((a) => a.badge);
    const days = Math.max(1, U.diffDays(new Date(), new Date(st.createdAt)) + 1);
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
          <div class="panel-title">${I('paw')} Team <span class="small muted">${Q.pals.count()}/${Q.PALS.LINES.length} pals collected</span></div>
          <div class="jt-team">${Q.pals.team().map((id) => `<button class="jt-pal" data-act="pal-open" data-id="${id}">${Q.pals.sprite(id, 72)}<b>${esc(Q.pals.name(id))}</b><span class="small muted">Lv ${Q.pals.level(id)}</span></button>`).join('')}</div>
          <div class="row-btns"><button class="btn btn-small" data-act="go" data-view="pals">${I('paw')} Open Pals</button></div>
        </section>

        ${reviewPanel()}
        ${streakCalendar()}
        <section class="panel wide">
          <div class="panel-title">${I('calendar')} Last ${heatWeeks()} weeks</div>
          ${heatmap()}
        </section>
        <section class="panel wide">
          <div class="panel-title">${I('bolt')} Last 14 days</div>
          ${chart14()}
        </section>

        <section class="panel wide">
          <div class="panel-title">${I('trophy')} Achievements <span class="small muted">${Object.keys(st.achievements).length}/${G.ACH.length}</span></div>
          <div class="ach-grid">${G.ACH.map((a) => `<div class="ach ${st.achievements[a.id] ? 'got' : ''}">${a.badge ? Q.ui.badgeIcon(st.achievements[a.id] ? a : { badge: '#C9CCD6' }, 30) : `<span class="ach-ico">${I(st.achievements[a.id] ? 'star' : 'lock')}</span>`}
            <div><b>${a.name}</b><p class="small muted">${a.desc}</p>${a.reward ? `<span class="ach-reward small">${G.rewardText(a.reward)}</span>` : ''}${st.achievements[a.id] ? `<span class="small"> · ${U.fmtDate(new Date(st.achievements[a.id]))}</span>` : ''}</div></div>`).join('')}</div>
        </section>

        <section class="panel wide">
          <div class="panel-title">${I('list')} Adventure log</div>
          <div class="log">${st.log.slice(0, 40).map((l) => `<div class="log-row log-${l.kind}"><span class="log-t">${U.fmtDay(new Date(l.t))} ${U.fmtTime(new Date(l.t))}</span><span>${esc(l.text)}</span>${l.xp ? `<span class="log-r">+${l.xp} XP · +${l.gold} G</span>` : ''}</div>`).join('') || '<p class="muted small pad">Your story starts with the first task you finish.</p>'}</div>
        </section>
      </div>`;
  }

  function bind() {
    const on = Q.ui.on;
    on('weekly-open', (el) => showWeekly(el.dataset.wk));
    on('sc-month', (el) => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + +el.dataset.d, 1); Q.app.render(); });
    Q.ui.onChange('sc-daily', (el) => { calDaily = el.value; Q.app.render(); });
  }

  return { render, bind, showWeekly };
})();
