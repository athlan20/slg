// 充值联调（AISLG-251，v108）：真实 API 进程 + 假支付渠道（验签同 Creem）+ PostgreSQL，
// 走完整的 CREATE_TOPUP → 签名回调 → GET_STATE 链路，覆盖验收口径 1–3、5（元宝购买）、7（退款）。
// 运行（需要 DATABASE_URL 指向可写的**临时**库，见 test/README.md；别指向共用开发库）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:17251/slg npm run test:pay
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadOrderRow, Op, postWebhook, signWebhook, startHarness, type Harness } from './harness';
import { seedAccount } from '../account-seed';

const API_PORT = 18108;
const DB_URL = process.env.DATABASE_URL;
const PASSWORD = 'e2e-pass-251';
const RUN_ID = Date.now().toString(36);

let harness: Harness;
let disabledHarness: Harness;

before(async () => {
  if (DB_URL) {
    harness = await startHarness({ apiPort: API_PORT });
    disabledHarness = await startHarness({ apiPort: API_PORT + 1, paymentsEnabled: false });
  }
});

after(() => {
  harness?.stop();
  disabledHarness?.stop();
});

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过充值联调' };

/** 预建账号 → 密码登录 → 返回玩家连接 */
async function loginPlayer(who: string) {
  const username = `pay_${who}_${RUN_ID}`;
  await seedAccount(username, PASSWORD);
  const client = await harness.connect();
  const login = await client.call(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
  assert.ok(login.ok, JSON.stringify(login));
  return { client, username, accountId: login.data?.accountId as string };
}

async function ingotOf(client: { call: (op: number, data?: Record<string, unknown>) => Promise<any> }): Promise<number> {
  const state = await client.call(Op.GET_STATE);
  assert.ok(state.ok, JSON.stringify(state));
  return state.data?.ingot as number;
}

/** checkout.completed 回调体（Creem 结构；product.id 用假渠道认的我们的商品 id） */
function checkoutCompletedBody(eventId: string, orderId: string, amountPaid = 216): string {
  return JSON.stringify({
    id: eventId,
    eventType: 'checkout.completed',
    created_at: new Date().toISOString(),
    object: {
      request_id: orderId,
      metadata: { orderId },
      order: { amount_paid: amountPaid, amount: 199, currency: 'USD' },
      product: { id: 'topup_199' },
    },
  });
}

test('买 1 次：CREATE_TOPUP → 签名回调 → GET_STATE.ingot +1000，订单为 paid', opts, async () => {
  const { client } = await loginPlayer('buy');
  assert.equal(await ingotOf(client), 0);

  const created = await client.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  assert.ok(created.ok, JSON.stringify(created));
  const { orderId, checkoutUrl, usdCents, ingot } = created.data as {
    orderId: string;
    checkoutUrl: string;
    usdCents: number;
    ingot: number;
  };
  assert.equal(usdCents, 199);
  assert.equal(ingot, 1000);
  assert.match(checkoutUrl, /^https:\/\/fake\.creem\.local\/checkout\//);

  const body = checkoutCompletedBody(`evt-buy-${RUN_ID}`, orderId);
  const response = await postWebhook(API_PORT, body);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, 'credited');

  // 服务端入账后推一次 ingot_changed（推给该账号全部在线连接）
  const push = await client.waitPush((frame) => frame.push === true && frame.data?.reason === 'ingot_changed');
  assert.equal(push.data?.ingot, 1000);
  assert.equal(await ingotOf(client), 1000);
  const order = await loadOrderRow(DB_URL as string, orderId);
  assert.equal(order?.status, 'paid');
  assert.equal(order?.ingot_amount, 1000);
});

test('同一个回调重复发送 3 次：只入账一次', opts, async () => {
  const { client } = await loginPlayer('dup');
  const created = await client.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  const { orderId } = created.data as { orderId: string };
  const body = checkoutCompletedBody(`evt-dup-${RUN_ID}`, orderId);
  for (let i = 0; i < 3; i += 1) {
    const response = await postWebhook(API_PORT, body);
    assert.equal(response.status, 200);
  }
  assert.equal(await ingotOf(client), 1000, '只入账一次');
  assert.equal((await loadOrderRow(DB_URL as string, orderId))?.status, 'paid');
});

test('篡改签名 / 缺少签名：400，不入账', opts, async () => {
  const { client } = await loginPlayer('sig');
  const created = await client.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  const { orderId } = created.data as { orderId: string };
  const body = checkoutCompletedBody(`evt-sig-${RUN_ID}`, orderId);

  const tampered = await postWebhook(API_PORT, body, { signature: signWebhook(`${body} `) });
  assert.equal(tampered.status, 400);
  const missing = await postWebhook(API_PORT, body, { signature: null });
  assert.equal(missing.status, 400);
  assert.equal(await ingotOf(client), 0, '签名不对一律不处理');
  assert.equal((await loadOrderRow(DB_URL as string, orderId))?.status, 'pending');
});

test('用元宝买高级迁城令：扣 100 元宝；礼金不够时选元宝仍成功，缺省按礼金', opts, async () => {
  const { client } = await loginPlayer('item');
  const created = await client.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  const { orderId } = created.data as { orderId: string };
  await postWebhook(API_PORT, checkoutCompletedBody(`evt-item-${RUN_ID}`, orderId));

  const catalog = await client.call(Op.GET_ITEMS, {});
  const entry = (catalog.data as { catalog: Array<{ id: string; ingotPrice: number | null }> }).catalog.find(
    (def) => def.id === 'city_order_adv',
  );
  assert.equal(entry?.ingotPrice, 100);

  const bought = await client.call(Op.BUY_ITEM, {
    itemId: 'city_order_adv',
    count: 1,
    expectedPrice: entry?.ingotPrice,
    currency: 'ingot',
  });
  assert.ok(bought.ok, JSON.stringify(bought));
  assert.equal((bought.data as { ingot: number }).ingot, 900);
  assert.equal((bought.data as { paidCount: number }).paidCount, 1);
  assert.equal(await ingotOf(client), 900);

  // 元宝 99 时再买：INSUFFICIENT_INGOT，余额与背包都不变
  await client.call(Op.BUY_ITEM, { itemId: 'city_order_adv', count: 9, expectedPrice: 100, currency: 'ingot' });
  const short = await client.call(Op.BUY_ITEM, { itemId: 'city_order_adv', count: 1, expectedPrice: 100, currency: 'ingot' });
  // 9 张 = 900 元宝，正好花光；随后 1 张不够
  assert.equal(short.error?.code, 'INSUFFICIENT_INGOT');
  assert.equal(await ingotOf(client), 0);

  // 缺省 currency 按礼金付（旧客户端行为不变）
  const giftBuy = await client.call(Op.BUY_ITEM, { itemId: 'city_order', count: 1, expectedPrice: 50 });
  assert.ok(giftBuy.ok, JSON.stringify(giftBuy));
  assert.equal((giftBuy.data as { currency: string }).currency, 'gift');
  assert.equal(await ingotOf(client), 0);
});

test('整单退款：元宝减少 1000，订单 refunded；后台手动重发已入账的成功回调不重复入账', opts, async () => {
  const { client } = await loginPlayer('refund');
  const created = await client.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  const { orderId } = created.data as { orderId: string };
  await postWebhook(API_PORT, checkoutCompletedBody(`evt-refund-a-${RUN_ID}`, orderId));
  assert.equal(await ingotOf(client), 1000);

  // 后台手动重发（新事件 id）：订单已 paid，不再入账
  const resent = await postWebhook(API_PORT, checkoutCompletedBody(`evt-refund-a2-${RUN_ID}`, orderId));
  assert.equal(resent.status, 200);
  assert.equal(resent.body.ignored, 'status_paid');
  assert.equal(await ingotOf(client), 1000);

  const refundBody = JSON.stringify({
    id: `evt-refund-b-${RUN_ID}`,
    eventType: 'refund.created',
    object: {
      refund_amount: 216,
      transaction: { amount_paid: 216 },
      checkout: { request_id: orderId, metadata: { orderId } },
    },
  });
  const refund = await postWebhook(API_PORT, refundBody);
  assert.equal(refund.status, 200);
  assert.equal(refund.body.status, 'refunded');
  assert.equal(await ingotOf(client), 0);
  assert.equal((await loadOrderRow(DB_URL as string, orderId))?.status, 'refunded');
});

test('没配置支付渠道：CREATE_TOPUP 返回 TOPUP_UNAVAILABLE、回调 503，礼金买道具正常', opts, async () => {
  const username = `pay_off_${RUN_ID}`;
  await seedAccount(username, PASSWORD);
  const client = await disabledHarness.connect();
  const login = await client.call(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
  assert.ok(login.ok);
  const created = await client.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  assert.equal(created.error?.code, 'TOPUP_UNAVAILABLE');
  const response = await postWebhook(API_PORT + 1, checkoutCompletedBody(`evt-off-${RUN_ID}`, 'x'));
  assert.equal(response.status, 503);
  const bought = await client.call(Op.BUY_ITEM, { itemId: 'city_order', count: 1, expectedPrice: 50 });
  assert.ok(bought.ok, JSON.stringify(bought));
});

test('Agent 令牌会话调用 CREATE_TOPUP 被拒（AGENT_FORBIDDEN）', opts, async () => {
  const username = `pay_agent_${RUN_ID}`;
  await seedAccount(username, PASSWORD);
  const player = await harness.connect();
  const login = await player.call(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
  assert.ok(login.ok);
  const token = (await player.call(Op.GET_AGENT_TOKEN)).data?.token as string;
  assert.match(token, /^sk_/);
  const agent = await harness.connect();
  const agentLogin = await agent.call(Op.LOGIN, { token, asAgent: true });
  assert.ok(agentLogin.ok, JSON.stringify(agentLogin));
  const created = await agent.call(Op.CREATE_TOPUP, { productId: 'topup_199' });
  assert.equal(created.error?.code, 'AGENT_FORBIDDEN');
  // Agent 仍能在 GET_STATE 看到 ingot
  const state = await agent.call(Op.GET_STATE);
  assert.equal(typeof state.data?.ingot, 'number');
});