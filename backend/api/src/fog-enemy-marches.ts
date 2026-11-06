// 视野内他人部队（AISLG-230，v96）：GET_VISIBLE_MARCHES（op 152）的数据侧。
// 做法见需求「技术细节」：位置无法靠索引查，所以全服行军中部队的位置快照缓存在本进程内存里（3 秒过期），
// 单次请求只取查看者自己的实时视野来源，再按窗口与视野过滤。
//
// 信息边界（需求第三节）：本文件只输出 id / 位置 / 速度 / 去返程 / 规模档位 / 主人名与关系，
// 出发城、目标格、出发 / 到达时刻、兵力、兵种、将领、任务类型一律不出本文件。
// 侦察（purpose=scout 或编队只有斥候）、已过 ambush_at 的埋伏、已到达的部队与剧本战场小队都不上图。

import type pg from 'pg';
import {
  VISIBLE_MARCH_LARGE_MIN,
  VISIBLE_MARCH_LIMIT,
  VISIBLE_MARCH_MEDIUM_MIN,
  type TroopKind,
  type VisibleMarchScale,
  type VisibleMarchView,
} from '../../common/src/protocol';
import { marchMoveAt, inAnyVision, type VisionSource } from '../../common/src/fog';
import { marchPathOf, type MarchPathRow } from '../../common/src/fog-db';
import { relationsOf } from './fog-view';

/** 全服位置快照的过期时间（毫秒）：3 秒内的请求复用同一份，不每个请求都把全表算一遍 */
export const MARCH_SNAPSHOT_TTL_MS = 3_000;
/** 地图窗口（已按世界边界钳制） */
export interface MarchWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 快照里的一支他人在途部队：只有判定与输出要用的字段，没有任何可泄露的信息 */
interface MarchSnapshotRow {
  id: string;
  /** 主人账号：只用来排除自己与算关系，不下发 */
  accountId: string;
  /** 当前浮点位置（世界格坐标） */
  x: number;
  y: number;
  /** 速度（格/秒） */
  vx: number;
  vy: number;
  returning: boolean;
  scale: VisibleMarchScale;
  /** 结束时刻（毫秒）：到达 / 开始埋伏之后不再上图 */
  endMs: number;
  /** 侦察隐蔽：purpose=scout，或编队里只有斥候（去程返程都算） */
  scouted: boolean;
}

/** 编队总人数与「只有斥候」判定 */
export function troopSummaryOf(troops: Partial<Record<TroopKind, number>> | null | undefined): { total: number; scoutOnly: boolean } {
  let total = 0;
  let others = 0;
  for (const [kind, count] of Object.entries(troops ?? {})) {
    const n = Math.max(0, Number(count ?? 0));
    total += n;
    if (kind !== 'scout') {
      others += n;
    }
  }
  return { total, scoutOnly: total > 0 && others === 0 };
}

/** 编队总人数 → 规模档位（499 小股 / 500、4 999 中军 / 5 000 大军） */
export function scaleOfTroops(total: number): VisibleMarchScale {
  if (total >= VISIBLE_MARCH_LARGE_MIN) {
    return 'large';
  }
  if (total >= VISIBLE_MARCH_MEDIUM_MIN) {
    return 'medium';
  }
  return 'small';
}

let snapshot: { at: number; rows: MarchSnapshotRow[] } | null = null;
let snapshotLoading: Promise<MarchSnapshotRow[]> | null = null;

/** 清空位置快照缓存（测试与「开关刚打开」时用；正常运行由 3 秒 TTL 决定） */
export function clearMarchSnapshot(): void {
  snapshot = null;
  snapshotLoading = null;
}

/** 查全服行军中部队并算出当前位置（只在快照过期后调用） */
async function querySnapshot(q: pg.Pool | pg.PoolClient, nowMs: number): Promise<MarchSnapshotRow[]> {
  const res = await q.query(
    `SELECT m.id, m.account_id, m.x AS tx, m.y AS ty, m.purpose, m.troops, m.started_at, m.arrive_at, m.ambush_at,
            m.fog_turn_x, m.fog_turn_y, m.fog_turn_at, c.x AS hx, c.y AS hy
     FROM marches m JOIN cities c ON c.id = m.from_city_id
     WHERE m.status = 'marching' AND c.x IS NOT NULL AND c.y IS NOT NULL`,
  );
  const rows: MarchSnapshotRow[] = [];
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const path = marchPathOf(row as unknown as MarchPathRow);
    const move = marchMoveAt(path, nowMs);
    const { total, scoutOnly } = troopSummaryOf((row.troops ?? {}) as Partial<Record<TroopKind, number>>);
    rows.push({
      id: row.id as string,
      accountId: row.account_id as string,
      x: move.x,
      y: move.y,
      vx: move.vx,
      vy: move.vy,
      returning: path.returning,
      scale: scaleOfTroops(total),
      endMs: path.endMs,
      scouted: row.purpose === 'scout' || scoutOnly,
    });
  }
  return rows;
}

