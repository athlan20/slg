// 名将忠诚度（AISLG-228，v94）：纯规则（只有 29 名在野名将、概率 / 赎金公式、注入随机数）；数据库侧的
// 招揽 / 迁移初值、按名将锚点的自然下降、赏赐 +10 与上限 / 每日次数、30 线提醒只一次、0 下野（全服归属清除、
// 城守撤掉、好感从头算、原野地不变、可重新招揽）、行军中延后下野、欠饷每小时 −1、囚禁中不衰减。
// 需要 TEST_DATABASE_URL（一次性临时库），否则跳过纯规则之外的用例。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { FAMOUS_CITY_HEROES, rollFamousAttrs, rollNormalHero } from '../common/src/hero';
import { WILD_FAMOUS_HEROES, WILD_FAMOUS_NAMES } from '../common/src/hero-wild';
import { grantFamousHero, insertHero, loadHero, type AccountHeroRow } from '../common/src/hero-db';
import { loadWildHeroAttrs } from '../common/src/wild-famous-db';
import {
  captureChancePercent,
  clampLoyalty,
  hasLoyalty,
  initialLoyalty,
  loyaltyAfterGift,
  loyaltyAfterRansom,
  ransomCost,
  ransomTakerShare,
  rollCapture,
} from '../common/src/hero-loyalty';
import { RESET_TABLES } from '../common/src/season-tables';
import { settleHeroSalary } from '../worker/src/hero-salary-tick';
import { createTempDatabase, type TempDatabase } from './season-test-db';
import { callAs, capitalIdOf, makeLoyaltyTick, newAccount } from './hero-loyalty-util';
import { Op } from '../common/src/protocol';

// ---- 纯规则（不需要数据库） ----

test('在野名将 29 名都有忠诚度，名城与黄巾名将没有', () => {
  assert.equal(WILD_FAMOUS_NAMES.length, 29);
  for (const name of WILD_FAMOUS_NAMES) {
    assert.equal(hasLoyalty(name), true, name);
    assert.equal(initialLoyalty(name), 100, name);
  }
  for (const def of FAMOUS_CITY_HEROES) {
    assert.equal(hasLoyalty(def.name), false, def.name);
    assert.equal(initialLoyalty(def.name), null, def.name);
  }
  assert.equal(hasLoyalty('张角'), false);
  assert.equal(WILD_FAMOUS_HEROES.length, 29);
});

test('被俘概率 = 5% + (100 − 忠诚度) × 0.25%，忠诚度越低越容易被俘', () => {
  assert.equal(captureChancePercent(100), 5);
  assert.equal(captureChancePercent(50), 17.5);
  assert.equal(captureChancePercent(10), 27.5);
  assert.equal(captureChancePercent(0), 30);
  assert.equal(captureChancePercent(-5), 30, '入参先钳到 0..100');
});

test('掷骰可注入：rng 小于概率即被俘，否则不被俘', () => {
  assert.equal(rollCapture(100, () => 0.04), true);
  assert.equal(rollCapture(100, () => 0.06), false);
  assert.equal(rollCapture(10, () => 0.2), true);
  assert.equal(rollCapture(10, () => 0.3), false);
});

test('赎金 = 2000 × 等级（至少 1 级）；胜方收 50% 向下取整，其余销毁', () => {
  assert.equal(ransomCost(20), 40_000);
  assert.equal(ransomCost(0), 2_000);
  assert.equal(ransomTakerShare(40_000), 20_000);
  assert.equal(ransomTakerShare(6_001), 3_000);
});

test('赎回后忠诚度 −20 最低保留 1；赏赐 +10 上限 100；钳制', () => {
  assert.equal(loyaltyAfterRansom(80), 60);
  assert.equal(loyaltyAfterRansom(5), 1);
  assert.equal(loyaltyAfterRansom(20), 1);
  assert.equal(loyaltyAfterGift(50), 60);
  assert.equal(loyaltyAfterGift(95), 100);
  assert.equal(loyaltyAfterGift(100), 100);
  assert.equal(clampLoyalty(120), 100);
  assert.equal(clampLoyalty(-3), 0);
});

test('season-tables：被俘频率限制表换季清空', () => {
  assert.ok(RESET_TABLES.includes('hero_capture_limits'));
});

// ---- 数据库用例 ----

