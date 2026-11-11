// 兑换码联调（AISLG-253，v109）：真实 API 进程 + 真实运营脚本（子进程跑 backend/scripts/redeem-codes.ts）
// + PostgreSQL，走完整的「脚本生成码 → 玩家 WebSocket REDEEM_CODE → GET_STATE / 背包」链路。
// 覆盖验收口径 1（生成 / 导出 / list）、2（大小写与分隔符）、3（元宝 + 道具 + 事件流）、4（CODE_USED /
// 同账号兑同批多张 / 通用码 CODE_BATCH_CLAIMED 与 CODE_EXHAUSTED）、6（过期 / 停用）、7（ITEM_STACK_FULL
// 整单回滚）、8（限流）、10（Agent 令牌）。AISLG-256：一次性码只保证一码一用，同账号可兑同批多张。
// 运行（需要 DATABASE_URL 指向可写的**临时**库，见 test/README.md；别指向共用开发库）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:17253/slg npm run test:redeem
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  Op,
  countAttemptRows,
  createBatch,
  disableBatch,
  exportBatch,
  listBatches,
  startHarness,
  type Frame,
  type Harness,
  type WsClient,
} from './harness';
import { seedAccount } from '../account-seed';

const API_PORT = 18109;
const DB_URL = process.env.DATABASE_URL;
const PASSWORD = 'e2e-pass-253';
const RUN_ID = Date.now().toString(36);

let harness: Harness;

before(async () => {
  if (DB_URL) {
    harness = await startHarness({ apiPort: API_PORT });
  }
});

after(() => {
  harness?.stop();
});

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过兑换码联调' };

type Client = WsClient;

