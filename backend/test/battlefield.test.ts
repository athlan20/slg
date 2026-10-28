// 剧本战场（v75，AISLG-198）：日程、地图可达性、入场人口、守军加厚、人少补偿、奖励与商店、守军伤亡拆分。
// 剧本战场二（v80，AISLG-199）：讨伐董卓的解锁顺序 / 守军 / 进度奖励，赤壁的风向切换与预告 / 火攻 / 连锁 / 铁骑兵商品。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTLEFIELD_CHAIN_DEFENSE_PERCENT,
  BATTLEFIELD_CHAIN_MS,
  BATTLEFIELD_DONGZHUO_STRONGHOLDS,
  BATTLEFIELD_ENTRY_POPULATION,
  BATTLEFIELD_FIRE_COOLDOWN_MS,
  BATTLEFIELD_LVBU_BONUS,
  BATTLEFIELD_MAX_SQUADS,
  BATTLEFIELD_SCRIPT_ANCHOR_MS,
  BATTLEFIELD_SECONDS_PER_TILE,
  BATTLEFIELD_SHOP,
  BATTLEFIELD_WIND_MS,
  BATTLEFIELD_WIND_NOTICE_MS,
  battlefieldAdvanceWind,
  battlefieldChainActive,
  battlefieldDongzhuoProgress,
  battlefieldDongzhuoTier,
  battlefieldEntryPopulation,
  battlefieldFireDamage,
  battlefieldFireHpRatio,
  battlefieldFireReady,
  battlefieldGarrisonPlayerMultiplier,
  battlefieldInitialGarrison,
  battlefieldInitialWind,
  battlefieldMarchMs,
  battlefieldNeighbors,
  battlefieldPassable,
  battlefieldPathSteps,
  battlefieldRankReward,
  battlefieldRewardFor,
  battlefieldRewardForScript,
  battlefieldScriptForSignupStart,
  battlefieldShopDef,
  battlefieldShopItems,
  battlefieldStrongholds,
  battlefieldUnderdog,
  battlefieldUnlocked,
  battlefieldWindNoticeDue,
  battlefieldWindTech,
  battlefieldWindow,
  splitBattlefieldDefenderLosses,
} from '../common/src/battlefield';
import { armyPower } from '../common/src/battle';
import { battlefieldEventView, battlefieldRewardsView, type BattlefieldEventRow } from '../common/src/battlefield-db';

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
// ---- v80（AISLG-199）：讨伐董卓 / 赤壁之战 ----

const DAY = 24 * 3_600_000;

test('轮换：官渡 → 讨董 → 赤壁 循环，锚点周为官渡', () => {
  const anchor = new Date(BATTLEFIELD_SCRIPT_ANCHOR_MS);
  assert.equal(battlefieldScriptForSignupStart(anchor), 'guandu');
  assert.equal(battlefieldScriptForSignupStart(new Date(anchor.getTime() + 7 * DAY)), 'dongzhuo');
  assert.equal(battlefieldScriptForSignupStart(new Date(anchor.getTime() + 14 * DAY)), 'chibi');
  assert.equal(battlefieldScriptForSignupStart(new Date(anchor.getTime() + 21 * DAY)), 'guandu');
  // 锚点之前的周数为负，也要按模取正
  assert.equal(battlefieldScriptForSignupStart(new Date(anchor.getTime() - 7 * DAY)), 'chibi');
});

test('讨董：关卡顺序解锁，前一关未被讨董联军打下则不能攻', () => {
  assert.equal(battlefieldUnlocked('dongzhuo', 0, null), true);
  assert.equal(battlefieldUnlocked('dongzhuo', 1, null), false);
  assert.equal(battlefieldUnlocked('dongzhuo', 1, 'yuan'), true);
  assert.equal(battlefieldUnlocked('dongzhuo', 2, null), false);
  assert.equal(battlefieldUnlocked('dongzhuo', 2, 'yuan'), true);
  // 其他剧本不做解锁限制
  assert.equal(battlefieldUnlocked('guandu', 5, null), true);
  assert.deepEqual(
    battlefieldStrongholds('dongzhuo').map((def) => def.id),
    ['suishui', 'hulao', 'luoyang'],
  );
  assert.equal(BATTLEFIELD_DONGZHUO_STRONGHOLDS[1].kind, 'ford');
});

