// 仅主城建筑（酒馆 / 书院，v87 AISLG-217）的存量数据迁移与在建条目处理。
// - migrateMainOnlyBuildings：上线时一次性、幂等——每账号取所有城的酒馆（书院）最高等级写到主城，
//   分城的这两项 city_buildings 行删除，分城在建 / 排队的这两项取消并按取消规则全额返还到该分城，
//   分城的酒馆候选清空（候选从此只有主城一份）。
// - cancelMainOnlyBuilds：换主城（AISLG-205）时取消两城在建 / 排队的酒馆与书院并返还，规则同迁移。
// - swapMainOnlyBuildings：换主城时两城的酒馆 / 书院记录互换（等级跟着「主城」身份走）。
// 迁移天然幂等：跑过一次之后分城不再有这两项，再跑没有可处理的行；返还也只随被取消的条目发生一次。
// 进行中的科技研究不受影响（研究记录与科技等级都不在这里动）。
// 锁序：先 builds（条件翻转）再 cities（返还），与 Worker 的完成路径一致，不引入新的死锁环。

import type pg from 'pg';
import { MAIN_CITY_ONLY_KINDS } from './rules';
import { cancelRefundOf, type RefundableBuildRow } from './build-cancel';
import { activateQueuedBuilds } from './queue-activate';

type Client = pg.PoolClient;

/** 非主城（分城）的判定：主城 = 账号名下 created_at 最早的城（与 views.ts lockCitySnapshot 同一口径） */
const BRANCH_CITY_SQL = `c.id <> (SELECT m.id FROM cities m WHERE m.account_id = c.account_id ORDER BY m.created_at, m.id LIMIT 1)`;

/** 被取消的条目（附返还额），供调用方记录 / 推送 */
export interface CancelledMainOnlyBuild {
  id: string;
  cityId: string;
  kind: string;
  refund: ReturnType<typeof cancelRefundOf>;
}

/** 已翻转成 cancelled 的条目：按取消规则返还到它所属的城，并让让出在建位的排队条目照常开工 */
async function refundCancelled(client: Client, rows: Array<RefundableBuildRow & { id: string; city_id: string }>): Promise<CancelledMainOnlyBuild[]> {
  const cancelled: CancelledMainOnlyBuild[] = [];
  for (const row of rows) {
    const refund = cancelRefundOf(row);
    await client.query(
      `UPDATE cities SET gold = gold + $2, wood = wood + $3, food = food + $4, stone = stone + $5, iron = iron + $6
       WHERE id = $1`,
      [row.city_id, refund.gold, refund.wood, refund.food, refund.stone, refund.iron],
    );
    cancelled.push({ id: row.id, cityId: row.city_id, kind: row.kind, refund });
  }
  if (cancelled.length > 0) {
    // 让出的在建位由本城排队的下一条接上（与 Worker / CANCEL_BUILD 同一激活写法）
    for (const cityId of new Set(cancelled.map((item) => item.cityId))) {
      await activateQueuedBuilds(client, cityId);
    }
  }
  return cancelled;
}

/**
 * 取消指定城里酒馆 / 书院的在建与排队条目，成本按取消规则全额返还到该城（不钳储量上限，
 * 与 CANCEL_BUILD 同口径），并让让出在建位的排队条目照常开工。
 * 调用方须已持有这些城池的行锁（锁序 builds → cities，与 Worker 一致）。
 */
export async function cancelMainOnlyBuilds(client: Client, cityIds: readonly string[]): Promise<CancelledMainOnlyBuild[]> {
  if (cityIds.length === 0) {
    return [];
  }
  // 条件翻转即守卫：与 CANCEL_BUILD / Worker 的领取写法一致，并发下只有一方生效
  const upd = await client.query(
    `UPDATE builds SET status = 'cancelled', due_at = NULL, completed_at = NULL
     WHERE city_id = ANY($1::uuid[]) AND kind = ANY($2::text[]) AND status IN ('building', 'queued')
     RETURNING *`,
    [cityIds, [...MAIN_CITY_ONLY_KINDS]],
  );
  return refundCancelled(client, upd.rows as Array<RefundableBuildRow & { id: string; city_id: string }>);
}

/**
 * 换主城用：取消本账号主城与目标城在建 / 排队的酒馆与书院并返还（规则同迁移）。
 * 与 cancelMainOnlyBuilds 的区别是城市对在 SQL 里按「账号最早创建的城 + 目标城」自算，
 * 因此可以在加城池行锁之前执行——保持 builds → cities 的锁序（不制造与 Worker 的死锁环）。
 */
