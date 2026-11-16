// 名城任期轮换的纯函数单测（v111，AISLG-259）：任期 / 封禁时长（随全局时间缩放）、
// 到期前提醒阶段（24 小时 / 1 小时，跳过点时只补一条）、占领资格校验（每账号 1 座 + 到期封禁）。
// 与数据库相关的路径（写 famous_expires_at / 封禁行 / 到期掉城）在 backend/test/season-* 同类
// 真库测试里没有覆盖，需要 TEST_DATABASE_URL 才跑得到。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAMOUS_CITY_LIMIT,
  FAMOUS_EXPIRY_BAN_HOURS,
  FAMOUS_TENURE_DAYS,
  checkFamousTenure,
  famousBanMs,
  famousBanUntilFrom,
  famousExpiresAtFrom,
  famousRemainingMs,
  famousTenureMs,
  famousWarnTargetStage,
} from '../common/src/famous-tenure';
import { checkOccupyNpcCity } from '../common/src/branch-city';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test('数值：任期 7 天、封禁 48 小时、同时最多 1 座名城', () => {
  assert.equal(FAMOUS_TENURE_DAYS, 7);
  assert.equal(FAMOUS_EXPIRY_BAN_HOURS, 48);
  assert.equal(FAMOUS_CITY_LIMIT, 1);
});

test('任期与封禁时长随全局时间缩放：按 scale 1 / 10 / 50 等比缩短', () => {
  assert.equal(famousTenureMs(1), 7 * DAY);
  assert.equal(famousTenureMs(10), Math.floor((7 * DAY) / 10));
  assert.equal(famousTenureMs(50), Math.floor((7 * DAY) / 50));
  assert.equal(famousBanMs(1), 48 * HOUR);
  assert.equal(famousBanMs(50), Math.floor((48 * HOUR) / 50));
  // 极端缩放钳 1 秒下限（不出现 0 / 负数）
  assert.equal(famousTenureMs(1e12), 1000);
  assert.equal(famousBanMs(1e12), 1000);
});

test('到期时刻与封禁截止从「现在」起算（按时间缩放）', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.equal(famousExpiresAtFrom(now, 1).toISOString(), '2026-10-08T00:00:00.000Z');
  assert.equal(famousExpiresAtFrom(now, 50).getTime() - now.getTime(), famousTenureMs(50));
  assert.equal(famousBanUntilFrom(now, 1).toISOString(), '2026-10-03T00:00:00.000Z');
  assert.equal(famousBanUntilFrom(now, 50).getTime() - now.getTime(), famousBanMs(50));
});

test('任期剩余时长：已到期 / 无任期返回 0', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.equal(famousRemainingMs(null, now), 0);
  assert.equal(famousRemainingMs(new Date(now.getTime() - 1000), now), 0);
  assert.equal(famousRemainingMs(new Date(now.getTime() + 90 * 60 * 1000), now), 90 * 60 * 1000);
});

test('提醒阶段：> 24 小时 0；≤ 24 小时 1；≤ 1 小时 2；无任期恒 0', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms);
  assert.equal(famousWarnTargetStage(null, now, 1), 0);
  assert.equal(famousWarnTargetStage(at(25 * HOUR), now, 1), 0);
  assert.equal(famousWarnTargetStage(at(24 * HOUR), now, 1), 1, '正好 24 小时就开始提醒');
  assert.equal(famousWarnTargetStage(at(2 * HOUR), now, 1), 1);
  assert.equal(famousWarnTargetStage(at(1 * HOUR), now, 1), 2);
  assert.equal(famousWarnTargetStage(at(1), now, 1), 2);
  assert.equal(famousWarnTargetStage(at(-1), now, 1), 2, '已到期归到期处置，不再补提醒');
});

test('提醒阶段随缩放：50 倍速下 24 小时阈值 = 28.8 分钟、1 小时阈值 = 72 秒', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms);
  assert.equal(famousWarnTargetStage(at(29 * 60 * 1000), now, 50), 0);
  assert.equal(famousWarnTargetStage(at(28 * 60 * 1000), now, 50), 1);
  assert.equal(famousWarnTargetStage(at(80 * 1000), now, 50), 1);
  assert.equal(famousWarnTargetStage(at(70 * 1000), now, 50), 2);
});

test('提醒去重：已发 24 小时提醒后同阶段不重发，跨过 1 小时点补发一次 stage 2', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const expires = new Date(now.getTime() + 20 * HOUR);
  // stage 0 → 目标 1：要发
  assert.equal(famousWarnTargetStage(expires, now, 1), 1);
  // 已发 1 后仍是目标 1：不发
  assert.ok(famousWarnTargetStage(expires, now, 1) <= 1);
  // 只剩 30 分钟、但 stage 仍是 0（服务暂停过）：目标 2，直接补发一条（不补两条）
  const late = new Date(now.getTime() + 23.6 * HOUR);
  assert.equal(famousWarnTargetStage(expires, late, 1), 2);
});

test('占领资格：已有 1 座名城 → FAMOUS_LIMIT；没名城但该城封禁中 → FAMOUS_BANNED', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.equal(checkFamousTenure({ famousOwned: 0, bannedUntil: null }, now), null);
  assert.equal(checkFamousTenure({ famousOwned: 1, bannedUntil: null }, now), 'FAMOUS_LIMIT');
  assert.equal(checkFamousTenure({ famousOwned: 2, bannedUntil: null }, now), 'FAMOUS_LIMIT');
  assert.equal(
    checkFamousTenure({ famousOwned: 0, bannedUntil: new Date(now.getTime() + HOUR) }, now),
    'FAMOUS_BANNED',
  );
  assert.equal(
    checkFamousTenure({ famousOwned: 0, bannedUntil: new Date(now.getTime() - 1) }, now),
    null,
    '封禁到期即失效',
  );
  // 既有名城又在封禁里时先报名额（提示优先级由 checkOccupyNpcCity 决定）
  assert.equal(
    checkFamousTenure({ famousOwned: 1, bannedUntil: new Date(now.getTime() + HOUR) }, now),
    'FAMOUS_LIMIT',
  );
});

test('占领资格合并：名城校验排在官府门槛之后、分城名额之前；非名城不受影响', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const base = { mainGovernment: 3, fromGovernment: 3, branchCount: 0, targetLevel: 3, now };
  assert.equal(checkOccupyNpcCity(base), null, '不传 famous = 旧行为');
  assert.equal(
    checkOccupyNpcCity({ ...base, famous: { famousOwned: 1, bannedUntil: null } }),
    'FAMOUS_LIMIT',
  );
  assert.equal(
    checkOccupyNpcCity({ ...base, famous: { famousOwned: 1, bannedUntil: null }, branchCount: 1 }),
    'FAMOUS_LIMIT',
    '名额与分城名额同时满时先报名城',
  );
  assert.equal(
    checkOccupyNpcCity({ ...base, mainGovernment: 2, fromGovernment: 2, famous: { famousOwned: 1, bannedUntil: null } }),
    'GOVERNMENT_TOO_LOW',
    '官府不够时错误提示仍是官府',
  );
  assert.equal(
    checkOccupyNpcCity({
      ...base,
      famous: { famousOwned: 0, bannedUntil: new Date(now.getTime() + 47 * HOUR) },
    }),
    'FAMOUS_BANNED',
  );
  assert.equal(
    checkOccupyNpcCity({ ...base, famous: { famousOwned: 0, bannedUntil: null }, targetLevel: 4 }),
    'TARGET_LEVEL_TOO_HIGH',
    '名城校验通过后继续按原顺序判其它条件',
  );
});