// 方案 A「三栏控制台」：左 城务 · 中 地图 · 右 情报 · 底 时间线。渲染件见 console-views.js / console-right.js。
(function () {
  const { D, $ } = window.CV;
  const CV = window.CV;
  const R = window.ConsoleRight;
  const state = CV.createState();

  function render() {
    $('.shell').dataset.pane = state.pane;
    $('.dock.right').classList.toggle('has-tile', state.tile !== null);
    $('.res-strip').innerHTML = CV.resCells();
    $('.top-flags').innerHTML = CV.flags();
    CV.menus(state);
    CV.rail($('.rail'), state, (key) => {
      const dock = $('.dock.left');
      // 窄屏下左栏是浮层：再点同一个图标收起
      if (state.left === key && dock.classList.contains('open')) dock.classList.remove('open');
      else dock.classList.add('open');
      state.left = key;
      render();
    });
    CV.panel($('.dock-panel'), state.left, state, render);

    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    const world = state.view === 'world';
    $('.yt-card').hidden = !world;
    $('.legend').hidden = !world;
    $('.layers').style.visibility = world ? '' : 'hidden';
    if (world) {
      CV.world($('.map-wrap'), state, (info) => {
        state.tile = info;
        state.act = null;
        if (window.innerWidth < 1024) state.pane = 'intel';
        render();
      });
    } else {
      CV.city($('.map-wrap'), state, (kind) => {
        state.building = kind;
        state.left = 'build';
        $('.dock.left').classList.add('open');
        render();
      });
    }

    R.renderCtx($('.ctx'), state, D, render);
    R.renderIntel($('.tabs'), $('.intel-body'), state, D, render);
    CV.lanes($('.lanes'));
    CV.ticker($('.ticker'));
    renderMobileTabs();
  }

  function renderMobileTabs() {
    let tabs = $('.mobile-tabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.className = 'mobile-tabs';
      tabs.setAttribute('role', '底栏-窄屏分页签');
      $('.timeline').appendChild(tabs);
    }
    tabs.innerHTML = [['city', '城务'], ['map', '地图'], ['intel', '情报']]
      .map(([k, l]) => `<button data-pane="${k}" class="${state.pane === k ? 'on' : ''}">${l}</button>`)
      .join('');
    tabs.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.pane = b.dataset.pane;
        render();
      }),
    );
  }

  CV.bindGlobal(state, render);
  render();
})();
