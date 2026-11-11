// 兑换码的纯规则（AISLG-253，v109）：字符集、随机生成、规范化、显示格式、奖励校验、脚本参数解析。
// 不依赖数据库（需要真实 PostgreSQL 的兑换流程在 redeem.test.ts）。

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ITEM_DEFS } from '../common/src/items';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  REDEEM_INGOT_MAX,
  REDEEM_ITEM_COUNT_MAX,
  codeTail,
  formatRedeemCode,
  formatRedeemRewards,
  generateRedeemCode,
  isRedeemBatchKind,
  isRedeemItemId,
  normalizeRedeemCode,
  parseRedeemExpiresAt,
  parseRedeemItemSpec,
  validateRedeemRewards,
} from '../common/src/redeem-code';

describe('兑换码的字符集与生成', () => {
  test('字符集是 32 个字符：0-9 与 A-Z 去掉 I / L / O / U', () => {
    assert.equal(CODE_ALPHABET.length, 32);
    assert.equal(new Set(CODE_ALPHABET).size, 32);
    for (const forbidden of ['I', 'L', 'O', 'U']) {
      assert.ok(!CODE_ALPHABET.includes(forbidden), `字符集里不应有 ${forbidden}`);
    }
    for (const char of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (['I', 'L', 'O', 'U'].includes(char)) {
        continue;
      }
      assert.ok(CODE_ALPHABET.includes(char), `字符集缺少 ${char}`);
    }
  });

  test('生成的码是 16 位、只用字符集内的字符，大量生成不重复', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const code = generateRedeemCode();
      assert.equal(code.length, CODE_LENGTH);
      for (const char of code) {
        assert.ok(CODE_ALPHABET.includes(char), `${code} 含字符集外的字符 ${char}`);
      }
      seen.add(code);
    }
    assert.equal(seen.size, 2000, '随机码出现了重复');
  });

  test('显示格式 XXXX-XXXX-XXXX-XXXX，后 4 位是 codeTail', () => {
    const code = 'ABCDEFGHJKMNPQRS';
    assert.equal(formatRedeemCode(code), 'ABCD-EFGH-JKMN-PQRS');
    assert.equal(codeTail(code), 'PQRS');
    assert.equal(formatRedeemCode(generateRedeemCode()).length, 19);
  });
});

