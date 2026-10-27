// 剧本战场（v75，AISLG-198）的规则与数值：官渡之战。
// 只取旧游戏「剧本战场」的玩法结构（定时开放、选阵营、独立小战场、抢据点、军功与战场商店），
// 所有数值为占位，上线后按数据调整；调整需同步 backend/test/battlefield.test.ts 与协议文档。
//
// 全部时间按现实时间（北京时间），不随全局 timeScale 缩放——需求明确要求 24 小时内
// 有攻守往返的节奏，战场行军每格固定 60 秒。

import type { Resources } from './protocol';
import type { BattlefieldScript } from './protocol-battlefield';
import type { ArmyCounts, TroopKind } from './protocol-army';
import { TROOP_KINDS } from './protocol';
import { armyPower, toFullArmyCounts } from './battle';
import { TROOP_INFO } from './troops';
import { TROOP_STATS } from './battle-engine';

// ---- 日程（北京时间） ----

/** 报名开始：每周二 20:00（北京时间） */
export const BATTLEFIELD_SIGNUP_WEEKDAY = 2;
export const BATTLEFIELD_SIGNUP_HOUR = 20;
/** 报名持续 24 小时：周三 20:00 开战 */
export const BATTLEFIELD_SIGNUP_HOURS = 24;
/** 战场持续 24 小时：周四 20:00 结束 */
export const BATTLEFIELD_DURATION_HOURS = 24;

const DAY_MS = 24 * 3_600_000;
const CST_OFFSET_MS = 8 * 3_600_000;

export interface BattlefieldWindow {
  signupStart: Date;
  startAt: Date;
  endAt: Date;
}

/**
 * 当前 / 下一场战场的时间窗（北京时间每周二 20:00 报名、周三 20:00 开战、周四 20:00 结束）。
 * 已过结束时刻则返回下一周；尚未到报名时刻（如周二 19:00）也返回本周尚未开始的那一场。
 */