/** 全服位置快照（3 秒过期；并发请求共用同一次查询） */
async function marchSnapshot(q: pg.Pool | pg.PoolClient, nowMs: number): Promise<MarchSnapshotRow[]> {
  if (snapshot && nowMs - snapshot.at < MARCH_SNAPSHOT_TTL_MS) {
    return snapshot.rows;
  }
  if (!snapshotLoading) {
    snapshotLoading = querySnapshot(q, nowMs)
      .then((rows) => {
        snapshot = { at: nowMs, rows };
        return rows;
      })
      .finally(() => {
        snapshotLoading = null;
      });
  }
  return snapshotLoading;
}

/** 主人的玩家名与联盟名（只查上图的那几支；联盟为 null 表示没有联盟） */
async function loadMarchOwners(
  q: pg.Pool | pg.PoolClient,
  accountIds: readonly string[],
): Promise<Map<string, { username: string; allianceName: string | null }>> {
  const out = new Map<string, { username: string; allianceName: string | null }>();
  if (accountIds.length === 0) {
    return out;
  }
  const res = await q.query(
    `SELECT a.id, a.username, al.name AS alliance_name
     FROM accounts a
     LEFT JOIN alliance_members am ON am.account_id = a.id
     LEFT JOIN alliances al ON al.id = am.alliance_id
     WHERE a.id = ANY($1::uuid[])`,
    [[...new Set(accountIds)]],
  );
  for (const row of res.rows as Array<{ id: string; username: string; alliance_name: string | null }>) {
    out.set(row.id, { username: row.username, allianceName: row.alliance_name ?? null });
  }
  return out;
}

/** 保留位小数的位置 / 速度（位置 1 位，速度 4 位够图标平滑移动） */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface VisibleMarchRequest {
  /** 查看者 */
  accountId: string;
  /** 查看者自己的实时视野来源（ownVisionSources + marchVisionSources；不含盟友视野） */
  sources: readonly VisionSource[];
  window: MarchWindow;
  /** 快照时刻（与 serverTime 同一个时钟） */
  now: Date;
}

/**
 * 窗口内、实时视野里的他人部队（离窗口中心由近到远，最多 50 支）。
 * 调用方须已在迷雾事务内（client 为同一连接），且 fog_enabled 开启。
 */
export async function loadVisibleMarches(q: pg.Pool | pg.PoolClient, req: VisibleMarchRequest): Promise<VisibleMarchView[]> {
  const nowMs = req.now.getTime();
  const rows = await marchSnapshot(q, nowMs);
  const centerX = req.window.x + req.window.w / 2;
  const centerY = req.window.y + req.window.h / 2;
  const seen: Array<{ row: MarchSnapshotRow; distance: number }> = [];
  for (const row of rows) {
    if (row.accountId === req.accountId || row.scouted || nowMs >= row.endMs) {
      continue;
    }
    // 当前位置四舍五入到整格：整格在窗口内、且在查看者的实时视野内才上图
    const cellX = Math.round(row.x);
    const cellY = Math.round(row.y);
    if (cellX < req.window.x || cellX >= req.window.x + req.window.w || cellY < req.window.y || cellY >= req.window.y + req.window.h) {
      continue;
    }
    if (!inAnyVision(req.sources, cellX, cellY)) {
      continue;
    }
    seen.push({ row, distance: Math.hypot(cellX - centerX, cellY - centerY) });
  }
  if (seen.length === 0) {
    return [];
  }
  seen.sort((a, b) => a.distance - b.distance || a.row.id.localeCompare(b.row.id));
  const picked = seen.slice(0, VISIBLE_MARCH_LIMIT);
  const owners = await loadMarchOwners(q, picked.map((item) => item.row.accountId));
  const relations = await relationsOf(q, req.accountId, picked.map((item) => item.row.accountId));
  return picked.map(({ row }) => {
    const owner = owners.get(row.accountId);
    const relation = relations.get(row.accountId)?.relation;
    return {
      id: row.id,
      x: roundTo(row.x, 1),
      y: roundTo(row.y, 1),
      vx: roundTo(row.vx, 4),
      vy: roundTo(row.vy, 4),
      returning: row.returning,
      scale: row.scale,
      owner: {
        username: owner?.username ?? '',
        allianceName: owner?.allianceName ?? null,
        // 'self' 已在上面排除；其余关系与地块 owner.relation 同口径（解除友好冷却期内为 friendly）
        relation: relation === 'ally' || relation === 'friendly' || relation === 'hostile' ? relation : 'neutral',
      },
    };
  });
}
