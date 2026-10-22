// 赛季协议的处理（v65，AISLG-134）：GET_SEASON（99，维护期间仍可用）与 GET_HALL_OF_FAME（100）。
// 数据读取全部走 common/src/season-db.ts；路由见 handlers.ts。

import {
  getCurrentSeason,
  getMaintenance,
  getMyHonors,
  listEndedSeasons,
  queryHallOfFame,
} from '../../common/src/season-db';
import { HALL_KINDS, type HallKind } from '../../common/src/protocol-season';
import type { GetHallOfFameResponseData, GetSeasonResponseData } from '../../common/src/protocol-season';
import type { ConnInfo } from './connections';
import { readIntInRange, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { MAINTENANCE_RETRY_AFTER_SEC } from './maintenance-gate';

/** GET_SEASON：当前赛季、维护态、我的荣誉与是否已加入本赛季 */
export async function handleGetSeason(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const season = await getCurrentSeason(ctx.pool);
  if (!season) {
    respondError(ctx.registry, conn, op, seq, 'INTERNAL');
    return;
  }
  const [maintenance, honors, account] = await Promise.all([
    getMaintenance(ctx.pool),
    getMyHonors(ctx.pool, accountId),
    ctx.pool.query(`SELECT season_id FROM accounts WHERE id = $1`, [accountId]),
  ]);
  const data: GetSeasonResponseData = {
    season: {
      id: season.id,
      name: season.name,
      startAt: season.startAt.toISOString(),
      endAt: season.endAt.toISOString(),
      remainingSec: Math.max(0, Math.floor((season.endAt.getTime() - Date.now()) / 1000)),
      timeScale: season.timeScale,
      status: season.status,
    },
    maintenance: maintenance !== null,
    myHonors: honors,
    joined: account.rowCount ? account.rows[0].season_id !== null && Number(account.rows[0].season_id) === season.id : false,
  };
  respondOk(ctx.registry, conn, op, seq, { ...data });
}

/**
 * GET_HALL_OF_FAME：某赛季某榜的一页存档。seasonId 缺省为最近一个已结束赛季；指定的赛季必须存在，
 * 否则 INVALID_PARAMS。没有任何已结束赛季时 seasonId 为 null、结果为空。
 */
export async function handleGetHallOfFame(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const seasons = await listEndedSeasons(ctx.pool);
  const rawSeasonId = data?.seasonId;
  if (rawSeasonId !== undefined && rawSeasonId !== null && !Number.isInteger(rawSeasonId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const kindRaw = data?.kind ?? 'power';
  if (typeof kindRaw !== 'string' || !(HALL_KINDS as readonly string[]).includes(kindRaw)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const kind = kindRaw as HallKind;
  const page = readIntInRange(data, 'page', 1, 10_000, 1);

  let seasonId: number | null;
  if (rawSeasonId === undefined || rawSeasonId === null) {
    seasonId = seasons.length > 0 ? seasons[0].id : null;
  } else {
    seasonId = rawSeasonId as number;
    if (!seasons.some((s) => s.id === seasonId)) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
  }

  const result =
    seasonId === null
      ? { entries: [], modelEntries: [], total: 0 }
      : await queryHallOfFame(ctx.pool, seasonId, kind, page);
  const body: GetHallOfFameResponseData = {
    seasons: seasons.map((s) => ({ id: s.id, name: s.name, endedAt: s.endedAt ? s.endedAt.toISOString() : null })),
    seasonId,
    kind,
    entries: result.entries,
    modelEntries: result.modelEntries,
    total: result.total,
  };
  respondOk(ctx.registry, conn, op, seq, { ...body });
}

/** 维护期间拒绝游戏类请求时的 MAINTENANCE 响应（附 retryAfterSec） */
export function respondMaintenance(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): void {
  respondError(ctx.registry, conn, op, seq, 'MAINTENANCE', { retryAfterSec: MAINTENANCE_RETRY_AFTER_SEC });
}
