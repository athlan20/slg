// 世界地图的数据库引导与查询（v12；从 world.ts 拆出以控制单文件行数）。
// 纯规则与数值在 world.ts（两侧共用、不得重复实现）；本文件只做 PostgreSQL 读写：
// 世界落库与规模变更重建、城池分散落位、地块与驻军查询。API 与 Worker 共用。
// 数值均为占位决策，调整入口在 world.ts。

import pg from 'pg';
import { ensureFamousCities } from './famous-city-db';
import {
  type TerrainKind,
  type TileKind,
  type TroopKind,
} from './protocol';
import {
  WORLD_SIZE,
  generateWorldTiles,
  type NpcCitySnapshot,
  type TerritoryRow,
  type WorldTileSeed,
} from './world';

// ---- 世界引导与规模重建 ----

/** 世界引导用的咨询锁 ID（与 ensureSchema 的锁区分开；运维脚本复用同一把锁） */
export const WORLD_LOCK_ID = 8721402;

/**
 * 首次启动时生成世界并落库（幂等；API 与 Worker 并发启动由咨询锁串行化）。
 * 存量世界与 WORLD_SIZE 不一致（规模调整 / 残缺生成）时触发**世界重建**（开发期占位
 * 路径）：行军与地块驻军的部队先并回城内驻军，随后行军、占领与整张地图清零重生成，
 * 全部城池坐标置空后由下方的分散落位重排——部队保留、出征与领地作废。
 * 同时为没有坐标的城池分配地块（含重建后的重排）。
 */
export async function ensureWorld(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${WORLD_LOCK_ID})`);
    const count = await client.query(`SELECT count(*)::int AS n FROM world_tiles`);
    const expected = WORLD_SIZE * WORLD_SIZE;
    if (count.rows[0].n !== expected) {
      await client.query('BEGIN');
      try {
        if (count.rows[0].n > 0) {
          await wipeWorldForRebuild(client);
        }
        await insertWorldTiles(client, generateWorldTiles());
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    }
    // 名城升格（v24 AISLG-56）：8 座，幂等；世界重建后登记已清空，会重新挑选
    const famousCreated = await ensureFamousCities(client);
    if (famousCreated > 0) {
      console.log(`ensureWorld: promoted ${famousCreated} NPC cities to famous cities`);
    }
    // 存量城池补坐标（首启 / 重建后的重排：按创建顺序逐座分散落位）
    const cities = await client.query(
      `SELECT id FROM cities WHERE x IS NULL OR y IS NULL ORDER BY created_at`,
    );
    for (const row of cities.rows as Array<{ id: string }>) {
      await claimCityTile(client, row.id);
    }
    // 存量城池地块自愈（v19 补丁）：world_tiles 被外部清空重建后，城市坐标仍在而
    // 城池地块缺失，仅凭上面的 x IS NULL 重排发现不了——就地复位或重新择址
    const repaired = await restoreOrphanedCityTiles(client);
    if (repaired.restored + repaired.relocated > 0) {
      console.log(
        `ensureWorld: repaired ${repaired.restored} city tiles in place, relocated ${repaired.relocated}`,
      );
    }
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${WORLD_LOCK_ID})`);
    } catch {
      // 连接异常时放弃解锁；会话结束会自动释放咨询锁
    }
    client.release();
  }
}

/** 世界重建前的清理：部队并回城内驻军，行军 / 占领 / 地图状态作废（调用方负责事务） */
async function wipeWorldForRebuild(client: pg.PoolClient): Promise<void> {
  // 进行中的行军部队并回出发城（已结算的历史行军不并，避免重复入账）
  await client.query(
    `INSERT INTO city_army (city_id, troop, count)
     SELECT m.from_city_id, t.key, (t.value)::int
     FROM marches m, jsonb_each(m.troops) t
     WHERE m.status = 'marching' AND (t.value)::int > 0
     ON CONFLICT (city_id, troop)
     DO UPDATE SET count = city_army.count + EXCLUDED.count, updated_at = now()`,
  );
  // 占领地块（野地与分城）的驻军并回归属城
  await client.query(
    `INSERT INTO city_army (city_id, troop, count)
     SELECT wt.owner_city_id, ta.troop, ta.count
     FROM tile_army ta
     JOIN world_tiles wt ON wt.x = ta.x AND wt.y = ta.y AND wt.owner_city_id IS NOT NULL
     ON CONFLICT (city_id, troop)
     DO UPDATE SET count = city_army.count + EXCLUDED.count, updated_at = now()`,
  );
  await client.query(`DELETE FROM marches`);
  await client.query(`DELETE FROM tile_army`);
  await client.query(`DELETE FROM world_tiles`);
  await client.query(`DELETE FROM famous_cities`);
  await client.query(`UPDATE cities SET x = NULL, y = NULL`);
}

