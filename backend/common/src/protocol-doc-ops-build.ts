// 建造与推送类协议的对外文档（BUILD / BUILD_FARM / PUSH_BUILD_STATE / PUSH_AGENT_STATUS）。
// 账号与查询类协议及 OP_DOC 汇总见 protocol-doc-ops.ts；共用示例常量见 protocol-doc-shared.ts。

import { BUILDING_KINDS, Op } from './protocol';
import { BUILDING_INFO, DEFAULT_BUILD_SECONDS } from './rules';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import {
  AFTER_COST,
  BUILD_VIEW,
  CITY_ID,
  INITIAL_BUILDINGS_VIEW,
  INITIAL_LEVELS,
  INITIAL_POPULATION_VIEW,
  INITIAL_STORAGE,
  QUEUED_BUILD_VIEW,
  CANCELLED_BUILD_VIEW,
  INITIAL_PRODUCTION,
} from './protocol-doc-shared';

/** 九种建筑的成本一览（summary 引用，保持与 rules.ts 同步） */
const KIND_COST_SUMMARY = BUILDING_KINDS.map(
  (kind) =>
    `${BUILDING_INFO[kind].label}（${kind}）：金 ${BUILDING_INFO[kind].cost.gold} / 木 ${BUILDING_INFO[kind].cost.wood}` +
    (BUILDING_INFO[kind].cost.stone > 0 ? ` / 石 ${BUILDING_INFO[kind].cost.stone}` : ''),
).join('；');

/** BUILD / UPGRADE 的 kind 字段取值（九种一期建筑） */
const KIND_TYPE = "'farm' | 'lumber_mill' | 'quarry' | 'iron_mine' | 'house' | 'government' | 'barracks' | 'warehouse' | 'wall' | 'academy' | 'parade_ground' | 'beacon' | 'post_station' | 'arrow_tower' | 'tavern'";

