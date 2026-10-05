// 单屏控制台：右栏「情报」——上半是选中目标的详情与就地操作（替代原地块详情弹窗），
// 下半是分页的情报列表（行军 / 战报 / Agent / 动态）。列表每页条数按可用高度计算，不出现滚动条。
(function () {
  const fmt = (n) => n.toLocaleString('en-US');

  /** 分页渲染：先放空容器测高，再按行高算每页条数；翻页状态存在 state.pages[key] */
  function paged(host, items, rowH, renderRow, state, key, rerender) {
    host.innerHTML = '<div class="grow" role="分页列表"></div><div class="pager" role="分页器"></div>';
    const list = host.querySelector('.grow');
    // 分页器先占位，否则测高时列表会多算一个分页器的高度
    host.querySelector('.pager').innerHTML = '<button>‹</button><span>1 / 1</span><button>›</button>';
    // 先渲染一条测真实行高（文案换行、字号断点都会改变行高），测不到再退回估计值
    list.innerHTML = items.length ? renderRow(items[0]) : '';
    const measured = list.firstElementChild ? list.firstElementChild.getBoundingClientRect().height : 0;
    const per = Math.max(1, Math.floor((list.clientHeight + 4) / ((measured || rowH) + 4)));
    const pages = Math.max(1, Math.ceil(items.length / per));
    const page = Math.min(state.pages[key] || 0, pages - 1);
    list.innerHTML = items.slice(page * per, page * per + per).map(renderRow).join('');
    const pager = host.querySelector('.pager');
    if (pages <= 1) {
      pager.innerHTML = `<span>共 ${items.length} 条</span>`;
      return;
    }
    pager.innerHTML = `<button data-p="-1">‹</button><span>${page + 1} / ${pages}</span><button data-p="1">›</button>`;
    pager.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.pages[key] = Math.max(0, Math.min(pages - 1, page + Number(b.dataset.p)));
        rerender();
      }),
    );
  }

  const ACTS = {
    wild: ['掠夺', '占领', '侦察'],
    mine: ['增援', '撤回驻军'],
    npc: ['掠夺', '占领', '侦察'],
    famous: ['调兵', '运输'],
    camp: ['清剿', '侦察'],
    mover: ['截击', '侦察'],
    own: ['调兵', '运输'],
  };

  function troopForm(D) {
    const rows = D.troops
      .filter((t) => t.unlocked)
      .map(
        (t) =>
          `<label role="出征编队-兵种"><span class="name">${t.name}</span><span class="have num">${t.home}</span><input class="num" placeholder="0" /></label>`,
      )
      .join('');
    return `<div class="tf" role="出征编队">${rows}</div>`;
  }

  function cargoForm(D) {
    const rows = D.resources
      .map((r) => `<label role="运输货物-资源"><span class="name">${r.label}</span><span class="have num">${Math.round(r.value / 1000)}k</span><input class="num" placeholder="0" /></label>`)
      .join('');
    return `<div class="tf" role="运输货物">${rows}</div>`;
  }

  function renderCtx(host, state, D, rerender) {
    const t = state.tile;
    if (!t) {
      // 未选中：军情摘要（来袭 / 黄巾 / Agent 下一步），引导去地图点选
      host.innerHTML = `
        <div class="ph" role="军情摘要-头部"><h2>军情</h2><span class="meta">点地图格查看详情与操作</span></div>
        <div class="ctx-empty" role="军情摘要">
          <div class="row i-row" style="border-color:var(--bad)"><span><b class="bad">NPC 来袭 · 襄阳</b><small>Lv6 · 弓箭兵 / 义兵 约 300–400 · 烽火台 4 级</small></span><span class="num bad">08:42</span></div>
          <div class="row i-row"><span><b class="warn">黄巾之乱 · ${D.yt.stage}</b><small>已清 ${D.yt.cleared}/${D.yt.total} · 我的贡献 ${fmt(D.yt.mine)}（第 ${D.yt.rank}）</small></span><span class="num dim">${D.yt.left}</span></div>
          <div class="row i-row"><span><b class="warn">断粮预警 · 免战中</b><small>粮净产 −120/h，约 ${D.starveIn} 后断粮 · 免战剩 ${D.truce}</small></span><button class="btn ghost">去征兵</button></div>
          <div class="row i-row"><span><b class="gold">运粮商队 Lv4 · 3 支</b><small>最近一支 6 格外，推荐截击格 (129,86)</small></span><button class="btn ghost">定位</button></div>
          <div class="row i-row"><span><b>Agent 下一步</b><small>${D.agent.next}</small></span><span class="who agent">在线</span></div>
        </div>`;
      return;
    }
    const acts = ACTS[t.kind] || ACTS.wild;
    const act = acts.includes(state.act) ? state.act : acts[0];
    const icon = { own: '城', famous: '名', npc: 'N', camp: '巾', mover: '商', mine: '领' }[t.kind] || t.terrain[0];
    let body = '';
    if (act === '运输') body = cargoForm(D) + troopForm(D).replace('出征编队', '运输护送');
    else if (act === '撤回驻军') body = '<p class="hint">驻军 弓 80 · 刀 60 将返回襄阳，放弃该野地。</p>';
    else if (act === '侦察') body = '<p class="hint">派 5 名斥候侦察，约 40 秒到达；侦察等级 3：可见各兵种近似数量。</p>';
    else body = troopForm(D);
    let verdict = '';
    if (act === '截击') verdict = '<div class="verdict ok" role="截击判断">✓ 赶得上：约 46 秒到达，将埋伏 2 分 10 秒，预计 17:14 接战 · <a class="gold">换推荐截击格</a></div>';
    else if (['掠夺', '清剿', '占领'].includes(act)) verdict = '<div class="verdict" role="出征判断">战力 4,820 · 守军约 1,900（Lv6 推荐 2×）· 负重 12,400 · <span class="num">约 1 分 05 秒</span>到达</div>';
    host.innerHTML = `
      <div class="ctx-title" role="选中详情-标题">
        <span class="ctx-icon">${icon}</span>
        <span><b>${t.name}</b><small>(${t.x},${t.y}) · ${t.terrain} · ${t.sub}</small></span>
        <button class="btn ghost" data-close style="margin-left:auto">✕</button>
      </div>
      <div class="facts" role="选中详情-要点">
        <div class="fact"><span>距离</span><b class="num">${Math.abs(t.x - 132) + Math.abs(t.y - 88)} 格</b></div>
        <div class="fact"><span>守军</span><b>${t.kind === 'own' ? '—' : '约 1,900'}</b></div>
        <div class="fact"><span>上次侦察</span><b>${t.kind === 'wild' ? '未侦察' : '16:40'}</b></div>
      </div>
      <div class="acts" role="选中详情-操作类型">${acts.map((a) => `<button class="${a === act ? 'on' : ''}" data-act="${a}">${a}</button>`).join('')}</div>
      ${body}
      <div class="form-foot" role="选中详情-编队选项">
        <span>随队将领</span><select><option>不带将领</option><option>赵武 Lv4（统32 武38）</option><option>李衡 Lv2</option></select>
        <button class="btn ghost">全军</button><button class="btn ghost">清空</button>
      </div>
      ${verdict}
      <button class="btn big" role="选中详情-确认">确认${act}</button>`;
    host.querySelector('[data-close]').addEventListener('click', () => {
      state.tile = null;
      rerender();
    });
    host.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        state.act = b.dataset.act;
        rerender();
      }),
    );
  }

  const INTEL_TABS = [
    { key: 'march', label: '行军' },
    { key: 'report', label: '战报' },
    { key: 'agent', label: 'Agent' },
    { key: 'event', label: '动态' },
  ];

  function renderIntel(tabsHost, body, state, D, rerender) {
    const counts = { march: D.marches.length, report: D.reports.length, event: D.events.length };
    tabsHost.innerHTML = INTEL_TABS.map(
      (t) => `<button data-tab="${t.key}" class="${state.intel === t.key ? 'on' : ''}">${t.label}${counts[t.key] ? `<span class="n">${counts[t.key]}</span>` : ''}</button>`,
    ).join('');
    tabsHost.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.intel = b.dataset.tab;
        rerender();
      }),
    );
    if (state.intel === 'march') {
      paged(body, D.marches, 44, (m) => `
        <div class="row i-row" role="行军条目"><span><span class="name">${m.title}</span><small>${m.who} · ${m.state}</small><div class="bar"><i style="width:${m.pct}%"></i></div></span>
        <span class="num ${m.state === '埋伏中' ? 'gold' : ''}">${m.eta}</span></div>`, state, 'march', rerender);
    } else if (state.intel === 'report') {
      const tone = { 胜: 'ok', 守住: 'ok', 败: 'bad', 扑空: 'warn', 情报: 'dim' };
      paged(body, D.reports, 38, (r) => `
        <div class="row i-row" role="战报条目" data-report="${D.reports.indexOf(r)}" style="cursor:pointer"><span><span class="name">${r.title}</span><small>${r.detail}</small></span>
        <span class="res ${tone[r.result]}">${r.result} <span class="faint num">${r.time}</span></span></div>`, state, 'report', rerender);
    } else if (state.intel === 'event') {
      paged(body, D.events, 30, (e) => `
        <div class="row i-row" role="动态条目"><span class="name"><span class="who ${e.who === 'Agent' ? 'agent' : ''}">${e.who}</span>${e.text}</span>
        <span class="faint num">${e.time}</span></div>`, state, 'event', rerender);
    } else {
      body.innerHTML = `
        <div class="ph"><h2>作战方针</h2><span class="meta"><i class="dot on"></i> Agent 在线 · 1 个连接</span></div>
        <div class="directive" role="Agent-作战方针">
          <span class="faint">取向</span><select><option>${D.agent.stance}</option><option>发展经济</option><option>均衡</option><option>保守防守</option></select>
          <span class="faint">出征最低</span><input class="num" value="${D.agent.minTroops}" />
          <span class="faint">补充</span><textarea placeholder="一句话交代 Agent">黄巾大营来袭前把弓兵调回襄阳</textarea>
        </div>
        <div class="row i-row" role="Agent-计划"><span><span class="name">下一步：${D.agent.next}</span><small>${D.agent.plan}</small></span></div>
        <div style="display:flex;gap:6px;margin-top:auto">
          <button class="btn">保存方针</button><button class="btn ghost" data-action="offline">离线日报</button><button class="btn ghost">复制接入文档</button>
        </div>`;
    }
  }

  window.ConsoleRight = { renderCtx, renderIntel, paged };
})();
