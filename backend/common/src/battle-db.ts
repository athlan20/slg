// 战报与侦察情报的数据库读写（v13；从规则层拆出，形态对齐 world-db.ts）。
// battle.ts 是纯引擎（不碰数据库）；本文件承载战报落库 / 查询与侦察情报快照，
// API（GET_BATTLE_REPORTS / GET_TILE）与 Worker（战斗结算 / 侦察到达）共用。

import pg from 'pg';
import type { BattleRoundLogEntryView, BattleReportView, BattleSideView, ScoutIntel } from './protocol-battle';
import { TROOP_STATS } from './battle';

// ---- 战报（battle_reports 表） ----

/** battle_reports 的行形态（detail 即战报视图载荷，读出时补 id / createdAt / comment） */
export interface BattleReportRow {
  id: number;
  account_id: string;
  x: number;
  y: number;
  kind: 'wilderness' | 'npc_city' | 'npc_raid' | 'city_raid' | 'intercept' | 'yellow_turban';
  detail: Omit<BattleReportView, 'id' | 'createdAt' | 'comment'> & { createdAt?: string };
  /** Agent 写回的点评（v23 AISLG-53；独立列，重写覆盖） */
  agent_comment?: string | null;
  agent_commented_at?: Date | null;
  created_at: Date;
}

/** detail 写入时的形态约束（生成方负责组装，读出方负责补全） */
export type BattleReportDetail = Omit<BattleReportView, 'id' | 'createdAt' | 'comment'>;

/** 战报侧视图的落库/组装基底（units / totalHp / avgRange / maxRange / rangedUnits 由 withSideStats 派生） */
export type BattleSideBase = Omit<BattleSideView, 'units' | 'totalHp' | 'avgRange' | 'maxRange' | 'rangedUnits'>;

/** 近战基准射程：超过该值视为远程位（v23 AISLG-49；当前兵种表里近战统一为 10） */
const MELEE_RANGE_BASE = 10;

/**
 * 由 troops 汇总派生字段（v21 AISLG-33 / AISLG-30；v23 AISLG-49 补 maxRange / rangedUnits）：
 * units 总单位数、totalHp 总血量、avgRange 编成平均射程（1 位小数；数量加权，会被
 * 大量近战稀释，不代表克制关系）、maxRange 单兵射程最大值、rangedUnits 远程单位数
 * （射程 > 近战基准）。读取时统一计算——历史战报（落库时无这些字段）与新战报的
 * 视图形态保持一致，客户端不需要分版本处理。
 */
export function withSideStats(side: BattleSideBase): BattleSideView {
  let units = 0;
  let totalHp = 0;
  let rangeSum = 0;
  let maxRange = 0;
  let rangedUnits = 0;
  for (const [kind, count] of Object.entries(side.troops) as [keyof typeof TROOP_STATS, number][]) {
    const n = Math.max(0, Math.floor(count ?? 0));
    if (n === 0) continue;
    const range = TROOP_STATS[kind].range;
    units += n;
    totalHp += n * TROOP_STATS[kind].hp;
    rangeSum += n * range;
    maxRange = Math.max(maxRange, range);
    if (range > MELEE_RANGE_BASE) {
      rangedUnits += n;
    }
  }
  const avgRange = units > 0 ? Math.round((rangeSum / units) * 10) / 10 : 0;
  return { ...side, units, totalHp, avgRange, maxRange, rangedUnits };
}

/** 行 → 视图（createdAt 用数据库时钟；comment 从独立列合并；detail 内其余字段原样透出）
 *  id 列为 bigserial，pg 默认以字符串返回 int8，这里统一转成 number，
 *  避免下游（如 PUSH_BATTLE_REPORT 的 Number.isInteger 判定）误判。 */
export function battleReportView(row: BattleReportRow): BattleReportView {
  return {
    ...row.detail,
    attacker: withSideStats(row.detail.attacker),
    defender: withSideStats(row.detail.defender),
    id: Number(row.id),
    comment:
      row.agent_comment && row.agent_commented_at
        ? { text: row.agent_comment, updatedAt: row.agent_commented_at.toISOString() }
        : null,
    createdAt: row.created_at.toISOString(),
  };
}

