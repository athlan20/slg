// 五方势力的数据库读写（AISLG-239，v99）：老巢落位、开季吞城、每 6 小时吞一座、势力面板数据。
// 纯规则与数值在 faction.ts（API 与 Worker 共用，不得重复实现）；开关在 faction-config.ts。
// 势力城的归属记在 world_tiles.npc 快照的 faction 字段上：吞城时把守军与库存按 1.5 倍写进快照，
// 掠夺 / 占领 / 侦察读的就是这份快照，倍率在这三条路径上同时生效；玩家占下这座城时地块转成
// kind='city'、npc 清空，归属随之消失（见 worker/src/npc-occupy.ts、api/src/handlers-discard.ts）。

import type pg from 'pg';
import {
  FACTIONS,
  factionRadiusForDay,
  factionDayAt,
  factionDefOf,
  factionOwnsTileSql,
  factionSnapshot,
  FACTION_INITIAL_RADIUS,
  type FactionDef,
} from './faction';
import { getFactionEnabled } from './faction-config';
import { FACTION_KEYS, type FactionKey, type FactionView, type GetFactionsResponseData } from './protocol-faction';
import type { NpcCitySnapshot } from './world';

type Queryable = pg.Pool | pg.PoolClient;

/** factions 表的一行（每季生成老巢时写入） */
export interface FactionRow {
  key: FactionKey;
  lair_x: number;
  lair_y: number;
  last_swallow_at: Date;
  last_radius: number;
}

/**
 * 生成本季的五家老巢（幂等；开关关闭时什么都不做，返回 0）。
 * - 老巢地块：kind 保持 wilderness、level 0、无主、无 NPC，只打上 faction_lair 标记（不是新地块种类，
 *   不影响既有的野地 / NPC 城 / 城池三态判定）。被玩家占着的格（理论上不会发生）不抢占，跳过并告警。
 * - factions 表没有这家时插入一行，并立刻吞下老巢周围 25 格内的全部 NPC 城（开季的地盘）。
 * 调用方：ensureWorld（只在世界刚生成 / 重建时）与换季重置（同一事务内）。赛季中途打开开关不放老巢，等下次换季。
 */