export const REQUEST_BUILD: RequestOpDoc = {
  kind: 'request',
  name: 'BUILD',
  title: '发起建筑建造',
  preAuth: false,
  summary: `在当前城池发起一座指定类型建筑的建造（v3 起为统一入口，v4 起排队制，v5 起每种建筑同城唯一——已建成或已在队列中返回 BUILDING_EXISTS，成长请用 UPGRADE；一期不提供建筑拆除）：校验通过后立即扣减建造成本；无在建时立即开工（status=building，dueAt 为预计完成时间），有在建且排队未满时进入排队（status=queued，dueAt 为 null，队首完成后由后台自动激活）。由后台 Worker 在到期后完成。一期九种建筑（v27 起另加书院，v30 起另加校场 / 烽火台 / 驿站 / 箭塔）：农田/伐木场/采石场/铁矿四种资源建筑，民房（提高人口上限）、官府（自动产金，兼野地占领上限）、军营（征兵）、仓库（防掠夺保护：保护量 4000×等级、四资源固定均分；v21 起消费方接入——NPC 袭击主城攻破后按保护额结算可掠量）、城墙（守城加成：v21 起 NPC 袭击主城为守城战，defenseBonus 生效）；v27 起另有第十种书院 academy（科技研究所需：第 N 级科技要求发起研究的城书院 ≥ N 级，见 RESEARCH_TECH）；v30 起再加四种二期建筑——校场 parade_ground（每城同时在外部队数上限 = 校场等级，未建按 1，超限 MARCH / SCOUT 返回 DEPLOY_LIMIT，见 city.deploy）、烽火台 beacon（NPC 来袭预警提前量每级 +10%，敌情详细度 0–2 / 3–5 / 6+ 级分范围 / 兵种 / 精确）、驿站 post_station（从本城出发、目的地是自己另一座城的调兵与运输，行军速度每级 +10%）、箭塔 arrow_tower（守城战里城墙位上不会被消灭的远程单位，每回合固定伤害 150 × 等级、射程 45 + 5 × 等级，见 city.tower）；v36 起再加酒馆 tavern（每城限一座：每 4 小时基准随缩放刷新 3 名候选普通将、金币招募，账号普通将上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1，见 GET_HEROES / RECRUIT_HERO）。当前成本：${KIND_COST_SUMMARY}。队列容量为 1 条在建 + 2 条排队（占位数值）；资源不足返回 INSUFFICIENT_RESOURCES（v22 起附 shortfall 缺口与 retryAfterSeconds——按当前净产量推导，等满后重发必然成功），队列已满返回 QUEUE_FULL，失败响应均附当前城池状态（**data 仅含 city，无 build 载荷**——客户端必须先判 ok 再取载荷）。`,
  requestFields: [
    {
      name: 'kind',
      type: KIND_TYPE,
      desc: '必填。建筑类型（九种一期建筑，功能见摘要）；缺失或不是已知类型返回 INVALID_PARAMS。',
    },
  ],
  dataFields: [
    { name: 'build.id', type: 'string', desc: '本次建造的 UUID。' },
    { name: 'build.kind', type: KIND_TYPE, desc: '建筑类型，等于请求的 kind。' },
    { name: 'build.status', type: "'building' | 'queued' | 'completed' | 'cancelled'", desc: '发起时为 building（立即开工）或 queued（进入排队，v4）；完成推送中为 completed；取消后为 cancelled（v7）。' },
    { name: 'build.level', type: 'number', desc: '目标等级（v5）：建造恒为 1，升级（UPGRADE）为当前等级 + 1；连续升级（v22）为当前推进中的目标等级。' },
    { name: 'build.toLevel', type: 'number | null', desc: '连续升级的整链终点（v22 新增，AISLG-43）：UPGRADE toLevel 生效时为 10 以内目标等级，Worker 逐级推进 build.level 直到它；单级升级与建造为 null。' },
    { name: 'build.initiator', type: "'player' | 'agent'", desc: '发起原始指令的连接声明的登录类型。' },
    { name: 'build.startedAt', type: 'string', desc: '建造开始时间（ISO 8601）。' },
    { name: 'build.dueAt', type: 'string | null', desc: `预计到期时间（ISO 8601），基准为开始时间加 ${DEFAULT_BUILD_SECONDS} 秒（未加速；部署与全局时间缩放可调，见文档头部「全局时间缩放」），四种建筑时长相同；排队中（queued）为 null，队首激活时由服务端重算。` },
    { name: 'build.completedAt', type: 'string | null', desc: '实际完成时间；building 阶段为 null。' },
  ],
  errors: ['INVALID_PARAMS', 'INSUFFICIENT_RESOURCES', 'QUEUE_FULL', 'BUILDING_EXISTS'],
  examples: [
    {
      caption: '无在建：立即开工',
      request: { op: Op.BUILD, seq: 1, data: { kind: 'farm' } },
      responses: [{ op: Op.BUILD, seq: 1, ok: true, data: { build: BUILD_VIEW } }],
    },
    {
      caption: '有在建：进入排队（v4）',
      request: { op: Op.BUILD, seq: 2, data: { kind: 'lumber_mill' } },
      responses: [{ op: Op.BUILD, seq: 2, ok: true, data: { build: QUEUED_BUILD_VIEW } }],
    },
    {
      caption: '建筑类型不合法',
      request: { op: Op.BUILD, seq: 3, data: { kind: 'palace' } },
      responses: [
        { op: Op.BUILD, seq: 3, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } },
      ],
    },
    {
      caption: '队列已满被拒（附当前状态）',
      request: { op: Op.BUILD, seq: 4, data: { kind: 'quarry' } },
      responses: [
        {
          op: Op.BUILD,
          seq: 4,
          ok: false,
          error: { code: 'QUEUE_FULL', message: '建造队列已满，请等待队首完成' },
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
              queue: [BUILD_VIEW, QUEUED_BUILD_VIEW],
              building: BUILD_VIEW,
            },
          },
        },
      ],
    },
  ],
  agentNote:
    '失败响应的 data 仅含 city（无 build 载荷），附当前城池状态（queue 可见队首预计完成时间），据此决策。请求超时时不要盲目重发——可能已扣资源开工或入队，先用 GET_STATE 确认。玩家与 Agent 并发提交时，后提交方按最新队列状态判定：能入队则成功（status=queued），队满收到 QUEUE_FULL。成功后同账号其他在线连接会收到 PUSH_BUILD_STATE（build_started 或 build_queued）推送。资源会随产量持续增长：扣费校验以服务端结算后的最新余额为准。',
};

