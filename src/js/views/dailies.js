'use strict';
/* Dailies (recurring chores with times) grouped by part of day, plus habits. */

Q.views.dailies = (() => {
  const U = Q.util;
  const G = Q.game;
  const C = Q.comp;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;
  let filter = 'all';
  let showOther = false;

  const BUCKETS = [
    { k: 'morning', name: 'Morning', icon: 'sun', test: (m) => m >= 300 && m < 720 },
    { k: 'afternoon', name: 'Afternoon', icon: 'sun', test: (m) => m >= 720 && m < 1020 },
    { k: 'evening', name: 'Evening', icon: 'moon', test: (m) => m >= 1020 && m < 1290 },
    { k: 'night', name: 'Night', icon: 'moon', test: (m) => m >= 1290 || m < 300 },
  ];

  function habitsPanel() {
    const st = S();
    const day = G.today();
    return `<section class="panel habits">
      <div class="panel-title">${I('up')} Habits <button class="link" data-act="new" data-type="habit">${I('plus')} New</button></div>
      <p class="small muted pad">No schedule. Tap + for good moves, − when you slip.</p>
      ${st.habits.length ? st.habits.map((h) => {
        const c = h.countDate === day && h.count ? h.count : { up: 0, down: 0 };
        return `<div class="habit">
          ${h.up ? `<button class="hbtn up" data-act="habit" data-id="${h.id}" data-dir="1" aria-label="Plus ${esc(h.title)}">+</button>` : '<span class="hbtn ghost"></span>'}
          <div class="habit-main" data-act="edit" data-type="habit" data-id="${h.id}"><div class="task-title">${esc(h.title)}</div>
            <div class="task-meta">${c.up ? `<span class="chip chip-done">+${c.up} today</span>` : ''}${c.down ? `<span class="chip chip-late">−${c.down} today</span>` : ''}${C.catDot(h.category)}</div></div>
          ${h.down ? `<button class="hbtn down" data-act="habit" data-id="${h.id}" data-dir="-1" aria-label="Minus ${esc(h.title)}">−</button>` : '<span class="hbtn ghost"></span>'}
        </div>`;
      }).join('') : '<p class="muted small pad">Try “Drank water (+)” or “Doomscrolled (−)”.</p>'}
    </section>`;
  }

  function render(root) {
    const st = S();
    const day = G.today();
    const all = st.dailies.filter((d) => !d.archived);
    const today = all.filter((d) => G.isScheduled(d, day));
    const other = all.filter((d) => !G.isScheduled(d, day));
    const f = (d) => filter === 'all' || (filter === 'todo' ? !G.isDone(d) : d.category === filter);
    const shown = today.filter(f);
    const done = today.filter((d) => G.isDone(d)).length;
    const best = Math.max(0, ...all.map((d) => d.streak || 0));
    const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.order || 0) - (b.order || 0);
    const cats = [...new Set(all.map((d) => d.category))];

    let groups = '';
    for (const b of BUCKETS) {
      const items = shown.filter((d) => d.time && b.test(U.hmToMin(d.time))).sort(byTime);
      if (!items.length) continue;
      const bdone = items.filter((d) => G.isDone(d)).length;
      groups += `<div class="group"><div class="group-head">${I(b.icon)}<span>${b.name}</span><span class="muted small">${bdone}/${items.length}</span></div>${items.map((d) => C.dailyRow(d)).join('')}</div>`;
    }
    const anyt = shown.filter((d) => !d.time).sort(byTime);
    if (anyt.length) groups += `<div class="group"><div class="group-head">${I('clock')}<span>Any time</span><span class="muted small">${anyt.filter((d) => G.isDone(d)).length}/${anyt.length}</span></div>${anyt.map((d) => C.dailyRow(d)).join('')}</div>`;
    if (!today.length) groups = C.empty('No dailies today', 'Dailies are chores on a schedule: “Make bed 7:30 AM”, “Gym Mon/Wed/Fri 7 PM”. Start with 3 to 5.', `<button class="btn btn-primary" data-act="new" data-type="daily">${I('plus')} New daily</button> <button class="btn" data-act="starter-packs">Starter packs</button>`);
    else if (!shown.length) groups = '<p class="muted pad">Nothing matches this filter.</p>';

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Recurring chores</div><h1 class="page-title">Dailies</h1></div>
        <div class="head-stats">
          <div class="stat-pill"><b>${done}/${today.length}</b><span>done today</span></div>
          <div class="stat-pill"><b>${I('flame')}${best}</b><span>best streak</span></div>
          <div class="stat-pill"><b>${I('shield')}${st.inventory.shield}</b><span>shields</span></div>
        </div>
        <div class="head-actions"><button class="btn" data-act="starter-packs">Starter packs</button><button class="btn btn-primary" data-act="new" data-type="daily">${I('plus')} New daily</button></div>
      </div>
      <div class="filters">
        ${[['all', 'All'], ['todo', 'To do'], ...cats.map((c) => [c, Q.store.CATEGORIES[c]?.name || c])].map(([k, n]) => `<button class="fchip ${filter === k ? 'on' : ''}" data-act="dfilter" data-f="${k}">${n}</button>`).join('')}
      </div>
      <div class="dailies-layout">
        <section class="panel dailies-list">${groups}
          ${other.length ? `<button class="group-toggle" data-act="dother">${showOther ? '▾' : '▸'} Not scheduled today (${other.length})</button>
            ${showOther ? `<div class="group">${other.sort(byTime).map((d) => C.dailyRow(d, { notToday: true })).join('')}</div>` : ''}` : ''}
        </section>
        <div class="dailies-side">
          ${habitsPanel()}
          <section class="panel tips">
            <div class="panel-title">${I('star')} How dailies score</div>
            <ul class="tip-list">
              <li>Finish within 30 min of the time for a <b>20% on-time bonus</b>.</li>
              <li>Unfinished dailies cost HP when the day resets at <b>${U.fmtTime(U.minToHm(st.settings.dayStart * 60))}</b>. You can tick off forgotten ones first.</li>
              <li>A <b>Streak Shield</b> saves every streak once. Long streaks pay up to +50%.</li>
              <li>Going away? <button class="link" data-act="toggle-inn">${st.settings.inn ? 'Leave the Inn' : 'Rest at the Inn'}</button> pauses damage.</li>
            </ul>
          </section>
        </div>
      </div>`;
  }

  function bind() {
    Q.ui.on('dfilter', (el) => { filter = el.dataset.f; Q.app.render(); });
    Q.ui.on('dother', () => { showOther = !showOther; Q.app.render(); });
  }

  return { render, bind };
})();