/** 预建账号 → 密码登录 → 返回玩家连接与账号 id */
async function loginPlayer(who: string): Promise<{ client: Client; username: string; accountId: string }> {
  const username = `redeem_${who}_${RUN_ID}`;
  await seedAccount(username, PASSWORD);
  const client = await harness.connect();
  const login = await client.call(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
  assert.ok(login.ok, JSON.stringify(login));
  return { client, username, accountId: login.data?.accountId as string };
}

async function stateOf(client: Client): Promise<{
  ingot: number;
  items: Record<string, number>;
}> {
  const state = await client.call(Op.GET_STATE);
  assert.ok(state.ok, JSON.stringify(state));
  return { ingot: state.data?.ingot as number, items: state.data?.items as Record<string, number> };
}

function redeem(client: Client, code: unknown): Promise<Frame> {
  return client.call(Op.REDEEM_CODE, { code }) as Promise<Frame>;
}

test('验收 1：脚本 create 100 个一次性码 → export 与 list 一致（0/100）', opts, async () => {
  const batch = await createBatch([
    '--name',
    `联调-一次性-${RUN_ID}`,
    '--kind',
    'single',
    '--count',
    '100',
    '--ingot',
    '500',
    '--item',
    'city_order:2',
  ]);
  assert.equal(batch.codes.length, 100);
  assert.equal(new Set(batch.codes).size, 100);
  for (const code of batch.codes) {
    assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.ok(!/[ILOU]/.test(code), `码里不应出现 I / L / O / U：${code}`);
  }
  const exported = await exportBatch(batch.batchId);
  assert.deepEqual([...exported].sort(), [...batch.codes].sort());
  const listing = await listBatches();
  assert.ok(listing.includes(batch.batchId), 'list 输出里应有这个批次');
  const row = listing.split('\n').find((line) => line.includes(batch.batchId));
  assert.ok(row?.includes('0/100'), `list 里应为 0/100：${row}`);
});

test('验收 2 + 3：小写带空格与横线、大写无分隔都能兑；元宝 +500、迁城令 +2，GET_STATE 与事件流同步', opts, async () => {
  const batch = await createBatch([
    '--name',
    `联调-大小写-${RUN_ID}`,
    '--kind',
    'single',
    '--count',
    '2',
    '--ingot',
    '500',
    '--item',
    'city_order:2',
  ]);
  const first = await loginPlayer('lower');
  const second = await loginPlayer('upper');

  const lower = batch.codes[0].toLowerCase().split('-').join(' ');
  const lowerResult = await redeem(first.client, ` ${lower} `);
  assert.ok(lowerResult.ok, JSON.stringify(lowerResult));
  assert.deepEqual(lowerResult.data?.rewards, { ingot: 500, items: [{ itemId: 'city_order', count: 2 }] });
  assert.equal(lowerResult.data?.ingot, 500);
  assert.deepEqual(lowerResult.data?.items, { city_order: 2, city_order_adv: 0 });

  const upperResult = await redeem(second.client, batch.codes[1].split('-').join(''));
  assert.ok(upperResult.ok, JSON.stringify(upperResult));

  const state = await stateOf(first.client);
  assert.equal(state.ingot, 500);
  assert.equal(state.items.city_order, 2);

  const events = await first.client.call(11, { limit: 50 }); // GET_EVENTS
  assert.ok(events.ok, JSON.stringify(events));
  const types = (events.data?.events as Array<{ type: string }>).map((event) => event.type);
  assert.ok(types.includes('code_redeemed'), `事件流里应有 code_redeemed：${types.join(',')}`);
  assert.ok(types.includes('ingot_granted'), `事件流里应有 ingot_granted：${types.join(',')}`);
});

test('验收 4（AISLG-256）：同账号兑同一一次性码批次的 3 张全成功、元宝累计 +600；用过的码别人再兑是 CODE_USED', opts, async () => {
  const batch = await createBatch(['--name', `联调-重复-${RUN_ID}`, '--kind', 'single', '--count', '3', '--ingot', '200']);
  const first = await loginPlayer('dup1');
  const second = await loginPlayer('dup2');

  for (const [i, code] of batch.codes.entries()) {
    const result = await redeem(first.client, code);
    assert.ok(result.ok, `第 ${i + 1} 张应当能兑：${JSON.stringify(result)}`);
  }
  assert.equal((await stateOf(first.client)).ingot, 600, '三张累计 +600');

  // 用过的码：别人再兑、本账号再兑都是 CODE_USED（不是 CODE_BATCH_CLAIMED）
  const byOther = await redeem(second.client, batch.codes[0]);
  assert.equal(byOther.error?.code, 'CODE_USED');
  const again = await redeem(first.client, batch.codes[0]);
  assert.equal(again.error?.code, 'CODE_USED');
});

test('验收 4（AISLG-256）：通用码同账号第二次 → CODE_BATCH_CLAIMED；两个账号兑完后第三个 → CODE_EXHAUSTED', opts, async () => {
  const batch = await createBatch(['--name', `联调-通用-${RUN_ID}`, '--kind', 'shared', '--max', '2', '--ingot', '10']);
  assert.equal(batch.codes.length, 1, '通用码一个批次只有一个码');
  const [first, second, third] = await Promise.all([
    loginPlayer('shared1'),
    loginPlayer('shared2'),
    loginPlayer('shared3'),
  ]);
  assert.ok((await redeem(first.client, batch.codes[0])).ok);
  const repeat = await redeem(first.client, batch.codes[0]);
  assert.equal(repeat.error?.code, 'CODE_BATCH_CLAIMED');
  assert.ok((await redeem(second.client, batch.codes[0])).ok);
  const exhausted = await redeem(third.client, batch.codes[0]);
  assert.equal(exhausted.error?.code, 'CODE_EXHAUSTED');
  assert.equal((await stateOf(first.client)).ingot, 10, '同账号只入账一次');
});

test('验收 6：过期 → CODE_EXPIRED；disable 之后 → CODE_INVALID，已领的不收回', opts, async () => {
  const expired = await createBatch([
    '--name',
    `联调-过期-${RUN_ID}`,
    '--kind',
    'single',
    '--count',
    '1',
    '--ingot',
    '10',
    '--expires',
    '2020-01-01',
  ]);
  const player = await loginPlayer('expired');
  const expiredResult = await redeem(player.client, expired.codes[0]);
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.error?.code, 'CODE_EXPIRED');

  const disabled = await createBatch(['--name', `联调-停用-${RUN_ID}`, '--kind', 'single', '--count', '2', '--ingot', '30']);
  const claimed = await redeem(player.client, disabled.codes[0]);
  assert.ok(claimed.ok, JSON.stringify(claimed));
  await disableBatch(disabled.batchId);
  const other = await loginPlayer('disabled-other');
  const afterDisable = await redeem(other.client, disabled.codes[1]);
  assert.equal(afterDisable.ok, false);
  assert.equal(afterDisable.error?.code, 'CODE_INVALID');
  assert.equal((await stateOf(player.client)).ingot, 30, '已领的元宝不收回');
});

