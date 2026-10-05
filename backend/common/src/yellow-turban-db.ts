// 黄巾之乱的数据库存取与视图（v29，AISLG-76）：API（查询 / 地块视图）与 Worker（生命周期 / 结算）共用。

import pg from 'pg';
import type { TroopKind } from './protocol';
import type { YtCampView, YtEventView, YtTileCampView } from './protocol-yt';
import { recoveredGarrison } from './native-garrison';
import {
  YT_TIER_INFO,
  isYtTier,
  ytBossStage,
  ytBossUnlockCount,
  ytGarrison,
  ytKeeperWindowMs,
  type YtTier,
} from './yellow-turban';

type Queryable = pg.Pool | pg.PoolClient;
type Counts = Partial<Record<TroopKind, number>>;

export interface YtEventRow {
  id: string;
  status: string;
  started_at: Date;
  ends_at: Date;
  total_camps: number;
  cleared_camps: number;
  boss_appeared_at: Date | null;
  boss_cleared_at: Date | null;
  boss_cleared_by: string | null;
  finished_at: Date | null;
  finish_reason: string | null;
  scattered_camps: number;
}

export interface YtCampRow {
  id: string;
  event_id: string;
  x: number;
  y: number;
  tier: string;
  status: string;
  next_grow_at: Date | null;
  next_raid_at: Date | null;
  outer_cleared_at: Date | null;
  remaining: Counts | null;
  remaining_at: Date | null;
  cleared_by: string | null;
  cleared_at: Date | null;
}

/** 档位（容错：未知值按 small） */
export function campTier(row: Pick<YtCampRow, 'tier'>): YtTier {
  return isYtTier(row.tier) ? row.tier : 'small';
}

/** 营地当前阶段（仅老巢有意义；普通营地恒 outer） */
export function campStage(row: YtCampRow, now: Date): 'outer' | 'keeper' {
  return campTier(row) === 'boss' ? ytBossStage(row.outer_cleared_at, now) : 'outer';
}

/** 营地当前守军：满编（按档位 / 老巢阶段）叠加战后存量的每小时 25% 恢复 */
export function campGarrison(row: YtCampRow, now: Date = new Date()): Counts {
  const stage = campStage(row, now);
  const full = ytGarrison(campTier(row), stage);
  // 老巢城守窗口已过期（外围恢复满编）：此前记下的城守存量作废
  const stale = campTier(row) === 'boss' && row.outer_cleared_at !== null && stage === 'outer';
  if (!row.remaining || !row.remaining_at || stale) {
    return full;
  }
  return recoveredGarrison(full, row.remaining, now.getTime() - row.remaining_at.getTime());
}

function total(counts: Counts): number {
  return Object.values(counts).reduce<number>((sum, count) => sum + Math.max(0, count ?? 0), 0);
}

/** 营地的地块视图（TileView.camp / GET_YELLOW_TURBAN camps[] 共用；只给守军大致范围） */
export function ytTileCampView(row: YtCampRow, now: Date = new Date()): YtTileCampView {
  const tier = campTier(row);
  const sum = total(campGarrison(row, now));
  const view: YtTileCampView = {
    tier,
    label: YT_TIER_INFO[tier].label,
    level: YT_TIER_INFO[tier].level,
    garrisonTotal: { min: Math.floor(sum * 0.8), max: Math.ceil(sum * 1.2) },
    nextGrowAt: row.next_grow_at ? row.next_grow_at.toISOString() : null,
  };
  if (tier === 'boss') {
    const stage = campStage(row, now);
    view.boss = {
      stage,
      recoversAt:
        stage === 'keeper' && row.outer_cleared_at
          ? new Date(row.outer_cleared_at.getTime() + ytKeeperWindowMs()).toISOString()
          : null,
    };
  }
  return view;
}

export function ytCampView(row: YtCampRow, now: Date = new Date()): YtCampView {
  return { id: row.id, x: row.x, y: row.y, ...ytTileCampView(row, now) };
}

export function ytEventView(row: YtEventRow): YtEventView {
  return {
    id: row.id,
    status: row.status === 'finished' ? 'finished' : 'active',
    startedAt: row.started_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    totalCamps: row.total_camps,
    clearedCamps: row.cleared_camps,
    bossUnlockCount: ytBossUnlockCount(row.total_camps),
    bossAppearedAt: row.boss_appeared_at ? row.boss_appeared_at.toISOString() : null,
    bossClearedAt: row.boss_cleared_at ? row.boss_cleared_at.toISOString() : null,
    finishReason: row.finish_reason === 'boss_cleared' ? 'boss_cleared' : row.finish_reason === 'timeout' ? 'timeout' : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    scatteredCamps: row.scattered_camps,
  };
}

/** 进行中的事件（至多一条）；无则 null */
export async function loadActiveYtEvent(q: Queryable, forUpdate = false): Promise<YtEventRow | null> {
  const res = await q.query(`SELECT * FROM yt_events WHERE status = 'active' LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`);
  return res.rowCount ? (res.rows[0] as YtEventRow) : null;
}

/** 最近一条事件（含已结束），用来推算下一轮起事时刻 */
export async function loadLatestYtEvent(q: Queryable): Promise<YtEventRow | null> {
  const res = await q.query(`SELECT * FROM yt_events ORDER BY started_at DESC LIMIT 1`);
  return res.rowCount ? (res.rows[0] as YtEventRow) : null;
}

/** 事件的进行中营地（含老巢） */
export async function loadActiveCamps(q: Queryable, eventId: string): Promise<YtCampRow[]> {
  const res = await q.query(
    `SELECT * FROM yt_camps WHERE event_id = $1 AND status = 'active' ORDER BY tier DESC, x, y`,
    [eventId],
  );
  return res.rows as YtCampRow[];
}

/** 某格上进行中的营地；forUpdate=true 加行锁（Worker 结算） */
export async function loadCampAt(q: Queryable, x: number, y: number, forUpdate = false): Promise<YtCampRow | null> {
  const res = await q.query(
    `SELECT * FROM yt_camps WHERE x = $1 AND y = $2 AND status = 'active'${forUpdate ? ' FOR UPDATE' : ''}`,
    [x, y],
  );
  return res.rowCount ? (res.rows[0] as YtCampRow) : null;
}

/** row_to_json 取回的营地（日期为字符串）→ YtCampRow（地块窗口联表用） */
export function campRowFromJson(raw: Record<string, unknown> | null): YtCampRow | null {
  if (!raw) {
    return null;
  }
  const date = (value: unknown): Date | null => (typeof value === 'string' ? new Date(value) : null);
  return {
    id: String(raw.id),
    event_id: String(raw.event_id),
    x: Number(raw.x),
    y: Number(raw.y),
    tier: String(raw.tier),
    status: String(raw.status),
    next_grow_at: date(raw.next_grow_at),
    next_raid_at: date(raw.next_raid_at),
    outer_cleared_at: date(raw.outer_cleared_at),
    remaining: (raw.remaining as Counts | null) ?? null,
    remaining_at: date(raw.remaining_at),
    cleared_by: raw.cleared_by ? String(raw.cleared_by) : null,
    cleared_at: date(raw.cleared_at),
  };
}
