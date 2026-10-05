// 黄巾之乱（v29，AISLG-76）的纯规则：数量 / 分档 / 守军 / 升档 / 老巢阶段 / 奖励档 / 视图

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  YT_CAMPS_MAX,
  YT_CAMPS_MIN,
  YT_REWARD_TIERS,
  YT_SCATTER_LEVEL,
  YT_TIER_INFO,
  ytBossStage,
  ytBossUnlockCount,
  ytCampCount,
  ytGarrison,
  ytKeeperWindowMs,
  ytLootPool,
  ytNextTier,
  ytRewardFor,
  ytTierSplit,
} from '../common/src/yellow-turban';
import { campGarrison, ytTileCampView, type YtCampRow } from '../common/src/yellow-turban-db';
import { armyPower, nativeGarrisonBase } from '../common/src/battle';
import { getTimeScale } from '../common/src/time-scale';

function camp(over: Partial<YtCampRow> = {}): YtCampRow {
  return {
    id: 'c1', event_id: 'e1', x: 10, y: 20, tier: 'small', status: 'active',
    next_grow_at: new Date('2026-10-02T00:00:00Z'), next_raid_at: null, outer_cleared_at: null,
    remaining: null, remaining_at: null, cleared_by: null, cleared_at: null, ...over,
  };
}

test('营地数量：无活跃玩家不起事，其余 ⌈人数 × 2⌉ 夹在 [6, 60]', () => {
  assert.equal(ytCampCount(0), 0);
  assert.equal(ytCampCount(1), YT_CAMPS_MIN);
  assert.equal(ytCampCount(10), 20);
  assert.equal(ytCampCount(1000), YT_CAMPS_MAX);
});

test('三档分配 50% / 30% / 20%，总数不变', () => {
  for (const total of [6, 7, 20, 33, 60]) {
    const split = ytTierSplit(total);
    assert.equal(split.small + split.medium + split.large, total);
    assert.ok(split.small >= split.medium && split.medium >= split.large);
  }
  assert.deepEqual(ytTierSplit(20), { small: 10, medium: 6, large: 4 });
});

test('守军强度对应野地 Lv3 / Lv6 / Lv9；老巢外围 / 城守为 Lv10 基准的倍数且城守更强', () => {
  assert.deepEqual(ytGarrison('small'), nativeGarrisonBase(3));
  assert.deepEqual(ytGarrison('medium'), nativeGarrisonBase(6));
  assert.deepEqual(ytGarrison('large'), nativeGarrisonBase(9));
  assert.ok(armyPower(ytGarrison('small')) < armyPower(ytGarrison('medium')));
  assert.ok(armyPower(ytGarrison('medium')) < armyPower(ytGarrison('large')));
  assert.ok(armyPower(ytGarrison('boss', 'outer')) > armyPower(ytGarrison('large')));
  assert.ok(armyPower(ytGarrison('boss', 'keeper')) > armyPower(ytGarrison('boss', 'outer')));
});

test('升档：小 → 中 → 大，大封顶；散成流寇等级随档位', () => {
  assert.equal(ytNextTier('small'), 'medium');
  assert.equal(ytNextTier('medium'), 'large');
  assert.equal(ytNextTier('large'), null);
  assert.ok(YT_SCATTER_LEVEL.small < YT_SCATTER_LEVEL.medium && YT_SCATTER_LEVEL.medium < YT_SCATTER_LEVEL.large);
});

test('老巢解锁数 = ⌈总数 × 80%⌉，至少 1', () => {
  assert.equal(ytBossUnlockCount(10), 8);
  assert.equal(ytBossUnlockCount(7), 6);
  assert.equal(ytBossUnlockCount(1), 1);
});

test('老巢阶段：外围清空后限时内为城守，超时回外围（惰性推导）', () => {
  const cleared = new Date('2026-10-01T00:00:00Z');
  const window = ytKeeperWindowMs(1);
  assert.equal(ytBossStage(null, cleared, 1), 'outer');
  assert.equal(ytBossStage(cleared, new Date(cleared.getTime() + window - 1), 1), 'keeper');
  assert.equal(ytBossStage(cleared, new Date(cleared.getTime() + window), 1), 'outer');
});

test('掉落池：老巢远大于营地，营地随档位增长', () => {
  const sum = (tier: 'small' | 'medium' | 'large' | 'boss') => Object.values(ytLootPool(tier)).reduce((a, b) => a + b, 0);
  assert.ok(sum('small') < sum('medium') && sum('medium') < sum('large') && sum('large') < sum('boss'));
});

test('名次奖励档：第 1 名最高，名次越后越少，保底参与奖', () => {
  assert.equal(ytRewardFor(1).label, '第 1 名');
  assert.equal(ytRewardFor(2).label, '第 2–3 名');
  assert.equal(ytRewardFor(10).label, '第 4–10 名');
  assert.equal(ytRewardFor(500).label, '参与奖');
  const golds = YT_REWARD_TIERS.map((tier) => tier.reward.gold);
  assert.deepEqual([...golds].sort((a, b) => b - a), golds);
});

test('营地守军 = 满编，战后存量按每小时 25% 恢复；视图只给大致范围', () => {
  const full = ytGarrison('small');
  const fullTotal = Object.values(full).reduce((a, b) => a + (b ?? 0), 0);
  const savedAt = new Date('2026-10-01T00:00:00Z');
  const hurt = camp({ remaining: { militia: 3 }, remaining_at: savedAt });
  assert.equal(campGarrison(hurt, savedAt).militia, 3, '刚打残');
  const later = campGarrison(hurt, new Date(savedAt.getTime() + 3_600_000));
  const expected = Math.min(full.militia ?? 0, 3 + Math.floor((full.militia ?? 0) * 0.25 * getTimeScale()));
  assert.equal(later.militia, expected, '1 小时后恢复满编的 25%（随时间缩放），封顶满编');
  const view = ytTileCampView(camp(), savedAt);
  assert.equal(view.label, YT_TIER_INFO.small.label);
  assert.equal(view.level, 3);
  assert.deepEqual(view.garrisonTotal, { min: Math.floor(fullTotal * 0.8), max: Math.ceil(fullTotal * 1.2) });
  assert.equal(view.boss, undefined);
});

test('老巢视图带阶段与恢复时刻；城守窗口过期后存量作废', () => {
  const cleared = new Date();
  const boss = camp({ tier: 'boss', outer_cleared_at: cleared, next_grow_at: null });
  const view = ytTileCampView(boss, new Date(cleared.getTime() + 1000));
  assert.equal(view.boss?.stage, 'keeper');
  assert.ok(view.boss?.recoversAt);
  const expiredAt = new Date(cleared.getTime() + ytKeeperWindowMs() + 1000);
  const stale = camp({ tier: 'boss', outer_cleared_at: cleared, remaining: { militia: 1 }, remaining_at: cleared, next_grow_at: null });
  assert.deepEqual(campGarrison(stale, expiredAt), ytGarrison('boss', 'outer'), '回到外围满编，旧存量作废');
});
