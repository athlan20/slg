// 移动目标协议的类型镜像（v28 AISLG-78）。唯一事实来源是 backend/common/src/protocol-moving.ts
// 与 backend/common/src/moving-target.ts；协议调整时以后端生成文档（docs/agent-api.md）为准同步本文件。

export type MovingKind = 'caravan' | 'bandit';

/** 路线时刻表的一格：进入该格的时刻（ISO），持续到下一格的 at；最后一格持续到 endsAt */
export interface ScheduleEntry {
  x: number;
  y: number;
  at: string;
}

export interface MovingTargetView {
  id: string;
  kind: MovingKind;
  label: string;
  level: number;
  status: 'active' | 'defeated' | 'expired';
  startedAt: string;
  endsAt: string;
  /** 每格停留秒数 */
  stepSeconds: number;
  position: { x: number; y: number; index: number } | null;
  route: ScheduleEntry[];
  /** 守军总兵力大概范围（真实 ±20%） */
  garrisonTotal: { min: number; max: number };
  /** 携带资源总量大概范围（真实 ±20%） */
  stockTotal: { min: number; max: number };
}

export interface MovingTargetPushData {
  reason: 'spawned' | 'defeated' | 'expired';
  target: MovingTargetView;
}

/** 截击判定半径：到达时目标在选定格或相邻格才接战（镜像 backend/common/src/moving-target.ts） */
export const INTERCEPT_REACH = 1;

/** 目标在 nowMs 时所在的路线下标；未出发 / 已消失返回 null（与服务端同口径：第 i 格从 route[i].at 起占据） */
export function movingIndexAt(target: MovingTargetView, nowMs: number): number | null {
  if (nowMs >= Date.parse(target.endsAt) || nowMs < Date.parse(target.route[0]?.at ?? target.startedAt)) {
    return null;
  }
  let index = 0;
  for (let i = 0; i < target.route.length; i += 1) {
    if (Date.parse(target.route[i].at) <= nowMs) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

/**
 * 截击埋伏窗口（v35 AISLG-112，镜像 backend/common/src/moving-target.ts 的 reachWindowOf）：
 * 目标从 minIndex 起首次进入 (x, y) 相邻范围（Chebyshev ≤ reach）的连续时间窗 [from, to)；
 * 从 minIndex 起不会再经过范围返回 null。接战时刻 = max(部队到达时刻, from)，到达 ≥ to 则扑空。
 */
export function reachWindowOf(
  target: MovingTargetView,
  x: number,
  y: number,
  minIndex: number,
  reach = INTERCEPT_REACH,
): { from: number; to: number } | null {
  const distance = (cell: { x: number; y: number }) => Math.max(Math.abs(cell.x - x), Math.abs(cell.y - y));
  const route = target.route;
  let first = -1;
  for (let i = Math.max(0, minIndex); i < route.length; i += 1) {
    if (distance(route[i]) <= reach) {
      first = i;
      break;
    }
  }
  if (first < 0) {
    return null;
  }
  let last = first;
  while (last + 1 < route.length && distance(route[last + 1]) <= reach) {
    last += 1;
  }
  const endMs = Date.parse(target.endsAt);
  return {
    from: Math.min(Date.parse(route[first].at), endMs),
    to: Math.min(last + 1 < route.length ? Date.parse(route[last + 1].at) : endMs, endMs),
  };
}
