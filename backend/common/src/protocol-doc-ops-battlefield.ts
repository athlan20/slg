// 剧本战场·官渡（v75，AISLG-198）的对外协议文档。
// 规则与数值引用 common/src/battlefield.ts 的真实常量，避免文档与实现漂移。

import { Op } from './protocol';
import type { FieldDoc, PushOpDoc, RequestOpDoc } from './protocol-doc';
import { STARTED_AT } from './protocol-doc-shared';
import {
  BATTLEFIELD_ENTRY_POPULATION,
  BATTLEFIELD_FIRST_CAPTURE_MERIT,
  BATTLEFIELD_MAX_SQUADS,
  BATTLEFIELD_RANK_REWARDS,
  BATTLEFIELD_SECONDS_PER_TILE,
  BATTLEFIELD_SHOP,
  BATTLEFIELD_SIGNUP_HOURS,
  BATTLEFIELD_STRONGHOLDS,
  BATTLEFIELD_UNDERDOG_MAX,
  BATTLEFIELD_UNDERDOG_RATIO,
  BATTLEFIELD_LOSE_REWARD,
  BATTLEFIELD_WIN_REWARD,
} from './battlefield';

const START_MS = Date.parse(STARTED_AT);
const SIGNUP_AT = new Date(START_MS - BATTLEFIELD_SIGNUP_HOURS * 3_600_000).toISOString();
const END_AT = new Date(START_MS + 24 * 3_600_000).toISOString();

const EVENT_VIEW = {
  id: '9b2f4c1a-6d3e-4f80-9a71-2c5e8d4b6a10',
  script: 'guandu',
  name: '官渡之战',
  status: 'active',
  signupStartAt: SIGNUP_AT,
  startAt: STARTED_AT,
  endAt: END_AT,
  camps: {
    yuan: { camp: 'yuan', name: '袁绍军', signups: 12, entered: 10, score: 180 },
    cao: { camp: 'cao', name: '曹操军', signups: 15, entered: 13, score: 240 },
  },
  winner: null,
  finishReason: null,
  underdog: null,
} as const;

const STRONGHOLD_VIEW = {
  id: 'ford_yanjin',
  name: '延津渡口',
  kind: 'ford',
  x: 15,
  y: 15,
  ownerCamp: 'cao',
  pointsPerHour: 10,
  garrison: {
    porter: 0, militia: 120, scout: 0, pikeman: 0, swordsman: 40, archer: 60, cavalry: 15,
    iron_cavalry: 0, supply_wagon: 0, ballista: 0, siege_ram: 0, yulin_guard: 0, danyang_soldier: 0,
    baimao_soldier: 0, huwei_guard: 0, zhuge_crossbow: 0, xiandeng_warrior: 0, hubao_cavalry: 0, xiliang_cavalry: 0,
  },
  garrisonPower: 710,
  wallLevel: 0,
  towerLevel: 0,
  firstCaptureAvailable: false,
  capturedAt: STARTED_AT,
} as const;

const SQUAD_VIEW = {
  id: 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  x: 14,
  y: 15,
  status: 'marching',
  troops: {
    porter: 0, militia: 300, scout: 0, pikeman: 0, swordsman: 200, archer: 150, cavalry: 50,
    iron_cavalry: 0, supply_wagon: 0, ballista: 0, siege_ram: 0, yulin_guard: 0, danyang_soldier: 0,
    baimao_soldier: 0, huwei_guard: 0, zhuge_crossbow: 0, xiandeng_warrior: 0, hubao_cavalry: 0, xiliang_cavalry: 0,
  },
  targetX: 15,
  targetY: 15,
  targetStrongholdId: 'ford_yanjin',
  arriveAt: new Date(START_MS + 60_000).toISOString(),
  originX: 13,
  originY: 15,
  strongholdId: null,
} as const;

const ME_VIEW = {
  accountId: '6f1e2d3c-4b5a-4978-8c6d-5e4f3a2b1c0d',
  username: 'alice',
  camp: 'yuan',
  merit: 1240,
  rank: 3,
  entered: true,
  squads: [SQUAD_VIEW],
  cumulativeMerit: 3600,
} as const;

