// 战争迷雾的数据库读写（AISLG-224）：探索位图的惰性维护、上次看到的地块快照、实时视野来源。
// 纯几何见 fog.ts；行军探索的写入与简报见 fog-record.ts。
// 锁序：先城（cities，调用方已锁） → fog_explored（本文件 FOR UPDATE） → world_tiles（只读）。
import type pg from 'pg';
import {
  FOG_OPENING_RADIUS,
  FOG_VISION,
  fogBitsFrom,
  markSquare,
  newFogBits,
  type VisionSource,
  marchVisionSourceOf,
  type MarchPathInput,
  FOG_CHUNKS_PER_SIDE,
  FOG_CHUNK_SIZE,
  FOG_CHUNK_COUNT,
  wildernessVisionRadius,
} from './fog';

type Queryable = pg.Pool | pg.PoolClient;

/** 地块的事实（来自 world_tiles 与联表）：只用于判定是否“值得记”和写入快照 */
export interface TileFact {
  x: number;
  y: number;
  kind: string;
  terrain: string;
  level: number;
  ownerCityId: string | null;
  ownerAccountId: string | null;
  ownerUsername: string | null;
  ownerCityName: string | null;
  /** NPC 城池是否为名城（静态） */
  famous: boolean;
  /** 在野名将落位且尚未被获得 */
  wildFamous: boolean;
  /** 地上的望楼等级（v97，AISLG-232；0 = 没有） */
  facilityLevel: number;
}

export interface SeenRow {
  x: number;
  y: number;
  kind: string;
  level: number;
  ownerAccountId: string | null;
  ownerUsername: string | null;
  ownerCityId: string | null;
  ownerCityName: string | null;
  wildFamous: boolean;
  /** 上次看到时的望楼等级（v97，AISLG-232；0 = 没有） */
  facilityLevel: number;
  seenAt: Date;
}

export interface Coord {
  x: number;
  y: number;
}

/** 只有城池、NPC 城、有主地块、在野名将落位的地块才写入上次看到的快照（需求第二节） */
export function isInterestingFact(fact: TileFact): boolean {
  return fact.kind === 'city' || fact.kind === 'npc_city' || fact.ownerCityId !== null || fact.wildFamous;
}

/** 一批坐标的地块事实（不加锁；坐标不存在的行不返回）。accountId = 查谁的视角（v103 AISLG-245：
 *  在野名将标记按账号判——本账号已拥有的名将不再显示标记） */
export async function loadTileFacts(q: Queryable, coords: readonly Coord[], accountId: string): Promise<TileFact[]> {
  if (coords.length === 0) {
    return [];
  }
  const xs = coords.map((coord) => coord.x);
  const ys = coords.map((coord) => coord.y);
  const res = await q.query(
    `SELECT wt.x, wt.y, wt.kind, wt.terrain, wt.level, wt.owner_city_id,
            c.account_id AS owner_account_id, a.username AS owner_username, c.name AS owner_city_name,
            (wt.npc -> 'famous') IS NOT NULL AS famous,
            (wt.wild_hero IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM famous_heroes fh WHERE fh.name = wt.wild_hero AND fh.owner_account_id = $3)) AS wild_famous,
            COALESCE(wf.level, 0) AS facility_level
     FROM unnest($1::int[], $2::int[]) AS t(x, y)
     JOIN world_tiles wt ON wt.x = t.x AND wt.y = t.y
     LEFT JOIN cities c ON c.id = wt.owner_city_id
     LEFT JOIN accounts a ON a.id = c.account_id
     LEFT JOIN wilderness_facilities wf ON wf.x = wt.x AND wf.y = wt.y`,
    [xs, ys, accountId],
  );
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    x: row.x as number,
    y: row.y as number,
    kind: row.kind as string,
    terrain: row.terrain as string,
    level: Number(row.level ?? 0),
    ownerCityId: (row.owner_city_id as string | null) ?? null,
    ownerAccountId: (row.owner_account_id as string | null) ?? null,
    ownerUsername: (row.owner_username as string | null) ?? null,
    ownerCityName: (row.owner_city_name as string | null) ?? null,
    famous: row.famous === true,
    wildFamous: row.wild_famous === true,
    facilityLevel: Math.max(0, Number(row.facility_level ?? 0)),
  }));
}

/**
 * 把一批坐标的“上次看到”快照刷新到 fog_seen：有趣的写入 / 更新（内容变了或超过 60 秒才刷新 seen_at，
 * 避免每次查询都写），没趣的删除。调用方保证这批坐标确实是刚刚看到的（或新探索区块的全部格）。
 */
