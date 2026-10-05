// 单屏控制台：地图渲染。格子数按容器尺寸实时计算（目标格宽约 44px），所以地图永远铺满中栏、不出现滚动条；
// 窗口变化时重算。地形按坐标确定性生成，只为演示版式。
(function () {
  const TERRAINS = [
    { key: 'plain', label: '平原', res: '粮' },
    { key: 'grass', label: '草原', res: '粮' },
    { key: 'forest', label: '森林', res: '木' },
    { key: 'hill', label: '丘陵', res: '石' },
    { key: 'desert', label: '荒漠', res: '石' },
    { key: 'marsh', label: '沼泽', res: '粮' },
    { key: 'lake', label: '湖泊', res: '粮' },
    { key: 'gold', label: '金矿', res: '金' },
  ];

  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function terrainAt(x, y) {
    const r = hash(Math.floor(x / 3), Math.floor(y / 3)) * 0.7 + hash(x, y) * 0.3;
    if (hash(x + 7, y - 3) > 0.985) return TERRAINS[7];
    return TERRAINS[Math.min(6, Math.floor(r * 7))];
  }

  // 世界里的固定实体（相对视野中心的偏移）
  const ENTITIES = [
    { dx: 0, dy: 0, kind: 'own', text: '襄', name: '襄阳', sub: '主城 Lv9' },
    { dx: -6, dy: 5, kind: 'own', text: '新', name: '新野', sub: '分城 Lv5' },
    { dx: 8, dy: -7, kind: 'famous', text: '宛', name: '宛城', sub: '名城 · 已占领' },
    { dx: 5, dy: 3, kind: 'npc', text: 'N', name: 'NPC 城 Lv4', sub: '库存：一般' },
    { dx: -4, dy: -3, kind: 'npc', text: 'N', name: 'NPC 城 Lv6', sub: '库存：丰厚' },
    { dx: 9, dy: -9, kind: 'camp', text: '巾', name: '张角老巢', sub: '外围阶段 · 全服讨伐', layer: 'yt' },
    { dx: -8, dy: -2, kind: 'camp', text: '巾', name: '黄巾营地·中', sub: '3 小时后升档', layer: 'yt' },
  ];
  const MINE = [[-4, -3], [-3, -3], [-3, -2], [3, 2], [5, -4], [-1, 4], [-6, 1]];
  const ROUTE = [[-7, 6], [-6, 5], [-5, 4], [-4, 3], [-3, 3], [-2, 2], [-1, 2], [0, 1], [1, 1], [2, 0], [3, -1], [4, -2]];

  function renderWorld(map, svg, opts) {
    const box = map.getBoundingClientRect();
    const cols = Math.max(7, Math.round(box.width / 44));
    const rows = Math.max(5, Math.round(box.height / 44));
    map.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    map.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    const center = opts.center;
    map.innerHTML = '';
    const cells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const dx = c - cx;
        const dy = r - cy;
        const x = center.x + dx;
        const y = center.y + dy;
        const t = terrainAt(x, y);
        const el = document.createElement('button');
        el.className = 'tile';
        el.setAttribute('role', '地图格');
        el.style.background = `var(--t-${t.key})`;
        const ent = ENTITIES.find((e) => e.dx === dx && e.dy === dy && (!e.layer || opts.layers[e.layer]));
        const lv = 1 + Math.floor(hash(x * 3, y * 5) * 10);
        const mine = opts.layers.mine && MINE.some(([mx, my]) => mx === dx && my === dy);
        const onRoute = opts.layers.moving && ROUTE.some(([rx, ry]) => rx === dx && ry === dy);
        const mover = opts.layers.moving && dx === ROUTE[4][0] && dy === ROUTE[4][1];
        if (ent) {
          el.innerHTML = `<span class="mark ${ent.kind}">${ent.text}</span>`;
        } else if (mover) {
          el.innerHTML = '<span class="mark mover">商</span>';
        } else {
          el.innerHTML = `<span class="lv${lv >= 10 ? ' hi' : ''}">${lv}</span>`;
        }
        if (mine) el.classList.add('mine');
        if (onRoute) el.classList.add('route');
        if (opts.selected && opts.selected.x === x && opts.selected.y === y) el.classList.add('sel');
        const info = ent
          ? { x, y, kind: ent.kind, name: ent.name, sub: ent.sub, terrain: t.label }
          : mover
            ? { x, y, kind: 'mover', name: '运粮商队 Lv4', sub: '向东北移动 · 90 秒/格', terrain: t.label }
            : { x, y, kind: mine ? 'mine' : 'wild', name: `${t.label} Lv${lv}`, sub: mine ? '我的领地' : `可掠夺 · ${t.res}`, terrain: t.label, level: lv, onRoute };
        el.addEventListener('click', () => opts.onPick(info));
        map.appendChild(el);
        cells.push({ dx, dy, el });
      }
    }
    drawRoute(map, svg, cells, opts.layers.moving);
    return { cols, rows };
  }

  function drawRoute(map, svg, cells, show) {
    svg.innerHTML = '';
    if (!show) return;
    const wrap = svg.getBoundingClientRect();
    const pts = ROUTE.map(([dx, dy]) => cells.find((c) => c.dx === dx && c.dy === dy))
      .filter(Boolean)
      .map((c) => {
        const b = c.el.getBoundingClientRect();
        return `${b.left - wrap.left + b.width / 2},${b.top - wrap.top + b.height / 2}`;
      });
    if (pts.length < 2) return;
    svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.8"/>`;
  }

  function renderCity(map, buildings, selected, onPick) {
    map.style.gridTemplateColumns = '';
    map.style.gridTemplateRows = '';
    map.innerHTML = '<div class="city-grid" role="城内视图-建筑格"></div>';
    const grid = map.firstChild;
    for (const b of buildings) {
      const el = document.createElement('button');
      el.setAttribute('role', '城内视图-建筑');
      el.className = `city-cell${b.level ? '' : ' empty'}${b.kind === selected ? ' sel' : ''}`;
      el.innerHTML = `<b>${b.short}</b><span>${b.name}</span><small>${b.level ? `Lv${b.level}` : '未建'}</small><em>${b.note}</em>`;
      el.addEventListener('click', () => onPick(b.kind));
      grid.appendChild(el);
    }
  }

  window.ConsoleMap = { renderWorld, renderCity, TERRAINS };
})();
