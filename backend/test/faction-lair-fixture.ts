// 攻破老巢的测试夹具（AISLG-241）：临时库 + 开季 8 天前 + 五家老巢与 20 营、造玩家与主城、
// 模拟一次「发起出征 → 到达结算 → 幸存部队返程回城」。
// 不是 *.test.ts，不会被 node --test 当作测试文件；三份测试各自建自己的库（createTempDatabase），互不干扰。
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFactionEnabledCache } from '../common/src/faction-config';
import { FACTIONS } from '../common/src/faction';
import { ensureFactions } from '../common/src/faction-db';
import { resolveFactionLairBattle, type FactionLairBattleResult } from '../worker/src/faction-lair-battle';
import type { TileNotify } from '../worker/src/tick-shared';
import type { FactionKey } from '../common/src/protocol-faction';
import { createTempDatabase, type TempDatabase } from './season-test-db';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const NANMAN = FACTIONS[2];
export const WUHUAN = FACTIONS[1];

export interface FlowFixture {
  pool: pg.Pool;
  seasonStart: Date;
  close: () => Promise<void>;
}

/** 临时库 + 赛季开始推到 8 天前 + 五家老巢（20 营、每营 10,000） */
export async function createFlowFixture(baseUrl: string, label: string): Promise<FlowFixture> {
  setTimeScaleCache(1);
  setFactionEnabledCache(true);
  const tmp: TempDatabase = await createTempDatabase(baseUrl, label);
  const pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
  await ensureSchema(pool);
  const seasonStart = new Date(Date.now() - 8 * DAY);
  await pool.query(`UPDATE seasons SET start_at = $1, end_at = $2 WHERE status = 'active'`, [
    seasonStart,
    new Date(Date.now() + 20 * DAY),
  ]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureFactions(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return {
    pool,
    seasonStart,
    close: async () => {
      await pool.end();
      await tmp.drop();
    },
  };
}

/** 造账号 + 主城（地图上落一座 kind='city' 的格） */
export async function insertPlayer(
  fx: FlowFixture,
  name: string,
  x: number,
  y: number,
): Promise<{ accountId: string; cityId: string }> {
  const res = await fx.pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name]);
  const accountId = res.rows[0].id as string;
  const city = await fx.pool.query(
    `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, $2, 1000, 0, 0, 0, 0, $3, $4) RETURNING id`,
    [accountId, `${name}的主城`, x, y],
  );
  const cityId = city.rows[0].id as string;
  await fx.pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 5)`, [cityId]);
  await fx.pool.query(
    `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
    [x, y, cityId],
  );
  return { accountId, cityId };
}

export async function setCityArmy(fx: FlowFixture, cityId: string, troops: Record<string, number>): Promise<void> {
  await fx.pool.query(`DELETE FROM city_army WHERE city_id = $1`, [cityId]);
  for (const [troop, count] of Object.entries(troops)) {
    await fx.pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`, [cityId, troop, count]);
  }
}

/**
 * 模拟一次打老巢的出征：发起时从城内扣编队 → 到达结算 → 幸存部队按返程回城
 * （与真实流程的扣兵 / 返程同口径；trackTroops=false 时只结算不扣兵 / 不回城）。
 */
export async function attackLair(
  fx: FlowFixture,
  args: {
    accountId: string;
    cityId: string;
    troops: Record<string, number>;
    now: Date;
    key?: FactionKey;
    trackTroops?: boolean;
  },
): Promise<FactionLairBattleResult> {
  const key = args.key ?? NANMAN.key;
  const lair = FACTIONS.find((def) => def.key === key)?.lair as { x: number; y: number };
  const track = args.trackTroops !== false;
  const city = await fx.pool.query(`SELECT x, y FROM cities WHERE id = $1`, [args.cityId]);
  const coords = city.rows[0] as { x: number; y: number };
  if (track) {
    for (const [troop, count] of Object.entries(args.troops)) {
      await fx.pool.query(`UPDATE city_army SET count = greatest(0, count - $3) WHERE city_id = $1 AND troop = $2`, [
        args.cityId,
        troop,
        count,
      ]);
    }
  }
  const marchRes = await fx.pool.query(
    `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'plunder', 'marching', 'player', $6) RETURNING *`,
    [args.accountId, args.cityId, lair.x, lair.y, JSON.stringify(args.troops), args.now],
  );
  const client = await fx.pool.connect();
  try {
    await client.query('BEGIN');
    const notifies: TileNotify[] = [];
    const outcome = await resolveFactionLairBattle(client, {
      march: marchRes.rows[0],
      troops: args.troops,
      key,
      now: args.now,
      notifies,
      settled: { row: { x: coords.x, y: coords.y } },
    });
    await client.query('COMMIT');
    if (track) {
      const returning = await fx.pool.query(
        `SELECT troops FROM marches WHERE from_city_id = $1 AND purpose = 'return' AND status = 'marching'`,
        [args.cityId],
      );
      for (const row of returning.rows as Array<{ troops: Record<string, number> }>) {
        for (const [troop, count] of Object.entries(row.troops ?? {})) {
          await fx.pool.query(
            `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
             ON CONFLICT (city_id, troop) DO UPDATE SET count = city_army.count + EXCLUDED.count`,
            [args.cityId, troop, count],
          );
        }
      }
      await fx.pool.query(`DELETE FROM marches WHERE from_city_id = $1 AND purpose = 'return'`, [args.cityId]);
    }
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