const SHOP_VIEW = {
  cumulativeMerit: 3600,
  items: BATTLEFIELD_SHOP.map((def) => ({
    item: def.item,
    label: def.label,
    cost: def.cost,
    limit: def.limit,
    bought: 0,
    reward:
      def.item === 'resources'
        ? { resources: { gold: 0, wood: def.resourcesEach, food: def.resourcesEach, stone: def.resourcesEach, iron: def.resourcesEach } }
        : def.item === 'hero_exp'
          ? { heroExp: def.heroExp }
          : { troop: def.troop, count: def.count },
  })),
} as const;

const SCHEDULE_TEXT = '北京时间每周二 20:00 开始报名、周三 20:00 开战、周四 20:00 结束（现实时间，不随全局时间缩放）';
const STRONGHOLD_TABLE = BATTLEFIELD_STRONGHOLDS.map(
  (def) => `${def.name}（${def.x},${def.y}，${def.pointsPerHour} 分/小时，守军 ×${def.garrisonMultiplier}）`,
).join('；');
const SHOP_TEXT = BATTLEFIELD_SHOP.map((def) => `${def.label} ${def.cost} 军功（每场限 ${def.limit}）`).join('；');

const STATE_DATA_FIELDS: FieldDoc[] = [
    { name: 'event', type: 'object | null', desc: '当前 / 最近一场战场：{ id, script: guandu, name, status: signup|active|finished, signupStartAt, startAt, endAt, camps: { yuan: { camp, name, signups, entered, score }, cao: 同结构 }, winner: yuan|cao|null, finishReason: score|base_captured|null, underdog: { camp, multiplier } | null }。从未开过为 null。' },
    { name: 'nextSignupAt', type: 'string', desc: '下一场报名开始时刻（北京时间每周二 20:00）。' },
    { name: 'strongholds', type: 'array', desc: '9 个据点：{ id, name, kind: base|ford|post|granary, x, y, ownerCamp: yuan|cao|null（null = 中立 NPC）, pointsPerHour, garrison（全兵种计数，NPC + 玩家据守合计）, garrisonPower（参考战力）, wallLevel, towerLevel, firstCaptureAvailable（首占 +200 军功还没被拿过）, capturedAt }。' },
    { name: 'me', type: 'object | null', desc: '本场我的状态：{ accountId, username, camp, merit 本场军功, rank 本场名次（未入场为 null）, entered, squads: [{ id, x, y, status: marching|idle|garrison, troops, targetX, targetY, targetStrongholdId, arriveAt, originX, originY, strongholdId }], cumulativeMerit 跨场军功余额 }；未报名为 null。' },
    { name: 'top', type: 'array', desc: '本场军功榜前 10：{ rank, accountId, username, camp, merit }（同分并列，军功 0 不上榜）。' },
    { name: 'shop', type: 'object', desc: '战场商店：{ cumulativeMerit, items: [{ item: resources|hero_exp|swordsman|cavalry, label, cost, limit, bought 本场已买, reward: { resources? , heroExp?, troop?, count? } }] }。' },
    { name: 'rewards', type: 'object', desc: '奖励表：{ winner { label, gold, resourcesEach }, loser 同结构, rankTiers: [{ label, rank, maxRank, gold, resourcesEach }] }。' },
];

