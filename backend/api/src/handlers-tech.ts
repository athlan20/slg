// 科技研究协议的处理逻辑（v27，AISLG-77）：GET_TECHS / RESEARCH_TECH / CANCEL_RESEARCH。
// 科技账号共享、同一时间只研究一项；发起时在发起城上扣成本（书院等级按该城判定），
// 取消全额返还到同一座城；到期由 Worker 结算（worker/src/tech-tick.ts）。
// 锁序：研究行（取消路径条件翻转）→ 城池行，与 Worker 的领取顺序一致。

import pg from 'pg';
import {
  EventType,
  Op,
  RESOURCE_KEYS,
  isTechKind,
  type InitiatorRole,
  type Resources,
  type TechEntryView,
  type TechStateView,
} from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadBuildingLevels } from '../../common/src/production';
import {
  MAX_TECH_LEVEL,
  TECH_INFO,
  TECH_KINDS,
  researchSeconds,
  startResearch,
  techCost,
  type TechLevels,
} from '../../common/src/tech';
import { loadActiveResearch, loadTechLevels, researchView, type TechResearchRow } from '../../common/src/tech-db';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { currentCityId } from './city-scope';
import { loadCityState, lockCitySnapshot } from './views';

/** 当前请求选定城的 id（scope 缺省 = 账号主城）；账号无城返回 null */
async function scopedCityId(pool: pg.Pool | pg.PoolClient, accountId: string): Promise<string | null> {
  const res = await pool.query(
    `SELECT id FROM cities WHERE account_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
     ORDER BY created_at LIMIT 1`,
    [accountId, currentCityId() ?? null],
  );
  return res.rowCount ? (res.rows[0] as { id: string }).id : null;
}

/** 科技状态视图：每项科技的当前等级 + 下一级成本 / 耗时 / 书院门槛，以及进行中的研究 */
export function buildTechState(
  levels: TechLevels,
  academyLevel: number,
  research: TechResearchRow | null,
): TechStateView {
  const techs: TechEntryView[] = TECH_KINDS.map((kind) => {
    const info = TECH_INFO[kind];
    const level = levels[kind];
    const nextLevel = level + 1;
    return {
      kind,
      label: info.label,
      level,
      maxLevel: MAX_TECH_LEVEL,
      percentPerLevel: info.percentPerLevel,
      effect: info.effect,
      currentPercent: info.percentPerLevel * level,
      next:
        level >= MAX_TECH_LEVEL
          ? null
          : {
              level: nextLevel,
              cost: techCost(kind, nextLevel),
              seconds: researchSeconds(nextLevel),
              academyRequired: nextLevel,
              academyOk: academyLevel >= nextLevel,
            },
    };
  });
  return { academyLevel, techs, research: research ? researchView(research) : null };
}

/** GET_TECHS：账号科技 + 当前（或指定）城的书院等级 + 进行中研究 */
export async function handleGetTechs(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const cityId = await scopedCityId(ctx.pool, accountId);
  const client = await ctx.pool.connect();
  try {
    const academy = cityId ? (await loadBuildingLevels(client, cityId)).academy : 0;
    const levels = await loadTechLevels(client, accountId);
    const research = await loadActiveResearch(client, accountId);
    respondOk(ctx.registry, conn, op, seq, { ...buildTechState(levels, academy, research) });
  } finally {
    client.release();
  }
}

/** RESEARCH_TECH：校验（满级 → 已有研究 → 书院 → 资源）、扣成本、写研究记录 */
export async function handleResearchTech(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const tech = data?.tech;
  if (!isTechKind(tech)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const active = await loadActiveResearch(client, accountId);
    const verdict = startResearch(tech, snap.techs, snap.levels.academy, snap.resources, active !== null);
    if (!verdict.ok) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, verdict.code, {
        ...(cityState ? { city: cityState } : {}),
        ...(verdict.academyRequired !== undefined ? { academyRequired: verdict.academyRequired, academyLevel: snap.levels.academy } : {}),
      });
      return;
    }
    const { cost, level, seconds } = verdict;
    await client.query(
      `UPDATE cities SET gold = gold - $2, wood = wood - $3, food = food - $4, stone = stone - $5, iron = iron - $6
       WHERE id = $1`,
      [snap.cityId, cost.gold, cost.wood, cost.food, cost.stone, cost.iron],
    );
    let row: TechResearchRow;
    try {
      const ins = await client.query(
        `INSERT INTO tech_research (account_id, city_id, tech, level, status, initiator, cost, due_at)
         VALUES ($1, $2, $3, $4, 'researching', $5, $6::jsonb, now() + make_interval(secs => $7))
         RETURNING *`,
        [accountId, snap.cityId, tech, level, role, JSON.stringify(cost), seconds],
      );
      row = ins.rows[0] as TechResearchRow;
    } catch (err) {
      // 唯一索引：并发在另一座城同时发起研究，后到者按「已有研究」拒绝
      if ((err as { code?: string }).code === '23505') {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'RESEARCH_IN_PROGRESS');
        return;
      }
      throw err;
    }
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: row.id,
      type: EventType.RESEARCH_STARTED,
      initiator: role,
      detail: { tech, level, cost, cityId: snap.cityId, dueAt: row.due_at.toISOString() },
    });
    await client.query('COMMIT');

    const view = researchView(row);
    respondOk(ctx.registry, conn, op, seq, { research: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_TECH_STATE, push: true, data: { reason: 'research_started', research: view, level: snap.techs[tech] } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** CANCEL_RESEARCH：条件翻转进行中的研究为 cancelled，成本全额返还到发起城 */
export async function handleCancelResearch(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const rawId = data?.researchId;
  if (rawId !== undefined && rawId !== null && (typeof rawId !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawId))) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE tech_research SET status = 'cancelled', completed_at = NULL
       WHERE account_id = $1 AND status = 'researching' AND due_at > now() AND ($2::uuid IS NULL OR id = $2::uuid)
       RETURNING *`,
      [accountId, rawId ?? null],
    );
    if (!upd.rowCount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'RESEARCH_NOT_CANCELLABLE');
      return;
    }
    const row = upd.rows[0] as TechResearchRow;
    const snap = await lockCitySnapshot(client, accountId, row.city_id);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    // 返还不受仓储上限钳制（与建造取消同规则）
    const refund = researchView(row).cost;
    const refunded: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      refunded[key] += refund[key];
    }
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [snap.cityId, refunded.gold, refunded.wood, refunded.food, refunded.stone, refunded.iron],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: row.id,
      type: EventType.RESEARCH_CANCELLED,
      initiator: role,
      detail: { tech: row.tech, level: row.level, refund },
    });
    await client.query('COMMIT');

    const view = researchView(row);
    respondOk(ctx.registry, conn, op, seq, { research: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_TECH_STATE, push: true, data: { reason: 'research_cancelled', research: view, level: snap.techs[view.tech] } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
