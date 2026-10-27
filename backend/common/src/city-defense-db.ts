// 城防器械的数据库存取（v73，AISLG-193）：库存、打造队列与用量扣减。
// 规则与数值见 city-defense.ts；API（打造 / 取消 / 视图）与 Worker（到期入库、守城战扣库存）共用。
// 锁序与征兵一致：队列行（条件翻转）→ 城池行。

import pg from 'pg';
import { RESOURCE_KEYS, type InitiatorRole, type Resources } from './protocol';
import {
  DEFENSE_KINDS,
  defenseDamage,
  isDefenseKind,
  type DefenseKind,
  type DefenseStock,
} from './city-defense';
import type { DefenseCraftView, DefenseScoutView, DefenseUseView } from './protocol-defense';
import type { ScoutDetail } from './tech';

type Queryable = pg.Pool | pg.PoolClient;

/** defense_crafts 行（status：crafting / queued / completed / cancelled） */
export interface DefenseCraftRow {
  id: string;
  account_id: string;
  city_id: string;
  kind: string;
  count: number;
  status: string;
  initiator: string;
  cost: Resources | Record<string, never>;
  unit_seconds: number;
  started_at: Date;
  due_at: Date | null;
  completed_at: Date | null;
}

/** 库存（恒含四个键，缺行 = 0） */
export function emptyDefenseStock(): Record<DefenseKind, number> {
  return { trap: 0, chevaux: 0, rolling_log: 0, boulder: 0 };
}

/** 读取某城的器械库存（缺行 = 0） */
export async function loadCityDefenses(q: Queryable, cityId: string): Promise<Record<DefenseKind, number>> {
  const res = await q.query(`SELECT kind, count FROM city_defenses WHERE city_id = $1`, [cityId]);
  const stock = emptyDefenseStock();
  for (const row of res.rows as Array<{ kind: string; count: number }>) {
    if (isDefenseKind(row.kind)) {
      stock[row.kind] = Math.max(0, Math.floor(row.count));
    }
  }
  return stock;
}

/** 已入库合计 */
export function defenseStockTotal(stock: DefenseStock): number {
  return DEFENSE_KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(stock[kind] ?? 0)), 0);
}

/** 在造 + 排队的件数合计（库存上限校验要把这部分算进去，防超卖） */
export async function loadPendingDefenseCount(q: Queryable, cityId: string): Promise<number> {
  const res = await q.query(
    `SELECT COALESCE(sum(count), 0)::int AS pending FROM defense_crafts
     WHERE city_id = $1 AND status IN ('crafting', 'queued')`,
    [cityId],
  );
  return Math.max(0, Number((res.rows[0] as { pending: number } | undefined)?.pending ?? 0));
}

/** 打造队列数量（在造 / 排队分开，队列容量判定用） */
export async function loadDefenseQueueCounts(q: Queryable, cityId: string): Promise<{ active: number; queued: number }> {
  const res = await q.query(
    `SELECT status, count(*)::int AS n FROM defense_crafts
     WHERE city_id = $1 AND status IN ('crafting', 'queued') GROUP BY status`,
    [cityId],
  );
  let active = 0;
  let queued = 0;
  for (const row of res.rows as Array<{ status: string; n: number }>) {
    if (row.status === 'crafting') {
      active = Number(row.n);
    } else if (row.status === 'queued') {
      queued = Number(row.n);
    }
  }
  return { active, queued };
}

/** 按 id 读取一条打造记录（API 推送 / 排查用） */
export async function loadDefenseCraft(q: Queryable, craftId: string): Promise<DefenseCraftRow | null> {
  const res = await q.query(`SELECT * FROM defense_crafts WHERE id = $1`, [craftId]);
  return res.rowCount ? (res.rows[0] as DefenseCraftRow) : null;
}

/** 该城进行中的打造队列（在造在前，其余按入队顺序） */
export async function loadDefenseCrafts(q: Queryable, cityId: string): Promise<DefenseCraftRow[]> {
  const res = await q.query(
    `SELECT * FROM defense_crafts
     WHERE city_id = $1 AND status IN ('crafting', 'queued')
     ORDER BY CASE WHEN status = 'crafting' THEN 0 ELSE 1 END, started_at, id`,
    [cityId],
  );
  return res.rows as DefenseCraftRow[];
}

/** 行 → 视图（cost 缺项补 0；dueAt 仅 crafting 有值） */
export function defenseCraftView(row: DefenseCraftRow): DefenseCraftView {
  const raw = (row.cost ?? {}) as Partial<Resources>;
  const cost = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 } as Resources;
  for (const key of RESOURCE_KEYS) {
    cost[key] = typeof raw[key] === 'number' ? (raw[key] as number) : 0;
  }
  return {
    id: row.id,
    cityId: row.city_id,
    kind: isDefenseKind(row.kind) ? row.kind : 'trap',
    count: Math.max(0, Math.floor(row.count)),
    status:
      row.status === 'completed' ? 'completed' : row.status === 'cancelled' ? 'cancelled' : row.status === 'queued' ? 'queued' : 'crafting',
    initiator: (row.initiator === 'agent' ? 'agent' : 'player') as InitiatorRole,
    cost,
    unitSeconds: Math.max(0, Math.floor(row.unit_seconds ?? 0)),
    startedAt: row.started_at.toISOString(),
    dueAt: row.due_at ? row.due_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

/** 入库（按件数累加；不改上限，调用方负责按 cap 钳制前的校验） */
export async function addCityDefenseStock(q: Queryable, cityId: string, kind: DefenseKind, count: number): Promise<void> {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) {
    return;
  }
  await q.query(
    `INSERT INTO city_defenses (city_id, kind, count) VALUES ($1, $2, $3)
     ON CONFLICT (city_id, kind) DO UPDATE SET count = city_defenses.count + EXCLUDED.count, updated_at = now()`,
    [cityId, kind, n],
  );
}

/** 守城战后扣库存：按引擎返回的用量逐项扣减（GREATEST 0 防负数） */
export async function consumeCityDefenses(q: Queryable, cityId: string, uses: DefenseUseView[]): Promise<void> {
  for (const use of uses) {
    if (use.used <= 0) {
      continue;
    }
    await q.query(
      `UPDATE city_defenses SET count = GREATEST(0, count - $3), updated_at = now()
       WHERE city_id = $1 AND kind = $2`,
      [cityId, use.kind, Math.floor(use.used)],
    );
  }
}

/**
 * 侦察情报里的器械（按侦察科技三档降级）：rough 只有 has；kinds 给有库存的种类；exact 给件数。
 * 与侦察报告同口径，重复侦察结果一致（库存不变时）。
 */
export function degradeDefenses(stock: DefenseStock, detail: ScoutDetail): DefenseScoutView {
  const counts = emptyDefenseStock();
  for (const kind of DEFENSE_KINDS) {
    counts[kind] = Math.max(0, Math.floor(stock[kind] ?? 0));
  }
  const has = DEFENSE_KINDS.some((kind) => counts[kind] > 0);
  if (detail === 'exact') {
    return { detail, has, counts };
  }
  const kinds = DEFENSE_KINDS.filter((kind) => counts[kind] > 0);
  if (detail === 'kinds') {
    return { detail, has, kinds };
  }
  return { detail, has };
}

/** 用量视图（引擎只给 kind / used / killed；伤害按单件固定伤害折算） */
export function defenseUseView(kind: DefenseKind, used: number, killed: number): DefenseUseView {
  return { kind, used, damage: used * defenseDamage(kind), killed };
}
