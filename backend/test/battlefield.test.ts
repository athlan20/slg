// 剧本战场（v75，AISLG-198）：日程、地图可达性、入场人口、守军加厚、人少补偿、奖励与商店、守军伤亡拆分。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTLEFIELD_ENTRY_POPULATION,
  BATTLEFIELD_MAX_SQUADS,
  BATTLEFIELD_SECONDS_PER_TILE,
  BATTLEFIELD_SHOP,
  battlefieldEntryPopulation,
  battlefieldGarrisonPlayerMultiplier,
  battlefieldInitialGarrison,
  battlefieldMarchMs,
  battlefieldPassable,
  battlefieldPathSteps,
  battlefieldRankReward,
  battlefieldRewardFor,
  battlefieldUnderdog,
  battlefieldWindow,
  splitBattlefieldDefenderLosses,
} from '../common/src/battlefield';
import { armyPower } from '../common/src/battle';

const CST = (iso: string): Date => new Date(iso);

test('日程：北京时间每周二 20:00 报名、周三 20:00 开战、周四 20:00 结束', () => {
  // 2026-10-27 是周二。19:59 时本周报名尚未开始，窗口仍是当天 20:00
  const before = battlefieldWindow(CST('2026-10-27T19:59:00+08:00'));
  assert.equal(before.signupStart.toISOString(), CST('2026-10-27T20:00:00+08:00').toISOString());
  assert.equal(before.startAt.toISOString(), CST('2026-10-28T20:00:00+08:00').toISOString());
  assert.equal(before.endAt.toISOString(), CST('2026-10-29T20:00:00+08:00').toISOString());

  // 周三 21:00 已开战，窗口不变
  const during = battlefieldWindow(CST('2026-10-28T21:00:00+08:00'));
  assert.equal(during.signupStart.toISOString(), before.signupStart.toISOString());

  // 周五 00:00 已结束，窗口滚到下一周
  const after = battlefieldWindow(CST('2026-10-30T00:00:00+08:00'));
  assert.equal(after.signupStart.toISOString(), CST('2026-11-03T20:00:00+08:00').toISOString());
});

test('地图：30×30，中间一条河只有 3 处渡口能过', () => {
  assert.equal(battlefieldPassable(14, 15), true);
  assert.equal(battlefieldPassable(15, 14), false);
  assert.equal(battlefieldPassable(15, 15), true);
  assert.equal(battlefieldPassable(30, 0), false);
  assert.equal(battlefieldPassable(-1, 0), false);

  // 河对岸必须绕渡口：从 (14,14) 到 (16,14) 直线只要 2 步，实际要绕到 (15,15) 渡口共 4 步
  assert.equal(battlefieldPathSteps(14, 14, 16, 14), 4);
  assert.ok((battlefieldPathSteps(14, 14, 16, 14) ?? 0) > 2);
  // 先到 (15,15) 渡口，再到 (16,15)：合计 2 + 1 步
  assert.equal(battlefieldPathSteps(14, 14, 16, 15), 3);
  assert.equal(battlefieldPathSteps(13, 15, 15, 15), 2);
  assert.equal(battlefieldMarchMs(3), 3 * BATTLEFIELD_SECONDS_PER_TILE * 1000);
});

test('入场：按人口最多 3000，铁骑兵 3 人口', () => {
  assert.equal(battlefieldEntryPopulation({ militia: 3000 }), 3000);
  assert.equal(battlefieldEntryPopulation({ iron_cavalry: 1000 }), 3000);
  assert.ok(battlefieldEntryPopulation({ iron_cavalry: 1001 }) > BATTLEFIELD_ENTRY_POPULATION);
  assert.equal(BATTLEFIELD_MAX_SQUADS, 3);
});

test('守军：3 级 NPC 城守军 × 据点倍数 × max(1, 报名人数 ÷ 20)', () => {
  assert.equal(battlefieldGarrisonPlayerMultiplier(19), 1);
  assert.equal(battlefieldGarrisonPlayerMultiplier(40), 2);
  const ford = battlefieldInitialGarrison({ garrisonMultiplier: 2 }, 1);
  assert.equal(ford.militia, 200);
  assert.equal(ford.swordsman, 60);
  assert.equal(ford.archer, 80);
  assert.equal(ford.cavalry, 24);
  const base = battlefieldInitialGarrison({ garrisonMultiplier: 10 }, 2);
  assert.equal(base.militia, 2000);
  assert.equal(base.swordsman, 600);
});

test('人少补偿：少方 < 多方 70% 时按人数比补偿，封顶 1.5', () => {
  assert.equal(battlefieldUnderdog(10, 14), null);
  const underdog = battlefieldUnderdog(10, 20);
  assert.deepEqual(underdog, { camp: 'yuan', multiplier: 1.5 });
  const mild = battlefieldUnderdog(10, 12);
  assert.equal(mild, null);
  assert.deepEqual(battlefieldUnderdog(20, 10), { camp: 'cao', multiplier: 1.5 });
});

test('奖励：胜败基础 + 名次额外（前 10）', () => {
  assert.equal(battlefieldRewardFor(1, true).gold, 3000 + 6000);
  assert.equal(battlefieldRewardFor(2, false).gold, 1000 + 4000);
  assert.equal(battlefieldRewardFor(10, false).food, 5000 + 12000);
  assert.equal(battlefieldRewardFor(11, true).gold, 3000);
  assert.equal(battlefieldRankReward(3)?.iron, 20000);
  assert.equal(battlefieldRankReward(0), null);
});

test('商店：4 种商品，价格 / 每场限购固定', () => {
  assert.deepEqual(
    BATTLEFIELD_SHOP.map((item) => [item.item, item.cost, item.limit]),
    [
      ['resources', 200, 5],
      ['hero_exp', 300, 3],
      ['swordsman', 600, 2],
      ['cavalry', 600, 2],
    ],
  );
});

test('据点守军伤亡拆分：按开战数量占比，余数归 NPC，总和等于总伤亡', () => {
  const npc = { militia: 100, swordsman: 30 };
  const parties = [
    { id: 'a', troops: { militia: 100, swordsman: 0 } },
    { id: 'b', troops: { militia: 100, swordsman: 0 } },
  ];
  const split = splitBattlefieldDefenderLosses(npc, parties, { militia: 60, swordsman: 15 });
  assert.equal(split.npcLosses.militia, 20);
  assert.equal(split.partyLosses.get('a')?.militia, 20);
  assert.equal(split.partyLosses.get('b')?.militia, 20);
  assert.equal(split.npcLosses.swordsman, 15);
  const sumMilitia = split.npcLosses.militia + (split.partyLosses.get('a')?.militia ?? 0) + (split.partyLosses.get('b')?.militia ?? 0);
  assert.equal(sumMilitia, 60);
});

test('守军参考战力：满编 3 级 NPC 城守军约 646，随倍数线性放大', () => {
  const one = battlefieldInitialGarrison({ garrisonMultiplier: 1 }, 1);
  assert.equal(armyPower(one), 646);
});