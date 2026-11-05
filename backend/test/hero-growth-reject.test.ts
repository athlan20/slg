// 武将培养与结交的拒绝路径（AISLG-228 测试发现）：拒绝时要等 ROLLBACK 完成再归还连接。线上连接池（createPool）的
// release 钩子会结束还有未完成查询的连接，ROLLBACK 随之失败，玩家收到 INTERNAL。普通 pg.Pool 没有这个钩子，
// 所以本文件必须用 createPool 并走真实 handler。覆盖：囚禁中的五个入口返回 HERO_CAPTURED 且数据不变；
// 当日第 4 次赏赐返回 HERO_DAILY_LIMIT；结交没有资格返回 HERO_NOT_UNLOCKED。需要 TEST_DATABASE_URL（一次性临时库，
// 别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type pg from 'pg';
import { createPool, ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { rollFamousAttrs } from '../common/src/hero';
import { WILD_FAMOUS_HEROES } from '../common/src/hero-wild';
import { grantFamousHero, type AccountHeroRow } from '../common/src/hero-db';
import { loadWildHeroAttrs } from '../common/src/wild-famous-db';
import { tryCaptureHero } from '../common/src/hero-capture-db';
import { Op } from '../common/src/protocol';
import { createTempDatabase, type TempDatabase } from './season-test-db';
import { callAs, capitalIdOf, newAccount } from './hero-loyalty-util';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('武将培养与结交的拒绝路径（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase | undefined;
  let pool: pg.Pool;
  const savedUrl = process.env.DATABASE_URL;
  const tag = `rej-${Date.now()}`;
  let wildIndex = 0;

  /** 按名单顺序取一名在野名将，授予给账号（名字全服唯一，每个用例用一名） */
  async function recruitWild(accountId: string): Promise<AccountHeroRow> {
    const def = WILD_FAMOUS_HEROES[wildIndex];
    wildIndex += 1;
    const attrs = (await loadWildHeroAttrs(pool, def.name)) ?? rollFamousAttrs(Math.random);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hero = await grantFamousHero(client, accountId, { name: def.name, source: { kind: 'wild' } }, attrs);
      await client.query('COMMIT');
      if (!hero) {
        throw new Error(`授予 ${def.name} 失败`);
      }
      return hero;
    } finally {
      client.release();
    }
  }

  /** 俘虏（rng 恒为 0 必定被俘；测试直接调用公共函数，不经过 handler） */
  async function captureHero(heroId: string, captorAccountId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await tryCaptureHero(client, { heroId, captorAccountId, rng: () => 0 });
      await client.query('COMMIT');
      assert.ok(out, '俘虏应成功');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function setGold(accountId: string, gold: number): Promise<void> {
    await pool.query(`UPDATE cities SET gold = $2 WHERE id = $1`, [await capitalIdOf(pool, accountId), gold]);
  }

  async function goldOf(accountId: string): Promise<number> {
    const res = await pool.query(`SELECT gold FROM cities WHERE id = $1`, [await capitalIdOf(pool, accountId)]);
    return Number((res.rows[0] as { gold: number }).gold);
  }

  /** 武将行全字段 + 主人主城金币：拒绝前后应完全一致 */
  async function snapshot(heroId: string, accountId: string) {
    const hero = await pool.query(`SELECT * FROM account_heroes WHERE id = $1`, [heroId]);
    return { hero: hero.rows[0], gold: await goldOf(accountId) };
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'hero_growth_reject');
    process.env.DATABASE_URL = tmp.url;
    const maintenance = createPool('hero-reject-schema', 2, { maintenance: true });
    await ensureSchema(maintenance);
    await ensureWorld(maintenance);
    await maintenance.end();
    // 线上同款连接池（带 release 钩子）：这是复现 ROLLBACK 失败的前提
    pool = createPool('hero-growth-reject', 4);
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  test('囚禁中的名将：加点、洗点、历练、赏赐、取消历练都返回 HERO_CAPTURED，武将行与金币不变', async () => {
    const owner = await newAccount(pool, `${tag}-captive`);
    const captor = await newAccount(pool, `${tag}-captive-captor`);
    await setGold(owner, 100_000);
    const h = await recruitWild(owner);
    // 有自由点数、有已分配点数：若囚禁校验缺失，各入口都会真正改动数据
    await pool.query(`UPDATE account_heroes SET free_points = 5, lead = base_lead + 3 WHERE id = $1`, [h.id]);
    await captureHero(h.id, captor);
    const before = await snapshot(h.id, owner);

    const cases: Array<[number, Record<string, unknown>]> = [
      [Op.ALLOCATE_HERO_POINTS, { heroId: h.id, lead: 1 }],
      [Op.RESET_HERO_POINTS, { heroId: h.id }],
      [Op.TRAIN_HERO, { heroId: h.id, tier: 1 }],
      [Op.GIFT_HERO, { heroId: h.id }],
      [Op.CANCEL_TRAINING, { heroId: h.id }],
    ];
    for (const [op, data] of cases) {
      const res = await callAs(pool, owner, op, data);
      assert.equal(res.ok, false, `op ${op} 应被拒绝`);
      assert.equal(res.error?.code, 'HERO_CAPTURED', `op ${op} 错误码`);
    }
    assert.deepEqual(await snapshot(h.id, owner), before, '拒绝后武将行与金币不变');
  });

  test('同一武将当日第 4 次赏赐返回 HERO_DAILY_LIMIT，金币与武将行不变', async () => {
    const owner = await newAccount(pool, `${tag}-gift`);
    await setGold(owner, 10_000);
    const h = await recruitWild(owner);
    for (let index = 0; index < 3; index += 1) {
      const ok = await callAs(pool, owner, Op.GIFT_HERO, { heroId: h.id });
      assert.equal(ok.ok, true, `第 ${index + 1} 次赏赐应成功：${JSON.stringify(ok.error)}`);
    }
    const before = await snapshot(h.id, owner);
    const res = await callAs(pool, owner, Op.GIFT_HERO, { heroId: h.id });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'HERO_DAILY_LIMIT');
    assert.deepEqual(await snapshot(h.id, owner), before, '第 4 次拒绝后数据不变');
  });

  test('没有结交资格（未打赢原住守军）的 BEFRIEND_HERO 返回 HERO_NOT_UNLOCKED，金币与结交进度不变', async () => {
    const owner = await newAccount(pool, `${tag}-befriend`);
    await setGold(owner, 100_000);
    const name = WILD_FAMOUS_HEROES[wildIndex].name;
    const before = await goldOf(owner);
    const res = await callAs(pool, owner, Op.BEFRIEND_HERO, { heroName: name });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'HERO_NOT_UNLOCKED');
    assert.equal(await goldOf(owner), before, '金币不变');
    const friendship = await pool.query(`SELECT 1 FROM hero_friendship WHERE account_id = $1 AND hero_name = $2`, [owner, name]);
    assert.equal(friendship.rowCount, 0, '没有结交进度');
    assert.equal((await pool.query(`SELECT 1 AS ok`)).rows[0].ok, 1, '连接池仍可用');
  });
});
