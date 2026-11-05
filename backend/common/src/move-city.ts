// 城池迁移（AISLG-220，v91）的纯规则：迁城方式与道具、距离、拦截判定、出征限制时长、旧格去向。
// 数据库读写在 move-city-db.ts，事务与协议分发在 api/src/handlers-move-city.ts，本文件不碰数据库。
// 判定顺序即提示优先级：名城 → 军队在外 → 盟友驻军 → 战乱中（对齐老游戏 changeCityPosition 的五条中前四条与战乱）。

import { LEVEL_WEIGHTS, WILDERNESS_LEVEL_MAX } from './world';
import { FAMOUS_CITY_LEVEL } from './famous-city';
import { scaledMs } from './time-scale';
import type { ItemId } from './items';

/** 迁城方式：random 随机迁（迁城令）/ pointing 指定坐标迁（高级迁城令） */
export const MOVE_CITY_MODES = ['random', 'pointing'] as const;
export type MoveCityMode = (typeof MOVE_CITY_MODES)[number];

export function isMoveCityMode(value: unknown): value is MoveCityMode {
  return typeof value === 'string' && (MOVE_CITY_MODES as readonly string[]).includes(value);
}

/** 迁城消耗的道具：random → 迁城令 city_order；pointing → 高级迁城令 city_order_adv（各 1 张） */
export function moveCityItemOf(mode: MoveCityMode): ItemId {
  return mode === 'random' ? 'city_order' : 'city_order_adv';
}

/** 指定坐标迁城后，这座城的出征限制基准时长：12 小时（按全局时间缩放换算） */
export const MOVE_CITY_ATTACK_LOCK_MS = 12 * 60 * 60 * 1000;

/** 指定坐标迁城后出征限制截止时刻 = 当前时刻 + 基准时长 × 时间缩放；调用方传入数据库 now() */
export function moveAttackLockUntil(now: Date): Date {
  return new Date(now.getTime() + scaledMs(MOVE_CITY_ATTACK_LOCK_MS));
}

/** 离他人城池格的最小 Chebyshev 距离：小于它即 MOVE_CITY_TOO_CLOSE（3 格保证中间至少隔 2 格） */
export const MOVE_CITY_MIN_GAP = 3;

/** 旧格去向：主城 → 空野地（wilderness）；分城 → 回归 NPC 城（npc_city） */
export type MoveOldTile = 'wilderness' | 'npc_city';

/** 旧格去向判定：主城变空野地，分城回归 NPC 城（名城不能迁，故不会走到名城分支） */
export function moveOldTileOf(isMain: boolean): MoveOldTile {
  return isMain ? 'wilderness' : 'npc_city';
}

/** 两点的 Chebyshev 距离（迁城事件与预览里的“距离”） */
export function moveDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 指定坐标的目标格是否可迁：无人占领的野地、无 NPC（与注册落位 claimCityTile 的占格条件一致） */
export function moveTileUsable(tile: { kind: string; owner_city_id: string | null; npc: unknown } | null): boolean {
  return tile !== null && tile.kind === 'wilderness' && tile.owner_city_id === null && tile.npc === null;
}

/** 与他人城池的最近距离是否过近（distances 为各他人城池格到目标格的 Chebyshev 距离） */
export function moveTooClose(distances: readonly number[]): boolean {
  return distances.some((d) => d < MOVE_CITY_MIN_GAP);
}

/** 迁城拦截的错误码子集（前四条规则；目标格与令的错误码在 handler 里判） */
export type MoveCityDenialCode =
  | 'MOVE_CITY_FAMOUS'
  | 'MOVE_CITY_ARMY_OUTSIDE'
  | 'MOVE_CITY_HAS_ALLY_FORCE'
  | 'MOVE_CITY_IN_BATTLE';

/** 城池迁移前置条件的事实（由 move-city-db 读取） */
export interface MoveCityFacts {
  /** 名城（cities.famous_name 非空） */
  famous: boolean;
  /** 本城发出的行军（marching，含出征 / 返程 / 运输 / 调兵）加上本城派去别人城里的协防 的条数 */
  armyOutside: number;
  /** 别人派来协防本城的部队条数（city_assist.city_id = 本城 且派出方不是自己） */
  allyForce: number;
  /** 本城或其名下野地有敌情（cityInBattle） */
  inBattle: boolean;
}

export interface MoveCityDenial {
  code: MoveCityDenialCode;
  /** 附加信息：ARMY_OUTSIDE / HAS_ALLY_FORCE 附 count */
  data?: Record<string, unknown>;
}

/** 全部不满足的前置条件（GET_STATE 逐城给出，按判定顺序） */
export function moveCityDenials(facts: MoveCityFacts): MoveCityDenial[] {
  const out: MoveCityDenial[] = [];
  if (facts.famous) {
    out.push({ code: 'MOVE_CITY_FAMOUS' });
  }
  if (facts.armyOutside > 0) {
    out.push({ code: 'MOVE_CITY_ARMY_OUTSIDE', data: { count: facts.armyOutside } });
  }
  if (facts.allyForce > 0) {
    out.push({ code: 'MOVE_CITY_HAS_ALLY_FORCE', data: { count: facts.allyForce } });
  }
  if (facts.inBattle) {
    out.push({ code: 'MOVE_CITY_IN_BATTLE' });
  }
  return out;
}

/** 迁城前置条件判定：通过返回 null，否则返回首个不满足的条件（判定顺序即提示优先级） */
export function moveCityDenial(facts: MoveCityFacts): MoveCityDenial | null {
  return moveCityDenials(facts)[0] ?? null;
}

/** 旧格回归 NPC 城时的等级：来源等级（origin_level，历史分城为 NULL 按 1 级），钳制到 1..3 */
export function moveNpcLevelOf(originLevel: number | null): number {
  return Math.min(FAMOUS_CITY_LEVEL, Math.max(1, Math.floor(originLevel ?? 1)));
}

/** 旧主城回到空野地后的等级：按世界生成同口径重新抽取（LEVEL_WEIGHTS，1..WILDERNESS_LEVEL_MAX） */
export function drawWildernessLevel(random: () => number = Math.random): number {
  const pool: number[] = [];
  LEVEL_WEIGHTS.forEach((weight, index) => {
    for (let i = 0; i < weight; i += 1) {
      pool.push(index + 1);
    }
  });
  const level = pool[Math.floor(random() * pool.length)];
  return Math.min(WILDERNESS_LEVEL_MAX, Math.max(1, level));
}
