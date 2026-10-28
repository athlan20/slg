// 设为主城（v82，AISLG-205）的数据读取：冷却记录、来袭判定与 GET_STATE 的 capitalSwap 视图。
// 写入（对调身份、记冷却）在 API 的 handlers-capital.ts 事务内完成；判定规则在 capital-swap.ts。

import type pg from 'pg';
import { effectiveLevelSql } from './production';
import { settleDurability } from './protection';
import { repairPercent } from './tech';
import { loadTechLevels } from './tech-db';
import { capitalSwapDenial } from './capital-swap';
import type { CapitalSwapBlockCode, CapitalSwapView } from './protocol-city';

/**
 * 有他人玩家的出征正奔向本账号任一城或任一块野地（设为主城的来袭判定，与「有人来袭」预警同一数据源）。
 * 只认掠夺 / 占领两类攻击出征（即会触发 player_attack_warning 的那些），NPC 来袭不算。
 */
export async function loadIncomingAttack(q: pg.Pool | pg.PoolClient, accountId: string): Promise<boolean> {
  const res = await q.query(
    `SELECT 1 FROM marches m
     JOIN world_tiles wt ON wt.x = m.x AND wt.y = m.y
     WHERE wt.owner_city_id IN (SELECT id FROM cities WHERE account_id = $1)
       AND m.status = 'marching'
       AND m.purpose IN ('plunder', 'occupy')
       AND m.account_id <> $1
     LIMIT 1`,
    [accountId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * GET_STATE 的 capitalSwap 视图：冷却截止（仅未结束时给出）、来袭状态，以及逐分城的不可设原因。
 * 逐城原因只含与城本身有关的判定（名城 / 城防未满 / 分城数超新上限），冷却与来袭是账号级的，单独给出。
 */
export async function loadCapitalSwapView(q: pg.Pool | pg.PoolClient, accountId: string): Promise<CapitalSwapView> {
  // 时间取数据库 now()，与其它到期判定同口径
  const cooldownRes = await q.query(
    `SELECT (SELECT until FROM capital_swaps WHERE account_id = $1) AS until, now() AS db_now`,
    [accountId],
  );
  const cooldownRow = cooldownRes.rows[0] as { until: Date | null; db_now: Date };
  const now = cooldownRow.db_now;
  const cooldownUntil = cooldownRow.until && cooldownRow.until.getTime() > now.getTime() ? cooldownRow.until : null;

  const cityRes = await q.query(
    `SELECT c.id, c.famous_name, c.durability, c.durability_settled_at, c.truce_until,
            COALESCE(${effectiveLevelSql('g.level', "'government'", 'c.famous_name')}, 0)::int AS government
     FROM cities c LEFT JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government'
     WHERE c.account_id = $1
     ORDER BY c.created_at`,
    [accountId],
  );
  const rows = cityRes.rows as Array<{
    id: string;
    famous_name: string | null;
    durability: number | null;
    durability_settled_at: Date | null;
    truce_until: Date | null;
    government: number;
  }>;
  const techs = await loadTechLevels(q, accountId);
  const blocked: Record<string, CapitalSwapBlockCode> = {};
  // rows[0] 是主城，不参与；分城逐个判定（冷却 / 来袭为账号级，此处传空）
  for (const row of rows.slice(1)) {
    const denial = capitalSwapDenial({
      famous: row.famous_name !== null,
      cooldownUntil: null,
      underAttack: false,
      durability: settleDurability(row.durability, row.durability_settled_at, row.truce_until, now, repairPercent(techs)),
      branchCount: rows.length - 1,
      newMainGovernment: row.government,
      now,
    });
    if (denial && denial.code !== 'CAPITAL_SWAP_COOLDOWN' && denial.code !== 'CAPITAL_SWAP_UNDER_ATTACK') {
      blocked[row.id] = denial.code;
    }
  }
  return {
    cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
    underAttack: await loadIncomingAttack(q, accountId),
    blocked,
  };
}