export const REQUEST_GET_BATTLEFIELD: RequestOpDoc = {
  kind: 'request',
  name: 'GET_BATTLEFIELD',
  title: '查询剧本战场（官渡之战，v75，AISLG-198）',
  preAuth: false,
  summary:
    `周期性的阵营对阵营活动，玩家与 Agent 通用。日程：${SCHEDULE_TEXT}；报名要求主城官府 ≥ 5 级，选袁绍军或曹操军（一方报名人数超过另一方 1.5 倍且多 5 人以上时，人多一方暂停报名）。` +
    `战场是 30×30 的独立地图，与世界地图完全隔离；中间一条河（x=15）只有 3 处渡口（y=5/15/25）能过。行军每格 ${BATTLEFIELD_SECONDS_PER_TILE} 秒现实时间，不随全局缩放。` +
    `9 个据点：${STRONGHOLD_TABLE}。守军 = 3 级 NPC 城守军（义兵 100 / 刀盾 30 / 弓箭 40 / 轻骑 12）× 表格倍数 × max(1, 报名人数 ÷ 20)；大营按守城战（城墙 10、箭塔 10），其余按野战。` +
    `报名期从主城带一支部队入场（按人口最多 ${BATTLEFIELD_ENTRY_POPULATION}，每人一次，开战后不能追加），入场后可拆成最多 ${BATTLEFIELD_MAX_SQUADS} 队。` +
    `军功 = 歼灭敌军参考战力 1:1（打 NPC 守军也算），首次打下据点额外 +${BATTLEFIELD_FIRST_CAPTURE_MERIT}；乌巢粮仓让敌方阵营所有部队耗粮翻倍；开战时一方人数少于另一方 ${BATTLEFIELD_UNDERDOG_RATIO * 100}% 时，人少一方据点积分 × min(${BATTLEFIELD_UNDERDOG_MAX}, 多/少)。` +
    `结束时按胜负发奖（胜方 ${BATTLEFIELD_WIN_REWARD.gold} 金 + 四资源各 ${BATTLEFIELD_WIN_REWARD.wood}；败方 ${BATTLEFIELD_LOSE_REWARD.gold} 金 + 各 ${BATTLEFIELD_LOSE_REWARD.wood}），个人军功前 10 有额外奖励（${BATTLEFIELD_RANK_REWARDS.map((tier) => `${tier.label} ${tier.gold} 金 + 各 ${tier.resourcesEach}`).join('；')}），军功 > 0 才能领；幸存部队回主城。` +
    `战场商店（军功跨场累积、换季清零）：${SHOP_TEXT}。`,
  requestFields: [],
  dataFields: STATE_DATA_FIELDS,
  errors: [],
  examples: [
    {
      caption: '战场进行中：我在袁绍军，一支队伍正在去延津渡口',
      request: { op: Op.GET_BATTLEFIELD, seq: 30, data: {} },
      responses: [
        {
          op: Op.GET_BATTLEFIELD,
          seq: 30,
          ok: true,
          data: {
            event: EVENT_VIEW,
            nextSignupAt: new Date(START_MS + 7 * 24 * 3_600_000).toISOString(),
            strongholds: [STRONGHOLD_VIEW, '（其余 8 个据点同结构）'],
            me: ME_VIEW,
            top: [
              { rank: 1, accountId: '…', username: 'bob', camp: 'cao', merit: 2200 },
              { rank: 2, accountId: '…', username: 'carol', camp: 'yuan', merit: 1500 },
              ME_VIEW,
            ],
            shop: SHOP_VIEW,
            rewards: {
              winner: { label: '胜方每人', gold: BATTLEFIELD_WIN_REWARD.gold, resourcesEach: BATTLEFIELD_WIN_REWARD.wood },
              loser: { label: '败方每人', gold: BATTLEFIELD_LOSE_REWARD.gold, resourcesEach: BATTLEFIELD_LOSE_REWARD.wood },
              rankTiers: BATTLEFIELD_RANK_REWARDS.map((tier) => ({ label: tier.label, maxRank: tier.maxRank, gold: tier.gold, resourcesEach: tier.resourcesEach })),
            },
          },
        },
      ],
    },
  ],
  agentNote:
    '先看 event.status：signup 期只能报名 / 入场，active 才能行军与攻打。行军目标用 strongholds 的 id（MARCH_BATTLEFIELD_SQUAD 会按据点坐标走最短路径）；河只有 3 处渡口，先取渡口再渡河。攻打前用 garrisonPower 与自己的队伍战力对比，大营是守城战（城墙 + 箭塔），没有把握先打渡口 / 普通据点。军功来自歼灭敌军（打 NPC 也算），首占据点 +200；乌巢（granary_wuchao）价值 30 分/小时并让敌方耗粮翻倍，适合偷袭。结束奖励自动入账，军功可立刻在战场商店换资源 / 武将经验 / 兵。',
};

