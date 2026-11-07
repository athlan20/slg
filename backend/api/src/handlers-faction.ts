// 五方势力查询（AISLG-239，v99）：GET_FACTIONS。只读：五家的名称 / 首领 / 老巢坐标 / 当前半径 / 持城数。
// 势力本身的生成与吞城在 common/src/faction-db.ts（世界生成 / 换季）与 worker/src/faction-tick.ts（定时）。
// 开关 faction_enabled 关闭时返回 enabled=false、factions 为空数组（关闭时不得有任何势力内容）。
// 老巢坐标对全服公开、不受战争迷雾影响：本协议不做任何迷雾裁剪。

import { getCurrentSeason } from '../../common/src/season-db';
import { loadFactionView } from '../../common/src/faction-db';
import { respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** GET_FACTIONS：本季天数、当前半径与五家的名称 / 首领 / 老巢 / 半径 / 持城数 */
export async function handleGetFactions(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const season = await getCurrentSeason(ctx.pool);
  const view = await loadFactionView(ctx.pool, season ? season.startAt : null, new Date());
  respondOk(ctx.registry, conn, op, seq, { ...view });
}
