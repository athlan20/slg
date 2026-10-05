// 方案 B「沉浸地图」：地图铺满，城务抽屉 / 情报卡 / 指挥条都浮在地图上。
(function () {
  const { D, $ } = window.CV;
  const CV = window.CV;
  const R = window.ConsoleRight;
  const state = CV.createState({ drawer: false, card: 'ctx', folded: false });
  if (new URLSearchParams(location.search).get('left')) state.drawer = true;
  if (new URLSearchParams(location.search).get('intel')) state.card = state.intel;
  const narrow = () => window.innerWidth < 1024;

  const CARD_TABS = [['ctx', '军情'], ['march', '行军'], ['report', '战报'], ['agent', 'Agent'], ['event', '动态']];

  function render() {
    $('.res-strip').innerHTML = CV.resCells();
    $('.top-flags').innerHTML = CV.flags();
    CV.menus(state);

    // 左：图标坞 + 抽屉（再点同一图标收起）
    CV.rail($('.hud-rail'), { ...state, left: state.drawer ? state.left : null }, (key) => {
      state.drawer = !(state.drawer && state.left === key);
      state.left = key;
      if (state.drawer && narrow()) state.folded = true;
      render();
    });
    const drawer = $('.hud-drawer');
    drawer.hidden = !state.drawer;
    if (state.drawer) CV.panel(drawer, state.left, state, render);

    // 中：地图铺满
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    const pick = (info) => {
      state.tile = info;
      state.act = null;
      state.card = 'ctx';
      state.folded = false;
      if (narrow()) state.drawer = false;
      render();
    };
    if (state.view === 'world') CV.world($('.hud'), state, pick);
    else
      CV.city($('.hud-map'), state, (kind) => {
        state.building = kind;
        state.left = 'build';
        state.drawer = true;
        render();
      });
    $('.hud-yt').hidden = state.view !== 'world' || !state.layers.yt;

    // 右：情报卡（军情 / 选中目标 + 四个列表），可折叠
    const card = $('.hud-card');
    card.classList.toggle('folded', state.folded);
    const label = state.tile ? '选中' : '军情';
    $('.hud-tabs').innerHTML =
      CARD_TABS.map(([k, l]) => `<button data-card="${k}" class="${state.card === k ? 'on' : ''}">${k === 'ctx' ? label : l}</button>`).join('') +
      `<button class="fold" data-fold>${state.folded ? '展开 ▾' : '收起 ▴'}</button>`;
    $('.hud-tabs').querySelectorAll('[data-card]').forEach((b) =>
      b.addEventListener('click', () => {
        state.card = b.dataset.card;
        state.folded = false;
        if (narrow()) state.drawer = false;
        render();
      }),
    );
    $('.hud-tabs [data-fold]').addEventListener('click', () => {
      state.folded = !state.folded;
      render();
    });
    const body = $('.hud-card-body');
    if (!state.folded) {
      if (state.card === 'ctx') {
        body.innerHTML = '<div class="ctx-inner"></div>';
        R.renderCtx(body.firstChild, state, D, render);
      } else {
        state.intel = state.card;
        R.renderIntel(document.createElement('div'), body, state, D, render);
      }
    }

    CV.laneStrip($('.hud-strip'));
    CV.ticker($('.hud-ticker'), 1);
  }

  CV.bindGlobal(state, render);
  render();
})();
