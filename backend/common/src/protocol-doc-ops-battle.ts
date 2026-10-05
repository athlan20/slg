// 战斗 / 侦察 / 战报类协议的对外文档（SCOUT / RECALL_MARCH / GET_BATTLE_REPORTS /
// PUSH_BATTLE_REPORT，v13）。战斗结构与数值见 common/src/battle.ts（全部占位）。
// 世界类见 protocol-doc-ops-world.ts；共用示例常量见 protocol-doc-shared.ts。

import { atBaseTimeScale } from './time-scale';
import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { AFTER_COST, CITY_ID, INITIAL_BUILDINGS_VIEW, INITIAL_LEVELS, INITIAL_POPULATION_VIEW, INITIAL_PRODUCTION, INITIAL_STORAGE, STARTED_AT } from './protocol-doc-shared';
import { TROOP_KINDS } from './protocol';
import { marchTravelSeconds, WORLD_SIZE } from './world';
import { wallDefensePercent } from './battle';

const EMPTY_ARMY = Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0]));

const SCOUT_MARCH_ID = 'a7c1f9d0-9b8e-4c2a-8f1d-3e5a7b9c1d2e';
/** 示例：主城 (16,20) → NPC 城池 (30,6)，斥候 ×2 速度 → Chebyshev 距离 14 折半 */
const SCOUT_TRAVEL_SECONDS = atBaseTimeScale(() => marchTravelSeconds(16, 20, 30, 6, { scout: 3 }));
const SCOUT_ARRIVE_AT = new Date(Date.parse(STARTED_AT) + SCOUT_TRAVEL_SECONDS * 1000).toISOString();

const SCOUT_MARCH_VIEW = {
  id: SCOUT_MARCH_ID,
  fromCityId: CITY_ID,
  x: 30,
  y: 6,
  troops: { ...EMPTY_ARMY, scout: 3 },
  purpose: 'scout',
  status: 'marching',
  initiator: 'player',
  startedAt: STARTED_AT,
  arriveAt: SCOUT_ARRIVE_AT,
  resolvedAt: null,
} as const;

const RECALL_MARCH_VIEW = {
  ...SCOUT_MARCH_VIEW,
  purpose: 'return',
  x: 30,
  y: 6,
} as const;

/** 侦察情报示例（march_completed 事件 detail.intel 与 GET_TILE 的 npc 字段来源） */
const SCOUT_INTEL = {
  x: 30,
  y: 6,
  kind: 'npc_city',
  terrain: 'plain',
  level: 2,
  owner: null,
  garrison: { ...EMPTY_ARMY, militia: 60, pikeman: 20, archer: 24 },
  wallDefensePercent: wallDefensePercent(2),
  npcStock: { gold: 4000, wood: 4000, food: 4000, stone: 3000, iron: 3000 },
  scoutedAt: SCOUT_ARRIVE_AT,
} as const;

/** 战报示例（野地遭遇战，攻方视角） */
const BATTLE_REPORT = {
  id: 128,
  x: 12,
  y: 17,
  kind: 'wilderness',
  role: 'attacker',
  won: true,
  rounds: 12,
  endReason: 'defender_wiped',
  attacker: {
    name: 'example-player · 主城',
    troops: { ...EMPTY_ARMY, militia: 20 },
    losses: { ...EMPTY_ARMY, militia: 10 },
    survivors: { ...EMPTY_ARMY, militia: 10 },
    damage: 5090,
  },
  defender: {
    name: '野地 Lv3（森林）',
    troops: { ...EMPTY_ARMY, militia: 18, archer: 1 },
    losses: { ...EMPTY_ARMY, militia: 18, archer: 1 },
    survivors: { ...EMPTY_ARMY },
    damage: 2926,
  },
  wallDefensePercent: 0,
  comment: null,
  roundLog: [
    { round: 1, attackerDamage: 0, defenderDamage: 0, attackerKilled: 0, defenderKilled: 0 },
    { round: 6, attackerDamage: 0, defenderDamage: 234, attackerKilled: 0, defenderKilled: 0 },
    { round: 7, attackerDamage: 1561, defenderDamage: 975, attackerKilled: 2, defenderKilled: 3 },
  ],
  createdAt: SCOUT_ARRIVE_AT,
} as const;

