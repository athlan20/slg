// 战斗类协议的处理逻辑（v13）：SCOUT 斥候侦察 / RECALL_MARCH 行军途中撤回 /
// GET_BATTLE_REPORTS 战报查询。协议分发见 handlers.ts。
// 共同约定：
// - SCOUT 从主城派出斥候（purpose='scout'，按斥候行军速度），到达由 Worker 产出
//   情报快照（事件 + scout_intel）并自动返程；本 handler 只做校验与建行军；
// - RECALL_MARCH 锁 marches 行后翻转 purpose='return'：arrive_at = now + 已走时长
//   （同速折返）。锁序 marches → （不锁城 / 地块），与 Worker 领取行军的锁序一致，
//   不构成死锁环；
// - GET_BATTLE_REPORTS 按账号倒序分页（beforeId 游标）。

import type pg from 'pg';
import { moveAttackLockRetry } from '../../common/src/move-city-db';
import { marchingPercent } from '../../common/src/tech';
import { Op, EventType, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { recordMarchExploration } from '../../common/src/fog-record';
import { ensureFogState } from '../../common/src/fog-db';
import { getFogEnabled } from '../../common/src/fog-config';
import type { ErrorCode } from '../../common/src/protocol';
import { isUnknownTarget } from './fog-march';
import { walkedFractionOf } from '../../common/src/fog';
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
import { cannotAttack } from '../../common/src/alliance-db';
import { isLuoyangName, luoyangWindowOpen, nextLuoyangOpen, decreeMarchSpeedPercent } from '../../common/src/luoyang';
import { loadActiveDecree } from '../../common/src/luoyang-db';
import { isAllyOfCity } from './march-target';
import { isFactionLairTarget } from '../../common/src/faction-db';
import { cityDispatchBlockedSeconds } from './stratagem-target';

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
    // v86（AISLG-211）：中了十面埋伏的城连斥候也派不出去（与 MARCH 同一道拦截）
    const ambushNowRes = await client.query(`SELECT now() AS now`);
    const ambushLeft = await cityDispatchBlockedSeconds(client, snap.cityId, ambushNowRes.rows[0].now as Date);
    if (ambushLeft !== null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'CITY_AMBUSHED', { retryAfterSeconds: ambushLeft });
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
    const tileRes = await client.query(`SELECT kind, owner_city_id, npc, faction_lair FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [x, y]);
    const tile = (tileRes.rowCount ? tileRes.rows[0] : null) as
      | { kind: string; owner_city_id: string | null; npc: unknown; faction_lair: string | null }
      | null;
    // v99（AISLG-239）：势力老巢只能查询、不能侦察（与 MARCH 同一道拦截）
    if (isFactionLairTarget(tile)) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'FACTION_LAIR_TARGET');
      return;
    }
    // v91（AISLG-220）：指定坐标迁城后 12 小时内，这座城不能侦察他人城池 / 野地（侦察属于攻击类出征）
    const scoutLockLeft = await moveAttackLockRetry(client, accountId, snap.cityId, tile, 'plunder', null, ambushNowRes.rows[0].now as Date);
    if (scoutLockLeft !== null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'MOVE_CITY_ATTACK_LOCK', { retryAfterSeconds: scoutLockLeft });
      return;
    }
    // v92（AISLG-224 复核）：校验照跑。目标相关的拒绝：迷雾中的未知格不报错，照常出发并写 fog_denied
    // （到达原路返回、不产出情报）；已探索 / 视野内的照旧报错。通过时走完整流程（含 pvpTarget 破保护）
    const scoutNow = ambushNowRes.rows[0].now as Date;
    const fogOn = getFogEnabled();
    if (fogOn) {
      await ensureFogState(client, accountId, scoutNow);
    }
    const unknown = fogOn && (await isUnknownTarget(client, accountId, x, y, scoutNow));
    const verdict = await scoutTargetVerdict(client, accountId, tile, scoutNow);
    let fogDenied = false;
    let pvpTarget = verdict.pvpTarget;
    if (verdict.code) {
      if (!unknown) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, verdict.code, verdict.data);
        return;
      }
      fogDenied = true;
      pvpTarget = null;
    }
    // 扣减城内斥候（与出征同一规则：发起时立即扣减）
    await client.query(
      `UPDATE city_army SET count = count - $2, updated_at = now() WHERE city_id = $1 AND troop = 'scout'`,
      [snap.cityId, count],
    );
    await client.query(`DELETE FROM city_army WHERE city_id = $1 AND troop = 'scout' AND count <= 0`, [snap.cityId]);
    const troops = { scout: count };
    const decree = await loadActiveDecree(client, accountId);
    const travel = marchTravelSeconds(snap.x, snap.y, x, y, troops, marchingPercent(snap.techs) + decreeMarchSpeedPercent(decree?.kind ?? null, decree?.until ?? null, new Date()));
    const ins = await client.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, hero_id, fog_denied)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'scout', 'marching', $6, now() + make_interval(secs => $7), $8, $9)
       RETURNING *`,
      [accountId, snap.cityId, x, y, JSON.stringify(troops), role, travel, scoutHero ? scoutHero.id : null, fogDenied],
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
/** 撤回去程时的探索写入（AISLG-224）：撤回时已走过的比例；出发城坐标缺失则跳过 */
async function recordRecalledExploration(client: pg.PoolClient, march: MarchRow, now: Date): Promise<{ x: number; y: number } | null> {
  const home = (await client.query(`SELECT x, y FROM cities WHERE id = $1`, [march.from_city_id])).rows[0] as
    | { x: number | null; y: number | null }
    | undefined;
  if (!home || home.x === null || home.y === null) {
    return null;
  }
  const arriveAt = march.ambush_at ?? march.arrive_at;
  const fraction = walkedFractionOf(march.started_at.getTime(), arriveAt.getTime(), now.getTime());
  await recordMarchExploration(
    client,
    {
      marchId: march.id,
      accountId: march.account_id,
      fromCityId: march.from_city_id,
      homeX: home.x,
      homeY: home.y,
      targetX: march.x,
      targetY: march.y,
      troops: (march.troops ?? {}) as Record<string, number>,
    },
    fraction,
    now,
  );
  return { x: home.x, y: home.y };
}

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
    // v92（AISLG-224）：撤回前把已走过的去程写入探索（只算到撤回时的位置），并生成探索简报（如有新区块）
    const homeCoords = await recordRecalledExploration(client, march, now);
    // 复核修复（AISLG-224）：记下撤回瞬间部队的实际位置与时刻，撤回后的实时视野从这里往回算
    const turnFraction = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 1;
    const turnX = homeCoords ? homeCoords.x + (march.x - homeCoords.x) * turnFraction : null;
    const turnY = homeCoords ? homeCoords.y + (march.y - homeCoords.y) * turnFraction : null;
    const upd = await client.query(
      `UPDATE marches SET purpose = 'return', ambush_at = NULL, arrive_at = now() + make_interval(secs => $2),
         fog_turn_x = $3, fog_turn_y = $4, fog_turn_at = CASE WHEN $3::double precision IS NULL THEN NULL ELSE now() END
       WHERE id = $1 AND status = 'marching' RETURNING *`,
      [marchId, returnSeconds, turnX, turnY],
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

/**
 * 侦察目标的校验（v92 起与出征同口径，抽成函数）：自己的城、盟友的城 / 野地、洛阳窗口、守方新手保护。
 * 返回拒绝码（附数据）与通过时的 pvpTarget（破除攻方新手保护用）。
 */
async function scoutTargetVerdict(
  client: pg.PoolClient,
  accountId: string,
  tile: { kind: string; owner_city_id: string | null } | null,
  now: Date,
): Promise<{ code: ErrorCode | null; data?: Record<string, unknown>; pvpTarget: { accountId: string; username: string } | null }> {
  const none: { code: null; pvpTarget: null } = { code: null, pvpTarget: null };
  if (tile && tile.kind === 'city' && tile.owner_city_id) {
    const ownerRes = await client.query(
      `SELECT c.account_id, c.famous_name, a.username, a.newbie_until
       FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
      [tile.owner_city_id],
    );
    const owner = ownerRes.rows[0] as { account_id: string; famous_name: string | null; username: string; newbie_until: Date | null } | undefined;
    if (!owner) {
      return none;
    }
    if (owner.account_id === accountId) {
      return { code: 'INVALID_PARAMS', pvpTarget: null };
    }
    if (await cannotAttack(client, accountId, owner.account_id)) {
      return { code: 'ALLY_NOT_ATTACKABLE', pvpTarget: null };
    }
    if (isLuoyangName(owner.famous_name) && !luoyangWindowOpen(now)) {
      const next = nextLuoyangOpen(now);
      return {
        code: 'LUOYANG_CLOSED',
        data: { nextOpenAt: next.toISOString(), retryAfterSeconds: Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000)) },
        pvpTarget: null,
      };
    }
    if (inNewbieProtection(owner.newbie_until, now)) {
      const until = activeAt(owner.newbie_until, now);
      return {
        code: 'NEWBIE_PROTECTED',
        data: {
          until: until ? until.toISOString() : null,
          retryAfterSeconds: until ? Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)) : undefined,
        },
        pvpTarget: null,
      };
    }
    return { code: null, pvpTarget: { accountId: owner.account_id, username: owner.username } };
  }
  if (tile && tile.kind === 'wilderness' && tile.owner_city_id && (await isAllyOfCity(client, accountId, tile.owner_city_id))) {
    return { code: 'ALLY_NOT_ATTACKABLE', pvpTarget: null };
  }
  return none;
}
