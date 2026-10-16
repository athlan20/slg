// 野地储量的对外视图（v61，AISLG-165）：档位对所有人可见；当前储量 / 上限 / 预计时刻只给归属方与侦察过该地块的账号。
// 推进规则与数值见 common/src/wilderness-reserve.ts，这里只做展示口径的组装。

import { reserveTierOf, type TileReserveStep } from '../../common/src/wilderness-reserve';
import type { ReserveView } from '../../common/src/protocol-world';

/** 由单块地的推进结果组装储量视图；visible 为 false 时只给档位 */
export function reserveViewFrom(step: TileReserveStep, visible: boolean): ReserveView {
  const tier = reserveTierOf(step.reserve, step.cap);
  if (!visible) {
    return { tier, current: null, cap: null, eta: null };
  }
  let eta: ReserveView['eta'] = null;
  if (step.emptyAt) {
    eta = { kind: 'empty', at: step.emptyAt.toISOString() };
  } else if (step.fullAt) {
    eta = { kind: 'full', at: step.fullAt.toISOString() };
  }
  return { tier, current: Math.round(step.reserve), cap: Math.round(step.cap), eta };
}
