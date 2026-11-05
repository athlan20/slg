// 名将被俘与赎回（AISLG-228，v93）：概率按注入随机数判定、只有带忠诚度的名将、每账号 7 天最多 1 名（并发串行）、
// 同一武将并发只会被俘一次、被俘后城守撤掉、攻方败时随队名将被俘且返程不再携带、NPC 路径（settleMarchHero）不判定；
// 赎回：只有主人、金币不足拒绝、主人扣全额、胜方收 50%、忠诚度 −20 最低 1、与囚禁到期互斥；超时下野并给胜方结交资格（幂等）；
// 囚禁中的入口校验 HERO_CAPTURED，囚禁中不扣俸禄、忠诚度不衰减。需要 TEST_DATABASE_URL（一次性临时库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { FAMOUS_CITY_HEROES, rollFamousAttrs } from '../common/src/hero';
import { WILD_FAMOUS_HEROES } from '../common/src/hero-wild';
import { grantFamousHero, insertHero, loadHero, type AccountHeroRow } from '../common/src/hero-db';
import { loadWildHeroAttrs } from '../common/src/wild-famous-db';
import { tryCaptureHero, payRansom } from '../common/src/hero-capture-db';
import { checkHeroMarchable } from '../api/src/handlers-hero';
import { processHeroSalaries } from '../worker/src/hero-salary-tick';
import { settleMarchHero, type MarchRow, type TileNotify } from '../worker/src/tick-shared';
import { captureAfterPvpBattle } from '../worker/src/pvp-capture';
import { Op } from '../common/src/protocol';
import { createTempDatabase, type TempDatabase } from './season-test-db';
import { callAs, capitalIdOf, makeLoyaltyTick, newAccount } from './hero-loyalty-util';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('名将被俘与赎回（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  let nextTick: () => Promise<number>;
  const tag = `cap-${Date.now()}`;
  let wildIndex = 0;
  const never = () => {
    throw new Error('rng 不应被调用');
  };

  async function recruitWild(accountId: string): Promise<AccountHeroRow> {
    const name = WILD_FAMOUS_HEROES[wildIndex].name;
    wildIndex += 1;
    const attrs = (await loadWildHeroAttrs(pool, name)) ?? rollFamousAttrs(Math.random);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hero = await grantFamousHero(client, accountId, { name, source: { kind: 'wild' } }, attrs);
      await client.query('COMMIT');
      assert.ok(hero);
      return hero;
    } finally {
      client.release();
    }
  }

  async function setLoyalty(id: string, value: number): Promise<void> {
    await pool.query(`UPDATE account_heroes SET loyalty = $2 WHERE id = $1`, [id, value]);
  }

  /** 在独立事务里尝试俘虏（测试用，返回结果） */
  async function capture(heroId: string, captorAccountId: string, rng?: () => number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await tryCaptureHero(client, { heroId, captorAccountId, rng });
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** 在独立事务里赎回（先锁主人主城，与 API 同序） */
  async function ransom(ownerAccountId: string, heroId: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const capitalId = await capitalIdOf(pool, ownerAccountId);
      await client.query(`SELECT id FROM cities WHERE id = $1 FOR UPDATE`, [capitalId]);
      const out = await payRansom(client, { ownerAccountId, heroId, capitalId });
      if ('error' in out) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }
      return out;
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

  async function countEvents(accountId: string, type: string): Promise<number> {
    const res = await pool.query(`SELECT count(*)::int AS n FROM events WHERE account_id = $1 AND type = $2`, [accountId, type]);
    return (res.rows[0] as { n: number }).n;
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'capture');
    pool = new pg.Pool({ connectionString: db.url, max: 12 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    nextTick = makeLoyaltyTick(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('概率按注入随机数：忠诚度 100 时 rng < 5% 被俘；忠诚度 10 时 rng < 27.5% 被俘', async () => {
    const owner1 = await newAccount(pool, `${tag}-p100`);
    const h1 = await recruitWild(owner1);
    const captorA = await newAccount(pool, `${tag}-p100-captor`);
    assert.equal(await capture(h1.id, captorA, () => 0.06), null, 'rng 0.06 ≥ 5%：不被俘');
    assert.equal((await loadHero(pool, h1.id))?.captured_by, null);
    const hit = await capture(h1.id, captorA, () => 0.04);
    assert.ok(hit, 'rng 0.04 < 5%：被俘');
    assert.equal(hit.captorAccountId, captorA);

    const owner2 = await newAccount(pool, `${tag}-p10`);
    const h2 = await recruitWild(owner2);
    await setLoyalty(h2.id, 10);
    const captorB = await newAccount(pool, `${tag}-p10-captor`);
    assert.equal(await capture(h2.id, captorB, () => 0.3), null, 'rng 0.3 ≥ 27.5%：不被俘');
    assert.ok(await capture(h2.id, captorB, () => 0.2), 'rng 0.2 < 27.5%：被俘');
  });

  test('只有带忠诚度的名将会被俘；普通将与名城名将不被俘；不能俘自己', async () => {
    const owner = await newAccount(pool, `${tag}-novalue`);
    const captor = await newAccount(pool, `${tag}-novalue-captor`);
    const client = await pool.connect();
    let ordinaryId = '';
    let cityHeroId = '';
    try {
      await client.query('BEGIN');
      ordinaryId = (await insertHero(client, owner, { name: '甲', famous: false, lead: 20, force: 20, wit: 20 })).id;
      cityHeroId = (await grantFamousHero(client, owner, FAMOUS_CITY_HEROES[0], rollFamousAttrs(Math.random)))!.id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    assert.equal(await capture(ordinaryId, captor, () => 0), null);
    assert.equal(await capture(cityHeroId, captor, () => 0), null);
    const mine = await recruitWild(owner);
    assert.equal(await capture(mine.id, owner, () => 0), null, '不能俘自己的名将');
  });

  test('每个账号 7 天内最多被俘 1 名：第二次不判定（不消耗随机数）', async () => {
    const owner = await newAccount(pool, `${tag}-limit`);
    const captor = await newAccount(pool, `${tag}-limit-captor`);
    const h1 = await recruitWild(owner);
    const h2 = await recruitWild(owner);
    assert.ok(await capture(h1.id, captor, () => 0));
    assert.equal(await capture(h2.id, captor, never), null, '7 天内第二次不判定');
    assert.equal((await loadHero(pool, h2.id))?.captured_by, null);
  });

  test('并发：同一账号两名将同时被俘，只有一名成功', async () => {
    const owner = await newAccount(pool, `${tag}-conc-owner`);
    const captorX = await newAccount(pool, `${tag}-conc-x`);
    const captorY = await newAccount(pool, `${tag}-conc-y`);
    const h1 = await recruitWild(owner);
    const h2 = await recruitWild(owner);
    const results = await Promise.all([capture(h1.id, captorX, () => 0), capture(h2.id, captorY, () => 0)]);
    assert.equal(results.filter((r) => r !== null).length, 1);
  });

  test('并发：同一名将同时被两方俘虏，只会俘虏一次', async () => {
    const owner = await newAccount(pool, `${tag}-same-owner`);
    const captorX = await newAccount(pool, `${tag}-same-x`);
    const captorY = await newAccount(pool, `${tag}-same-y`);
    const h = await recruitWild(owner);
    const results = await Promise.all([capture(h.id, captorX, () => 0), capture(h.id, captorY, () => 0)]);
    assert.equal(results.filter((r) => r !== null).length, 1);
    const events = await pool.query(`SELECT count(*)::int AS n FROM events WHERE type = 'hero_captured' AND build_id = $1 AND account_id = $2`, [h.id, owner]);
    assert.equal(events.rows[0].n, 1);
  });

  test('被俘效果：囚禁 24 小时、城守撤掉、主人与胜方各一条事件、全服播报', async () => {
    const owner = await newAccount(pool, `${tag}-effects`);
    const captor = await newAccount(pool, `${tag}-effects-captor`);
    const h = await recruitWild(owner);
    await pool.query(`UPDATE cities SET guard_hero_id = $2 WHERE id = $1`, [await capitalIdOf(pool, owner), h.id]);
    const out = await capture(h.id, captor, () => 0);
    assert.ok(out);
    const row = await loadHero(pool, h.id);
    assert.equal(row?.captured_by, captor);
    const hours = ((row?.captured_until?.getTime() ?? 0) - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours < 24.1, `囚禁约 24 小时，实际 ${hours}`);
    const guard = await pool.query(`SELECT guard_hero_id FROM cities WHERE account_id = $1`, [owner]);
    assert.equal(guard.rows[0].guard_hero_id, null);
    assert.equal(await countEvents(owner, 'hero_captured'), 1);
    assert.equal(await countEvents(captor, 'hero_captured'), 1);
    const bc = await pool.query(`SELECT count(*)::int AS n FROM server_broadcasts WHERE type = 'hero_captured'`);
    assert.ok(bc.rows[0].n >= 1);
  });

  test('攻方战败：随队名将被俘，march.hero_id 清空（返程不带）；攻方胜：随队名将不被俘', async () => {
    const owner = await newAccount(pool, `${tag}-raid-owner`);
    const attacker = await newAccount(pool, `${tag}-raid-attacker`);
    const hero = await recruitWild(owner);
    const attackerHero = await recruitWild(attacker);
    const march = { account_id: attacker, hero_id: attackerHero.id } as unknown as MarchRow;
    const notices: TileNotify[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await captureAfterPvpBattle(client, { march, attackerWon: false, defenderAccountId: owner, cityId: null, guardHeroId: null, notifies: notices, rng: () => 0 });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    assert.equal(march.hero_id, null, '被俘后返程不再携带');
    assert.equal((await loadHero(pool, attackerHero.id))?.captured_by, owner);
    assert.equal(notices.filter((n) => n.reason === 'hero_state').length, 2);

    // 攻方胜：守城城守被俘（胜方为攻方账号），攻方随队名将不因此被俘
    const march2 = { account_id: attacker, hero_id: hero.id } as unknown as MarchRow;
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      await captureAfterPvpBattle(c2, { march: march2, attackerWon: true, defenderAccountId: owner, cityId: null, guardHeroId: hero.id, notifies: [], rng: () => 0 });
      await c2.query('COMMIT');
    } finally {
      c2.release();
    }
    assert.equal(march2.hero_id, hero.id);
    assert.equal((await loadHero(pool, hero.id))?.captured_by, attacker, '守城城守被俘，胜方为攻方');
  });

  test('NPC / 黄巾等路径（settleMarchHero）不判定被俘：即使攻方败，随队的有忠诚度名将也不被俘', async () => {
    const owner = await newAccount(pool, `${tag}-npc`);
    const h = await recruitWild(owner);
    const city = await capitalIdOf(pool, owner);
    const march = { id: 'x', account_id: owner, from_city_id: city, x: 1, y: 1, purpose: 'plunder', initiator: 'player', hero_id: h.id } as unknown as MarchRow;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 攻方败的最小战斗结果（只取 settleMarchHero 用到的字段）
      const result = { attackerWon: false, defender: { losses: {} }, attacker: { losses: {} } };
      await settleMarchHero(client, march, result as never, []);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    assert.equal((await loadHero(pool, h.id))?.captured_by, null);
  });

  test('赎回：金币不足被拒绝且数据不变；足额后主人扣全额、胜方收 50%、名将回归、忠诚度 −20 且最低 1', async () => {
    const owner = await newAccount(pool, `${tag}-ransom-owner`);
    const captor = await newAccount(pool, `${tag}-ransom-captor`);
    const h = await recruitWild(owner);
    await pool.query(`UPDATE account_heroes SET level = 5 WHERE id = $1`, [h.id]);
    assert.ok(await capture(h.id, captor, () => 0));
    await setGold(owner, 9_999);
    const short = await ransom(owner, h.id);
    assert.deepEqual(short, { error: 'INSUFFICIENT_RESOURCES' });
    assert.equal((await loadHero(pool, h.id))?.captured_by, captor, '仍在囚禁');
    assert.equal(await goldOf(owner), 9_999, '金币不变');

    await setGold(owner, 50_000);
    await setGold(captor, 0);
    const ok = await ransom(owner, h.id);
    assert.ok(!('error' in ok));
    if ('error' in ok) return;
    assert.equal(ok.cost, 10_000);
    assert.equal(ok.taxShare, 5_000);
    assert.equal(ok.destroyed, 5_000);
    assert.equal(await goldOf(owner), 40_000, '主人扣全额');
    assert.equal(await goldOf(captor), 5_000, '胜方收 50%');
    const row = await loadHero(pool, h.id);
    assert.equal(row?.captured_by, null);
    assert.equal(row?.captured_until, null);
    assert.equal(row?.loyalty, 80, '忠诚度 −20');
    assert.equal(await countEvents(owner, 'hero_ransomed'), 1);
    assert.equal(await countEvents(captor, 'hero_ransomed'), 1);
  });

  test('赎回忠诚度最低保留 1；非主人、未被俘、囚禁已到期 都被拒绝且数据不变', async () => {
    const owner = await newAccount(pool, `${tag}-rules-owner`);
    const captor = await newAccount(pool, `${tag}-rules-captor`);
    const other = await newAccount(pool, `${tag}-rules-other`);
    const h = await recruitWild(owner);
    await setLoyalty(h.id, 10);
    assert.ok(await capture(h.id, captor, () => 0));
    await setGold(owner, 100_000);
    assert.deepEqual(await ransom(other, h.id), { error: 'HERO_NOT_FOUND' });
    assert.equal((await loadHero(pool, h.id))?.captured_by, captor);
    assert.equal(await goldOf(owner), 100_000);
    const done = await ransom(owner, h.id);
    assert.ok(!('error' in done));
    assert.equal((await loadHero(pool, h.id))?.loyalty, 1, '10 − 20 → 最低 1');

    const free = await recruitWild(owner);
    assert.deepEqual(await ransom(owner, free.id), { error: 'HERO_NOT_CAPTURED' }, '未被俘');
    assert.equal(await goldOf(owner), 100_000 - 2_000 * 1, '未被俘的赎回不扣金币（仅上一次赎回扣过）');

    // 另起一个主人：同一主人 7 天内已被俘过一次，不能再被俘
    const owner2 = await newAccount(pool, `${tag}-rules-owner2`);
    const expired = await recruitWild(owner2);
    assert.ok(await capture(expired.id, captor, () => 0));
    await pool.query(`UPDATE account_heroes SET captured_until = now() - interval '1 second' WHERE id = $1`, [expired.id]);
    assert.deepEqual(await ransom(owner2, expired.id), { error: 'HERO_NOT_CAPTURED' }, '囚禁已到期');
  });

  test('赎回与囚禁到期并发：赎回先生效则到期的下野不再发生', async () => {
    const owner = await newAccount(pool, `${tag}-race-owner`);
    const captor = await newAccount(pool, `${tag}-race-captor`);
    const h = await recruitWild(owner);
    assert.ok(await capture(h.id, captor, () => 0));
    await pool.query(`UPDATE account_heroes SET captured_until = now() + interval '3 seconds' WHERE id = $1`, [h.id]);
    await setGold(owner, 100_000);
    const hold = pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        const capitalId = await capitalIdOf(pool, owner);
        await client.query(`SELECT id FROM cities WHERE id = $1 FOR UPDATE`, [capitalId]);
        const out = await payRansom(client, { ownerAccountId: owner, heroId: h.id, capitalId });
        assert.ok(!('error' in out), '赎回在到期前校验通过');
        await new Promise((resolve) => setTimeout(resolve, 4000));
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 3300));
    await nextTick();
    await hold;
    const row = await loadHero(pool, h.id);
    assert.ok(row, '名将仍在（未下野）');
    assert.equal(row?.captured_by, null);
    assert.equal(await countEvents(owner, 'hero_left'), 0);
  });

  test('囚禁到期未赎回：名将下野，胜方获得结交资格；重复结算不重复发资格或事件', async () => {
    const owner = await newAccount(pool, `${tag}-expire-owner`);
    const captor = await newAccount(pool, `${tag}-expire-captor`);
    const h = await recruitWild(owner);
    const name = h.name;
    assert.ok(await capture(h.id, captor, () => 0));
    await pool.query(`UPDATE account_heroes SET captured_until = now() - interval '1 second' WHERE id = $1`, [h.id]);
    await nextTick();
    assert.equal(await loadHero(pool, h.id), null, '下野');
    const unlock = await pool.query(`SELECT count(*)::int AS n FROM hero_unlocks WHERE account_id = $1 AND hero_name = $2`, [captor, name]);
    assert.equal(unlock.rows[0].n, 1, '胜方获得结交资格');
    assert.equal(await countEvents(owner, 'hero_left'), 1);
    assert.equal(await countEvents(captor, 'hero_left'), 1);
    await nextTick();
    assert.equal(await countEvents(owner, 'hero_left'), 1, '重复结算不重复发事件');
    const unlock2 = await pool.query(`SELECT count(*)::int AS n FROM hero_unlocks WHERE account_id = $1 AND hero_name = $2`, [captor, name]);
    assert.equal(unlock2.rows[0].n, 1);
  });

  test('囚禁中的入口统一返回 HERO_CAPTURED：出征 / 侦察校验、任城守、赏赐、解雇、加点、历练、取消历练', async () => {
    const owner = await newAccount(pool, `${tag}-blocks`);
    const captor = await newAccount(pool, `${tag}-blocks-captor`);
    await setGold(owner, 100_000);
    const h = await recruitWild(owner);
    await pool.query(`UPDATE account_heroes SET free_points = 5 WHERE id = $1`, [h.id]);
    assert.ok(await capture(h.id, captor, () => 0));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const verdict = await checkHeroMarchable(client, owner, h.id);
      assert.deepEqual(verdict, { ok: false, code: 'HERO_CAPTURED' }, '出征 / 侦察（同一校验）');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const cases: Array<[number, Record<string, unknown>]> = [
      [Op.ASSIGN_HERO, { heroId: h.id }],
      [Op.GIFT_HERO, { heroId: h.id }],
      [Op.DISMISS_HERO, { heroId: h.id }],
      [Op.ALLOCATE_HERO_POINTS, { heroId: h.id, lead: 1 }],
      [Op.RESET_HERO_POINTS, { heroId: h.id }],
      [Op.TRAIN_HERO, { heroId: h.id, tier: 1 }],
      [Op.CANCEL_TRAINING, { heroId: h.id }],
    ];
    for (const [op, data] of cases) {
      const res = await callAs(pool, owner, op, data);
      assert.equal(res.ok, false, `op ${op} 应被拒绝`);
      assert.equal(res.error?.code, 'HERO_CAPTURED', `op ${op}`);
    }
    const stillCaptive = await loadHero(pool, h.id);
    assert.ok(stillCaptive?.captured_by, '所有入口都不改变囚禁状态');
  });

  test('囚禁中不扣俸禄、忠诚度不衰减；赎回后俸禄从赎回时刻起算（不补扣囚禁期间）', async () => {
    const owner = await newAccount(pool, `${tag}-captive-salary`);
    const captor = await newAccount(pool, `${tag}-captive-salary-captor`);
    const h = await recruitWild(owner);
    await setGold(owner, 1_000_000);
    assert.ok(await capture(h.id, captor, () => 0));
    await pool.query(`UPDATE account_heroes SET salary_at = now() - interval '5 hours', loyalty_at = now() - interval '30 hours' WHERE id = $1`, [h.id]);
    const goldBefore = await goldOf(owner);
    await processHeroSalaries(pool, Date.now() + 1_000_000_000);
    await nextTick();
    assert.equal(await goldOf(owner), goldBefore, '囚禁中不扣俸禄');
    const row = await loadHero(pool, h.id);
    assert.equal(row?.loyalty, 100, '囚禁中忠诚度不变');
    assert.equal(row?.arrears, false);
  });

  test('赎回后分成写给胜方主城；胜方没有城时分成销毁', async () => {
    const owner = await newAccount(pool, `${tag}-nocity-owner`);
    const captor = await newAccount(pool, `${tag}-nocity-captor`);
    const h = await recruitWild(owner);
    assert.ok(await capture(h.id, captor, () => 0));
    await pool.query(`DELETE FROM cities WHERE account_id = $1`, [captor]);
    await setGold(owner, 100_000);
    const out = await ransom(owner, h.id);
    assert.ok(!('error' in out));
    if ('error' in out) return;
    assert.equal(out.taxShare, 0);
    assert.equal(out.destroyed, 2_000);
  });
  test('协议：GET_HEROES 带出忠诚度与囚禁（截止时刻、赎金）；RANSOM_HERO 金币不足拒绝、足额赎回返回视图与分成', async () => {
    const owner = await newAccount(pool, `${tag}-proto`);
    const captor = await newAccount(pool, `${tag}-proto-captor`);
    const h = await recruitWild(owner);
    await pool.query(`UPDATE account_heroes SET level = 3 WHERE id = $1`, [h.id]);
    assert.ok(await capture(h.id, captor, () => 0));
    const state = await callAs(pool, owner, Op.GET_HEROES, {});
    assert.equal(state.ok, true);
    const hero = (state.data as { heroes: Array<{ id: string; loyalty: number | null; captive: { capturedUntil: string; ransomGold: number } | null }> }).heroes.find((x) => x.id === h.id);
    assert.ok(hero);
    assert.equal(hero.loyalty, 100);
    assert.ok(hero.captive && hero.captive.ransomGold === 6_000 && Date.parse(hero.captive.capturedUntil) > Date.now());

    await setGold(owner, 5_999);
    const short = await callAs(pool, owner, Op.RANSOM_HERO, { heroId: h.id });
    assert.equal(short.ok, false);
    assert.equal(short.error?.code, 'INSUFFICIENT_RESOURCES');
    assert.equal(await goldOf(owner), 5_999);
    assert.ok((await loadHero(pool, h.id))?.captured_by, '未赎回，仍在囚禁');

    await setGold(owner, 6_000);
    const ok = await callAs(pool, owner, Op.RANSOM_HERO, { heroId: h.id });
    assert.equal(ok.ok, true);
    const data = ok.data as { hero: { captive: unknown; loyalty: number }; ransom: { cost: number; taxShare: number; destroyed: number } };
    assert.equal(data.hero.captive, null);
    assert.equal(data.hero.loyalty, 80);
    assert.deepEqual(data.ransom, { cost: 6_000, taxShare: 3_000, destroyed: 3_000 });

    const again = await callAs(pool, owner, Op.RANSOM_HERO, { heroId: h.id });
    assert.equal(again.error?.code, 'HERO_NOT_CAPTURED', '重复赎回被拒绝');
    const bad = await callAs(pool, owner, Op.RANSOM_HERO, { heroId: 'not-a-uuid' });
    assert.equal(bad.error?.code, 'INVALID_PARAMS');
  });
});