test('讨董：进度 = 按顺序已打下的关卡数（中间断掉不计后面）', () => {
  assert.equal(battlefieldDongzhuoProgress({}), 0);
  assert.equal(battlefieldDongzhuoProgress({ suishui: 'yuan' }), 1);
  assert.equal(battlefieldDongzhuoProgress({ suishui: 'yuan', hulao: 'yuan', luoyang: null }), 2);
  assert.equal(battlefieldDongzhuoProgress({ suishui: null, hulao: 'yuan', luoyang: 'yuan' }), 0);
  assert.equal(battlefieldDongzhuoProgress({ suishui: 'yuan', hulao: 'yuan', luoyang: 'yuan' }), 3);
});

test('讨董：守军 ×15 / ×40 / ×30，按报名人数 ÷ 10 加厚（至少 1 倍）', () => {
  assert.equal(battlefieldGarrisonPlayerMultiplier(5, 'dongzhuo'), 1);
  assert.equal(battlefieldGarrisonPlayerMultiplier(30, 'dongzhuo'), 3);
  // 官渡仍是 ÷ 20
  assert.equal(battlefieldGarrisonPlayerMultiplier(30, 'guandu'), 1.5);
  const hulao = BATTLEFIELD_DONGZHUO_STRONGHOLDS[1];
  assert.equal(hulao.garrisonMultiplier, 40);
  // 虎牢关：militia 100 × 40 × 3 = 12000
  assert.equal(battlefieldInitialGarrison(hulao, battlefieldGarrisonPlayerMultiplier(30, 'dongzhuo')).militia, 12000);
});

test('讨董：进度档奖励全员按最远一档，军功 > 0 才会在结算里入账（个人名次另加）', () => {
  assert.deepEqual(battlefieldDongzhuoTier(0), { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 });
  assert.equal(battlefieldDongzhuoTier(1).gold, 1000);
  assert.equal(battlefieldDongzhuoTier(2).wood, 10000);
  assert.equal(battlefieldDongzhuoTier(3).gold, 4000);
  assert.equal(battlefieldDongzhuoTier(3).iron, 20000);
  // 进度 2 + 个人第 1 名：2000 + 6000 金、10000 + 30000 木
  const reward = battlefieldRewardForScript('dongzhuo', 1, true, 2);
  assert.equal(reward.gold, 8000);
  assert.equal(reward.wood, 40000);
  // 没有进度（全灭 / 时间到前一关都没打下）时只有名次奖励
  assert.equal(battlefieldRewardForScript('dongzhuo', null, false, 0).gold, 0);
  // 官渡 / 赤壁仍按胜负
  assert.deepEqual(battlefieldRewardForScript('guandu', 2, false, 3), battlefieldRewardFor(2, false));
});

test('讨董：地图沿用官渡的河与渡口，虎牢关（15,15）位于渡口上，可从出生点一路推到洛阳', () => {
  assert.equal(battlefieldPassable(15, 15), true);
  assert.equal(battlefieldPathSteps(3, 15, 23, 15), 20);
  assert.equal(BATTLEFIELD_LVBU_BONUS.atkPercent, 20);
  assert.equal(BATTLEFIELD_LVBU_BONUS.defPercent, 20);
});

test('赤壁：风向每 6 小时交替，落后补齐到 now 之后的第一个切换点', () => {
  const t0 = new Date('2026-11-03T20:00:00+08:00');
  const next = new Date(t0.getTime() + BATTLEFIELD_WIND_MS);
  // 未到切换点：不变
  const early = battlefieldAdvanceWind('se', next, new Date(next.getTime() - 1000));
  assert.deepEqual([early.wind, early.switched, early.nextAt.getTime()], ['se', false, next.getTime()]);
  // 到点切一次
  const once = battlefieldAdvanceWind('se', next, next);
  assert.deepEqual([once.wind, once.switched, once.nextAt.getTime()], ['nw', true, next.getTime() + BATTLEFIELD_WIND_MS]);
  // Worker 停了 13 小时：一次性补到 se → nw → se → nw 的正确状态（切换三次）
  const late = battlefieldAdvanceWind('se', next, new Date(next.getTime() + 13 * 3_600_000));
  assert.equal(late.wind, 'nw');
  assert.equal(late.nextAt.getTime(), next.getTime() + 18 * 3_600_000);
  assert.equal(battlefieldInitialWind(() => 0.1), 'se');
  assert.equal(battlefieldInitialWind(() => 0.9), 'nw');
});

