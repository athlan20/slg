// 剧本战场（v75，AISLG-198 官渡；v80，AISLG-199 讨伐董卓 / 赤壁之战）的对外协议文档。
// 规则与数值引用 common/src/battlefield.ts 的真实常量，避免文档与实现漂移。

import { Op } from './protocol';
import type { FieldDoc, PushOpDoc, RequestOpDoc } from './protocol-doc';
import { STARTED_AT } from './protocol-doc-shared';
import {
  BATTLEFIELD_CHAIN_DEFENSE_PERCENT,
  BATTLEFIELD_CHAIN_FIRE_MULTIPLIER,
  BATTLEFIELD_CHAIN_MERIT_COST,
  BATTLEFIELD_CHAIN_MS,
  BATTLEFIELD_DONGZHUO_TIERS,
  BATTLEFIELD_ENTRY_POPULATION,
  BATTLEFIELD_FIRE_COOLDOWN_MS,
  BATTLEFIELD_FIRE_HP_RATIO,
  BATTLEFIELD_FIRE_MERIT_COST,
  BATTLEFIELD_FIRST_CAPTURE_MERIT,
  BATTLEFIELD_LVBU_BONUS,
  BATTLEFIELD_MAX_SQUADS,
  BATTLEFIELD_NEIGHBOR_DISTANCE,
  BATTLEFIELD_RANK_REWARDS,
  BATTLEFIELD_SECONDS_PER_TILE,
  BATTLEFIELD_SHOP,
  BATTLEFIELD_SHOP_CHIBI,
  BATTLEFIELD_SIGNUP_HOURS,
  BATTLEFIELD_STRONGHOLDS,
  BATTLEFIELD_UNDERDOG_MAX,
  BATTLEFIELD_UNDERDOG_RATIO,
  BATTLEFIELD_LOSE_REWARD,
  BATTLEFIELD_WIN_REWARD,
  BATTLEFIELD_WIND_RANGE_PERCENT,
  BATTLEFIELD_WIND_MS,
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
/** 每周一场，剧本按周轮换；event.script 标明本场剧本，nextScript 为下一场剧本 */
const ROTATION_TEXT = `每周一场，剧本按周轮换：官渡之战 → 讨伐董卓 → 赤壁之战（循环），本场剧本见 event.script、下一场见 nextScript`;
const DONGZHUO_TEXT =
  `讨伐董卓（script=dongzhuo，全服合作）：只有讨董联军一方，所有报名玩家都在同一边（报名时 camp 仍要传，服务端统一记为 yuan），对手是 NPC 董卓军。` +
  `一条推进线 汜水关 → 虎牢关 → 洛阳，前一关打下后下一关才开放（strongholds[].unlocked）。守军 = 3 级 NPC 城守军 × 倍数 × max(1, 报名人数 ÷ 10)：` +
  `汜水关 ×15（城墙 10 / 箭塔 10）、虎牢关 ×40（城墙 15 / 箭塔 15，守将吕布攻击 +${BATTLEFIELD_LVBU_BONUS.atkPercent}% 、减伤 −${BATTLEFIELD_LVBU_BONUS.defPercent}%）、洛阳 ×30（城墙 20 / 箭塔 20）。` +
  `守军伤亡保留不回血。攻下洛阳即结束（胜）；时间到也结束。奖励按全服最远进度领一档（军功 > 0 才能领）：${BATTLEFIELD_DONGZHUO_TIERS.map((tier) => `${tier.label} ${tier.gold} 金 + 四资源各 ${tier.resourcesEach}`).join('；')}；个人军功前 10 的额外奖励与官渡相同。没有玩家对抗。`;
const CHIBI_TEXT =
  `赤壁之战（script=chibi）：孙刘联军（yuan）对曹操军（cao），人数限制、人少补偿、胜负判定、奖励表与官渡相同；报名要求爵位大夫及以上（NOBILITY_TOO_LOW，附 required / current）。` +
  `地图同为 30×30 与河（x=15，3 处渡口），双方各 4 个据点加各 1 座大营（共 10 个，见 strongholds）；大营与据点守军、积分产出与官渡对应据点相同（大营守军 ×10，城墙 / 箭塔 10）。` +
  `风向：开战时随机东南风（se）或西北风（nw），之后每 ${BATTLEFIELD_WIND_MS / 3_600_000} 小时交替一次，切换前 30 分钟预告；event.wind = { direction, label, bonusCamp, nextAt, noticeAt }。` +
  `顺风方（se 利孙刘、nw 利曹操）的远程兵种与床弩射程 +${BATTLEFIELD_WIND_RANGE_PERCENT}%（战报可见）。` +
  `火攻（FIRE_BATTLEFIELD_STRONGHOLD，op 139）：孙刘方、东南风期间，花 ${BATTLEFIELD_FIRE_MERIT_COST} 军功，火攻与己方据点相邻（曼哈顿距离 ≤ ${BATTLEFIELD_NEIGHBOR_DISTANCE}）的曹方据点，立即对守军造成总生命 ${BATTLEFIELD_FIRE_HP_RATIO * 100}% 的伤害；同一目标每 ${BATTLEFIELD_FIRE_COOLDOWN_MS / 3_600_000} 小时最多一次。` +
  `连锁战船（CHAIN_BATTLEFIELD_STRONGHOLD，op 140）：曹方给己方据点花 ${BATTLEFIELD_CHAIN_MERIT_COST} 军功连锁 ${BATTLEFIELD_CHAIN_MS / 3_600_000} 小时：守军受到的伤害 −${BATTLEFIELD_CHAIN_DEFENSE_PERCENT}%，但被火攻时伤害翻倍（${BATTLEFIELD_FIRE_HP_RATIO * 100}% → ${BATTLEFIELD_FIRE_HP_RATIO * BATTLEFIELD_CHAIN_FIRE_MULTIPLIER * 100}%）。` +
  `赤壁商店另有铁骑兵 ${BATTLEFIELD_SHOP_CHIBI.find((def) => def.item === 'iron_cavalry')?.count ?? 20}（直接进主城，${BATTLEFIELD_SHOP_CHIBI.find((def) => def.item === 'iron_cavalry')?.cost ?? 800} 军功，每场限 1 次）。`;
const STRONGHOLD_TABLE = BATTLEFIELD_STRONGHOLDS.map(
  (def) => `${def.name}（${def.x},${def.y}，${def.pointsPerHour} 分/小时，守军 ×${def.garrisonMultiplier}）`,
).join('；');
const SHOP_TEXT = BATTLEFIELD_SHOP.map((def) => `${def.label} ${def.cost} 军功（每场限 ${def.limit}）`).join('；');

const STATE_DATA_FIELDS: FieldDoc[] = [
    { name: 'event', type: 'object | null', desc: '当前 / 最近一场战场：{ id, script: guandu|dongzhuo|chibi, name, status: signup|active|finished, signupStartAt, startAt, endAt, camps: { yuan: { camp, name, signups, entered, score }, cao: 同结构 }, winner: yuan|cao|null, finishReason: score|base_captured|null, underdog: { camp, multiplier } | null, wind: 赤壁专有 { direction: se|nw, label, bonusCamp, nextAt, noticeAt }（其他剧本为 null） }。从未开过为 null。' },
    { name: 'nextSignupAt', type: 'string', desc: '下一场报名开始时刻（北京时间每周二 20:00）。' },
    { name: 'nextScript', type: "'guandu' | 'dongzhuo' | 'chibi'", desc: '下一场的剧本（轮换预告）。' },
    { name: 'strongholds', type: 'array', desc: '本场据点（官渡 9 个 / 讨董 3 关 / 赤壁 10 个；讨董按推进线顺序）：{ id, name, kind: base|ford|post|granary, x, y, ownerCamp: yuan|cao|null（null = 中立 NPC；讨董的董卓军也是 null）, pointsPerHour, garrison（全兵种计数，NPC + 玩家据守合计）, garrisonPower（参考战力）, wallLevel, towerLevel, firstCaptureAvailable（首占 +200 军功还没被拿过）, capturedAt, unlocked（讨董：前一关未打下为 false；其他剧本恒为 true）, chainUntil（赤壁曹方连锁截止，其他 null）, fireNextAt（赤壁火攻冷却截止，其他 null） }。' },
    { name: 'me', type: 'object | null', desc: '本场我的状态：{ accountId, username, camp, merit 本场军功, rank 本场名次（未入场为 null）, entered, squads: [{ id, x, y, status: marching|idle|garrison, troops, targetX, targetY, targetStrongholdId, arriveAt, originX, originY, strongholdId }], cumulativeMerit 跨场军功余额 }；未报名为 null。' },
    { name: 'top', type: 'array', desc: '本场军功榜前 10：{ rank, accountId, username, camp, merit }（同分并列，军功 0 不上榜）。' },
    { name: 'shop', type: 'object', desc: '战场商店（赤壁多一个 iron_cavalry）：{ cumulativeMerit, items: [{ item: resources|hero_exp|swordsman|cavalry|iron_cavalry, label, cost, limit, bought 本场已买, reward: { resources? , heroExp?, troop?, count? } }] }。' },
    { name: 'rewards', type: 'object', desc: '奖励表：{ winner { label, gold, resourcesEach }, loser 同结构, rankTiers: [{ label, rank, maxRank, gold, resourcesEach }], progressTiers: [{ label, progress, gold, resourcesEach }]（讨董的全服进度档；其他剧本为空数组） }。' },
];

export const REQUEST_GET_BATTLEFIELD: RequestOpDoc = {
  kind: 'request',
  name: 'GET_BATTLEFIELD',
  title: '查询剧本战场（官渡之战，v75，AISLG-198）',
  preAuth: false,
  summary:
    `周期性的剧本战场，玩家与 Agent 通用。日程：${SCHEDULE_TEXT}。${ROTATION_TEXT}。` +
    `官渡之战（script=guandu）是阵营对阵：报名要求主城官府 ≥ 5 级，选袁绍军或曹操军（一方报名人数超过另一方 1.5 倍且多 5 人以上时，人多一方暂停报名）。` +
    `战场是 30×30 的独立地图，与世界地图完全隔离；中间一条河（x=15）只有 3 处渡口（y=5/15/25）能过。行军每格 ${BATTLEFIELD_SECONDS_PER_TILE} 秒现实时间，不随全局缩放。` +
    `9 个据点：${STRONGHOLD_TABLE}。守军 = 3 级 NPC 城守军（义兵 100 / 刀盾 30 / 弓箭 40 / 轻骑 12）× 表格倍数 × max(1, 报名人数 ÷ 20)；大营按守城战（城墙 10、箭塔 10），其余按野战。` +
    `报名期从主城带一支部队入场（按人口最多 ${BATTLEFIELD_ENTRY_POPULATION}，每人一次，开战后不能追加），入场后可拆成最多 ${BATTLEFIELD_MAX_SQUADS} 队。` +
    `军功 = 歼灭敌军参考战力 1:1（打 NPC 守军也算），首次打下据点额外 +${BATTLEFIELD_FIRST_CAPTURE_MERIT}；乌巢粮仓让敌方阵营所有部队耗粮翻倍；开战时一方人数少于另一方 ${BATTLEFIELD_UNDERDOG_RATIO * 100}% 时，人少一方据点积分 × min(${BATTLEFIELD_UNDERDOG_MAX}, 多/少)。` +
    `结束时按胜负发奖（胜方 ${BATTLEFIELD_WIN_REWARD.gold} 金 + 四资源各 ${BATTLEFIELD_WIN_REWARD.wood}；败方 ${BATTLEFIELD_LOSE_REWARD.gold} 金 + 各 ${BATTLEFIELD_LOSE_REWARD.wood}），个人军功前 10 有额外奖励（${BATTLEFIELD_RANK_REWARDS.map((tier) => `${tier.label} ${tier.gold} 金 + 各 ${tier.resourcesEach}`).join('；')}），军功 > 0 才能领；幸存部队回主城。` +
    `战场商店（军功跨场累积、换季清零）：${SHOP_TEXT}。` +
    `${DONGZHUO_TEXT} ${CHIBI_TEXT}`,
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
            nextScript: 'dongzhuo',
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
              progressTiers: [],
            },
          },
        },
      ],
    },
  ],
  agentNote:
    '先看 event.script 与 event.status：signup 期只能报名 / 入场，active 才能行军与攻打。行军目标用 strongholds 的 id（MARCH_BATTLEFIELD_SQUAD 会按据点坐标走最短路径）；河只有 3 处渡口，先取渡口再渡河。攻打前用 garrisonPower 与自己的队伍战力对比，有城墙的据点按守城战（城墙 + 箭塔），没有把握先打渡口 / 普通据点。军功来自歼灭敌军（打 NPC 也算），首占据点 +200；乌巢（granary_wuchao）价值 30 分/小时并让敌方耗粮翻倍，适合偷袭。结束奖励自动入账，军功可立刻在战场商店换资源 / 武将经验 / 兵。讨董：只看 unlocked 为 true 的关卡，先打汜水关再虎牢关，洛阳最后；赤壁：先看 event.wind，东南风时孙刘方可以火攻，西北风时曹方可以连锁，留意预告的切换时刻。',
};

