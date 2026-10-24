// 联盟的周期任务（v66，AISLG-181）：回收过期的申请与邀请；盟主长期不活跃自动转让。
// 转让发生后用 pg_notify 让 API 把 PUSH_ALLIANCE_STATE 推给该联盟的在线成员（Worker 自己没有连接）。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { purgeExpired, transferInactiveLeaders } from '../../common/src/alliance-db';
import { ALLIANCE_LEADER_INACTIVE_MS } from '../../common/src/protocol-alliance';

/** tick 节流（毫秒）：阈值是天级，分钟级扫一次足够 */
export const ALLIANCE_TICK_MS = 60_000;

let lastRunMs = 0;

/** 单 tick 入口：节流到 ALLIANCE_TICK_MS；返回本次自动转让的联盟数 */
export async function processAlliances(
  pool: pg.Pool,
  nowMs: number = Date.now(),
  inactiveMs: number = ALLIANCE_LEADER_INACTIVE_MS,
): Promise<number> {
  if (nowMs - lastRunMs < ALLIANCE_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  await purgeExpired(pool);
  const transfers = await transferInactiveLeaders(pool, inactiveMs);
  for (const t of transfers) {
    const members = await pool.query(`SELECT account_id FROM alliance_members WHERE alliance_id = $1`, [t.allianceId]);
    await pool.query(`SELECT pg_notify($1, $2)`, [
      NOTIFY_CHANNEL,
      JSON.stringify({
        reason: 'alliance_state',
        accountIds: (members.rows as Array<{ account_id: string }>).map((r) => r.account_id),
        data: { reason: 'role_changed', allianceId: t.allianceId, allianceName: t.allianceName },
      }),
    ]);
  }
  return transfers.length;
}
