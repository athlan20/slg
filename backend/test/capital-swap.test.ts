// 设为主城（v82，AISLG-205）：纯规则判定（无需数据库）与事务规则（需 TEST_DATABASE_URL，一次性临时库，别指向开发库）。
// 覆盖验收口径 1–8、10：成功对调、名城拒、冷却 24 小时（含 retryAfterSeconds、满 24 小时后可换、时间缩放）、
// 来袭拒、城防不满拒、分城上限拒、confirm / 非本账号 / 当前主城的 INVALID_PARAMS、主城判定随对调变化、并发只成一次。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { capitalCooldownFrom, capitalSwapDenial, CAPITAL_SWAP_COOLDOWN_MS } from '../common/src/capital-swap';
import { loadCapitalSwapView } from '../common/src/capital-swap-db';
import { loadBranchStanding } from '../common/src/branch-city-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { runWithCity } from '../api/src/city-scope';
import { handleSetCapital } from '../api/src/handlers-capital';
import { handleDiscardCity } from '../api/src/handlers-discard';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('设为主城的纯规则（无需数据库）', () => {
  const now = new Date('2026-10-28T08:00:00.000Z');
  const base = { famous: false, cooldownUntil: null, underAttack: false, durability: 100, branchCount: 1, newMainGovernment: 6, now };

  test('通过全部判定时返回 null', () => {
    assert.equal(capitalSwapDenial(base), null);
  });

  test('名城优先于其它判定', () => {
    const denial = capitalSwapDenial({ ...base, famous: true, underAttack: true, durability: 10, branchCount: 9 });
    assert.equal(denial?.code, 'FAMOUS_CITY_NOT_CAPITAL');
  });

  test('冷却未结束返回 CAPITAL_SWAP_COOLDOWN 与向上取整的剩余秒数；截止时刻等于现在即已结束', () => {
    const until = new Date(now.getTime() + 90_500);
    const denial = capitalSwapDenial({ ...base, cooldownUntil: until });
    assert.equal(denial?.code, 'CAPITAL_SWAP_COOLDOWN');
    assert.equal(denial?.data?.retryAfterSeconds, 91);
    assert.equal(capitalSwapDenial({ ...base, cooldownUntil: now }), null);
  });

  test('来袭、城防未满、分城超限依次判定', () => {
    assert.equal(capitalSwapDenial({ ...base, underAttack: true })?.code, 'CAPITAL_SWAP_UNDER_ATTACK');
    assert.equal(capitalSwapDenial({ ...base, durability: 99 })?.code, 'CAPITAL_SWAP_DURABILITY_LOW');
    // 官府 5 级 → 上限 2；3 座分城超限，附新上限与当前分城数
    const over = capitalSwapDenial({ ...base, branchCount: 3, newMainGovernment: 5 });
    assert.deepEqual(over, { code: 'BRANCH_LIMIT_EXCEEDED', data: { limit: 2, branchCount: 3 } });
    // 官府 6 级 → 上限 3：刚好满额可换
    assert.equal(capitalSwapDenial({ ...base, branchCount: 3, newMainGovernment: 6 }), null);
  });

  test('冷却基准为 24 小时，按时间缩放换算，不随官府等级变', () => {
    assert.equal(CAPITAL_SWAP_COOLDOWN_MS, DAY_MS);
    setTimeScaleCache(1);
    assert.equal(capitalCooldownFrom(now).getTime() - now.getTime(), DAY_MS);
    setTimeScaleCache(50);
    try {
      assert.equal(capitalCooldownFrom(now).getTime() - now.getTime(), Math.floor(DAY_MS / 50));
    } finally {
      setTimeScaleCache(1);
    }
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('设为主城的事务规则（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;

  /** 每次调用一个独立的 sink，便于并发用例分别取得各自的响应 */
  function makeSink() {
    const frames: Array<{ ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const pushes: Array<{ op: number; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
        frames.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: (_accountId: string, frame: { op: number; data?: Record<string, unknown> }) => {
        pushes.push({ op: frame.op, data: frame.data });
        return 0;
      },
    } as unknown as ConnectionRegistry;
    const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    return { ctx, frames, pushes };
  }

  /** 以指定城池身份设为主城（data 缺省为确认），返回最后一帧响应 */
  async function setCapital(accountId: string, cityId: string, data?: Record<string, unknown>) {
    const sink = makeSink();
    (sink.ctx as { pool: pg.Pool }).pool = pool;
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await runWithCity(cityId, () => handleSetCapital(sink.ctx, conn, Op.SET_CAPITAL, 1, data ?? { confirm: true }));
    return { res: sink.frames[sink.frames.length - 1], pushes: sink.pushes };
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    return Number((await pool.query(sql, params)).rows[0].n);
  }

  async function mainOf(accountId: string): Promise<string> {
    return (await pool.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [accountId])).rows[0].id as string;
  }

  async function newAccount(label: string): Promise<string> {
    return (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`])).rows[0].id as string;
  }

  /** 建一座城（含官府等级与可选的名城 / 城防）；坐标须唯一 */
  async function city(opts: {
    accountId: string;
    name: string;
    x: number;
    y: number;
    government: number;
    famous?: string;
    durability?: number | null;
    settledHoursAgo?: number;
  }): Promise<string> {
    const id = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y, famous_name, origin_level, durability, durability_settled_at)
       VALUES ($1, $2, 1000, 0, 0, $3, $4, $5, $6, $7, CASE WHEN $8::int IS NULL THEN NULL ELSE now() - make_interval(hours => $8::int) END)
       RETURNING id`,
      [
        opts.accountId, opts.name, opts.x, opts.y, opts.famous ?? null,
        opts.famous ? null : 2,
        opts.durability ?? null,
        opts.settledHoursAgo ?? null,
      ],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', $2), ($1, 'farm', 3)`, [id, opts.government]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 40)`, [id]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [opts.x, opts.y, id],
    );
    return id;
  }

  async function attack(fromCityId: string, toX: number, toY: number, status = 'marching'): Promise<string> {
    const accountId = (await pool.query(`SELECT account_id FROM cities WHERE id = $1`, [fromCityId])).rows[0].account_id as string;
    return (await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, $3, $4, '{"militia": 5}', 'plunder', $5, 'player', now() + interval '1 hour') RETURNING id`,
      [accountId, fromCityId, toX, toY, status],
    )).rows[0].id as string;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'capital');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
  });

  after(async () => {
    setTimeScaleCache(1);
    await pool?.end();
    await tmp?.drop();
  });

  // ---- 账号 A：主城 M（官府 2）、分城 P（官府 6）、Q（官府 4）、名城分城 F、攻击者 ATT 的城 ----
  describe('账号 A 的主线场景（按顺序执行）', () => {
    let A: string;
    let M: string;
    let P: string;
    let Q: string;
    let F: string;
    let ATT: string;

    before(async () => {
      A = await newAccount('capital-a');
      M = await city({ accountId: A, name: '主城', x: 10, y: 10, government: 2 });
      P = await city({ accountId: A, name: '分城P', x: 500, y: 500, government: 6, durability: 100 });
      Q = await city({ accountId: A, name: '分城Q', x: 600, y: 600, government: 4, durability: 100 });
      F = await city({ accountId: A, name: '长安', x: 700, y: 700, government: 1, famous: '长安', durability: 100 });
      // 名下野地：地块 (501, 500) 属于 P
      await pool.query(
        `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (501, 500, 'plain', 'wilderness', 1, $1, NULL)`,
        [P],
      );
      ATT = await city({ accountId: await newAccount('capital-att'), name: '攻击城', x: 900, y: 900, government: 5 });
      // 主城 M 的主人 A 之前没有冷却记录：第一次不受限
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM capital_swaps WHERE account_id = $1`, [A])).rows[0].n, 0);
    });

    test('主城不能换成自己；缺 confirm 或缺 cityId 返回 INVALID_PARAMS；非本账号的城返回 INVALID_PARAMS', async () => {
      assert.equal((await setCapital(A, M)).res.error?.code, 'INVALID_PARAMS', '指向当前主城');
      assert.equal((await setCapital(A, P, { confirm: false })).res.error?.code, 'INVALID_PARAMS', 'confirm 不为 true');
      const noData = makeSink();
      (noData.ctx as { pool: pg.Pool }).pool = pool;
      await runWithCity(P, () => handleSetCapital(noData.ctx, { accountId: A, role: 'player' } as unknown as ConnInfo, Op.SET_CAPITAL, 1, undefined));
      assert.equal(noData.frames[0]?.error?.code, 'INVALID_PARAMS', '无 data 同样拒绝');
      assert.equal((await setCapital(A, ATT)).res.error?.code, 'INVALID_PARAMS', '他人的城');
      assert.equal((await setCapital(A, '00000000-0000-4000-8000-000000000000')).res.error?.code, 'INVALID_PARAMS', '不存在的城');
      assert.equal(await mainOf(A), M, '被拒后主城不变');
    });

    test('名城不能设为主城（FAMOUS_CITY_NOT_CAPITAL）', async () => {
      assert.equal((await setCapital(A, F)).res.error?.code, 'FAMOUS_CITY_NOT_CAPITAL');
    });

    test('有他人玩家的出征奔向本账号的城或野地时拒绝（CAPITAL_SWAP_UNDER_ATTACK），来袭结束后可换', async () => {
      const onCity = await attack(ATT, 10, 10);
      assert.equal((await setCapital(A, P)).res.error?.code, 'CAPITAL_SWAP_UNDER_ATTACK', '奔向主城（城池目标）');
      const view = await loadCapitalSwapView(pool, A);
      assert.equal(view.underAttack, true, 'GET_STATE 视图同步标记来袭');
      await pool.query(`UPDATE marches SET status = 'completed' WHERE id = $1`, [onCity]);

      const onWild = await attack(ATT, 501, 500);
      assert.equal((await setCapital(A, Q)).res.error?.code, 'CAPITAL_SWAP_UNDER_ATTACK', '奔向名下野地');
      await pool.query(`UPDATE marches SET status = 'completed' WHERE id = $1`, [onWild]);
      assert.equal((await loadCapitalSwapView(pool, A)).underAttack, false, '来袭结束后视图清除');
    });

    test('目标城城防未满 100 时拒绝；按惰性结算已回满的放行（城防判定先于分城上限）', async () => {
      await pool.query(`UPDATE cities SET durability = 65, durability_settled_at = now() WHERE id = $1`, [P]);
      assert.equal((await setCapital(A, P)).res.error?.code, 'CAPITAL_SWAP_DURABILITY_LOW', '刚被打残、未回涨');
      // Q 被打到 65 后已过 10 小时，每小时回涨 10，结算为满值：城防放行，随后停在分城上限（官府 4 级上限 2，分城 3 座）
      await pool.query(`UPDATE cities SET durability = 65, durability_settled_at = now() - interval '10 hours' WHERE id = $1`, [Q]);
      assert.equal((await setCapital(A, Q)).res.error?.code, 'BRANCH_LIMIT_EXCEEDED');
      await pool.query(`UPDATE cities SET durability = 100, durability_settled_at = NULL WHERE id = $1`, [Q]);
      await pool.query(`UPDATE cities SET durability = 100, durability_settled_at = NULL WHERE id = $1`, [P]);
    });

    test('换完后分城数不能超过新主城的分城上限（BRANCH_LIMIT_EXCEEDED，附 limit 与 branchCount）', async () => {
      // 当前分城 P / Q / F 共 3 座；Q 官府 5 级 → 上限 2
      await pool.query(`UPDATE city_buildings SET level = 5 WHERE city_id = $1 AND kind = 'government'`, [Q]);
      const res = (await setCapital(A, Q)).res;
      assert.equal(res.error?.code, 'BRANCH_LIMIT_EXCEEDED');
      assert.deepEqual(res.data, { limit: 2, branchCount: 3 });
      assert.equal(await mainOf(A), M, '失败不改写');
    });

    test('成功对调：目标成为主城、原主城变为分城（城防满值起算），两城的建筑 / 资源 / 驻军不变，写事件与推送', async () => {
      const before = await pool.query(
        `SELECT id, gold, (SELECT count(*)::int FROM city_buildings b WHERE b.city_id = c.id) AS buildings,
                (SELECT sum(count)::int FROM city_army a WHERE a.city_id = c.id) AS army
         FROM cities c WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[M, P]],
      );
      const { res, pushes } = await setCapital(A, P);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.data?.capitalId, P);
      assert.equal(res.data?.formerCapitalId, M);
      assert.equal(res.data?.branchLimit, 3, '新主城官府 6 级 → 上限 3');
      const until = Date.parse(String(res.data?.cooldownUntil));
      assert.ok(Math.abs(until - Date.now() - DAY_MS) < 60_000, '冷却约 24 小时');

      assert.equal(await mainOf(A), P, '主城排第一');
      const ids = (await pool.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at`, [A])).rows.map((r) => r.id);
      assert.equal(ids[0], P);
      assert.equal(ids[1], M, '原主城成为第二早的城（排序稳定）');

      const after = await pool.query(
        `SELECT id, gold, (SELECT count(*)::int FROM city_buildings b WHERE b.city_id = c.id) AS buildings,
                (SELECT sum(count)::int FROM city_army a WHERE a.city_id = c.id) AS army
         FROM cities c WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[M, P]],
      );
      assert.deepEqual(after.rows, before.rows, '建筑 / 资源 / 驻军原样保留');

      const durabilities = (await pool.query(`SELECT id, durability FROM cities WHERE id = ANY($1::uuid[])`, [[M, P]])).rows as Array<{ id: string; durability: number | null }>;
      assert.equal(durabilities.find((r) => r.id === P)?.durability, null, '新主城城防置空（永不落值）');
      assert.equal(durabilities.find((r) => r.id === M)?.durability, 100, '原主城城防从满值开始计');

      const event = (await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = 'capital_changed' ORDER BY id DESC LIMIT 1`, [A])).rows[0];
      assert.equal(event?.detail?.capitalId, P, '写入 capital_changed 事件');
      assert.deepEqual(pushes.map((p) => p.op), [Op.PUSH_CITY_STATE], '同账号其他连接收到 PUSH_CITY_STATE');
      assert.equal(pushes[0]?.data?.reason, 'capital_changed');
      assert.equal(pushes[0]?.data?.cityId, P);
      assert.equal(pushes[0]?.data?.formerCapitalId, M);
    });

    test('主城判定随对调变化：分城上限按新主城算，放弃分城时新主城仍不可放弃，原主城可以放弃', async () => {
      const standing = await loadBranchStanding(pool, A);
      assert.equal(standing.mainGovernment, 6, '主城官府取新主城');
      assert.equal(standing.branchCount, 3);
      const discardMain = makeSink();
      (discardMain.ctx as { pool: pg.Pool }).pool = pool;
      await runWithCity(P, () => handleDiscardCity(discardMain.ctx, { accountId: A, role: 'player' } as unknown as ConnInfo, Op.DISCARD_CITY, 1, { confirm: true }));
      assert.equal(discardMain.frames[0]?.error?.code, 'DISCARD_MAIN_CITY', '新主城不可放弃');
    });

    test('冷却内再次设为主城返回 CAPITAL_SWAP_COOLDOWN，附 retryAfterSeconds；GET_STATE 视图给出冷却截止', async () => {
      const { res } = await setCapital(A, M);
      assert.equal(res.error?.code, 'CAPITAL_SWAP_COOLDOWN');
      const retry = Number(res.data?.retryAfterSeconds);
      assert.ok(retry > 86_300 && retry <= 86_400, `剩余约 24 小时（${retry}）`);
      const view = await loadCapitalSwapView(pool, A);
      assert.ok(view.cooldownUntil, '冷却截止时刻可见');
      // GET_STATE 逐城原因：名城与分城超限照常给出；冷却与来袭是账号级的，不进 blocked
      assert.equal(view.blocked[F], 'FAMOUS_CITY_NOT_CAPITAL');
      assert.equal(view.blocked[Q], 'BRANCH_LIMIT_EXCEEDED', 'Q 官府 5 级上限 2，分城 3 座');
      assert.equal(view.blocked[M], 'BRANCH_LIMIT_EXCEEDED', 'M 官府 2 级上限 1');
    });

    test('满 24 小时后可再换：把冷却截止调到过去，并把原主城 M 的官府升到 6 级后对调回去', async () => {
      await pool.query(`UPDATE capital_swaps SET until = now() - interval '1 second' WHERE account_id = $1`, [A]);
      await pool.query(`UPDATE city_buildings SET level = 6 WHERE city_id = $1 AND kind = 'government'`, [M]);
      const { res } = await setCapital(A, M);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.data?.capitalId, M);
      assert.equal(res.data?.formerCapitalId, P);
      assert.equal(await mainOf(A), M);
      assert.equal((await pool.query(`SELECT durability FROM cities WHERE id = $1`, [M])).rows[0].durability, null);
      assert.equal((await pool.query(`SELECT durability FROM cities WHERE id = $1`, [P])).rows[0].durability, 100);
    });

    test('城防归属随身份走：当前主城 M 城防为空（主城不落值），分城 P 城防为满值', async () => {
      const rows = (await pool.query(`SELECT id, durability FROM cities WHERE account_id = $1`, [A])).rows as Array<{ id: string; durability: number | null }>;
      assert.equal(rows.find((r) => r.id === M)?.durability, null);
      assert.equal(rows.find((r) => r.id === P)?.durability, 100);
    });
  });

  test('新号第一次不受冷却；时间缩放生效时冷却按缩放后时长计', async () => {
    const B = await newAccount('capital-b');
    const MB = await city({ accountId: B, name: '主城B', x: 1000, y: 1000, government: 1 });
    const PB = await city({ accountId: B, name: '分城PB', x: 1100, y: 1100, government: 4, durability: 100 });
    setTimeScaleCache(50);
    try {
      const { res } = await setCapital(B, PB);
      assert.equal(res.ok, true, JSON.stringify(res));
      const span = Date.parse(String(res.data?.cooldownUntil)) - Date.now();
      assert.ok(Math.abs(span - Math.floor(DAY_MS / 50)) < 60_000, `时间缩放 50 倍：冷却约 ${Math.floor(DAY_MS / 50 / 1000)} 秒（实际 ${Math.round(span / 1000)}）`);
    } finally {
      setTimeScaleCache(1);
    }
    assert.equal(await mainOf(B), PB);
    assert.equal(MB !== PB, true);
  });

  test('并发两次设为主城只成一次：另一次返回 CAPITAL_SWAP_COOLDOWN（锁内校验冷却）', async () => {
    const C = await newAccount('capital-c');
    await city({ accountId: C, name: '主城C', x: 2000, y: 2000, government: 1 });
    const X = await city({ accountId: C, name: '分城X', x: 2100, y: 2100, government: 4, durability: 100 });
    const Y = await city({ accountId: C, name: '分城Y', x: 2200, y: 2200, government: 4, durability: 100 });
    const [r1, r2] = await Promise.all([setCapital(C, X), setCapital(C, Y)]);
    const codes = [r1.res, r2.res].map((r) => (r.ok ? 'ok' : r.error?.code)).sort();
    assert.deepEqual(codes, ['CAPITAL_SWAP_COOLDOWN', 'ok'], JSON.stringify(codes));
    const rows = (await pool.query(`SELECT count(*)::int AS n FROM cities WHERE account_id = $1 AND durability IS NULL`, [C])).rows[0];
    assert.equal(rows.n, 1, '只有一座新主城的城防为空');
  });

  test('并发设为主城与放弃另一座分城：两者互不死锁，结果一致（主城为新城、被放弃的城已删除）', async () => {
    const E = await newAccount('capital-e');
    const ME = await city({ accountId: E, name: '主城E', x: 4000, y: 4000, government: 1 });
    const XE = await city({ accountId: E, name: '分城XE', x: 4100, y: 4100, government: 4, durability: 100 });
    const YE = await city({ accountId: E, name: '分城YE', x: 4200, y: 4200, government: 1, durability: 100 });
    const discardSink = makeSink();
    (discardSink.ctx as { pool: pg.Pool }).pool = pool;
    const discardConn = { accountId: E, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    const [swap, discard] = await Promise.all([
      setCapital(E, XE),
      runWithCity(YE, () => handleDiscardCity(discardSink.ctx, discardConn, Op.DISCARD_CITY, 1, { confirm: true })).then(() => discardSink.frames[0]),
    ]);
    assert.equal(swap.res.ok, true, JSON.stringify(swap.res));
    assert.equal(discard?.ok, true, JSON.stringify(discard));
    assert.equal(await mainOf(E), XE, '新主城为原分城 XE');
    assert.equal(await count(`SELECT count(*)::int AS n FROM cities WHERE id = $1`, [YE]), 0, 'YE 已放弃');
    assert.equal(await count(`SELECT count(*)::int AS n FROM cities WHERE id = $1`, [ME]), 1, '原主城保留（变为分城）');
  });

  test('分城上限复核：官府 6 级（上限 3）可换、官府 5 级（上限 2）不可换', async () => {
    const D = await newAccount('capital-d');
    await city({ accountId: D, name: '主城D', x: 3000, y: 3000, government: 6 });
    const D1 = await city({ accountId: D, name: '分城D1', x: 3100, y: 3100, government: 5, durability: 100 });
    await city({ accountId: D, name: '分城D2', x: 3200, y: 3200, government: 3, durability: 100 });
    await city({ accountId: D, name: '分城D3', x: 3300, y: 3300, government: 1, durability: 100 });
    assert.equal((await setCapital(D, D1)).res.error?.code, 'BRANCH_LIMIT_EXCEEDED', '3 座分城，官府 5 级上限 2');
    await pool.query(`UPDATE city_buildings SET level = 6 WHERE city_id = $1 AND kind = 'government'`, [D1]);
    const ok = (await setCapital(D, D1)).res;
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.data?.branchLimit, 3);
  });
});