export function battlefieldWindow(now: Date): BattlefieldWindow {
  // 先把「北京时间」当作 UTC 来读，避免宿主时区影响
  const shifted = new Date(now.getTime() + CST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();
  const weekday = shifted.getUTCDay();
  // 本周二的北京时间 20:00（= UTC 12:00）
  const tuesday = Date.UTC(year, month, date, 12, 0, 0) - ((weekday - BATTLEFIELD_SIGNUP_WEEKDAY + 7) % 7) * DAY_MS;
  let signupStart = tuesday;
  // 已过结束时刻（周四 20:00）→ 下一周
  if (now.getTime() >= signupStart + BATTLEFIELD_SIGNUP_HOURS * 3_600_000 + BATTLEFIELD_DURATION_HOURS * 3_600_000) {
    signupStart += 7 * DAY_MS;
  }
  const startAt = signupStart + BATTLEFIELD_SIGNUP_HOURS * 3_600_000;
  const endAt = startAt + BATTLEFIELD_DURATION_HOURS * 3_600_000;
  return { signupStart: new Date(signupStart), startAt: new Date(startAt), endAt: new Date(endAt) };
}

/** 开战前多久发「即将开战」公告（现实时间） */
export const BATTLEFIELD_START_NOTICE_MS = 3_600_000;

// ---- 地图 ----

/** 战场是 30 × 30 的独立地图，与世界地图完全隔离 */
export const BATTLEFIELD_MAP_SIZE = 30;
/** 中间的河：x = 15 整列不可通行，只有 3 处渡口 */
export const BATTLEFIELD_RIVER_X = 15;
export const BATTLEFIELD_FORD_YS: readonly number[] = [5, 15, 25];
/** 战场行军：每格 60 秒现实时间 */
export const BATTLEFIELD_SECONDS_PER_TILE = 60;
/** 每人最多带入的部队人口 */
export const BATTLEFIELD_ENTRY_POPULATION = 3000;
/** 每人最多拆成几队 */
export const BATTLEFIELD_MAX_SQUADS = 3;

export type BattlefieldCamp = 'yuan' | 'cao';
export type BattlefieldStrongholdKind = 'base' | 'ford' | 'post' | 'granary';

export interface BattlefieldStrongholdDef {
  id: string;
  name: string;
  kind: BattlefieldStrongholdKind;
  x: number;
  y: number;
  /** 每小时给所属阵营的积分 */
  pointsPerHour: number;
  /** 初始 NPC 守军 = 3 级 NPC 城守军 × 本倍数 */
  garrisonMultiplier: number;
  wallLevel: number;
  towerLevel: number;
}

/** 官渡 9 个据点：两个大营、3 个渡口、3 个普通据点、乌巢粮仓 */
export const BATTLEFIELD_STRONGHOLDS: readonly BattlefieldStrongholdDef[] = [
  {
    id: 'yuan_camp', name: '袁绍大营', kind: 'base', x: 2, y: 15,
    pointsPerHour: 0, garrisonMultiplier: 10, wallLevel: 10, towerLevel: 10,
  },
  {
    id: 'cao_camp', name: '曹操大营', kind: 'base', x: 27, y: 15,
    pointsPerHour: 0, garrisonMultiplier: 10, wallLevel: 10, towerLevel: 10,
  },
  {
    id: 'ford_baima', name: '白马渡口', kind: 'ford', x: BATTLEFIELD_RIVER_X, y: 5,
    pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0,
  },
  {
    id: 'ford_yanjin', name: '延津渡口', kind: 'ford', x: BATTLEFIELD_RIVER_X, y: 15,
    pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0,
  },
  {
    id: 'ford_guandu', name: '官渡渡口', kind: 'ford', x: BATTLEFIELD_RIVER_X, y: 25,
    pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0,
  },
  {
    id: 'post_suanzao', name: '酸枣据点', kind: 'post', x: 7, y: 8,
    pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0,
  },
  {
    id: 'post_yangwu', name: '阳武据点', kind: 'post', x: 7, y: 22,
    pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0,
  },
  {
    id: 'post_zhongmou', name: '中牟据点', kind: 'post', x: 22, y: 8,
    pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0,
  },
  {
    id: 'granary_wuchao', name: '乌巢粮仓', kind: 'granary', x: 22, y: 22,
    pointsPerHour: 30, garrisonMultiplier: 4, wallLevel: 0, towerLevel: 0,
  },
] as const;

/** 讨伐董卓：一条推进线，汜水关 → 虎牢关 → 洛阳（前一关打下后下一关才开放） */
export const BATTLEFIELD_DONGZHUO_STRONGHOLDS: readonly BattlefieldStrongholdDef[] = [
  { id: 'suishui', name: '汜水关', kind: 'post', x: 7, y: 15, pointsPerHour: 0, garrisonMultiplier: 15, wallLevel: 10, towerLevel: 10 },
  { id: 'hulao', name: '虎牢关', kind: 'ford', x: 15, y: 15, pointsPerHour: 0, garrisonMultiplier: 40, wallLevel: 15, towerLevel: 15 },
  { id: 'luoyang', name: '洛阳', kind: 'base', x: 23, y: 15, pointsPerHour: 0, garrisonMultiplier: 30, wallLevel: 20, towerLevel: 20 },
] as const;

/** 赤壁：双方各 4 个据点 + 1 座大营（10 个），中间江面只有 3 处渡口可通过 */
export const BATTLEFIELD_CHIBI_STRONGHOLDS: readonly BattlefieldStrongholdDef[] = [
  { id: 'sun_base', name: '孙刘大营', kind: 'base', x: 2, y: 15, pointsPerHour: 0, garrisonMultiplier: 10, wallLevel: 10, towerLevel: 10 },
  { id: 'cao_base', name: '曹操大营', kind: 'base', x: 27, y: 15, pointsPerHour: 0, garrisonMultiplier: 10, wallLevel: 10, towerLevel: 10 },
  { id: 'sun_1', name: '孙刘据点·柴桑', kind: 'post', x: 6, y: 5, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
  { id: 'sun_2', name: '孙刘据点·夏口', kind: 'post', x: 6, y: 15, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
  { id: 'sun_3', name: '孙刘据点·赤壁', kind: 'post', x: 6, y: 25, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
  { id: 'sun_4', name: '孙刘据点·乌林', kind: 'post', x: 11, y: 10, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
  { id: 'cao_1', name: '曹操据点·江陵', kind: 'post', x: 23, y: 5, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
  { id: 'cao_2', name: '曹操据点·巴丘', kind: 'post', x: 23, y: 15, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
  { id: 'cao_3', name: '曹操据点·华容', kind: 'post', x: 23, y: 25, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
  { id: 'cao_4', name: '曹操据点·乌林北', kind: 'post', x: 18, y: 10, pointsPerHour: 10, garrisonMultiplier: 2, wallLevel: 0, towerLevel: 0 },
] as const;

/** 剧本名称与每周轮换顺序：官渡 → 讨伐董卓 → 赤壁 */
export const BATTLEFIELD_SCRIPT_NAMES: Record<BattlefieldScript, string> = {
  guandu: '官渡之战',
  dongzhuo: '讨伐董卓',
  chibi: '赤壁之战',
};

/** 各剧本的阵营显示名（讨董只有讨董联军一方在打，董卓军是 NPC） */
export const BATTLEFIELD_CAMP_NAMES: Record<BattlefieldScript, Record<BattlefieldCamp, string>> = {
  guandu: { yuan: '袁绍军', cao: '曹操军' },
  dongzhuo: { yuan: '讨董联军', cao: '董卓军' },
  chibi: { yuan: '孙刘联军', cao: '曹操军' },
};

export function battlefieldCampName(script: BattlefieldScript, camp: BattlefieldCamp): string {
  return BATTLEFIELD_CAMP_NAMES[script][camp];
}

export const BATTLEFIELD_SCRIPT_ORDER: readonly BattlefieldScript[] = ['guandu', 'dongzhuo', 'chibi'];

/**
 * 轮换锚点：2026-10-27 这一周（报名周二 20:00，即 198 首场所在周）为官渡，之后每周依次讨董、赤壁、官渡……
 * 锚点取在本周而不是上线周，是为了上线前后本周剧本不跳变（上线后三周：官渡 → 讨董 → 赤壁）。
 */
export const BATTLEFIELD_SCRIPT_ANCHOR_MS = Date.parse('2026-10-27T20:00:00+08:00');

/** 报名开始时刻所在的那一周决定剧本（每周一场，周数取模轮换） */
export function battlefieldScriptForSignupStart(signupStart: Date): BattlefieldScript {
  const weeks = Math.round((signupStart.getTime() - BATTLEFIELD_SCRIPT_ANCHOR_MS) / (7 * DAY_MS));
  const size = BATTLEFIELD_SCRIPT_ORDER.length;
  return BATTLEFIELD_SCRIPT_ORDER[((weeks % size) + size) % size];
}

export function battlefieldScriptForWindow(window: BattlefieldWindow): BattlefieldScript {
  return battlefieldScriptForSignupStart(window.signupStart);
}

/** 下一周的剧本（用于报名公告里预告） */
export function battlefieldNextScript(window: BattlefieldWindow): BattlefieldScript {
  return battlefieldScriptForSignupStart(new Date(window.signupStart.getTime() + 7 * DAY_MS));
}

export function battlefieldStrongholds(script: BattlefieldScript): readonly BattlefieldStrongholdDef[] {
  if (script === 'dongzhuo') {
    return BATTLEFIELD_DONGZHUO_STRONGHOLDS;
  }
  if (script === 'chibi') {
    return BATTLEFIELD_CHIBI_STRONGHOLDS;
  }
  return BATTLEFIELD_STRONGHOLDS;
}

/** 讨董：按顺序解锁（第一个永远开放；后面要求前一个已被讨董联军占领） */
export function battlefieldUnlocked(script: BattlefieldScript, index: number, previousOwner: BattlefieldCamp | null): boolean {
  if (script !== 'dongzhuo') {
    return true;
  }
  return index === 0 || previousOwner === 'yuan';
}

// ---- 赤壁风向 ----

export const BATTLEFIELD_WIND_MS = 6 * 3_600_000;
export const BATTLEFIELD_WIND_NOTICE_MS = 30 * 60 * 1000;
export type BattlefieldWind = 'se' | 'nw';

export function battlefieldWindLabel(wind: BattlefieldWind): string {
  return wind === 'se' ? '东南风' : '西北风';
}

/** 顺风阵营：东南风利孙刘（yuan），西北风利曹操（cao） */
export function battlefieldWindBonusCamp(wind: BattlefieldWind): BattlefieldCamp {
  return wind === 'se' ? 'yuan' : 'cao';
}

/** 顺风方远程兵种与床弩射程 +%（走科技乘数的射程入口，AISLG-192） */
export const BATTLEFIELD_WIND_RANGE_PERCENT = 10;

export function battlefieldFlipWind(wind: BattlefieldWind): BattlefieldWind {
  return wind === 'se' ? 'nw' : 'se';
}

/** 开战时的初始风向（随机源可注入，测试用固定序列） */
export function battlefieldInitialWind(random: () => number = Math.random): BattlefieldWind {
  return random() < 0.5 ? 'se' : 'nw';
}

/**
 * 到点推进风向：每过 6 小时交替一次，返回推进后的风向与下次切换时刻。
 * 若 Worker 停了很久，会一次性补齐到 now 之后的第一个切换点（风向只交替，不跳过）。
 */
export function battlefieldAdvanceWind(
  wind: BattlefieldWind,
  nextAt: Date,
  now: Date,
): { wind: BattlefieldWind; nextAt: Date; switched: boolean } {
  let current = wind;
  let next = nextAt.getTime();
  let switched = false;
  while (now.getTime() >= next) {
    current = battlefieldFlipWind(current);
    next += BATTLEFIELD_WIND_MS;
    switched = true;
  }
  return { wind: current, nextAt: new Date(next), switched };
}

/** 风向对阵营的射程加成（科技乘数入口）：顺风方 +10%，逆风方与 NPC 无加成 */
export function battlefieldWindTech(wind: BattlefieldWind, camp: BattlefieldCamp): { rangedRangePercent: number } | null {
  return battlefieldWindBonusCamp(wind) === camp ? { rangedRangePercent: BATTLEFIELD_WIND_RANGE_PERCENT } : null;
}

// ---- 赤壁据点技能：火攻 / 连锁战船 ----

/** 火攻（孙刘方、东南风期间）：花费军功、对与己方据点相邻的曹方据点 */
export const BATTLEFIELD_FIRE_MERIT_COST = 300;
/** 火攻伤害 = 目标守军总生命的比例（连锁战船期间翻倍） */
export const BATTLEFIELD_FIRE_HP_RATIO = 0.2;
export const BATTLEFIELD_FIRE_COOLDOWN_MS = 2 * 3_600_000;
/** 相邻 = 曼哈顿距离不超过该值（地图 30×30，据点之间约 10 格以内视为相邻） */
export const BATTLEFIELD_NEIGHBOR_DISTANCE = 10;

/** 连锁战船（曹方）：花费军功、给己方据点连锁 6 小时 */
export const BATTLEFIELD_CHAIN_MERIT_COST = 200;
export const BATTLEFIELD_CHAIN_MS = 6 * 3_600_000;
/** 连锁期间守军受到的伤害 −% */
export const BATTLEFIELD_CHAIN_DEFENSE_PERCENT = 15;
/** 连锁期间被火攻的伤害倍数（20% → 40%） */
export const BATTLEFIELD_CHAIN_FIRE_MULTIPLIER = 2;

/** 火攻伤害占守军总生命的比例（连锁战船期间翻倍） */
export function battlefieldFireHpRatio(chained: boolean): number {
  return chained ? BATTLEFIELD_FIRE_HP_RATIO * BATTLEFIELD_CHAIN_FIRE_MULTIPLIER : BATTLEFIELD_FIRE_HP_RATIO;
}

export function battlefieldChainActive(chainUntil: Date | null, now: Date): boolean {
  return chainUntil !== null && chainUntil.getTime() > now.getTime();
}

/** 火攻冷却是否已过（fireNextAt 为空表示从未被火攻） */
export function battlefieldFireReady(fireNextAt: Date | null, now: Date): boolean {
  return fireNextAt === null || fireNextAt.getTime() <= now.getTime();
}

/** 风向预告是否到点：距下次切换不足 30 分钟，且本轮还没预告过 */
export function battlefieldWindNoticeDue(nextAt: Date, now: Date, noticed: boolean): boolean {
  return !noticed && now.getTime() >= nextAt.getTime() - BATTLEFIELD_WIND_NOTICE_MS;
}

export function battlefieldNeighbors(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= BATTLEFIELD_NEIGHBOR_DISTANCE;
}

/**
 * 火攻结算：按各兵种「单兵生命 × 数量」占总生命的比例（即 ratio × 该兵种总生命）写入余伤池，
 * 整单位折算阵亡，余数留在池里等下一次火攻继续累计。返回各兵种阵亡数与新的余伤池。
 */
export function battlefieldFireDamage(
  garrison: Partial<Record<TroopKind, number>>,
  wounds: Partial<Record<TroopKind, number>>,
  ratio: number,
): { kills: Partial<Record<TroopKind, number>>; wounds: Partial<Record<TroopKind, number>> } {
  const kills: Partial<Record<TroopKind, number>> = {};
  const nextWounds: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = Math.max(0, Math.floor(garrison[kind] ?? 0));
    if (count <= 0) {
      continue;
    }
    const hp = TROOP_STATS[kind].hp;
    let pool = Math.max(0, Number(wounds[kind] ?? 0)) + ratio * count * hp;
    const down = Math.min(count, Math.floor(pool / hp));
    pool -= down * hp;
    if (down >= count) {
      pool = 0;
    }
    // 去掉浮点噪声（余伤只保留到千分位，写库稳定）
    pool = Math.round(pool * 1000) / 1000;
    if (down > 0) {
      kills[kind] = down;
    }
    if (pool > 0) {
      nextWounds[kind] = pool;
    }
  }
  return { kills, wounds: nextWounds };
}

// ---- 讨伐董卓：全服合作 ----

/** 虎牢关守将吕布（NPC，不发放）：攻击 +20%、减伤 −20%（沿用武将加成口径） */
export const BATTLEFIELD_LVBU_BONUS = { atkPercent: 20, defPercent: 20 } as const;

/** 讨董合作奖励档位（全员按最远进度领一档，军功 > 0 才能领；个人名次额外奖励与官渡相同） */
export const BATTLEFIELD_DONGZHUO_TIERS: readonly { progress: number; label: string; gold: number; resourcesEach: number }[] = [
  { progress: 1, label: '破汜水关', gold: 1000, resourcesEach: 5000 },
  { progress: 2, label: '破虎牢关', gold: 2000, resourcesEach: 10000 },
  { progress: 3, label: '攻下洛阳', gold: 4000, resourcesEach: 20000 },
] as const;

/** 讨董进度 = 已打下的关卡数（汜水关 → 虎牢关 → 洛阳，顺序解锁所以就是前缀长度） */
export function battlefieldDongzhuoProgress(owners: Readonly<Record<string, BattlefieldCamp | null | undefined>>): number {
  const order = BATTLEFIELD_DONGZHUO_STRONGHOLDS.map((def) => def.id);
  let progress = 0;
  for (const id of order) {
    if (owners[id] !== 'yuan') {
      break;
    }
    progress += 1;
  }
  return progress;
}

export function battlefieldDongzhuoTier(progress: number): Resources {
  const tier = [...BATTLEFIELD_DONGZHUO_TIERS].reverse().find((item) => progress >= item.progress);
  if (!tier) {
    return { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  }
  return { gold: tier.gold, wood: tier.resourcesEach, food: tier.resourcesEach, stone: tier.resourcesEach, iron: tier.resourcesEach };
}

/** 赤壁入场门槛：爵位大夫（nobility.ts 序号 3）；爵位系统上线后才生效 */
export const BATTLEFIELD_CHIBI_NOBILITY_INDEX = 3;

/** 3 级 NPC 城守军（参考战力约 646）：义兵 100、刀盾兵 30、弓箭兵 40、轻骑兵 12 */
export const BATTLEFIELD_NPC_CITY_GARRISON: Readonly<Partial<Record<TroopKind, number>>> = {
  militia: 100,
  swordsman: 30,
  archer: 40,
  cavalry: 12,
};

/** 守军随报名人数加厚：倍数 = max(1, 报名人数 ÷ 20)；讨董关卡守军更厚，按 ÷ 10 */
export const BATTLEFIELD_GARRISON_PER_PLAYERS = 20;
export const BATTLEFIELD_DONGZHUO_GARRISON_PER_PLAYERS = 10;

export function battlefieldGarrisonPlayerMultiplier(signups: number, script: BattlefieldScript = 'guandu'): number {
  const per = script === 'dongzhuo' ? BATTLEFIELD_DONGZHUO_GARRISON_PER_PLAYERS : BATTLEFIELD_GARRISON_PER_PLAYERS;
  return Math.max(1, Math.max(0, signups) / per);
}

/** 某据点的初始 NPC 守军（含报名人数加厚倍数；四舍五入、非零兵种至少 1） */
export function battlefieldInitialGarrison(
  def: Pick<BattlefieldStrongholdDef, 'garrisonMultiplier'>,
  playerMultiplier = 1,
): ArmyCounts {
  const base = {} as ArmyCounts;
  const scale = def.garrisonMultiplier * Math.max(1, playerMultiplier);
  for (const kind of TROOP_KINDS) {
    const count = BATTLEFIELD_NPC_CITY_GARRISON[kind] ?? 0;
    base[kind] = count > 0 ? Math.max(1, Math.round(count * scale)) : 0;
  }
  return base;
}

/** 地图坐标是否可通行（河只有渡口能过；坐标越界不可通行） */
export function battlefieldPassable(x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return false;
  }
  if (x < 0 || y < 0 || x >= BATTLEFIELD_MAP_SIZE || y >= BATTLEFIELD_MAP_SIZE) {
    return false;
  }
  if (x === BATTLEFIELD_RIVER_X && !BATTLEFIELD_FORD_YS.includes(y)) {
    return false;
  }
  return true;
}

/**
 * 战场最短路径步数（四方向 BFS；河与越界不可走）。返回 null = 不可达。
 * 行军时长 = 步数 × 60 秒（起点即终点为 0）。
 */
export function battlefieldPathSteps(fromX: number, fromY: number, toX: number, toY: number): number | null {
  if (!battlefieldPassable(fromX, fromY) || !battlefieldPassable(toX, toY)) {
    return null;
  }
  if (fromX === toX && fromY === toY) {
    return 0;
  }
  const size = BATTLEFIELD_MAP_SIZE;
  const dist = new Int32Array(size * size).fill(-1);
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;
  const start = fromY * size + fromX;
  const goal = toY * size + toX;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++];
    const cx = current % size;
    const cy = (current - cx) / size;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!battlefieldPassable(nx, ny)) {
        continue;
      }
      const next = ny * size + nx;
      if (dist[next] !== -1) {
        continue;
      }
      dist[next] = dist[current] + 1;
      if (next === goal) {
        return dist[next];
      }
      queue[tail++] = next;
    }
  }
  return null;
}

/** 行军时长（毫秒，现实时间）：步数 × 60 秒 */
export function battlefieldMarchMs(steps: number): number {
  return Math.max(0, Math.floor(steps)) * BATTLEFIELD_SECONDS_PER_TILE * 1000;
}

/** 入场部队人口 = Σ 数量 × 单兵人口（铁骑兵 3、辎重车 6……） */
export function battlefieldEntryPopulation(troops: Partial<Record<TroopKind, number>>): number {
  let population = 0;
  for (const kind of TROOP_KINDS) {
    const count = Math.max(0, Math.floor(troops[kind] ?? 0));
    population += count * TROOP_INFO[kind].population;
  }
  return population;
}

// ---- 军功与胜负 ----

/** 首次打下某个据点的额外军功 */
export const BATTLEFIELD_FIRST_CAPTURE_MERIT = 200;
/** 人少补偿：开战时少方人数 < 多方 × 本比例时触发 */
export const BATTLEFIELD_UNDERDOG_RATIO = 0.7;
/** 人少补偿倍率上限 */
export const BATTLEFIELD_UNDERDOG_MAX = 1.5;

export interface BattlefieldUnderdog {
  camp: BattlefieldCamp;
  multiplier: number;
}

/** 开战时按双方人数算人少补偿；差距不足 70% 返回 null */
export function battlefieldUnderdog(yuanCount: number, caoCount: number): BattlefieldUnderdog | null {
  const yuan = Math.max(0, Math.floor(yuanCount));
  const cao = Math.max(0, Math.floor(caoCount));
  if (yuan === 0 || cao === 0) {
    return null;
  }
  const small = Math.min(yuan, cao);
  const large = Math.max(yuan, cao);
  if (small >= large * BATTLEFIELD_UNDERDOG_RATIO) {
    return null;
  }
  return {
    camp: yuan < cao ? 'yuan' : 'cao',
    multiplier: Math.min(BATTLEFIELD_UNDERDOG_MAX, large / small),
  };
}

// ---- 奖励 ----

export const BATTLEFIELD_WIN_REWARD: Readonly<Resources> = { gold: 3000, wood: 15000, food: 15000, stone: 15000, iron: 15000 };
export const BATTLEFIELD_LOSE_REWARD: Readonly<Resources> = { gold: 1000, wood: 5000, food: 5000, stone: 5000, iron: 5000 };

export interface BattlefieldRankRewardTier {
  label: string;
  /** 名次上限（含）；rankTier 的 label 已含区间 */
  maxRank: number;
  gold: number;
  resourcesEach: number;
}

export const BATTLEFIELD_RANK_REWARDS: readonly BattlefieldRankRewardTier[] = [
  { label: '个人军功第 1 名', maxRank: 1, gold: 6000, resourcesEach: 30000 },
  { label: '第 2–3 名', maxRank: 3, gold: 4000, resourcesEach: 20000 },
  { label: '第 4–10 名', maxRank: 10, gold: 2500, resourcesEach: 12000 },
] as const;

/** 名次额外奖励（不在前 10 返回 null） */
export function battlefieldRankReward(rank: number): Resources | null {
  const tier = BATTLEFIELD_RANK_REWARDS.find((item) => rank >= 1 && rank <= item.maxRank);
  if (!tier) {
    return null;
  }
  return { gold: tier.gold, wood: tier.resourcesEach, food: tier.resourcesEach, stone: tier.resourcesEach, iron: tier.resourcesEach };
}

/** 一场战场的完整奖励：基础（胜 / 败）+ 名次额外（前 10） */
export function battlefieldRewardFor(rank: number | null, won: boolean): Resources {
  const base = won ? BATTLEFIELD_WIN_REWARD : BATTLEFIELD_LOSE_REWARD;
  const extra = rank === null ? null : battlefieldRankReward(rank);
  return {
    gold: base.gold + (extra?.gold ?? 0),
    wood: base.wood + (extra?.wood ?? 0),
    food: base.food + (extra?.food ?? 0),
    stone: base.stone + (extra?.stone ?? 0),
    iron: base.iron + (extra?.iron ?? 0),
  };
}

/** 按剧本结算：官渡 / 赤壁按胜负；讨董按全服进度档（无胜败），两者都再加名次额外奖励 */
export function battlefieldRewardForScript(
  script: BattlefieldScript,
  rank: number | null,
  won: boolean,
  progress: number,
): Resources {
  if (script !== 'dongzhuo') {
    return battlefieldRewardFor(rank, won);
  }
  const team = battlefieldDongzhuoTier(progress);
  const extra = rank === null ? null : battlefieldRankReward(rank);
  return {
    gold: team.gold + (extra?.gold ?? 0),
    wood: team.wood + (extra?.wood ?? 0),
    food: team.food + (extra?.food ?? 0),
    stone: team.stone + (extra?.stone ?? 0),
    iron: team.iron + (extra?.iron ?? 0),
  };
}

// ---- 战场商店 ----

export interface BattlefieldShopDef {
  item: 'resources' | 'hero_exp' | 'swordsman' | 'cavalry' | 'iron_cavalry';
  label: string;
  /** 价格（军功） */
  cost: number;
  /** 每场限购 */
  limit: number;
  /** 资源包：粮 / 木 / 石 / 铁各多少 */
  resourcesEach?: number;
  /** 武将经验（给指定武将） */
  heroExp?: number;
  troop?: TroopKind;
  count?: number;
}

/** 军功跨场累积、换季清零；价格为占位（100 刀盾兵征募成本约 2.45 万金当量） */
export const BATTLEFIELD_SHOP: readonly BattlefieldShopDef[] = [
  { item: 'resources', label: '资源包', cost: 200, limit: 5, resourcesEach: 10000 },
  { item: 'hero_exp', label: '武将经验', cost: 300, limit: 3, heroExp: 5000 },
  { item: 'swordsman', label: '刀盾兵', cost: 600, limit: 2, troop: 'swordsman', count: 100 },
  { item: 'cavalry', label: '轻骑兵', cost: 600, limit: 2, troop: 'cavalry', count: 50 },
] as const;

/** 赤壁场次额外开放：铁骑兵 20（直接进主城），800 军功，每场限购 1 次 */
export const BATTLEFIELD_SHOP_CHIBI: readonly BattlefieldShopDef[] = [
  ...BATTLEFIELD_SHOP,
  { item: 'iron_cavalry', label: '铁骑兵', cost: 800, limit: 1, troop: 'iron_cavalry', count: 20 },
] as const;

export function battlefieldShopItems(script: BattlefieldScript): readonly BattlefieldShopDef[] {
  return script === 'chibi' ? BATTLEFIELD_SHOP_CHIBI : BATTLEFIELD_SHOP;
}

export function battlefieldShopDef(item: string, script: BattlefieldScript = 'guandu'): BattlefieldShopDef | undefined {
  return battlefieldShopItems(script).find((def) => def.item === item);
}

// ---- 据点守军拆分（玩家据守部队与 NPC 守军共同防守） ----

export interface BattlefieldGarrisonParty {
  id: string;
  troops: Partial<Record<TroopKind, number>>;
}

export interface BattlefieldLossSplit {
  npcLosses: ArmyCounts;
  partyLosses: Map<string, ArmyCounts>;
}

/**
 * 守方伤亡按同兵种「开战数量占比」拆给各玩家据守部队，余数归 NPC。
 * 与盟友协防的拆分口径一致（AISLG-194），保证同一战术在不同战场的记账方式相同。
 */
export function splitBattlefieldDefenderLosses(
  npcGarrison: Partial<Record<TroopKind, number>>,
  parties: readonly BattlefieldGarrisonParty[],
  losses: Partial<Record<TroopKind, number>>,
): BattlefieldLossSplit {
  const npcLosses = {} as ArmyCounts;
  const partyLosses = new Map<string, ArmyCounts>();
  for (const party of parties) {
    partyLosses.set(party.id, toFullArmyCounts({}));
  }
  for (const kind of TROOP_KINDS) {
    const totalLoss = Math.max(0, Math.floor(losses[kind] ?? 0));
    if (totalLoss === 0) {
      npcLosses[kind] = 0;
      continue;
    }
    const npcCount = Math.max(0, Math.floor(npcGarrison[kind] ?? 0));
    let partyTotal = 0;
    for (const party of parties) {
      partyTotal += Math.max(0, Math.floor(party.troops[kind] ?? 0));
    }
    const initial = npcCount + partyTotal;
    if (initial <= 0) {
      npcLosses[kind] = 0;
      continue;
    }
    let assigned = 0;
    for (const party of parties) {
      const count = Math.max(0, Math.floor(party.troops[kind] ?? 0));
      const share = Math.floor((totalLoss * count) / initial);
      const lossesView = partyLosses.get(party.id) as ArmyCounts;
      lossesView[kind] = Math.min(count, share);
      assigned += lossesView[kind];
    }
    npcLosses[kind] = Math.max(0, Math.min(npcCount, totalLoss - assigned));
  }
  return { npcLosses, partyLosses };
}