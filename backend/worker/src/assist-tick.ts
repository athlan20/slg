// 协防到达结算（v74，AISLG-194）：目标必须是盟友的城；按上限入驻，部队驻扎在对方城里。
// 发起时已初核，这里在锁内复核（目标易主 / 退盟 / 名额被抢）。
// 锁序：出发城（调用方已锁）→ 目标城池行（本文件只读复核）→ city_assist 写入 → 事件。
// 失败路径：原路返回（事件 outcome=aborted，cause=ASSIST_NOT_ALLY / ASSIST_LIMIT / target_gone）。

import pg from 'pg';
import { EventType, type TroopKind, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { canAssist } from '../../common/src/alliance-db';
import { assistCap } from '../../common/src/city-assist';
import { countAssistsAtCity, hasAssistAtCity, insertAssist } from '../../common/src/city-assist-db';
import { abortForAlly, completeMarchEvent, createReturnMarch, markMarchArrived, type MarchRow, type TileNotify } from './tick-shared';

interface HostCityRow {
  id: string;
  account_id: string;
  name: string;
  username: string;
  famous_name: string | null;
  x: number | null;
  y: number | null;
}

/** 协防到达：复核盟友关系与名额，入驻；失败原路返回 */
export async function settleAssistArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const hostRes = await client.query(
    `SELECT c.id, c.account_id, c.name, a.username, c.famous_name, c.x, c.y
     FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
     JOIN accounts a ON a.id = c.account_id
     WHERE wt.x = $1 AND wt.y = $2 AND wt.kind = 'city' AND c.id <> $3`,
    [march.x, march.y, march.from_city_id],
  );
  const host = hostRes.rows[0] as HostCityRow | undefined;
  if (!host) {
    // 目标已不是一座城（放弃 / 重置 / 易主成野地）：按失效返程
    await abortForAlly(client, march, troops, settled, notifies, 'target_gone');
    return;
  }
  // v67 同口径：出发后才退盟 / 目标换盟的，到达不开打也不入驻
  if (!(await canAssist(client, march.account_id, host.account_id))) {
    await abortForAlly(client, march, troops, settled, notifies, 'ASSIST_NOT_ALLY');
    return;
  }
  if ((await hasAssistAtCity(client, host.id, march.account_id)) || (await countAssistsAtCity(client, host.id)) >= assistCap(host.famous_name)) {
    await abortLimited(client, march, troops, settled, notifies);
    return;
  }

  const arrived = await insertAssist(client, {
    cityId: host.id,
    accountId: march.account_id,
    fromCityId: march.from_city_id,
    troops,
    initiator: march.initiator,
  });
  await markMarchArrived(client, march.id);
  await completeMarchEvent(client, march, 'assisted', { troops, hostCityId: host.id, hostCityName: host.name });
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: march.from_city_id,
    buildId: arrived.id,
    type: EventType.ASSIST_ARRIVED,
    initiator: march.initiator as InitiatorRole,
    detail: {
      assistId: arrived.id,
      hostCityId: host.id,
      hostCityName: host.name,
      hostUsername: host.username,
      troops,
      x: march.x,
      y: march.y,
    },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: host.account_id, x: march.x, y: march.y, tileReason: 'assist_arrived' });
}

/** 名额满 / 同账号重复：原路返回，cause=ASSIST_LIMIT */
async function abortLimited(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, troops, settled, march.initiator);
  await completeMarchEvent(client, march, 'aborted', { troops, returning, cause: 'ASSIST_LIMIT' });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}