describe('输入规范化', () => {
  test('小写 + 空格 + 横线、纯大写都能规范化成同一个码', () => {
    // 需求单的例子（含 I / L / O，不是真实码的字符集），只验证大小写与分隔符被吐掉
    assert.equal(normalizeRedeemCode('abcd efgh-ijkl mnop'), 'ABCDEFGHIJKLMNOP');
    assert.equal(normalizeRedeemCode('abcdefghijklmnop'), 'ABCDEFGHIJKLMNOP');
    // 真实码：显示格式（带横线）与存储格式（无横线）等价，大小写不敏感
    const code = generateRedeemCode();
    assert.equal(normalizeRedeemCode(formatRedeemCode(code)), code);
    assert.equal(normalizeRedeemCode(formatRedeemCode(code).toLowerCase()), code);
    assert.equal(normalizeRedeemCode(' ABCD-EFGH-JKMN-PQRS '), 'ABCDEFGHJKMNPQRS');
  });

  test('全角空格与各种横线也算分隔符（从微信复制常带）', () => {
    assert.equal(normalizeRedeemCode('ABCD\u3000EFGH\uFF0DJKMN\u2014PQRS'), 'ABCDEFGHJKMNPQRS');
    assert.equal(normalizeRedeemCode('abcd\tefgh\nijkl mnop'), 'ABCDEFGHIJKLMNOP');
  });

  test('长度不是 16 位返回 null（含字符集外的字符不在这里拦，查码时自然对不上）', () => {
    assert.equal(normalizeRedeemCode(''), null);
    assert.equal(normalizeRedeemCode('ABCDEFGHJKMNPQR'), null);
    assert.equal(normalizeRedeemCode('ABCDEFGHJKMNPQRS0'), null);
    assert.equal(normalizeRedeemCode('ABCD-EFGH-JKMN-PQRST'), null);
    // 16 位但含 I / L / O / U 的输入不报格式错，只是不可能对上任何码（库里没有这些字符）
    assert.equal(normalizeRedeemCode('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJKLMNOP');
    assert.equal(normalizeRedeemCode('ABCD-EFGH-JKMN-PQR!'), 'ABCDEFGHJKMNPQR!');
  });
});

describe('奖励校验', () => {
  test('只发元宝、只发道具、两者组合都合法', () => {
    assert.deepEqual(validateRedeemRewards({ ingot: 500 }), { ok: true, rewards: { ingot: 500 } });
    assert.deepEqual(validateRedeemRewards({ items: [{ itemId: 'city_order', count: 2 }] }), {
      ok: true,
      rewards: { items: [{ itemId: 'city_order', count: 2 }] },
    });
    assert.deepEqual(validateRedeemRewards({ ingot: 1, items: [{ itemId: 'city_order_adv', count: REDEEM_ITEM_COUNT_MAX }] }), {
      ok: true,
      rewards: { ingot: 1, items: [{ itemId: 'city_order_adv', count: REDEEM_ITEM_COUNT_MAX }] },
    });
    assert.deepEqual(validateRedeemRewards({ ingot: REDEEM_INGOT_MAX }), { ok: true, rewards: { ingot: REDEEM_INGOT_MAX } });
  });

  test('元宝 1..100000 的整数：0 / 超上限 / 小数 / 字符串都拒绝', () => {
    for (const ingot of [0, -1, REDEEM_INGOT_MAX + 1, 1.5, '500']) {
      assert.equal(validateRedeemRewards({ ingot }).ok, false, `元宝 ${String(ingot)} 应当被拒绝`);
    }
    // null 视同未给，但也没有道具 → 至少一项都不满足
    assert.equal(validateRedeemRewards({ ingot: null }).ok, false);
  });

  test('道具数量 1..99 的整数、道具必须在售、同一道具不能出现两次', () => {
    assert.equal(validateRedeemRewards({ items: [{ itemId: 'city_order', count: 0 }] }).ok, false);
    assert.equal(validateRedeemRewards({ items: [{ itemId: 'city_order', count: 100 }] }).ok, false);
    assert.equal(validateRedeemRewards({ items: [{ itemId: 'city_order', count: 1.5 }] }).ok, false);
    assert.equal(validateRedeemRewards({ items: [{ itemId: 'no_such_item', count: 1 }] }).ok, false);
    assert.equal(
      validateRedeemRewards({
        items: [
          { itemId: 'city_order', count: 1 },
          { itemId: 'city_order', count: 2 },
        ],
      }).ok,
      false,
    );
    assert.equal(validateRedeemRewards({ items: [] }).ok, false);
    assert.equal(validateRedeemRewards({}).ok, false);
    assert.equal(validateRedeemRewards(null).ok, false);
    assert.equal(validateRedeemRewards([{ itemId: 'city_order', count: 1 }]).ok, false);
  });

  test('不在售的道具不能作为奖励（临时把两个单价都改成 null 验证）', () => {
    const def = ITEM_DEFS.find((item) => item.id === 'city_order');
    assert.ok(def);
    const { shopPrice, ingotPrice } = def;
    try {
      def.shopPrice = null;
      def.ingotPrice = null;
      assert.equal(isRedeemItemId('city_order'), false);
      assert.equal(validateRedeemRewards({ items: [{ itemId: 'city_order', count: 1 }] }).ok, false);
    } finally {
      def.shopPrice = shopPrice;
      def.ingotPrice = ingotPrice;
    }
    assert.equal(isRedeemItemId('city_order'), true);
  });

  test('奖励摘要：元宝 ×500、迁城令 ×2', () => {
    assert.equal(formatRedeemRewards({ ingot: 500, items: [{ itemId: 'city_order', count: 2 }] }), '元宝 ×500、迁城令 ×2');
    assert.equal(formatRedeemRewards({ ingot: 100 }), '元宝 ×100');
    assert.equal(formatRedeemRewards({ items: [{ itemId: 'city_order_adv', count: 1 }] }), '高级迁城令 ×1');
  });
});

describe('运营脚本的参数解析', () => {
  test('--item city_order:2', () => {
    assert.deepEqual(parseRedeemItemSpec('city_order:2'), { ok: true, item: { itemId: 'city_order', count: 2 } });
    assert.deepEqual(parseRedeemItemSpec(' city_order_adv : 99 '), {
      ok: true,
      item: { itemId: 'city_order_adv', count: 99 },
    });
    for (const bad of ['city_order', 'city_order:', ':2', 'no_such_item:2', 'city_order:0', 'city_order:100', 'city_order:2.5']) {
      assert.equal(parseRedeemItemSpec(bad).ok, false, `${bad} 应当被拒绝`);
    }
  });

  test('--expires 2026-12-31 = 当天 UTC 结束；ISO 原样解析；非法时间抛错', () => {
    assert.equal(parseRedeemExpiresAt('2026-12-31').toISOString(), '2026-12-31T23:59:59.999Z');
    assert.equal(parseRedeemExpiresAt('2026-11-30T04:00:00Z').toISOString(), '2026-11-30T04:00:00.000Z');
    assert.throws(() => parseRedeemExpiresAt('明天'), /--expires/);
  });

  test('码类型只认 single / shared', () => {
    assert.equal(isRedeemBatchKind('single'), true);
    assert.equal(isRedeemBatchKind('shared'), true);
    assert.equal(isRedeemBatchKind('multi'), false);
    assert.equal(isRedeemBatchKind(undefined), false);
  });
});