export async function syncSeenTiles(client: pg.PoolClient, accountId: string, coords: readonly Coord[], now: Date): Promise<TileFact[]> {
  if (coords.length === 0) {
    return [];
  }
  const facts = await loadTileFacts(client, coords, accountId);
  const interesting = facts.filter(isInterestingFact);
  const interestingKeys = new Set(interesting.map((fact) => `${fact.x},${fact.y}`));
  const dropped = coords.filter((coord) => !interestingKeys.has(`${coord.x},${coord.y}`));
  if (dropped.length > 0) {
    await client.query(
      `DELETE FROM fog_seen fs USING unnest($2::int[], $3::int[]) AS t(x, y)
       WHERE fs.account_id = $1 AND fs.x = t.x AND fs.y = t.y`,
      [accountId, dropped.map((coord) => coord.x), dropped.map((coord) => coord.y)],
    );
  }
  if (interesting.length > 0) {
    const payload = interesting.map((fact) => ({
      x: fact.x,
      y: fact.y,
      kind: fact.kind,
      level: fact.level,
      owner_account_id: fact.ownerAccountId,
      owner_username: fact.ownerUsername,
      owner_city_id: fact.ownerCityId,
      owner_city_name: fact.ownerCityName,
      wild_famous: fact.wildFamous,
      facility_level: fact.facilityLevel,
    }));
    await client.query(
      `INSERT INTO fog_seen (account_id, x, y, kind, level, owner_account_id, owner_username, owner_city_id, owner_city_name, wild_famous, facility_level, seen_at)
       SELECT $1, r.x, r.y, r.kind, r.level, r.owner_account_id, r.owner_username, r.owner_city_id, r.owner_city_name, r.wild_famous, r.facility_level, $3
       FROM jsonb_to_recordset($2::jsonb) AS r(x int, y int, kind text, level int, owner_account_id uuid, owner_username text,
                                               owner_city_id uuid, owner_city_name text, wild_famous boolean, facility_level int)
       ON CONFLICT (account_id, x, y) DO UPDATE SET
         kind = EXCLUDED.kind, level = EXCLUDED.level, owner_account_id = EXCLUDED.owner_account_id,
         owner_username = EXCLUDED.owner_username, owner_city_id = EXCLUDED.owner_city_id,
         owner_city_name = EXCLUDED.owner_city_name, wild_famous = EXCLUDED.wild_famous,
         facility_level = EXCLUDED.facility_level, seen_at = EXCLUDED.seen_at
       WHERE (fog_seen.kind, fog_seen.level, fog_seen.owner_account_id, fog_seen.owner_username, fog_seen.owner_city_id,
              fog_seen.owner_city_name, fog_seen.wild_famous, fog_seen.facility_level) IS DISTINCT FROM
             (EXCLUDED.kind, EXCLUDED.level, EXCLUDED.owner_account_id, EXCLUDED.owner_username, EXCLUDED.owner_city_id,
              EXCLUDED.owner_city_name, EXCLUDED.wild_famous, EXCLUDED.facility_level)
          OR fog_seen.seen_at < EXCLUDED.seen_at - interval '60 seconds'`,
      [accountId, JSON.stringify(payload), now],
    );
  }
  return facts;
}

/** 区块内的 100 个坐标 */
export function chunkCoords(index: number): Coord[] {
  const x0 = (index % FOG_CHUNKS_PER_SIDE) * FOG_CHUNK_SIZE;
  const y0 = Math.floor(index / FOG_CHUNKS_PER_SIDE) * FOG_CHUNK_SIZE;
  const coords: Coord[] = [];
  for (let dy = 0; dy < FOG_CHUNK_SIZE; dy += 1) {
    for (let dx = 0; dx < FOG_CHUNK_SIZE; dx += 1) {
      coords.push({ x: x0 + dx, y: y0 + dy });
    }
  }
  return coords;
}

/** 账号的城池与占领野地（固定视野来源，不含行军）：主城 12、分城 8、占领野地 3（有望楼时取望楼半径，
 *  丘陵上的野地再 +2、上限 12，见 fog.ts 的 wildernessVisionRadius） */
