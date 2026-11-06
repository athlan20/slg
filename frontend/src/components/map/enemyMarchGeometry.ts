// 他人部队图层的纯计算（AISLG-230）：位置外推、规模对应的图标大小、关系 → 颜色。
// 只做「数据 → 坐标 / 样式」的换算，不碰 React 与协议运行时（只能用 import type），
// 这样 backend/test 的 node:test 可以直接 import 本文件做单元测试。

import type { VisibleMarchRelation, VisibleMarchScale, VisibleMarchView } from '../../api/protocol';
import type { Cell } from './marchGeometry';

/** 两次请求之间用 vx / vy 外推的上限（毫秒）：比 5 秒刷新多 1 秒，请求晚到时图标不会长时间跑偏 */
export const ENEMY_MARCH_EXTRAPOLATE_MAX_MS = 6_000;

/** 规模档位对应的图标大小系数（按现有 marchIconSize 的 80% / 100% / 125%） */
export const ENEMY_MARCH_SCALE_FACTOR: Record<VisibleMarchScale, number> = {
  small: 0.8,
  medium: 1,
  large: 1.25,
};

/** 图标色调：来袭自己（红色）> 敌对（橙）> 中立（灰）> 同盟友盟（绿） */
export type EnemyMarchTone = 'incoming' | 'hostile' | 'neutral' | 'friend';

/** 色调 → 主题色变量（四套皮肤各自配色；与领地关系色同一套变量） */
export const ENEMY_MARCH_TONE_COLOR: Record<EnemyMarchTone, string> = {
  incoming: 'var(--st-error)',
  hostile: 'var(--warn)',
  neutral: 'var(--st-offline)',
  friend: 'var(--st-online)',
};

/** 外推时长（毫秒）：夹在 0～6 秒。断网或停止刷新时停在 6 秒处，不会一直跑下去 */
export function extrapolateMs(receivedAt: number, now: number): number {
  return Math.min(ENEMY_MARCH_EXTRAPOLATE_MAX_MS, Math.max(0, now - receivedAt));
}

/** 外推后的图标位置（世界格坐标；vx / vy 为每秒格数） */
export function enemyMarchPos(march: Pick<VisibleMarchView, 'x' | 'y' | 'vx' | 'vy'>, receivedAt: number, now: number): Cell {
  const dt = extrapolateMs(receivedAt, now) / 1000;
  return { x: march.x + march.vx * dt, y: march.y + march.vy * dt };
}

/** 规模档位 → 图标直径（基准是现有 marchIconSize 的结果；小股 80%、中军 100%、大军 125%） */
export function enemyMarchIconSize(base: number, scale: VisibleMarchScale): number {
  return Math.max(10, Math.round(base * ENEMY_MARCH_SCALE_FACTOR[scale]));
}

/** 前进方向（度，0 = 向右，与 SVG 的坐标系一致）；没有速度时返回 null（不画箭头） */
export function enemyMarchHeading(vx: number, vy: number): number | null {
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || (vx === 0 && vy === 0)) {
    return null;
  }
  return (Math.atan2(vy, vx) * 180) / Math.PI;
}

/**
 * 图标色调：正在来袭自己（来袭预警里的 attackId = 行军 id，且还没到达）优先于一切，用红色；
 * 其余按关系——敌对橙、中立灰、同盟 / 友盟（含解除友好冷却期）绿。
 */
export function enemyMarchTone(
  march: Pick<VisibleMarchView, 'id' | 'owner'>,
  incomingIds: ReadonlySet<string>,
): EnemyMarchTone {
  if (incomingIds.has(march.id)) {
    return 'incoming';
  }
  return relationTone(march.owner.relation);
}

/** 关系 → 色调（来袭在 enemyMarchTone 里另判） */
export function relationTone(relation: VisibleMarchRelation): EnemyMarchTone {
  if (relation === 'hostile') {
    return 'hostile';
  }
  if (relation === 'ally' || relation === 'friendly') {
    return 'friend';
  }
  return 'neutral';
}

/** 来袭连线：位置已知的来袭部队 → 被攻击格（只用行军 id 匹配，不用目标格数据） */
export interface RaidLine {
  id: string;
  from: Cell;
  to: Cell;
}

/**
 * 来袭连线数据（需求第五节）：来袭预警的行军 id 在这一帧能看到位置时，从当前位置画一条到被攻击格的红线。
 * 预警已到达（arriveAt 已过）的不画；没进视野的部队 positions 里没有，就只剩原来的红标。
 */
export function raidLines(
  positions: ReadonlyMap<string, Cell>,
  warnings: ReadonlyArray<{ attackId: string; x: number; y: number; arriveAt: string }>,
  now: number,
): RaidLine[] {
  const lines: RaidLine[] = [];
  for (const warning of warnings) {
    const from = positions.get(warning.attackId);
    if (!from || Date.parse(warning.arriveAt) <= now) {
      continue;
    }
    lines.push({ id: warning.attackId, from, to: { x: warning.x, y: warning.y } });
  }
  return lines;
}
