// Worker 的科技研究到期结算（v27，AISLG-77）。
// 设计：
// - 领取与完成同事务：tech_research 行以 SKIP LOCKED 领取，状态条件翻转 researching → completed，
//   重启或重复领取不会重复完成；
// - 产量切分：研究生效会改变全账号所有城的产量与储量上限，翻转等级前按旧等级把账号每座城的
//   生产结算到到期时刻（锁序：研究行 → 各城按 id 升序），之后的懒结算按新等级走；
// - 完成事件与状态同一事务落库，pg_notify 在提交后发出（漏发时客户端按需查询兜底）。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { researchView, type TechResearchRow } from '../../common/src/tech-db';
import { settleOwnerCity } from './tick-shared';

const BATCH_LIMIT = 50;

/** 处理一批到期研究；返回完成数量。单条失败抛出，整批回滚，下个周期重试。 */
export async function processDueResearch(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT * FROM tech_research
       WHERE status = 'researching' AND due_at <= now()
       ORDER BY due_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_LIMIT],
    );
    const done: Array<{ row: TechResearchRow; level: number }> = [];
    for (const row of due.rows as TechResearchRow[]) {
      const cities = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY id`, [row.account_id]);
      for (const city of cities.rows as Array<{ id: string }>) {
        await settleOwnerCity(client, city.id, row.due_at);
      }
      const upd = await client.query(
        `UPDATE tech_research SET status = 'completed', completed_at = clock_timestamp()
         WHERE id = $1 AND status = 'researching'
         RETURNING *`,
        [row.id],
      );
      if (upd.rowCount !== 1) {
        continue;
      }
      // GREATEST 防乱序完成回退等级（账号同时只有一项研究，仅为守卫）
      await client.query(
        `INSERT INTO account_techs (account_id, tech, level) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, tech)
         DO UPDATE SET level = GREATEST(account_techs.level, EXCLUDED.level), updated_at = now()`,
        [row.account_id, row.tech, row.level],
      );
      await insertEvent(client, {
        accountId: row.account_id,
        cityId: row.city_id,
        buildId: row.id,
        type: EventType.RESEARCH_COMPLETED,
        initiator: row.initiator as InitiatorRole,
        detail: { tech: row.tech, level: row.level },
      });
      done.push({ row: upd.rows[0] as TechResearchRow, level: row.level });
    }
    await client.query('COMMIT');
    for (const { row, level } of done) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({
          reason: 'tech_state',
          accountId: row.account_id,
          data: { reason: 'research_completed', research: researchView(row), level },
        }),
      ]);
    }
    return done.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
