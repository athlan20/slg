// 科技的数据库存取（v27，AISLG-77）：账号科技等级与进行中研究。
// 等级只由 Worker 在研究到期时写入（account_techs）；API 发起 / 取消研究只动 tech_research。

import pg from 'pg';
import { RESOURCE_KEYS, type InitiatorRole, type ResearchView, type Resources } from './protocol';
import { emptyTechLevels, isTechKind, type TechKind, type TechLevels } from './tech';

type Queryable = pg.Pool | pg.PoolClient;

/** tech_research 行（status：researching / completed / cancelled） */
export interface TechResearchRow {
  id: string;
  account_id: string;
  city_id: string;
  tech: string;
  level: number;
  status: string;
  initiator: string;
  cost: Resources | Record<string, never>;
  started_at: Date;
  due_at: Date;
  completed_at: Date | null;
}

/** 账号科技等级（缺行 = 0 级） */
export async function loadTechLevels(q: Queryable, accountId: string): Promise<TechLevels> {
  const res = await q.query(`SELECT tech, level FROM account_techs WHERE account_id = $1`, [accountId]);
  const levels = emptyTechLevels();
  for (const row of res.rows as Array<{ tech: string; level: number }>) {
    if (isTechKind(row.tech)) {
      levels[row.tech] = row.level;
    }
  }
  return levels;
}

/** 按城池反查所属账号的科技等级（结算生产等只有 cityId 的场合）；城池不存在返回全 0 */
export async function loadTechLevelsByCity(q: Queryable, cityId: string): Promise<TechLevels> {
  const res = await q.query(
    `SELECT t.tech, t.level FROM cities c JOIN account_techs t ON t.account_id = c.account_id WHERE c.id = $1`,
    [cityId],
  );
  const levels = emptyTechLevels();
  for (const row of res.rows as Array<{ tech: string; level: number }>) {
    if (isTechKind(row.tech)) {
      levels[row.tech] = row.level;
    }
  }
  return levels;
}

/** 账号进行中的研究（至多一条）；无则 null */
export async function loadActiveResearch(q: Queryable, accountId: string): Promise<TechResearchRow | null> {
  const res = await q.query(
    `SELECT * FROM tech_research WHERE account_id = $1 AND status = 'researching' LIMIT 1`,
    [accountId],
  );
  return res.rowCount ? (res.rows[0] as TechResearchRow) : null;
}

/** 研究行 → 视图（API 推送与 Worker 完成通知共用；cost 缺项补 0） */
export function researchView(row: TechResearchRow): ResearchView {
  const raw = (row.cost ?? {}) as Partial<Resources>;
  const cost = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 } as Resources;
  for (const key of RESOURCE_KEYS) {
    cost[key] = typeof raw[key] === 'number' ? (raw[key] as number) : 0;
  }
  return {
    id: row.id,
    cityId: row.city_id,
    tech: (isTechKind(row.tech) ? row.tech : 'farming') as TechKind,
    level: row.level,
    status: row.status === 'completed' ? 'completed' : row.status === 'cancelled' ? 'cancelled' : 'researching',
    initiator: (row.initiator === 'agent' ? 'agent' : 'player') as InitiatorRole,
    cost,
    startedAt: row.started_at.toISOString(),
    dueAt: row.due_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}
