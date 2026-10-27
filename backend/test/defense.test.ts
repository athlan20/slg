// 城防器械（v73，AISLG-193）：规则出口与战斗引擎的用量 / 伤害 / 库存语义。

import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateBattle } from '../common/src/battle-engine';
import {
  DEFENSE_INFO,
  DEFENSE_KINDS,
  defenseCap,
  defenseCost,
  defenseTotal,
  startDefenseCraft,
  type DefenseStock,
} from '../common/src/city-defense';
import { degradeDefenses } from '../common/src/city-defense-db';

const RICH = { gold: 99999, wood: 99999, food: 99999, stone: 99999, iron: 99999 };
const rng = () => 0.5;

test('库存上限 = 城墙等级 × 60，四种器械共用；成本 = 单件 × 件数', () => {
  assert.equal(defenseCap(0), 0);
  assert.equal(defenseCap(10), 600);
  assert.equal(defenseCap(20), 1200);
  assert.equal(defenseCap(25), 1500, '名城 25 级城墙');
  assert.equal(defenseCost('trap', 3).wood, 180);
  assert.equal(defenseCost('boulder', 2).stone, 760);
  assert.equal(defenseTotal({ trap: 2, chevaux: 3, rolling_log: 1, boulder: 4 }), 10);
});

test('打造校验顺序：城墙 → 库存上限 → 队列 → 资源', () => {
  assert.equal(startDefenseCraft('trap', 1, 0, 0, 0, RICH, 0, 0).ok, false);
  const noWall = startDefenseCraft('trap', 1, 0, 0, 0, RICH, 0, 0);
  assert.equal(!noWall.ok && noWall.code, 'WALL_NOT_BUILT');
  const full = startDefenseCraft('trap', 51, 10, 500, 50, RICH, 0, 0);
  assert.equal(!full.ok && full.code, 'DEFENSE_STOCK_FULL');
  const queueFull = startDefenseCraft('trap', 1, 10, 0, 0, RICH, 1, 2);
  assert.equal(!queueFull.ok && queueFull.code, 'DEFENSE_QUEUE_FULL');
  const poor = startDefenseCraft('trap', 10, 10, 0, 0, { ...RICH, iron: 0 }, 0, 0);
  assert.equal(!poor.ok && poor.code, 'INSUFFICIENT_RESOURCES');
  const ok = startDefenseCraft('trap', 10, 10, 0, 0, RICH, 0, 0);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.mode, 'start');
  const queued = startDefenseCraft('trap', 10, 10, 0, 0, RICH, 1, 0);
  assert.equal(queued.ok && queued.mode, 'queued');
});

test('侦察三档：rough 只有有 / 无、kinds 给种类、exact 给件数', () => {
  const stock: DefenseStock = { trap: 5, chevaux: 0, rolling_log: 2, boulder: 0 };
  assert.deepEqual(degradeDefenses(stock, 'rough'), { detail: 'rough', has: true });
  const kinds = degradeDefenses(stock, 'kinds');
  assert.equal(kinds.detail, 'kinds');
  assert.equal(kinds.has, true);
  assert.deepEqual(kinds.kinds, ['trap', 'rolling_log']);
  assert.deepEqual(degradeDefenses(stock, 'exact').counts, { trap: 5, chevaux: 0, rolling_log: 2, boulder: 0 });
  assert.deepEqual(degradeDefenses({}, 'rough'), { detail: 'rough', has: false });
});

test('陷阱 / 拒马开战即结算：按需使用、按总生命比例分摊、库存不足只用库存', () => {
  const result = simulateBattle({ militia: 10 }, { swordsman: 10 }, { siege: true, rng, defenses: { trap: 2 }, maxRounds: 1 });
  const trap = result.defenseUse.find((entry) => entry.kind === 'trap');
  assert.ok(trap);
  assert.equal(trap.used, 2);
  assert.equal(trap.damage, 1000);
  assert.equal(trap.killed, 2, '500 × 2 ÷ 义兵 450 生命 = 2 人');
  assert.ok(result.attacker.losses.militia >= 2);
});

test('库存充足时陷阱按需用到打光对口兵种（不浪费），无对口兵种不消耗', () => {
  const wipe = simulateBattle({ militia: 10 }, { swordsman: 10 }, { siege: true, rng, defenses: { trap: 100 } });
  const trap = wipe.defenseUse.find((entry) => entry.kind === 'trap');
  assert.ok(trap);
  assert.equal(trap.used, 9, '10 × 450 生命 ÷ 500 → 9 件足够');
  assert.equal(trap.killed, 10);
  assert.equal(wipe.attackerWon, false);
  assert.equal(wipe.endReason, 'attacker_wiped');

  const noCavalry = simulateBattle({ militia: 10 }, { swordsman: 10 }, { siege: true, rng, defenses: { chevaux: 50 }, maxRounds: 1 });
  assert.equal(noCavalry.defenseUse.length, 0, '攻方没有骑兵，一件拒马都不用');
});

test('滚木贴墙时结算，擂石先击毁冲车；非攻城战不触发', () => {
  const logs = simulateBattle({ militia: 10 }, { swordsman: 10 }, { siege: true, rng, defenses: { rolling_log: 20 }, maxRounds: 20 });
  const log = logs.defenseUse.find((entry) => entry.kind === 'rolling_log');
  assert.ok(log);
  assert.equal(log.used, 12, '10 × 450 ÷ 400 = 12 件打光贴墙近战');
  assert.equal(log.killed, 10);
  assert.ok(logs.roundLog.some((entry) => (entry.defenseDamage ?? 0) > 0));

  const ram = simulateBattle({ militia: 10, siege_ram: 2 }, { swordsman: 10 }, { siege: true, rng, defenses: { boulder: 5 }, maxRounds: 20 });
  const boulder = ram.defenseUse.find((entry) => entry.kind === 'boulder');
  assert.ok(boulder);
  assert.equal(boulder.used, 2, '2 辆冲车 × 1500 生命 ÷ 1500 → 2 件');
  assert.equal(boulder.killed, 2);
  assert.equal(boulder.damage, 3000);

  const field = simulateBattle({ militia: 10 }, { swordsman: 10 }, { siege: false, rng, defenses: { trap: 50, chevaux: 50, rolling_log: 50, boulder: 50 }, maxRounds: 20 });
  assert.deepEqual(field.defenseUse, [], '野地遭遇战 / 非攻城战不触发器械');
});

test('四种器械的数值与需求表一致', () => {
  assert.equal(DEFENSE_INFO.trap.damage, 500);
  assert.equal(DEFENSE_INFO.chevaux.damage, 800);
  assert.equal(DEFENSE_INFO.rolling_log.damage, 400);
  assert.equal(DEFENSE_INFO.boulder.damage, 1500);
  assert.deepEqual(DEFENSE_KINDS, ['trap', 'chevaux', 'rolling_log', 'boulder']);
});