export async function cancelMainOnlyBuildsForSwap(
  client: Client,
  accountId: string,
  targetCityId: string,
): Promise<CancelledMainOnlyBuild[]> {
  const upd = await client.query(
    `UPDATE builds b SET status = 'cancelled', due_at = NULL, completed_at = NULL
     FROM cities c
     WHERE c.id = b.city_id AND c.account_id = $1
       AND b.kind = ANY($3::text[]) AND b.status IN ('building', 'queued')
       AND (c.id = $2::uuid
            OR c.id = (SELECT m.id FROM cities m WHERE m.account_id = $1 ORDER BY m.created_at, m.id LIMIT 1))
     RETURNING b.*`,
    [accountId, targetCityId, [...MAIN_CITY_ONLY_KINDS]],
  );
  return refundCancelled(client, upd.rows as Array<RefundableBuildRow & { id: string; city_id: string }>);
}

/** 某城某建筑写到指定等级（0 = 删除该行） */
async function setKindLevel(client: Client, cityId: string, kind: string, level: number): Promise<void> {
  if (level > 0) {
    await client.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, $2, $3)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = EXCLUDED.level, updated_at = now()`,
      [cityId, kind, level],
    );
    return;
  }
  await client.query(`DELETE FROM city_buildings WHERE city_id = $1 AND kind = $2`, [cityId, kind]);
}

/**
 * 换主城（v82 AISLG-205，v87 起）：两座城的酒馆 / 书院记录一并互换——等级跟着「主城」身份走，
 * 新主城拿到原主城的等级，原主城（现分城）不再持有这两项。调用方须已持有两城行锁。
 */
export async function swapMainOnlyBuildings(client: Client, cityAId: string, cityBId: string): Promise<void> {
  for (const kind of MAIN_CITY_ONLY_KINDS) {
    const res = await client.query(
      `SELECT city_id, level FROM city_buildings WHERE city_id = ANY($1::uuid[]) AND kind = $2`,
      [[cityAId, cityBId], kind],
    );
    const levels = new Map((res.rows as Array<{ city_id: string; level: number }>).map((row) => [row.city_id, row.level]));
    const levelA = levels.get(cityAId) ?? 0;
    const levelB = levels.get(cityBId) ?? 0;
    await setKindLevel(client, cityAId, kind, levelB);
    await setKindLevel(client, cityBId, kind, levelA);
  }
}

/** 清空指定城的酒馆候选（v87：候选账号只有一份，换主城后由新主城重新刷新一批） */
export async function clearTavernCandidates(client: Client, cityIds: readonly string[]): Promise<void> {
  if (cityIds.length === 0) {
    return;
  }
  await client.query(`DELETE FROM tavern_candidates WHERE city_id = ANY($1::uuid[])`, [cityIds]);
}

/**
 * 上线迁移（v87，AISLG-217）：把酒馆 / 书院收敛到主城。幂等，可在每次启动的 ensureSchema 里执行。
 * 顺序：先取消分城在建 / 排队条目（返还到该分城）→ 再把全账号最高等级合并到主城 → 删分城建筑行；
 * 最后清空分城酒馆候选。主城原有等级更高时保持不变。
 */
export async function migrateMainOnlyBuildings(client: Client): Promise<void> {
  const kinds = [...MAIN_CITY_ONLY_KINDS];

  // 1. 分城在建 / 排队的两项：取消并全额返还到该分城（建造成本本就是从这个城扣的）
  const branchRes = await client.query(
    `SELECT c.id FROM cities c
     WHERE ${BRANCH_CITY_SQL}
       AND EXISTS (SELECT 1 FROM builds b
                   WHERE b.city_id = c.id AND b.kind = ANY($1::text[]) AND b.status IN ('building', 'queued'))`,
    [kinds],
  );
  await cancelMainOnlyBuilds(client, (branchRes.rows as Array<{ id: string }>).map((row) => row.id));

  // 2. 每账号每项取所有城的最高等级，写到主城（主城原有等级更高时取主城的）
  for (const kind of kinds) {
    await client.query(
      `INSERT INTO city_buildings (city_id, kind, level)
       SELECT m.id, $1, s.max_level
       FROM (SELECT DISTINCT ON (account_id) id, account_id FROM cities ORDER BY account_id, created_at, id) m
       JOIN LATERAL (
         SELECT max(b.level)::int AS max_level
         FROM city_buildings b JOIN cities c ON c.id = b.city_id
         WHERE c.account_id = m.account_id AND b.kind = $1
       ) s ON s.max_level IS NOT NULL
       ON CONFLICT (city_id, kind) DO UPDATE
         SET level = EXCLUDED.level, updated_at = now()
       WHERE city_buildings.level < EXCLUDED.level`,
      [kind],
    );
  }

  // 3. 分城里的这两项建筑行删除（等级已合并到主城，避免分城继续持有无效等级）
  await client.query(
    `DELETE FROM city_buildings b USING cities c
     WHERE c.id = b.city_id AND ${BRANCH_CITY_SQL} AND b.kind = ANY($1::text[])`,
    [kinds],
  );

  // 4. 酒馆候选账号只有一份（存在主城）；分城的旧候选一并清掉
  await client.query(
    `DELETE FROM tavern_candidates t USING cities c
     WHERE c.id = t.city_id AND ${BRANCH_CITY_SQL}`,
  );
}