export const REQUEST_BUILD_FARM: RequestOpDoc = {
  kind: 'request',
  name: 'BUILD_FARM',
  title: '发起农场建造（兼容入口）',
  preAuth: false,
  summary:
    '协议 v2 及以前的农场建造入口，v3 起等价于 BUILD 且 kind 固定为 farm（请求参数被忽略）；v4 起同样遵循排队制（无在建立即开工，否则入队）。新客户端请改用 BUILD。',
  requestFields: [],
  dataFields: [
    { name: 'build', type: 'object', desc: '结构与 BUILD 响应相同（kind 恒为 farm）。' },
  ],
  errors: ['INSUFFICIENT_RESOURCES', 'QUEUE_FULL', 'BUILDING_EXISTS'],
  examples: [
    {
      request: { op: Op.BUILD_FARM, seq: 1 },
      responses: [
        { op: Op.BUILD_FARM, seq: 1, ok: true, data: { build: BUILD_VIEW } },
        {
          op: Op.BUILD_FARM,
          seq: 2,
          ok: false,
          error: { code: 'QUEUE_FULL', message: '建造队列已满，请等待队首完成' },
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
              queue: [BUILD_VIEW, QUEUED_BUILD_VIEW],
              building: BUILD_VIEW,
            },
          },
        },
      ],
    },
  ],
};

