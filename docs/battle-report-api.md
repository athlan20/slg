# 战报 API 前端对接文档

> 适用协议版本：**v18** 起（v21 新增 `city_raid` 类别；以 `GET /agent-api.json` 的 `version` 字段为准）。
> 前端 TS 类型已就位：`frontend/src/api/protocol-world.ts`（`BattleReportView` / `BattleSideView` / `BattleRoundLogEntryView`），与本文字段一一对应。
> 通用帧格式（op / seq / ok / error）与登录前提见 `docs/agent-api.md` 第 1–3 节，本文只讲战报相关。

## 1. 战报是什么

每场战斗结算后生成一份战报，**账号以攻方或守方身份持有**，包含双方编成与损失、逐回合伤害与击杀统计、终局原因与城墙减伤。四类战斗来源：

| kind | 战斗类别 | 本账号通常是 |
|---|---|---|
| `wilderness` | 野地遭遇战（出征野地掠夺 / 占领 / 增援遇袭等） | 攻方 |
| `npc_city` | NPC 城池攻城战（掠夺 NPC 城） | 攻方 |
| `npc_raid` | NPC 袭击己方占领野地的驻军 | 守方 |
| `city_raid` | NPC 袭击己方主城（v21；守城战，城墙减伤生效） | 守方 |

战损**即最终减员**（无伤兵治疗 / 俘虏 / 逃兵召回系统）；`survivors` 就是实际存活兵力。

## 2. 获取通道（一拉一推，建议同时接）

### 2.1 拉取：GET_BATTLE_REPORTS（op 36，需登录）