export async function ownVisionSources(q: Queryable, accountId: string): Promise<VisionSource[]> {
  const cities = await q.query(
    `SELECT x, y FROM cities WHERE account_id = $1 AND x IS NOT NULL AND y IS NOT NULL ORDER BY created_at, id`,
    [accountId],
  );
  const sources: VisionSource[] = [];
  (cities.rows as Array<{ x: number; y: number }>).forEach((row, index) => {
    sources.push({ x: row.x, y: row.y, radius: index === 0 ? FOG_VISION.mainCity : FOG_VISION.branchCity });
  });
  // v97：野地上的望楼联表取等级、地形联表取 wt.terrain（同一张表，不多查一次库）：
  // 半径 = max(野地 3, 望楼 6 / 8 / 10)，丘陵上的野地再 +2（AISLG-233），上限 12
  const territory = await q.query(
    `SELECT wt.x, wt.y, wt.terrain, wf.level AS facility_level FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
     LEFT JOIN wilderness_facilities wf ON wf.x = wt.x AND wf.y = wt.y
     WHERE c.account_id = $1 AND wt.kind = 'wilderness'`,
    [accountId],
  );
  for (const row of territory.rows as Array<{ x: number; y: number; terrain: string; facility_level: number | null }>) {
    sources.push({ x: row.x, y: row.y, radius: wildernessVisionRadius(row.facility_level, row.terrain) });
  }
  return sources;
}

/**
 * 行军行（联表出发城坐标后）的行程信息。AISLG-230 起「行军行 → 当前位置」只此一份：
 * 实时视野（本文件）与 GET_VISIBLE_MARCHES（api/src/fog-enemy-marches.ts）共用。
 */
export interface MarchPathRow {
  /** 目标格（marches.x / marches.y） */
  tx: number;
  ty: number;
  purpose: string;
  started_at: Date;
  arrive_at: Date;
  ambush_at?: Date | null;
  /** 撤回时的实际位置与时刻（fog_turn_*，未撤回为 null） */
  fog_turn_x?: number | null;
  fog_turn_y?: number | null;
  fog_turn_at?: Date | null;
  /** 出发城坐标（cities.x / cities.y） */
  hx: number;
  hy: number;
}

/** 行程段：截击在埋伏点结束，撤回从撤回瞬间位置沿直线回出发城（与写入时的回程时长一致） */
export function marchPathOf(row: MarchPathRow): MarchPathInput {
  const endAt = row.purpose === 'intercept' && row.ambush_at ? row.ambush_at : row.arrive_at;
  return {
    homeX: row.hx,
    homeY: row.hy,
    targetX: row.tx,
    targetY: row.ty,
    returning: row.purpose === 'return',
    startMs: row.started_at.getTime(),
    endMs: endAt.getTime(),
    turn: row.fog_turn_at
      ? { x: Number(row.fog_turn_x), y: Number(row.fog_turn_y), atMs: row.fog_turn_at.getTime() }
      : null,
  };
}

/** 行军中的实时视野来源（当前位置，按斥候与否取半径）；只读，不写已探索 */
export async function marchVisionSources(
  q: Queryable,
  accountId: string,
  now: Date,
  scoutingLevel: number,
): Promise<VisionSource[]> {
  const res = await q.query(
    `SELECT m.x AS tx, m.y AS ty, m.purpose, m.troops, m.started_at, m.arrive_at, m.ambush_at,
            m.fog_turn_x, m.fog_turn_y, m.fog_turn_at, c.x AS hx, c.y AS hy
     FROM marches m JOIN cities c ON c.id = m.from_city_id
     WHERE m.account_id = $1 AND m.status = 'marching' AND c.x IS NOT NULL AND c.y IS NOT NULL`,
    [accountId],
  );
  const sources: VisionSource[] = [];
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const troops = (row.troops ?? {}) as Record<string, number>;
    const hasScout = (troops.scout ?? 0) > 0;
    sources.push(
      marchVisionSourceOf(marchPathOf(row as unknown as MarchPathRow), now.getTime(), hasScout, scoutingLevel),
    );
  }
  return sources;
}

/** 开局 / 存量初始化的位图：主城周围 30 格 + 侦察过的地块所在区块；没有主城返回 null */
async function openingBits(client: pg.PoolClient, accountId: string): Promise<{ bits: Uint8Array } | null> {
  const main = await client.query(
    `SELECT x, y FROM cities WHERE account_id = $1 AND x IS NOT NULL AND y IS NOT NULL ORDER BY created_at, id LIMIT 1`,
    [accountId],
  );
  const home = main.rows[0] as { x: number; y: number } | undefined;
  if (!home) {
    return null;
  }
  const bits = newFogBits();
  markSquare(bits, home.x, home.y, FOG_OPENING_RADIUS);
  const scouted = await client.query(`SELECT x, y FROM scout_intel WHERE account_id = $1`, [accountId]);
  for (const row of scouted.rows as Array<{ x: number; y: number }>) {
    markSquare(bits, row.x, row.y, 0);
  }
  return { bits };
}