test('赤壁：风向预告在切换前 30 分钟发一次', () => {
  const nextAt = new Date('2026-11-04T02:00:00+08:00');
  assert.equal(BATTLEFIELD_WIND_NOTICE_MS, 30 * 60 * 1000);
  assert.equal(battlefieldWindNoticeDue(nextAt, new Date(nextAt.getTime() - 31 * 60 * 1000), false), false);
  assert.equal(battlefieldWindNoticeDue(nextAt, new Date(nextAt.getTime() - 30 * 60 * 1000), false), true);
  assert.equal(battlefieldWindNoticeDue(nextAt, new Date(nextAt.getTime() - 5 * 60 * 1000), true), false);
});

test('赤壁：顺风方远程兵种与床弩射程 +10%（风向走科技乘数入口）', () => {
  assert.deepEqual(battlefieldWindTech('se', 'yuan'), { rangedRangePercent: 10 });
  assert.equal(battlefieldWindTech('se', 'cao'), null);
  assert.deepEqual(battlefieldWindTech('nw', 'cao'), { rangedRangePercent: 10 });
  assert.equal(battlefieldWindTech('nw', 'yuan'), null);
});

test('赤壁：火攻伤害 = 守军总生命的 20%，按兵种生命比例写入余伤池，余数留给下一次', () => {
  // militia 生命 450：3 个义兵的 20% 生命 = 270，不够折算 1 个
  const first = battlefieldFireDamage({ militia: 3 }, {}, 0.2);
  assert.equal(first.kills.militia ?? 0, 0);
  assert.equal(first.wounds.militia, 270);
  // 第二次火攻累计：270 + 270 = 540 → 折算 1 个，余 90
  const second = battlefieldFireDamage({ militia: 3 }, first.wounds, 0.2);
  assert.equal(second.kills.militia, 1);
  assert.equal(second.wounds.militia, 90);
  // 10 个义兵一次火攻：20% 生命 = 900 → 2 个阵亡，无余数
  const big = battlefieldFireDamage({ militia: 10 }, {}, 0.2);
  assert.equal(big.kills.militia, 2);
  assert.equal(big.wounds.militia, undefined);
  // 连锁翻倍：40% 生命 → 10 个义兵阵亡 4 个
  assert.equal(battlefieldFireHpRatio(true), 0.4);
  assert.equal(battlefieldFireDamage({ militia: 10 }, {}, battlefieldFireHpRatio(true)).kills.militia, 4);
  // 整队打光时余伤清零
  assert.equal(battlefieldFireDamage({ militia: 1 }, { militia: 400 }, 0.2).kills.militia, 1);
  assert.equal(battlefieldFireDamage({ militia: 1 }, { militia: 400 }, 0.2).wounds.militia, undefined);
  // 没打光时余伤保留
  assert.equal(battlefieldFireDamage({ militia: 1 }, { militia: 100 }, 0.2).wounds.militia, 190);
});

test('赤壁：火攻冷却 2 小时，连锁 6 小时，连锁期间守军伤害 −15%', () => {
  const now = new Date('2026-11-04T12:00:00+08:00');
  assert.equal(BATTLEFIELD_FIRE_COOLDOWN_MS, 2 * 3_600_000);
  assert.equal(battlefieldFireReady(null, now), true);
  assert.equal(battlefieldFireReady(new Date(now.getTime() + 1000), now), false);
  assert.equal(battlefieldFireReady(new Date(now.getTime() - 1000), now), true);
  assert.equal(BATTLEFIELD_CHAIN_MS, 6 * 3_600_000);
  assert.equal(battlefieldChainActive(new Date(now.getTime() + 1000), now), true);
  assert.equal(battlefieldChainActive(now, now), false);
  assert.equal(battlefieldChainActive(null, now), false);
  assert.equal(BATTLEFIELD_CHAIN_DEFENSE_PERCENT, 15);
});

test('赤壁：铁骑兵 20（800 军功，每场限 1）只在赤壁货架上', () => {
  const chibi = battlefieldShopItems('chibi');
  const iron = chibi.find((item) => item.item === 'iron_cavalry');
  assert.deepEqual([iron?.cost, iron?.limit, iron?.count, iron?.troop], [800, 1, 20, 'iron_cavalry']);
  assert.equal(battlefieldShopItems('guandu').length, BATTLEFIELD_SHOP.length);
  assert.equal(battlefieldShopItems('guandu').some((item) => item.item === 'iron_cavalry'), false);
  assert.equal(battlefieldShopDef('iron_cavalry', 'guandu'), undefined);
  assert.equal(battlefieldShopDef('iron_cavalry', 'chibi')?.cost, 800);
});