export async function ensureFactions(client: pg.PoolClient): Promise<number> {
  if (!getFactionEnabled()) {
    return 0;
  }
  let created = 0;
  for (const def of FACTIONS) {
    const stamped = await client.query(
      `UPDATE world_tiles
       SET kind = 'wilderness', level = 0, owner_city_id = NULL, npc = NULL, faction_lair = $3, plundered_at = NULL
       WHERE x = $1 AND y = $2 AND owner_city_id IS NULL`,
      [def.lair.x, def.lair.y, def.key],
    );
    if (!stamped.rowCount) {
      // 行不存在时补插（世界生成覆盖全图，这里兜住不完整的世界）；行存在但被玩家占着则不抢占
      const exists = await client.query(`SELECT 1 FROM world_tiles WHERE x = $1 AND y = $2`, [def.lair.x, def.lair.y]);
      if (exists.rowCount) {
        console.warn(`ensureFactions: lair ${def.key} at ${def.lair.x},${def.lair.y} is occupied, skipped`);
        continue;
      }
      await client.query(
        `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc, faction_lair)
         VALUES ($1, $2, 'plain', 'wilderness', 0, NULL, NULL, $3)`,
        [def.lair.x, def.lair.y, def.key],
      );
    }
    const existing = await client.query(`SELECT key FROM factions WHERE key = $1`, [def.key]);
    if (existing.rowCount) {
      continue;
    }
    await client.query(
      `INSERT INTO factions (key, lair_x, lair_y, last_radius) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
      // 起始半径不算“扩大”：last_radius 从第 1 天的半径起，第 8 天才会播第一条
      [def.key, def.lair.x, def.lair.y, factionRadiusForDay(1)],
    );
    const swallowed = await swallowWithin(client, def, FACTION_INITIAL_RADIUS);
    console.log(`ensureFactions: ${def.key} lair at ${def.lair.x},${def.lair.y}, swallowed ${swallowed} NPC cities`);
    created += 1;
  }
  return created;
}

/** 范围内可吞的 NPC 城条件：NPC 城、非名城、还没有任何势力归属（已被其他势力吞掉的不再改主） */
const SWALLOWABLE_SQL = `kind = 'npc_city' AND npc IS NOT NULL AND npc->'famous' IS NULL AND npc->>'faction' IS NULL`;

/** 把这家老巢周围 radius 格（切比雪夫）内的全部可吞 NPC 城收归该势力，返回座数（开季用） */
export async function swallowWithin(client: pg.PoolClient, def: FactionDef, radius: number): Promise<number> {
  const res = await client.query(
    `SELECT x, y, npc FROM world_tiles
     WHERE ${SWALLOWABLE_SQL} AND abs(x - $1) <= $3 AND abs(y - $2) <= $3 AND ${factionOwnsTileSql(def.key)}
     ORDER BY y, x`,
    [def.lair.x, def.lair.y, radius],
  );
  let count = 0;
  for (const row of res.rows as Array<{ x: number; y: number; npc: NpcCitySnapshot }>) {
    const updated = await client.query(
      `UPDATE world_tiles SET npc = $3::jsonb WHERE x = $1 AND y = $2 AND ${SWALLOWABLE_SQL}`,
      [row.x, row.y, JSON.stringify(factionSnapshot(row.npc, def.key))],
    );
    if (updated.rowCount) {
      count += 1;
    }
  }
  return count;
}

/**
 * 在当前范围内随机吞一座无主 NPC 城（每 6 小时一座）：随机而不是挑最近的，势力城才会散在整片地盘上；
 * 名城、玩家城、已被其他势力吞掉的城、重叠区里离别家老巢更近的城都不在候选里。范围内没有可吞的城时返回 null。
 */
export async function swallowRandom(
  client: pg.PoolClient,
  def: FactionDef,
  radius: number,
): Promise<{ x: number; y: number } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pick = await client.query(
      `SELECT x, y, npc FROM world_tiles
       WHERE ${SWALLOWABLE_SQL} AND abs(x - $1) <= $3 AND abs(y - $2) <= $3 AND ${factionOwnsTileSql(def.key)}
       ORDER BY random() LIMIT 1`,
      [def.lair.x, def.lair.y, radius],
    );
    if (!pick.rowCount) {
      return null;
    }
    const row = pick.rows[0] as { x: number; y: number; npc: NpcCitySnapshot };
    // 条件 UPDATE 兜住并发（另一个 Worker / 玩家刚好把这座城占下）：0 行就换一座
    const updated = await client.query(
      `UPDATE world_tiles SET npc = $3::jsonb WHERE x = $1 AND y = $2 AND ${SWALLOWABLE_SQL}`,
      [row.x, row.y, JSON.stringify(factionSnapshot(row.npc, def.key))],
    );
    if (updated.rowCount) {
      return { x: row.x, y: row.y };
    }
  }
  return null;
}

/** 本季已生成的老巢（factions 表的行；开关关闭或本季还没生成时为空数组）。
 *  顺序按需求表从上到下（与范围重叠的 tie-break 顺序一致），不按主键字母序。 */
export async function loadFactionRows(q: Queryable): Promise<FactionRow[]> {
  const res = await q.query(`SELECT key, lair_x, lair_y, last_swallow_at, last_radius FROM factions`);
  const order = new Map<string, number>(FACTION_KEYS.map((key, index) => [key, index]));
  return (res.rows as Array<{ key: string; lair_x: number; lair_y: number; last_swallow_at: Date; last_radius: number }>)
    .filter((row) => order.has(row.key))
    .sort((a, b) => (order.get(a.key) as number) - (order.get(b.key) as number))
    .map((row) => ({
      key: row.key as FactionKey,
      lair_x: row.lair_x,
      lair_y: row.lair_y,
      last_swallow_at: row.last_swallow_at,
      last_radius: row.last_radius,
    }));
}

/** 各家当前持有的势力城数（按 npc->>'faction' 计数；表达式索引 idx_world_tiles_faction 覆盖） */
export async function factionCityCounts(q: Queryable): Promise<Record<string, number>> {
  const res = await q.query(
    `SELECT npc->>'faction' AS key, count(*)::int AS n FROM world_tiles
     WHERE npc IS NOT NULL AND npc ? 'faction' GROUP BY 1`,
  );
  const counts: Record<string, number> = {};
  for (const row of res.rows as Array<{ key: string; n: number }>) {
    counts[row.key] = row.n;
  }
  return counts;
}

/**
 * 势力面板数据（GET_FACTIONS）：本季天数、当前半径与五家的名称 / 首领 / 老巢 / 半径 / 持城数。
 * 开关关闭时返回 enabled=false 与空列表（关闭时不得有任何势力内容）；开了但本季还没生成老巢时同样为空。
 */
export async function loadFactionView(
  q: Queryable,
  seasonStart: Date | null,
  now: Date = new Date(),
): Promise<GetFactionsResponseData> {
  const serverTime = now.toISOString();
  if (!getFactionEnabled()) {
    return { enabled: false, day: 0, radius: 0, serverTime, factions: [] };
  }
  const rows = await loadFactionRows(q);
  const day = seasonStart ? factionDayAt(seasonStart, now) : 1;
  const radius = factionRadiusForDay(day);
  if (rows.length === 0) {
    return { enabled: true, day, radius, serverTime, factions: [] };
  }
  const counts = await factionCityCounts(q);
  const factions: FactionView[] = [];
  for (const row of rows) {
    const def = factionDefOf(row.key);
    if (!def) {
      continue;
    }
    factions.push({
      key: def.key,
      name: def.name,
      nameEn: def.nameEn,
      leader: def.leader,
      leaderEn: def.leaderEn,
      lair: { x: row.lair_x, y: row.lair_y },
      radius,
      cityCount: counts[def.key] ?? 0,
    });
  }
  return { enabled: true, day, radius, serverTime, factions };
}

/** 出征 / 侦察的目标是否为老巢（开关关闭时老巢标记不生效，与上线前一致） */
export function isFactionLairTarget(tile: { faction_lair?: string | null } | null): boolean {
  return !!tile?.faction_lair && getFactionEnabled();
}
