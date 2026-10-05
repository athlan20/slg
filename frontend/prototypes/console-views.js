// 单屏样稿的共用渲染件（四套布局共用）：资源条、警报、城建 / 征兵 / 科技 / 武将 / 领地面板、地图、时间线、
// 全局交互（菜单 / 弹窗 / 皮肤 / 战报）。各布局只负责摆放：调用这里的函数往自己的容器里渲染。
(function () {
  const D = window.CONSOLE_DATA;
  const R = window.ConsoleRight;
  const $ = (sel) => document.querySelector(sel);
  const fmt = (n) => n.toLocaleString('en-US');
  const short = (n) => (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : fmt(n));

  const LAYOUTS = [
    ['console.html', 'A 三栏控制台'],
    ['hud.html', 'B 沉浸地图'],
    ['board.html', 'C 盯盘仪表盘'],
    ['nav.html', 'D 导航工作区'],
  ];

  /** 共用状态 + URL 预设（?tile= / act= / view= / left= / intel= / pane= / page=） */
  function createState(extra) {
    const state = {
      view: 'world', left: 'build', building: 'parade_ground', tile: null, act: null,
      intel: 'march', pages: {}, layers: { moving: true, yt: true, mine: true }, pane: 'map', theme: 'night',
      ...extra,
    };
    try {
      state.theme = localStorage.getItem('console-theme') || 'night';
    } catch (e) {
      /* 无存储时用默认 */
    }
    const q = new URLSearchParams(location.search);
    for (const k of ['view', 'left', 'intel', 'pane', 'act', 'page']) if (q.get(k)) state[k] = q.get(k);
    const presets = {
      wild: { x: 135, y: 86, kind: 'wild', name: '森林 Lv6', sub: '可掠夺 · 木', terrain: '森林' },
      mover: { x: 129, y: 91, kind: 'mover', name: '运粮商队 Lv4', sub: '向东北移动 · 90 秒/格', terrain: '平原' },
      own: { x: 126, y: 93, kind: 'own', name: '新野', sub: '分城 Lv5', terrain: '平原' },
    };
    if (presets[q.get('tile')]) state.tile = presets[q.get('tile')];
    return state;
  }

  function resCells() {
    return (
      D.resources
        .map((r) => {
          const pct = Math.min(100, Math.round((r.value / r.cap) * 100));
          return `<div class="res${pct >= 90 ? ' full' : ''}" role="资源-${r.label}" title="${fmt(r.value)} / ${fmt(r.cap)}（${pct}%）">
            <div class="res-top"><span class="k">${r.label}</span><span class="v num">${short(r.value)}</span></div>
            <div class="res-sub"><span class="r num${r.rate < 0 ? ' neg' : ''}">${r.rate > 0 ? '+' : ''}${fmt(r.rate)}/h</span><span class="p num">${pct}%</span></div>
            <div class="res-bar"><i style="width:${pct}%"></i></div></div>`;
        })
        .join('') +
      `<div class="res" role="资源-人口"><div class="res-top"><span class="k">人</span><span class="v num">${fmt(D.population.current)}</span></div>
        <div class="res-sub"><span class="faint num">上限 ${fmt(D.population.cap)}</span></div>
        <div class="res-bar"><i style="width:${Math.round((D.population.current / D.population.cap) * 100)}%"></i></div></div>`
    );
  }

  function flags(which = ['alert', 'starve', 'truce']) {
    const all = {
      alert: `<span class="flag alert" role="警报-NPC来袭" data-action="alert">⚠ ${D.alerts[0].text} <b class="num">${D.alerts[0].eta}</b></span>`,
      starve: `<span class="flag warn" role="警报-断粮" title="粮净产量为负">断粮 ${D.starveIn}</span>`,
      truce: `<span class="flag ok" role="警报-免战">免战 <span class="num">${D.truce}</span></span>`,
    };
    return which.map((k) => all[k]).join('');
  }

  /** 账号菜单与城池下拉的内容 + 皮肤 / 布局切换 */
  function menus(state) {
    document.documentElement.dataset.theme = state.theme;
    const cityMenu = $('.city-menu');
    if (cityMenu) {
      cityMenu.innerHTML = D.cities
        .map((c) => `<button role="城池下拉-城池"><span>${c.name} <small class="faint">Lv${c.level}${c.main ? ' · 主城' : c.famous ? ' · 名城' : ' · 分城'}</small></span><span class="faint num">${c.x},${c.y}</span></button>`)
        .join('');
    }
    const row = $('.theme-row');
    if (row) {
      const themes = [['night', '暗夜'], ['crimson', '赤霄'], ['gilded', '鎏金'], ['paper', '宣纸']];
      row.innerHTML = themes.map(([id, label]) => `<button data-theme="${id}" class="${state.theme === id ? 'on' : ''}">${label}</button>`).join('');
    }
    const lay = $('.layout-row');
    if (lay) {
      const here = location.pathname.split('/').pop();
      lay.innerHTML = LAYOUTS.map(([href, label]) => `<a href="${href}" class="${href === here ? 'on' : ''}">${label}</a>`).join('');
    }
  }

  const RAIL = [
    { key: 'build', icon: '建', label: '城建', badge: D.buildQueue.length },
    { key: 'recruit', icon: '兵', label: '征兵', badge: D.recruitQueue.length },
    { key: 'tech', icon: '研', label: '科技', badge: 1 },
    { key: 'hero', icon: '将', label: '武将' },
    { key: 'terr', icon: '领', label: '领地' },
  ];

  function rail(host, state, onPick) {
    host.innerHTML = RAIL.map(
      (r) => `<button data-left="${r.key}" class="${state.left === r.key ? 'on' : ''}" role="城务分类-${r.label}"><b>${r.icon}</b>${r.label}${r.badge ? `<span class="badge">${r.badge}</span>` : ''}</button>`,
    ).join('');
    host.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.left)));
  }

  /** 把 host 里的 sel 当作分页宿主 */
  function wrapList(host, sel) {
    const g = host.querySelector(sel);
    g.classList.remove('grow');
    g.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;gap:4px';
    return g;
  }

  const queueRow = (q) =>
    `<div class="row q-row"><span class="name">${q.name} Lv${q.from}→${q.to} <span class="who ${q.by === 'Agent' ? 'agent' : ''}">${q.by}</span><div class="bar"><i style="width:${q.pct}%"></i></div></span><span class="num ${q.pct ? 'ok' : 'faint'}">${q.left}</span></div>`;

  /** 城务面板：kind = build | recruit | tech | hero | terr；opts.noGrid 时城建不画建筑格（布局另有城内大图） */
  function panel(host, kind, state, render, opts = {}) {
    if (kind === 'build') {
      const b = D.buildings.find((x) => x.kind === state.building);
      host.innerHTML = `
        <div class="ph"><h2>${opts.noGrid ? b.name : '城建'}</h2><span class="meta">${D.buildings.filter((x) => x.level).length}/15 已建 · 队列 ${D.buildQueue.length}/3</span></div>
        ${opts.noGrid ? '' : `<div class="b-grid" role="城建-建筑格">${D.buildings
          .map((x) => `<button class="b-cell${x.kind === state.building ? ' sel' : ''}${x.level ? '' : ' zero'}${x.busy ? ' busy' : ''}" data-b="${x.kind}" title="${x.name}"><b>${x.short}</b><small>${x.level ? `Lv${x.level}` : '未建'}</small></button>`)
          .join('')}</div>`}
        <div class="b-detail" role="城建-建筑详情">
          <div class="title"><b>${b.name}</b><span class="faint">Lv${b.level}</span><span class="dim" style="margin-left:auto;font-size:12px">${b.note}</span></div>
          <dl class="kv"><dt>升级消耗</dt><dd class="num">金 3,200 · 木 1,750 · 石 450</dd><dt>升级耗时</dt><dd class="num">约 6 分 30 秒</dd><dt>升级后</dt><dd>在外上限 ${b.level + 1} 支</dd></dl>
          <div class="lvl-pick"><span class="faint">连升到</span><select><option>Lv${b.level + 1}</option><option>Lv${b.level + 3}</option><option>Lv20</option></select>
            <button class="btn" style="margin-left:auto">${b.level ? '升级' : '建造'}</button></div>
        </div>
        <div class="ph"><h2>建造队列</h2></div>
        <div class="grow" role="城建-建造队列">${D.buildQueue.map(queueRow).join('')}</div>`;
      host.querySelectorAll('[data-b]').forEach((el) =>
        el.addEventListener('click', () => {
          state.building = el.dataset.b;
          render();
        }),
      );
    } else if (kind === 'recruit') {
      host.innerHTML = `
        <div class="ph"><h2>征兵</h2><span class="meta">军营 Lv11 · 人口余 ${fmt(D.population.cap - D.population.current)}</span></div>
        <div class="t-head"><span>兵种</span><span>城内</span><span>在外</span><span>招募</span></div>
        <div role="征兵-兵种表">${D.troops
          .map((t) => `<div class="t-row${t.unlocked ? '' : ' locked'}"><span class="name">${t.name}${t.tag ? `<span class="tag">${t.tag}</span>` : ''}</span><span class="num">${t.home}</span><span class="num faint">${t.out}</span>${t.unlocked ? '<input class="num" placeholder="0" />' : '<span class="faint">未解锁</span>'}</div>`)
          .join('')}</div>
        <div class="cost-line" role="征兵-消耗"><span>消耗 金 0 · 粮 0 · 铁 0</span><span>耗时 —</span><span>粮耗 +0/h</span></div>
        <button class="btn big">招募</button>
        ${opts.noQueue ? '' : `<div class="ph"><h2>征兵队列</h2></div>
        <div class="grow">${D.recruitQueue.map((q) => `<div class="row q-row"><span class="name">${q.name} × ${q.count}<div class="bar"><i style="width:${q.pct}%"></i></div></span><span class="num ok">${q.left}</span></div>`).join('')}</div>`}`;
    } else if (kind === 'tech') {
      host.innerHTML = `
        <div class="ph"><h2>科技</h2><span class="meta">书院 Lv6 · 账号共享</span></div>
        <div class="grow${opts.cards ? ' tech-cards' : ''}" role="科技-列表">${D.techs
          .map((t) => `<div class="row tech-row"><span class="lv num">Lv${t.level}</span><span><span class="name">${t.name}</span><span class="sub">${t.effect}</span></span>${t.researching ? `<span class="num gold">${t.researching}</span>` : '<button class="btn ghost">研究</button>'}</div>`)
          .join('')}</div>
        <p class="hint">同时只研究一项；第 N 级要求书院 ≥ N 级。</p>`;
    } else if (kind === 'hero') {
      host.innerHTML = `
        <div class="ph"><h2>武将</h2><span class="meta">普通 3/3 · 名将 1/3</span></div>
        <div class="grow" role="武将-列表"></div>
        <div class="ph"><h2>酒馆</h2><span class="meta">02:41 后刷新</span></div>
        <div class="tavern" role="武将-酒馆候选">${D.tavern
          .map((h) => `<div class="card"><b>${h.name}</b><span class="faint">统${h.lead} 武${h.might} 智${h.wit}</span><button class="btn">${fmt(h.cost)} 金</button></div>`)
          .join('')}</div>`;
      R.paged(wrapList(host, '.grow'), D.heroes, 58, (h) => `
        <div class="hero${h.famous ? ' famous' : ''}"><span class="nm">${h.name}<small>${h.famous ? '名将' : ''} Lv${h.level}</small></span><span class="st">${h.state}</span>
        <span class="attrs"><span>统 ${h.lead}</span><span>武 ${h.might}</span><span>智 ${h.wit}</span></span></div>`, state, 'hero', render);
    } else {
      host.innerHTML = `
        <div class="ph"><h2>领地</h2><span class="meta">${D.territory.length} / 9（官府 Lv9）</span></div>
        <div class="grow" role="领地-列表"></div>`;
      R.paged(wrapList(host, '.grow'), D.territory, 40, (t) => `
        <div class="row terr-row"><span><span class="name">${t.terrain} Lv${t.level} <span class="faint num">(${t.pos})</span></span><span class="sub">${t.bonus}${t.cluster ? ` · ${t.cluster}` : ''}</span></span><button class="btn ghost">定位</button></div>`, state, 'terr', render);
    }
  }

  /** 世界地图（含黄巾浮卡 / 图例，若容器里有） */
  function world(wrap, state, onPick) {
    window.ConsoleMap.renderWorld(wrap.querySelector('.map'), wrap.querySelector('.routes'), {
      center: { x: 132, y: 88 }, layers: state.layers, selected: state.tile, onPick,
    });
    const yt = wrap.querySelector('.yt-card');
    if (yt) {
      yt.hidden = !state.layers.yt;
      yt.innerHTML = `<b>黄巾之乱 · ${D.yt.stage}</b>
        <div class="bar"><i style="width:${Math.round((D.yt.cleared / D.yt.total) * 100)}%;background:var(--warn)"></i></div>
        <span class="dim">已清 ${D.yt.cleared}/${D.yt.total} · 剩 <span class="num">${D.yt.left}</span> · 我的贡献第 ${D.yt.rank}</span>`;
    }
    const legend = wrap.querySelector('.legend');
    if (legend) {
      legend.innerHTML =
        window.ConsoleMap.TERRAINS.map((t) => `<span><i style="background:var(--t-${t.key})"></i>${t.label}</span>`).join('') +
        '<span><i style="background:var(--accent-soft);border-color:var(--accent)"></i>本方</span><span><i style="border-color:var(--gold)"></i>名城</span><span><i style="border-color:var(--warn);border-radius:50%"></i>黄巾</span><span><i style="background:var(--gold);border-radius:50%"></i>移动目标</span>';
    }
  }

  function city(wrap, state, onPick) {
    const svg = wrap.querySelector('.routes');
    if (svg) svg.innerHTML = '';
    window.ConsoleMap.renderCity(wrap.querySelector('.map'), D.buildings, state.building, onPick);
  }

  const chip = (text, left, pct) => `<span class="chip"><span>${text}</span><span class="t num">${left}</span><i style="width:${pct}%"></i></span>`;
  function laneData() {
    return [
      ['建造', D.buildQueue.map((q) => chip(`${q.name} →${q.to}`, q.left, q.pct))],
      ['征兵', D.recruitQueue.map((q) => chip(`${q.name} ×${q.count}`, q.left, q.pct))],
      ['科技', D.techs.filter((t) => t.researching).map((t) => chip(`${t.name} →${t.level + 1}`, t.researching, 55))],
      ['行军', D.marches.map((m) => chip(`${m.title.split(' ')[0]} · ${m.state}`, m.eta, m.pct))],
    ];
  }
  function lanes(host) {
    host.innerHTML = laneData()
      .map(([name, items]) => `<div class="lane" role="时间线-${name}"><span>${name}</span><div class="lane-items">${items.length ? items.join('') : '<span class="chip idle">空闲</span>'}</div></div>`)
      .join('');
  }
  /** 单行时间线：所有进行中的事按剩余时间排成一行（沉浸 / 导航布局用） */
  function laneStrip(host) {
    host.innerHTML = laneData()
      .flatMap(([name, items]) => items.map((html) => html.replace('<span class="chip">', `<span class="chip"><span class="faint">${name}</span>`)))
      .join('');
  }
  function ticker(host, n = 3) {
    host.innerHTML = `<p><b>全服</b> ${D.broadcasts[0]}</p>${D.broadcasts.slice(1, n).map((t) => `<p>${t}</p>`).join('')}`;
  }

  /** 全局交互：皮肤、战报行、菜单、弹窗、视图 / 图层切换、窗口重算 */
  function bindGlobal(state, render) {
    document.addEventListener('click', (e) => {
      const theme = e.target.closest('button[data-theme]');
      if (theme) {
        state.theme = theme.dataset.theme;
        try {
          localStorage.setItem('console-theme', state.theme);
        } catch (err) {
          /* 忽略 */
        }
        render();
        return;
      }
      const rep = e.target.closest('[data-report]');
      if (rep) {
        window.ConsoleModal.battleReport(D.reports[Number(rep.dataset.report)]);
        return;
      }
      const view = e.target.closest('[data-view]');
      if (view) {
        state.view = view.dataset.view;
        render();
        return;
      }
      const a = e.target.closest('[data-action]');
      if (!a) {
        if (!e.target.closest('.city-menu, .account-menu')) {
          document.querySelectorAll('.city-menu, .account-menu').forEach((m) => (m.hidden = true));
        }
        return;
      }
      const M = window.ConsoleModal;
      const act = a.dataset.action;
      if (act === 'leaderboard') M.leaderboard();
      if (act === 'exchange') M.exchange(a);
      if (act === 'offline') M.offline();
      if (act === 'toggle-cities') $('.city-menu').hidden = !$('.city-menu').hidden;
      if (act === 'toggle-account') $('.account-menu').hidden = !$('.account-menu').hidden;
      if (act === 'reset') {
        $('.account-menu').hidden = true;
        M.open('重置账号', '<p class="bad" style="margin:0">清空全部城池、建筑、军队、武将与领地，回到开号状态，不可撤销。</p><div class="acts"><button class="btn ghost" data-close>返回</button><button class="btn" style="border-color:var(--bad);color:var(--bad)">确认重置</button></div>', { small: true });
      }
      if (act === 'alert') {
        const t = $('.alert-toast');
        t.innerHTML = '<b class="bad">NPC 来袭 · 襄阳</b><span class="dim">Lv6 · 约 300–400 · <span class="num">08:42</span> 后到达</span><button class="btn">增援</button><button class="btn ghost" data-dismiss>知道了</button>';
        t.hidden = false;
        t.querySelector('[data-dismiss]').addEventListener('click', () => (t.hidden = true));
      }
    });
    document.addEventListener('change', (e) => {
      const c = e.target.closest('[data-layer]');
      if (c) {
        state.layers[c.dataset.layer] = c.checked;
        render();
      }
    });
    let timer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(render, 80);
    });
  }

  window.CV = { D, $, fmt, createState, resCells, flags, menus, rail, panel, world, city, lanes, laneStrip, ticker, bindGlobal };
})();