test('赤壁：据点相邻 = 曼哈顿距离 ≤ 10；地图 10 个据点，双方大营之间有渡口可通', () => {
  const chibi = battlefieldStrongholds('chibi');
  assert.equal(chibi.length, 10);
  const byId = new Map(chibi.map((def) => [def.id, def]));
  assert.equal(battlefieldNeighbors(byId.get('sun_4')!, byId.get('cao_4')!), true);
  assert.equal(battlefieldNeighbors(byId.get('sun_base')!, byId.get('cao_base')!), false);
  assert.notEqual(battlefieldPathSteps(2, 15, 27, 15), null);
});

test('赤壁：视图带风向与预告时刻，其他剧本没有风向', () => {
  const nextAt = new Date('2026-11-04T02:00:00+08:00');
  const row = {
    id: 'e1',
    script: 'chibi',
    signup_start: new Date('2026-11-03T20:00:00+08:00'),
    start_at: new Date('2026-11-04T20:00:00+08:00'),
    end_at: new Date('2026-11-05T20:00:00+08:00'),
    status: 'active',
    winner_camp: null,
    finish_reason: null,
    underdog_camp: null,
    underdog_multiplier: 1,
    score_yuan: 0,
    score_cao: 0,
    wind: 'se',
    wind_next_at: nextAt,
    wind_notice_at: null,
  } as unknown as BattlefieldEventRow;
  const counts = { yuan: { signups: 3, entered: 2 }, cao: { signups: 4, entered: 4 } };
  const view = battlefieldEventView(row, counts);
  assert.equal(view.script, 'chibi');
  assert.equal(view.name, '赤壁之战');
  assert.equal(view.camps.yuan.name, '孙刘联军');
  assert.equal(view.wind?.direction, 'se');
  assert.equal(view.wind?.bonusCamp, 'yuan');
  assert.equal(view.wind?.nextAt, nextAt.toISOString());
  assert.equal(view.wind?.noticeAt, new Date(nextAt.getTime() - 30 * 60 * 1000).toISOString());
  const guandu = battlefieldEventView({ ...row, script: 'guandu' } as BattlefieldEventRow, counts);
  assert.equal(guandu.wind, null);
  assert.equal(guandu.camps.yuan.name, '袁绍军');
});

test('轮换与报名窗口对齐：锚点周的报名窗口即官渡，其余基础规则未变', () => {
  const window = battlefieldWindow(new Date(BATTLEFIELD_SCRIPT_ANCHOR_MS));
  assert.equal(window.signupStart.getTime(), BATTLEFIELD_SCRIPT_ANCHOR_MS);
  assert.equal(battlefieldScriptForSignupStart(window.signupStart), 'guandu');
  assert.equal(battlefieldEntryPopulation({ militia: 1 }), 1);
  assert.equal(BATTLEFIELD_ENTRY_POPULATION, 3000);
  assert.equal(battlefieldRankReward(11), null);
  assert.equal(BATTLEFIELD_SECONDS_PER_TILE, 60);
  assert.equal(BATTLEFIELD_MAX_SQUADS, 3);
  assert.deepEqual(battlefieldUnderdog(10, 10), null);
  assert.equal(splitBattlefieldDefenderLosses({}, [], {}).npcLosses.militia, 0);
  assert.equal(armyPower({ militia: 1 }) > 0, true);
});

// AISLG-202：rewards.progressTiers 是讨董的全服进度档，官渡 / 赤壁按文档返回空数组
test('奖励表：只有讨董带 progressTiers，官渡与赤壁为空数组', () => {
  const dongzhuo = battlefieldRewardsView('dongzhuo');
  assert.equal(dongzhuo.progressTiers.length, 3);
  assert.deepEqual(
    dongzhuo.progressTiers.map((tier) => tier.label),
    ['破汜水关', '破虎牢关', '攻下洛阳'],
  );
  for (const script of ['guandu', 'chibi'] as const) {
    const rewards = battlefieldRewardsView(script);
    assert.deepEqual(rewards.progressTiers, [], `${script} 不应返回讨董进度档`);
    // 胜负 / 名次奖励各剧本一致，不随进度档一起清空
    assert.equal(rewards.winner.gold, dongzhuo.winner.gold);
    assert.deepEqual(rewards.rankTiers, dongzhuo.rankTiers);
  }
});
