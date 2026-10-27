// 玩家交易所（v78，AISLG-196）：单价范围、成交金额、手续费、每日额度。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKET_FEE_PERCENT,
  MARKET_MAX_OPEN_ORDERS,
  MARKET_MIN_AMOUNT,
  MARKET_ORDER_TTL_MS,
  isPriceAllowed,
  marketAfterFee,
  marketDailyLimit,
  marketPayment,
  marketPriceRange,
  marketReferenceValue,
} from '../common/src/market';
import { setTimeScaleCache } from '../common/src/time-scale';

test('单价范围：资源 0.5–2，收金币 0.125–0.5', () => {
  assert.deepEqual(marketPriceRange('food'), { min: 0.5, max: 2 });
  assert.deepEqual(marketPriceRange('gold'), { min: 0.125, max: 0.5 });
  assert.equal(isPriceAllowed('food', 0.5), true);
  assert.equal(isPriceAllowed('food', 2), true);
  assert.equal(isPriceAllowed('food', 0.49), false);
  assert.equal(isPriceAllowed('food', 2.01), false);
  assert.equal(isPriceAllowed('gold', 0.125), true);
  assert.equal(isPriceAllowed('gold', 0.5), true);
  assert.equal(isPriceAllowed('gold', 0.1249), false);
  assert.equal(isPriceAllowed('gold', 0.51), false);
});

test('成交金额 = floor(数量 × 单价)，至少 1', () => {
  assert.equal(marketPayment(10_000, 1.2), 12_000);
  assert.equal(marketPayment(3, 0.5), 1);
  assert.equal(marketPayment(1, 0.1), 1);
});

test('手续费 5%：双方实收向下取整，差额为手续费', () => {
  const { delivered, fee } = marketAfterFee(4_000);
  assert.equal(delivered, 3_800);
  assert.equal(fee, 200);
  const small = marketAfterFee(1);
  assert.equal(small.delivered, 0);
  assert.equal(small.fee, 1);
  assert.equal(MARKET_FEE_PERCENT, 5);
});

test('参考价与额度：1 资源 = 1，金币 × 4；日额度 = 官府 × 3000 × 缩放', () => {
  assert.equal(marketReferenceValue('food', 1000), 1000);
  assert.equal(marketReferenceValue('gold', 100), 400);
  setTimeScaleCache(1);
  assert.equal(marketDailyLimit(10), 30_000);
  setTimeScaleCache(50);
  assert.equal(marketDailyLimit(10), 1_500_000);
  setTimeScaleCache(1);
});

test('常量与需求一致', () => {
  assert.equal(MARKET_MIN_AMOUNT, 1000);
  assert.equal(MARKET_MAX_OPEN_ORDERS, 5);
  assert.equal(MARKET_ORDER_TTL_MS, 48 * 3600 * 1000);
});
