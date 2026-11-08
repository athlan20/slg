// 五方势力（AISLG-239，v99）的规则与数值：五家的名字 / 首领 / 老巢、按本季天数变化的范围半径、
// 重叠格的归属判定、老巢落位保护半径、势力城守军与库存的倍率。纯函数，不碰数据库与协议运行时，
// API（地块视图 / 出征校验 / 迁城校验 / 面板）与 Worker（吞城定时器）共用，两侧不得各算一套。
// 数据库读写见 faction-db.ts，开关见 faction-config.ts；本张单只做势力本身——不出兵打玩家、
// 不围攻（AISLG-240）。攻破老巢、势力灭亡见 faction-lair.ts（AISLG-241）。
//
// 数值来源（需求 AISLG-239「数值是怎么定的」）：老巢放在比名城锚点更靠角落的 80 / 920 上，
// 与最近的名城锚点相距约 86 格；半径 100 / 150 / 200 / 250 对应五天覆盖 17.1% / 30.3% / 47.6% / 66.2%；
// 开季 25 格方块（51×51）按 NPC 城密度约 39 座，一季每家约 151 座（25 格开季 + 每 6 小时 1 座）。

import { RESOURCE_KEYS, TROOP_KINDS, type Resources, type TroopKind } from './protocol';
import { type FactionKey } from './protocol-faction';
import { getTimeScale } from './time-scale';
import type { NpcCitySnapshot } from './world';

/** 一家的定义（老巢坐标固定在代码常量里：换季重新生成世界时按它放老巢） */
export interface FactionDef {
  key: FactionKey;
  /** 中文名（对外文档与前端中文界面共用） */
  name: string;
  /** 英文名（需求表给定） */
  nameEn: string;
  /** 首领中文名 */
  leader: string;
  /** 首领英文名（英文界面用） */
  leaderEn: string;
  /** 老巢坐标 */
  lair: { x: number; y: number };
}

/**
 * 五方势力（顺序即需求表从上到下：也是范围重叠且距离相同时的归属顺序）。
 * 老巢都在平原 / 草原之外也不会落名城：名城锚点在地图的 1/6 与 5/6 处（约 166 / 833），
 * 老巢更靠角落，与最近锚点相距约 86 格。
 */
export const FACTIONS: readonly FactionDef[] = [
  { key: 'liangzhou', name: '凉州军', nameEn: 'Liangzhou Rebels', leader: '韩遂', leaderEn: 'Han Sui', lair: { x: 80, y: 80 } },
  { key: 'wuhuan', name: '乌桓', nameEn: 'Wuhuan', leader: '蹋顿', leaderEn: 'Tadun', lair: { x: 920, y: 80 } },
  { key: 'nanman', name: '南蛮', nameEn: 'Nanman', leader: '孟获', leaderEn: 'Meng Huo', lair: { x: 80, y: 920 } },
  { key: 'shanyue', name: '山越', nameEn: 'Shanyue', leader: '费栈', leaderEn: 'Fei Zhan', lair: { x: 920, y: 920 } },
  { key: 'heishan', name: '黑山军', nameEn: 'Heishan Army', leader: '张燕', leaderEn: 'Zhang Yan', lair: { x: 500, y: 500 } },
];

/** 按标识取一家（未知标识返回 null；数据库里的脏值不应让视图崩掉） */
export function factionDefOf(key: string | null | undefined): FactionDef | null {
  if (!key) {
    return null;
  }
  return FACTIONS.find((def) => def.key === key) ?? null;
}

/**
 * 一家的旗号（v100，AISLG-240）：袭击 / 围攻的预警、事件与战报文案里用它标「是谁在打你」。
 * 未知标识返回 null——调用方按「没有旗号」处理（与上线前的普通 NPC 行为一致）。
 */
export interface FactionBannerView {
  key: FactionKey;
  name: string;
  nameEn: string;
}

export function factionBannerOf(key: string | null | undefined): FactionBannerView | null {
  const def = factionDefOf(key);
  return def ? { key: def.key, name: def.name, nameEn: def.nameEn } : null;
}