export const REQUEST_SCOUT: RequestOpDoc = {
  kind: 'request',
  name: 'SCOUT',
  title: '斥候侦察（v13）',
  preAuth: false,
  summary: `从主城派 count 名斥候侦察目标地块：行军 purpose='scout'（按斥候行军速度 ×2 折算时长），到达后不战斗，产出情报快照（守军按兵种构成、城墙守城减伤、NPC 城池可掠夺库存、占领者）并落为 march_completed 事件（outcome='scouted'，detail.intel 为完整快照），名城（v24）的情报按侦察时刻的阶段给出：intel.famous = { name, stage }，intel.garrison / wallDefensePercent 即该阶段的守军（外围驻军 / 城守驻军）与城墙口径（外围阶段野战无城墙）。随后斥候原地返程。**情报详细度随侦察科技（v27，AISLG-77）**：intel.detail = 'rough'（侦察科技 Lv0–2）时 intel.garrison 全 0、只有 intel.garrisonTotal { min, max } 给总兵力约数（真实 ±20%）；'kinds'（Lv3–5）给兵种明细、各兵种数量为近似值（真实 ±20%，按坐标固定、重复侦察不变）；'exact'（Lv6+）精确（garrisonTotal 的 min = max）。historic 情报无 detail 字段视为 exact；城墙与库存不降级。情报同时存为该账号对该地块的最近快照：此后 GET_TILE 对 NPC 城池返回该快照（此前为 null）。重新侦察会覆盖快照。目标限制：任意非本账号城池的地块；v38（AISLG-122）起侦察其他玩家的城池会读到该城的实时驻军（city_army）与城墙减伤（城墙 + 守方城防科技），守方处于新手保护期时被拒（NEWBIE_PROTECTED，附 until / retryAfterSeconds；免战不拦侦察），你自己处于新手保护期时侦察其他玩家会立即破保（事件 newbie_protection_ended）。校验顺序：先校验请求参数（坐标须在世界内）与城内斥候兵力（不足返回 INSUFFICIENT_TROOPS），再判定目标（自己的城池返回 INVALID_PARAMS）——因此城内无斥候时侦察自己的城池返回的是 INSUFFICIENT_TROOPS 而非 INVALID_PARAMS。`,
  requestFields: [
    { name: 'x', type: 'number', desc: `必填。目标地块 x，0..${WORLD_SIZE - 1}。` },
    { name: 'y', type: 'number', desc: `必填。目标地块 y，0..${WORLD_SIZE - 1}。` },
    { name: 'count', type: 'number', desc: '必填。派出斥候数量，1..100；城内斥候不足返回 INSUFFICIENT_TROOPS。' },
  ],
  dataFields: [
    { name: 'march', type: 'object', desc: '侦察行军视图（purpose=scout；字段与 MARCH 响应相同）。' },
  ],
  errors: ['INVALID_PARAMS', 'DEPLOY_LIMIT', 'INSUFFICIENT_TROOPS', 'NEWBIE_PROTECTED'],
  examples: [
    {
      caption: `侦察 NPC 城池 (30,6)（3 斥候，约 ${SCOUT_TRAVEL_SECONDS}s 后到达）`,
      request: { op: Op.SCOUT, seq: 10, data: { x: 30, y: 6, count: 3 } },
      responses: [{ op: Op.SCOUT, seq: 10, ok: true, data: { march: SCOUT_MARCH_VIEW } }],
    },
    {
      caption: '城内斥候不足（失败响应仅附 data.city，无 march 载荷）',
      request: { op: Op.SCOUT, seq: 13, data: { x: 30, y: 6, count: 3 } },
      responses: [
        {
          op: Op.SCOUT,
          seq: 13,
          ok: false,
          error: { code: 'INSUFFICIENT_TROOPS', message: '城内兵力不足以派出该编队' },
          data: {
            city: {
              id: CITY_ID,
              name: '主城',
              resources: AFTER_COST,
              buildings: { ...INITIAL_BUILDINGS_VIEW },
              levels: { ...INITIAL_LEVELS },
              farms: 0,
              production: { ...INITIAL_PRODUCTION },
              population: INITIAL_POPULATION_VIEW,
              storage: INITIAL_STORAGE,
            },
          },
        },
      ],
    },
  ],
  agentNote: '侦察不发生战斗、斥候全数返程（当前无侦察对抗判定，占位）。攻 NPC 城池前先侦察：GET_TILE 的 npc 字段（驻防 + 库存）只对侦察过的地块开放；野地原住守军（v24）：Lv1–2 义兵 8×等级，Lv3 起义兵 6×等级 + 弓箭兵 (等级−2)，每块在基准上固定 ±20% 浮动、被打残后每小时恢复 25%——侦察可看到该地块此刻的具体编成；推荐兵力见文档「野地进攻口径」。',
};