export const REQUEST_UPGRADE: RequestOpDoc = {
  kind: 'request',
  name: 'UPGRADE',
  title: '发起建筑升级',
  preAuth: false,
  summary:
    '把指定类型的建筑升到下一等级（v5 新增；每种建筑同城唯一，成长走升级）。与 BUILD 共用建造队列：无在建时立即开工，有在建时入队（排队上限内），队满返回 QUEUE_FULL。该类型已在队列中（含首次建造进行中、等级仍为 0）返回 BUILDING_EXISTS（在队冲突先于未建成判定）；未建造且不在队列返回 BUILDING_NOT_BUILT；已达等级上限（20 级，v31 AISLG-85 由 10 级开放到 20 级；占位数值）返回 BUILDING_LEVEL_MAX。升级成本 = 建造成本 × 升级倍数，升级时长 = 建造时长 × 升级倍数（均为占位公式；全局时间缩放作用于该总时长，钳 1 秒）：第 L → L+1 级的倍数 1~9 级 = L（线性，即升到 10 级为止的前期成本与耗时不变），L ≥ 10 时 = 9 × 1.3^(L − 9)（10→11 ≈ ×11.7、14→15 ≈ ×33.4、19→20 ≈ ×124.1；10→20 合计约 499 倍基础成本），成本逐项四舍五入；CityView.costs 的 upgrade / upgradeSeconds 与 chain 都按此公式下发。城墙守城减伤前 10 级每级 +5%、11~20 级每级 +2%（20 级 70%），其他按等级线性增长的效果（人口 / 产金 / 占领上限 / 分城上限 / 仓库保护 / 校场 / 烽火台 / 驿站等）本期不改。完成后产量、人口上限或仓储上限按新等级计算。失败响应均附当前城池状态（**data 仅含 city，无 build 载荷**——客户端必须先判 ok 再取载荷；v22 起资源不足时另附 shortfall 缺口与 retryAfterSeconds，见下方错误说明）。**v22（AISLG-43）连续升级**：可选 `toLevel`（当前等级 +2 .. 20）一次把该建筑升到目标等级——中间每一级合成**一条**队列条目：整链按各级公式价在发起时**一次性预扣**（快照即全额，取消排队条目按快照全额返还）、只占 **1 个**队列位、Worker 到达一级推进一级（build.level 为当前推进中的目标等级、build.toLevel 为整链终点），每级完成各发一条 build_completed 事件；响应另附 chain 数组给出每级 { level, cost, seconds }。边界口径：toLevel > 20 返回 BUILDING_LEVEL_MAX；toLevel ≤ 当前 +1（含低于当前等级的取值）视同单级升级（等效于不带 toLevel，不报错）；发起时整链校验资源，**中间级不会出现资源不足**（资源不足整单回滚、不入队，不存在「只做到某一级」的部分完成）。',
  requestFields: [
    {
      name: 'kind',
      type: KIND_TYPE,
      desc: '必填。要升级的建筑类型（九种一期建筑）；缺失或不是已知类型返回 INVALID_PARAMS。',
    },
    {
      name: 'toLevel',
      type: 'number',
      desc: '可选（v22，AISLG-43）。连续升级的目标等级（整数，当前等级 +2 .. 10）：中间每一级合成一条队列条目、整链一次性预扣、逐级推进。缺省 = 单级升级（当前 +1）；非整数或 < 3 返回 INVALID_PARAMS；toLevel ≤ 当前 +1 视同单级升级（等效于不带 toLevel）；toLevel > 10 返回 BUILDING_LEVEL_MAX。',
    },
  ],
  dataFields: [
    { name: 'build', type: 'object', desc: '建造视图，结构与 BUILD 响应相同；level 为目标等级（单级 = 当前 + 1；连续升级 = 当前推进中的目标等级），toLevel 为连续升级的整链终点（v22 新增，单级与建造为 null），status 为 building（立即开工）或 queued（入队）。' },
    { name: 'chain', type: 'array', desc: '连续升级的整链计划（v22 新增，仅 toLevel 请求返回）：[{ level, cost, seconds }] 按升级顺序列出每一级的目标等级、单级成本与单级时长（秒，已按全局时间缩放折算；各级完成时间可按顺序累加预估）。' },
    { name: 'shortfall', type: 'object', desc: '**仅 INSUFFICIENT_RESOURCES 失败响应**（v22 新增）：{ gold?, wood?, food?, stone?, iron? } 只列缺口 > 0 的资源与缺口量。' },
    { name: 'retryAfterSeconds', type: 'number | null', desc: '**仅 INSUFFICIENT_RESOURCES 失败响应**（v22 新增）：按当前净产量（含全局缩放、粮已扣军队耗粮）补齐全部缺口所需秒数——**等满该时长后重发必然成功**；任一缺口资源的净产量 ≤ 0 时为 null（等待外部输入，如集市兑换 / 掠夺收入）。产量随后续变化以最新失败响应为准。' },
  ],
  errors: ['INVALID_PARAMS', 'BUILDING_NOT_BUILT', 'BUILDING_LEVEL_MAX', 'BUILDING_EXISTS', 'INSUFFICIENT_RESOURCES', 'QUEUE_FULL'],
  examples: [
    {
      caption: '升级 1 级农田到 2 级（无在建，立即开工）',
      request: { op: Op.UPGRADE, seq: 1, data: { kind: 'farm' } },
      responses: [{ op: Op.UPGRADE, seq: 1, ok: true, data: { build: { ...BUILD_VIEW, level: 2 } } }],
    },
    {
      caption: '未建造时升级被拒',
      request: { op: Op.UPGRADE, seq: 2, data: { kind: 'quarry' } },
      responses: [
        { op: Op.UPGRADE, seq: 2, ok: false, error: { code: 'BUILDING_NOT_BUILT', message: '该类型尚未建造，请先建造' } },
      ],
    },
    {
      caption: 'v22 连续升级：1 级民房一口气升到 10 级（整链预扣、占 1 个队列位）',
      request: { op: Op.UPGRADE, seq: 3, data: { kind: 'house', toLevel: 10 } },
      responses: [
        {
          op: Op.UPGRADE,
          seq: 3,
          ok: true,
          data: {
            build: { ...BUILD_VIEW, kind: 'house', level: 2, toLevel: 10 },
            chain: '… 9 个条目：{ level: 2..10, cost: 各级建造成本 × (等级 − 1), seconds: 建造时长 × (等级 − 1) } …',
          },
        },
      ],
    },
    {
      caption: 'v22 资源不足：附缺口与重试等待秒数',
      request: { op: Op.UPGRADE, seq: 4, data: { kind: 'farm' } },
      responses: [
        {
          op: Op.UPGRADE,
          seq: 4,
          ok: false,
          error: { code: 'INSUFFICIENT_RESOURCES', message: '资源不足以支付建造' },
          data: { shortfall: { gold: 588 }, retryAfterSeconds: 42, city: '（当前城池状态，字段同 GET_STATE）' },
        },
      ],
    },
  ],
  agentNote:
    '失败响应的 data.city 附当前城池状态（levels 可见各类型当前等级）。升级期间该建筑维持当前等级的产量，完成后按新等级计算；升级与建造共用队列，规划时注意队首完成时间。请求超时时先用 GET_STATE 确认是否已入队。',
};

