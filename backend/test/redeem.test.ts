// 兑换码（AISLG-253，v109）：批次创建 / 列表 / 导出 / 停用，兑换成功（元宝 + 道具、事件），
// 每个错误码（不存在 / 过期 / 一次性码已被用 / 同批已领 / 通用码领完 / 限流 / 道具超堆叠），
// 两类并发（一次性码 20 账号抢 1 个、同账号抢同批 2 个、通用码人数上限），失败次数与 7 天清理。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（临时集群，测试在其中新建独立库），否则跳过。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { grantItem, loadItems } from '../common/src/items-db';
import { loadIngot } from '../common/src/ingot-db';
import {
  countRecentFailures,
  createRedeemBatch,
  disableRedeemBatch,
  listRedeemBatches,
  listRedeemCodes,
  loadRedeemBatch,
  purgeRedeemAttempts,
  redeemCode,
  type CreateRedeemBatchInput,
} from '../common/src/redeem-db';
import {
  CODE_ALPHABET,
  REDEEM_FAIL_LIMIT,
  REDEEM_FAIL_WINDOW_MS,
  formatRedeemCode,
  generateRedeemCode,
  normalizeRedeemCode,
} from '../common/src/redeem-code';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { insertAccountWithCity } from '../api/src/auth';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { runSeasonReset } from '../worker/src/season-reset';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('兑换码（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `redeem-${Date.now()}`;
  /** 大多数用例的“现在”：固定值，避免真实时间与测试注入的时间互相影响 */
  const NOW = new Date('2026-11-01T00:00:00Z');

  async function inTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function newAccount(name: string): Promise<string> {
    return inTx(async (client) => {
      const created = await insertAccountWithCity(client, { username: `${tag}-${name}`, passwordHash: 'x', signupIp: null });
      return created.id;
    });
  }

  /** 建一个批次，返回批次 id 与码（规范化形式） */
  async function newBatch(input: Partial<CreateRedeemBatchInput> & { count?: number }): Promise<{ batchId: string; codes: string[] }> {
    return inTx((client) =>
      createRedeemBatch(client, {
        name: `${tag}-batch`,
        kind: 'single',
        rewards: { ingot: 500, items: [{ itemId: 'city_order', count: 2 }] },
        maxRedemptions: null,
        expiresAt: null,
        count: 2,
        ...input,
      }),
    );
  }

  function redeem(accountId: string, code: unknown, now: Date = NOW) {
    return redeemCode(pool, { accountId, code, now });
  }

  async function eventsOf(accountId: string, type: string): Promise<Array<{ detail: Record<string, unknown> }>> {
    const res = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id`, [accountId, type]);
    return res.rows as Array<{ detail: Record<string, unknown> }>;
  }

  async function give(accountId: string, itemId: 'city_order' | 'city_order_adv', n: number): Promise<void> {
    await inTx((client) => grantItem(client, accountId, itemId, n, 'test'));
  }

  async function callAs(
    accountId: string,
    op: number,
    data?: Record<string, unknown>,
    role: 'player' | 'agent' = 'player',
  ): Promise<ResponseFrame> {
    const sent: ResponseFrame[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = {
      socket,
      ip: null,
      host: null,
      accountId,
      username: null,
      role,
      sessionId: null,
      connectedAt: new Date(),
    };
    registry.add(conn);
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
    await handleMessage(ctx, conn, JSON.stringify({ op, seq: 1, data }));
    const frame = sent.find((f) => f.op === op);
    assert.ok(frame, `op ${op} 没有响应`);
    return frame;
  }

  before(async () => {
    db = await createTempDatabase(dbUrl as string, 'redeem');
    pool = new pg.Pool({ connectionString: db.url, max: 24 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ---- 批次与运营侧 ----

  test('create 生成 100 个一次性码：16 位、字符集去 ILOU、互不重复、显示格式带横线', async () => {
    const { batchId, codes } = await newBatch({ count: 100 });
    assert.equal(codes.length, 100);
    assert.equal(new Set(codes).size, 100);
    for (const code of codes) {
      assert.equal(code.length, 16);
      for (const char of code) {
        assert.ok(CODE_ALPHABET.includes(char), `${code} 含字符集外的字符 ${char}`);
      }
      assert.match(formatRedeemCode(code), /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    }
    // export 与生成的一致（同一个批次再读一次）
    const exported = await listRedeemCodes(pool, batchId);
    assert.deepEqual([...exported].sort(), [...codes].sort());
    // list 显示 0/100
    const summary = (await listRedeemBatches(pool)).find((row) => row.id === batchId);
    assert.ok(summary);
    assert.equal(summary.codeCount, 100);
    assert.equal(summary.claimCount, 0);
    assert.equal(summary.kind, 'single');
    assert.deepEqual(summary.rewards, { ingot: 500, items: [{ itemId: 'city_order', count: 2 }] });
  });

  test('通用码只生成 1 个码，max_redemptions 落库；一次性码的 max 为 null', async () => {
    const shared = await newBatch({ kind: 'shared', maxRedemptions: 3, count: 99 });
    assert.equal(shared.codes.length, 1);
    const batch = await loadRedeemBatch(pool, shared.batchId);
    assert.equal(batch?.maxRedemptions, 3);
    const single = await newBatch({ count: 2 });
    assert.equal((await loadRedeemBatch(pool, single.batchId))?.maxRedemptions, null);
  });

  // ---- 兑换成功 ----

  test('兑换成功：元宝 +500、迁城令 +2，事件 CODE_REDEEMED 与 INGOT_GRANTED，码只记后 4 位', async () => {
    const id = await newAccount('ok');
    const { codes } = await newBatch({ count: 1 });
    const result = await redeem(id, formatRedeemCode(codes[0]));
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.rewards, { ingot: 500, items: [{ itemId: 'city_order', count: 2 }] });
    assert.equal(result.ingot, 500);
    assert.deepEqual(result.items, { city_order: 2, city_order_adv: 0 });
    assert.equal(await loadIngot(pool, id), 500);
    assert.equal((await loadItems(pool, id)).city_order, 2);
    // 福利道具只加 count，不加 paid_count（换季会清空）
    const paid = await pool.query(`SELECT paid_count FROM user_items WHERE account_id = $1 AND item_id = 'city_order'`, [id]);
    assert.equal(Number(paid.rows[0].paid_count), 0);

    const redeemed = await eventsOf(id, 'code_redeemed');
    assert.equal(redeemed.length, 1);
    assert.equal(redeemed[0].detail.codeTail, codes[0].slice(-4));
    assert.equal(redeemed[0].detail.kind, 'single');
    assert.ok(!JSON.stringify(redeemed[0].detail).includes(codes[0]), '事件里不应出现全码');
    const granted = await eventsOf(id, 'ingot_granted');
    assert.deepEqual(granted[0].detail, { reason: 'redeem', amount: 500, balance: 500 });
  });

  test('小写加空格横线、大写无分隔的同一个码效果相同（两个账号各用一次）', async () => {
    const first = await newAccount('case-lower');
    const second = await newAccount('case-upper');
    const { codes } = await newBatch({ count: 2, rewards: { ingot: 100 } });
    const lower = formatRedeemCode(codes[0]).toLowerCase().split('-').join(' ');
    assert.equal(normalizeRedeemCode(lower), codes[0]);
    assert.equal((await redeem(first, lower)).ok, true);
    assert.equal((await redeem(second, formatRedeemCode(codes[1]))).ok, true);
    assert.equal(await loadIngot(pool, first), 100);
    assert.equal(await loadIngot(pool, second), 100);
  });

  // ---- 错误码 ----

  test('码不存在 / 长度不对 → CODE_INVALID（都算一次失败）', async () => {
    const id = await newAccount('invalid');
    const missing = generateRedeemCode();
    assert.deepEqual(await redeem(id, missing), { ok: false, code: 'CODE_INVALID' });
    assert.deepEqual(await redeem(id, 'abcd'), { ok: false, code: 'CODE_INVALID' });
    assert.deepEqual(await redeem(id, 12345), { ok: false, code: 'CODE_INVALID' });
    assert.equal((await countRecentFailures(pool, id, NOW)).count, 3);
    assert.equal(await loadIngot(pool, id), 0);
  });

  test('过期码 → CODE_EXPIRED（按 now 判定，边界前一毫秒仍然有效）', async () => {
    const id = await newAccount('expired');
    const { codes } = await newBatch({ count: 1, rewards: { ingot: 10 }, expiresAt: new Date(NOW.getTime() + 1000) });
    assert.deepEqual(await redeem(id, codes[0], new Date(NOW.getTime() + 1000)), { ok: false, code: 'CODE_EXPIRED' });
    assert.equal(await loadIngot(pool, id), 0);
    const other = await newAccount('expired-ok');
    assert.equal((await redeem(other, codes[0], new Date(NOW.getTime() + 999))).ok, true);
  });

  test('一次性码第二次被任意账号兑换 → CODE_USED', async () => {
    const first = await newAccount('used-1');
    const second = await newAccount('used-2');
    const { codes } = await newBatch({ count: 1 });
    assert.equal((await redeem(first, codes[0])).ok, true);
    assert.deepEqual(await redeem(second, codes[0]), { ok: false, code: 'CODE_USED' });
    assert.equal(await loadIngot(pool, second), 0);
  });

  test('同账号拿同批次另一个码 → CODE_BATCH_CLAIMED，那个码仍可被别人兑换', async () => {
    const first = await newAccount('batch-1');
    const second = await newAccount('batch-2');
    const { codes } = await newBatch({ count: 2, rewards: { ingot: 50 } });
    assert.equal((await redeem(first, codes[0])).ok, true);
    assert.deepEqual(await redeem(first, codes[1]), { ok: false, code: 'CODE_BATCH_CLAIMED' });
    // 码本身没作废
    assert.equal((await redeem(second, codes[1])).ok, true);
    assert.equal(await loadIngot(pool, first), 50);
    assert.equal(await loadIngot(pool, second), 50);
  });

  test('通用码达到 max 后第 N+1 个账号 → CODE_EXHAUSTED（附 limit / used）', async () => {
    const { codes } = await newBatch({ kind: 'shared', maxRedemptions: 2, rewards: { ingot: 20 } });
    const accounts = [await newAccount('shared-1'), await newAccount('shared-2'), await newAccount('shared-3')];
    assert.equal((await redeem(accounts[0], codes[0])).ok, true);
    assert.equal((await redeem(accounts[1], codes[0])).ok, true);
    assert.deepEqual(await redeem(accounts[2], codes[0]), {
      ok: false,
      code: 'CODE_EXHAUSTED',
      detail: { limit: 2, used: 2 },
    });
    assert.equal(await loadIngot(pool, accounts[2]), 0);
  });

  test('disable 之后 → CODE_INVALID，已领的奖励不收回', async () => {
    const id = await newAccount('disable');
    const other = await newAccount('disable-other');
    const { batchId, codes } = await newBatch({ count: 2 });
    assert.equal((await redeem(id, codes[0])).ok, true);
    assert.equal(await disableRedeemBatch(pool, batchId), true);
    assert.equal(await disableRedeemBatch(pool, batchId), false, '重复停用返回 false');
    assert.deepEqual(await redeem(other, codes[1]), { ok: false, code: 'CODE_INVALID' });
    assert.equal(await loadIngot(pool, id), 500, '已领的元宝不收回');
    assert.equal((await loadItems(pool, id)).city_order, 2, '已领的道具不收回');
    assert.equal((await listRedeemBatches(pool)).find((row) => row.id === batchId)?.disabled, true);
  });

  test('道具发放后超堆叠上限 → ITEM_STACK_FULL：整单回滚，码不作废、元宝也没发', async () => {
    const id = await newAccount('stack');
    const { codes } = await newBatch({ count: 1, rewards: { ingot: 500, items: [{ itemId: 'city_order', count: 2 }] } });
    await give(id, 'city_order', 98);
    const result = await redeem(id, codes[0]);
    assert.deepEqual(result, {
      ok: false,
      code: 'ITEM_STACK_FULL',
      detail: { itemId: 'city_order', stackMax: 99, have: 98, canGrant: 1 },
    });
    assert.equal(await loadIngot(pool, id), 0, '元宝也没发');
    assert.equal((await loadItems(pool, id)).city_order, 98);
    assert.equal((await countRecentFailures(pool, id, NOW)).count, 0, '背包满不算猜码失败');
    // 码未作废、也不计入已领：消耗掉一部分后仍然可以兑
    await inTx(async (client) => {
      await client.query(`UPDATE user_items SET count = 90 WHERE account_id = $1 AND item_id = 'city_order'`, [id]);
    });
    assert.equal((await redeem(id, codes[0])).ok, true);
    assert.equal(await loadIngot(pool, id), 500);
    assert.equal((await loadItems(pool, id)).city_order, 92);
  });

  // ---- 限流 ----

  test(`连续输错 ${REDEEM_FAIL_LIMIT} 次后，第 ${REDEEM_FAIL_LIMIT + 1} 次（正确的码）→ CODE_RATE_LIMITED`, async () => {
    const id = await newAccount('ratelimit');
    const { codes } = await newBatch({ count: 1 });
    for (let i = 0; i < REDEEM_FAIL_LIMIT; i += 1) {
      assert.deepEqual(await redeem(id, generateRedeemCode()), { ok: false, code: 'CODE_INVALID' });
    }
    const limited = await redeem(id, codes[0], new Date(NOW.getTime() + 1000));
    assert.equal(limited.ok, false);
    if (limited.ok) {
      return;
    }
    assert.equal(limited.code, 'CODE_RATE_LIMITED');
    assert.ok((limited.detail?.retryAfterSeconds ?? 0) > 0);
    // 超限期间也不累加失败次数（否则封禁会无限延长）
    assert.equal((await countRecentFailures(pool, id, new Date(NOW.getTime() + 2000))).count, REDEEM_FAIL_LIMIT);
  });

  test('成功兑换不计入失败次数；1 小时后失败窗口自然清空', async () => {
    const id = await newAccount('ratelimit-recover');
    const batch = await newBatch({ count: 2, rewards: { ingot: 1 } });
    for (let i = 0; i < REDEEM_FAIL_LIMIT - 1; i += 1) {
      await redeem(id, generateRedeemCode());
    }
    assert.equal((await countRecentFailures(pool, id, NOW)).count, REDEEM_FAIL_LIMIT - 1);
    // 第 N 次是成功的正确码：成功不计数
    assert.equal((await redeem(id, batch.codes[0])).ok, true);
    assert.equal((await countRecentFailures(pool, id, NOW)).count, REDEEM_FAIL_LIMIT - 1);
    // 再错一次就到了上限 → 下一个请求被限流
    await redeem(id, generateRedeemCode());
    assert.equal((await redeem(id, batch.codes[1], new Date(NOW.getTime() + 60_000))).ok, false);
    // 1 小时后窗口清空，可以再兑（用新的批次，因为上一个批次已被这号领过）
    const later = new Date(NOW.getTime() + REDEEM_FAIL_WINDOW_MS + 60_000);
    const fresh = await newBatch({ count: 1, rewards: { ingot: 1 } });
    assert.equal((await redeem(id, fresh.codes[0], later)).ok, true);
  });

  // ---- 并发 ----

  test('并发：同一个一次性码被 20 个账号同时兑换，恰好 1 个成功', async () => {
    const { codes } = await newBatch({ count: 1, rewards: { ingot: 30 } });
    const accounts = await Promise.all(Array.from({ length: 20 }, (_, i) => newAccount(`race-code-${i}`)));
    const results = await Promise.all(accounts.map((accountId) => redeem(accountId, codes[0])));
    const success = results.filter((result) => result.ok);
    assert.equal(success.length, 1);
    for (const result of results) {
      if (!result.ok) {
        assert.equal(result.code, 'CODE_USED');
      }
    }
    const claimed = await pool.query(`SELECT count(*) AS count FROM redeem_claims WHERE code = $1`, [codes[0]]);
    assert.equal(Number(claimed.rows[0].count), 1);
  });

  test('并发：同一账号同时兑换同批次 2 个码，恰好 1 个成功（另一个 CODE_BATCH_CLAIMED）', async () => {
    const id = await newAccount('race-account');
    const { codes } = await newBatch({ count: 2, rewards: { ingot: 40 } });
    const results = await Promise.all(codes.map((code) => redeem(id, code)));
    assert.equal(results.filter((result) => result.ok).length, 1);
    const failed = results.filter((result) => !result.ok) as Array<{ code: string }>;
    assert.equal(failed.length, 1);
    assert.equal(failed[0].code, 'CODE_BATCH_CLAIMED');
    assert.equal(await loadIngot(pool, id), 40, '只入账一次');
    // 没成功的那个码仍然可以给别人
    const other = await newAccount('race-account-other');
    const used = results.findIndex((result) => result.ok);
    const leftover = codes[used === 0 ? 1 : 0];
    assert.equal((await redeem(other, leftover)).ok, true);
  });

  test('并发：通用码 max=200，300 个账号同时兑换，成功数恰好 200（验收口径 5）', async () => {
    const { codes } = await newBatch({ kind: 'shared', maxRedemptions: 200, rewards: { ingot: 5 } });
    const accounts = await Promise.all(Array.from({ length: 300 }, (_, i) => newAccount(`race-shared-${i}`)));
    const results = await Promise.all(accounts.map((accountId) => redeem(accountId, codes[0])));
    assert.equal(results.filter((result) => result.ok).length, 200);
    const claimed = await pool.query(`SELECT count(*) AS count FROM redeem_claims WHERE code = $1`, [codes[0]]);
    assert.equal(Number(claimed.rows[0].count), 200);
    const failed = results.filter((r) => !r.ok).map((r) => (r.ok === false ? r.code : ''));
    assert.equal(failed.length, 100);
    assert.ok(failed.every((code) => code === 'CODE_EXHAUSTED'), failed.filter((code) => code !== 'CODE_EXHAUSTED').join(','));
  });

  // ---- 清理与协议 ----

  test('清理：超过 7 天的兑换尝试被删除，7 天内的保留', async () => {
    const id = await newAccount('purge');
    await redeem(id, generateRedeemCode());
    await pool.query(`INSERT INTO redeem_attempts (account_id, attempted_at, ok) VALUES ($1, $2, false)`, [
      id,
      new Date(NOW.getTime() - 8 * 24 * 3600 * 1000),
    ]);
    const deleted = await purgeRedeemAttempts(pool, NOW);
    assert.ok(deleted >= 1);
    assert.equal((await countRecentFailures(pool, id, NOW)).count, 1, '7 天内的那次仍在');
  });

  test('协议 REDEEM_CODE：玩家与 Agent 都能调用（码是本人的）；非字符串参数 → INVALID_PARAMS', async () => {
    const player = await newAccount('op-player');
    const agent = await newAccount('op-agent');
    const { codes } = await newBatch({ count: 2, rewards: { ingot: 7, items: [{ itemId: 'city_order_adv', count: 1 }] } });
    const playerFrame = await callAs(player, Op.REDEEM_CODE, { code: formatRedeemCode(codes[0]) }, 'player');
    assert.equal(playerFrame.ok, true);
    assert.deepEqual(playerFrame.data?.rewards, { ingot: 7, items: [{ itemId: 'city_order_adv', count: 1 }] });
    assert.equal(playerFrame.data?.ingot, 7);
    assert.deepEqual(playerFrame.data?.items, { city_order: 0, city_order_adv: 1 });
    // Agent 会话（role = agent）同样可以兑换
    const agentFrame = await callAs(agent, Op.REDEEM_CODE, { code: codes[1] }, 'agent');
    assert.equal(agentFrame.ok, true);
    assert.equal(agentFrame.data?.ingot, 7);
    // 参数校验
    const bad = await callAs(player, Op.REDEEM_CODE, { code: 12345 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error?.code, 'INVALID_PARAMS');
    // Agent 的回调也可兑（同上，防刷靠失败次数）
    const event = await eventsOf(agent, 'code_redeemed');
    assert.equal(event.length, 1);
  });

  test('换季：福利元宝保留、福利道具清空，兑换记录与批次跨季保留（同一批次不能重领）', async () => {
    const id = await newAccount('season');
    const { batchId, codes } = await newBatch({ count: 2, rewards: { ingot: 300, items: [{ itemId: 'city_order', count: 2 }] } });
    assert.equal((await redeem(id, codes[0])).ok, true);
    assert.equal(await loadIngot(pool, id), 300);
    assert.equal((await loadItems(pool, id)).city_order, 2);

    await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
    const outcome = await runSeasonReset(pool);
    assert.equal(outcome.status, 'reset');

    assert.equal(await loadIngot(pool, id), 300, '福利元宝换季不清零');
    assert.equal((await loadItems(pool, id)).city_order, 0, '福利道具（paid_count = 0）换季清空');
    const claims = await pool.query(`SELECT count(*) AS count FROM redeem_claims WHERE batch_id = $1`, [batchId]);
    assert.equal(Number(claims.rows[0].count), 1, '兑换记录跨季保留');
    assert.equal((await listRedeemCodes(pool, batchId)).length, 2, '码跨季保留');
    // 换季后同一个账号仍然领不了这一批，另一个账号还能用那个码
    assert.deepEqual(await redeem(id, codes[1]), { ok: false, code: 'CODE_BATCH_CLAIMED' });
    const other = await newAccount('season-other');
    assert.equal((await redeem(other, codes[1])).ok, true);
  });
});