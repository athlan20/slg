// 势力出兵的测试夹具（AISLG-240）：临时库 + 造账号 / 城池 / 驻军 / 围攻行 / 直接结算。
// 不是 *.test.ts，不会被 node --test 当作测试文件；三份测试各自建自己的库（createTempDatabase），互不干扰。
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFactionEnabledCache } from '../common/src/faction-config';
import { FACTIONS } from '../common/src/faction';
import { factionSiegeArmy, factionSiegePower } from '../common/src/faction-siege';
import { resolveOneSiege } from '../worker/src/faction-siege-battle';
import type { TileNotify } from '../worker/src/tick-shared';
import { createTempDatabase, type TempDatabase } from './season-test-db';

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
/** 南蛮老巢 (80,920)：夹具里的城都放在它旁边，稳在势力范围内 */
export const NANMAN = FACTIONS[2];

export interface CityArgs {
  accountId: string;
  name: string;
  x: number;
  y: number;
  gov: number;
  wall?: number;
  createdAt: Date;
  originLevel?: number | null;
  famous?: string | null;
}

export interface SiegeRowArgs {
  faction?: string;
  cityId: string | null;
  accountId: string;
  x: number;
  y: number;
  level: number;
  arriveAt?: Date;
}

export interface SiegeFixture {
  pool: pg.Pool;
  seasonStart: Date;
  /** 攻方（势力之外的普通玩家，测试里当“别的玩家”用） */
  attackerId: string;
  /** 被围方 */
  defenderId: string;
  /** 被围方的主城（驻军 / 在外部队的落点） */
  defenderMainId: string;
  insertAccount: (name: string) => Promise<string>;
  insertCity: (args: CityArgs) => Promise<string>;
  setGarrison: (cityId: string, troops: Record<string, number>) => Promise<void>;
  insertSiegeRow: (args: SiegeRowArgs) => Promise<string>;
  /** 直接结算一条围攻（事务内），返回 repelled / hit / swallowed / cancelled */
  resolveSiege: (siegeId: string, now: Date) => Promise<string>;
  cityRow: (cityId: string) => Promise<{ durability: number | null; truce_until: Date | null } | null>;
  close: () => Promise<void>;
}

/** 建一套夹具：临时库 + 赛季开始时间推到 8 天前（围攻已开）+ 五家老巢行 + 一个被围账号 */
export async function createSiegeFixture(baseUrl: string, label: string): Promise<SiegeFixture> {
  setTimeScaleCache(1);
  const tmp: TempDatabase = await createTempDatabase(baseUrl, label);
  const pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
  await ensureSchema(pool);
  const seasonStart = new Date(Date.now() - 8 * DAY);
  await pool.query(`UPDATE seasons SET start_at = $1, end_at = $2 WHERE status = 'active'`, [
    seasonStart,
    new Date(Date.now() + 20 * DAY),
  ]);
  // 本季的五家老巢（围攻定时器按 factions 表的行走）
  for (const def of FACTIONS) {
    await pool.query(
      `INSERT INTO factions (key, lair_x, lair_y, last_radius) VALUES ($1, $2, $3, 100) ON CONFLICT (key) DO NOTHING`,
      [def.key, def.lair.x, def.lair.y],
    );
  }

  const insertAccount = async (name: string): Promise<string> => {
    const res = await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name]);
    return res.rows[0].id as string;
  };

  /** 造一座城：gov 官府等级、wall 城墙等级、createdAt 决定主城（最早创建的 = 主城） */
  const insertCity = async (args: CityArgs): Promise<string> => {
    const res = await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y, created_at, origin_level, famous_name)
       VALUES ($1, $2, 1000, 2000, 3000, 4000, 5000, $3, $4, $5, $6, $7) RETURNING id`,
      [args.accountId, args.name, args.x, args.y, args.createdAt, args.originLevel ?? null, args.famous ?? null],
    );
    const cityId = res.rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', $2)`, [cityId, args.gov]);
    if (args.wall) {
      await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'wall', $2)`, [cityId, args.wall]);
    }
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [args.x, args.y, cityId],
    );
    return cityId;
  };

  const setGarrison = async (cityId: string, troops: Record<string, number>): Promise<void> => {
    await pool.query(`DELETE FROM city_army WHERE city_id = $1`, [cityId]);
    for (const [troop, count] of Object.entries(troops)) {
      await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`, [cityId, troop, count]);
    }
  };

  const insertSiegeRow = async (args: SiegeRowArgs): Promise<string> => {
    const power = factionSiegePower(args.level, 100);
    const res = await pool.query(
      `INSERT INTO faction_sieges (faction, city_id, account_id, x, y, level, army, power, arrive_at, week_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 0) RETURNING id`,
      [
        args.faction ?? NANMAN.key,
        args.cityId,
        args.accountId,
        args.x,
        args.y,
        args.level,
        JSON.stringify(factionSiegeArmy(power)),
        power,
        args.arriveAt ?? new Date(),
      ],
    );
    return res.rows[0].id as string;
  };

  const resolveSiege = async (siegeId: string, now: Date): Promise<string> => {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      const res = await conn.query(
        `SELECT id, faction, city_id, account_id, x, y, level, army, power, warn_at, arrive_at, resolved_at, outcome, week_index
         FROM faction_sieges WHERE id = $1 FOR UPDATE`,
        [siegeId],
      );
      const notifies: TileNotify[] = [];
      const pushes: Array<{ accountId: string; data: Record<string, unknown> }> = [];
      // v102（AISLG-243）：围攻起算日按势力起点算；这里没有中途启用，起点就是本季开始时间
      const outcome = await resolveOneSiege(conn, res.rows[0], { now, epochStart: seasonStart }, notifies, pushes);
      await conn.query('COMMIT');
      return outcome;
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  };

  const cityRow = async (cityId: string): Promise<{ durability: number | null; truce_until: Date | null } | null> => {
    const res = await pool.query(`SELECT durability, truce_until FROM cities WHERE id = $1`, [cityId]);
    return (res.rows[0] as { durability: number | null; truce_until: Date | null } | undefined) ?? null;
  };

  setFactionEnabledCache(true);
  const attackerId = await insertAccount(`siegemaster-${label}-${Date.now()}`);
  const defenderId = await insertAccount(`siegemaster-def-${label}-${Date.now()}`);
  const defenderMainId = await insertCity({
    accountId: defenderId,
    name: '防守方主城',
    x: NANMAN.lair.x + 2,
    y: NANMAN.lair.y + 2,
    gov: 6,
    wall: 5,
    createdAt: new Date(Date.now() - 3 * DAY),
  });

  return {
    pool,
    seasonStart,
    attackerId,
    defenderId,
    defenderMainId,
    insertAccount,
    insertCity,
    setGarrison,
    insertSiegeRow,
    resolveSiege,
    cityRow,
    close: async () => {
      await pool.end();
      await tmp.drop();
    },
  };
}
