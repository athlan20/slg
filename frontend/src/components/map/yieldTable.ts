// 产出图层的数据（AISLG-216）：野地占领加成表（前端镜像 backend/common/src/world.ts 的
// TERRAIN_INFO 两列数值）、每小时产量的缩写、储量条档位。镜像表由
// backend/test/map-display.test.ts 断言与后端完全一致，以后改数值两边对不上会立刻报错。
// 纯函数（只用 import type），不碰 i18n / React，便于 node:test 直接 import。

import type { TerrainKind, TerrainResource, TerritoryView, TileView } from '../../api/protocol';
import type { ReserveView } from '../../api/protocol-world';

/** 储量档位：充足 > 60%、一般 20%～60%、枯竭 < 20% */
export type ReserveTier = 'ample' | 'normal' | 'depleted';

/** 野地占领加成（/小时）= bonusBase + 等级 × bonusPerLevel；与后端 TERRAIN_INFO 同名同值 */
export const TERRAIN_YIELD: Record<TerrainKind, { resource: TerrainResource; bonusBase: number; bonusPerLevel: number }> = {
  plain: { resource: 'food', bonusBase: 25, bonusPerLevel: 55 },
  grass: { resource: 'food', bonusBase: 30, bonusPerLevel: 70 },
  forest: { resource: 'wood', bonusBase: 30, bonusPerLevel: 70 },
  hill: { resource: 'iron', bonusBase: 25, bonusPerLevel: 55 },
  desert: { resource: 'stone', bonusBase: 25, bonusPerLevel: 55 },
  marsh: { resource: 'food', bonusBase: 20, bonusPerLevel: 40 },
  lake: { resource: 'food', bonusBase: 40, bonusPerLevel: 80 },
  gold_mine: { resource: 'gold', bonusBase: 30, bonusPerLevel: 70 },
};

/** 单块野地的占领加成（/小时），镜像后端 wildernessBonusRate */
export function wildernessBonusRate(terrain: TerrainKind, level: number): number {
  const info = TERRAIN_YIELD[terrain] ?? TERRAIN_YIELD.plain;
  return info.bonusBase + Math.max(0, level) * info.bonusPerLevel;
}

/** 产量缩写：不足 1000 原样，1000 起写成 1.2k（保留一位小数） */
export function formatYieldRate(value: number): string {
  const n = Math.floor(value);
  if (Math.abs(n) < 1000) {
    return String(n);
  }
  return `${(Math.round((n / 1000) * 10) / 10).toFixed(1)}k`;
}

/** 储量条档位：有数值按比例分档，只有档位时直接用后端给的档位 */
export function reserveTier(pct: number | null, tier: ReserveTier | null): ReserveTier | null {
  if (pct !== null) {
    if (pct > 0.6) {
      return 'ample';
    }
    return pct >= 0.2 ? 'normal' : 'depleted';
  }
  return tier;
}

/** 储量条比例：拿得到当前储量与上限才给；只有档位时为 null（不画条） */
export function reserveRatio(reserve: ReserveView | null): number | null {
  if (!reserve || reserve.current === null || reserve.cap === null || reserve.cap <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, reserve.current / reserve.cap));
}

/** 一格野地的产出显示数据 */
export interface YieldInfo {
  resource: TerrainResource;
  /** 每小时产量：自己的地 = 占领加成 + 驻军采集；别人的地 / 无主 = 占领加成 */
  rate: number;
  /** 是否自己的地（数字含驻军采集，与领地卡一致） */
  own: boolean;
  /** 储量条比例 0～1；只有档位时为 null */
  reservePct: number | null;
  /** 储量档位；完全没有储量信息为 null */
  tier: ReserveTier | null;
  /** 储量数值（拿不到为 null） */
  reserve: { current: number | null; cap: number | null; eta: { kind: 'empty' | 'full'; at: string } | null };
}

/**
 * 格子产出：只有野地有产出（NPC 城与玩家城不算），黄巾营地格不显示（营地格不能占领）。
 * own = 该格在本城的领地数据里（含驻军采集与连片加成，与领地卡的数字一致）；
 * 本账号其他城的领地拿不到采集数字，退化成占领加成。
 */
export function yieldOfTile(tile: TileView, ownTile: TerritoryView | undefined, accountId: string | null): YieldInfo | null {
  if (tile.kind !== 'wilderness' || tile.camp) {
    return null;
  }
  const isOwn = tile.owner !== null && accountId !== null && tile.owner.accountId === accountId;
  const reserve = tile.reserve;
  const base = ownTile
    ? { resource: ownTile.resource, rate: Math.max(0, ownTile.bonusRate) + Math.max(0, ownTile.gatherRate) }
    : { resource: TERRAIN_YIELD[tile.terrain].resource, rate: wildernessBonusRate(tile.terrain, tile.level) };
  const pct = reserveRatio(reserve);
  return {
    resource: base.resource,
    rate: base.rate,
    own: isOwn && ownTile !== undefined,
    reservePct: pct,
    tier: reserveTier(pct, reserve?.tier ?? null),
    reserve: {
      current: reserve?.current ?? null,
      cap: reserve?.cap ?? null,
      eta: reserve?.eta ?? null,
    },
  };
}