export const REQUEST_SIGNUP_BATTLEFIELD: RequestOpDoc = {
  kind: 'request',
  name: 'SIGNUP_BATTLEFIELD',
  title: '报名剧本战场（v75，AISLG-198）',
  preAuth: false,
  summary:
    `在报名期（${SCHEDULE_TEXT}）选阵营报名：主城官府 ≥ 5 级；同一场只能报一次，阵营选定后不能改。` +
    '一方报名人数超过另一方 1.5 倍且多出 5 人以上时，人多的一方暂停报名（返回 BATTLEFIELD_CAMP_FULL，附 count / otherCount / limit）。报名只占阵营人数，不带兵；带兵用 ENTER_BATTLEFIELD（开战前）。',
  requestFields: [{ name: 'camp', type: "'yuan' | 'cao'", desc: '必填。袁绍军 yuan / 曹操军 cao。' }],
  dataFields: STATE_DATA_FIELDS,
  errors: ['INVALID_PARAMS', 'BATTLEFIELD_SIGNUP_CLOSED', 'BATTLEFIELD_ALREADY_JOINED', 'BATTLEFIELD_GOVERNMENT_TOO_LOW', 'BATTLEFIELD_CAMP_FULL'],
  examples: [
    {
      caption: '报名袁绍军',
      request: { op: Op.SIGNUP_BATTLEFIELD, seq: 31, data: { camp: 'yuan' } },
      responses: [{ op: Op.SIGNUP_BATTLEFIELD, seq: 31, ok: true, data: { event: EVENT_VIEW, me: { ...ME_VIEW, entered: false, squads: [], merit: 0, rank: null } } }],
    },
  ],
  agentNote: '报名前先 GET_BATTLEFIELD 看双方 signups，选人少的一方通常能吃到人少补偿；报名后记得在开战前 ENTER_BATTLEFIELD 带兵入场，否则开战后无法入场。',
};

export const REQUEST_ENTER_BATTLEFIELD: RequestOpDoc = {
  kind: 'request',
  name: 'ENTER_BATTLEFIELD',
  title: '带部队入场（v75，AISLG-198）',
  preAuth: false,
  summary:
    `报名后、开战前，从主城带一支部队进入战场：按人口计最多 ${BATTLEFIELD_ENTRY_POPULATION}（铁骑兵 3、辎重车 6……），部队从主城驻军扣除，战场结束后幸存部队回到主城。` +
    '每人每场只能入场一次，开战后不能追加兵力。入场后队伍出现在自己大营旁，可用 SPLIT_BATTLEFIELD_SQUAD 拆成最多 3 队。',
  requestFields: [
    { name: 'troops', type: 'object', desc: `必填。按兵种数量（非负整数，至少 1 个单位）：{ militia, swordsman, archer, cavalry, ... }，键集同 MARCH.troops；按人口合计 ≤ ${BATTLEFIELD_ENTRY_POPULATION}。` },
  ],
  dataFields: STATE_DATA_FIELDS,
  errors: ['INVALID_PARAMS', 'BATTLEFIELD_NOT_JOINED', 'BATTLEFIELD_ENTRY_CLOSED', 'BATTLEFIELD_ALREADY_ENTERED', 'BATTLEFIELD_POPULATION_LIMIT', 'INSUFFICIENT_TROOPS'],
  examples: [
    {
      caption: '带 700 单位入场',
      request: { op: Op.ENTER_BATTLEFIELD, seq: 32, data: { troops: { militia: 300, swordsman: 200, archer: 150, cavalry: 50 } } },
      responses: [{ op: Op.ENTER_BATTLEFIELD, seq: 32, ok: true, data: { me: { ...ME_VIEW, entered: true, squads: [{ ...SQUAD_VIEW, status: 'idle', targetX: null, targetY: null, targetStrongholdId: null, arriveAt: null }] } } }],
    },
  ],
  agentNote: '入场前用 GET_STATE 的 city.army 确认兵够，并算清人口（铁骑兵 3 / 辎重车 6 / 床弩 3 / 冲车 5）。全部兵力一次性带入即可，开战后无法追加；拆队是战术选择，不影响入场上限。',
};

