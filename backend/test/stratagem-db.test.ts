// 计谋的数据库集成用例（v86，AISLG-211）：施计事务（扣令 / 冷却 / 事件 / 推送）、
// 成功率与免疫、令不足不扣、武将不在家 / 冷却中、十面埋伏期间出兵被拒、
// 战场商店兑换令的持有上限、并发施计不会把令扣成负数。
// 需要 TEST_DATABASE_URL（一次性临时库，别指向开发库）；未设置时整组跳过。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { EventType, Op, type InitiatorRole } from '../common/src/protocol';
import { loadStratagemTokens } from '../common/src/stratagem-db';
import { setStratagemRandomSource } from '../api/src/handlers-stratagem';
import { cityDispatchBlockedSeconds } from '../api/src/stratagem-target';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('计谋的事务行为（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let casterId: string;
  let rivalId: string;
  let rivalHeroId: string;
  let targetId: string;
  let casterCityId: string;
  let targetCityId: string;
  let heroId: string;
  const CASTER = { x: 700, y: 700 };
  const TARGET = { x: 702, y: 700 };

  function makeSink() {
    const frames: Array<{ op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const pushes: Array<{ accountId: string; op: number; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: (accountId: string, frame: { op: number; data?: Record<string, unknown> }) => {
        pushes.push({ accountId, op: frame.op, data: frame.data });
        return 0;
      },
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    return { ctx, frames, pushes };
  }

  /** 以指定账号发一条协议（经 handleMessage：覆盖分发层与帧层） */
  async function send(account: string, op: number, data: Record<string, unknown>) {
    const sink = makeSink();
    const conn = { accountId: account, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op, seq: 1, data }));
    return { res: sink.frames[sink.frames.length - 1], pushes: sink.pushes, frames: sink.frames };
  }

  const cast = (data: Record<string, unknown>) => send(casterId, Op.CAST_STRATAGEM, data);

  async function tokensOf(account: string) {
    return loadStratagemTokens(pool, account);
  }

  async function setTokens(account: string, kind: string, count: number): Promise<void> {
    await pool.query(
      `INSERT INTO account_stratagem_tokens (account_id, kind, count) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, kind) DO UPDATE SET count = $3`,
      [account, kind, count],
    );
  }

  async function targetFood(): Promise<number> {
    return Number((await pool.query(`SELECT food FROM cities WHERE id = $1`, [targetCityId])).rows[0].food);
  }

  /** 每个用例前：清掉效果 / 免疫 / 冷却 / 事件 / 行军，恢复令数、粮食与保护状态 */
  async function reset(): Promise<void> {
    await pool.query(`DELETE FROM city_stratagem_effects`);
    await pool.query(`DELETE FROM stratagem_immunity`);
    await pool.query(`DELETE FROM account_stratagem_tokens`);
    await pool.query(`DELETE FROM events WHERE account_id = ANY($1::uuid[])`, [[casterId, rivalId, targetId]]);
    await pool.query(`DELETE FROM marches WHERE account_id = ANY($1::uuid[])`, [[casterId, rivalId, targetId]]);
    await pool.query(
      `UPDATE account_heroes SET stratagem_cooldown_until = NULL, train_until = NULL, wounded_until = NULL WHERE id = ANY($1::uuid[])`,
      [[heroId, rivalHeroId]],
    );
    await pool.query(`UPDATE accounts SET newbie_until = NULL, self_truce_until = NULL WHERE id = ANY($1::uuid[])`, [[casterId, rivalId, targetId]]);
    await pool.query(`UPDATE cities SET food = 10000, truce_until = NULL WHERE id = ANY($1::uuid[])`, [[casterCityId, targetCityId]]);
    await setTokens(casterId, 'assault', 3);
    await setTokens(rivalId, 'assault', 3);
    // 固定随机源：0 → 成功率判定必中（0 < 50%），欺敌倍数取最小值
    setStratagemRandomSource(() => 0);
  }

  async function eventsOf(account: string, type: string) {
    const res = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id`, [account, type]);
    return res.rows as Array<{ detail: Record<string, unknown> }>;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'stratagem');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    const mk = async (label: string): Promise<string> =>
      (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`])).rows[0].id as string;
    casterId = await mk('stratagem-caster');
    rivalId = await mk('stratagem-rival');
    targetId = await mk('stratagem-target');
    casterCityId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城', 1000, 1000, 10000, $2, $3) RETURNING id`,
      [casterId, CASTER.x, CASTER.y],
    )).rows[0].id as string;
    targetCityId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '敌城', 1000, 1000, 10000, $2, $3) RETURNING id`,
      [targetId, TARGET.x, TARGET.y],
    )).rows[0].id as string;
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES
         ($1, $2, 'plain', 'city', 0, $3, NULL),
         ($4, $5, 'plain', 'city', 0, $6, NULL)
       ON CONFLICT (x, y) DO UPDATE SET kind = EXCLUDED.kind, owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [CASTER.x, CASTER.y, casterCityId, TARGET.x, TARGET.y, targetCityId],
    );
    // 施计武将：智力 50 在家（目标城无城守 → 成功率封顶 90%）
    heroId = (await pool.query(
      `INSERT INTO account_heroes (account_id, name, lead, force, wit) VALUES ($1, '荀彧', 60, 40, 50) RETURNING id`,
      [casterId],
    )).rows[0].id as string;
    // 另一名施计者的武将：用于并发用例（同目标同种计只能有一个生效）
    rivalHeroId = (await pool.query(
      `INSERT INTO account_heroes (account_id, name, lead, force, wit) VALUES ($1, '郭嘉', 60, 40, 50) RETURNING id`,
      [rivalId],
    )).rows[0].id as string;
  });

  after(async () => {
    setStratagemRandomSource(Math.random);
    await pool?.end();
    await tmp?.drop();
  });

  beforeEach(async () => {
    await reset();
  });

  test('焚烧粮草成功：烧掉 floor(现存 × 5%)、扣 1 张攻心令、写冷却、双方各写事件并推警报', async () => {
    const before = await targetFood();
    const { res, pushes } = await cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal(res.data?.success, true);
    assert.equal(res.data?.failedReason, null);
    const burned = Number((res.data?.effect as Record<string, unknown>).foodBurned);
    assert.equal(burned, Math.floor(before * 0.05), '智力 50 → 5%');
    assert.equal(await targetFood(), before - burned);
    assert.equal(res.data?.tokenKind, 'assault');
    assert.equal(res.data?.tokensLeft, 2);
    assert.deepEqual(await tokensOf(casterId), { deception: 0, march: 0, assault: 2, intel: 0 });
    // 武将冷却 1 小时（基准，缩放 1）
    const cooldown = new Date(String(res.data?.heroCooldownUntil));
    assert.ok(cooldown.getTime() > Date.now(), '冷却截止在未来');
    // 事件：施计方 stratagem_cast、目标方 stratagem_received
    const castEvents = await eventsOf(casterId, EventType.STRATAGEM_CAST);
    assert.equal(castEvents.length, 1);
    assert.equal(castEvents[0].detail.stratagem, 'burn_granary');
    const received = await eventsOf(targetId, EventType.STRATAGEM_RECEIVED);
    assert.equal(received.length, 1);
    assert.equal(received[0].detail.success, true);
    assert.equal((received[0].detail.caster as Record<string, unknown>).heroName, '荀彧');
    // 推送：目标玩家收到 PUSH_STRATAGEM
    assert.ok(pushes.some((push) => push.op === Op.PUSH_STRATAGEM && push.accountId === targetId));
  });

  test('6 小时内再施直接判失败、照常扣令并给对方警报（免疫只在成功后开始记）', async () => {
    const first = await cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } });
    assert.equal(first.res.data?.success, true);
    await pool.query(`UPDATE account_heroes SET stratagem_cooldown_until = NULL WHERE id = $1`, [heroId]);
    const before = await targetFood();
    const second = await cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } });
    assert.equal(second.res.ok, true);
    assert.equal(second.res.data?.success, false);
    assert.equal(second.res.data?.failedReason, 'immune');
    assert.equal(await targetFood(), before, '免疫期内不生效、不烧粮');
    assert.deepEqual(await tokensOf(casterId), { deception: 0, march: 0, assault: 1, intel: 0 }, '令照扣');
    assert.equal((await eventsOf(targetId, EventType.STRATAGEM_RECEIVED)).length, 2, '失败也写警报');
    assert.ok(second.pushes.some((push) => push.op === Op.PUSH_STRATAGEM));
  });

  test('令不足返回 STRATAGEM_TOKEN_SHORT，且不扣令、不写冷却、不改任何数据', async () => {
    await setTokens(casterId, 'assault', 0);
    const before = await targetFood();
    const { res } = await cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'STRATAGEM_TOKEN_SHORT');
    assert.equal(res.data?.tokenKind, 'assault');
    assert.equal(res.data?.have, 0);
    assert.equal(await targetFood(), before);
    const hero = (await pool.query(`SELECT stratagem_cooldown_until FROM account_heroes WHERE id = $1`, [heroId])).rows[0];
    assert.equal(hero.stratagem_cooldown_until, null, '不写冷却');
    assert.equal((await eventsOf(targetId, EventType.STRATAGEM_RECEIVED)).length, 0);
  });

  test('武将不在家（历练中）返回 HERO_NOT_AVAILABLE；冷却中返回 HERO_STRATAGEM_COOLDOWN', async () => {
    await pool.query(`UPDATE account_heroes SET train_until = now() + interval '1 hour' WHERE id = $1`, [heroId]);
    const training = await cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } });
    assert.equal(training.res.error?.code, 'HERO_NOT_AVAILABLE');
    assert.equal(training.res.data?.reason, 'training');
    await pool.query(`UPDATE account_heroes SET train_until = NULL, stratagem_cooldown_until = now() + interval '30 minutes' WHERE id = $1`, [heroId]);
    const cooling = await cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } });
    assert.equal(cooling.res.error?.code, 'HERO_STRATAGEM_COOLDOWN');
    assert.ok(Number(cooling.res.data?.retryAfterSeconds) > 0);
    assert.deepEqual(await tokensOf(casterId), { deception: 0, march: 0, assault: 3, intel: 0 }, '两种拒绝都不扣令');
  });

  test('十面埋伏：锁城期间 MARCH 被拒 CITY_AMBUSHED，到期后恢复', async () => {
    await pool.query(
      `INSERT INTO city_stratagem_effects (city_id, kind, param, until) VALUES ($1, 'ambush_all_sides', 0, now() + interval '10 minutes')`,
      [targetCityId],
    );
    const blocked = await send(targetId, Op.MARCH, { x: TARGET.x + 1, y: TARGET.y, troops: { militia: 1 } });
    assert.equal(blocked.res.ok, false);
    assert.equal(blocked.res.error?.code, 'CITY_AMBUSHED');
    assert.ok(Number(blocked.res.data?.retryAfterSeconds) > 500);
    const now = (await pool.query(`SELECT now() AS now`)).rows[0].now as Date;
    assert.ok((await cityDispatchBlockedSeconds(pool, targetCityId, now)) !== null);
    // 到期后不再拦截
    await pool.query(`UPDATE city_stratagem_effects SET until = now() - interval '1 second' WHERE city_id = $1`, [targetCityId]);
    const later = (await pool.query(`SELECT now() AS now`)).rows[0].now as Date;
    assert.equal(await cityDispatchBlockedSeconds(pool, targetCityId, later), null);
  });

  test('目标在新手保护 / 免战中：进攻类计谋返回 TARGET_PROTECTED（不扣令）', async () => {
    await pool.query(`UPDATE accounts SET newbie_until = now() + interval '1 hour' WHERE id = $1`, [targetId]);
    const guarded = await cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } });
    assert.equal(guarded.res.error?.code, 'TARGET_PROTECTED');
    assert.deepEqual(await tokensOf(casterId), { deception: 0, march: 0, assault: 3, intel: 0 });
    // 欺敌是防守类：任何时候都能用（对自己的一座城）
    await setTokens(casterId, 'deception', 1);
    const own = await cast({ heroId, stratagem: 'phantom_army', target: { cityId: casterCityId } });
    assert.equal(own.res.ok, true, JSON.stringify(own.res.error));
    assert.equal(own.res.data?.success, true);
    const effect = (await pool.query(`SELECT kind, param, until FROM city_stratagem_effects WHERE city_id = $1`, [casterCityId])).rows[0];
    assert.equal(effect.kind, 'deception');
    assert.equal(Number(effect.param), 300, '固定随机源取草木皆兵最小倍数 300%');
  });

  test('战场商店兑换计谋令：扣军功 + 持有到上限返回 STRATAGEM_TOKEN_FULL 且不扣军功', async () => {
    const eventId = (await pool.query(
      `INSERT INTO battlefield_events (script, signup_start, start_at, end_at, status)
       VALUES ('guandu', now() - interval '2 hours', now() - interval '1 hour', now() + interval '1 day', 'active') RETURNING id`,
    )).rows[0].id as string;
    await pool.query(
      `INSERT INTO battlefield_merit (account_id, merit) VALUES ($1, 1000)
       ON CONFLICT (account_id) DO UPDATE SET merit = 1000`,
      [casterId],
    );
    await pool.query(`DELETE FROM battlefield_purchases WHERE account_id = $1`, [casterId]);
    await setTokens(casterId, 'assault', 0); // reset() 默认给了 3 张，这里从 0 开始买
    // 攻心令 250 军功、每场限购 2、持有上限 3
    for (const expected of [1, 2]) {
      const buy = await send(casterId, Op.BUY_BATTLEFIELD_ITEM, { item: 'stratagem_assault' });
      assert.equal(buy.res.ok, true, JSON.stringify(buy.res.error));
      assert.deepEqual(buy.res.data?.reward, { stratagemToken: 'assault', count: 1 });
      assert.equal((await loadStratagemTokens(pool, casterId)).assault, expected);
    }
    const merit = Number((await pool.query(`SELECT merit FROM battlefield_merit WHERE account_id = $1`, [casterId])).rows[0].merit);
    assert.equal(merit, 500, '两张攻心令共 500 军功');
    const third = await send(casterId, Op.BUY_BATTLEFIELD_ITEM, { item: 'stratagem_assault' });
    assert.equal(third.res.error?.code, 'BATTLEFIELD_SHOP_LIMIT', '本场限购 2 张');
    // 直接放到持有上限（3）再换场次买 → STRATAGEM_TOKEN_FULL，不扣军功
    await setTokens(casterId, 'assault', 3);
    await setTokens(rivalId, 'assault', 3);
    await pool.query(`UPDATE battlefield_events SET id = id WHERE id = $1`, [eventId]);
    await pool.query(`DELETE FROM battlefield_purchases WHERE account_id = $1 AND item = 'stratagem_assault'`, [casterId]);
    const full = await send(casterId, Op.BUY_BATTLEFIELD_ITEM, { item: 'stratagem_assault' });
    assert.equal(full.res.error?.code, 'STRATAGEM_TOKEN_FULL');
    assert.equal(full.res.data?.tokenKind, 'assault');
    assert.equal(full.res.data?.limit, 3);
    assert.equal(Number((await pool.query(`SELECT merit FROM battlefield_merit WHERE account_id = $1`, [casterId])).rows[0].merit), 500, '到上限不扣军功');
    await pool.query(`DELETE FROM battlefield_purchases WHERE account_id = $1`, [casterId]);
    await pool.query(`DELETE FROM battlefield_merit WHERE account_id = $1`, [casterId]);
    await pool.query(`DELETE FROM battlefield_events WHERE id = $1`, [eventId]);
  });

  test('并发：两人同时对同一城施同一种计，只有一个生效、另一个按免疫失败；令不会变成负数', async () => {
    const [a, b] = await Promise.all([
      cast({ heroId, stratagem: 'burn_granary', target: { cityId: targetCityId } }),
      send(rivalId, Op.CAST_STRATAGEM, { heroId: rivalHeroId, stratagem: 'burn_granary', target: { cityId: targetCityId } }),
    ]);
    const results = [a.res, b.res].map((res) => {
      assert.equal(res.ok, true, JSON.stringify(res.error));
      return res.data as { success: boolean; failedReason: string | null };
    });
    assert.equal(results.filter((item) => item.success).length, 1, '只有一个生效');
    assert.equal(results.filter((item) => item.failedReason === 'immune').length, 1, '另一个按免疫失败');
    // 双方都扣了 1 张令（成功失败都扣），且不会变成负数
    assert.deepEqual(await tokensOf(casterId), { deception: 0, march: 0, assault: 2, intel: 0 });
    assert.deepEqual(await tokensOf(rivalId), { deception: 0, march: 0, assault: 2, intel: 0 });
    const effects = await pool.query(`SELECT 1 FROM city_stratagem_effects WHERE city_id = $1`, [targetCityId]);
    assert.equal(effects.rowCount, 0, '焚烧粮草不留城效果行（只写免疫行）');
    const immunity = await pool.query(`SELECT until FROM stratagem_immunity WHERE target_id = $1 AND kind = 'burn_granary'`, [targetCityId]);
    assert.equal(immunity.rowCount, 1, '只写一行免疫');
  });
});
