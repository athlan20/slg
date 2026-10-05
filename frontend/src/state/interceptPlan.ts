// 截击的本地判断（v28 AISLG-78 / v35 AISLG-112，从 WorldInterceptForm 拆出为纯函数）：
// 经过某格的候选目标、到达预估对应的「立即接战 / 将埋伏 / 赶不上」判断、「推荐截击格」。
// 口径同服务端：接战时刻 = max(部队到达时刻, 目标进入相邻范围的时刻)；到达时目标已走出范围才扑空。
// 权威判定与接战时刻以 MARCH 响应 / Worker 结算为准。

import {
  movingIndexAt,
  reachWindowOf,
  type CityView,
  type MovingTargetView,
  type TroopKind,
} from '../api/protocol';
import { formatClock, formatDurationText } from '../api/format';
import { marchBonusPercent, marchTravelSeconds } from '../api/marchPlan';
import { getCopy } from '../i18n/bundle';

export interface InterceptCandidate {
  target: MovingTargetView;
  /** 目标路线上经过此格（且尚未过去）的下标 */
  index: number;
}

/** 经过 (x, y) 且尚未过去的目标（下标 ≥ 当前下标） */
export function interceptCandidates(targets: MovingTargetView[], x: number, y: number, now: number): InterceptCandidate[] {
  return targets
    .map((target) => {
      const current = movingIndexAt(target, now) ?? 0;
      const index = target.route.findIndex((cell, i) => i >= current && cell.x === x && cell.y === y);
      return index >= 0 ? { target, index } : null;
    })
    .filter((item): item is InterceptCandidate => item !== null);
}

export interface InterceptVerdict {
  text: string;
  tone: 'ok' | 'warn';
}

/** 到达预估对应的判断；未编队 / 无坐标 / 目标不会再经过时为 null */
export function interceptVerdict(
  target: MovingTargetView,
  x: number,
  y: number,
  now: number,
  arriveMs: number | null,
): InterceptVerdict | null {
  const { MOVING_COPY } = getCopy();
  const currentIndex = movingIndexAt(target, now) ?? 0;
  const reach = reachWindowOf(target, x, y, currentIndex);
  if (arriveMs === null || !reach) {
    return null;
  }
  if (arriveMs >= reach.to) {
    return { text: MOVING_COPY.intercept.verdictLate, tone: 'warn' };
  }
  if (arriveMs < reach.from) {
    return {
      text: MOVING_COPY.intercept.verdictAmbush(
        formatDurationText(Math.ceil((reach.from - arriveMs) / 1000)),
        formatClock(new Date(reach.from).toISOString()),
      ),
      tone: 'ok',
    };
  }
  return { text: MOVING_COPY.intercept.verdictOk, tone: 'ok' };
}

/** 推荐截击格（v35）：按当前编队在目标路线上挑「最早能赶上」的格（接战时刻最早的可行格） */
export function recommendCell(
  target: MovingTargetView,
  origin: { x: number; y: number } | null,
  troops: Partial<Record<TroopKind, number>>,
  city: CityView,
  now: number,
): { x: number; y: number; engageMs: number } | null {
  const total = Object.values(troops).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  if (!origin || total <= 0) {
    return null;
  }
  const currentIndex = movingIndexAt(target, now) ?? 0;
  let best: { x: number; y: number; engageMs: number } | null = null;
  const seen = new Set<string>();
  for (let i = currentIndex; i < target.route.length; i += 1) {
    const cell = target.route[i];
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const win = reachWindowOf(target, cell.x, cell.y, currentIndex);
    if (!win) {
      continue;
    }
    const travel = marchTravelSeconds(origin.x, origin.y, cell.x, cell.y, troops, city.timeScale, marchBonusPercent(city.techs));
    const arrive = now + travel * 1000;
    if (arrive >= win.to) {
      continue;
    }
    const engage = Math.max(arrive, win.from);
    if (!best || engage < best.engageMs) {
      best = { x: cell.x, y: cell.y, engageMs: engage };
    }
  }
  return best;
}
