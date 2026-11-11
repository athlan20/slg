// 淘宝券号渠道配套联调（AISLG-255）：真实 API 进程 + 真实运营脚本（子进程跑 backend/scripts/redeem-codes.ts）
// + PostgreSQL，走完整链路：脚本 create --channel taobao → export --format txt → 玩家 REDEEM_CODE →
// 脚本 lookup / void / stats（验收口径 1~5）。
// 运行（需要 DATABASE_URL 指向可写的**临时**库，见 test/README.md；别指向共用开发库）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:17253/slg npm run test:redeem
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Op, createBatch, runScript, runScriptResult, startHarness, type Frame, type Harness, type WsClient } from './harness';
import { seedAccount } from '../account-seed';

const API_PORT = 18110;
const DB_URL = process.env.DATABASE_URL;
const PASSWORD = 'e2e-pass-255';
const RUN_ID = Date.now().toString(36);
/** 渠道最长 20 个字符：taobao- + 8 位左右的运行号（对账按渠道汇总，联调也要用独占的渠道） */
const CHANNEL = `taobao-${RUN_ID}`;

let harness: Harness;

before(async () => {
  if (DB_URL) {
    harness = await startHarness({ apiPort: API_PORT });
  }
});

after(() => {
  harness?.stop();
});

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过淘宝券号联调' };

type Client = WsClient;

/** 预建账号 → 密码登录 → 返回玩家连接与账号 id */
async function loginPlayer(who: string): Promise<{ client: Client; username: string; accountId: string }> {
  const username = `taobao_${who}_${RUN_ID}`;
  await seedAccount(username, PASSWORD);
  const client = await harness.connect();
  const login = await client.call(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
  assert.ok(login.ok, JSON.stringify(login));
  return { client, username, accountId: login.data?.accountId as string };
}

function redeem(client: Client, code: unknown): Promise<Frame> {
  return client.call(Op.REDEEM_CODE, { code }) as Promise<Frame>;
}

test('淘宝链路：脚本生成 500 个券号 → export txt → 玩家兑换 → lookup / void / stats', opts, async () => {
  // 1. 验收口径 1：create --channel taobao（生产上是 500，联调用 5 个跑快一点）
  const batch = await createBatch([
    '--name',
    `联调-淘宝-${RUN_ID}`,
    '--kind',
    'single',
    '--count',
    '5',
    '--ingot',
    '1000',
    '--channel',
    CHANNEL,
  ]);
  assert.equal(batch.codes.length, 5);
  for (const code of batch.codes) {
    assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  }
  assert.ok(batch.output.includes(`渠道：${CHANNEL}`), 'create 的输出里有渠道');

  // list 显示渠道
  const listing = await runScript(['list']);
  const row = listing.split('\n').find((line) => line.includes(batch.batchId));
  assert.ok(row?.includes(CHANNEL), `list 里应有渠道 ${CHANNEL}：${row}`);

  // 2. 验收口径 2：export --format txt 没有表头，每行一个券号
  const txt = await runScript(['export', '--batch', batch.batchId, '--format', 'txt']);
  const lines = txt.split('\n').filter((line) => line.trim() !== '');
  assert.equal(lines.length, 5);
  assert.ok(!lines.includes('code'), 'txt 不应有表头');
  assert.deepEqual([...lines].sort(), [...batch.codes].sort());
  for (const line of lines) {
    assert.match(line, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, `不该有引号 / 逗号：${line}`);
  }

  // 3. 玩家兑换两个（小写带空格也认）
  const first = await loginPlayer('first');
  const second = await loginPlayer('second');
  const lower = batch.codes[0].toLowerCase().split('-').join(' ');
  const firstResult = await redeem(first.client, lower);
  assert.ok(firstResult.ok, JSON.stringify(firstResult));
  assert.equal(firstResult.data?.ingot, 1000);
  assert.deepEqual(firstResult.data?.rewards, { ingot: 1000 });
  assert.ok((await redeem(second.client, batch.codes[1])).ok);
  // 作废掉的那个码不能兑（后面验证）

  // 4. 验收口径 3：lookup 已兑换显示兑换时间与打码用户名（不出现完整用户名）
  const claimedLookup = await runScript(['lookup', '--code', batch.codes[0]]);
  assert.ok(claimedLookup.includes('状态：已兑换'), claimedLookup);
  assert.ok(claimedLookup.includes('兑换时间：'), claimedLookup);
  assert.ok(claimedLookup.includes(`渠道：${CHANNEL}`), claimedLookup);
  assert.ok(!claimedLookup.includes(first.username), 'lookup 不能输出完整用户名');
  assert.match(claimedLookup, /兑换账号：\S*\*+\S*/);
  const unusedLookup = await runScript(['lookup', '--code', batch.codes[2]]);
  assert.ok(unusedLookup.includes('状态：未兑换'), unusedLookup);
  const missingLookup = await runScriptResult(['lookup', '--code', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ']);
  assert.equal(missingLookup.code, 1);
  assert.ok(missingLookup.stdout.includes('不存在'), missingLookup.stdout);

  // 5. 验收口径 4：void —— 已兑换的不能作废（退出码 1），未兑换的作废后 export --unused 不含它
  const claimedVoid = await runScriptResult(['void', '--code', batch.codes[0]]);
  assert.equal(claimedVoid.code, 1);
  assert.ok(claimedVoid.stdout.includes('已被兑换，不能作废'), claimedVoid.stdout);
  const voided = await runScriptResult(['void', '--code', batch.codes[2]]);
  assert.equal(voided.code, 0);
  assert.ok(voided.stdout.includes('已作废'), voided.stdout);
  const afterVoid = await redeem(await loginPlayer('after-void').then((p) => p.client), batch.codes[2]);
  assert.equal(afterVoid.ok, false);
  assert.equal(afterVoid.error?.code, 'CODE_INVALID');

  const unusedTxt = await runScript(['export', '--batch', batch.batchId, '--format', 'txt', '--unused']);
  const unusedLines = unusedTxt.split('\n').filter((line) => line.trim() !== '');
  assert.equal(unusedLines.length, 2, '5 个码里 2 个已兑换、1 个已作废，剩 2 个');
  assert.ok(!unusedLines.includes(batch.codes[2]));

  // 6. 验收口径 5：stats 按 UTC+8 自然日汇总（本渠道独占，数量能精确对上）
  const stats = await runScript(['stats', '--channel', CHANNEL]);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const dayRow = stats.split('\n').find((line) => line.startsWith(today));
  assert.ok(dayRow, `stats 里应有 UTC+8 今天 ${today} 的一行：\n${stats}`);
  const [, claims, ingot] = dayRow.trim().split(/\s+/);
  assert.equal(Number(claims), 2, `今天已兑换 2 个：${dayRow}`);
  assert.equal(Number(ingot), 2000, `折合元宝 2 × 1000：${dayRow}`);
  assert.ok(stats.includes('合计'), stats);
  assert.ok(
    stats.includes('批次总数：1　码总数：5　已兑换数：2　未兑换数：2　已作废数：1'),
    `渠道总量应对得上（5 个码 = 2 兑换 + 2 未兑换 + 1 作废）：\n${stats}`,
  );
});