export const REQUEST_SIGNUP_BATTLEFIELD: RequestOpDoc = {
  kind: 'request',
  name: 'SIGNUP_BATTLEFIELD',
  title: '报名剧本战场（v75，AISLG-198；v80 讨董 / 赤壁）',
  preAuth: false,
  summary:
    `在报名期（${SCHEDULE_TEXT}）报名：主城官府 ≥ 5 级；同一场只能报一次，阵营选定后不能改。` +
    '官渡 / 赤壁：一方报名人数超过另一方 1.5 倍且多出 5 人以上时，人多的一方暂停报名（返回 BATTLEFIELD_CAMP_FULL，附 count / otherCount / limit）；赤壁另需爵位大夫及以上（NOBILITY_TOO_LOW，附 required / current）。' +
    '讨伐董卓是单阵营合作本，所有报名玩家都记为讨董联军（yuan），不做人数失衡判断。报名只占阵营人数，不带兵；带兵用 ENTER_BATTLEFIELD（开战前）。',
  requestFields: [{ name: 'camp', type: "'yuan' | 'cao'", desc: '必填。袁绍军 yuan / 曹操军 cao（讨董场统一记为 yuan，此字段仍需传合法值）。' }],
  dataFields: STATE_DATA_FIELDS,
  errors: ['INVALID_PARAMS', 'BATTLEFIELD_SIGNUP_CLOSED', 'BATTLEFIELD_ALREADY_JOINED', 'BATTLEFIELD_GOVERNMENT_TOO_LOW', 'BATTLEFIELD_CAMP_FULL', 'NOBILITY_TOO_LOW'],
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
    '到达友方据点 = 入驻据守（合并守军）；到达敌方 / 中立据点 = 自动开战（有城墙的据点按守城战），胜方幸存部队留守、据点易手。行军中不能再次下令。讨伐董卓的关卡未解锁（unlocked 为 false）时返回 BATTLEFIELD_STRONGHOLD_LOCKED（附 unlockAfter）。',
  requestFields: [
    { name: 'squadId', type: 'string', desc: '必填。队伍 id。' },
    { name: 'strongholdId', type: 'string', desc: '可选（与 x / y 二选一）。目标据点 id；同时给 x / y 时必须与据点坐标一致，否则 BATTLEFIELD_TARGET_INVALID。' },
    { name: 'x', type: 'number', desc: '可选。目标横坐标（0..29）；只在没有 strongholdId 时使用，且必须与 y 同时给。' },
    { name: 'y', type: 'number', desc: '可选。目标纵坐标（0..29）；只在没有 strongholdId 时使用。' },
  ],
  dataFields: STATE_DATA_FIELDS,
  errors: ['INVALID_PARAMS', 'BATTLEFIELD_NOT_ACTIVE', 'BATTLEFIELD_SQUAD_NOT_FOUND', 'BATTLEFIELD_SQUAD_BUSY', 'BATTLEFIELD_UNREACHABLE', 'BATTLEFIELD_TARGET_INVALID', 'BATTLEFIELD_STRONGHOLD_LOCKED'],
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
  summary: `用战场军功换东西（军功跨场累积、换季清零；每场限购，见 GET_BATTLEFIELD 的 shop.items）：${SHOP_TEXT}。赤壁场次另有 铁骑兵 ${BATTLEFIELD_SHOP_CHIBI.find((def) => def.item === 'iron_cavalry')?.cost ?? 800} 军功（直接进主城，每场限 1 次）。兑换即时到账（资源包进主城、兵直接进主城驻军、武将经验给指定武将），不占队列。`,
  requestFields: [
    { name: 'item', type: "'resources' | 'hero_exp' | 'swordsman' | 'cavalry' | 'iron_cavalry'", desc: '必填。商品（iron_cavalry 仅赤壁场次可买）。' },
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
  title: '推送：剧本战场报名 / 开战 / 据点易手 / 收场 / 赤壁风向（v75，AISLG-198；v80）',
  summary: '报名开始、开战、据点易手（含大营被攻破、火攻 / 连锁）、战场收场，以及赤壁风向切换与切换前 30 分钟预告时推给全部在线连接；载荷里的 event 与 GET_BATTLEFIELD 的 event 同结构。',
  dataFields: [
    { name: 'reason', type: "'signup' | 'started' | 'stronghold' | 'finished' | 'wind'", desc: '报名 / 开战 / 据点易手（含火攻、连锁） / 收场 / 风向（赤壁切换或预告）。' },
    { name: 'event', type: 'object', desc: '战场视图（结构同 GET_BATTLEFIELD 的 event）。' },
    { name: 'strongholdId', type: 'string', desc: 'reason=stronghold 时易手的据点 id。' },
  ],
  examples: [{ op: Op.PUSH_BATTLEFIELD_STATE, push: true, data: { reason: 'stronghold', event: EVENT_VIEW, strongholdId: 'ford_yanjin' } }],
  agentNote: '推送只带事件摘要与据点 id，收到后重查 GET_BATTLEFIELD 拿完整据点守军、自己的队伍与军功。漏收时定时重查即可。',
};

// ---- v80（AISLG-199）：赤壁据点技能 ----

const CHIBI_FIRE_EXAMPLE_STRONGHOLD = {
  ...STRONGHOLD_VIEW,
  id: 'cao_2',
  name: '曹操据点·巴丘',
  ownerCamp: 'cao',
  x: 23,
  y: 15,
  garrison: { ...STRONGHOLD_VIEW.garrison, militia: 96, archer: 48 },
  garrisonPower: 560,
  chainUntil: null,
  fireNextAt: new Date(START_MS + 2 * 3_600_000).toISOString(),
  unlocked: true,
} as const;

export const REQUEST_FIRE_BATTLEFIELD_STRONGHOLD: RequestOpDoc = {
  kind: 'request',
  name: 'FIRE_BATTLEFIELD_STRONGHOLD',
  title: '赤壁火攻（v80，AISLG-199）',
  preAuth: false,
  summary:
    `仅赤壁场次、孙刘方（me.camp = yuan）、已入场，并且当前风向为东南风（event.wind.direction = se）时可用：花 ${BATTLEFIELD_FIRE_MERIT_COST} 军功，火攻一座曹方据点（ownerCamp = cao）。` +
    `目标必须与己方据点相邻（曼哈顿距离 ≤ ${BATTLEFIELD_NEIGHBOR_DISTANCE}）。效果立即结算：对守军造成总生命 ${BATTLEFIELD_FIRE_HP_RATIO * 100}% 的伤害（目标处于连锁战船期间为 ${BATTLEFIELD_FIRE_HP_RATIO * BATTLEFIELD_CHAIN_FIRE_MULTIPLIER * 100}%）；` +
    '伤害按各兵种生命比例写入据点余伤池，整单位折算阵亡，阵亡按 NPC 守军与据守队伍的占比分摊。同一目标每 2 小时最多被火攻一次（冷却 fireNextAt）。火攻不计军功，也不改变归属，要靠后续攻打夺下据点。',
  requestFields: [{ name: 'strongholdId', type: 'string', desc: '必填。目标曹方据点 id。' }],
  dataFields: STATE_DATA_FIELDS,
  errors: [
    'INVALID_PARAMS',
    'BATTLEFIELD_NOT_ACTIVE',
    'BATTLEFIELD_SKILL_UNAVAILABLE',
    'BATTLEFIELD_NOT_JOINED',
    'BATTLEFIELD_NOT_ENTERED',
    'BATTLEFIELD_WIND_MISMATCH',
    'BATTLEFIELD_TARGET_INVALID',
    'BATTLEFIELD_FIRE_COOLDOWN',
    'BATTLEFIELD_MERIT_INSUFFICIENT',
  ],
  examples: [
    {
      caption: '东南风期间火攻相邻的巴丘据点',
      request: { op: Op.FIRE_BATTLEFIELD_STRONGHOLD, seq: 36, data: { strongholdId: 'cao_2' } },
      responses: [{ op: Op.FIRE_BATTLEFIELD_STRONGHOLD, seq: 36, ok: true, data: { event: EVENT_VIEW, strongholds: [CHIBI_FIRE_EXAMPLE_STRONGHOLD] } }],
    },
  ],
  agentNote: '火攻前先看 event.wind：只有东南风能用，西北风要等下一次切换（event.wind.nextAt）。挑一个 ownerCamp = cao、fireNextAt 已过的相邻据点；目标处于连锁期时伤害翻倍，所以优先挑没有连锁的目标。每次 300 军功，冷却中的目标别反复尝试。',
};

export const REQUEST_CHAIN_BATTLEFIELD_STRONGHOLD: RequestOpDoc = {
  kind: 'request',
  name: 'CHAIN_BATTLEFIELD_STRONGHOLD',
  title: '赤壁连锁战船（v80，AISLG-199）',
  preAuth: false,
  summary:
    `仅赤壁场次、曹操军（me.camp = cao）、已入场可用：花 ${BATTLEFIELD_CHAIN_MERIT_COST} 军功，给一座己方据点（ownerCamp = cao）连锁 ${BATTLEFIELD_CHAIN_MS / 3_600_000} 小时（chainUntil）：` +
    `该据点守军受到的伤害 −${BATTLEFIELD_CHAIN_DEFENSE_PERCENT}%，但被火攻时伤害翻倍。连锁期间不能重复连锁（BATTLEFIELD_CHAIN_ACTIVE）；据点易手后连锁立即失效。`,
  requestFields: [{ name: 'strongholdId', type: 'string', desc: '必填。己方据点 id。' }],
  dataFields: STATE_DATA_FIELDS,
  errors: [
    'INVALID_PARAMS',
    'BATTLEFIELD_NOT_ACTIVE',
    'BATTLEFIELD_SKILL_UNAVAILABLE',
    'BATTLEFIELD_NOT_JOINED',
    'BATTLEFIELD_NOT_ENTERED',
    'BATTLEFIELD_TARGET_INVALID',
    'BATTLEFIELD_CHAIN_ACTIVE',
    'BATTLEFIELD_MERIT_INSUFFICIENT',
  ],
  examples: [
    {
      caption: '给江陵据点连锁战船',
      request: { op: Op.CHAIN_BATTLEFIELD_STRONGHOLD, seq: 37, data: { strongholdId: 'cao_1' } },
      responses: [{ op: Op.CHAIN_BATTLEFIELD_STRONGHOLD, seq: 37, ok: true, data: { event: EVENT_VIEW, strongholds: [{ ...CHIBI_FIRE_EXAMPLE_STRONGHOLD, id: 'cao_1', name: '曹操据点·江陵', x: 23, y: 5, chainUntil: new Date(START_MS + 6 * 3_600_000).toISOString(), fireNextAt: null }] } }],
    },
  ],
  agentNote: '连锁适合在孙刘方准备火攻前先给要守的据点加一层防护：连锁期间正面战斗更耐打，但一旦被火攻伤害会翻倍，所以要结合风向和对面相邻据点判断。',
};