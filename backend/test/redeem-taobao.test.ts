// 淘宝渠道配套（AISLG-255）：渠道标记、export --unused 的口径、lookup 各状态与用户名打码、
// void 各分支、stats 的 UTC+8 分日汇总、void 与兑换的并发（30 轮），以及两个新列的迁移幂等。
// 直接调用 redeem-db.ts / redeem-ops-db.ts 里新增的导出函数（与运营脚本共用同一份实现，不另起子进程）。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（临时集群，测试在其中新建独立库），否则跳过。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import {
  channelRedeemStats,
  createRedeemBatch,
  disableRedeemBatch,
  listRedeemBatches,
  listRedeemCodes,
  lookupRedeemCode,
  redeemCode,
  voidRedeemCode,
  voidRedeemCodes,
  type CreateRedeemBatchInput,
} from '../common/src/redeem-db';
import {
  REDEEM_CHANNEL_MAX,
  formatRedeemCode,
  formatUtc8DateTime,
  maskUsername,
  normalizeRedeemChannel,
} from '../common/src/redeem-code';
import { insertAccountWithCity } from '../api/src/auth';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

/** 每个用例用自己的渠道，stats 按渠道汇总时才不会互相污染（渠道最长 20 个字符） */
function channelOf(label: string): string {
  // 渠道最长 20 个字符：tb- + 最多 10 个字符的标签 + - + 4 位随机
  return `tb-${label.slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

describe('淘宝券号渠道配套（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `taobao-${Date.now()}`;
  /** 大多数用例的“现在”（UTC）：2026-11-01 08:00 */
  const NOW = new Date('2026-11-01T08:00:00Z');

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
      const created = await insertAccountWithCity(client, {
        username: `${tag}-${name}`,
        passwordHash: 'x',
        signupIp: null,
      });
      return created.id;
    });
  }

  async function newBatch(
    input: Partial<CreateRedeemBatchInput> & { count?: number },
  ): Promise<{ batchId: string; codes: string[] }> {
    return inTx((client) =>
      createRedeemBatch(client, {
        name: `${tag}-batch`,
        kind: 'single',
        rewards: { ingot: 1000 },
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

  before(async () => {
    db = await createTempDatabase(dbUrl as string, 'taobao');
    pool = new pg.Pool({ connectionString: db.url, max: 16 });
    await ensureSchema(pool);
    await ensureWorld(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ---- 渠道 ----

  test('渠道校验：只允许字母、数字与连字符，最长 20 个字符，统一存小写', () => {
    assert.equal(normalizeRedeemChannel('taobao'), 'taobao');
    assert.equal(normalizeRedeemChannel('  Taobao  '), 'taobao');
    assert.equal(normalizeRedeemChannel('tb-2026-01'), 'tb-2026-01');
    assert.equal(normalizeRedeemChannel('a'.repeat(REDEEM_CHANNEL_MAX)), 'a'.repeat(REDEEM_CHANNEL_MAX));
    assert.equal(normalizeRedeemChannel('a'.repeat(REDEEM_CHANNEL_MAX + 1)), null);
    assert.equal(normalizeRedeemChannel(''), null);
    assert.equal(normalizeRedeemChannel('   '), null);
    assert.equal(normalizeRedeemChannel('tb_1'), null);
    assert.equal(normalizeRedeemChannel('淘宝'), null);
    assert.equal(normalizeRedeemChannel('tb 1'), null);
  });

  test('create 带渠道：落库为小写，list 里能读到；非法渠道直接报错', async () => {
    const channel = channelOf('create');
    const { batchId } = await newBatch({ count: 1, channel: channel.toUpperCase() });
    const summary = (await listRedeemBatches(pool)).find((row) => row.id === batchId);
    assert.ok(summary);
    assert.equal(summary.channel, channel);
    assert.equal(summary.voidedCount, 0);
    // 老批次（253 建的）没有渠道
    const legacy = await newBatch({ count: 1 });
    assert.equal((await listRedeemBatches(pool)).find((row) => row.id === legacy.batchId)?.channel, null);
    // 参数校验：入库前就拦住
    await assert.rejects(() => newBatch({ count: 1, channel: 'tb_1' }), /渠道只允许字母、数字与连字符/);
    await assert.rejects(() => newBatch({ count: 1, channel: 'a'.repeat(21) }), /渠道只允许/);
  });

  test('迁移幂等：建表函数连跑两次不报错，两个新列都存在', async () => {
    await ensureSchema(pool);
    await ensureSchema(pool);
    const res = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name = 'redeem_batches' AND column_name = 'channel')
          OR (table_name = 'redeem_codes' AND column_name = 'voided_at')
       ORDER BY table_name`,
    );
    assert.deepEqual(
      res.rows.map((row) => `${row.table_name}.${row.column_name}`),
      ['redeem_batches.channel', 'redeem_codes.voided_at'],
    );
  });

  // ---- 导出 ----

  test('export：码都是 XXXX-XXXX-XXXX-XXXX；--unused 排除已兑换与已作废（10 - 3 - 2 = 5）', async () => {
    const { batchId, codes } = await newBatch({ count: 10, channel: channelOf('export') });
    const accounts = await Promise.all([0, 1, 2].map((i) => newAccount(`export-${i}`)));
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await redeem(accounts[i], codes[i])).ok, true);
    }
    const voided = await voidRedeemCodes(pool, [codes[3], codes[4]], NOW);
    assert.deepEqual(
      voided.map((outcome) => outcome.status),
      ['voided', 'voided'],
    );

    const all = await listRedeemCodes(pool, batchId);
    assert.equal(all.length, 10, '不带 --unused 时导出全部码');
    const unused = await listRedeemCodes(pool, batchId, { unused: true });
    assert.equal(unused.length, 5);
    assert.ok(unused.every((code) => !codes.slice(0, 5).includes(code)), '已兑换 / 已作废的码不应出现');
    // txt 每行就是券号本身：带横线的显示格式，没有表头、没有引号、不带批次信息
    for (const code of unused) {
      const line = formatRedeemCode(code);
      assert.match(line, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      assert.ok(!/[,;"]/.test(line));
      assert.equal(line.length, 19);
    }
  });

  // ---- lookup ----

  test('lookup：未兑换 / 不存在 / 格式不对', async () => {
    const { codes } = await newBatch({ count: 1, channel: channelOf('lookup-unused') });
    const found = await lookupRedeemCode(pool, formatRedeemCode(codes[0]).toLowerCase(), NOW);
    assert.ok(found);
    assert.equal(found.state, 'unused');
    assert.deepEqual(found.states, ['unused']);
    assert.equal(found.claimedAt, null);
    assert.equal(found.maskedUsername, null);
    assert.equal(await lookupRedeemCode(pool, 'ABCD-1234', NOW), null, '长度不对 → 不存在');
    assert.equal(await lookupRedeemCode(pool, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', NOW), null, '字符集外的码 → 不存在');
  });

  test('lookup：已兑换显示兑换时间与打码用户名（绝不出现完整用户名），并带上批次名 / 渠道 / 奖励', async () => {
    const channel = channelOf('lookup-claimed');
    const { batchId, codes } = await newBatch({ count: 1, channel, rewards: { ingot: 1000 } });
    const accountId = await newAccount('lookup-claimed-user-long');
    assert.equal((await redeem(accountId, codes[0])).ok, true);

    const found = await lookupRedeemCode(pool, codes[0], NOW);
    assert.ok(found);
    assert.equal(found.state, 'claimed');
    assert.equal(found.batch.id, batchId);
    assert.equal(found.batch.channel, channel);
    assert.deepEqual(found.batch.rewards, { ingot: 1000 });
    assert.equal(found.claimedAt?.toISOString(), NOW.toISOString());
    assert.equal(found.claimCount, 1);
    const username = `${tag}-lookup-claimed-user-long`;
    assert.equal(found.maskedUsername, maskUsername(username));
    assert.ok(!found.maskedUsername?.includes(username), '不能出现完整用户名');
    assert.equal(found.maskedUsername, `${username.slice(0, 2)}${'*'.repeat(username.length - 4)}${username.slice(-2)}`);
    // 查询输出（JSON 化）里也不能出现完整用户名
    assert.ok(!JSON.stringify(found).includes(username));
  });

  test('lookup：已作废 / 批次已停用 / 已过期，以及多状态时的优先级', async () => {
    const { batchId, codes } = await newBatch({ count: 3, channel: channelOf('lookup-states') });
    const accountId = await newAccount('lookup-states');
    // 第 1 个码：已兑换后批次停用 → 优先级「已兑换 > 批次已停用」
    assert.equal((await redeem(accountId, codes[0])).ok, true);
    await voidRedeemCodes(pool, [codes[1]], NOW);
    assert.equal(await disableRedeemBatch(pool, batchId), true);
    const claimed = await lookupRedeemCode(pool, codes[0], NOW);
    assert.ok(claimed);
    assert.equal(claimed.state, 'claimed');
    assert.deepEqual(claimed.states, ['claimed', 'disabled']);
    const voided = await lookupRedeemCode(pool, codes[1], NOW);
    assert.ok(voided);
    assert.equal(voided.state, 'voided');
    assert.ok(voided.states.includes('disabled'));
    assert.ok(voided.voidedAt);
    const plain = await lookupRedeemCode(pool, codes[2], NOW);
    assert.ok(plain);
    assert.equal(plain.state, 'disabled');

    // 过期：now 超过批次过期时间
    const expiring = await newBatch({ count: 1, expiresAt: new Date(NOW.getTime() + 1000) });
    const expired = await lookupRedeemCode(pool, expiring.codes[0], new Date(NOW.getTime() + 2000));
    assert.ok(expired);
    assert.equal(expired.state, 'expired');
    assert.equal((await lookupRedeemCode(pool, expiring.codes[0], new Date(NOW.getTime() + 999)))?.state, 'unused');
  });

  test('用户名打码规则：前 2 位 + 至少 2 个 * + 后 2 位；不足 4 位只留第 1 位', () => {
    assert.equal(maskUsername('ab'), 'a*');
    assert.equal(maskUsername('abc'), 'a**');
    assert.equal(maskUsername('abcd'), 'ab**cd');
    assert.equal(maskUsername('abcdef'), 'ab**ef');
    assert.equal(maskUsername('abcdefgh'), 'ab****gh');
    assert.equal(maskUsername(''), '*');
    assert.equal(maskUsername('a'), '*', '只有一个字符时留着就等于公开');
    // 任何长度下都不返回完整用户名
    for (const name of ['a', 'ab', 'abc', 'abcd', 'abcde', 'zhangsan', '云天游客服小王']) {
      assert.notEqual(maskUsername(name), name, `${name} 被打码后不应原样输出`);
    }
  });

  // ---- void ----

  test('void：未兑换作废成功后兑换返回 CODE_INVALID；已兑换的不能作废；不存在 / 本来就已作废', async () => {
    const { codes } = await newBatch({ count: 3, channel: channelOf('void') });
    const voucher = await newAccount('void-voucher');
    const buyer = await newAccount('void-buyer');
    assert.equal((await redeem(buyer, codes[0])).ok, true);

    const missing = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ';
    const outcomes = await voidRedeemCodes(pool, [codes[1], codes[0], missing, codes[1]], NOW);
    const [voided, claimed, notFound, again] = outcomes;
    assert.equal(voided.status, 'voided');
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.status === 'claimed' ? claimed.claimedAt.getTime() : 0, NOW.getTime(), '已兑换要显示兑换时间');
    assert.equal(notFound.status, 'not_found');
    assert.equal(again.status, 'already_voided', '重复作废不报错');
    assert.equal(again.status === 'already_voided' ? again.voidedAt.getTime() : 0, NOW.getTime());

    // 作废之后：兑换返回 CODE_INVALID（并记一次失败尝试）
    assert.deepEqual(await redeem(voucher, codes[1]), { ok: false, code: 'CODE_INVALID' });
    // 已兑换的码不能作废，元宝也不收回；批次里剩下的码照常能兑
    assert.equal((await redeem(voucher, codes[2])).ok, true);
  });

  test('void：批量时已兑换的不影响其余码；作废后 export --unused 不含它、list 的已作废数 +1', async () => {
    const { batchId, codes } = await newBatch({ count: 4, channel: channelOf('void-batch') });
    const buyer = await newAccount('void-batch-buyer');
    assert.equal((await redeem(buyer, codes[0])).ok, true);
    assert.equal((await redeem(await newAccount('void-batch-buyer-2'), codes[1])).ok, true);

    const outcomes = await voidRedeemCodes(pool, codes, NOW);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ['claimed', 'claimed', 'voided', 'voided'],
    );
    const unused = await listRedeemCodes(pool, batchId, { unused: true });
    assert.deepEqual(unused, []);
    assert.equal((await listRedeemCodes(pool, batchId)).length, 4, '不带 --unused 仍列出作废的码');
    assert.equal((await listRedeemBatches(pool)).find((row) => row.id === batchId)?.voidedCount, 2);
  });

  // ---- stats ----

  test('stats：按 UTC+8 自然日汇总（跨 UTC 午夜但同一北京日合并、跨北京日分开），末行合计', async () => {
    const channel = channelOf('stats');
    const { codes } = await newBatch({ count: 4, channel, rewards: { ingot: 1000 } });
    const accounts = await Promise.all([0, 1, 2, 3].map((i) => newAccount(`stats-${i}`)));
    // 两条跨 UTC 午夜、但同属北京 11-02：UTC 11-01 23:30 / UTC 11-02 00:30
    assert.equal((await redeem(accounts[0], codes[0], new Date('2026-11-01T23:30:00Z'))).ok, true);
    assert.equal((await redeem(accounts[1], codes[1], new Date('2026-11-02T00:30:00Z'))).ok, true);
    // 两条跨北京日：北京 11-03 23:59 与 11-04 00:01（UTC 11-03 15:59 / 16:01）
    assert.equal((await redeem(accounts[2], codes[2], new Date('2026-11-03T15:59:00Z'))).ok, true);
    assert.equal((await redeem(accounts[3], codes[3], new Date('2026-11-03T16:01:00Z'))).ok, true);

    const stats = await channelRedeemStats(pool, { channel, since: null, until: null });
    assert.deepEqual(stats.days, [
      { day: '2026-11-02', claims: 2, ingot: 2000 },
      { day: '2026-11-03', claims: 1, ingot: 1000 },
      { day: '2026-11-04', claims: 1, ingot: 1000 },
    ]);
    assert.equal(stats.totalClaims, 4);
    assert.equal(stats.totalIngot, 4000);
    assert.equal(stats.batchCount, 1);
    assert.equal(stats.codeCount, 4);
    assert.equal(stats.claimedCount, 4);
    assert.equal(stats.voidedCount, 0, '4 个码全都兑换了，没有可作废的');
    assert.equal(stats.unusedCount, 0);

    // --since / --until 含边界
    const window = await channelRedeemStats(pool, { channel, since: '2026-11-03', until: '2026-11-03' });
    assert.deepEqual(window.days, [{ day: '2026-11-03', claims: 1, ingot: 1000 }]);
    assert.equal(window.totalClaims, 1, '合计只算窗口内的');
    assert.equal(window.codeCount, 4, '渠道总量不受日期窗口限制');
    // 别的渠道不受影响
    const other = await channelRedeemStats(pool, { channel: channelOf('stats-other'), since: null, until: null });
    assert.deepEqual(other.days, []);
    assert.equal(other.batchCount, 0);
  });

  test('stats：未兑换数 / 已作废数与库里的码对得上；奖励里没有元宝的批次折合 0', async () => {
    const channel = channelOf('stats-unused');
    const { codes } = await newBatch({ count: 3, channel, rewards: { ingot: 1000 } });
    const itemBatch = await newBatch({ count: 1, channel, rewards: { items: [{ itemId: 'city_order', count: 1 }] } });
    assert.equal((await redeem(await newAccount('stats-unused'), codes[0])).ok, true);
    assert.equal((await redeem(await newAccount('stats-unused-2'), itemBatch.codes[0])).ok, true);
    await voidRedeemCodes(pool, [codes[1]], NOW);

    const stats = await channelRedeemStats(pool, { channel, since: null, until: null });
    assert.equal(stats.batchCount, 2);
    assert.equal(stats.codeCount, 4);
    assert.equal(stats.claimedCount, 2);
    assert.equal(stats.voidedCount, 1);
    assert.equal(stats.unusedCount, 1);
    assert.equal(stats.totalClaims, 2);
    assert.equal(stats.totalIngot, 1000, '只有元宝奖励计入折合元宝');
  });

  // ---- 并发 ----

  test('并发：同一个码同时 void 与兑换，恰好一个成功（30 轮）', async () => {
    for (let round = 0; round < 30; round += 1) {
      const accountId = await newAccount(`race-${round}`);
      const { codes } = await newBatch({ count: 1, channel: channelOf('race'), rewards: { ingot: 10 } });
      const code = codes[0];
      const [redeemed, voidOutcome] = await Promise.all([
        redeemCode(pool, { accountId, code, now: NOW }),
        inTx((client) => voidRedeemCode(client, code, NOW)),
      ]);
      if (redeemed.ok) {
        assert.equal(voidOutcome.status, 'claimed', `第 ${round} 轮：兑换成功后作废应返回已被兑换`);
      } else {
        assert.deepEqual(redeemed, { ok: false, code: 'CODE_INVALID' }, `第 ${round} 轮：作废成功后兑换应无效`);
        assert.equal(voidOutcome.status, 'voided', `第 ${round} 轮：兑换失败后作废应成功`);
      }
      // 库里的落点与结果一致：要么有 claim，要么 voided_at 非空，不会两者都有
      const row = await pool.query(
        `SELECT c.voided_at, (SELECT count(*) FROM redeem_claims cl WHERE cl.code = c.code) AS claims
         FROM redeem_codes c WHERE c.code = $1`,
        [code],
      );
      const state = row.rows[0] as { voided_at: Date | null; claims: string };
      assert.equal(Number(state.claims) + (state.voided_at ? 1 : 0), 1, `第 ${round} 轮：两者不能都发生`);
    }
  });

  test('时间格式：兑换时间按 UTC+8 显示为 YYYY-MM-DD HH:MM:SS', () => {
    assert.equal(formatUtc8DateTime(new Date('2026-11-11T07:30:12Z')), '2026-11-11 15:30:12');
    assert.equal(formatUtc8DateTime(new Date('2026-11-11T16:00:00Z')), '2026-11-12 00:00:00');
  });
});