export const REQUEST_RECALL_MARCH: RequestOpDoc = {
  kind: 'request',
  name: 'RECALL_MARCH',
  title: '撤回行军途中的部队（v13）',
  preAuth: false,
  summary: `把一条行军中（status=marching 且 purpose 不是 return）的部队原地折返：行军翻转为返程（purpose=return），arrive_at = 当前时间 + 已走时长（同速回程，按编队最慢兵种）；到达出发城后部队并入城内驻军。目标已到达 / 已是返程 / 行军不存在或不属于本账号返回 MARCH_NOT_RECALLABLE。折返不影响已扣减的编队（部队全程在行军中）。`,
  requestFields: [
    { name: 'marchId', type: 'string', desc: '必填。行军 UUID（见 GET_STATE 的 city.marches）。' },
  ],
  dataFields: [
    { name: 'march', type: 'object', desc: '折返后的行军视图（purpose=return、arriveAt 为新的预计回城时间；字段与 MARCH 响应相同）。' },
  ],
  errors: ['INVALID_PARAMS', 'MARCH_NOT_RECALLABLE'],
  examples: [
    {
      caption: '撤回在途的侦察行军',
      request: { op: Op.RECALL_MARCH, seq: 11, data: { marchId: SCOUT_MARCH_ID } },
      responses: [{ op: Op.RECALL_MARCH, seq: 11, ok: true, data: { march: RECALL_MARCH_VIEW } }],
    },
    {
      caption: '行军已到达或已是返程（失败响应无 data）',
      request: { op: Op.RECALL_MARCH, seq: 14, data: { marchId: SCOUT_MARCH_ID } },
      responses: [
        {
          op: Op.RECALL_MARCH,
          seq: 14,
          ok: false,
          error: { code: 'MARCH_NOT_RECALLABLE', message: '该行军不存在、不属于本账号、不在途中或已是返程，无法撤回' },
        },
      ],
    },
  ],
  agentNote: '发出后目标不会被结算（行军已折返）；若恰好在到达瞬间撤回，可能已被 Worker 结算——收到 MARCH_NOT_RECALLABLE 后读 GET_STATE 对齐。撤回驻军（已占领地块）用 RECALL_GARRISON，两者语义不同：前者撤「在途部队」，后者撤「驻军并放弃占领」。',
};