/** 一家的中文名（未知标识给通用名「势力」，用于战报 / 事件文案兜底） */
export function factionNameOf(key: string | null | undefined): string {
  return factionDefOf(key)?.name ?? '势力';
}

/** 一家的定义（已知合法标识时用；调用方保证 key 来自 FACTION_KEYS） */
export function factionDef(key: FactionKey): FactionDef {
  const def = factionDefOf(key);
  if (!def) {
    throw new Error(`unknown faction: ${key}`);
  }
  return def;
}

// ---- 老巢落位保护 ----

/** 老巢周围多少格内不放玩家（切比雪夫距离）：注册落位与迁城都要避开，老巢本身也在其中 */
export const FACTION_LAIR_CLEAR_RADIUS = 5;

/** 两点间的切比雪夫距离（势力范围、老巢保护与出征距离同口径） */
export function chebyshevDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 该格是否落在某家老巢的保护范围内（含老巢本身）：注册落位 / 迁城都不得落到这里 */
export function inFactionLairClearance(x: number, y: number): boolean {
  return FACTIONS.some((def) => chebyshevDistance(def.lair, { x, y }) <= FACTION_LAIR_CLEAR_RADIUS);
}

/** 该格是哪家的老巢（不是老巢返回 null） */
export function factionLairAt(x: number, y: number): FactionDef | null {
  return FACTIONS.find((def) => def.lair.x === x && def.lair.y === y) ?? null;
}

// ---- 势力范围：半径随本季天数变大 ----

/** 本季第 1 天起算的天数时长（真实时间，**不随 time_scale 变化**） */
export const FACTION_SEASON_DAY_MS = 24 * 60 * 60 * 1000;

/** 开季时直接吞下的范围半径（老巢周围 25 格内的 NPC 城全部归该势力） */
export const FACTION_INITIAL_RADIUS = 25;

/** 半径档位：本季天数 ≥ fromDay 时取该档（第 1~7 天 100、8~14 天 150、15~21 天 200、22 天起 250） */
export const FACTION_RADIUS_STEPS: ReadonlyArray<{ fromDay: number; radius: number }> = [
  { fromDay: 1, radius: 100 },
  { fromDay: 8, radius: 150 },
  { fromDay: 15, radius: 200 },
  { fromDay: 22, radius: 250 },
];

/** 本季第几天（1 起算；按本季实际开始时间，与 time_scale 无关；开始前按第 1 天算） */
export function factionDayAt(seasonStart: Date, now: Date): number {
  const elapsed = now.getTime() - seasonStart.getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 1;
  }
  return Math.floor(elapsed / FACTION_SEASON_DAY_MS) + 1;
}

/** 第 day 天的势力范围半径（格，切比雪夫距离） */
export function factionRadiusForDay(day: number): number {
  let radius = FACTION_RADIUS_STEPS[0].radius;
  for (const step of FACTION_RADIUS_STEPS) {
    if (day >= step.fromDay) {
      radius = step.radius;
    }
  }
  return radius;
}

/** 当前时刻的势力范围半径（天数按本季实际开始时间算） */
export function factionRadiusAt(seasonStart: Date, now: Date): number {
  return factionRadiusForDay(factionDayAt(seasonStart, now));
}

/**
 * 这一格当前归哪家：在某家老巢的半径方块内、且离那家最近的一家；
 * 距离相同时按 FACTIONS 顺序取先出现的一家（需求「两家范围重叠的格，归离老巢更近的一家」）。
 * 五家范围之外的格返回 null。地图上色与吞城范围共用这一判定。
 * v101（AISLG-241）：本季已灭亡的势力不占地盘——最近的是灭亡势力时返回 null（不落到第二近的一家，
 * 需求「其他势力的范围不因此扩大」）。isDestroyed 缺省视为都没灭亡（与 AISLG-240 一致）。
 */
