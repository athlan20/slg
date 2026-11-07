// 围攻的完整节奏（AISLG-240）：只跑真实的 tick，不手动摆状态。需求的核心数字是“隔 6 小时打一次、
// 连赢 6 次、约 30 小时丢城”，这里用空城从第一次到达一路跑到城被吞，验证两次到达的间隔。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { FACTIONS } from '../common/src/faction';
import { factionSiegeArrival } from '../common/src/faction-siege';
import { setFactionEnabledCache } from '../common/src/faction-config';
import { setTimeScaleCache } from '../common/src/time-scale';
import { runFactionSiegeTick } from '../worker/src/faction-siege-tick';
import { createSiegeFixture, type SiegeFixture } from './faction-siege-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;
const HOUR = 3600_000;
const MINUTE = 60_000;

describe('factionSiegeArrival', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const args = { now, leadMs: HOUR, intervalMs: 6 * HOUR };

  test('没打过的城：到达 = 现在 + 预警', () => {
    assert.equal(factionSiegeArrival({ ...args, lastArriveAt: null })?.getTime(), now.getTime() + HOUR);
  });

  test('上次到达 5 小时前：现在发起，到达正好隔 6 小时', () => {
    const lastArriveAt = new Date(now.getTime() - 5 * HOUR);
    assert.equal(factionSiegeArrival({ ...args, lastArriveAt })?.getTime(), lastArriveAt.getTime() + 6 * HOUR);
  });

  test('上次到达 4 小时前：还不到发起时刻', () => {
    assert.equal(factionSiegeArrival({ ...args, lastArriveAt: new Date(now.getTime() - 4 * HOUR) }), null);
  });

  test('烽火台把预警拉长到 3 小时：提前发起，到达仍隔 6 小时', () => {
    const lastArriveAt = new Date(now.getTime() - 3 * HOUR);
    const arrive = factionSiegeArrival({ now, leadMs: 3 * HOUR, intervalMs: 6 * HOUR, lastArriveAt });
    assert.equal(arrive?.getTime(), lastArriveAt.getTime() + 6 * HOUR);
  });
});

describe('围攻完整节奏（需 TEST_DATABASE_URL）', { skip: !dbUrl }, () => {
  let fx: SiegeFixture;

  before(async () => {
    setTimeScaleCache(1);
    fx = await createSiegeFixture(dbUrl as string, 'siege-cycle');
    setFactionEnabledCache(true);
  });

  after(async () => {
    setFactionEnabledCache(false);
    await fx.close();
  });

  for (const beacon of [0, 20]) {
    test(`烽火台 ${beacon} 级：隔 6 小时到达，连赢 6 次、30 小时左右城被吞`, async () => {
      const def = FACTIONS[beacon === 0 ? 2 : 3];
      const owner = await fx.insertAccount(`cycle-${beacon}-${Date.now()}`);
      await fx.insertCity({
        accountId: owner, name: '主城', x: def.lair.x + (beacon === 0 ? 8 : -8), y: def.lair.y - 8, gov: 6,
        createdAt: new Date(Date.now() - 4 * 24 * HOUR),
      });
      const branch = await fx.insertCity({
        accountId: owner, name: '空分城', x: def.lair.x + (beacon === 0 ? 7 : -7), y: def.lair.y - 7, gov: 5,
        createdAt: new Date(Date.now() - 2 * 24 * HOUR), originLevel: 2,
      });
      await fx.pool.query(
        `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'beacon', $2)
         ON CONFLICT (city_id, kind) DO UPDATE SET level = EXCLUDED.level`,
        [branch, beacon],
      );
      let now = new Date();
      for (let i = 0; i < 12 * 50; i += 1) {
        await runFactionSiegeTick(fx.pool, now);
        const left = await fx.pool.query(`SELECT 1 FROM cities WHERE id = $1`, [branch]);
        if (!left.rowCount) {
          break;
        }
        now = new Date(now.getTime() + 5 * MINUTE);
      }
      const rows = await fx.pool.query(
        `SELECT arrive_at, outcome FROM faction_sieges WHERE city_id = $1 ORDER BY arrive_at`,
        [branch],
      );
      const hits = rows.rows as Array<{ arrive_at: Date; outcome: string }>;
      assert.equal(hits.length, 6, `应该打 6 次：${hits.map((row) => row.outcome).join(',')}`);
      assert.equal(hits[5].outcome, 'swallowed');
      for (let i = 1; i < hits.length; i += 1) {
        const gap = hits[i].arrive_at.getTime() - hits[i - 1].arrive_at.getTime();
        assert.ok(gap >= 6 * HOUR && gap < 6 * HOUR + 10 * MINUTE, `第 ${i} 次间隔 ${gap / HOUR} 小时`);
      }
      const span = hits[5].arrive_at.getTime() - hits[0].arrive_at.getTime();
      assert.ok(span >= 30 * HOUR && span < 31 * HOUR, `共 ${span / HOUR} 小时`);
    });
  }
});
