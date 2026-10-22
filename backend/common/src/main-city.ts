// 开号之初的主城创建（AISLG-134 赛季惰性加入与注册共用）：城池行、自带建筑（INITIAL_BUILDINGS）、
// 世界地块分配（claimCityTile）。注册（api/src/auth.ts insertAccountWithCity）与赛季加入
// （season-db.ts joinCurrentSeason）都走这里，不各写一份。事务由调用方开启 / 提交。

import type pg from 'pg';
import { INITIAL_BUILDINGS, INITIAL_POPULATION, INITIAL_RESOURCES } from './rules';
import { claimCityTile } from './world-db';

/** 给城池批量补上开号之初的自带建筑（每个城池每种建筑一行，等级见 INITIAL_BUILDINGS） */
export async function insertInitialBuildings(client: pg.PoolClient, cityIds: readonly string[]): Promise<void> {
  if (cityIds.length === 0) {
    return;
  }
  for (const [kind, level] of Object.entries(INITIAL_BUILDINGS)) {
    await client.query(
      `INSERT INTO city_buildings (city_id, kind, level)
       SELECT unnest($1::uuid[]), $2, $3`,
      [cityIds, kind, level],
    );
  }
}

/**
 * 为账号新建一座主城：初始资源与人口、名称「主城」、自带建筑、分配世界地块（写回 cities.x / y）。
 * 返回城池 id。账号的新手保护、Agent 令牌等账号级数据由调用方自行处理。
 */
export async function insertInitialCity(client: pg.PoolClient, accountId: string): Promise<string> {
  const city = await client.query(
    `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, population)
     VALUES ($1, '主城', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      accountId,
      INITIAL_RESOURCES.gold,
      INITIAL_RESOURCES.wood,
      INITIAL_RESOURCES.food,
      INITIAL_RESOURCES.stone,
      INITIAL_RESOURCES.iron,
      INITIAL_POPULATION,
    ],
  );
  const cityId = city.rows[0].id as string;
  await insertInitialBuildings(client, [cityId]);
  // v12：主城在世界中分配地块（出生区中心附近的空闲野地；世界由 API 启动时生成）
  await claimCityTile(client, cityId);
  return cityId;
}
