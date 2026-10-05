// 名城规则（v24，AISLG-56）

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAMOUS_CITY_NAMES,
  famousAnchors,
  famousEncounter,
  famousGarrisons,
  famousRecoversAt,
  famousStage,
  newFamousState,
} from '../common/src/famous-city';
import { NPC_CITY_PROFILE, WORLD_SIZE, type NpcCitySnapshot } from '../common/src/world';
import { armyPower } from '../common/src/battle';
import { productionPerHour } from '../common/src/production';

const HOUR = 60 * 60 * 1000;

test('名城守军：外围 + 城守合计 = 同级普通 NPC 城守军 × 3（各 × 1.5）', () => {
  const normal = armyPower(NPC_CITY_PROFILE[3].garrison);
  const { outer, keeper } = famousGarrisons(3);
  assert.deepEqual(outer, keeper, '外围与城守各占一半');
  assert.equal(outer.militia, Math.round(100 * 1.5));
  assert.ok(Math.abs((armyPower(outer) + armyPower(keeper)) / normal - 3) < 0.05, '合计约 3 倍战力');
});

test('名城阶段：外围完好 = outer；清空后限时内 = keeper；超时外围恢复（随时间缩放）', () => {
  const state = newFamousState('官渡', 3);
  const t0 = new Date('2026-10-01T00:00:00Z');
  assert.equal(famousStage(state, t0, 1), 'outer');
  const cleared = { ...state, outerClearedAt: t0.toISOString() };
  assert.equal(famousStage(cleared, new Date(t0.getTime() + 5 * HOUR), 1), 'keeper');
  assert.equal(famousStage(cleared, new Date(t0.getTime() + 6 * HOUR + 1), 1), 'outer', '6 小时后外围恢复');
  assert.equal(famousStage(cleared, new Date(t0.getTime() + 8 * 60 * 1000), 50), 'outer', '50 倍速下 6 小时 = 7.2 分钟');
  assert.equal(famousStage(cleared, new Date(t0.getTime() + 5 * 60 * 1000), 50), 'keeper');
  assert.equal(famousRecoversAt(state, t0, 1), null, '外围阶段无恢复时刻');
  assert.equal(famousRecoversAt(cleared, t0, 1)?.getTime(), t0.getTime() + 6 * HOUR);
});

test('名城交战口径：外围 = 野战无城墙；城守 = 攻城战打城守驻军', () => {
  const npc: NpcCitySnapshot = {
    level: 3,
    garrison: { militia: 150 },
    famous: { name: '官渡', outerGarrison: { militia: 90 }, outerClearedAt: null },
    stock: { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 },
    buildings: { wall: 3 },
  };
  const now = new Date('2026-10-01T00:00:00Z');
  assert.deepEqual(famousEncounter(npc, now, 1), { stage: 'outer', garrison: { militia: 90 }, siege: false });
  const cleared = { ...npc, famous: { ...npc.famous!, outerClearedAt: now.toISOString() } };
  assert.deepEqual(famousEncounter(cleared, now, 1), { stage: 'keeper', garrison: { militia: 150 }, siege: true });
});

test('名城锚点：8 座、全部不在地图中心、互不相同；名称 8 个', () => {
  const anchors = famousAnchors(WORLD_SIZE);
  assert.equal(anchors.length, 8);
  assert.equal(FAMOUS_CITY_NAMES.length, 8);
  assert.equal(new Set(anchors.map((a) => `${a.x},${a.y}`)).size, 8);
  const mid = Math.floor(WORLD_SIZE / 2);
  assert.ok(!anchors.some((a) => a.x === mid && a.y === mid), '避开中心出生区');
});

test('独占加成：名城分城产量 +20%（基础 + 建筑合计，先于时间缩放）', () => {
  const levels = { farm: 2 };
  const plain = productionPerHour(levels);
  const boosted = productionPerHour(levels, undefined, 20);
  for (const key of Object.keys(plain) as Array<keyof typeof plain>) {
    assert.equal(boosted[key], Math.round(plain[key] * 1.2), `${key} +20%`);
  }
});