export const REQUEST_SPLIT_BATTLEFIELD_SQUAD: RequestOpDoc = {
  kind: 'request',
  name: 'SPLIT_BATTLEFIELD_SQUAD',
  title: '拆分战场队伍（v75，AISLG-198）',
  preAuth: false,
  summary: `从一支队伍里分出一支新队伍（位置相同、状态待命），每人最多 ${BATTLEFIELD_MAX_SQUADS} 队；行军中不能拆。新队伍与原队伍都必须至少剩 1 个单位。`,
  requestFields: [
    { name: 'squadId', type: 'string', desc: '必填。要拆分的队伍 id（GET_BATTLEFIELD 的 me.squads）。' },
    { name: 'troops', type: 'object', desc: '必填。从原队伍分出的兵种数量，不能超过原队伍现有数量。' },
  ],
  dataFields: STATE_DATA_FIELDS,
  errors: ['INVALID_PARAMS', 'BATTLEFIELD_SQUAD_NOT_FOUND', 'BATTLEFIELD_SQUAD_BUSY', 'BATTLEFIELD_SQUAD_LIMIT', 'INSUFFICIENT_TROOPS'],
  examples: [
    {
      caption: '从主力里分出 100 骑兵当机动队',
      request: { op: Op.SPLIT_BATTLEFIELD_SQUAD, seq: 33, data: { squadId: SQUAD_VIEW.id, troops: { cavalry: 100 } } },
      responses: [{ op: Op.SPLIT_BATTLEFIELD_SQUAD, seq: 33, ok: true, data: { me: { ...ME_VIEW, squads: [SQUAD_VIEW, { ...SQUAD_VIEW, id: '…', troops: { ...SQUAD_VIEW.troops, cavalry: 100 } }] } } }],
    },
  ],
  agentNote: '拆队适合「主力攻据点 + 骑兵绕后抢乌巢 / 渡口」这类分兵。行军中不能拆，先等到达。',
};

export const REQUEST_MARCH_BATTLEFIELD_SQUAD: RequestOpDoc = {
  kind: 'request',
  name: 'MARCH_BATTLEFIELD_SQUAD',
  title: '战场内行军 / 攻打据点（v75，AISLG-198）',
  preAuth: false,
  summary:
    `给一支待命 / 据守中的队伍下令：目标给 strongholdId（自动取据点坐标）或 x / y；每格 ${BATTLEFIELD_SECONDS_PER_TILE} 秒现实时间，河只能从 3 处渡口（y=5/15/25）通过。` +
    '到达友方据点 = 入驻据守（合并守军）；到达敌方 / 中立据点 = 自动开战（大营按守城战），胜方幸存部队留守、据点易手。行军中不能再次下令。',
  requestFields: [
    { name: 'squadId', type: 'string', desc: '必填。队伍 id。' },
    { name: 'strongholdId', type: 'string', desc: '可选（与 x / y 二选一）。目标据点 id；同时给 x / y 时必须与据点坐标一致，否则 BATTLEFIELD_TARGET_INVALID。' },
    { name: 'x', type: 'number', desc: '可选。目标横坐标（0..29）；只在没有 strongholdId 时使用，且必须与 y 同时给。' },
    { name: 'y', type: 'number', desc: '可选。目标纵坐标（0..29）；只在没有 strongholdId 时使用。' },
  ],
  dataFields: STATE_DATA_FIELDS,
  errors: ['INVALID_PARAMS', 'BATTLEFIELD_NOT_ACTIVE', 'BATTLEFIELD_SQUAD_NOT_FOUND', 'BATTLEFIELD_SQUAD_BUSY', 'BATTLEFIELD_UNREACHABLE', 'BATTLEFIELD_TARGET_INVALID'],
  examples: [
    {
      caption: '从 (14,15) 攻打延津渡口',
      request: { op: Op.MARCH_BATTLEFIELD_SQUAD, seq: 34, data: { squadId: SQUAD_VIEW.id, strongholdId: 'ford_yanjin' } },
      responses: [{ op: Op.MARCH_BATTLEFIELD_SQUAD, seq: 34, ok: true, data: { me: { ...ME_VIEW, squads: [SQUAD_VIEW] } } }],
    },
  ],
  agentNote: '到达结算与战报由服务端在 Worker 里完成，客户端轮询 / 收 PUSH_BATTLEFIELD_STATE 后重查即可。攻打前对比 garrisonPower 与自己的队伍战力；没有把握先打渡口（10 分/小时）或普通据点。战败的幸存部队会退回出发位置。',
};

