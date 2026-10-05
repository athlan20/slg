// 战斗类协议的处理逻辑（v13）：SCOUT 斥候侦察 / RECALL_MARCH 行军途中撤回 /
// GET_BATTLE_REPORTS 战报查询。协议分发见 handlers.ts。
// 共同约定：
// - SCOUT 从主城派出斥候（purpose='scout'，按斥候行军速度），到达由 Worker 产出
//   情报快照（事件 + scout_intel）并自动返程；本 handler 只做校验与建行军；
// - RECALL_MARCH 锁 marches 行后翻转 purpose='return'：arrive_at = now + 已走时长
//   （同速折返）。锁序 marches → （不锁城 / 地块），与 Worker 领取行军的锁序一致，
//   不构成死锁环；
// - GET_BATTLE_REPORTS 按账号倒序分页（beforeId 游标）。

import { marchingPercent } from '../../common/src/tech';
import { Op, EventType, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { listBattleReports, saveBattleReportComment } from '../../common/src/battle-db';
import { inWorld, marchTravelSeconds } from '../../common/src/world';
import { activeAt, inNewbieProtection } from '../../common/src/protection';
import { breakNewbieProtection } from './pvp';
import { readIntInRange, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { deployCountOf, loadCityState, lockCitySnapshot, marchView, type MarchRow } from './views';
import { canDeployMore } from '../../common/src/building-effects';
import { checkHeroMarchable } from './handlers-hero';

/** 战报点评正文的长度上限（v23 AISLG-53；占位值随需求「已定」标注可调） */
const BATTLE_COMMENT_MAX = 200;

const HERO_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SCOUT 请求参数校验：坐标在世界内 + 数量 1..100；v36（AISLG-114）可选 heroId（UUID，缺省不带队） */
export function readScoutParams(
  data: Record<string, unknown> | undefined,
): { x: number; y: number; count: number; heroId: string | null } | null {
  const x = data?.x;
  const y = data?.y;
  const count = data?.count;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inWorld(x as number, y as number)) {
    return null;
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 100) {
    return null;
  }
  const heroId = data?.heroId;
  if (heroId === undefined || heroId === null) {
    return { x: x as number, y: y as number, count, heroId: null };
  }
  if (typeof heroId !== 'string' || !HERO_UUID_RE.test(heroId)) {
    return null;
  }
  return { x: x as number, y: y as number, count, heroId };
}

/**
 * SCOUT：从主城派 count 名斥候侦察目标地块（不战斗）。目标限制：任意非本账号
 * 城池的地块（自己的城池实时可见，侦察无意义 → INVALID_PARAMS）。
 */
export async function handleScout(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  x: number,
  y: number,
  count: number,
  heroId: string | null = null,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 锁序与出征一致（cities → world_tiles）
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    if (snap.x === null || snap.y === null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    if (!canDeployMore(deployCountOf(snap), snap.levels.parade_ground)) {
      // v30（AISLG-80）：侦察同样占一支在外部队
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'DEPLOY_LIMIT', cityState ? { city: cityState } : undefined);
      return;
    }
    if (snap.army.scout < count) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_TROOPS', cityState ? { city: cityState } : undefined);
      return;
    }
    // v36（AISLG-114）：随队武将校验（同一套口径：未重伤 / 欠饷 / 随行、未任城守）
    let scoutHero: { id: string; name: string } | null = null;
    if (heroId) {
      const verdict = await checkHeroMarchable(client, accountId, heroId);
      if (!verdict.ok) {
        await client.query('ROLLBACK');
        const cityState = await loadCityState(ctx.pool, accountId);
        respondError(ctx.registry, conn, op, seq, verdict.code, cityState ? { city: cityState } : undefined);
        return;
      }
      scoutHero = { id: verdict.hero.id, name: verdict.hero.name };
    }
    const tileRes = await client.query(`SELECT kind, owner_city_id, npc FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [x, y]);
    const tile = (tileRes.rowCount ? tileRes.rows[0] : null) as
      | { kind: string; owner_city_id: string | null; npc: unknown }
      | null;
    // v38（AISLG-122）：侦察其他玩家的城池——守方新手保护期内不可被侦察（免战只拦攻击不拦侦察）；
    // 攻方处于新手保护期则因主动侦察立即失效。记录目标账号供下方破保使用
    let pvpTarget: { accountId: string; username: string } | null = null;
    if (tile && tile.kind === 'city' && tile.owner_city_id) {
      const ownerRes = await client.query(
        `SELECT c.account_id, a.username, a.newbie_until
         FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
        [tile.owner_city_id],
      );
      const owner = ownerRes.rows[0] as { account_id: string; username: string; newbie_until: Date | null } | undefined;
      if (owner && owner.account_id === accountId) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        return;
      }
      if (owner) {
        const nowRes = await client.query(`SELECT now() AS now`);
        const dbNow = nowRes.rows[0].now as Date;
        if (inNewbieProtection(owner.newbie_until, dbNow)) {
          const until = activeAt(owner.newbie_until, dbNow);
          await client.query('ROLLBACK');
          respondError(ctx.registry, conn, op, seq, 'NEWBIE_PROTECTED', {
            until: until ? until.toISOString() : null,
            retryAfterSeconds: until ? Math.max(1, Math.ceil((until.getTime() - dbNow.getTime()) / 1000)) : undefined,
          });
          return;
        }
        pvpTarget = { accountId: owner.account_id, username: owner.username };
      }
    }
    // 扣减城内斥候（与出征同一规则：发起时立即扣减）
    await client.query(
      `UPDATE city_army SET count = count - $2, updated_at = now() WHERE city_id = $1 AND troop = 'scout'`,
      [snap.cityId, count],
    );
    await client.query(`DELETE FROM city_army WHERE city_id = $1 AND troop = 'scout' AND count <= 0`, [snap.cityId]);
    const troops = { scout: count };
    const travel = marchTravelSeconds(snap.x, snap.y, x, y, troops, marchingPercent(snap.techs));
    const ins = await client.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, hero_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'scout', 'marching', $6, now() + make_interval(secs => $7), $8)
       RETURNING *`,
      [accountId, snap.cityId, x, y, JSON.stringify(troops), role, travel, scoutHero ? scoutHero.id : null],
    );
    const march = ins.rows[0] as MarchRow;
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: march.id,
      type: EventType.MARCH_STARTED,
      initiator: role,
      detail: { x, y, troops, purpose: 'scout', arriveAt: march.arrive_at.toISOString(), ...(scoutHero ? { heroId: scoutHero.id, heroName: scoutHero.name } : {}) },
    });
    // v38（AISLG-122）：侦察其他玩家即破自己的新手保护（打野地 / NPC 不触发）
    if (pvpTarget) {
      await breakNewbieProtection(client, accountId, 'scout', { username: pvpTarget.username, x, y }, role);
    }
    await client.query('COMMIT');

    const view = marchView(march);
    respondOk(ctx.registry, conn, op, seq, { march: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_started', march: view } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * RECALL_MARCH：把行军途中的部队原地折返。arrive_at = now + 已走时长（同速回程，
 * 已走时长按出发时间推算、按剩余不超过全程封顶）。行军行先 FOR UPDATE 锁定——
 * 与 Worker 的领取锁序一致；若 Worker 已在结算（状态已变）则拒绝。
 */
export async function handleRecallMarch(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  marchId: string,
): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT * FROM marches WHERE id = $1 AND account_id = $2 FOR UPDATE`,
      [marchId, accountId],
    );
    if (!res.rowCount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'MARCH_NOT_RECALLABLE');
      return;
    }
    const march = res.rows[0] as MarchRow;
    if (march.status !== 'marching' || march.purpose === 'return') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'MARCH_NOT_RECALLABLE');
      return;
    }
    const nowRes = await client.query(`SELECT now() AS now`);
    const now = nowRes.rows[0].now as Date;
    // 已走时长：不超过总时长（到达前的瞬间撤回按全程返程）；v35（AISLG-112）截击埋伏行军的
    // 总时长按实际到达时刻（ambush_at）算——埋伏等待不计入返程路程
    const arrivedMs = march.ambush_at ? march.ambush_at.getTime() : march.arrive_at.getTime();
    const totalMs = arrivedMs - march.started_at.getTime();
    const elapsedMs = Math.min(Math.max(0, now.getTime() - march.started_at.getTime()), Math.max(0, totalMs));
    const returnSeconds = Math.max(1, Math.round(elapsedMs / 1000));
    const upd = await client.query(
      `UPDATE marches SET purpose = 'return', ambush_at = NULL, arrive_at = now() + make_interval(secs => $2)
       WHERE id = $1 AND status = 'marching' RETURNING *`,
      [marchId, returnSeconds],
    );
    if (!upd.rowCount) {
      // 并发窗口：Worker 恰好在锁释放前结算（理论不可达，FOR UPDATE 已串行化）
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'MARCH_NOT_RECALLABLE');
      return;
    }
    const flipped = upd.rows[0] as MarchRow;
    await insertEvent(client, {
      accountId,
      cityId: march.from_city_id,
      buildId: march.id,
      type: EventType.MARCH_STARTED,
      initiator: conn.role as InitiatorRole,
      detail: { x: march.x, y: march.y, purpose: 'return', cause: 'recall_march', arriveAt: flipped.arrive_at.toISOString() },
    });
    await client.query('COMMIT');

    const view = marchView(flipped);
    respondOk(ctx.registry, conn, op, seq, { march: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_started', march: view } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** GET_BATTLE_REPORTS：账号战报倒序分页（limit 1..50 缺省 20；beforeId 游标） */
export async function handleGetBattleReports(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const limit = readIntInRange(data, 'limit', 1, 50, 20);
  const rawBefore = data?.beforeId;
  const beforeId =
    typeof rawBefore === 'number' && Number.isInteger(rawBefore) && rawBefore > 0 ? rawBefore : undefined;
  const reports = await listBattleReports(ctx.pool, conn.accountId as string, { limit, beforeId });
  respondOk(ctx.registry, conn, op, seq, { reports });
}

/**
 * AGENT_COMMENT_REPORT（v23，AISLG-53；仅 Agent 连接）：给本账号持有的一份战报写点评。
 * 一份战报只保留最新一条（重写覆盖）；写库成功后把点评推给账号全部在线连接，
 * 玩家网页在战报弹窗顶部展示。战报不存在 / 不属于本账号返回 INVALID_PARAMS。
 */
export async function handleAgentCommentReport(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  if (conn.role !== 'agent') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const reportId = data?.reportId;
  if (typeof reportId !== 'number' || !Number.isInteger(reportId) || reportId < 1) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const raw = data?.text;
  if (typeof raw !== 'string') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const text = raw.trim();
  if (text.length < 1 || text.length > BATTLE_COMMENT_MAX) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const saved = await saveBattleReportComment(ctx.pool, conn.accountId as string, reportId, text);
  if (!saved) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  respondOk(ctx.registry, conn, op, seq, { reportId: saved.reportId, comment: saved.comment });
  ctx.registry.broadcast(conn.accountId as string, {
    op: Op.PUSH_BATTLE_REPORT_COMMENT,
    push: true,
    data: { reportId: saved.reportId, comment: saved.comment },
  });
}