export const REQUEST_GET_BATTLE_REPORTS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_BATTLE_REPORTS',
  title: '查询战斗战报（v13）',
  preAuth: false,
  summary: `分页查询本账号的战斗战报（新→旧）：每场战斗（出征野地 / 攻 NPC 城池 / NPC 袭击驻军或主城）各生成一份，账号作为攻方或守方持有。战报含双方编成与损失、逐回合伤害统计、终局原因与城墙减伤；战斗结果同时进事件流（march_completed / npc_raid），战报提供更完整的逐回合明细。v15 起战败幸存部队撤回出发城——战报的 survivors 即实际存活兵力（round_limit 终局时攻方幸存者会在返程行军结束后回到出发城）。`,
  requestFields: [
    { name: 'limit', type: 'number', desc: '可选。返回条数上限，1..50，默认 20。' },
    { name: 'beforeId', type: 'number', desc: '可选。分页游标：返回 id 小于它的最新战报（与 limit 组合）。' },
  ],
  dataFields: [
    { name: 'reports', type: 'array', desc: '战报列表（新→旧）。' },
    { name: 'reports[].id', type: 'number', desc: '战报自增序号（分页游标）。' },
    { name: 'reports[].x / reports[].y', type: 'number', desc: '战斗发生地块坐标。' },
    { name: 'reports[].kind', type: "'wilderness' | 'npc_city' | 'npc_raid' | 'city_raid' | 'intercept' | 'yellow_turban'", desc: '战斗类别：野地遭遇战 / NPC 城池攻城战 / NPC 袭击驻军 / NPC 袭击主城（v21，守方为守城战）/ 截击移动目标（v28，AISLG-78，含扑空与目标消失）/ 黄巾营地与老巢（v29，AISLG-76，yellow_turban）。' },
    { name: 'reports[].towerDamage', type: 'number | undefined', desc: '箭塔造成的总伤害（v30，AISLG-82）：仅守城战且守方有箭塔时 > 0（已含在 defender.damage 内）；无箭塔 / 历史战报为 undefined。逐回合见 roundLog[].towerDamage。' },
    { name: 'reports[].contact', type: "'missed' | 'gone' | undefined", desc: '仅 kind=intercept 的未接战结果（v28）：missed 扑空（到达时目标已走远）/ gone 目标消失（已被击败或过时）；此时 endReason=no_contact、rounds=0、双方无损失。接战的截击与其他战报无此字段。' },
    { name: 'reports[].role', type: "'attacker' | 'defender'", desc: '本账号在该场战斗中的角色。' },
    { name: 'reports[].won', type: 'boolean', desc: '本账号是否获胜。' },
    { name: 'reports[].rounds', type: 'number', desc: '实际回合数。' },
    { name: 'reports[].endReason', type: "'defender_wiped' | 'attacker_wiped' | 'round_limit' | 'no_contact'", desc: '守方全灭 / 攻方全灭（含同回合同归于尽）/ 回合耗尽（攻方未能突破，v15 起幸存部队撤回出发城）/ 未接战（v28 截击扑空或目标消失，见 contact）。' },
    { name: 'reports[].attacker / reports[].defender', type: 'object', desc: '双方汇总：{ name 展示名, troops 编成, losses 损失, survivors 幸存, damage 总输出, units 总单位数, totalHp 总血量, avgRange 平均射程（1 位小数，数量加权——会被大量近战稀释，不代表克制关系）, maxRange 编成单兵射程最大值, rangedUnits 远程单位数（射程 > 近战基准 10，当前即弓箭兵）, hero 武将（v36 新增，AISLG-114/115：{ name, lead, force, wit, atkPercent, defPercent }——攻方 = 随队武将、守方 = 城守（仅守城战 kind=city_raid），atkPercent/defPercent 为按部队规模折算后的实际生效加成；未配将 / 历史战报为 null）}。units/totalHp/avgRange 为 v21 新增、maxRange/rangedUnits 为 v23 新增（AISLG-49），hero 为 v36 新增，服务端按 troops 汇总下发，历史战报同样补齐；判断「对方有多少单位在远端输出、够多远」用 maxRange + rangedUnits，不要用 avgRange。' },
    { name: 'reports[].wallDefensePercent', type: 'number', desc: '守方城墙守城减伤（百分数；非守城战斗为 0）。' },
    { name: 'reports[].roundLog', type: 'array', desc: '逐回合统计：{ round, attackerDamage, defenderDamage, attackerKilled, defenderKilled, towerDamage? }（推进回合伤害为 0；towerDamage 为该回合箭塔伤害，已含在 defenderDamage 内，v30）。' },
    { name: 'reports[].comment', type: 'object | null', desc: 'Agent 写回的战报点评（v23 新增，AISLG-53）：{ text 点评正文, updatedAt 最近写入时间 }；尚未有点评为 null。一份战报只保留最新一条（Agent 重写覆盖）。' },
    { name: 'reports[].createdAt', type: 'string', desc: '战斗结算时间（ISO 8601）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询最近战报',
      request: { op: Op.GET_BATTLE_REPORTS, seq: 12, data: { limit: 5 } },
      responses: [
        {
          op: Op.GET_BATTLE_REPORTS,
          seq: 12,
          ok: true,
          data: { reports: [BATTLE_REPORT] },
        },
      ],
    },
    {
      caption: 'limit 超出 1..50（失败响应无 data）',
      request: { op: Op.GET_BATTLE_REPORTS, seq: 15, data: { limit: 100 } },
      responses: [
        {
          op: Op.GET_BATTLE_REPORTS,
          seq: 15,
          ok: false,
          error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' },
        },
      ],
    },
  ],
  agentNote: '战损不进入伤兵治疗、俘虏招降或逃兵召回系统（一期确认）：损失即最终减员。roundLog 可用于复盘推进 / 接敌节奏与输出效率。读完战报可用 AGENT_COMMENT_REPORT 写一段大白话点评（为什么输 / 下次带什么兵），玩家会在战报弹窗顶部看到——建议说人话、不出现协议字段名。',
};