请求 `data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `limit` | number | 可选。返回条数上限，1..50，默认 20；非法取默认。 |
| `beforeId` | number | 可选。分页游标：返回 **id 小于它**的最新战报。 |

响应 `data`：`{ reports: BattleReportView[] }`，列表按 **新 → 旧**（id 降序）排列。

分页模式：首页不带 `beforeId` → 取返回最后一条的 `id` 作为下一页的 `beforeId`，直到返回条数 < limit。战报 `id` 为账号内自增序号，可作为列表 key 与去重依据。

### 2.2 推送：PUSH_BATTLE_REPORT（op 2007）

战报生成时实时推给持有方账号的**全部在线连接**，帧形态：

```json
{ "op": 2007, "push": true, "data": { "report": { …BattleReportView } } }
```

推送帧没有 `seq` / `ok`，不要回包。**推送是尽力而为**：连接断开期间产生的战报不会补推，前端收到推送后插入列表头部即可，漏收由拉取兜底（重连 / 进入战报页时拉一次首页）。

## 3. 数据结构

### 3.1 BattleReportView（单份战报）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | 战报自增序号（分页游标 / 列表 key）。 |
| `x` / `y` | number | 战斗发生地块坐标（可链接到地图该格）。 |
| `kind` | string | 战斗类别，见第 1 节表。 |
| `role` | string | 本账号角色：`attacker` 攻方 / `defender` 守方。**界面视角以此为准**：己方永远是「我方」，对方是「敌方」。 |
| `won` | boolean | 本账号是否获胜。 |
| `rounds` | number | 实际回合数（= `roundLog.length`）。 |
| `endReason` | string | 终局原因，见 3.4。 |
| `attacker` / `defender` | object | 双方汇总（BattleSideView）。注意：这两个字段的攻守身份是**绝对的**（谁出征谁是 attacker），与 `role` 无关，渲染我方 / 敌方时先按 `role` 选边。 |
| `wallDefensePercent` | number | 守方城墙受击减免（百分数数值，如 `10` = 10%）；非守城战斗为 0。 |
| `roundLog` | array | 逐回合统计（BattleRoundLogEntryView），按回合升序。 |
| `createdAt` | string | 战斗结算时间（ISO 8601）。 |

### 3.2 BattleSideView（一方汇总）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 展示名。攻方为「玩家名 · 城池名」；守方为「野地 Lv3（森林）」等地块描述。可直接当标题渲染。 |
| `troops` | object | 初始编成，按兵种（见 3.5）。 |
| `losses` | object | 损失（初始 − 幸存）。 |
| `survivors` | object | 幸存兵力。`endReason = round_limit` 时攻方幸存者会随返程行军回到出发城（返程结束后入城）。 |
| `damage` | number | 全场总输出伤害（roundLog 同侧逐回合之和，展示时取整）。 |
| `units` | number | 总单位数 = Σ troops（v21 AISLG-33）。 |
| `totalHp` | number | 总血量 = Σ troops × 单兵生命（v21 AISLG-33）。 |
| `avgRange` | number | 编成平均射程（数量加权，1 位小数）。会被大量近战稀释，判断远程威胁请用 `maxRange` / `rangedUnits`（v21 AISLG-30）。 |
| `maxRange` | number | 编成中单兵射程的最大值（v23 AISLG-49；空编成为 0）。对方 maxRange 远超我方即「他打得到你、你够不到他」的单方面压制信号（当前兵种表：近战 10 / 弓箭兵 70）。 |
| `rangedUnits` | number | 远程单位数 = 射程超过近战基准（>10）的单位数（v23 AISLG-49；当前兵种表即弓箭兵），与 maxRange 组合可读出「有多少单位在远端输出」。 |

恒等式可做 UI 校验：`troops = losses + survivors`（逐兵种）。

### 3.3 BattleRoundLogEntryView（单回合）

| 字段 | 类型 | 说明 |
|---|---|---|
| `round` | number | 回合序号，从 1 开始。 |
| `attackerDamage` / `defenderDamage` | number | 该回合该方造成的总伤害。**推进 / 接敌回合为 0**——连续多个 0 伤害回合说明双方在接近（或够不到对方）。 |
| `attackerKilled` / `defenderKilled` | number | 该回合该方阵亡数（按兵种合计）。 |

### 3.4 endReason 语义

| 值 | 含义 | 界面提示建议 |
|---|---|---|
| `defender_wiped` | 守方全灭，攻方胜 | 攻方视角「胜利」；守方视角「驻军全灭」 |
| `attacker_wiped` | 攻方全灭（含同回合同归于尽），守方胜 | 攻方视角「全灭」 |
| `round_limit` | 回合耗尽攻方未突破，守方胜；攻方幸存部队撤回出发城 | 攻方视角「未能突破，残部撤回」 |

`won` 已按 `role` 算好，直接用 `won` 出胜负徽章即可，不必自己按 endReason 推。

### 3.5 ArmyCounts（兵种计数字典）

键为七兵种：`porter` 民夫 / `militia` 义兵 / `scout` 斥候 / `pikeman` 长枪兵 / `swordsman` 刀盾兵 / `archer` 弓箭兵 / `cavalry` 轻骑兵，值 ≥ 0。对象**恒含全部七个键**（无兵种为 0），渲染时无需判空。

## 4. 示例

### 4.1 野地遭遇战（攻方视角，胜）

```json
{
  "op": 36, "seq": 12, "ok": true,
  "data": {
    "reports": [
      {
        "id": 128,
        "x": 12, "y": 17,
        "kind": "wilderness",
        "role": "attacker",
        "won": true,
        "rounds": 12,
        "endReason": "defender_wiped",
        "attacker": {
          "name": "example-player · 主城",
          "troops":     { "porter": 0, "militia": 20, "scout": 0, "pikeman": 0, "swordsman": 0, "archer": 0, "cavalry": 0 },
          "losses":     { "porter": 0, "militia": 10, "scout": 0, "pikeman": 0, "swordsman": 0, "archer": 0, "cavalry": 0 },
          "survivors":  { "porter": 0, "militia": 10, "scout": 0, "pikeman": 0, "swordsman": 0, "archer": 0, "cavalry": 0 },
          "damage": 5090
        },
        "defender": {
          "name": "野地 Lv3（森林）",
          "troops":     { "porter": 0, "militia": 30, "scout": 0, "pikeman": 0, "swordsman": 0, "archer": 6, "cavalry": 0 },
          "losses":     { "porter": 0, "militia": 30, "scout": 0, "pikeman": 0, "swordsman": 0, "archer": 6, "cavalry": 0 },
          "survivors":  { "porter": 0, "militia": 0,  "scout": 0, "pikeman": 0, "swordsman": 0, "archer": 0, "cavalry": 0 },
          "damage": 4210
        },
        "wallDefensePercent": 0,
        "roundLog": [
          { "round": 1,  "attackerDamage": 0,    "defenderDamage": 0,    "attackerKilled": 0, "defenderKilled": 0 },
          { "round": 5,  "attackerDamage": 480,  "defenderDamage": 395,  "attackerKilled": 1, "defenderKilled": 2 },
          { "round": 12, "attackerDamage": 610,  "defenderDamage": 0,    "attackerKilled": 0, "defenderKilled": 3 }
        ],
        "createdAt": "2026-09-29T03:20:16.205Z"
      }
    ]
  }
}
```

（roundLog 实际会包含全部 1..rounds 回合，此处省略中间行。）

### 4.2 推送帧（NPC 袭击，守方视角）

```json
{
  "op": 2007, "push": true,
  "data": {
    "report": {
      "id": 129, "x": 15, "y": 22, "kind": "npc_raid", "role": "defender", "won": false,
      "rounds": 5, "endReason": "attacker_wiped",
      "attacker": { "name": "NPC 袭击部队", "troops": { "…": 0, "militia": 30, "archer": 4 }, "losses": { "…": 0 }, "survivors": { "…": 0 }, "damage": 0 },
      "defender": { "name": "example-player · 主城", "troops": { "…": 0, "militia": 12 }, "losses": { "…": 0 }, "survivors": { "…": 0, "militia": 12 }, "damage": 8830 },
      "wallDefensePercent": 0,
      "roundLog": [ { "round": 1, "attackerDamage": 0, "defenderDamage": 0, "attackerKilled": 0, "defenderKilled": 0 } ],
      "createdAt": "2026-09-29T03:21:02.110Z"
    }
  }
}
```

（示例中 `"…": 0` 表示省略的其余兵种键，实际响应恒含全部七键。）

## 5. 界面建议（当前数据能直接支撑的形态）

- **战报列表**：`createdAt` + `kind` 图标 + 对方 `name` + `won` 胜负徽章 + 我方损失合计（`role` 选边后对我方 `losses` 求和）；`id` 做 key，2007 推送插头部。
- **战报详情**：
  - 双方卡片：`name`、`troops` → `losses` / `survivors` 兵种行（损益条形对比），`damage` 总输出，`maxRange` / `rangedUnits` 射程行（双方最远射程与远程兵数量，判断「够不够得到对方」）；
  - 回合时间轴：`roundLog` 每回合一行（双方伤害 / 击杀），或双线伤害累计曲线（attackerDamage / defenderDamage 累加）；
  - 接敌阶段可视化：开头的 0 伤害回合就是「推进中」，连续 0 到战斗结束（攻方侧恒 0）≈ 够不到对方（典型：纯近战 vs 守城远程）；
  - `wallDefensePercent > 0` 时展示「守方城墙减免 N%」角标（仅 `npc_city`）。
- **终局徽章**：直接用 `won` + `endReason` 文案（3.4 表）。

**当前结构做不到的**（避免设计返工）：`roundLog` 是**双方合计**——没有兵种级逐回合明细、没有站位 / 推进轨迹、没有判定掷点（闪避 / 暴击不落战报）。**兵堆级战场动画重演做不了**；如需该级别需后端扩展战报结构（记录每回合每兵堆状态），需另行立项。

## 6. 战报入口盘点（哪些地方能拿到战报 / 战报 id）

战报弹窗可能从多处触发，按拿到的形态分两类：

### 6.1 直接拿到完整战报（可直接开弹窗）

| 入口 | 形态 | 时机 |
|---|---|---|
| `PUSH_BATTLE_REPORT`（op 2007） | 完整 `BattleReportView` | 战斗结算瞬间直推。出征战斗推给出征账号；NPC 袭击推给驻军主（守方）。攻守两个角色都会收到自己视角的报告 |
| `GET_BATTLE_REPORTS`（op 36） | `reports[]` 完整对象 | 战报中心 / 列表页主动拉取 |

### 6.2 只拿到入口 id（`detail.reportId`，需按 id 反查）

`GET_EVENTS`（op 11）里带 `reportId` 的事件（均为战斗相关结局）：

| 事件 | 条件 | 场景 |
|---|---|---|
| `march_completed` | outcome = `plunder_won` / `battle_won` / `battle_lost`（含 legacy `attack` 结算） | 出征到达打了仗（掠夺 / 占领 / 败退） |
| `npc_raid` | outcome = `repelled` / `garrison_lost` | NPC 袭击己方占领野地（守方视角）；v21 起 `target='city'` 时为袭击主城，对应战报 kind=`city_raid` |
| `npc_city_occupied` | —— | 打下 NPC 城变为分城 |

**按 id 取单份战报**（无单独的按 id 查询协议，用游标语义实现）：

```json
{ "op": 36, "seq": 13, "data": { "beforeId": <reportId + 1>, "limit": 1 } }
```

`beforeId` 语义是「id 小于它的最新一条」，本账号视角下恰好取回 `id === reportId` 的这份。

### 6.3 不携带战报入口的地方（避免找错）

- `PUSH_MARCH_STATE`（op 2005，reason=`march_resolved`）：载荷是行军视图，**没有 reportId**——战斗细节走同一时刻到达的 `PUSH_BATTLE_REPORT`。
- `wilderness_lost`（cause=`npc_attack`）：事件本身不带 reportId，关联战报在相邻的 `npc_raid` 事件里。
- 侦察（`scouted`）、增援（`reinforced`）、调兵（`transferred`）、返程（`returned`）：无战斗、无战报。

## 7. 注意事项

- 推送只到**在线**连接且不补推：重连 / 打开战报页时先拉一次首页对齐。
- `role` 决定「我方 / 敌方」的选边，`attacker` / `defender` 字段名是绝对攻守身份，别混用。
- `round_limit` 时攻方 `survivors` 非零：这些部队在返程行军结束后才回城，界面上「幸存」不等于「已在城内」。
- 战斗结果同时进事件流（`march_completed` / `npc_raid` 事件）：事件用于时间线，战报才是逐回合明细的权威来源，两者 `id` 体系不同。
