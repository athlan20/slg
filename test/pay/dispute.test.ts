// 拒付联调（AISLG-251，v108）：真实 API 进程 + 假支付渠道（验签同 Creem）+ PostgreSQL。
// 拒付回调按 Creem 文档示例的形状发（object.checkout 只有 id、object、product、units、custom_fields、status、mode，
// 没有 request_id 与 metadata），所以订单只能靠 checkout.id（provider_checkout_id）找到。
// 运行（需要 DATABASE_URL 指向可写的**临时**库，见 test/README.md；别指向共用开发库）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:17251/slg npm run test:pay
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadOrderRow, Op, postWebhook, startHarness, type Harness } from './harness';
import { seedAccount } from '../account-seed';

const API_PORT = 18110;
const DB_URL = process.env.DATABASE_URL;
const PASSWORD = 'e2e-dispute-251';
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

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过拒付联调' };

/** 预建账号 → 密码登录 → 返回玩家连接 */
async function loginPlayer(who: string) {
  const username = `dispute_${who}_${RUN_ID}`;
  await seedAccount(username, PASSWORD);
  const client = await harness.connect();
  const login = await client.call(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
  assert.ok(login.ok, JSON.stringify(login));
  return client;
}

/** GET_ITEMS 同时返回背包、礼金与元宝 */
async function balancesOf(client: { call: (op: number, data?: Record<string, unknown>) => Promise<any> }) {
  const res = await client.call(Op.GET_ITEMS, {});
  assert.ok(res.ok, JSON.stringify(res));
  return {
    ingot: res.data?.ingot as number,
    gift: res.data?.gift as number,
    cityOrder: (res.data?.items as Record<string, number>).city_order ?? 0,
  };
}

test('拒付（文档示例形状，无 request_id / metadata）：元宝整单回收，订单 refunded，礼金与道具不动', opts, async () => {
  const client = await loginPlayer('chargeback');
  const created = await client.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  assert.ok(created.ok, JSON.stringify(created));
  const { orderId } = created.data as { orderId: string };

  // 先入账（checkout.completed 带 request_id，与线上一致）
  const paid = await postWebhook(
    API_PORT,
    JSON.stringify({
      id: `evt-cb-paid-${RUN_ID}`,
      eventType: 'checkout.completed',
      object: {
        request_id: orderId,
        metadata: { orderId },
        order: { id: `ord_cb_${RUN_ID}`, amount_paid: 216, amount: 199, currency: 'USD' },
        product: { id: 'topup_199' },
      },
    }),
  );
  assert.equal(paid.body.status, 'credited', JSON.stringify(paid.body));
  assert.equal((await balancesOf(client)).ingot, 1000);

  // 拒付：只带 checkout.id（假渠道的结账会话 id 约定为 fake_checkout_<订单 id>，与 CREATE_TOPUP 写入的一致）
  const before = await balancesOf(client);
  const dispute = await postWebhook(
    API_PORT,
    JSON.stringify({
      id: `evt-cb-dispute-${RUN_ID}`,
      eventType: 'dispute.created',
      created_at: new Date().toISOString(),
      object: {
        id: `dispute_${RUN_ID}`,
        object: 'dispute',
        amount: 199,
        currency: 'USD',
        checkout: {
          id: `fake_checkout_${orderId}`,
          object: 'checkout',
          product: 'topup_199',
          units: 1,
          custom_fields: {},
          status: 'completed',
          mode: 'test',
        },
      },
    }),
  );
  assert.equal(dispute.status, 200, JSON.stringify(dispute.body));
  assert.equal(dispute.body.status, 'refunded', JSON.stringify(dispute.body));
  assert.equal(dispute.body.orderId, orderId);

  const after = await balancesOf(client);
  assert.equal(after.ingot, 0, '元宝整单回收');
  assert.equal(after.gift, before.gift, '礼金不动');
  assert.equal(after.cityOrder, before.cityOrder, '道具不动');
  const order = await loadOrderRow(DB_URL as string, orderId);
  assert.equal(order?.status, 'refunded');
  assert.equal(order?.clawback_short, 0);
});
