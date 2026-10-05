// 移动目标（v28，AISLG-78）：地图上沿固定路线移动、过时消失的 NPC 目标——运粮商队（守军弱、
// 资源多）与流寇（守军强些、资源更多、路过玩家野地会顺手掠夺该地的采集收益）。
// 路线与时刻表公开：路线是 ROUTE_STEPS 个相邻格（每步 Chebyshev 距离 ≤ 1），第 i 格从
// startedAt + i × 步长 起占据、持续一个步长；存在时长基准 6 小时随全局时间缩放。
// 出征截击选的是路线上的某一格；v35（AISLG-112）起「到了先埋伏」：部队到达时目标还没走进
// 选定格的相邻范围就原地埋伏，接战时刻 = max(到达时刻, 目标进入相邻范围的时刻)（见
// reachWindowOf 与 worker/src/intercept-tick.ts）。API（发起校验 / 视图）与 Worker（刷新 / 结算）共用本文件。
// 全部数值为占位，上线后按数据调整；参考旧游戏只取玩法结构，不照搬数值。

import type { Resources, TroopKind } from './protocol';
import { armyPower } from './battle';
import { PLUNDER_POOL_GOLD_PER_LEVEL, PLUNDER_POOL_RESOURCE_PER_LEVEL, WORLD_SIZE } from './world';
import { scaledMs } from './time-scale';

export const MOVING_KINDS = ['caravan', 'bandit'] as const;

export type MovingKind = (typeof MOVING_KINDS)[number];

export function isMovingKind(value: unknown): value is MovingKind {
  return typeof value === 'string' && (MOVING_KINDS as readonly string[]).includes(value);
}

/** 路线格数（每格一步；步长 = 存在时长 ÷ 格数） */
export const ROUTE_STEPS = 24;
/** 存在时长基准（小时，随全局时间缩放 ÷ scale；最少 1 秒） */
export const MOVING_LIFETIME_HOURS = 6;
/** 目标等级范围（决定守军规模与资源量） */
export const MOVING_LEVEL_MIN = 1;
export const MOVING_LEVEL_MAX = 5;
/** 截击判定：到达时目标所在格与出征格的 Chebyshev 距离 ≤ 该值才开打（「正在这一格或相邻一格」） */
export const INTERCEPT_REACH = 1;
/** 同时存在数量的上下限与比例：活跃玩家数 × 比例向上取整，夹在 [MIN, MAX]；无活跃玩家时为 0 */
export const MOVING_TARGETS_PER_ACTIVE_PLAYER = 0.5;
export const MOVING_TARGETS_MIN = 2;
export const MOVING_TARGETS_MAX = 40;
/** 「活跃玩家」口径：最近 24 小时内有过登录的账号（真实时间，不随时间缩放） */
export const ACTIVE_PLAYER_WINDOW_HOURS = 24;
/** 流寇掠夺：路过的玩家野地损失该地「小时产量（占领加成 + 驻军采集）」的这么多倍（游戏小时，不随缩放） */
export const BANDIT_PLUNDER_HOURS = 2;

export interface MovingKindInfo {
  kind: MovingKind;
  label: string;
  /** 携带资源相对「同等级野地掠夺池」的倍数（五项资源都带） */
  lootMultiplier: number;
  /** 守军编成（按等级） */
  garrison: (level: number) => Partial<Record<TroopKind, number>>;
  /** 一句话说明（界面 / 文档） */
  note: string;
}

export const MOVING_KIND_INFO: Record<MovingKind, MovingKindInfo> = {
  caravan: {
    kind: 'caravan',
    label: '运粮商队',
    lootMultiplier: 2,
    garrison: (level) => ({ militia: 5 * level }),
    note: '守军弱，带的资源较多；打赢按负重掠走',
  },
  bandit: {
    kind: 'bandit',
    label: '流寇',
    lootMultiplier: 3,
    garrison: (level) => ({ militia: 8 * level, pikeman: 2 * level, archer: level }),
    note: '守军强些，资源更多；路过玩家野地会顺手掠夺该地采集收益（掠到的也记在它身上，打赢能夺回）',
  },
};

/** 存在时长（毫秒）：6 小时 ÷ 全局时间缩放 */
export function movingLifetimeMs(): number {
  return scaledMs(MOVING_LIFETIME_HOURS * 3_600_000);
}

/** 单步时长（毫秒）：存在时长 ÷ 路线格数（向下取整，至少 1 毫秒） */
export function movingStepMs(lifetimeMs: number = movingLifetimeMs()): number {
  return Math.max(1, Math.floor(lifetimeMs / ROUTE_STEPS));
}

/** 路线上的一格 [x, y] */
export type RouteCell = [number, number];

export interface ScheduleEntry {
  x: number;
  y: number;
  /** 进入该格的时刻（ISO 8601）；持续到下一格的 at */
  at: string;
}

/** 目标在 nowMs 时所处的路线下标；尚未出发 / 已超出存在时长返回 null */
export function routeIndexAt(startMs: number, endMs: number, nowMs: number, stepMs: number): number | null {
  if (nowMs < startMs || nowMs >= endMs) {
    return null;
  }
  return Math.min(ROUTE_STEPS - 1, Math.floor((nowMs - startMs) / stepMs));
}

