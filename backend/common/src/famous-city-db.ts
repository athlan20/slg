// 名城的数据库引导（v24，AISLG-56）：把现有 NPC 城原地升格为名城，一次性、幂等。
// 登记表 famous_cities 记住已升格的名城——被占领后地块转为玩家城，登记仍在，不会重复升格。
// 在 ensureWorld 的咨询锁内调用（调用方保证串行）。

import pg from 'pg';
import { FAMOUS_CITY_LEVEL, FAMOUS_CITY_NAMES, famousAnchors, famousGarrisons, newFamousState } from './famous-city';
import type { NpcCitySnapshot } from './world';
import { WORLD_SIZE } from './world';

/** 把 (x, y) 的 NPC 城写入名城标记与城守阶段守军（保留库存与建筑） */
async function stampFamous(client: pg.PoolClient, x: number, y: number, name: string): Promise<void> {
  const res = await client.query(`SELECT level, npc FROM world_tiles WHERE x = $1 AND y = $2 AND kind = 'npc_city' FOR UPDATE`, [x, y]);
  if (!res.rowCount) {
    return;
  }
  const row = res.rows[0] as { level: number; npc: NpcCitySnapshot | null };
  if (!row.npc || row.npc.famous) {
    return;
  }
  const npc: NpcCitySnapshot = {
    ...row.npc,
    garrison: famousGarrisons(row.level).keeper,
    famous: newFamousState(name, row.level),
  };
  await client.query(`UPDATE world_tiles SET npc = $3::jsonb WHERE x = $1 AND y = $2`, [x, y, JSON.stringify(npc)]);
}

/**
 * 补齐 8 座名城：每个锚点取最近的、尚未升格的最高等级 NPC 城；已登记但地块被重新生成
 * （名城标记丢失）的就地重新标记。返回本次新升格的数量。
 */
export async function ensureFamousCities(client: pg.PoolClient): Promise<number> {
  const registered = await client.query(`SELECT name, x, y FROM famous_cities`);
  const byName = new Map((registered.rows as Array<{ name: string; x: number; y: number }>).map((r) => [r.name, r]));
  const anchors = famousAnchors(WORLD_SIZE);
  let created = 0;
  for (let index = 0; index < FAMOUS_CITY_NAMES.length; index++) {
    const name = FAMOUS_CITY_NAMES[index];
    const existing = byName.get(name);
    if (existing) {
      await stampFamous(client, existing.x, existing.y, name);
      continue;
    }
    const anchor = anchors[index];
    const pick = await client.query(
      `SELECT x, y FROM world_tiles
       WHERE kind = 'npc_city' AND level = $3 AND npc IS NOT NULL AND npc->'famous' IS NULL
       ORDER BY GREATEST(ABS(x - $1), ABS(y - $2)), x, y LIMIT 1`,
      [anchor.x, anchor.y, FAMOUS_CITY_LEVEL],
    );
    if (!pick.rowCount) {
      continue;
    }
    const { x, y } = pick.rows[0] as { x: number; y: number };
    await client.query(`INSERT INTO famous_cities (name, x, y) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`, [name, x, y]);
    await stampFamous(client, x, y, name);
    created += 1;
  }
  return created;
}
