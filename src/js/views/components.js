'use strict';
/* Reusable pieces of markup shared by several views. */

Q.views = Q.views || {};
Q.comp = (() => {
  const U = Q.util;
  const G = Q.game;
  const S = () => Q.store.state;
  const I = (n, c) => Q.sprites.icon(n, c);
  const esc = U.esc;

  function hpBar(compact = false) {
    const h = S().hero; const max = G.maxHp();
    const f = U.clamp(h.hp / max, 0, 1);
    const col = f > 0.5 ? 'hp-hi' : f > 0.2 ? 'hp-mid' : 'hp-lo';
    return `<div class="bar-row" title="Health: lose it by missing dailies. Level up or use a Potion to heal.">
      <span class="bar-tag tag-hp">HP</span>
      <div class="bar ${col}"><div class="bar-fill" style="width:${f * 100}%"></div></div>
      ${compact ? '' : `<span class="bar-num">${Math.ceil(h.hp)}/${max}</span>`}</div>`;
  }
  function xpBar(compact = false) {
    const h = S().hero; const need = G.xpToNext(h.level);
    return `<div class="bar-row" title="${Math.floor(need - h.xp)} XP to level ${h.level + 1}">
      <span class="bar-tag tag-xp">XP</span>
      <div class="bar bar-xp"><div class="bar-fill" style="width:${(h.xp / need) * 100}%"></div></div>
      ${compact ? '' : `<span class="bar-num">${Math.floor(h.xp)}/${need}</span>`}</div>`;
  }
  const gold = () => `<span class="gold" title="Gold">${I('coin')}<b>${S().hero.gold.toLocaleString()}</b></span>`;

  function trainerCard() {
    const st = S(); const h = st.hero;
    const charm = st.buffs.charmUntil > Date.now();
    const perfect = st.buffs.perfectDay === G.today();
    return `<section class="panel trainer-card">
      <div class="tc-top">
        <div class="tc-sprite">${Q.sprites.trainer(st.profile.outfit, 72)}</div>
        <div class="tc-id">
          <div class="tc-name">${esc(st.profile.name)}</div>
          <div class="tc-title">${G.title(h.level)}</div>
          <div class="tc-lv"><span class="lv">Lv</span>${h.level}</div>
        </div>
        ${gold()}
      </div>
      ${hpBar()}${xpBar()}
      ${charm || perfect || st.settings.inn ? `<div class="buffs">
        ${charm ? `<span class="buff" title="1.5× XP">${I('star')} Lucky Charm · ${U.fmtDuration((st.buffs.charmUntil - Date.now()) / 60000)}</span>` : ''}
        ${perfect ? `<span class="buff" title="+10% XP today">${I('sun')} Perfect-day bonus</span>` : ''}
        ${st.settings.inn ? `<span class="buff buff-inn">${I('moon')} Resting at the Inn</span>` : ''}
      </div>` : ''}
    </section>`;
  }

  function companionBox() {
    const st = S(); const c = st.companion;
    const { line, mood } = G.companionLine();
    const stage = G.companionStage(); const lvl = G.companionLevel();
    return `<section class="panel companion-box mood-${mood}">
      <div class="cb-stage">
        <div class="cb-ground"></div>
        ${Q.sprites.companion(c.species, stage, 80, `cb-sprite idle-${mood}`)}
        <button class="cb-feed btn btn-small" data-act="use-item" data-item="berry" ${st.inventory.berry ? '' : 'disabled'} title="Feed a Berry">${I('berry')} ${st.inventory.berry}</button>
      </div>
      <div class="cb-info"><b>${esc(c.name)}</b><span class="muted"> · Lv ${lvl} ${G.STAGE_NAMES[stage]}</span>
        <span class="hearts" title="Friendship ${c.friendship || 0}/100">${[0, 1, 2, 3, 4].map((i) => `<i class="${(c.friendship || 0) >= (i + 1) * 20 ? 'on' : ''}">${I('heart')}</i>`).join('')}</span></div>
      <div class="textbox"><p class="typewriter">${esc(line)}</p><span class="tb-arrow">▼</span></div>
    </section>`;
  }

  function bossCard() {
    const b = G.ensureBoss();
    const f = b.hp / b.maxHp;
    const wkEnd = U.addDays(U.parseYmd(b.week), 7);
    const left = U.diffDays(wkEnd, new Date());
    return `<section class="panel boss-card ${b.defeated ? 'defeated' : ''}">
      <div class="panel-title">${I('sword')} Weekly boss <span class="muted small">${b.defeated ? 'Defeated!' : `${left} ${left === 1 ? 'day' : 'days'} left`}</span></div>
      <div class="boss-body">
        <div class="boss-sprite">${Q.sprites.boss(b.id, 72)}</div>
        <div class="boss-info">
          <div class="boss-name">${esc(b.name)}</div>
          <div class="bar-row"><span class="bar-tag tag-boss">HP</span><div class="bar bar-boss"><div class="bar-fill" style="width:${f * 100}%"></div></div></div>
          <div class="small muted">${b.defeated ? 'Loot collected. A new challenger arrives next week.' : `${Math.ceil(b.hp)} / ${b.maxHp} · every task you finish hits it`}</div>
        </div>
      </div>
      ${b.defeated ? '' : `<div class="boss-taunt">“${esc(b.taunt)}”</div>`}
    </section>`;
  }

  /* ---------- task rows ---------- */
  function dueChip(d, now = new Date()) {
    if (G.isDone(d)) return '<span class="chip chip-done">Done</span>';
    if (!d.time) return '<span class="chip chip-any">Any time</span>';
    const due = G.dueAt(d, G.today());
    const min = (due - now) / 60000;
    if (min < -30) return `<span class="chip chip-late">${U.fmtTime(d.time)} · late ${U.fmtDuration(-min)}</span>`;
    if (min < 0) return `<span class="chip chip-soon">${U.fmtTime(d.time)} · now</span>`;
    if (min <= 60) return `<span class="chip chip-soon">${U.fmtTime(d.time)} · in ${U.fmtDuration(min)}</span>`;
    return `<span class="chip chip-time">${I('clock')}${U.fmtTime(d.time)}</span>`;
  }
  const stars = (diff) => `<span class="stars" title="${G.DIFF[diff]?.label}">${'★'.repeat(G.DIFF[diff]?.stars || 2)}</span>`;
  const catDot = (k) => { const c = Q.store.CATEGORIES[k] || Q.store.CATEGORIES.home; return `<span class="cat" style="--c:${c.color}">${c.name}</span>`; };

  function dailyRow(d, { compact = false, notToday = false } = {}) {
    const done = !notToday && G.isDone(d);
    const cl = G.checklistState(d);
    const clDone = cl.filter((c) => c.done).length;
    return `<div class="task daily ${done ? 'is-done' : ''} ${notToday ? 'not-today' : ''}" data-id="${d.id}">
      <button class="cbox ${done ? 'on' : ''}" data-act="daily-toggle" data-id="${d.id}" aria-pressed="${done}" aria-label="${done ? 'Undo' : 'Complete'} ${esc(d.title)}" ${notToday ? 'disabled' : ''}>${I('check')}</button>
      <div class="task-main" data-act="edit" data-type="daily" data-id="${d.id}">
        <div class="task-title">${esc(d.title)}</div>
        <div class="task-meta">
          ${notToday ? `<span class="chip chip-any">${G.scheduleLabel(d)}</span>` : dueChip(d)}
          ${d.streak ? `<span class="streak" title="Streak (best ${d.best || d.streak})">${I('flame')}${d.streak}</span>` : ''}
          ${compact ? '' : stars(d.difficulty) + catDot(d.category)}
          ${cl.length ? `<span class="chip chip-cl">${clDone}/${cl.length}</span>` : ''}
        </div>
      </div>
      ${cl.length && !compact && !notToday ? `<div class="checklist">${cl.map((c) => `<button class="cl-item ${c.done ? 'on' : ''}" data-act="cl-toggle" data-id="${d.id}" data-item="${c.id}"><span class="cl-box">${c.done ? I('check') : ''}</span>${esc(c.text)}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  function reminderRow(r, { compact = false } = {}) {
    const now = Date.now();
    const overdue = !r.done && r.due && r.due < now;
    const snoozed = r.snoozedUntil && r.snoozedUntil > now;
    const dueTxt = r.due ? `${U.fmtDay(new Date(r.due))} · ${U.fmtTime(new Date(r.due))}` : 'No date';
    return `<div class="task reminder ${r.done ? 'is-done' : ''} ${overdue ? 'overdue' : ''}" data-id="${r.id}">
      <button class="cbox round ${r.done ? 'on' : ''}" data-act="${r.done ? 'rem-reopen' : 'rem-done'}" data-id="${r.id}" aria-label="${r.done ? 'Mark not done' : 'Complete'} ${esc(r.title)}">${I('check')}</button>
      <div class="task-main" data-act="edit" data-type="reminder" data-id="${r.id}">
        <div class="task-title">${esc(r.title)}</div>
        <div class="task-meta">
          <span class="chip ${overdue ? 'chip-late' : 'chip-time'}">${I('bell')}${dueTxt}${r.due && !r.done ? ` · ${U.rel(new Date(r.due))}` : ''}</span>
          ${snoozed ? `<span class="chip chip-snz">${I('snooze')}until ${U.fmtTime(new Date(r.snoozedUntil))}</span>` : ''}
          ${r.repeat && r.repeat !== 'none' ? `<span class="chip chip-any">${I('repeat')}${r.repeat}</span>` : ''}
          ${compact ? '' : stars(r.difficulty) + catDot(r.category)}
          ${r.gcalId ? `<span class="synced" title="Synced to Google Calendar">${I('sync')}</span>` : ''}
        </div>
      </div>
      ${!r.done && r.due ? `<button class="icon-btn snz-btn" data-act="rem-snooze" data-id="${r.id}" title="Snooze or reschedule" aria-label="Snooze">${I('snooze')}</button>` : ''}
    </div>`;
  }

  function eventRow(ev) {
    const s = new Date(ev.start); const e = new Date(ev.end);
    return `<div class="task event" data-act="cal-item" data-id="${esc(ev.id)}" style="--c:${ev.color}">
      <span class="ev-bar"></span>
      <div class="task-main"><div class="task-title">${esc(ev.title)}</div>
      <div class="task-meta"><span class="chip chip-time">${I('calendar')}${ev.allDay ? 'All day' : `${U.fmtTime(s)} – ${U.fmtTime(e)}`}</span>${ev.location ? `<span class="muted small">${esc(ev.location)}</span>` : ''}</div></div>
    </div>`;
  }

  const empty = (title, text, btn = '') => `<div class="empty"><div class="empty-art">${Q.sprites.companion(S().companion.species, G.companionStage(), 56)}</div><b>${title}</b><p>${text}</p>${btn}</div>`;

  return { hpBar, xpBar, gold, trainerCard, companionBox, bossCard, dailyRow, reminderRow, eventRow, dueChip, stars, catDot, empty };
})();
