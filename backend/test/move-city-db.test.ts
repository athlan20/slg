// 城池迁移（AISLG-220，v91）的事务规则（需真实 PostgreSQL：设置 TEST_DATABASE_URL，用一次性临时库，别指向开发库）：
// 预览 / 随机迁 / 指定坐标迁、旧格去向（主城变空野地，分城回归 NPC 城并写冷却）、每条拦截错误码、
// 令不足不改数据、并发抢同一格、迁后出征限制（MARCH / SCOUT 拦截，运输 / 增援放行）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { Op, type InitiatorRole } from '../common/src/protocol';
import { npcSnapshot } from '../common/src/world';
import { setTimeScaleCache } from '../common/src/time-scale';
import { grantItem } from '../common/src/items-db';
import { loadMoveCityView } from '../common/src/move-city-db';
import { emptyItems } from '../common/src/items';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { runWithCity } from '../api/src/city-scope';
import { handleMoveCity } from '../api/src/handlers-move-city';
import { handleMarch } from '../api/src/handlers-world';
import { handleScout } from '../api/src/handlers-battle';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

interface Frame {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}

describe('城池迁移（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;

  /** 每次调用各用一个收集器（并发调用互不串帧） */
  function makeCtx(out: Frame[]): HandlerContext {
    const registry = {
      send: (_conn: ConnInfo, frame: Frame) => {
        out.push(frame);
      },
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    return { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  }
  const connOf = (accountId: string) => ({ accountId, role: 'player' as InitiatorRole }) as unknown as ConnInfo;

  async function move(who: { accountId: string; cityId: string }, data: Record<string, unknown>): Promise<Frame> {
    const out: Frame[] = [];
    await runWithCity(who.cityId, () => handleMoveCity(makeCtx(out), connOf(who.accountId), Op.MOVE_CITY, 1, data));
    return out[out.length - 1];
  }

  async function march(who: { accountId: string; cityId: string }, x: number, y: number): Promise<Frame> {
    const out: Frame[] = [];
    await runWithCity(who.cityId, () => handleMarch(makeCtx(out), connOf(who.accountId), Op.MARCH, 1, x, y, { militia: 5 }, 'plunder'));
    return out[out.length - 1];
  }

  async function scout(who: { accountId: string; cityId: string }, x: number, y: number): Promise<Frame> {
    const out: Frame[] = [];
    await runWithCity(who.cityId, () => handleScout(makeCtx(out), connOf(who.accountId), Op.SCOUT, 1, x, y, 1, null));
    return out[out.length - 1];
  }

  let seq = 0;
  /** 新建账号与主城（政府等级 gov）；主城格为 kind=city */
  async function account(x: number, y: number, gov = 5): Promise<{ accountId: string; cityId: string }> {
    seq += 1;
    const accountId = (
      await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`move-${seq}-${Date.now()}`])
    ).rows[0].id as string;
    const cityId = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城', 0, 0, 0, $2, $3) RETURNING id`,
        [accountId, x, y],
      )
    ).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', $2)`, [cityId, gov]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL) ON CONFLICT (x, y) DO UPDATE SET kind = EXCLUDED.kind, level = EXCLUDED.level, owner_city_id = EXCLUDED.owner_city_id, npc = EXCLUDED.npc`,
      [x, y, cityId],
    );
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 50)`, [cityId]);
    return { accountId, cityId };
  }

  async function wild(x: number, y: number, level = 3, owner: string | null = null): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', $3, $4, NULL) ON CONFLICT (x, y) DO UPDATE SET kind = EXCLUDED.kind, level = EXCLUDED.level, owner_city_id = EXCLUDED.owner_city_id, npc = EXCLUDED.npc`,
      [x, y, level, owner],
    );
  }

  async function tileOf(x: number, y: number) {
    return (await pool.query(`SELECT kind, level, owner_city_id, npc FROM world_tiles WHERE x = $1 AND y = $2`, [x, y])).rows[0] as
      | { kind: string; level: number; owner_city_id: string | null; npc: unknown }
      | undefined;
  }

  async function cityXY(cityId: string): Promise<{ x: number; y: number }> {
    return (await pool.query(`SELECT x, y FROM cities WHERE id = $1`, [cityId])).rows[0] as { x: number; y: number };
  }

  async function itemCount(accountId: string, itemId: string): Promise<number> {
    const res = await pool.query(`SELECT count FROM user_items WHERE account_id = $1 AND item_id = $2`, [accountId, itemId]);
    return res.rowCount ? Number(res.rows[0].count) : 0;
  }

  async function grant(accountId: string, itemId: 'city_order' | 'city_order_adv', n: number): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await grantItem(client, accountId, itemId, n, 'test');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  async function eventCount(accountId: string, type: string): Promise<number> {
    const res = await pool.query(`SELECT count(*)::int AS n FROM events WHERE account_id = $1 AND type = $2`, [accountId, type]);
    return Number(res.rows[0].n);
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'move-city');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    // 随机选址在整张 1000×1000 上采样：测试库先铺满空野地，否则采样常常落空（真实世界同样满铺）
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       SELECT gx, gy, 'plain', 'wilderness', 1, NULL, NULL FROM generate_series(0, 999) gx, generate_series(0, 999) gy`,
    );
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('预览不改数据；指定坐标迁：新格为城、主城旧格变空野地、扣高级令、写事件、迁后 12 小时出限', async () => {
    const A = await account(100, 100);
    await wild(300, 300, 3);
    await grant(A.accountId, 'city_order_adv', 1);

    const preview = await move(A, { mode: 'pointing', x: 300, y: 300, preview: true });
    assert.equal(preview.ok, true);
    assert.equal(preview.data?.preview, true);
    assert.equal(preview.data?.count, 1);
    assert.equal(preview.data?.distance, 200);
    assert.equal(preview.data?.oldTile, 'wilderness');
    assert.equal(preview.data?.attackLockSeconds, 43200);
    assert.deepEqual(await cityXY(A.cityId), { x: 100, y: 100 }, '预览不改坐标');
    assert.equal(await itemCount(A.accountId, 'city_order_adv'), 1, '预览不扣令');

    const res = await move(A, { mode: 'pointing', x: 300, y: 300, confirm: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.data?.left, 0);
    assert.equal(res.data?.itemId, 'city_order_adv');
    assert.equal(res.data?.oldTile, 'wilderness');
    assert.ok(typeof res.data?.moveLockUntil === 'string', '指定坐标迁给出出限截止时刻');

    assert.deepEqual(await cityXY(A.cityId), { x: 300, y: 300 });
    assert.deepEqual(await tileOf(300, 300).then((t) => [t?.kind, t?.owner_city_id]), ['city', A.cityId]);
    const old = await tileOf(100, 100);
    assert.equal(old?.kind, 'wilderness');
    assert.equal(old?.owner_city_id, null);
    assert.equal(old?.npc, null);
    assert.ok(old && old.level >= 1 && old.level <= 10, '旧主城格重抽野地等级');
    assert.equal(await itemCount(A.accountId, 'city_order_adv'), 0);
    assert.equal(await eventCount(A.accountId, 'city_moved'), 1);
    assert.equal(await eventCount(A.accountId, 'item_used'), 1);
    const lock = (await pool.query(`SELECT move_lock_until > now() AS active FROM cities WHERE id = $1`, [A.cityId])).rows[0];
    assert.equal(lock.active, true);
    assert.equal(await pool.query(`SELECT 1 FROM city_discards WHERE x = 100 AND y = 100`).then((r) => r.rowCount), 0, '主城不写冷却');
  });

  test('随机迁：扣迁城令、选址落在空野地、无出限、旧格为空野地', async () => {
    const R = await account(600, 60);
    await wild(700, 40, 2);
    await grant(R.accountId, 'city_order', 2);
    const res = await move(R, { mode: 'random', confirm: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.data?.moveLockUntil, null);
    assert.equal(res.data?.itemId, 'city_order');
    assert.equal(res.data?.left, 1);
    const to = res.data?.to as { x: number; y: number };
    const t = await tileOf(to.x, to.y);
    assert.equal(t?.kind, 'city');
    assert.equal(t?.owner_city_id, R.cityId);
    assert.deepEqual(await cityXY(R.cityId), to);
    assert.equal((await tileOf(600, 60))?.kind, 'wilderness');
    assert.equal(await itemCount(R.accountId, 'city_order'), 1);
  });

  test('分城迁走：回归 NPC 城（等级 = origin_level），写占回冷却（官府等级天）', async () => {
    const B = await account(800, 800, 5);
    const branch = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, x, y, origin_level) VALUES ($1, '分城', 0, 0, 0, 500, 500, 2) RETURNING id`,
        [B.accountId],
      )
    ).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 2)`, [branch]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (500, 500, 'plain', 'city', 0, $1, NULL) ON CONFLICT (x, y) DO UPDATE SET kind = EXCLUDED.kind, level = EXCLUDED.level, owner_city_id = EXCLUDED.owner_city_id, npc = EXCLUDED.npc`,
      [branch],
    );
    await wild(501, 500, 2);
    await grant(B.accountId, 'city_order', 1);
    const before = Date.now();
    const res = await move({ accountId: B.accountId, cityId: branch }, { mode: 'random', confirm: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.data?.oldTile, 'npc_city');
    const old = await tileOf(500, 500);
    assert.equal(old?.kind, 'npc_city');
    assert.equal(old?.level, 2);
    assert.equal(old?.owner_city_id, null);
    assert.ok(old?.npc, 'NPC 快照写回');
    assert.equal((old?.npc as { level: number }).level, 2);
    const cd = (await pool.query(`SELECT account_id, until FROM city_discards WHERE x = 500 AND y = 500`)).rows[0] as {
      account_id: string;
      until: Date;
    };
    assert.equal(cd.account_id, B.accountId);
    // 冷却按放弃时的官府等级计：分城官府 2 级 = 2 天（主城 5 级不参与）
    const days = (cd.until.getTime() - before) / (24 * 60 * 60 * 1000);
    assert.ok(days > 1.9 && days < 2.1, `冷却约 分城官府 2 级 = 2 天，实际 ${days.toFixed(2)} 天`);
    assert.equal(await itemCount(B.accountId, 'city_order'), 0);
  });

  test('拦截：名城 / 军队在外 / 盟友驻军 / 战乱，逐条返回错误码，且不扣令、不改任何数据', async () => {
    const C = await account(150, 150);
    await wild(400, 150, 3);
    await grant(C.accountId, 'city_order_adv', 5);
    const target = { mode: 'pointing', x: 400, y: 150, confirm: true };

    // 名城
    await pool.query(`UPDATE cities SET famous_name = '官渡' WHERE id = $1`, [C.cityId]);
    assert.equal((await move(C, target)).error?.code, 'MOVE_CITY_FAMOUS');
    await pool.query(`UPDATE cities SET famous_name = NULL WHERE id = $1`, [C.cityId]);

    // 军队在外（本城发出的行军）
    const outside = (
      await pool.query(
        `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
         VALUES ($1, $2, 900, 900, '{"militia": 5}', 'plunder', 'marching', 'player', now() + interval '1 hour') RETURNING id`,
        [C.accountId, C.cityId],
      )
    ).rows[0].id as string;
    const armyFrame = await move(C, target);
    assert.equal(armyFrame.error?.code, 'MOVE_CITY_ARMY_OUTSIDE');
    assert.equal(armyFrame.data?.count, 1);
    await pool.query(`DELETE FROM marches WHERE id = $1`, [outside]);

    // 盟友协防本城
    const D = await account(300, 500);
    await pool.query(
      `INSERT INTO city_assist (city_id, account_id, from_city_id, troops, initiator) VALUES ($1, $2, $3, '{"militia": 5}', 'player')`,
      [C.cityId, D.accountId, D.cityId],
    );
    const allyFrame = await move(C, target);
    assert.equal(allyFrame.error?.code, 'MOVE_CITY_HAS_ALLY_FORCE');
    assert.equal(allyFrame.data?.count, 1);
    await pool.query(`DELETE FROM city_assist WHERE city_id = $1`, [C.cityId]);

    // 战乱：别人的行军指向本城格
    const E = await account(700, 700);
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, 150, 150, '{"militia": 5}', 'plunder', 'marching', 'player', now() + interval '1 hour')`,
      [E.accountId, E.cityId],
    );
    assert.equal((await move(C, target)).error?.code, 'MOVE_CITY_IN_BATTLE');
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [E.accountId]);

    // 拦截期间没有任何改动
    assert.deepEqual(await cityXY(C.cityId), { x: 150, y: 150 });
    assert.equal(await itemCount(C.accountId, 'city_order_adv'), 5);
    assert.equal((await tileOf(400, 150))?.kind, 'wilderness');
  });

  test('拦截：目标不是空野地 / 离他人城太近 / 令不足 / 参数错误', async () => {
    const F = await account(160, 800);
    await grant(F.accountId, 'city_order_adv', 1);
    // NPC 城格
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (420, 800, 'plain', 'npc_city', 1, NULL, $1::jsonb) ON CONFLICT (x, y) DO UPDATE SET kind = EXCLUDED.kind, level = EXCLUDED.level, owner_city_id = EXCLUDED.owner_city_id, npc = EXCLUDED.npc`,
      [JSON.stringify(npcSnapshot(1))],
    );
    assert.equal((await move(F, { mode: 'pointing', x: 420, y: 800, confirm: true })).error?.code, 'MOVE_CITY_TILE_INVALID');
    // 他人占领的野地
    const G = await account(900, 300);
    await wild(430, 800, 3, G.cityId);
    // 注意：owner_city_id 指向 G 主城，G 主城格离 430,800 很远，不影响此处判定
    assert.equal((await move(F, { mode: 'pointing', x: 430, y: 800, confirm: true })).error?.code, 'MOVE_CITY_TILE_INVALID');
    // 离他人城池格 2 格：他人主城在 (502, 802)，目标 (500, 800)（Chebyshev = 2）
    await account(502, 802);
    await wild(500, 800, 3);
    assert.equal((await move(F, { mode: 'pointing', x: 500, y: 800, confirm: true })).error?.code, 'MOVE_CITY_TOO_CLOSE');
    // 令不足：K 没有任何令
    const K = await account(160, 600);
    await wild(600, 800, 3);
    const noItem = await move(K, { mode: 'pointing', x: 600, y: 800, confirm: true });
    assert.equal(noItem.error?.code, 'INSUFFICIENT_ITEM');
    assert.equal(noItem.data?.itemId, 'city_order_adv');
    assert.equal(noItem.data?.count, 0);
    assert.deepEqual(await cityXY(K.cityId), { x: 160, y: 600 }, '令不足不改坐标');
    assert.equal((await tileOf(600, 800))?.kind, 'wilderness');
    assert.equal(await itemCount(F.accountId, 'city_order_adv'), 1, 'F 的令未被扣');
    // 参数错误：缺 confirm、坐标越界、未知方式
    assert.equal((await move(F, { mode: 'pointing', x: 600, y: 800 })).error?.code, 'INVALID_PARAMS');
    assert.equal((await move(F, { mode: 'pointing', x: 2000, y: 1, confirm: true })).error?.code, 'INVALID_PARAMS');
    assert.equal((await move(F, { mode: 'teleport', confirm: true })).error?.code, 'INVALID_PARAMS');
  });

  test('并发：目标格被别人抢先占走时返回 MOVE_CITY_TILE_TAKEN，令未扣、坐标不变', async () => {
    const W = await account(10, 980);
    const L = await account(40, 980);
    await wild(20, 960, 3);
    await grant(L.accountId, 'city_order_adv', 1);
    // 赢家事务先占住格（未提交），输家的读取看到的仍是空野地，随后在占格 UPDATE 上等待
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query(`UPDATE world_tiles SET kind = 'city', owner_city_id = $1, level = 0 WHERE x = 20 AND y = 960`, [W.cityId]);
    const loser = move(L, { mode: 'pointing', x: 20, y: 960, confirm: true });
    const deadline = Date.now() + 10_000;
    for (;;) {
      const waiting = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`);
      if (Number(waiting.rows[0].n) > 0) {
        break;
      }
      assert.ok(Date.now() < deadline, '输家未进入行锁等待');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await holder.query('COMMIT');
    holder.release();
    const res = await loser;
    assert.equal(res.error?.code, 'MOVE_CITY_TILE_TAKEN');
    assert.equal(await itemCount(L.accountId, 'city_order_adv'), 1, '输家未扣令');
    assert.deepEqual(await cityXY(L.cityId), { x: 40, y: 980 });
  });

  test('并发：两个账号同时迁到同一空野地，只有一个成功，另一个被拒且令未扣', async () => {
    const P = await account(60, 960);
    const Q = await account(70, 940);
    await wild(65, 950, 3);
    await grant(P.accountId, 'city_order_adv', 1);
    await grant(Q.accountId, 'city_order_adv', 1);
    const [a, b] = await Promise.all([
      move(P, { mode: 'pointing', x: 65, y: 950, confirm: true }),
      move(Q, { mode: 'pointing', x: 65, y: 950, confirm: true }),
    ]);
    const oks = [a, b].filter((f) => f.ok === true);
    const fails = [a, b].filter((f) => f.ok !== true);
    assert.equal(oks.length, 1, '只有一个成功');
    assert.equal(fails.length, 1);
    assert.ok(['MOVE_CITY_TILE_TAKEN', 'MOVE_CITY_TILE_INVALID'].includes(fails[0].error?.code ?? ''), fails[0].error?.code);
    const loserAccount = a.ok === true ? Q : P;
    assert.equal(await itemCount(loserAccount.accountId, 'city_order_adv'), 1, '输家未扣令');
  });

  test('随机迁：世界无空野地时返回 MOVE_CITY_NO_SPACE，不扣令、不改任何数据', async () => {
    const S = await account(120, 120);
    await grant(S.accountId, 'city_order', 1);
    // 把所有空野地临时标成「有 NPC」（hasFreeWilderness / claimCityTile 都看不到），用完还原
    await pool.query(`UPDATE world_tiles SET npc = '{}'::jsonb WHERE kind = 'wilderness' AND owner_city_id IS NULL AND npc IS NULL`);
    try {
      const res = await move(S, { mode: 'random', confirm: true });
      assert.equal(res.error?.code, 'MOVE_CITY_NO_SPACE');
      assert.deepEqual(await cityXY(S.cityId), { x: 120, y: 120 });
      assert.equal(await itemCount(S.accountId, 'city_order'), 1);
      assert.equal(await eventCount(S.accountId, 'city_moved'), 0);
    } finally {
      await pool.query(`UPDATE world_tiles SET npc = NULL WHERE npc = '{}'::jsonb`);
    }
  });

  test('迁后出征限制：指定坐标迁后 MARCH 掠夺 / SCOUT 侦察返回 ATTACK_LOCK，增援自己野地放行，随机迁无限制，时限过后恢复', async () => {
    const M = await account(100, 500);
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', 2)`, [M.cityId]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'scout', 5)`, [M.cityId]);
    await wild(300, 500, 3);
    await wild(302, 500, 3);
    await wild(320, 500, 3);
    await grant(M.accountId, 'city_order_adv', 1);
    const res = await move(M, { mode: 'pointing', x: 300, y: 500, confirm: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    // 迁后新坐标 (300,500)，原来的 (302,500) 空地不属于它，先让它成为名下野地
    await pool.query(`UPDATE world_tiles SET owner_city_id = $1 WHERE x = 302 AND y = 500`, [M.cityId]);

    const view = await loadMoveCityView(pool, M.accountId, emptyItems());
    assert.ok(view.cities[0].moveLockUntil, 'GET_STATE 视图给出出限截止时刻');

    const attack = await march(M, 320, 500);
    assert.equal(attack.error?.code, 'MOVE_CITY_ATTACK_LOCK', JSON.stringify(attack));
    assert.ok(Number(attack.data?.retryAfterSeconds) > 40000, '剩余约 12 小时');
    assert.equal((await scout(M, 320, 500)).error?.code, 'MOVE_CITY_ATTACK_LOCK');

    const reinforce = await march(M, 302, 500);
    assert.notEqual(reinforce.error?.code, 'MOVE_CITY_ATTACK_LOCK', '增援自己名下的野地不受限');

    // 时限过后恢复
    await pool.query(`UPDATE cities SET move_lock_until = now() - interval '1 second' WHERE id = $1`, [M.cityId]);
    assert.notEqual((await march(M, 320, 500)).error?.code, 'MOVE_CITY_ATTACK_LOCK');

    // 随机迁不设出限
    const RND = await account(100, 300);
    await wild(900, 300, 3);
    await grant(RND.accountId, 'city_order', 1);
    const rnd = await move(RND, { mode: 'random', confirm: true });
    assert.equal(rnd.ok, true, JSON.stringify(rnd));
    const rndLock = (await pool.query(`SELECT move_lock_until FROM cities WHERE id = $1`, [RND.cityId])).rows[0];
    assert.equal(rndLock.move_lock_until, null, '随机迁不写出限截止时刻');
  });

  test('迁城不改新手保护 / 免战：newbie_until 与 truce_until 原样保留', async () => {
    const N = await account(100, 880);
    await wild(180, 880, 3);
    await grant(N.accountId, 'city_order_adv', 1);
    await pool.query(`UPDATE accounts SET newbie_until = now() + interval '3 days' WHERE id = $1`, [N.accountId]);
    await pool.query(`UPDATE cities SET truce_until = now() + interval '2 hours' WHERE id = $1`, [N.cityId]);
    const before = (await pool.query(`SELECT a.newbie_until, c.truce_until FROM accounts a JOIN cities c ON c.account_id = a.id WHERE a.id = $1`, [N.accountId])).rows[0];
    const res = await move(N, { mode: 'pointing', x: 180, y: 880, confirm: true });
    assert.equal(res.ok, true, JSON.stringify(res));
    const after = (await pool.query(`SELECT a.newbie_until, c.truce_until FROM accounts a JOIN cities c ON c.account_id = a.id WHERE a.id = $1`, [N.accountId])).rows[0];
    assert.equal(new Date(after.newbie_until).getTime(), new Date(before.newbie_until).getTime());
    assert.equal(new Date(after.truce_until).getTime(), new Date(before.truce_until).getTime());
  });
});
