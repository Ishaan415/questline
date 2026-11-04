'use strict';
/* Pals tab: team of 3, presets, the Capsule Machine, and the Paldex (collection). */

Q.views.pals = (() => {
  const U = Q.util;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;
  const D = Q.PALS;
  const P = () => Q.pals;
  const C = () => Q.comp;
  let show = 'all';        // all | owned | missing
  let typeF = '';          // '' or a type key
  let pulling = false;

  const no = (id) => `#${String(D.byId[id].no).padStart(2, '0')}`;

  /* ------------------------------------------------------------ team */
  function slot(id, i) {
    if (!id || !P().isOwned(id)) {
      return `<button class="team-slot empty" data-act="pal-pick" data-slot="${i}">
        <span class="ts-plus">${I('plus')}</span><b>Empty slot</b><span class="small muted">Add a pal from your collection</span></button>`;
    }
    const l = P().line(id); const nxt = P().nextEvoLevel(id);
    return `<div class="team-slot" data-act="pal-open" data-id="${id}" role="button" tabindex="0">
      ${i === 0 ? `<span class="ts-lead" title="Lead pal: shown on Home">${I('star')} Lead</span>` : ''}
      <div class="ts-stage"><div class="ts-ground"></div>${P().sprite(id, 96, { cls: 'ts-sprite' })}</div>
      <div class="ts-name"><b>${esc(P().name(id))}</b><span class="muted small">Lv ${P().level(id)}</span></div>
      <div class="ts-chips">${C().typeChip(l.type, true)}${C().rarityChip(l.r)}</div>
      ${C().palExpBar(id)}
      <div class="small muted">${nxt ? `Evolves at Lv ${nxt}` : 'Final form'}</div>
      <div class="ts-ab small" title="${esc(l.ab)}">${I('bolt')} ${esc(P().abilityText(id))}</div>
    </div>`;
  }

  function teamPanel() {
    const st = S(); const syn = P().synergy();
    const b = Q.game.ensureBoss(); const adv = P().advantage(b); const bt = P().bossType(b);
    const presets = st.pals.presets;
    return `<section class="panel team-panel">
      <div class="panel-title">${I('paw')} Your team <span class="small muted">Every task gives each of them the same EXP</span>
        ${syn ? `<span class="syn-chip syn-${syn.kind}" title="Team synergy">${esc(syn.name)} · ${syn.text}</span>` : ''}</div>
      <div class="team-slots">${[0, 1, 2].map((i) => slot(st.pals.team[i], i)).join('')}</div>
      <div class="team-foot">
        <div class="matchup small">${I('sword')} ${b.defeated ? `${esc(b.name)} is defeated this week.` : `vs <b>${esc(b.name)}</b> ${bt ? C().typeChip(bt, true) : ''} · ${adv.pals.length ? `<span class="good">${adv.pals.length} with the edge: +${adv.pct}% boss damage</span>` : `<span class="muted">Bring ${P().strongVs(bt).map((t) => D.TYPES[t].name).join(' or ')} for +15% each</span>`}`}</div>
        <div class="presets">${[0, 1, 2].map((i) => {
          const p = presets[i];
          return `<div class="preset ${p ? '' : 'empty'}">
            ${p ? `<button class="preset-load" data-act="preset-load" data-i="${i}" title="Load ${esc(p.name)}"><span class="pr-mini">${p.team.filter(Boolean).map((id) => (P().isOwned(id) ? `<img class="px" src="${P().url(id, P().stage(id))}" width="24" height="24" alt="">` : '')).join('')}</span><span>${esc(p.name)}</span></button>` : `<span class="small muted pr-empty">Preset ${i + 1}</span>`}
            <button class="icon-btn" data-act="preset-save" data-i="${i}" title="${p ? 'Overwrite with current team' : 'Save current team here'}" aria-label="Save preset ${i + 1}">${I('down')}</button>
          </div>`;
        }).join('')}</div>
      </div>
    </section>`;
  }

  /* -------------------------------------------------- capsule machine */
  function capsulePanel() {
    const st = S(); const left = P().pool().length;
    const cost = P().pullCost(); const odds = P().odds();
    const tickets = st.inventory.ticket || 0;
    return `<section class="panel capsule-panel">
      <div class="panel-title">${I('capsule')} Capsule Machine</div>
      <div class="machine ${pulling ? 'busy' : ''}" aria-hidden="true">
        <div class="m-dome">${[['C', 14, 4], ['R', 44, 2], ['C', 74, 4], ['E', 104, 3], ['R', 28, 26], ['L', 58, 24], ['C', 88, 27], ['E', 42, 48], ['C', 72, 47]].map(([r, x, y], i) => `<i class="m-ball rb-${r}" style="left:${x}px;bottom:${y}px;--i:${i}"></i>`).join('')}</div>
        <div class="m-body"><span class="m-slot"></span><span class="m-knob"></span></div>
      </div>
      ${left ? `<div class="cap-actions">
        <button class="btn btn-primary" data-act="pal-pull" ${st.hero.gold < cost || pulling ? 'disabled' : ''}>${I('coin')} Pull · ${cost}</button>
        <button class="btn" data-act="pal-pull" data-ticket="1" ${!tickets || pulling ? 'disabled' : ''}>${I('ticket')} Use ticket (${tickets})</button>
      </div>
      <p class="small muted cap-note">Never gives a pal you already own. Each new pal makes the next pull cost a little more.</p>
      <div class="odds">${Object.entries(odds).map(([r, o]) => `<div class="odd ${o.left ? '' : 'none'}"><i style="background:${D.RARITY[r].color}"></i><span>${D.RARITY[r].name}</span><b>${o.pct}%</b><span class="muted small">${o.left} left</span></div>`).join('')}</div>`
        : '<p class="pad-x">You collected every pal. Legendary work.</p>'}
      <p class="small muted cap-note">Tickets come from weekly bosses, achievements and rare drops.</p>
    </section>`;
  }

  /* ---------------------------------------------------------- boss log */
  function bossLog() {
    const st = S(); const log = st.bossLog || {}; const cur = Q.game.ensureBoss();
    const wins = Math.max(st.counters.bossesDefeated || 0, Object.values(log).reduce((n, e) => n + (e.beat || 0), 0));
    const met = D.BOSSES.filter((b) => (log[b.id] && log[b.id].met) || cur.id === b.id).length;
    const cards = D.BOSSES.map((b) => {
      const e = log[b.id] || { met: 0, beat: 0 };
      const now = cur.id === b.id; const seen = e.met > 0 || now;
      const escaped = Math.max(0, e.met - e.beat - (now && !cur.defeated ? 1 : 0));
      const status = now ? (cur.defeated ? '<span class="bl-tag good">Beaten this week</span>' : '<span class="bl-tag now">This week</span>')
        : escaped ? `<span class="bl-tag">Got away${escaped > 1 ? ` ×${escaped}` : ''}</span>` : '';
      return `<div class="bl-card ${seen ? 'seen' : 'unseen'} ${now ? 'now' : ''}" title="${seen ? esc(b.taunt) : 'Not met yet'}">
        <span class="bl-art">${Q.sprites.boss(b.id, 56, seen ? '' : 'boss-sil')}</span>
        <b class="bl-name">${seen ? esc(b.name) : '???'}</b>
        ${seen ? C().typeChip(b.type, true) : ''}
        <span class="bl-count ${e.beat ? 'won' : ''}">${e.beat ? `${I('trophy')} Beaten ×${e.beat}` : seen ? 'Not beaten yet' : 'Not met yet'}</span>
        ${status}
      </div>`;
    }).join('');
    return `<section class="panel boss-log-panel">
      <div class="panel-title">${I('sword')} Boss log <span class="small muted">${met}/${D.BOSSES.length} met · ${wins} weekly ${wins === 1 ? 'win' : 'wins'} · ${st.counters.dailyBossesDefeated || 0} daily foes beaten</span></div>
      <p class="small muted bl-intro">A new boss shows up every week. Beat it before the week ends to fill in your log.</p>
      <div class="bl-grid">${cards}</div>
    </section>`;
  }

  /* ------------------------------------------------------------ paldex */
  function dexCard(l) {
    const owned = P().isOwned(l.id);
    const id = l.id;
    return `<button class="dex-card rar-b-${l.r} ${owned ? 'got' : 'missing'} ${P().inTeam(id) ? 'in-team' : ''}" data-act="pal-open" data-id="${id}" style="--rc:${D.RARITY[l.r].color}">
      <span class="dex-no">${no(id)}</span>
      ${P().inTeam(id) ? `<span class="dex-team" title="In your team">${I('paw')}</span>` : ''}
      <span class="dex-art">${P().sprite(id, 64)}</span>
      <b class="dex-name">${owned ? esc(P().name(id)) : '???'}</b>
      <span class="dex-sub">${C().typeChip(l.type, true)}${owned ? `<span class="small muted">Lv ${P().level(id)}</span>` : `<span class="small muted">${D.RARITY[l.r].name}</span>`}</span>
    </button>`;
  }

  function dex() {
    const list = D.LINES.filter((l) => (show === 'owned' ? P().isOwned(l.id) : show === 'missing' ? !P().isOwned(l.id) : true) && (!typeF || l.type === typeF));
    return `<section class="panel dex-panel">
      <div class="panel-title">${I('list')} Paldex <span class="small muted">${P().count()}/${D.LINES.length} collected · ${P().finals()} at final form</span></div>
      <div class="dex-filters">
        <div class="seg">${[['all', 'All'], ['owned', 'Collected'], ['missing', 'Missing']].map(([k, n]) => `<button class="seg-btn ${show === k ? 'on' : ''}" data-act="dex-show" data-k="${k}">${n}</button>`).join('')}</div>
        <div class="type-filter">${Object.entries(D.TYPES).map(([k, t]) => `<button class="type-chip tc-btn ${typeF === k ? 'on' : ''}" style="--c:${t.color}" data-act="dex-type" data-k="${k}">${t.name}</button>`).join('')}</div>
      </div>
      <div class="dex-grid">${list.map(dexCard).join('') || '<p class="muted pad">No pals match.</p>'}</div>
    </section>`;
  }

  function render(root) {
    const st = S();
    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Your party</div><h1 class="page-title">Pals</h1></div>
        <div class="head-stats">
          <div class="stat-pill">${I('paw')}<b>${P().count()}</b><span>/ ${D.LINES.length}</span></div>
          <div class="stat-pill">${I('ticket')}<b>${st.inventory.ticket || 0}</b><span>tickets</span></div>
          <div class="stat-pill big-gold">${I('coin')}<b>${st.hero.gold.toLocaleString()}</b><span>gold</span></div>
        </div>
      </div>
      <div class="pals-page">${teamPanel()}${capsulePanel()}${bossLog()}${dex()}</div>`;
  }

  /* ----------------------------------------------------------- detail */
  function chain(id) {
    const l = P().line(id); const owned = P().isOwned(id); const cur = owned ? P().stage(id) : 0; const ev = P().evoLevels(id);
    return `<div class="evo-chain">${l.names.map((n, i) => {
      const s = i + 1; const seen = owned && s <= cur;
      return `${i ? `<span class="evo-arrow">${I('right')}</span>` : ''}<div class="evo-step ${s === cur ? 'cur' : ''}">
        <img class="px ${seen ? '' : 'pal-sil'}" src="${P().url(id, s, !seen)}" width="48" height="48" alt="">
        <b class="small">${seen ? esc(n) : '???'}</b><span class="tiny muted">Lv ${ev[i]}</span></div>`;
    }).join('')}</div>`;
  }

  function palModal(id) {
    const l = P().line(id);
    const owned = P().isOwned(id);
    const st = S();
    let renaming = false;
    Q.ui.modal({
      title: '', cls: 'modal-pal',
      body: '<div class="pal-detail"></div>',
      onMount(m, close) {
        const box = m.querySelector('.pal-detail');
        const draw = () => {
          const inTeam = P().inTeam(id); const full = P().team().length >= P().TEAM_SIZE;
          const nxt = owned && P().nextEvoLevel(id);
          const lead = st.pals.team[0] === id;
          box.innerHTML = `
            <button class="icon-btn pd-close" data-close aria-label="Close">${I('close')}</button>
            <div class="pd-head">
              <div class="pd-stage" style="--tc:${D.TYPES[l.type].color}"><div class="ts-ground"></div>${P().sprite(id, 128, { cls: 'pd-sprite' })}</div>
              <div class="pd-id">
                <div class="small muted">${no(id)}</div>
                ${renaming ? `<form class="pd-rename"><input name="n" maxlength="16" value="${esc(st.pals.owned[id].nick || '')}" placeholder="${esc(P().speciesName(id))}"><button class="btn btn-small btn-primary">Save</button></form>`
                  : `<h2 class="pd-name">${owned ? esc(P().name(id)) : '???'}</h2>${owned && st.pals.owned[id].nick ? `<div class="small muted">${esc(P().speciesName(id))}</div>` : ''}`}
                <div class="ts-chips">${C().typeChip(l.type)}${C().rarityChip(l.r)}<span class="small muted">${l.names.length} forms</span></div>
                ${owned ? `<div class="pd-lv"><b>Lv ${P().level(id)}</b>${C().palExpBar(id)}</div>
                  <div class="small muted">${nxt ? `Evolves into ${P().speciesName(id, P().stage(id) + 1)} at Lv ${nxt}` : 'Final form reached'}${inTeam ? '' : ' · gains EXP only while in your team'}</div>` : '<p class="small muted">Not caught yet. Pull it from the Capsule Machine.</p>'}
              </div>
            </div>
            ${chain(id)}
            <div class="pd-ability">
              <div class="pd-ab-head">${I('bolt')} <b>${owned ? esc(l.ab) : '???'}</b><span class="small muted">Ability · active while in your team</span></div>
              ${owned ? `<p>${esc(P().abilityText(id))}</p>${P().stage(id) < l.names.length ? `<p class="small muted">At final form: ${esc(P().abilityText(id, l.names.length))}</p>` : ''}` : '<p class="small muted">Revealed when you catch it.</p>'}
            </div>
            <p class="pd-lore">${owned ? esc(l.lore) : `Strong against ${D.TYPES[l.type].strong.map((t) => D.TYPES[t].name).join(' and ')}.`}</p>
            ${owned ? `<div class="modal-actions pd-actions">
              <button class="btn btn-small" data-rename>${I('edit')} ${st.pals.owned[id].nick ? 'Rename' : 'Nickname'}</button>
              <span class="spacer"></span>
              ${inTeam ? `${lead ? '' : `<button class="btn btn-small" data-lead>${I('star')} Make lead</button>`}<button class="btn btn-small" data-remove>Move to storage</button>`
                : full ? '' : `<button class="btn btn-small btn-primary" data-add>${I('plus')} Add to team</button>`}
            </div>
            ${!inTeam && full ? `<div class="pd-swap"><span class="small muted">Team is full. Swap with:</span>
              <div class="pd-swap-btns">${P().team().map((t) => `<button class="btn btn-small" data-swap="${t}" title="Replace ${esc(P().name(t))}"><img class="px" src="${P().url(t, P().stage(t))}" width="40" height="40" alt=""><span>${esc(P().name(t))}</span></button>`).join('')}</div></div>` : ''}` : ''}`;
          box.querySelector('[data-close]').onclick = () => close();
          const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.onclick = fn; };
          on('[data-add]', () => { P().addToTeam(id); Q.game.checkAchievements(); Q.app.flushGame(); Q.sfx.click(); draw(); });
          on('[data-remove]', () => { if (P().removeFromTeam(id) === 'last') Q.ui.toast('Your team needs at least one pal.', { kind: 'error' }); draw(); });
          on('[data-lead]', () => { P().makeLead(id); draw(); });
          on('[data-rename]', () => { renaming = true; draw(); const inp = box.querySelector('input'); inp && (inp.focus(), inp.select()); });
          box.querySelectorAll('[data-swap]').forEach((b) => { b.onclick = () => { P().addToTeam(id, S().pals.team.indexOf(b.dataset.swap)); Q.game.checkAchievements(); Q.app.flushGame(); draw(); }; });
          const f = box.querySelector('.pd-rename');
          if (f) f.onsubmit = (e) => { e.preventDefault(); P().rename(id, f.n.value); renaming = false; draw(); };
        };
        draw();
      },
    });
  }

  /** Slot picker: choose an owned pal for an empty team slot. */
  function pickModal(slotIdx) {
    const free = P().ownedIds().filter((id) => !P().inTeam(id));
    if (!free.length) return Q.ui.toast('All your pals are already in the team. Pull a new one from the Capsule Machine!');
    Q.ui.modal({
      title: 'Add a pal to your team', cls: 'modal-form',
      body: `<div class="pick-grid">${free.map((id) => `<button class="dex-card got" data-pick="${id}"><span class="dex-art">${P().sprite(id, 56)}</span><b class="dex-name">${esc(P().name(id))}</b><span class="dex-sub">${C().typeChip(P().line(id).type, true)}<span class="small muted">Lv ${P().level(id)}</span></span></button>`).join('')}</div>`,
      onMount(m, close) {
        m.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { P().addToTeam(b.dataset.pick, slotIdx); Q.game.checkAchievements(); Q.app.flushGame(); close(); }; });
      },
    });
  }

  /* ------------------------------------------------- pull & evolution */
  const reduced = () => S().settings.reducedMotion;

  function pull(useTicket) {
    if (pulling) return;
    const res = P().pull(useTicket);
    if (!res.ok) return Q.ui.toast(res.msg, { kind: 'error' });
    pulling = true;
    const l = P().line(res.id);
    Q.sfx.click();
    Q.ui.modal({
      title: '', cls: 'modal-celebrate modal-capsule', dismissable: false,
      body: `<div class="celebrate">
        <div class="capsule-anim rb-${l.r} ${reduced() ? 'open' : ''}"><span class="cap-top"></span><span class="cap-bot"></span><span class="cap-light"></span></div>
        <div class="cap-reveal" ${reduced() ? '' : 'hidden'}>
          <div class="burst"></div>
          ${P().sprite(res.id, 112, { cls: 'bounce' })}
          <div class="big-title">${D.RARITY[l.r].name === 'Legendary' ? 'LEGENDARY!' : 'New pal!'}</div>
          <p><b>${esc(l.names[0])}</b> joined your collection.</p>
          <div class="ts-chips center">${C().typeChip(l.type)}${C().rarityChip(l.r)}</div>
          <p class="small muted">${res.joined ? 'It joined your team and starts earning EXP right away.' : 'It is resting in storage. Add it to your team to train it.'}</p>
          <div class="modal-actions center"><button class="btn" data-view>View</button><button class="btn btn-primary" data-ok>Nice!</button></div>
        </div></div>`,
      onMount(m, close) {
        const done = () => { pulling = false; Q.app.flushGame(); Q.app.render(); };
        const reveal = () => {
          m.querySelector('.capsule-anim').classList.add('open');
          setTimeout(() => { m.querySelector('.capsule-anim').style.display = 'none'; const r = m.querySelector('.cap-reveal'); r.hidden = false; Q.sfx[l.r === 'C' ? 'drop' : 'victory'](); }, reduced() ? 0 : 450);
        };
        if (reduced()) reveal(); else setTimeout(reveal, 1300);
        m.querySelector('[data-ok]').onclick = () => { close(); done(); };
        m.querySelector('[data-view]').onclick = () => { close(); done(); palModal(res.id); };
      },
    });
  }

  /* Evolution scenes play one after another. */
  const evoQueue = [];
  let evoBusy = false;
  function evolveScene(e) { evoQueue.push(e); if (!evoBusy) nextEvo(); }
  function nextEvo() {
    const e = evoQueue.shift();
    if (!e) { evoBusy = false; return; }
    evoBusy = true;
    const id = e.id; const l = P().line(id);
    const oldName = S().pals.owned[id]?.nick || l.names[e.from - 1];
    const newName = l.names[e.to - 1];
    Q.ui.modal({
      title: '', cls: 'modal-celebrate modal-evolve', dismissable: false,
      body: `<div class="celebrate">
        <div class="evo-scene ${reduced() ? 'done' : ''}">
          <img class="px evo-a" src="${P().url(id, e.from)}" width="112" height="112" alt="">
          <img class="px evo-b" src="${P().url(id, e.to)}" width="112" height="112" alt="">
          <div class="burst"></div>
        </div>
        <div class="big-title evo-t1" ${reduced() ? 'hidden' : ''}>What?</div>
        <p class="evo-t1" ${reduced() ? 'hidden' : ''}><b>${esc(oldName)}</b> is evolving!</p>
        <div class="evo-t2" ${reduced() ? '' : 'hidden'}>
          <div class="big-title">Evolved!</div>
          <p><b>${esc(oldName)}</b> evolved into <b>${esc(newName)}</b>!</p>
          <p class="small muted">${I('bolt')} ${esc(l.ab)}: ${esc(P().abilityText(id, e.to))}</p>
          <button class="btn btn-primary" data-ok>Amazing</button>
        </div></div>`,
      onMount(m, close) {
        const finish = () => {
          m.querySelector('.evo-scene').classList.add('done');
          m.querySelectorAll('.evo-t1').forEach((x) => (x.hidden = true));
          m.querySelector('.evo-t2').hidden = false;
          Q.sfx.levelup();
        };
        if (!reduced()) { Q.sfx.open(); setTimeout(finish, 2600); } else Q.sfx.victory();
        m.querySelector('[data-ok]').onclick = () => { close(); setTimeout(nextEvo, 250); };
      },
    });
  }

  function bind() {
    const on = Q.ui.on;
    on('pal-open', (el) => palModal(el.dataset.id));
    on('pal-pick', (el) => pickModal(+el.dataset.slot));
    on('pal-pull', (el) => pull(!!el.dataset.ticket));
    on('dex-show', (el) => { show = el.dataset.k; Q.app.render(); });
    on('dex-type', (el) => { typeF = typeF === el.dataset.k ? '' : el.dataset.k; Q.app.render(); });
    on('preset-load', (el) => { if (P().loadPreset(+el.dataset.i)) { Q.sfx.click(); Q.game.checkAchievements(); Q.app.flushGame(); Q.ui.toast(`Loaded ${S().pals.presets[+el.dataset.i].name}`, { kind: 'ok', icon: I('paw') }); } });
    on('preset-save', (el) => {
      const i = +el.dataset.i; const cur = S().pals.presets[i];
      Q.ui.modal({
        title: `Save team to preset ${i + 1}`, cls: 'modal-small modal-form',
        body: `<form><label class="field"><span class="field-label">Preset name</span><input name="n" maxlength="18" value="${esc(cur ? cur.name : ['Focus team', 'Boss team', 'Daily team'][i])}" required></label>
          <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></form>`,
        onMount(m, close) { m.querySelector('form').onsubmit = (e) => { e.preventDefault(); P().savePreset(i, m.querySelector('input').value.trim()); close(); Q.ui.toast('Preset saved', { kind: 'ok' }); }; },
      });
    });
  }

  return { render, bind, palModal, evolveScene, pull };
})();
