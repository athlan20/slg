// 方案 C「盯盘仪表盘」：关键指标 + 等权组件格；Agent 托管单独一格。
(function () {
  const { D, $ } = window.CV;
  const CV = window.CV;
  const R = window.ConsoleRight;
  const state = CV.createState({ pane: 'ctx', intel: 'report' });
  const q = new URLSearchParams(location.search);
  if (q.get('intel')) state.intel = q.get('intel');
  if (q.get('pane')) state.pane = q.get('pane');

  const KPIS = [
    ['综合战力', '98,420', '<span class="up">▲2</span> 全服第 7'],
    ['领地', '7 / 9', '连片 1 组 · +10%'],
    ['在外部队', '3 / 5', '校场 Lv5'],
    ['今日掠夺', '41.2k', '<span class="up">▲18%</span> 较昨日'],
    ['黄巾贡献', '1,840', '第 7 · 剩 13:20:00'],
    ['Agent 今日', '23 次', '建造 6 · 出征 11 · 兑换 2'],
  ];

  function render() {
    $('.board').dataset.pane = state.pane;
    $('.board').classList.toggle('has-tile', state.tile !== null);
    $('.res-strip').innerHTML = CV.resCells();
    $('.top-flags').innerHTML = CV.flags();
    CV.menus(state);
    $('.kpis').innerHTML =
      KPIS.map(([k, v, s]) => `<div class="kpi" role="指标-${k}"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('') +
      `<div class="kpi cast" role="指标-全服播报">${D.broadcasts.map((t, i) => `<p>${i === 0 ? '<b>全服</b> ' : ''}${t}</p>`).join('')}</div>`;

    // 城务（左列两行）
    CV.rail($('.rail.mini'), state, (key) => {
      state.left = key;
      render();
    });
    CV.panel($('.w-city .dock-panel'), state.left, state, render);

    // 地图
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    $('.w-map .yt-card').hidden = state.view !== 'world';
    if (state.view === 'world')
      CV.world($('.w-map'), state, (info) => {
        state.tile = info;
        state.act = null;
        if (window.innerWidth < 1024) state.pane = 'ctx';
        render();
      });
    else
      CV.city($('.w-map'), state, (kind) => {
        state.building = kind;
        state.left = 'build';
        if (window.innerWidth < 1024) state.pane = 'city';
        render();
      });

    // 军情 / 选中目标
    R.renderCtx($('.w-ctx .ctx'), state, D, render);

    // 进行中
    CV.lanes($('.w-lanes .lanes'));

    // Agent 托管：方针 + 最近操作
    const keep = state.intel;
    state.intel = 'agent';
    R.renderIntel(document.createElement('div'), $('.agent-form'), state, D, render);
    state.intel = keep;
    R.paged($('.agent-log'), D.events.filter((e) => e.who === 'Agent'), 30, (e) => `
      <div class="row i-row"><span class="name">${e.text}</span><span class="faint num">${e.time}</span></div>`, state, 'agentlog', render);

    // 情报（战报 / 行军 / 动态）
    if (state.intel === 'agent') state.intel = 'report';
    R.renderIntel($('.w-intel .tabs'), $('.w-intel .intel-body'), state, D, render);
    $('.w-intel .tabs [data-tab="agent"]')?.remove();

    $('.board-tabs').innerHTML = [['city', '城务'], ['map', '地图'], ['ctx', state.tile ? '选中' : '军情'], ['agent', 'Agent'], ['intel', '情报']]
      .map(([k, l]) => `<button data-pane="${k}" class="${state.pane === k ? 'on' : ''}">${l}</button>`)
      .join('');
    $('.board-tabs').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.pane = b.dataset.pane;
        render();
      }),
    );
  }

  CV.bindGlobal(state, render);
  render();
})();