export const REQUEST_BUY_BATTLEFIELD_ITEM: RequestOpDoc = {
  kind: 'request',
  name: 'BUY_BATTLEFIELD_ITEM',
  title: '战场商店兑换（v75，AISLG-198）',
  preAuth: false,
  summary: `用战场军功换东西（军功跨场累积、换季清零；每场限购，见 GET_BATTLEFIELD 的 shop.items）：${SHOP_TEXT}。兑换即时到账（资源包进主城、兵直接进主城驻军、武将经验给指定武将），不占队列。`,
  requestFields: [
    { name: 'item', type: "'resources' | 'hero_exp' | 'swordsman' | 'cavalry'", desc: '必填。商品。' },
    { name: 'heroId', type: 'string', desc: 'item=hero_exp 时必填：经验给这个武将（必须属于本账号）。' },
  ],
  dataFields: [
    { name: 'item', type: 'string', desc: '商品。' },
    { name: 'cost', type: 'number', desc: '本次扣掉的军功。' },
    { name: 'cumulativeMerit', type: 'number', desc: '兑换后的军功余额。' },
    { name: 'bought', type: 'number', desc: '本场该商品累计已买数量（含本次）。' },
    { name: 'reward', type: 'object', desc: '到账内容：{ resources? } / { heroExp, level, leveledTo } / { troop, count }。' },
  ],
  errors: ['INVALID_PARAMS', 'BATTLEFIELD_NOT_ACTIVE', 'BATTLEFIELD_SHOP_LIMIT', 'BATTLEFIELD_MERIT_INSUFFICIENT', 'HERO_NOT_FOUND'],
  examples: [
    {
      caption: '换一包资源',
      request: { op: Op.BUY_BATTLEFIELD_ITEM, seq: 35, data: { item: 'resources' } },
      responses: [{ op: Op.BUY_BATTLEFIELD_ITEM, seq: 35, ok: true, data: { item: 'resources', cost: 200, cumulativeMerit: 3400, bought: 1, reward: { resources: { gold: 0, wood: 10000, food: 10000, stone: 10000, iron: 10000 } } } }],
    },
  ],
  agentNote: '打得多不如换得准：资源包适合补建造缺口，武将经验给主力将，刀盾 / 轻骑直接补战损。注意每场限购，军功余额跨场保留但换季清零。',
};

export const PUSH_BATTLEFIELD_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_BATTLEFIELD_STATE',
  title: '推送：剧本战场报名 / 开战 / 据点易手 / 收场（v75，AISLG-198）',
  summary: '报名开始、开战、据点易手（含大营被攻破）、战场收场时推给全部在线连接；载荷里的 event 与 GET_BATTLEFIELD 的 event 同结构。',
  dataFields: [
    { name: 'reason', type: "'signup' | 'started' | 'stronghold' | 'finished'", desc: '报名 / 开战 / 据点易手 / 收场。' },
    { name: 'event', type: 'object', desc: '战场视图（结构同 GET_BATTLEFIELD 的 event）。' },
    { name: 'strongholdId', type: 'string', desc: 'reason=stronghold 时易手的据点 id。' },
  ],
  examples: [{ op: Op.PUSH_BATTLEFIELD_STATE, push: true, data: { reason: 'stronghold', event: EVENT_VIEW, strongholdId: 'ford_yanjin' } }],
  agentNote: '推送只带事件摘要与据点 id，收到后重查 GET_BATTLEFIELD 拿完整据点守军、自己的队伍与军功。漏收时定时重查即可。',
};