/** 批量写入世界地块：分块多值插入（单语句参数上限 65535，大世界必须分块） */
async function insertWorldTiles(client: pg.PoolClient, tiles: WorldTileSeed[]): Promise<void> {
  const CHUNK = 500;
  for (let start = 0; start < tiles.length; start += CHUNK) {
    const slice = tiles.slice(start, start + CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];
    slice.forEach((tile, index) => {
      const base = index * 6;
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb)`);
      // 无 NPC 快照的野地必须写 SQL NULL（JSON.stringify(null) 是字符串 'null'，
      // 会存成 jsonb null，令 `npc IS NULL` 失配）
      values.push(tile.x, tile.y, tile.terrain, tile.kind, tile.level, tile.npc === null ? null : JSON.stringify(tile.npc));
    });
    await client.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, npc) VALUES ${rows.join(', ')}`,
      values,
    );
  }
}

// ---- 城池分散落位 ----

/** 每轮评估的采样点数（含中心点；最远点采样的近似，占位决策） */
const CLAIM_SAMPLE_SIZE = 64;
/** 采样轮数（整批采样撞上占用格或并发撞车时换一批随机点重试；占位决策） */
const CLAIM_ATTEMPTS = 5;

/**
 * 为城池分配地块（分散落位，2026-09-27 决策）：在空闲野地里选一块与既有城池
 * （kind='city'，含分城）Chebyshev 距离最大的格子（城市随注册数摊开全图；并列时取
 * 离世界中心最近），首座城池落在中心附近。大世界（1000×1000 = 100 万格）下精确
 * 全局最远点需要候选 × 城池全量叉积、代价不可接受，故用 best-candidate 采样近似：
 * 每轮取「中心点 + 63 个随机点」，在有效（空闲野地）采样里挑离既有城池最远的一格。
 * 选定后以条件 UPDATE 占格：并发注册选到同一格时，后到方在 READ COMMITTED 下
 * 换批重选（能看到已提交的对方）。世界占满时返回 null（当前规模下不会发生，属
 * 占位边界，留待规模设计复核）。调用方负责事务与 cities.x/y 的回写。
 */
export async function claimCityTile(
  client: pg.PoolClient,
  cityId: string,
): Promise<{ x: number; y: number } | null> {
  const center = Math.floor(WORLD_SIZE / 2);
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    // 采样候选：中心点固定入样（无既有城池时凭 tie-break 胜出 → 首城在中心附近），其余随机
    const sample: Array<[number, number]> = [[center, center]];
    while (sample.length < CLAIM_SAMPLE_SIZE) {
      sample.push([Math.floor(Math.random() * WORLD_SIZE), Math.floor(Math.random() * WORLD_SIZE)]);
    }
    const params: unknown[] = [cityId, center, center];
    const values = sample
      .map(([x, y], index) => {
        const base = 4 + index * 2;
        params.push(x, y);
        // ::int 显式定型：VALUES 中的参数缺省推断为 text，无法与 integer 坐标比较
        return `($${base}::int, $${base + 1}::int)`;
      })
      .join(', ');
    const upd = await client.query(
      `WITH sample AS (VALUES ${values}),
           existing AS (
             SELECT x, y FROM world_tiles WHERE kind = 'city' AND owner_city_id IS NOT NULL
           ),
           valid AS (
             SELECT s.column1 AS x, s.column2 AS y
             FROM sample s
             JOIN world_tiles wt ON wt.x = s.column1 AND wt.y = s.column2
             WHERE wt.kind = 'wilderness' AND wt.owner_city_id IS NULL AND wt.npc IS NULL
           ),
           candidate AS (
             SELECT v.x, v.y
             FROM valid v
             LEFT JOIN existing e ON true
             GROUP BY v.x, v.y
             ORDER BY COALESCE(min(greatest(abs(v.x - e.x), abs(v.y - e.y))), 2147483647) DESC,
                      (v.x - $2) * (v.x - $2) + (v.y - $3) * (v.y - $3), v.x, v.y
             LIMIT 1
           )
       UPDATE world_tiles t
       SET kind = 'city', level = 0, owner_city_id = $1, npc = NULL
       FROM candidate c
       WHERE t.x = c.x AND t.y = c.y
         AND t.kind = 'wilderness' AND t.owner_city_id IS NULL AND t.npc IS NULL
       RETURNING t.x, t.y`,
      params,
    );
    if (upd.rowCount) {
      const tile = upd.rows[0] as { x: number; y: number };
      await client.query(`UPDATE cities SET x = $2, y = $3 WHERE id = $1`, [cityId, tile.x, tile.y]);
      return { x: tile.x, y: tile.y };
    }
    // 0 行：整批采样无效（世界近满）或并发注册抢先占了同一格——换一批随机点
  }
  return null;
}

