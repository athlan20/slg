// 聊天冒烟的数据准备（v51，AISLG-138）：直连数据库预建官府等级、武将、战报与禁言状态，
// 这些在游戏里需要建造 / 招募 / 战斗才能得到，冒烟里直接写库以免等待。与 smoke-chat.ts 拆分存放。

import pg from 'pg';
import { insertBattleReport, type BattleReportDetail } from '../common/src/battle-db';
import { TROOP_KINDS } from '../common/src/protocol';

export function zeroArmy(): Record<string, number> {
  return Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0]));
}

/** 把账号主城的官府设到指定等级（聊天世界频道的发言门槛） */
export async function setGovernment(pool: pg.Pool, accountId: string, level: number): Promise<void> {
  await pool.query(
    `INSERT INTO city_buildings (city_id, kind, level)
     SELECT c.id, 'government', $2 FROM cities c WHERE c.account_id = $1 ORDER BY c.created_at LIMIT 1
     ON CONFLICT (city_id, kind) DO UPDATE SET level = EXCLUDED.level`,
    [accountId, level],
  );
}

export async function mainCityId(pool: pg.Pool, accountId: string): Promise<string> {
  const res = await pool.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [accountId]);
  return (res.rows[0] as { id: string }).id;
}

/** 给账号加一名武将，返回武将 id */
export async function addHero(pool: pg.Pool, accountId: string, name: string, famous: boolean): Promise<string> {
  const res = await pool.query(
    `INSERT INTO account_heroes (account_id, name, famous, lead, force, wit, level)
     VALUES ($1, $2, $3, 71, 66, 58, 4) RETURNING id`,
    [accountId, name, famous],
  );
  return (res.rows[0] as { id: string }).id;
}

/** 给账号写一条战报（作为攻方的野地战），返回战报序号 */
export async function addWildernessReport(pool: pg.Pool, accountId: string, attackerName: string): Promise<number> {
  const client = await pool.connect();
  try {
    const detail: BattleReportDetail = {
      x: 12,
      y: 34,
      kind: 'wilderness',
      role: 'attacker',
      won: true,
      rounds: 3,
      endReason: 'defender_wiped',
      attacker: { name: attackerName, troops: zeroArmy(), losses: zeroArmy(), survivors: zeroArmy(), damage: 120 },
      defender: { name: '野地 Lv3', troops: zeroArmy(), losses: zeroArmy(), survivors: zeroArmy(), damage: 0 },
      wallDefensePercent: 0,
      roundLog: [],
    } as unknown as BattleReportDetail;
    const view = await insertBattleReport(client, accountId, detail);
    return view.id;
  } finally {
    client.release();
  }
}

export async function setMutedUntil(pool: pg.Pool, accountId: string, until: string | null): Promise<void> {
  await pool.query(`UPDATE accounts SET chat_muted_until = $2::timestamptz WHERE id = $1`, [accountId, until]);
}

/** 写入一条「过期」的聊天消息（用于验证查询侧的保留期过滤） */
export async function insertAgedMessage(
  pool: pg.Pool,
  channel: 'world' | 'private',
  senderId: string,
  recipientId: string | null,
  text: string,
  ageDays: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_messages (channel, sender_id, recipient_id, text, created_at)
     VALUES ($1, $2, $3, $4, now() - make_interval(days => $5))`,
    [channel, senderId, recipientId, text, ageDays],
  );
}

/** 批量写入世界频道消息（用于验证条数上限的清理） */
export async function insertWorldBulk(pool: pg.Pool, senderId: string, count: number): Promise<void> {
  await pool.query(
    `INSERT INTO chat_messages (channel, sender_id, text)
     SELECT 'world', $1, 'bulk-' || g FROM generate_series(1, $2) AS g`,
    [senderId, count],
  );
}

export async function countRows(pool: pg.Pool, sql: string, params: unknown[]): Promise<number> {
  const res = await pool.query(sql, params);
  return Number((res.rows[0] as { n: string | number }).n);
}
