// 方案 D「导航工作区」：左侧导航切页，工作区一次一页，每页按单屏排版。
(function () {
  const { D, $ } = window.CV;
  const CV = window.CV;
  const R = window.ConsoleRight;
  const state = CV.createState({ page: 'overview', picked: false });
  if (new URLSearchParams(location.search).get('tile')) state.page = state.page === 'overview' ? 'map' : state.page;

  const PAGES = [
    { key: 'overview', icon: '览', label: '总览', badge: '1', hot: true },
    { key: 'map', icon: '图', label: '地图' },
    { key: 'city', icon: '城', label: '城池', badge: String(D.buildQueue.length) },
    { key: 'army', icon: '兵', label: '军队', badge: String(D.marches.length) },
    { key: 'growth', icon: '养', label: '养成', badge: '1' },
    { key: 'intel', icon: '报', label: '情报', badge: String(D.reports.length) },
    { key: 'agent', icon: 'A', label: 'Agent' },
  ];

  const card = (cls, inner) => `<section class="card ${cls}">${inner}</section>`;
  const mapCard = (cls) =>
    card(`flush ${cls}`, `<div class="card-head"><h3>世界地图</h3><div class="seg"><button data-view="world">世界</button><button data-view="city">城内</button></div>
      <div class="layers"><label><input type="checkbox" data-layer="moving" ${state.layers.moving ? 'checked' : ''} />流寇·商队</label><label><input type="checkbox" data-layer="yt" ${state.layers.yt ? 'checked' : ''} />黄巾</label><label><input type="checkbox" data-layer="mine" ${state.layers.mine ? 'checked' : ''} />领地</label></div></div>
      <div class="map-wrap"><div class="map"></div><svg class="routes"></svg><div class="yt-card"></div><div class="legend"></div></div>`);

  function go(page) {
    state.page = page;
    render();
  }

  function pickTile(info) {
    state.tile = info;
    state.act = null;
    state.page = 'map';
    render();
  }

  function drawMap(host) {
    host.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    if (state.view === 'world') CV.world(host, state, pickTile);
    else {
      host.querySelector('.yt-card').hidden = true;
      host.querySelector('.legend').hidden = true;
      CV.city(host, state, (kind) => {
        state.building = kind;
        state.page = 'city';
        state.picked = true;
        render();
      });
    }
  }

  function renderPage(work) {
    const p = state.page;
    work.className = `work p-${p}${state.tile ? ' has-tile' : ''}${state.picked ? ' picked' : ''}`;
    if (p === 'overview') {
      work.innerHTML = mapCard('a-map') + card('a-ctx ctx', '') + card('a-lanes', '<div class="ph"><h2>进行中</h2></div><div class="lanes"></div>');
      drawMap(work.querySelector('.a-map'));
      const keep = state.tile;
      state.tile = null; // 总览只看军情摘要；点地图格会跳到地图页
      R.renderCtx(work.querySelector('.a-ctx'), state, D, render);
      state.tile = keep;
      CV.lanes(work.querySelector('.lanes'));
    } else if (p === 'map') {
      work.innerHTML = mapCard('') + card('ctx', '');
      drawMap(work.firstElementChild);
      R.renderCtx(work.querySelector('.ctx'), state, D, render);
    } else if (p === 'city') {
      const prev = state.view;
      state.view = 'city';
      work.innerHTML = mapCard('') + card('dock-panel', '');
      drawMap(work.firstElementChild);
      state.view = prev;
      work.querySelector('.card-head h3').textContent = '城内';
      work.querySelector('.card-head .seg').remove();
      work.querySelector('.card-head .layers').remove();
      CV.panel(work.querySelector('.dock-panel'), 'build', state, render, { noGrid: true });
    } else if (p === 'army') {
      work.innerHTML = card('a1', '') + card('a2', '<div class="ph"><h2>行军</h2><span class="meta">在外 3 / 5 支</span></div><div class="lst" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:4px"></div>') + card('a3', '');
      CV.panel(work.querySelector('.a1'), 'recruit', state, render);
      state.intel = 'march';
      R.renderIntel(document.createElement('div'), work.querySelector('.a2 .lst'), state, D, render);
      CV.panel(work.querySelector('.a3'), 'terr', state, render);
    } else if (p === 'growth') {
      work.innerHTML = card('g1', '') + card('g2', '');
      CV.panel(work.querySelector('.g1'), 'hero', state, render);
      CV.panel(work.querySelector('.g2'), 'tech', state, render, { cards: true });
    } else if (p === 'intel') {
      const col = (t) => card('', `<div class="ph"><h2>${t}</h2></div><div class="lst" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:4px"></div>`);
      work.innerHTML = col('战报') + col('动态') + col('行军');
      const lists = work.querySelectorAll('.lst');
      [['report', 0], ['event', 1], ['march', 2]].forEach(([k, i]) => {
        state.intel = k;
        R.renderIntel(document.createElement('div'), lists[i], state, D, render);
      });
    } else {
      work.innerHTML = card('ag1', '') + card('ag2', '<div class="ph"><h2>Agent 操作</h2><span class="meta">今日 23 次</span></div><div class="lst" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:4px"></div>') +
        card('ag3', `<div class="ph"><h2>离线日报</h2><span class="meta">17:02 上线</span></div>
          <div class="row i-row"><span><span class="name">离线 7 小时 12 分</span><small>收获 粮 8,900 · 木 7,100 · 金 6,300</small></span></div>
          <div class="row i-row"><span><span class="name">战斗 胜 5 · 败 1 · 扑空 1</span><small>NPC 袭击 2 次，守住 2 · 减员 86</small></span></div>
          <p class="hint">${D.agent.plan}</p><button class="btn" data-action="offline" style="margin-top:auto">查看完整日报</button>`);
      state.intel = 'agent';
      R.renderIntel(document.createElement('div'), work.querySelector('.ag1'), state, D, render);
      R.paged(work.querySelector('.ag2 .lst'), D.events.filter((e) => e.who === 'Agent'), 30, (e) => `
        <div class="row i-row"><span class="name">${e.text}</span><span class="faint num">${e.time}</span></div>`, state, 'aglog', render);
    }
  }

  function render() {
    CV.menus(state);
    $('.side-nav').innerHTML = PAGES.map(
      (pg) => `<button data-page="${pg.key}" class="${state.page === pg.key ? 'on' : ''}" role="导航-${pg.label}"><b>${pg.icon}</b><span>${pg.label}</span>${pg.badge ? `<i class="badge${pg.hot ? ' hot' : ''}">${pg.badge}</i>` : ''}</button>`,
    ).join('');
    $('.side-nav').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
    $('.page-title').textContent = PAGES.find((pg) => pg.key === state.page).label;
    $('.res-strip').innerHTML = CV.resCells();
    $('.top-flags').innerHTML = CV.flags();
    renderPage($('.work'));
    CV.laneStrip($('.hud-strip'));
    CV.ticker($('.nav-ticker'), 1);
  }

  CV.bindGlobal(state, render);
  render();
})();
