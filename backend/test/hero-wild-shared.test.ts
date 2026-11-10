// 在野名将改为每个账号各自可得（AISLG-245，v104）：29 名在野名将从「全服唯一」缩到「同一账号不能有两个」，
// 不同账号各走一遍流程互不影响；名城 8 / 黄巾 3 / 势力首领 5 共 16 名仍全服唯一；地图名将标记按账号判；
// 名将所在野地不能被占领；下野只清本账号。需要 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld, loadTile } from '../common/src/world-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { FAMOUS_CITY_HEROES, FACTION_HEROES, YT_HERO_BOSS, YT_HERO_RANKS, rollFamousAttrs } from '../common/src/hero';
import { WILD_FAMOUS_NAMES } from '../common/src/hero-wild';
import { grantFamousHero, loadFamousClaims, type AccountHeroRow } from '../common/src/hero-db';
import { loadWildHeroAttrs } from '../common/src/wild-famous-db';
import { departHero } from '../common/src/hero-loyalty-db';
import { unlockedHeroNames } from '../common/src/hero-friendship-db';
import { Op } from '../common/src/protocol';
import { loadWorldWindow } from '../api/src/views-world';
import { resolveMarchTarget } from '../api/src/march-target';
import { createTempDatabase, type TempDatabase } from './season-test-db';
import { callAs, capitalIdOf, newAccount } from './hero-loyalty-util';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('在野名将每个账号各自可得（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase | undefined;
  let pool: pg.Pool;
  const tag = `wild-${Date.now()}`;
  let wildIndex = 0;

  /** 按名单顺序取一名在野名将（每个用例用不同的名字，互不干扰） */
  function nextWildName(): string {
    const name = WILD_FAMOUS_NAMES[wildIndex];
    wildIndex += 1;
    assert.ok(name, '在野名将名单用完了');
    return name;
  }

  /** 直接授予一名在野名将（绕过结交流程，给需要多个名将的用例用） */
  async function grantWild(accountId: string, name: string): Promise<AccountHeroRow> {
    const attrs = (await loadWildHeroAttrs(pool, name)) ?? rollFamousAttrs(Math.random);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hero = await grantFamousHero(client, accountId, { name, source: { kind: 'wild' } }, attrs);
      await client.query('COMMIT');
      assert.ok(hero, `名将 ${name} 授予失败`);
      return hero;
    } finally {
      client.release();
    }
  }

  async function setGold(accountId: string, gold: number): Promise<void> {
    await pool.query(`UPDATE cities SET gold = $2 WHERE id = $1`, [await capitalIdOf(pool, accountId), gold]);
  }

  /** 走正常流程拿到一名在野名将：先给结交资格（等价于打赢守军），API 结交 5 次到当日上限，再补齐好感后招揽 */
  async function recruitByApi(accountId: string, name: string): Promise<AccountHeroRow> {
    await setGold(accountId, 100_000);
    await pool.query(`INSERT INTO hero_unlocks (account_id, hero_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      accountId,
      name,
    ]);
    for (let index = 0; index < 5; index += 1) {
      const res = await callAs(pool, accountId, Op.BEFRIEND_HERO, { heroName: name });
      assert.equal(res.ok, true, `第 ${index + 1} 次结交应成功：${JSON.stringify(res.error)}`);
    }
    const limited = await callAs(pool, accountId, Op.BEFRIEND_HERO, { heroName: name });
    assert.equal(limited.ok, false, '当日第 6 次结交仍被拒');
    assert.equal(limited.error?.code, 'HERO_DAILY_LIMIT');
    await pool.query(`UPDATE hero_friendship SET favor = 100 WHERE account_id = $1 AND hero_name = $2`, [accountId, name]);
    const res = await callAs(pool, accountId, Op.RECRUIT_FAMOUS_HERO, { heroName: name });
    assert.equal(res.ok, true, `招揽应成功：${JSON.stringify(res.error)}`);
    const heroId = (res.data as { hero: { id: string } }).hero.id;
    const hero = (await pool.query(`SELECT * FROM account_heroes WHERE id = $1`, [heroId])).rows[0] as AccountHeroRow;
    return hero;
  }

  async function famousRows(name: string): Promise<Array<{ owner_account_id: string; source: string }>> {
    const res = await pool.query(`SELECT owner_account_id, source FROM famous_heroes WHERE name = $1`, [name]);
    return res.rows as Array<{ owner_account_id: string; source: string }>;
  }

  async function claimOf(name: string) {
    const views = await loadFamousClaims(pool);
    const view = views.find((item) => item.name === name);
    assert.ok(view, `${name} 应在名将列表里`);
    return view;
  }

  /** 在事务内让名将下野（忠诚度归零路径，需要行锁） */
  async function depart(heroId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`SELECT * FROM account_heroes WHERE id = $1 FOR UPDATE`, [heroId]))
        .rows[0] as AccountHeroRow;
      const outcome = await departHero(client, row, 'loyalty');
      await client.query('COMMIT');
      assert.notEqual(outcome, 'busy', '下野不应被判为忙碌');
    } finally {
      client.release();
    }
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'wildshare');
    pool = new pg.Pool({ connectionString: tmp.url, max: 8 });
    await ensureSchema(pool);
    await ensureWorld(pool);
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('两个账号各自走完结交招揽同一名将，各拿一个、互不影响', async () => {
    const name = nextWildName();
    const a = await newAccount(pool, `${tag}-a`);
    const b = await newAccount(pool, `${tag}-b`);
    const heroA = await recruitByApi(a, name);
    const heroB = await recruitByApi(b, name);
    assert.notEqual(heroA.id, heroB.id);
    assert.equal(heroA.name, name);
    assert.equal(heroB.name, name);
    assert.deepEqual((await famousRows(name)).map((row) => row.owner_account_id).sort(), [a, b].sort());
    const claim = await claimOf(name);
    assert.equal(claim.ownerCount, 2, '全服已有 2 人拥有');
    assert.equal(claim.ownerUsername, null, '在野名将不再显示单一持有人');
    // 两人各自的名将上限计数各算各的
    const counts = await pool.query(
      `SELECT account_id, count(*)::int AS n FROM account_heroes WHERE famous AND account_id = ANY($1::uuid[]) GROUP BY account_id`,
      [[a, b]],
    );
    for (const row of counts.rows as Array<{ n: number }>) {
      assert.equal(row.n, 1);
    }
  });

  test('同一账号不能招揽第二个同名名将（FAMOUS_CLAIMED），也不影响别的账号', async () => {
    const name = nextWildName();
    const a = await newAccount(pool, `${tag}-dup`);
    const b = await newAccount(pool, `${tag}-dup-b`);
    await recruitByApi(a, name);
    // 重新攒满好感再招一次
    await pool.query(`INSERT INTO hero_unlocks (account_id, hero_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [a, name]);
    await pool.query(`INSERT INTO hero_friendship (account_id, hero_name, favor) VALUES ($1, $2, 100)`, [a, name]);
    const again = await callAs(pool, a, Op.RECRUIT_FAMOUS_HERO, { heroName: name });
    assert.equal(again.ok, false);
    assert.equal(again.error?.code, 'FAMOUS_CLAIMED');
    assert.equal((await famousRows(name)).filter((row) => row.owner_account_id === a).length, 1);
    // 别的账号照旧可以拿
    await recruitByApi(b, name);
    assert.equal((await claimOf(name)).ownerCount, 2);
  });

  test('名将上限 3 名仍生效：已满 3 名时第 4 名招揽返回 HERO_CAP_REACHED', async () => {
    const owner = await newAccount(pool, `${tag}-cap`);
    for (let index = 0; index < 3; index += 1) {
      await grantWild(owner, nextWildName());
    }
    const name = nextWildName();
    await pool.query(`INSERT INTO hero_unlocks (account_id, hero_name) VALUES ($1, $2)`, [owner, name]);
    await pool.query(`INSERT INTO hero_friendship (account_id, hero_name, favor) VALUES ($1, $2, 100)`, [owner, name]);
    const res = await callAs(pool, owner, Op.RECRUIT_FAMOUS_HERO, { heroName: name });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'HERO_CAP_REACHED');
    assert.equal((await famousRows(name)).length, 0, '拒绝时不产生归属行');
  });

  test('一方被俘下野：只清本账号的名将与结交进度，另一方的同名名将与进度不变', async () => {
    const name = nextWildName();
    const a = await newAccount(pool, `${tag}-depart-a`);
    const b = await newAccount(pool, `${tag}-depart-b`);
    const heroA = await grantWild(a, name);
    const heroB = await grantWild(b, name);
    await pool.query(`INSERT INTO hero_friendship (account_id, hero_name, favor) VALUES ($1, $2, 60)`, [a, name]);
    await pool.query(`INSERT INTO hero_friendship (account_id, hero_name, favor) VALUES ($1, $2, 70)`, [b, name]);
    await pool.query(`INSERT INTO hero_unlocks (account_id, hero_name) VALUES ($1, $2)`, [b, name]);

    await depart(heroA.id);

    assert.equal((await pool.query(`SELECT 1 FROM account_heroes WHERE id = $1`, [heroA.id])).rowCount, 0, 'A 的武将已下野');
    assert.ok((await pool.query(`SELECT 1 FROM account_heroes WHERE id = $1`, [heroB.id])).rowCount, 'B 的名将还在');
    assert.deepEqual((await famousRows(name)).map((row) => row.owner_account_id), [b], '只剩 B 的归属行');
    assert.equal((await pool.query(`SELECT 1 FROM hero_friendship WHERE account_id = $1 AND hero_name = $2`, [a, name])).rowCount, 0, 'A 的结交进度清空');
    const bFriend = await pool.query(`SELECT favor FROM hero_friendship WHERE account_id = $1 AND hero_name = $2`, [b, name]);
    assert.equal((bFriend.rows[0] as { favor: number } | undefined)?.favor, 70, 'B 的结交进度不变');
    const bUnlock = await pool.query(`SELECT 1 FROM hero_unlocks WHERE account_id = $1 AND hero_name = $2`, [b, name]);
    assert.ok(bUnlock.rowCount, 'B 的结交资格不受影响');
    assert.deepEqual(await unlockedHeroNames(pool, b), [], 'B 已拥有该名将，资格列表里不再单列（口径不变）');
    assert.equal((await claimOf(name)).ownerCount, 1);
  });

  test('名城 / 黄巾 / 势力首领 16 名仍全服唯一：第二个账号授予失败，也不产生名下多行', async () => {
    const defs = [...FAMOUS_CITY_HEROES, YT_HERO_BOSS, ...YT_HERO_RANKS, ...FACTION_HEROES];
    assert.equal(defs.length, 16, '名城 8 + 黄巾 3 + 势力首领 5');
    const a = await newAccount(pool, `${tag}-sole-a`);
    const b = await newAccount(pool, `${tag}-sole-b`);
    for (const def of defs.slice(0, 3)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const first = await grantFamousHero(client, a, def, rollFamousAttrs(Math.random));
        assert.ok(first, `${def.name} 第一次授予应成功`);
        const second = await grantFamousHero(client, b, def, rollFamousAttrs(Math.random));
        assert.equal(second, null, `${def.name} 已被 A 获得，B 应失败`);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      assert.equal((await famousRows(def.name)).length, 1, `${def.name} 全服只有一行`);
    }
  });

  test('地图名将标记与名将情报按账号判；名将所在野地不能被占领', async () => {
    const name = nextWildName();
    const owner = await newAccount(pool, `${tag}-map-a`);
    const other = await newAccount(pool, `${tag}-map-b`);
    const spot = (await pool.query(`SELECT x, y FROM world_tiles WHERE wild_hero = $1`, [name])).rows[0] as {
      x: number;
      y: number;
    };
    const before = await loadWorldWindow(pool, spot.x, spot.y, 1, 1, other);
    assert.equal(before[0].wildFamous, true, '还没人拥有时两人都能看到标记');

    await grantWild(owner, name);
    const mine = await loadWorldWindow(pool, spot.x, spot.y, 1, 1, owner);
    const theirs = await loadWorldWindow(pool, spot.x, spot.y, 1, 1, other);
    assert.equal(mine[0].wildFamous, false, '本账号已拥有 → 自己的地图上标记撤下');
    assert.equal(theirs[0].wildFamous, true, '别的账号仍能看到标记');

    const client = await pool.connect();
    try {
      const tile = await loadTile(client, spot.x, spot.y);
      assert.ok(tile);
      const verdict = await resolveMarchTarget(
        client,
        other,
        await capitalIdOf(pool, other),
        tile,
        'occupy',
        5,
        new Date(),
      );
      assert.equal(verdict.reason, 'WILD_HERO_UNOCCUPIABLE', '名将所在野地不能被占领');
      assert.equal(verdict.purpose, null);
      // 对照：同等级、没有名将的无主野地照常可以占领
      const plain = (
        await pool.query(
          `SELECT x, y FROM world_tiles WHERE kind = 'wilderness' AND wild_hero IS NULL AND owner_city_id IS NULL LIMIT 1`,
        )
      ).rows[0] as { x: number; y: number };
      const plainTile = await loadTile(client, plain.x, plain.y);
      assert.ok(plainTile);
      const ok = await resolveMarchTarget(client, other, await capitalIdOf(pool, other), plainTile, 'occupy', 5, new Date());
      assert.equal(ok.purpose, 'occupy');
    } finally {
      client.release();
    }
  });

  test('迁移幂等且向后兼容：连跑两次 ensureSchema 不报错，旧的主键 (name) 会被放宽', async () => {
    await ensureSchema(pool);
    await ensureSchema(pool);
    const pk = await pool.query(
      `SELECT a.attname FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'famous_heroes'::regclass AND c.contype = 'p'
        ORDER BY a.attname`,
    );
    assert.deepEqual((pk.rows as Array<{ attname: string }>).map((row) => row.attname).sort(), ['name', 'owner_account_id']);
    const idx = await pool.query(`SELECT 1 FROM pg_indexes WHERE tablename = 'famous_heroes' AND indexname = 'uq_famous_heroes_sole_owner'`);
    assert.equal(idx.rowCount, 1, '非在野名将的全服唯一索引在');

    // 旧结构（主键只有 name）的库重跑迁移后能放宽到 (name, owner_account_id)：另起一个库模拟存量库
    const legacy = await createTempDatabase(dbUrl as string, 'wildlegacy');
    const legacyPool = new pg.Pool({ connectionString: legacy.url, max: 4 });
    try {
      await ensureSchema(legacyPool);
      await legacyPool.query(`ALTER TABLE famous_heroes DROP CONSTRAINT famous_heroes_pkey`);
      await legacyPool.query(`ALTER TABLE famous_heroes ADD PRIMARY KEY (name)`);
      await ensureSchema(legacyPool);
      const legacyPk = await legacyPool.query(
        `SELECT a.attname FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'famous_heroes'::regclass AND c.contype = 'p'`,
      );
      assert.deepEqual(
        (legacyPk.rows as Array<{ attname: string }>).map((row) => row.attname).sort(),
        ['name', 'owner_account_id'],
        '旧主键被放宽',
      );
      const lc = await legacyPool.connect();
      try {
        await lc.query('BEGIN');
        const la = (await lc.query(`INSERT INTO accounts (username, password_hash) VALUES ('${tag}-legacy-a', 'x') RETURNING id`))
          .rows[0].id as string;
        const lb = (await lc.query(`INSERT INTO accounts (username, password_hash) VALUES ('${tag}-legacy-b', 'x') RETURNING id`))
          .rows[0].id as string;
        const mkHero = async (accountId: string): Promise<string> =>
          (
            await lc.query(
              `INSERT INTO account_heroes (account_id, name, famous, lead, force, wit) VALUES ($1, '关羽', true, 80, 80, 80) RETURNING id`,
              [accountId],
            )
          ).rows[0].id as string;
        const h1 = await mkHero(la);
        const h2 = await mkHero(lb);
        await lc.query(`INSERT INTO famous_heroes (name, source, hero_id, owner_account_id) VALUES ('关羽', 'wild', $1, $2)`, [h1, la]);
        await lc.query(`INSERT INTO famous_heroes (name, source, hero_id, owner_account_id) VALUES ('关羽', 'wild', $1, $2)`, [h2, lb]);
        const rows = await lc.query(`SELECT count(*)::int AS n FROM famous_heroes WHERE name = '关羽'`);
        assert.equal((rows.rows[0] as { n: number }).n, 2, '放宽后同名多行可用（存量名将行不受影响）');
        // 同账号同名仍由主键拒绝
        const dupCode = await lc
          .query(`INSERT INTO famous_heroes (name, source, hero_id, owner_account_id) VALUES ('关羽', 'wild', $1, $2)`, [h1, la])
          .then(
            () => null,
            (err: { code?: string }) => err.code ?? 'error',
          );
        assert.equal(dupCode, '23505', '同一账号同名被唯一约束拒绝（23505 = unique_violation）');
        await lc.query('COMMIT');
      } catch (err) {
        await lc.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        lc.release();
      }
    } finally {
      await legacyPool.end();
      await legacy.drop();
    }
  });
});