/** 公开时刻表：每格的坐标与进入时刻 */
export function scheduleOf(route: RouteCell[], startMs: number, stepMs: number): ScheduleEntry[] {
  return route.map(([x, y], index) => ({ x, y, at: new Date(startMs + index * stepMs).toISOString() }));
}

/** 两格的 Chebyshev 距离 */
export function cellDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * 路线上最早「还没过去」的某格下标：从 minIndex 起第一个坐标等于 (x, y) 的格；不在路线上返回 -1。
 * 出征发起校验用——选的格必须是目标将要（或正在）经过的格。
 */
export function routeIndexOfCell(route: RouteCell[], x: number, y: number, minIndex: number): number {
  for (let index = Math.max(0, minIndex); index < route.length; index += 1) {
    if (route[index][0] === x && route[index][1] === y) {
      return index;
    }
  }
  return -1;
}

/**
 * 截击埋伏窗口（v35，AISLG-112）：目标从 minIndex 起首次进入 (x, y) 相邻范围
 * （Chebyshev 距离 ≤ reach）的连续时间窗 [from, to)——from = 首个落入范围的格的进入时刻，
 * to = 其后首个走出范围的格的进入时刻（走到路线尽头则为存在截止时刻）。
 * 从 minIndex 起不会再经过范围返回 null。路线与时刻表固定，API 预估与 Worker 判定同口径。
 */
export function reachWindowOf(
  route: RouteCell[],
  x: number,
  y: number,
  startMs: number,
  stepMs: number,
  minIndex: number,
  reach: number = INTERCEPT_REACH,
): { from: number; to: number } | null {
  let first = -1;
  for (let index = Math.max(0, minIndex); index < route.length; index += 1) {
    if (cellDistance(route[index][0], route[index][1], x, y) <= reach) {
      first = index;
      break;
    }
  }
  if (first < 0) {
    return null;
  }
  let last = first;
  while (last + 1 < route.length && cellDistance(route[last + 1][0], route[last + 1][1], x, y) <= reach) {
    last += 1;
  }
  return {
    from: startMs + first * stepMs,
    to: Math.min(startMs + (last + 1) * stepMs, startMs + route.length * stepMs),
  };
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

function clampCoord(value: number): number {
  return Math.min(WORLD_SIZE - 1, Math.max(0, value));
}

/**
 * 以某玩家主城为锚点生成路线（纯函数，rng 注入便于测试）：起点落在锚点周围 6..15 格，
 * 前一半沿一个方向走、后一半沿相邻（±45°）或同一方向走，边界处钳制在世界内。
 */
export function generateRoute(rng: () => number, anchorX: number, anchorY: number): RouteCell[] {
  const distance = 6 + Math.floor(rng() * 10);
  const angle = rng() * Math.PI * 2;
  let x = clampCoord(anchorX + Math.round(Math.cos(angle) * distance));
  let y = clampCoord(anchorY + Math.round(Math.sin(angle) * distance));
  const first = Math.floor(rng() * DIRECTIONS.length);
  const turn = Math.floor(rng() * 3) - 1;
  const second = (first + turn + DIRECTIONS.length) % DIRECTIONS.length;
  const route: RouteCell[] = [];
  for (let step = 0; step < ROUTE_STEPS; step += 1) {
    route.push([x, y]);
    const [dx, dy] = DIRECTIONS[step < ROUTE_STEPS / 2 ? first : second];
    x = clampCoord(x + dx);
    y = clampCoord(y + dy);
  }
  return route;
}

/** 目标的资源携带量（五项）：同等级野地掠夺池 × 倍数 */
export function movingStock(kind: MovingKind, level: number): Resources {
  const multiplier = MOVING_KIND_INFO[kind].lootMultiplier;
  const resource = Math.max(0, level) * PLUNDER_POOL_RESOURCE_PER_LEVEL * multiplier;
  return {
    gold: Math.max(0, level) * PLUNDER_POOL_GOLD_PER_LEVEL * multiplier,
    wood: resource,
    food: resource,
    stone: resource,
    iron: resource,
  };
}

/** 守军参考战力（视图 / 文档用） */
export function movingPower(kind: MovingKind, level: number): number {
  return armyPower(MOVING_KIND_INFO[kind].garrison(level));
}

/** 同时存在的目标数量：随活跃玩家数调整（无人活跃不刷新） */
export function desiredMovingCount(activePlayers: number): number {
  if (activePlayers <= 0) {
    return 0;
  }
  const raw = Math.ceil(activePlayers * MOVING_TARGETS_PER_ACTIVE_PLAYER);
  return Math.min(MOVING_TARGETS_MAX, Math.max(MOVING_TARGETS_MIN, raw));
}

/** 随机挑一种与等级（商队 60% / 流寇 40%；等级在 [MIN, MAX] 内均匀） */
export function pickMovingKindAndLevel(rng: () => number): { kind: MovingKind; level: number } {
  const kind: MovingKind = rng() < 0.6 ? 'caravan' : 'bandit';
  const level = MOVING_LEVEL_MIN + Math.floor(rng() * (MOVING_LEVEL_MAX - MOVING_LEVEL_MIN + 1));
  return { kind, level };
}