export const REQUEST_AGENT_COMMENT_REPORT: RequestOpDoc = {
  kind: 'request',
  name: 'AGENT_COMMENT_REPORT',
  title: 'Agent 写回战报点评（v23，AISLG-53）',
  preAuth: false,
  summary:
    'Agent 读完一份战报后，用几句话大白话写点评：为什么输（或赢得险）、下次建议带什么兵。**仅限 Agent 连接调用**（玩家连接返回 AGENT_FORBIDDEN）。一份战报只保留最新一条点评，重写覆盖；正文 trim 后 1..200 字符（超出服务端拒绝）。点评随战报一起下发（GET_BATTLE_REPORTS 的 reports[].comment），写入成功后经 PUSH_BATTLE_REPORT_COMMENT 实时推给账号全部在线连接。战报不存在或不属于本账号返回 INVALID_PARAMS。',
  requestFields: [
    { name: 'reportId', type: 'number', desc: '必填。战报 id（须为本账号持有的战报，见 GET_BATTLE_REPORTS / PUSH_BATTLE_REPORT）。' },
    { name: 'text', type: 'string', desc: '必填。点评正文，trim 后 1..200 字符。建议大白话：直接说原因和下次怎么办，不出现协议字段名（说「对面弓箭兵射程远」而不是说「maxRange 更高」）。' },
  ],
  dataFields: [
    { name: 'reportId', type: 'number', desc: '点评写入的战报 id。' },
    { name: 'comment', type: 'object', desc: '写入后的点评：{ text 正文, updatedAt 写入时间（ISO 8601） }。' },
  ],
  errors: ['AGENT_FORBIDDEN', 'INVALID_PARAMS'],
  examples: [
    {
      caption: '给一份战报写点评',
      request: { op: Op.AGENT_COMMENT_REPORT, seq: 16, data: { reportId: 128, text: '对面弓箭兵射程比你远，前两回合你挨打还摸不到人；下次多带长枪兵顶在前面，或者兵力加到 800 以上再打。' } },
      responses: [
        {
          op: Op.AGENT_COMMENT_REPORT,
          seq: 16,
          ok: true,
          data: { reportId: 128, comment: { text: '对面弓箭兵射程比你远，前两回合你挨打还摸不到人；下次多带长枪兵顶在前面，或者兵力加到 800 以上再打。', updatedAt: '2026-10-01T09:00:00.000Z' } },
        },
      ],
    },
    {
      caption: '战报不存在或不属于本账号',
      request: { op: Op.AGENT_COMMENT_REPORT, seq: 17, data: { reportId: 9999, text: '点评' } },
      responses: [
        { op: Op.AGENT_COMMENT_REPORT, seq: 17, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } },
      ],
    },
  ],
  agentNote:
    '收到 PUSH_BATTLE_REPORT 后正是写点评的时机：先看 won / endReason / 双方 losses，再对照 maxRange + rangedUnits 判断是不是被远程压制，最后用一句可执行的建议收尾。玩家重新登录仍能看到（点评随战报持久保存）。',
};

export const PUSH_BATTLE_REPORT_COMMENT: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_BATTLE_REPORT_COMMENT',
  title: '推送：战报点评写入（v23，AISLG-53）',
  summary:
    'Agent 写回战报点评后，推送给该账号全部在线连接。玩家网页据此在对应战报上实时显示点评。',
  dataFields: [
    { name: 'reportId', type: 'number', desc: '点评写入的战报 id。' },
    { name: 'comment', type: 'object', desc: '点评内容：{ text, updatedAt }。' },
  ],
  examples: [
    { op: Op.PUSH_BATTLE_REPORT_COMMENT, push: true, data: { reportId: 128, comment: { text: '对面弓箭兵射程比你远，前两回合你挨打还摸不到人。', updatedAt: '2026-10-01T09:00:00.000Z' } } },
  ],
  agentNote:
    '同账号多 Agent 连接都会收到（含写入方）；玩家端按 reportId 定位战报展示点评。断线期间的点评不补推，重连后读 GET_BATTLE_REPORTS 的 reports[].comment 即可。',
};

export const PUSH_BATTLE_REPORT: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_BATTLE_REPORT',
  title: '推送：战斗战报生成（v13）',
  summary: `战斗结算生成战报时推送给持有方账号的所有在线连接（攻方出征或守方被 NPC 袭击）。载荷为完整战报（字段与 GET_BATTLE_REPORTS 的 reports[] 相同）；漏收由按需查询覆盖。`,
  dataFields: [
    { name: 'report', type: 'object', desc: '战报视图，字段与 GET_BATTLE_REPORTS 的 reports[] 相同。' },
  ],
  examples: [
    { op: Op.PUSH_BATTLE_REPORT, push: true, data: { report: BATTLE_REPORT } },
  ],
  agentNote: '收到后可先看 won / rounds / 双方 losses 决定是否读 GET_BATTLE_REPORTS 拉取历史明细；伴随的 PUSH_MARCH_STATE（march_arrived）与 march_completed 事件给出占领 / 掠夺结果。',
};