/**
 * 修复「坐标仍在但城池地块缺失」的存量城池（调用方持有 WORLD_LOCK_ID 并负责事务）。
 * 触发场景：world_tiles 被代码路径之外清空重建（如运维手工清表换地形），此时城市
 * x/y 保留而地块关联全失，且不会走 wipeWorldForRebuild 的「坐标清空 + 重排」流程。
 * 规则：旧坐标仍是空闲野地则就地复位（坐标不变）；已被 NPC 城 / 其他城池占用的
 * 重新择址（claimCityTile，坐标变化）。返回就地复位与重排的数量。
 */
export async function restoreOrphanedCityTiles(
  client: pg.PoolClient,
): Promise<{ restored: number; relocated: number }> {
  // 「没有任何 city 地块指向自己」才算孤儿——占领野地的归属不算城池地块
  const broken = await client.query(
    `SELECT id, x, y FROM cities c
     WHERE x IS NOT NULL AND y IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM world_tiles wt
         WHERE wt.owner_city_id = c.id AND wt.kind = 'city'
       )
     ORDER BY created_at`,
  );
  let restored = 0;
  let relocated = 0;
  for (const row of broken.rows as Array<{ id: string; x: number; y: number }>) {
    // 就地复位：条件 UPDATE 复用 claimCityTile 的占格条件，兜住理论上的并发竞争
    const upd = await client.query(
      `UPDATE world_tiles SET kind = 'city', level = 0, owner_city_id = $1, npc = NULL
       WHERE x = $2 AND y = $3 AND kind = 'wilderness' AND owner_city_id IS NULL AND npc IS NULL`,
      [row.id, row.x, row.y],
    );
    if (upd.rowCount) {
      restored += 1;
      continue;
    }
    const spot = await claimCityTile(client, row.id);
    if (spot !== null) {
      relocated += 1;
    }
  }
  return { restored, relocated };
}

// ---- 地块与驻军查询 ----

export interface TileRow {
  x: number;
  y: number;
  terrain: TerrainKind;
  kind: TileKind;
  level: number;
  owner_city_id: string | null;
  npc: NpcCitySnapshot | null;
  /** 最近一次成功掠夺的时间（v16；冷却判定见 plunder.ts）；从未被掠为 null */
  plundered_at: Date | null;
  /** 换主保护截止（v39，AISLG-123）：野地被玩家抢占后的一小段保护期内谁都不能再抢；其余为 null */
  owner_changed_until?: Date | null;
}

/** 读取单格（不加锁；需要一致写时由调用方 FOR UPDATE） */
export async function loadTile(q: pg.Pool | pg.PoolClient, x: number, y: number): Promise<TileRow | null> {
  const res = await q.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2`, [x, y]);
  return res.rowCount ? (res.rows[0] as TileRow) : null;
}

/** 按兵种读取地块驻军（缺省 0） */
export async function loadTileArmy(
  q: pg.Pool | pg.PoolClient,
  x: number,
  y: number,
): Promise<Record<TroopKind, number>> {
  const res = await q.query(`SELECT troop, count FROM tile_army WHERE x = $1 AND y = $2`, [x, y]);
  const army = {} as Record<TroopKind, number>;
  for (const row of res.rows as Array<{ troop: TroopKind; count: number }>) {
    army[row.troop] = row.count;
  }
  return army;
}

/** 累加写入地块驻军（upsert；count 归零的行由调用方清理） */
export async function addTileArmy(
  client: pg.PoolClient,
  x: number,
  y: number,
  troops: Partial<Record<TroopKind, number>>,
): Promise<void> {
  for (const [troop, count] of Object.entries(troops)) {
    const value = Math.floor(count ?? 0);
    if (value <= 0) {
      continue;
    }
    await client.query(
      `INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, $3, $4)
       ON CONFLICT (x, y, troop)
       DO UPDATE SET count = tile_army.count + EXCLUDED.count, updated_at = now()`,
      [x, y, troop, value],
    );
  }
}

/** 清空地块驻军并清除占领（野地失守 / 召回共用；NPC 城池地块不适用） */
export async function clearTileOccupation(client: pg.PoolClient, x: number, y: number): Promise<void> {
  await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [x, y]);
  await client.query(
    `UPDATE world_tiles SET owner_city_id = NULL WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
    [x, y],
  );
}

/** 某城占领的全部野地（含驻军总数；CityView.territory 与产量加成计算共用） */
export async function loadTerritory(q: pg.Pool | pg.PoolClient, cityId: string): Promise<TerritoryRow[]> {
  const res = await q.query(
    `SELECT wt.x, wt.y, wt.terrain, wt.level, COALESCE(ta.total, 0)::int AS garrison
     FROM world_tiles wt
     LEFT JOIN (SELECT x, y, sum(count) AS total FROM tile_army GROUP BY x, y) ta
       ON ta.x = wt.x AND ta.y = wt.y
     WHERE wt.owner_city_id = $1 AND wt.kind = 'wilderness'
     ORDER BY wt.y, wt.x`,
    [cityId],
  );
  return res.rows as TerritoryRow[];
}
