// 单屏控制台：弹窗。原则——「操作就地做，详情才弹窗」：只读、内容多、偶尔看的放弹窗
// （战报详情 / 侦察报告 / 排行榜 / 离线日报），轻量操作用锚定在按钮旁的小浮层（集市兑换），
// 高危确认（重置账号）用确认框。弹窗内容同样不滚动，超出就分页。
(function () {
  const D = window.CONSOLE_DATA;

  function open(title, bodyHtml, opts = {}) {
    close();
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.setAttribute('role', `弹窗-${title}`);
    mask.innerHTML = `
      <div class="modal${opts.small ? ' small' : ''}" role="弹窗-面板">
        <div class="modal-head"><b>${title}</b>${opts.meta ? `<span class="faint">${opts.meta}</span>` : ''}<button class="btn ghost" data-close>✕</button></div>
        <div class="modal-body" role="弹窗-内容">${bodyHtml}</div>
      </div>`;
    mask.addEventListener('click', (e) => {
      if (e.target === mask || e.target.closest('[data-close]')) close();
    });
    document.body.appendChild(mask);
  }

  function close() {
    document.querySelectorAll('.modal-mask').forEach((m) => m.remove());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  function battleReport(r) {
    const rounds = Array.from({ length: 8 }, (_, i) => {
      const a = 30 + Math.round(Math.sin(i + 1) * 20 + 40);
      const d = 20 + Math.round(Math.cos(i) * 15 + 30);
      return `<div class="rb"><i style="height:${a}%"></i><i class="d" style="height:${d}%"></i><span>${i + 1}</span></div>`;
    }).join('');
    const side = (name, rows) => `<div class="side"><b>${name}</b>${rows.map(([k, v, l]) => `<div class="kvr"><span>${k}</span><span class="num">${v}</span><span class="num bad">${l ? `−${l}` : ''}</span></div>`).join('')}</div>`;
    open(r.title, `
      <div class="verdict ${r.result === '胜' || r.result === '守住' ? 'ok' : 'bad'}">${r.result} · ${r.detail} · 8 回合 · 最远射程 我方 70 / 敌方 10</div>
      <div class="sides">${side('xiling · 襄阳', [['弓箭兵', 150, 4], ['刀盾兵', 200, 8], ['将领 赵武', '武 38', '']])}${side('野地守军 Lv5', [['义兵', 30, 30], ['弓箭兵', 3, 3]])}</div>
      <div class="rounds" role="战报-逐回合">${rounds}</div>
      <div class="kvr"><span class="faint">战利品</span><span class="num">木 3,750 · 金 1,250</span><span></span></div>
      <div class="kvr"><span class="faint">Agent 点评</span><span>弓兵站桩打满 6 回合，近战几乎无损，这个编成可复用。</span><span></span></div>`, { meta: r.time });
  }

  function leaderboard() {
    const rows = Array.from({ length: 10 }, (_, i) => `<div class="lb${i === 6 ? ' me' : ''}"><span class="num">${i + 1}</span><span>${i === 6 ? 'xiling' : ['子龙', '孟德', '仲谋', '玄德', '奉孝', '公瑾', '', '文远', '伯约', '士元'][i]}</span><span class="num">${(98000 - i * 7300).toLocaleString('en-US')}</span><span class="faint">${i % 3 === 0 ? 'Agent' : ''}</span></div>`).join('');
    open('排行榜', `
      <div class="acts"><button class="on">综合战力</button><button>领地数量</button><button>累计掠夺</button></div>
      <div class="lb-list">${rows}</div>
      <div class="pager"><button>‹</button><span>1 / 5</span><button>›</button><span>· 我的名次 第 7</span></div>`, { meta: '每 10 分钟刷新' });
  }

  function offline() {
    open('离线日报', `
      <div class="sides">
        <div class="side"><b>离线 7 小时 12 分 · 服务端统计</b>
          <div class="kvr"><span>收获</span><span class="num">粮 8,900 · 木 7,100 · 金 6,300</span><span></span></div>
          <div class="kvr"><span>战斗</span><span class="num">胜 5 · 败 1 · 扑空 1</span><span></span></div>
          <div class="kvr"><span>减员</span><span class="num bad">−86</span><span></span></div>
          <div class="kvr"><span>NPC 袭击</span><span class="num">2 次，守住 2</span><span></span></div></div>
        <div class="side"><b>Agent 日报</b><p class="dim" style="margin:4px 0 0">${D.agent.plan} 夜里两次 NPC 来袭都靠箭塔 + 弓兵守住；建议明天优先把仓库升到 10，木材已经 92%。</p></div>
      </div>`, { meta: '17:02 上线' });
  }

  function exchange(anchor) {
    close();
    const pop = document.createElement('div');
    pop.className = 'modal-mask clear';
    pop.setAttribute('role', '浮层-集市兑换');
    const r = anchor.getBoundingClientRect();
    pop.innerHTML = `<div class="popover" style="top:${r.bottom + 6}px;right:${innerWidth - r.right}px">
      <b>集市兑换 <span class="faint">4 : 1 换金</span></b>
      <div class="acts"><button>粮</button><button class="on">木</button><button>石</button><button>铁</button></div>
      <label class="kvr"><span class="faint">卖出</span><input class="num" value="8000" /><span class="faint">→ 金 2,000</span></label>
      <button class="btn big">兑换</button></div>`;
    pop.addEventListener('click', (e) => {
      if (e.target === pop) close();
    });
    document.body.appendChild(pop);
  }

  window.ConsoleModal = { open, close, battleReport, leaderboard, offline, exchange };
})();