/** 位图里所有已探索区块的下标 */
function setChunks(bits: Uint8Array): number[] {
  const out: number[] = [];
  for (let index = 0; index < FOG_CHUNK_COUNT; index += 1) {
    if ((bits[index >> 3] & (1 << (index & 7))) !== 0) {
      out.push(index);
    }
  }
  return out;
}

export interface FogState {
  bits: Uint8Array;
  /** 本次维护新变为已探索的区块（初始化时为全部开局区块）；不生成简报 */
  fresh: number[];
}

/**
 * 惰性维护账号的探索状态（需求第二节「账号每次用到迷雾时」）：
 * 1) 没有 fog_explored 行则做开局 / 存量初始化（主城周围 30 格 + 侦察过的区块）；
 * 2) 把当前城池与占领野地的视野并入位图（只加不减），新区块的地块快照一并刷新；
 * 3) 位图变化才写库。调用方须已在事务内（会 FOR UPDATE 锁行）。
 * 没有主城的账号不写状态，返回空位图。
 */
export async function ensureFogState(client: pg.PoolClient, accountId: string, now: Date): Promise<FogState> {
  let row = await client.query(`SELECT bits FROM fog_explored WHERE account_id = $1 FOR UPDATE`, [accountId]);
  let fresh: number[] = [];
  if (!row.rowCount) {
    const init = await openingBits(client, accountId);
    if (!init) {
      return { bits: newFogBits(), fresh: [] };
    }
    const ins = await client.query(
      `INSERT INTO fog_explored (account_id, bits) VALUES ($1, $2) ON CONFLICT (account_id) DO NOTHING`,
      [accountId, Buffer.from(init.bits)],
    );
    row = await client.query(`SELECT bits FROM fog_explored WHERE account_id = $1 FOR UPDATE`, [accountId]);
    // 本次真正插入才算初始化（并发插入的另一方已经刷过快照，这里不重复）
    if (ins.rowCount) {
      fresh = setChunks(init.bits);
    }
  }
  const bits = fogBitsFrom(row.rows[0]?.bits as Uint8Array | undefined);
  const sources = await ownVisionSources(client, accountId);
  const merged: number[] = [];
  for (const source of sources) {
    merged.push(...markSquare(bits, source.x, source.y, source.radius));
  }
  const changedChunks = [...fresh, ...merged];
  if (changedChunks.length > 0) {
    for (const index of new Set(changedChunks)) {
      await syncSeenTiles(client, accountId, chunkCoords(index), now);
    }
    await client.query(`UPDATE fog_explored SET bits = $2, updated_at = now() WHERE account_id = $1`, [
      accountId,
      Buffer.from(bits),
    ]);
  }
  return { bits, fresh: changedChunks };
}

/** 视野窗口内的上次看到快照（按坐标取，归属关系按请求账号现算由调用方处理） */
export async function loadSeenWindow(
  q: Queryable,
  accountId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<Map<string, SeenRow>> {
  const res = await q.query(
    `SELECT x, y, kind, level, owner_account_id, owner_username, owner_city_id, owner_city_name, wild_famous, facility_level, seen_at
     FROM fog_seen WHERE account_id = $1 AND x >= $2 AND x < $2 + $4 AND y >= $3 AND y < $3 + $5`,
    [accountId, x, y, w, h],
  );
  const out = new Map<string, SeenRow>();
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const seen: SeenRow = {
      x: row.x as number,
      y: row.y as number,
      kind: row.kind as string,
      level: Number(row.level ?? 0),
      ownerAccountId: (row.owner_account_id as string | null) ?? null,
      ownerUsername: (row.owner_username as string | null) ?? null,
      ownerCityId: (row.owner_city_id as string | null) ?? null,
      ownerCityName: (row.owner_city_name as string | null) ?? null,
      wildFamous: row.wild_famous === true,
      facilityLevel: Math.max(0, Number(row.facility_level ?? 0)),
      seenAt: row.seen_at as Date,
    };
    out.set(`${seen.x},${seen.y}`, seen);
  }
  return out;
}

/** 探索位图只读取（不加锁、不初始化）；没有行返回 null */
export async function readFogBits(q: Queryable, accountId: string): Promise<Uint8Array | null> {
  const res = await q.query(`SELECT bits FROM fog_explored WHERE account_id = $1`, [accountId]);
  if (!res.rowCount) {
    return null;
  }
  return fogBitsFrom(res.rows[0].bits as Uint8Array);
}