const dbUrl = process.env.TEST_DATABASE_URL;

describe('名将忠诚度（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  let nextTick: () => Promise<number>;
  const tag = `loy-${Date.now()}`;
  let wildIndex = 0;

  /** 给账号招揽一名在野名将（属性取落位时的固定属性，忠诚度 100） */
  async function recruitWild(accountId: string, name?: string): Promise<AccountHeroRow> {
    const def = WILD_FAMOUS_HEROES[wildIndex];
    wildIndex += 1;
    const heroName = name ?? def.name;
    const attrs = (await loadWildHeroAttrs(pool, heroName)) ?? rollFamousAttrs(Math.random);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hero = await grantFamousHero(client, accountId, { name: heroName, source: { kind: 'wild' } }, attrs);
      await client.query('COMMIT');
      assert.ok(hero, `名将 ${heroName} 授予失败`);
      return hero;
    } finally {
      client.release();
    }
  }

  async function heroRow(id: string): Promise<AccountHeroRow | null> {
    return loadHero(pool, id);
  }

  /** 把武将的忠诚度结算锚点往前推 hours 小时（模拟时间流逝；tick 以数据库时钟为准） */
  async function ageHero(id: string, hours: number): Promise<void> {
    await pool.query(`UPDATE account_heroes SET loyalty_at = now() - make_interval(secs => $2) WHERE id = $1`, [id, hours * 3600]);
  }

  async function eventCount(accountId: string, type: string): Promise<number> {
    const res = await pool.query(`SELECT count(*)::int AS n FROM events WHERE account_id = $1 AND type = $2`, [accountId, type]);
    return (res.rows[0] as { n: number }).n;
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'loyalty');
    pool = new pg.Pool({ connectionString: db.url, max: 12 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    nextTick = makeLoyaltyTick(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('招揽在野名将 → 忠诚度 100 且有锚点；普通将 / 名城名将忠诚度为 null', async () => {
    const owner = await newAccount(pool, `${tag}-init`);
    const wild = await recruitWild(owner);
    assert.equal(wild.loyalty, 100);
    assert.notEqual(wild.loyalty_at, null);
    assert.equal(wild.loyalty_warned, false);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ordinary = await insertHero(client, owner, { name: rollNormalHero(Math.random).name, famous: false, lead: 20, force: 20, wit: 20 });
      const city = await grantFamousHero(client, owner, FAMOUS_CITY_HEROES[0], rollFamousAttrs(Math.random));
      await client.query('COMMIT');
      assert.equal(ordinary.loyalty, null);
      assert.ok(city);
      assert.equal(city.loyalty, null);
    } finally {
      client.release();
    }
  });

  test('迁移：已有的在野名将忠诚度置为 100、锚点为迁移时刻，重复跑迁移不再改动', async () => {
    const owner = await newAccount(pool, `${tag}-migrate`);
    const wild = await recruitWild(owner);
    await pool.query(`UPDATE account_heroes SET loyalty = NULL, loyalty_at = NULL WHERE id = $1`, [wild.id]);
    await ensureSchema(pool);
    const row = await heroRow(wild.id);
    assert.equal(row?.loyalty, 100);
    assert.ok(row?.loyalty_at && Date.now() - row.loyalty_at.getTime() < 60_000, '锚点为迁移时刻');
    await pool.query(`UPDATE account_heroes SET loyalty = 60 WHERE id = $1`, [wild.id]);
    await ensureSchema(pool);
    assert.equal((await heroRow(wild.id))?.loyalty, 60, '已有忠诚度的名将不被迁移覆盖');
  });

  test('迁移后的存量名将不会一上线就掉忠诚（锚点为迁移时刻）', async () => {
    const owner = await newAccount(pool, `${tag}-nodrop`);
    const wild = await recruitWild(owner);
    await pool.query(`UPDATE account_heroes SET loyalty = NULL, loyalty_at = NULL WHERE id = $1`, [wild.id]);
    await ensureSchema(pool);
    await nextTick();
    assert.equal((await heroRow(wild.id))?.loyalty, 100);
  });

  test('每 24 小时 −10，每名将按自己的锚点结算（停机积压按整周期补齐）', async () => {
    const owner = await newAccount(pool, `${tag}-decay`);
    const a = await recruitWild(owner);
    const b = await recruitWild(owner);
    await ageHero(a.id, 25);
    await ageHero(b.id, 1);
    await nextTick();
    assert.equal((await heroRow(a.id))?.loyalty, 90);
    assert.equal((await heroRow(b.id))?.loyalty, 100, '未满一周期不扣');
    await ageHero(b.id, 49);
    await nextTick();
    assert.equal((await heroRow(b.id))?.loyalty, 80, '积压 2 个周期一次补齐');
    assert.equal((await heroRow(a.id))?.loyalty, 90, '另一名将不受影响');
  });

  test('赏赐 +10，上限 100；每天第 4 次被现有规则拒绝；普通将赏赐不影响忠诚度', async () => {
    const owner = await newAccount(pool, `${tag}-gift`);
    await pool.query(`UPDATE cities SET gold = 50000 WHERE id = $1`, [await capitalIdOf(pool, owner)]);
    const wild = await recruitWild(owner);
    await pool.query(`UPDATE account_heroes SET loyalty = 95 WHERE id = $1`, [wild.id]);
    const r1 = await callAs(pool, owner, Op.GIFT_HERO, { heroId: wild.id });
    assert.equal(r1.ok, true);
    assert.equal((r1.data as { hero: { loyalty: number } }).hero.loyalty, 100);
    const r2 = await callAs(pool, owner, Op.GIFT_HERO, { heroId: wild.id });
    assert.equal((r2.data as { hero: { loyalty: number } }).hero.loyalty, 100, '封顶 100');
    await callAs(pool, owner, Op.GIFT_HERO, { heroId: wild.id });
    const r4 = await callAs(pool, owner, Op.GIFT_HERO, { heroId: wild.id });
    assert.equal(r4.ok, false);
    assert.equal(r4.error?.code, 'HERO_DAILY_LIMIT');

    const ordinaryOwner = await newAccount(pool, `${tag}-gift-ord`);
    await pool.query(`UPDATE cities SET gold = 50000 WHERE id = $1`, [await capitalIdOf(pool, ordinaryOwner)]);
    const client = await pool.connect();
    let ordinaryId = '';
    try {
      await client.query('BEGIN');
      ordinaryId = (await insertHero(client, ordinaryOwner, { name: '甲', famous: false, lead: 20, force: 20, wit: 20 })).id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const ord = await callAs(pool, ordinaryOwner, Op.GIFT_HERO, { heroId: ordinaryId });
    assert.equal((ord.data as { hero: { loyalty: number | null } }).hero.loyalty, null);
  });

  test('忠诚度降到 30 及以下只提醒一次；回到 30 以上后再降到 30 才再提醒', async () => {
    const owner = await newAccount(pool, `${tag}-warn`);
    await pool.query(`UPDATE cities SET gold = 50000 WHERE id = $1`, [await capitalIdOf(pool, owner)]);
    const wild = await recruitWild(owner);
    await pool.query(`UPDATE account_heroes SET loyalty = 40 WHERE id = $1`, [wild.id]);
    await ageHero(wild.id, 24);
    await nextTick();
    assert.equal((await heroRow(wild.id))?.loyalty, 30);
    assert.equal(await eventCount(owner, 'hero_loyalty_low'), 1, '跌到 30 提醒一次');
    await ageHero(wild.id, 24);
    await nextTick();
    assert.equal((await heroRow(wild.id))?.loyalty, 20);
    assert.equal(await eventCount(owner, 'hero_loyalty_low'), 1, '继续下降不重复提醒');
    await callAs(pool, owner, Op.GIFT_HERO, { heroId: wild.id });
    assert.equal((await heroRow(wild.id))?.loyalty, 30);
    assert.equal(await eventCount(owner, 'hero_loyalty_low'), 1, '仍在 30 线及以下，不再提醒');
    await callAs(pool, owner, Op.GIFT_HERO, { heroId: wild.id });
    assert.equal((await heroRow(wild.id))?.loyalty, 40);
    assert.equal((await heroRow(wild.id))?.loyalty_warned, false, '回到 30 以上后复位');
    await ageHero(wild.id, 24);
    await nextTick();
    assert.equal((await heroRow(wild.id))?.loyalty, 30);
    assert.equal(await eventCount(owner, 'hero_loyalty_low'), 2, '再次降到 30 再提醒一次');
  });

  test('忠诚度为 0 → 下野：删除武将、城守撤掉、全服归属清除、好感从头算、原野地不变、全服播报；之后可重新招揽', async () => {
    const owner = await newAccount(pool, `${tag}-depart`);
    const other = await newAccount(pool, `${tag}-depart-other`);
    const wild = await recruitWild(owner);
    const name = wild.name;
    const tileBefore = await pool.query(`SELECT count(*)::int AS n FROM world_tiles WHERE wild_hero = $1`, [name]);
    await pool.query(`UPDATE account_heroes SET loyalty = 10 WHERE id = $1`, [wild.id]);
    await pool.query(`UPDATE cities SET guard_hero_id = $2 WHERE id = $1`, [await capitalIdOf(pool, owner), wild.id]);
    await pool.query(`INSERT INTO hero_friendship (account_id, hero_name, favor) VALUES ($1, $2, 50)`, [other, name]);
    await pool.query(`INSERT INTO hero_unlocks (account_id, hero_name) VALUES ($1, $2)`, [owner, name]);
    await ageHero(wild.id, 24);
    await nextTick();
    assert.equal(await heroRow(wild.id), null, '武将已删除');
    const claims = await pool.query(`SELECT count(*)::int AS n FROM famous_heroes WHERE name = $1`, [name]);
    assert.equal((claims.rows[0] as { n: number }).n, 0, '全服归属清除');
    const guard = await pool.query(`SELECT guard_hero_id FROM cities WHERE account_id = $1`, [owner]);
    assert.equal((guard.rows[0] as { guard_hero_id: string | null }).guard_hero_id, null, '城守撤掉');
    const friend = await pool.query(`SELECT count(*)::int AS n FROM hero_friendship WHERE hero_name = $1`, [name]);
    assert.equal((friend.rows[0] as { n: number }).n, 0, '好感从头算');
    const tileAfter = await pool.query(`SELECT count(*)::int AS n FROM world_tiles WHERE wild_hero = $1`, [name]);
    assert.equal(tileAfter.rows[0].n, tileBefore.rows[0].n, '原野地不变');
    const unlock = await pool.query(`SELECT count(*)::int AS n FROM hero_unlocks WHERE account_id = $1 AND hero_name = $2`, [owner, name]);
    assert.equal((unlock.rows[0] as { n: number }).n, 1, '已获得的结交资格保留');
    assert.equal(await eventCount(owner, 'hero_left'), 1, '主人收到 hero_left');
    const bc = await pool.query(`SELECT detail FROM server_broadcasts WHERE type = 'hero_left' AND detail->>'heroName' = $1`, [name]);
    assert.equal(bc.rowCount, 1, '全服播报一次');
    assert.equal(Object.keys(bc.rows[0].detail as object).includes('x'), false, '播报不带坐标');

    // 下野后重新招揽：属性仍随名将落位（新行），忠诚度 100，等级与加点为初始值
    const again = await recruitWild(owner, name);
    assert.equal(again.loyalty, 100);
    assert.equal(again.level, 1);
    assert.equal(again.free_points, 0);
  });

  test('行军中的名将忠诚度为 0：不立即下野，行军结束后的下一轮才下野', async () => {
    const owner = await newAccount(pool, `${tag}-busy`);
    const wild = await recruitWild(owner);
    const city = await capitalIdOf(pool, owner);
    const march = await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, hero_id)
       VALUES ($1, $2, 10, 10, '{}'::jsonb, 'plunder', 'marching', 'player', now() + interval '1 hour', $3) RETURNING id`,
      [owner, city, wild.id],
    );
    const marchId = (march.rows[0] as { id: string }).id;
    await pool.query(`UPDATE account_heroes SET loyalty = 0 WHERE id = $1`, [wild.id]);
    await nextTick();
    assert.ok(await heroRow(wild.id), '行军中暂不下野');
    assert.equal((await heroRow(wild.id))?.loyalty, 0);
    await pool.query(`UPDATE marches SET status = 'arrived', resolved_at = now() WHERE id = $1`, [marchId]);
    await nextTick();
    assert.equal(await heroRow(wild.id), null, '行军结束后下野');
  });

  test('历练中的名将忠诚度为 0：历练结束后才下野（与行军同口径）', async () => {
    const owner = await newAccount(pool, `${tag}-training`);
    const wild = await recruitWild(owner);
    await pool.query(
      `UPDATE account_heroes SET loyalty = 0, train_until = now() + interval '1 hour', train_tier = 1, train_exp = 0 WHERE id = $1`,
      [wild.id],
    );
    await nextTick();
    assert.ok(await heroRow(wild.id), '历练中暂不下野');
    await pool.query(`UPDATE account_heroes SET train_until = NULL, train_tier = NULL, train_exp = NULL WHERE id = $1`, [wild.id]);
    await nextTick();
    assert.equal(await heroRow(wild.id), null, '历练结束后下野');
  });

  test('欠饷重试不推后下次扣俸禄时间：补上金币后下一小时照常扣', async () => {
    const owner = await newAccount(pool, `${tag}-arrears-next`);
    const wild = await recruitWild(owner);
    const cityId = await capitalIdOf(pool, owner);
    await pool.query(`UPDATE cities SET gold = 0 WHERE id = $1`, [cityId]);
    await pool.query(`UPDATE account_heroes SET salary_at = now() - interval '1 second' WHERE id = $1`, [wild.id]);
    const t0 = Date.now();
    const client = await pool.connect();
    try {
      const settle = async (nowMs: number, gold: number) => {
        await client.query('BEGIN');
        const row = (await client.query(`SELECT * FROM account_heroes WHERE id = $1 FOR UPDATE`, [wild.id])).rows[0] as AccountHeroRow;
        await settleHeroSalary(client, row, { id: cityId, gold }, nowMs);
        await client.query('COMMIT');
      };
      await settle(t0, 0);
      const firstNext = (await heroRow(wild.id))?.salary_at as Date;
      for (let tick = 1; tick <= 360; tick += 1) {
        await settle(t0 + tick * 10_000, 0);
      }
      assert.equal(((await heroRow(wild.id))?.salary_at as Date).getTime(), firstNext.getTime(), '欠饷 1 小时内反复重试，时间不动');
      const recoverAt = t0 + 3_600_000 + 10_000;
      await settle(recoverAt, 1_000_000);
      const next = ((await heroRow(wild.id))?.salary_at as Date).getTime();
      assert.equal((await heroRow(wild.id))?.arrears, false);
      assert.ok(next <= recoverAt + 3_600_000, '补上后最多 1 小时再扣');
    } finally {
      client.release();
    }
  });

  test('欠饷期间每小时 −1，补上俸禄后停止；只在俸禄结算里扣', async () => {
    const owner = await newAccount(pool, `${tag}-arrears`);
    const wild = await recruitWild(owner);
    const cityId = await capitalIdOf(pool, owner);
    await pool.query(`UPDATE cities SET gold = 0 WHERE id = $1`, [cityId]);
    await pool.query(`UPDATE account_heroes SET salary_at = now() - interval '1 second' WHERE id = $1`, [wild.id]);
    const t0 = Date.now();
    const client = await pool.connect();
    try {
      const settle = async (nowMs: number, gold: number) => {
        await client.query('BEGIN');
        const row = (await client.query(`SELECT * FROM account_heroes WHERE id = $1 FOR UPDATE`, [wild.id])).rows[0] as AccountHeroRow;
        await settleHeroSalary(client, row, { id: cityId, gold }, nowMs);
        await client.query('COMMIT');
      };
      await settle(t0, 0);
      assert.equal((await heroRow(wild.id))?.arrears, true);
      assert.equal((await heroRow(wild.id))?.loyalty, 100, '欠饷刚开始，第一小时内不扣');
      await settle(t0 + 30 * 60_000, 0);
      assert.equal((await heroRow(wild.id))?.loyalty, 100);
      await settle(t0 + 61 * 60_000, 0);
      assert.equal((await heroRow(wild.id))?.loyalty, 99, '满一小时 −1');
      await settle(t0 + 122 * 60_000, 0);
      assert.equal((await heroRow(wild.id))?.loyalty, 98);
      await settle(t0 + 123 * 60_000, 1_000_000);
      assert.equal((await heroRow(wild.id))?.arrears, false, '补上俸禄');
      const paidAt = (await heroRow(wild.id))?.loyalty;
      await settle(t0 + 300 * 60_000, 1_000_000);
      assert.equal((await heroRow(wild.id))?.loyalty, paidAt, '补齐后不再扣');
    } finally {
      client.release();
    }
  });
});