/** 落库一条战报，返回带 id 的完整视图（调用方负责事务；新战报尚无点评） */
export async function insertBattleReport(
  client: pg.PoolClient,
  accountId: string,
  detail: BattleReportDetail,
): Promise<BattleReportView> {
  const res = await client.query(
    `INSERT INTO battle_reports (account_id, x, y, kind, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, created_at`,
    [accountId, detail.defender ? detail.x : 0, detail.y, detail.kind, JSON.stringify(detail)],
  );
  const row = res.rows[0] as { id: number | string; created_at: Date };
  return {
    ...detail,
    attacker: withSideStats(detail.attacker),
    defender: withSideStats(detail.defender),
    id: Number(row.id),
    comment: null,
    createdAt: row.created_at.toISOString(),
  };
}

/** 查询账号战报（新→旧；beforeId 分页；limit 上限由调用方钳制） */
export async function listBattleReports(
  q: pg.Pool | pg.PoolClient,
  accountId: string,
  opts: { limit: number; beforeId?: number },
): Promise<BattleReportView[]> {
  const res = await q.query(
    `SELECT * FROM battle_reports
     WHERE account_id = $1 AND ($2::bigint IS NULL OR id < $2)
     ORDER BY id DESC
     LIMIT $3`,
    [accountId, opts.beforeId ?? null, opts.limit],
  );
  return (res.rows as BattleReportRow[]).map(battleReportView);
}

/**
 * Agent 写回战报点评（v23，AISLG-53；upsert 覆盖旧点评，commented_at 用数据库时钟）。
 * 仅当战报属于该账号时写入；没有匹配行返回 null（调用方转 INVALID_PARAMS）。
 */
export async function saveBattleReportComment(
  q: pg.Pool | pg.PoolClient,
  accountId: string,
  reportId: number,
  text: string,
): Promise<{ reportId: number; comment: { text: string; updatedAt: string } } | null> {
  const res = await q.query(
    `UPDATE battle_reports SET agent_comment = $3, agent_commented_at = now()
     WHERE id = $1 AND account_id = $2
     RETURNING agent_commented_at`,
    [reportId, accountId, text],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { agent_commented_at: Date };
  return { reportId, comment: { text, updatedAt: row.agent_commented_at.toISOString() } };
}

/** 按事件 id 取单条战报（通知直推用；不存在或非本账号返回 null） */
export async function loadBattleReport(
  q: pg.Pool | pg.PoolClient,
  accountId: string,
  reportId: number,
): Promise<BattleReportView | null> {
  const res = await q.query(
    `SELECT * FROM battle_reports WHERE id = $1 AND account_id = $2`,
    [reportId, accountId],
  );
  return res.rowCount ? battleReportView(res.rows[0] as BattleReportRow) : null;
}

// ---- 侦察情报（scout_intel 表：账号 × 地块 的最近快照） ----

/** 保存 / 覆盖某账号对某地块的情报快照（upsert；调用方负责事务） */
export async function saveScoutIntel(
  client: pg.PoolClient,
  accountId: string,
  intel: ScoutIntel,
): Promise<void> {
  await client.query(
    `INSERT INTO scout_intel (account_id, x, y, detail, scouted_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (account_id, x, y)
     DO UPDATE SET detail = $4::jsonb, scouted_at = now()`,
    [accountId, intel.x, intel.y, JSON.stringify(intel)],
  );
}

/** 读取情报快照（无记录返回 null） */
export async function loadScoutIntel(
  q: pg.Pool | pg.PoolClient,
  accountId: string,
  x: number,
  y: number,
): Promise<ScoutIntel | null> {
  const res = await q.query(
    `SELECT detail, scouted_at FROM scout_intel WHERE account_id = $1 AND x = $2 AND y = $3`,
    [accountId, x, y],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { detail: Omit<ScoutIntel, 'scoutedAt'>; scouted_at: Date };
  return { ...row.detail, scoutedAt: row.scouted_at.toISOString() };
}

/** 战报逐回合统计的写库形态（detail.roundLog 的元素；与视图同构） */
export type RoundLogEntry = BattleRoundLogEntryView;
