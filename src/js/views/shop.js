'use strict';
/* Shop: items, your own real-life rewards, and cosmetics (skins, outfits, focus scenes). */

Q.views.shop = (() => {
  const U = Q.util;
  const G = Q.game;
  const S = () => Q.store.state;
  const I = (n) => Q.sprites.icon(n);
  const esc = U.esc;
  let tab = 'rewards';

  function items() {
    const st = S();
    return `<div class="shop-grid">${Object.entries(G.SHOP.items).map(([k, it]) => `
      <div class="shop-item">
        <div class="si-icon" style="--c:${it.color}">${I(it.icon)}</div>
        <div class="si-main"><b>${it.name}</b><p>${it.desc}</p><span class="small muted">You have ${st.inventory[k] || 0}</span></div>
        <div class="si-actions">
          <button class="btn btn-small btn-buy" data-act="buy" data-kind="items" data-key="${k}" ${st.hero.gold < it.price ? 'disabled' : ''}>${I('coin')} ${it.price}</button>
          ${k !== 'shield' ? `<button class="btn btn-small" data-act="use-item" data-item="${k}" ${st.inventory[k] ? '' : 'disabled'}>Use</button>` : '<span class="small muted">Auto-used</span>'}
        </div>
      </div>`).join('')}</div>`;
  }

  function rewards() {
    const st = S();
    return `<p class="muted pad-x">Turn gold into permission for real treats. Set the price; buying one logs it.</p>
      <div class="shop-grid">${st.rewards.map((r) => `
      <div class="shop-item reward">
        <div class="si-icon" style="--c:#F2C14E">${I('chest')}</div>
        <div class="si-main" data-act="edit" data-type="reward" data-id="${r.id}"><b>${esc(r.title)}</b><p class="small muted">Click to edit</p></div>
        <div class="si-actions"><button class="btn btn-small btn-buy" data-act="buy-reward" data-id="${r.id}" ${st.hero.gold < r.cost ? 'disabled' : ''}>${I('coin')} ${r.cost}</button></div>
      </div>`).join('')}
      <button class="shop-item add-reward" data-act="new" data-type="reward">${I('plus')}<b>Add a reward</b></button></div>`;
  }

  function looks() {
    const st = S();
    const lvl = st.hero.level;
    const skinCards = (mode) => Object.entries(G.SHOP.skins).filter(([, s]) => s.mode === mode).map(([k, s]) => {
      const owned = st.owned.skins.includes(k);
      const on = (mode === 'dark' ? st.settings.darkSkin : st.settings.skin) === k;
      return `<div class="look ${on ? 'equipped' : ''}">
        <div class="look-swatch">${s.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
        <b>${s.name}</b><p class="small muted">${s.desc}</p>
        ${owned ? `<button class="btn btn-small" data-act="equip-skin" data-key="${k}" ${on ? 'disabled' : ''}>${on ? 'Equipped' : 'Equip'}</button>`
          : `<button class="btn btn-small btn-buy" data-act="buy" data-kind="skins" data-key="${k}" ${st.hero.gold < s.price ? 'disabled' : ''}>${I('coin')} ${s.price}</button>`}
      </div>`;
    }).join('');
    const outfits = Object.entries(G.SHOP.outfits).map(([k, o]) => {
      const owned = st.owned.outfits.includes(k);
      const locked = lvl < o.lvl;
      return `<div class="look ${st.profile.outfit === k ? 'equipped' : ''}">
        <div class="look-sprite">${Q.sprites.trainer(k, 64)}</div>
        <b>${Q.sprites.OUTFITS[k].name}</b>
        ${owned ? `<button class="btn btn-small" data-act="equip-outfit" data-key="${k}" ${st.profile.outfit === k ? 'disabled' : ''}>${st.profile.outfit === k ? 'Wearing' : 'Wear'}</button>`
          : locked ? `<span class="small muted">${I('lock')} Level ${o.lvl}</span>`
          : `<button class="btn btn-small btn-buy" data-act="buy" data-kind="outfits" data-key="${k}" ${st.hero.gold < o.price ? 'disabled' : ''}>${I('coin')} ${o.price}</button>`}
      </div>`;
    }).join('');
    const scenes = Object.entries(G.SHOP.scenes).map(([k, s]) => {
      const owned = st.owned.scenes.includes(k);
      return `<div class="look"><div class="look-scene scene-${k}"></div><b>${s.name}</b>
        ${owned ? '<span class="small muted">Owned · pick it in Focus</span>' : `<button class="btn btn-small btn-buy" data-act="buy" data-kind="scenes" data-key="${k}" ${st.hero.gold < s.price ? 'disabled' : ''}>${I('coin')} ${s.price}</button>`}</div>`;
    }).join('');
    return `<h3 class="sub-title">${I('sun')} Light themes</h3><div class="looks-grid">${skinCards('light')}</div>
      <h3 class="sub-title">${I('moon')} Dark themes</h3><div class="looks-grid">${skinCards('dark')}</div>
      <h3 class="sub-title">Trainer outfits</h3><div class="looks-grid">${outfits}</div>
      <h3 class="sub-title">Focus scenes</h3><div class="looks-grid">${scenes}</div>`;
  }

  function render(root) {
    const st = S();
    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Spend what you earned</div><h1 class="page-title">Shop</h1></div>
        <div class="head-stats"><div class="stat-pill big-gold">${I('coin')}<b>${st.hero.gold.toLocaleString()}</b><span>gold</span></div></div>
      </div>
      <div class="tabs" role="tablist">${[['rewards', 'Your rewards'], ['items', 'Items'], ['looks', 'Looks']].map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-act="shop-tab" data-t="${k}" role="tab">${n}</button>`).join('')}</div>
      <section class="panel shop-panel">${tab === 'items' ? items() : tab === 'looks' ? looks() : rewards()}</section>`;
  }

  function bind() {
    const on = Q.ui.on;
    on('shop-tab', (el) => { tab = el.dataset.t; Q.app.render(); });
    on('buy', (el) => {
      const r = G.buy(el.dataset.kind, el.dataset.key);
      if (!r.ok) return Q.ui.toast(r.msg, { kind: 'error' });
      Q.sfx.coin(); Q.app.flushGame();
      Q.ui.toast('Purchased!', { kind: 'ok', icon: I('bag') });
    });
    on('buy-reward', async (el) => {
      const r = S().rewards.find((x) => x.id === el.dataset.id);
      if (!r || !(await Q.ui.confirm(`Spend ${r.cost} gold on “${r.title}”? Enjoy it, you earned it.`, { ok: 'Buy it', title: 'Treat yourself' }))) return;
      const res = G.buyReward(r.id);
      if (!res.ok) return Q.ui.toast(res.msg, { kind: 'error' });
      Q.sfx.coin(); Q.app.flushGame();
    });
    on('equip-skin', (el) => Q.app.equipSkin(el.dataset.key));
    on('equip-outfit', (el) => { S().profile.outfit = el.dataset.key; Q.store.commit('profile'); });
  }

  return { render, bind, setTab: (t) => { tab = t; } };
})();
