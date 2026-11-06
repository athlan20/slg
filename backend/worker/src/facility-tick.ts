// 望楼（野地设施）的到期完成（v97，AISLG-232）：wilderness_facilities.finish_at 到点后把 building_to 写进 level，
// 清空进行中的那一级，给主人写 facility_completed 事件并通知地块变化（API 收到后推 PUSH_TILE_STATE reason=facility_completed）。
// 由 Worker 的到期探针（due-probe.ts：facilities）驱动，不新增高频空轮询（AISLG-208 的口径）。
//
// 并发与丢地：领取用 FOR UPDATE SKIP LOCKED；野地在建造途中被抢走 / 被放弃时设施行已被 destroyFacility 删掉，
// 这里自然扫不到——工程作废、不退资源（需求 1.3）。到期已完成的行 finish_at 为 null，不会被重复领取。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { insertEvent } from '../../common/src/events';
import { EventType } from '../../common/src/protocol';

/** 单轮最多完成的设施数（防止积压时单个 tick 过长） */
const FACILITY_TICK_BATCH = 100;

/** 一笔完成回报：经 pg_notify 交给 API 推送地块变化 */
interface FacilityDoneNotify {
  accountId: string;
  x: number;
  y: number;
}

export async function processDueFacilities(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  const done: FacilityDoneNotify[] = [];
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT f.x, f.y, f.kind, f.building_to, f.city_id, c.account_id
       FROM wilderness_facilities f
       LEFT JOIN cities c ON c.id = f.city_id
       WHERE f.finish_at IS NOT NULL AND f.finish_at <= now()
       ORDER BY f.finish_at
       LIMIT $1
       FOR UPDATE OF f SKIP LOCKED`,
      [FACILITY_TICK_BATCH],
    );
    for (const row of due.rows as Array<{
      x: number;
      y: number;
      kind: string;
      building_to: number | null;
      city_id: string;
      account_id: string | null;
    }>) {
      const level = row.building_to ?? 0;
      // 条件守卫：仍是进行中的那一级才推进（与取消 / 毁掉的并发由行锁串开）
      const upd = await client.query(
        `UPDATE wilderness_facilities
         SET level = building_to, building_to = NULL, finish_at = NULL, updated_at = now()
         WHERE x = $1 AND y = $2 AND finish_at IS NOT NULL AND building_to IS NOT NULL AND building_to = $3
         RETURNING level`,
        [row.x, row.y, row.building_to],
      );
      if (!upd.rowCount) {
        continue;
      }
      if (row.account_id) {
        await insertEvent(client, {
          accountId: row.account_id,
          cityId: row.city_id,
          type: EventType.FACILITY_COMPLETED,
          initiator: null,
          detail: { x: row.x, y: row.y, kind: row.kind, level },
        });
        done.push({ accountId: row.account_id, x: row.x, y: row.y });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  // 推送在提交之后发（与其它 tick 同一口径：通知丢失由客户端按需查询兜底）
  for (const item of done) {
    await pool
      .query(`SELECT pg_notify($1, $2)`, [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'tile_changed', accountId: item.accountId, x: item.x, y: item.y, tileReason: 'facility_completed' }),
      ])
      .catch(() => undefined);
  }
  return done.length;
}
