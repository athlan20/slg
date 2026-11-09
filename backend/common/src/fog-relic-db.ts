// 遗迹与名将处所的数据库读写（AISLG-227，v93）：每季生成遗迹（幂等）、按视窗查未领取的遗迹与处所、
// 名城首探者、每日领取数。纯挑点规则见 relic.ts；领取的并发判定在 Worker（fog-relic-claim.ts）。
// 调用方对 fog_relics 的读不加锁；只有生成与领取会写。
import type pg from 'pg';
import { placeRelics, HERO_SITES, RELIC_TOTAL, type PlacedRelic } from './relic';
import type { RelicKind, RelicTier } from './protocol-world';

type Queryable = pg.Pool | pg.PoolClient;

/** 遗迹生成的咨询锁（与 ensureWorld / 换季锁区分；生成只允许串行执行） */
const RELIC_GEN_LOCK_ID = 8721423;

/** 一批坐标是否为合规地块（野地、无主、无 NPC、非名将格、非湖泊 / 金矿）；顺序与输入一致 */
async function eligibleFlags(client: pg.PoolClient, batch: Array<{ x: number; y: number }>): Promise<boolean[]> {
  const res = await client.query(
    `SELECT t.i, (wt.x IS NOT NULL) AS ok
     FROM unnest($1::int[], $2::int[]) WITH ORDINALITY AS t(x, y, i)
     LEFT JOIN world_tiles wt ON wt.x = t.x AND wt.y = t.y AND wt.kind = 'wilderness'
       AND wt.owner_city_id IS NULL AND wt.npc IS NULL AND wt.wild_hero IS NULL
       AND wt.terrain NOT IN ('lake', 'gold_mine') AND wt.faction_lair IS NULL
     ORDER BY t.i`,
    [batch.map((p) => p.x), batch.map((p) => p.y)],
  );
  return (res.rows as Array<{ ok: boolean }>).map((row) => row.ok === true);
}

/**
 * 生成本季遗迹（幂等）：表里已有遗迹则不动，返回 0；否则按世界种子挑 200 处并写入。
 * 换季时在 placeWildFamousIn 之后、同一事务内调用（换季前已 TRUNCATE）；启动时补生成也走这里。
 * 调用方须在事务内。凑不齐 200 处时记录日志并写入已挑出的部分。
 */
export async function ensureRelics(client: pg.PoolClient, seed: number, worldSize: number): Promise<number> {
  await client.query(`SELECT pg_advisory_xact_lock($1)`, [RELIC_GEN_LOCK_ID]);
  const existing = await client.query(`SELECT count(*)::int AS n FROM fog_relics`);
  if ((existing.rows[0] as { n: number }).n > 0) {
    return 0;
  }
  const placed: PlacedRelic[] = await placeRelics(seed, (batch) => eligibleFlags(client, batch), worldSize);
  if (placed.length < RELIC_TOTAL) {
    console.error(`fog relics: placed ${placed.length} of ${RELIC_TOTAL}`);
  }
  if (placed.length > 0) {
    await client.query(
      `INSERT INTO fog_relics (x, y, tier, kind)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[])`,
      [placed.map((p) => p.x), placed.map((p) => p.y), placed.map((p) => p.tier), placed.map((p) => p.kind)],
    );
  }
  return placed.length;
}

export interface RelicRow {
  x: number;
  y: number;
  tier: RelicTier;
  kind: RelicKind;
}

/** 视窗内未领取的遗迹（只读；调用方负责按探索状态裁剪） */
export async function unclaimedRelicsInWindow(q: Queryable, x: number, y: number, w: number, h: number): Promise<RelicRow[]> {
  const res = await q.query(
    `SELECT x, y, tier, kind FROM fog_relics
     WHERE claimed_by IS NULL AND x >= $1 AND x < $1 + $3 AND y >= $2 AND y < $2 + $4`,
    [x, y, w, h],
  );
  return (res.rows as Array<{ x: number; y: number; tier: RelicTier; kind: RelicKind }>).map((row) => ({ ...row }));
}

/** 全部未领取的遗迹（小地图 / 探索简报按区块筛选用，数量上限 200） */
export async function allUnclaimedRelics(q: Queryable): Promise<RelicRow[]> {
  const res = await q.query(`SELECT x, y, tier, kind FROM fog_relics WHERE claimed_by IS NULL`);
  return res.rows as RelicRow[];
}

/** 某格是否还有未领取的遗迹 */
export async function hasUnclaimedRelicAt(q: Queryable, x: number, y: number): Promise<boolean> {
  const res = await q.query(`SELECT 1 FROM fog_relics WHERE x = $1 AND y = $2 AND claimed_by IS NULL`, [x, y]);
  return (res.rowCount ?? 0) > 0;
}

export interface HeroSiteRow {
  x: number;
  y: number;
  hero: string;
  claimed: boolean;
}

/** 视窗内的名将处所（8 处；claimed = **本账号**已拥有该名将，v103 AISLG-245 起按账号判） */
export async function heroSitesInWindow(
  q: Queryable,
  accountId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<HeroSiteRow[]> {
  const res = await q.query(
    `SELECT wt.x, wt.y, wt.wild_hero AS hero,
            EXISTS (SELECT 1 FROM famous_heroes fh WHERE fh.name = wt.wild_hero AND fh.owner_account_id = $6) AS claimed
     FROM world_tiles wt
     WHERE wt.wild_hero = ANY($1::text[]) AND wt.x >= $2 AND wt.x < $2 + $4 AND wt.y >= $3 AND wt.y < $3 + $5`,
    [HERO_SITES.map((site) => site.hero), x, y, w, h, accountId],
  );
  return (res.rows as Array<{ x: number; y: number; hero: string; claimed: boolean }>).map((row) => ({
    x: row.x,
    y: row.y,
    hero: row.hero,
    claimed: row.claimed === true,
  }));
}

/** 名城首探者：名城名 → 首探者用户名（尚无人首探的名城不在表里） */
export async function famousFirstExplorers(q: Queryable): Promise<Map<string, string>> {
  const res = await q.query(`SELECT target_key, username FROM fog_first_explores WHERE target_key LIKE 'famous:%'`);
  const out = new Map<string, string>();
  for (const row of res.rows as Array<{ target_key: string; username: string }>) {
    out.set(row.target_key.slice('famous:'.length), row.username);
  }
  return out;
}

/** 账号今日（北京日）已领取的遗迹数 */
export async function relicsClaimedToday(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM fog_relics
     WHERE claimed_by = $1
       AND (claimed_at AT TIME ZONE 'Asia/Shanghai')::date = (now() AT TIME ZONE 'Asia/Shanghai')::date`,
    [accountId],
  );
  return (res.rows[0] as { n: number }).n;
}
