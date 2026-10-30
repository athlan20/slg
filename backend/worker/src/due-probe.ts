// Worker 的到期探针（AISLG-208）：一条不启事务的查询，合并回答「这 8 类到期队列现在有没有活」。
// 背景：Worker 每秒对每个队列各开一次事务做 SELECT，空闲时几乎全是空转（约 22 条/秒）。
// tick 先用本探针问一次；只有为真的队列才调用原来的 processDueXxx（原函数不改，仍用
// FOR UPDATE SKIP LOCKED 与条件守卫，探针与处理之间被别处抢先处理也安全）。
// 各条件与对应 processDueXxx 的领取条件保持一致，且都能走已有的按到期时间的部分索引：
// idx_builds_due / idx_recruits_due / idx_defense_crafts_due / idx_tech_research_due /
// idx_marches_due / idx_npc_attacks_due / idx_world_tiles_reserve_empty / idx_battlefield_squads_arrive。
// 战场行军额外限定在「最新的 active 事件」上，与 processBattlefieldMovements 的选取口径一致：
// 已结束事件的遗留小队（正常结束会 DELETE，异常残留也不会）不该让探针永远为真。

import type pg from 'pg';

/** 各到期队列当前是否有到期的活；字段名对应 index.ts 里的步骤 */
export interface DueProbe {
  builds: boolean;
  recruits: boolean;
  defenseCrafts: boolean;
  research: boolean;
  marches: boolean;
  npcAttacks: boolean;
  reserves: boolean;
  battlefieldMovements: boolean;
}

const PROBE_SQL = `
SELECT
  EXISTS (SELECT 1 FROM builds            WHERE status = 'building'    AND due_at <= now() LIMIT 1) AS builds,
  EXISTS (SELECT 1 FROM recruits          WHERE status = 'recruiting'  AND due_at <= now() LIMIT 1) AS recruits,
  EXISTS (SELECT 1 FROM defense_crafts    WHERE status = 'crafting'    AND due_at <= now() LIMIT 1) AS defense_crafts,
  EXISTS (SELECT 1 FROM tech_research     WHERE status = 'researching' AND due_at <= now() LIMIT 1) AS research,
  EXISTS (SELECT 1 FROM marches           WHERE status = 'marching'    AND arrive_at <= now() LIMIT 1) AS marches,
  EXISTS (SELECT 1 FROM npc_attacks       WHERE resolved_at IS NULL    AND arrive_at <= now() LIMIT 1) AS npc_attacks,
  EXISTS (SELECT 1 FROM world_tiles
          WHERE owner_city_id IS NOT NULL AND reserve_empty_at IS NOT NULL AND reserve_empty_at <= now() LIMIT 1) AS reserves,
  EXISTS (SELECT 1 FROM battlefield_squads s
          WHERE s.status = 'marching' AND s.arrive_at <= now()
            AND s.event_id = (SELECT id FROM battlefield_events WHERE status = 'active' ORDER BY signup_start DESC LIMIT 1)
          LIMIT 1) AS battlefield_movements
`;

/** 探针失败时的兜底：全部为真，退回逐步骤自检——宁可多查，不漏结算 */
export const ALL_DUE: DueProbe = {
  builds: true,
  recruits: true,
  defenseCrafts: true,
  research: true,
  marches: true,
  npcAttacks: true,
  reserves: true,
  battlefieldMovements: true,
};

/** 一条查询（pool.query：不开事务、不跨 tick 占连接）读出 8 类到期队列是否有活 */
export async function probeDueWork(pool: pg.Pool): Promise<DueProbe> {
  const res = await pool.query(PROBE_SQL);
  const row = res.rows[0] as Record<string, boolean> | undefined;
  if (!row) {
    return ALL_DUE;
  }
  return {
    builds: row.builds === true,
    recruits: row.recruits === true,
    defenseCrafts: row.defense_crafts === true,
    research: row.research === true,
    marches: row.marches === true,
    npcAttacks: row.npc_attacks === true,
    reserves: row.reserves === true,
    battlefieldMovements: row.battlefield_movements === true,
  };
}