export function factionAt(
  x: number,
  y: number,
  radius: number,
  isDestroyed?: (key: FactionKey) => boolean,
): FactionKey | null {
  let best: FactionKey | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const def of FACTIONS) {
    const distance = chebyshevDistance(def.lair, { x, y });
    if (distance <= radius && distance < bestDistance) {
      best = def.key;
      bestDistance = distance;
    }
  }
  if (best && isDestroyed?.(best)) {
    return null;
  }
  return best;
}

/**
 * 「这格归这家」的 SQL 条件（与 factionAt 的重叠判定同口径）：离这家老巢比离其他老巢都近，
 * 距离相同时表里靠前的一家优先。tileX / tileY 是列名，坐标都是代码常量，直接内联。
 */
export function factionOwnsTileSql(key: FactionKey, tileX = 'x', tileY = 'y'): string {
  const distanceTo = (def: FactionDef): string =>
    `GREATEST(ABS(${tileX} - ${def.lair.x}), ABS(${tileY} - ${def.lair.y}))`;
  const index = FACTIONS.findIndex((def) => def.key === key);
  const own = distanceTo(FACTIONS[index]);
  return FACTIONS.filter((def) => def.key !== key)
    .map((def) => `${own} ${FACTIONS.indexOf(def) < index ? '<' : '<='} ${distanceTo(def)}`)
    .join(' AND ');
}

// ---- 势力城：守军与库存 1.5 倍 ----

/** 势力城的守军与可掠夺库存相对同等级普通 NPC 城的倍率 */
export const FACTION_CITY_MULTIPLIER = 1.5;

/**
 * 把一座普通 NPC 城变成某家的势力城：守军与库存 × 1.5（逐兵种 / 逐资源四舍五入，正值至少 1），
 * 并在快照上记下这个势力标识。调用方保证这座城还没有势力归属（否则会重复放大）。
 * 归属写在 NPC 快照里：玩家占下这座城时地块转为城池、快照清空，势力归属自然消失；
 * 掠夺 / 占领 / 侦察的守军与库存都读同一份快照，倍数因此在这三条路径上同时生效。
 */
export function factionSnapshot(npc: NpcCitySnapshot, key: FactionKey): NpcCitySnapshot {
  const scale = (count: number): number => (count > 0 ? Math.max(1, Math.round(count * FACTION_CITY_MULTIPLIER)) : 0);
  const garrison: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = npc.garrison?.[kind] ?? 0;
    if (count > 0) {
      garrison[kind] = scale(count);
    }
  }
  const stock: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const constKey of RESOURCE_KEYS) {
    stock[constKey] = scale(npc.stock?.[constKey] ?? 0);
  }
  return { ...npc, garrison, stock, faction: key };
}

/**
 * 势力灭亡时把势力城变回普通 NPC 城（v101，AISLG-241「势力城全部变回普通 NPC 城」）：
 * - 普通的势力城：守军与库存按 1.5 倍放大过，这里除回去（向下取整、正值至少 1），去掉归属；
 * - 被吞的玩家分城（快照带 fromPlayer）：建筑与库存原样保留，只去掉归属。
 */
export function undoFactionSnapshot(npc: NpcCitySnapshot): NpcCitySnapshot {
  const { faction: _faction, fromPlayer, ...rest } = npc;
  if (fromPlayer) {
    return { ...rest };
  }
  const unscale = (count: number): number => (count > 0 ? Math.max(1, Math.round(count / FACTION_CITY_MULTIPLIER)) : 0);
  const garrison: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = npc.garrison?.[kind] ?? 0;
    if (count > 0) {
      garrison[kind] = unscale(count);
    }
  }
  const stock: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const constKey of RESOURCE_KEYS) {
    stock[constKey] = unscale(npc.stock?.[constKey] ?? 0);
  }
  return { ...rest, garrison, stock };
}

// ---- 吞城节奏 ----

/** 每家吞一座城的基准间隔：6 小时（随全局时间缩放） */
export const FACTION_SWALLOW_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 吞城间隔（毫秒，已按 time_scale 缩放；不低于 1 秒） */
export function factionSwallowIntervalMs(scale: number = getTimeScale()): number {
  return Math.max(1000, Math.round(FACTION_SWALLOW_INTERVAL_MS / Math.max(1, scale)));
}