export const PUSH_BUILD_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_BUILD_STATE',
  title: '推送：建筑建造状态变化',
  summary:
    '建造状态变化时推送给该账号所有在线连接（发起连接除外——它已从 BUILD / UPGRADE / CANCEL_BUILD 的直接响应拿到结果）：build_started=立即开工或队首被后台激活、build_queued=进入排队（v4）、build_completed=完成（由 Worker 结算后经 API 发出）、build_cancelled=排队条目被取消（v7）。建成后的产量、人口上限或仓储上限变化不逐条推送，客户端用 GET_STATE 或本地按 city.production / city.population / city.storage 推算。',
  dataFields: [
    { name: 'reason', type: "'build_started' | 'build_queued' | 'build_completed' | 'build_cancelled'", desc: '触发本次推送的状态变化。' },
    { name: 'build', type: 'object', desc: '建造视图，字段与 BUILD 响应的 build 相同；完成时 status 为 completed 且 completedAt 非空，排队时 status 为 queued 且 dueAt 为 null，取消时 status 为 cancelled。' },
  ],
  examples: [
    { op: Op.PUSH_BUILD_STATE, push: true, data: { reason: 'build_started', build: { ...BUILD_VIEW, kind: 'quarry' } } },
    { op: Op.PUSH_BUILD_STATE, push: true, data: { reason: 'build_queued', build: QUEUED_BUILD_VIEW } },
    {
      op: Op.PUSH_BUILD_STATE,
      push: true,
      data: {
        reason: 'build_completed',
        build: { ...BUILD_VIEW, status: 'completed', completedAt: '2026-09-25T08:01:05.000Z' },
      },
    },
    {
      op: Op.PUSH_BUILD_STATE,
      push: true,
      data: { reason: 'build_cancelled', build: CANCELLED_BUILD_VIEW },
    },
  ],
  agentNote: '完成时间不保证精确：Worker 按到期时间结算，存在正常延迟；对时间敏感的决策用 GET_STATE 查询权威状态。',
};

export const PUSH_AGENT_STATUS: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_AGENT_STATUS',
  title: '推送：Agent 在线状态变化',
  summary: '该账号的 Agent 在线状态发生**翻转**（首个 Agent 连接上线 / 最后一个 Agent 连接离线）时，推送给账号所有在线连接（v21 起翻转才推，多开连接的增减不再逐次推送；eventId 用于多连接去重）。',
  dataFields: [
    { name: 'online', type: 'boolean', desc: '推送时刻该账号是否存在在线的 Agent 连接（账号级聚合，非单连接）。' },
    { name: 'connectionCount', type: 'number', desc: '推送时刻该账号的在线连接数（v21 新增，含玩家与 Agent 连接；非翻转的连接数变化不推送，精确值以重新登录或 GET_AGENT_INFO 为准）。' },
    { name: 'at', type: 'string', desc: '推送时间（ISO 8601）。' },
  ],
  examples: [
    { op: Op.PUSH_AGENT_STATUS, push: true, data: { online: true, connectionCount: 1, at: '2026-09-25T08:00:10.123Z' } },
    { op: Op.PUSH_AGENT_STATUS, push: true, data: { online: false, connectionCount: 0, at: '2026-09-25T09:00:00.000Z' } },
  ],
  agentNote: '收到 online=false 表示该账号的全部 Agent 连接都已离线。多连接去重用帧顶层的 eventId。',
};
