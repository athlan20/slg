// 攻城结算的取数 / 事件小工具（v111，AISLG-259 从 pvp-conquer.ts 拆出以控制单文件行数）：
// 城守经验、城池命名、扑空返程。只被 pvp-conquer 使用，放这里是为了让到达结算本体留在 500 行内。

import type pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { grantHeroExp } from '../../common/src/hero-db';
import type { TroopKind } from '../../common/src/protocol';
import {
  completeMarchEvent,
  createReturnMarch,
  markMarchArrived,
  type MarchRow,
  type TileNotify,
} from './tick-shared';

/** 城守经验（守城战同口径；升级事件 + 推送载荷） */
export async function grantGuardExp(
  client: pg.PoolClient,
  accountId: string,
  cityId: string,
  heroId: string,
  heroName: string,
  gained: number,
): Promise<{ gained: number; level: number; leveledTo: number | null }> {
  const exp = await grantHeroExp(client, heroId, gained);
  if (exp?.leveledTo) {
    await insertEvent(client, {
      accountId, cityId, buildId: heroId,
      type: EventType.HERO_LEVEL_UP, initiator: null,
      detail: { heroId, heroName, level: exp.leveledTo },
    });
  }
  return { gained, level: exp?.level ?? 0, leveledTo: exp?.leveledTo ?? null };
}

/** 城池命名（攻守双方战报 / 事件用） */
export async function loadNaming(
  client: pg.PoolClient,
  cityId: string,
): Promise<{ accountId: string; username: string; cityName: string } | null> {
  const res = await client.query(
    `SELECT c.account_id, a.username, c.name AS city_name FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [cityId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { account_id: string; username: string; city_name: string };
  return { accountId: row.account_id, username: row.username, cityName: row.city_name };
}

/** 目标局面已变 / 受保护：不战斗，部队扑空原路返程并记录原因 */
export async function abortConquest(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  cause: string,
  until: Date | null,
): Promise<void> {
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, troops, settled, march.initiator);
  await completeMarchEvent(client, march, 'aborted', {
    troops,
    returning,
    cause,
    ...(until ? { until: until.toISOString() } : {}),
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}
