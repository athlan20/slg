// 第 1 季的起止时刻（AISLG-134）：SEASON_1_START / SEASON_1_END 为可选 ISO 时间，未设置时起点为现在、
// 终点为起点 + SEASON_LENGTH_DAYS（缺省 28 天）；非法或终点不晚于起点时报错。不依赖数据库。
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstSeasonWindow, seasonLengthDays } from '../common/src/season-seed';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('未设置环境变量：起点为现在，终点为起点 + 28 天', () => {
  withEnv({ SEASON_1_START: undefined, SEASON_1_END: undefined, SEASON_LENGTH_DAYS: undefined }, () => {
    const now = new Date('2026-10-22T00:00:00Z');
    const { startAt, endAt } = firstSeasonWindow(now);
    assert.equal(startAt.toISOString(), now.toISOString());
    assert.equal(endAt.toISOString(), '2026-11-19T00:00:00.000Z');
  });
});

test('SEASON_LENGTH_DAYS 改变默认长度；非法值回落到 28', () => {
  withEnv({ SEASON_LENGTH_DAYS: '14' }, () => assert.equal(seasonLengthDays(), 14));
  withEnv({ SEASON_LENGTH_DAYS: 'abc' }, () => assert.equal(seasonLengthDays(), 28));
  withEnv({ SEASON_LENGTH_DAYS: '-3' }, () => assert.equal(seasonLengthDays(), 28));
});

test('SEASON_1_START / SEASON_1_END 按 ISO 时间生效（第 1 季终点 2026-10-25）', () => {
  withEnv({ SEASON_1_START: '2026-09-27T02:00:00+08:00', SEASON_1_END: '2026-10-25T00:00:00+08:00' }, () => {
    const { startAt, endAt } = firstSeasonWindow(new Date('2026-10-22T00:00:00Z'));
    assert.equal(startAt.toISOString(), '2026-09-26T18:00:00.000Z');
    assert.equal(endAt.toISOString(), '2026-10-24T16:00:00.000Z');
  });
});

test('只设 SEASON_1_END 时起点仍为现在；终点不晚于起点或格式非法直接报错', () => {
  withEnv({ SEASON_1_START: undefined, SEASON_1_END: '2026-10-25T00:00:00Z' }, () => {
    const now = new Date('2026-10-22T00:00:00Z');
    assert.equal(firstSeasonWindow(now).startAt.toISOString(), now.toISOString());
  });
  withEnv({ SEASON_1_START: '2026-10-25T00:00:00Z', SEASON_1_END: '2026-10-20T00:00:00Z' }, () => {
    assert.throws(() => firstSeasonWindow(), /晚于/);
  });
  withEnv({ SEASON_1_START: 'not-a-date', SEASON_1_END: undefined }, () => {
    assert.throws(() => firstSeasonWindow(), /SEASON_1_START/);
  });
});
