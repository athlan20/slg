// 压制档变化的全服播报（AISLG-249，v107）：老巢被打到跨档（升档）或营恢复导致降档时播一句，
// 例如「黑山军被压制到 2 档」。复用现有的全服播报通道（server_broadcasts 表 → 提交后 pg_notify →
// API 经 PUSH_SERVER_BROADCAST 广播给全部在线连接），不新造通道。
// 压制档本身由剩余营数现算（common/src/faction-suppression.ts），这里只做「前后档位比较 + 播报」。
// 调用方：打老巢的结算（worker/src/faction-lair-battle.ts）与营恢复的定时器（worker/src/faction-lair-tick.ts），
// 两处都在自己的事务里，播报与结算同生共死。

import type pg from 'pg';
import { factionBannerOf, factionNameOf } from '../../common/src/faction';
import { FACTION_LAIR_CAMPS } from '../../common/src/faction-lair';
import { suppressionLevel } from '../../common/src/faction-suppression';
import { insertServerBroadcast, type ServerBroadcastCreated } from '../../common/src/server-broadcast';

export interface SuppressionChange {
  /** 变化前的压制档 */
  before: number;
  /** 变化后的压制档 */
  after: number;
  /** 写好的全服播报（调用方提交后发 pg_notify 广播） */
  broadcast: ServerBroadcastCreated;
}

/**
 * 比较同一家老巢变化前后的压制档：不同就写一条 faction_suppressed 全服播报（必达，不受每分钟限频——
 * 一季每家最多升 3 次、降 3 次），返回档位与播报；没变返回 null。
 * campsBefore / campsAfter 都是剩余营数，campTotal 缺省 20 营。
 */
export async function notifySuppressionChange(
  client: pg.PoolClient,
  args: { key: string; campsTotal: number; campsBefore: number; campsAfter: number },
): Promise<SuppressionChange | null> {
  const total = args.campsTotal || FACTION_LAIR_CAMPS;
  const before = suppressionLevel(total, args.campsBefore);
  const after = suppressionLevel(total, args.campsAfter);
  if (before === after) {
    return null;
  }
  const banner = factionBannerOf(args.key);
  if (!banner) {
    return null;
  }
  const broadcast = await insertServerBroadcast(
    client,
    'faction_suppressed',
    {
      faction: banner,
      factionName: factionNameOf(args.key),
      level: after,
      previousLevel: before,
      direction: after > before ? 'up' : 'down',
      campsTotal: total,
      campsRemaining: Math.max(0, Math.min(total, Math.floor(args.campsAfter))),
    },
    { force: true },
  );
  return broadcast ? { before, after, broadcast } : null;
}
