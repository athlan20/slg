/* 世界地图 · 静态原型交互
   数据为演示用 mock；地形表与数值取自设计稿，正式接入时由服务端下发。 */
(function () {
  "use strict";

  /* ---------- 地形表（数值见设计文档，正式服以服务端下发为准） ---------- */
  var TERRAIN = {
    plain:     { name: "平原", res: "粮", bonus: [25, 55], icon: "" },
    grass:     { name: "草原", res: "粮", bonus: [30, 70], icon: "" },
    forest:    { name: "森林", res: "木", bonus: [30, 70], icon: "tree" },
    hill:      { name: "丘陵", res: "铁", bonus: [25, 55], icon: "peak" },
    desert:    { name: "荒漠", res: "石", bonus: [25, 55], icon: "" },
    marsh:     { name: "沼泽", res: "粮", bonus: [20, 40], icon: "" },
    lake:      { name: "湖泊", res: "粮", bonus: [40, 80], icon: "wave" },
    gold_mine: { name: "金矿", res: "金", bonus: [30, 70], icon: "ingot" }
  };

  var ICONS = {
    tree:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2.5 L12 8 H4 Z"/><path d="M8 6.5 L12.5 12.5 H3.5 Z"/><path d="M8 12.5 V14.5"/></svg>',
    peak:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 12.5 L6.5 4.5 L9 9 L10.5 6.5 L14 12.5 Z"/></svg>',
    wave:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 6.5 Q4 4.5 6 6.5 T10 6.5 T14 6.5"/><path d="M2 10.5 Q4 8.5 6 10.5 T10 10.5 T14 10.5"/></svg>',
    ingot: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4.5 5.5 H11.5 L13.5 10.5 H2.5 Z"/><path d="M6.5 5.5 L5.5 10.5 M9.5 5.5 L10.5 10.5"/></svg>'
  };

  /* ---------- 视野数据：列 x=128..137，行 y=84..93 ---------- */
  var ORIGIN_X = 128, ORIGIN_Y = 84;
  var MAP = [
    "ffpgpphpdd",
    "fppgphhpdf",
    "ppggpphhdp",
    "gpppfpphdp",
    "pppppppphp",
    "gpppppfppg",
    "pppfpllppp",
    "hppfplppgm",
    "phhpplppmm",
    "pphhpppGmp"
  ];
  var CODE = { p: "plain", g: "grass", f: "forest", h: "hill", d: "desert", m: "marsh", l: "lake", G: "gold_mine" };

  /* 城池实体：type = self / npc / enemy / ally */
  var CITIES = {
    "132,88": { type: "self",  name: "襄阳", sub: "县城 Lv3 · 本城", mark: "城" },
    "135,85": { type: "npc",   name: "官渡", sub: "名城 · 守军 12,000", mark: "名" },
    "137,86": { type: "enemy", name: "许昌", sub: "玩家城 · 敌对", mark: "敌" },
    "130,91": { type: "ally",  name: "新野", sub: "同盟城 · 汉室", mark: "盟" }
  };

  function wildLevel(x, y) { return ((x * 7 + y * 13) % 10) + 1; }

  var grid = document.getElementById("world-grid");
  var cols = document.getElementById("world-cols");
  var rows = document.getElementById("world-rows");
  var tooltip = document.getElementById("world-tooltip");
  var legend = document.getElementById("world-legend");
  if (!grid) return;

  var el = {
    coord: document.getElementById("tile-coord"),
    icon: document.getElementById("tile-icon"),
    name: document.getElementById("tile-name"),
    sub: document.getElementById("tile-sub"),
    facts: document.getElementById("tile-facts"),
    actions: document.getElementById("tile-actions"),
    feedback: document.getElementById("tile-feedback")
  };

  /* ---------- 坐标轴 ---------- */
  for (var cx = 0; cx < 10; cx++) {
    var cs = document.createElement("span");
    cs.textContent = ORIGIN_X + cx;
    cols.appendChild(cs);
  }
  for (var ry = 0; ry < 10; ry++) {
    var rs = document.createElement("span");
    rs.textContent = ORIGIN_Y + ry;
    rows.appendChild(rs);
  }

  /* ---------- 地块 ---------- */
  var selected = null;

  function tileInfo(x, y) {
    var key = x + "," + y;
    var city = CITIES[key];
    if (city) return { x: x, y: y, city: city, terrain: TERRAIN[CODE[MAP[y - ORIGIN_Y][x - ORIGIN_X]]] };
    var t = TERRAIN[CODE[MAP[y - ORIGIN_Y][x - ORIGIN_X]]];
    return { x: x, y: y, terrain: t, level: wildLevel(x, y) };
  }

  function bonusText(info) {
    var b = info.terrain.bonus;
    var total = b[0] + b[1] * info.level;
    return info.terrain.res + " " + b[0] + " + " + b[1] + "×Lv · Lv" + info.level + " ≈ " + total;
  }

  function fact(label, value) {
    return '<div><dt>' + label + "</dt><dd>" + value + "</dd></div>";
  }

  function renderInspector(info) {
    el.coord.textContent = info.x + "," + info.y;
    el.feedback.classList.remove("active");
    if (info.city) {
      var c = info.city;
      el.coord.textContent += c.type === "self" ? " · 本城" : "";
      el.icon.textContent = c.mark;
      el.name.textContent = c.name;
      el.sub.textContent = c.sub;
      if (c.type === "self") {
        el.facts.innerHTML = fact("类型", "本城 · " + info.terrain.name) + fact("民心", "86") + fact("城防", "箭塔 320");
        el.actions.innerHTML = '<button type="button" class="inspector-primary" data-act="进入城池">进入城池</button>';
      } else if (c.type === "npc") {
        el.facts.innerHTML = fact("类型", "名城 · 全服唯一") + fact("守军", "12,000") + fact("状态", "未被占领");
        el.actions.innerHTML = '<button type="button" class="inspector-primary" data-act="攻打">攻打</button>' +
          '<button type="button" class="ghost" data-act="侦察">侦察</button>';
      } else if (c.type === "enemy") {
        el.facts.innerHTML = fact("类型", "玩家城 · 敌对") + fact("势力", "无联盟") + fact("状态", "免战 02:14 后结束");
        el.actions.innerHTML = '<button type="button" class="inspector-primary" data-act="掠夺">掠夺</button>' +
          '<button type="button" class="ghost" data-act="侦察">侦察</button><button type="button" class="ghost" data-act="标记">标记</button>';
      } else {
        el.facts.innerHTML = fact("类型", "同盟城 · 汉室") + fact("驻军", "关羽部 5,600") + fact("状态", "可增援");
        el.actions.innerHTML = '<button type="button" class="inspector-primary" data-act="增援">增援</button>' +
          '<button type="button" class="ghost" data-act="进驻">进驻</button>';
      }
    } else {
      el.icon.textContent = info.terrain.name[0];
      el.name.textContent = info.terrain.name + " · 野地";
      el.sub.textContent = "Lv " + info.level;
      el.facts.innerHTML =
        fact("地形", info.terrain.name) +
        fact("等级", "Lv " + info.level) +
        fact("占领加成", bonusText(info)) +
        fact("状态", "未占领");
      el.actions.innerHTML = '<button type="button" class="inspector-primary" data-act="出征">出征</button>' +
        '<button type="button" class="ghost" data-act="侦察">侦察</button><button type="button" class="ghost" data-act="标记">标记</button>';
    }
    el.feedback.textContent = "操作入口示意 · 协议与数值待确定";
  }

  function select(btn, info) {
    if (selected) selected.classList.remove("selected");
    selected = btn;
    btn.classList.add("selected");
    renderInspector(info);
  }

  function showTooltip(btn, info) {
    var name = info.city ? info.city.name + " · " + info.city.sub
      : info.terrain.name + " · 野地 Lv" + info.level;
    var extra = info.city ? "" : "<br><em>" + bonusText(info) + "</em>";
    tooltip.innerHTML = "<b>" + name + "</b> <em>(" + info.x + "," + info.y + ")</em>" + extra;
    var vp = grid.parentElement.parentElement;
    var x = btn.offsetLeft + btn.offsetWidth + 28;
    var y = btn.offsetTop + 6;
    tooltip.style.left = Math.min(x, vp.clientWidth - 170) + "px";
    tooltip.style.top = y + "px";
    tooltip.hidden = false;
  }

  for (var row = 0; row < 10; row++) {
    for (var col = 0; col < 10; col++) {
      (function (row, col) {
        var x = ORIGIN_X + col, y = ORIGIN_Y + row;
        var info = tileInfo(x, y);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tile t-" + CODE[MAP[row][col]];
        btn.setAttribute("role", "地块-" + x + "," + y);
        btn.setAttribute("aria-label", info.city ? info.city.name + " " + info.city.sub
          : info.terrain.name + " 野地 Lv" + info.level);
        if (info.city) {
          var c = info.city;
          var markChar = c.type === "npc" ? "<u>" + c.mark + "</u>" : c.mark;
          btn.innerHTML = '<span class="mark mark-' + c.type + '">' + markChar + "</span>" +
            '<i class="tag tag-' + c.type + '">' + c.name + "</i>";
        } else {
          var icon = info.terrain.icon ? ICONS[info.terrain.icon] : "";
          btn.innerHTML = icon + '<span class="tl-lv">' + info.level + "</span>";
        }
        btn.addEventListener("click", function () { select(btn, info); });
        btn.addEventListener("mouseenter", function () { showTooltip(btn, info); });
        btn.addEventListener("mouseleave", function () { tooltip.hidden = true; });
        btn.addEventListener("focus", function () { showTooltip(btn, info); });
        btn.addEventListener("blur", function () { tooltip.hidden = true; });
        grid.appendChild(btn);
        if (info.city && info.city.type === "self") select(btn, info);
      })(row, col);
    }
  }

  /* ---------- 操作按钮：原型只给反馈 ---------- */
  el.actions.addEventListener("click", function (ev) {
    var btn = ev.target.closest("button");
    if (!btn) return;
    el.feedback.textContent = "已点击「" + btn.dataset.act + "」· 原型演示，未连接协议";
    el.feedback.classList.add("active");
  });

  /* ---------- 图例 ---------- */
  Object.keys(TERRAIN).forEach(function (k) {
    var t = TERRAIN[k];
    var li = document.createElement("li");
    li.innerHTML = '<i class="tile t-' + k + '" style="cursor:default"></i>' + t.name + " <em>" + t.res + "</em>";
    legend.appendChild(li);
  });
  [["lg-self", "本城"], ["lg-npc", "名城"], ["lg-enemy", "敌对"], ["lg-ally", "同盟"]].forEach(function (pair) {
    var li = document.createElement("li");
    li.innerHTML = '<i class="' + pair[0] + '"></i>' + pair[1];
    legend.appendChild(li);
  });
})();