test('验收 7：背包里迁城令已满 99 张 → 兑含 2 张的码 → ITEM_STACK_FULL，码未作废、元宝没发', opts, async () => {
  // 用奖励 99 张的批次把背包顶满（购买 99 张要刷礼金，兑一次就够）
  const fill = await createBatch([
    '--name',
    `联调-填包-${RUN_ID}`,
    '--kind',
    'single',
    '--count',
    '1',
    '--item',
    'city_order:99',
  ]);
  const stack = await loginPlayer('stack');
  const filled = await redeem(stack.client, fill.codes[0]);
  assert.ok(filled.ok, JSON.stringify(filled));
  assert.equal(filled.data?.items.city_order, 99);

  const batch = await createBatch([
    '--name',
    `联调-满包-${RUN_ID}`,
    '--kind',
    'single',
    '--count',
    '1',
    '--ingot',
    '500',
    '--item',
    'city_order:2',
  ]);
  const result = await redeem(stack.client, batch.codes[0]);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'ITEM_STACK_FULL');
  assert.equal(result.data?.itemId, 'city_order');
  assert.equal(result.data?.stackMax, 99);
  assert.equal(result.data?.have, 99);
  const state = await stateOf(stack.client);
  assert.equal(state.ingot, 0, '整单回滚：元宝也没发');
  assert.equal(state.items.city_order, 99);
});

test('验收 8：连续输错 10 次后，第 11 次（正确的码）返回 CODE_RATE_LIMITED；成功的不计入失败', opts, async () => {
  const batch = await createBatch(['--name', `联调-限流-${RUN_ID}`, '--kind', 'single', '--count', '2', '--ingot', '5']);
  const player = await loginPlayer('ratelimit');
  for (let i = 0; i < 9; i += 1) {
    const frame = await redeem(player.client, `0000-0000-0000-000${i}`);
    assert.equal(frame.error?.code, 'CODE_INVALID');
  }
  // 第 10 次是成功的正确码：不计数，所以还能继续
  const success = await redeem(player.client, batch.codes[0]);
  assert.ok(success.ok, JSON.stringify(success));
  const counts = await countAttemptRows(player.accountId);
  assert.equal(counts.ok, 1);
  assert.equal(counts.failed, 9, '成功兑换不计入失败次数');

  // 再错一次就到了上限
  const tenth = await redeem(player.client, '0000-0000-0000-0009');
  assert.equal(tenth.error?.code, 'CODE_INVALID');
  const limited = await redeem(player.client, batch.codes[1]);
  assert.equal(limited.ok, false);
  assert.equal(limited.error?.code, 'CODE_RATE_LIMITED');
  assert.ok((limited.data?.retryAfterSeconds as number) > 0);
});

test('验收 10：Agent 令牌会话可以调用 REDEEM_CODE（账号是本人的，防刷靠失败次数）', opts, async () => {
  const batch = await createBatch(['--name', `联调-Agent-${RUN_ID}`, '--kind', 'single', '--count', '1', '--ingot', '77']);
  const player = await loginPlayer('agent');
  const tokenFrame = await player.client.call(Op.GET_AGENT_TOKEN);
  assert.ok(tokenFrame.ok, JSON.stringify(tokenFrame));
  const token = tokenFrame.data?.token as string;
  assert.ok(token, '玩家应能拿到永久 Agent 令牌');

  const agent = await harness.connect();
  const login = await agent.call(Op.LOGIN, { token, asAgent: true });
  assert.ok(login.ok, JSON.stringify(login));
  assert.equal(login.data?.role, 'agent');
  const result = await redeem(agent, batch.codes[0]);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.data?.ingot, 77);
});