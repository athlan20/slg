// 全服战力排名查询（AISLG-247，v106）：老巢 20 营的战力锚点要看「第 10 名 / 第 3 名账号的单人战力」，
// 口径与 v101 的「前 10 名合计」相同（城内 + 野地驻军 + 协防 + 行军中，用 battle.ts 的参考战力 TROOP_POWER），
// 只是从求和改成取第 N 名。从 faction-lair-db.ts 分出来，避免那个文件把「战况读写」和「榜单查询」混在一起。
// 每营战力的公式与纯规则见 faction-lair.ts；刷新流程见 faction-lair-db.ts 的 refreshFactionLairPower。

import type pg from 'pg';
import { TROOP_KINDS } from './protocol';
import { TROOP_POWER } from './battle';
import { FACTION_LAIR_R10_RANK, FACTION_LAIR_R3_RANK } from './faction-lair';

type Queryable = pg.Pool | pg.PoolClient;

/** 兵种战力的 SQL 值表（与 common/src/battle.ts 的 TROOP_POWER 同源，不在 SQL 里再抄一份） */
function troopPowerValuesSql(): string {
  return TROOP_KINDS.map((kind) => `('${kind}'::text, ${Math.max(0, Number(TROOP_POWER[kind] ?? 0))}::bigint)`).join(', ');
}

/**
 * 全服战力第 rank 名账号的**单人**战力（AISLG-247）：全服战力要算城内、野地驻军、行军中和协防的全部部队。
 * 口径与 v101 的合计相同（同一套 CTE），只是不再求和：
 * - 城内：city_army（经 cities.account_id）；
 * - 野地驻军：tile_army（经 world_tiles.owner_city_id 归到城 / 账号）；
 * - 协防：city_assist.troops（驻在别人的城里，仍算自己的战力）；
 * - 行军中：marches.troops（status='marching'）。
 * 不足 rank 人时取最后一名（即战力最低的那个有兵的账号）；全服无兵返回 0。
 */
export async function serverPowerRank(q: Queryable, rank: number): Promise<number> {
  const res = await q.query(
    `WITH tp(troop, power) AS (VALUES ${troopPowerValuesSql()}),
     army AS (
       SELECT c.account_id, ca.troop, ca.count::bigint AS count
       FROM city_army ca JOIN cities c ON c.id = ca.city_id
       UNION ALL
       SELECT c.account_id, ta.troop, ta.count::bigint AS count
       FROM tile_army ta
       JOIN world_tiles wt ON wt.x = ta.x AND wt.y = ta.y
       JOIN cities c ON c.id = wt.owner_city_id
       UNION ALL
       SELECT ca.account_id, e.key AS troop, e.value::bigint AS count
       FROM city_assist ca, jsonb_each_text(ca.troops) AS e(key, value)
       UNION ALL
       SELECT m.account_id, e.key AS troop, e.value::bigint AS count
       FROM marches m, jsonb_each_text(m.troops) AS e(key, value)
       WHERE m.status = 'marching'
     ),
     per_account AS (
       SELECT army.account_id, sum(tp.power * greatest(army.count, 0))::bigint AS power
       FROM army JOIN tp ON tp.troop = army.troop
       GROUP BY army.account_id
       HAVING sum(tp.power * greatest(army.count, 0)) > 0
     ),
     ranked AS (
       SELECT power, row_number() OVER (ORDER BY power DESC) AS rn, count(*) OVER () AS n FROM per_account
     )
     SELECT power FROM ranked WHERE rn = LEAST($1::int, n)`,
    [Math.max(1, Math.floor(rank))],
  );
  const row = res.rows[0] as { power: string | number } | undefined;
  return row ? Number(row.power) : 0;
}

/** 老巢两个锚点用的排名战力（AISLG-247）：第 3 名与第 10 名的单人战力 */
export async function serverAnchorPowers(q: Queryable): Promise<{ r3: number; r10: number }> {
  const r3 = await serverPowerRank(q, FACTION_LAIR_R3_RANK);
  const r10 = await serverPowerRank(q, FACTION_LAIR_R10_RANK);
  return { r3, r10 };
}
