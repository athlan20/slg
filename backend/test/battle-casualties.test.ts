// 伤兵 / 俘虏 / 逃兵（v85，AISLG-212）：splitBattleCasualties 的拆分规则与
// 治疗 / 招降 / 劝回的费用公式。纯规则不需要数据库；池子的 FIFO 扣减、过期过滤、
// 城池被占清空需要 TEST_DATABASE_URL（一次性临时库，别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { TROOP_KINDS, type ArmyCounts } from '../common/src/protocol';
import { EMPTY_ARMY } from '../common/src/protocol-doc-army-consts';
import { setTimeScaleCache } from '../common/src/time-scale';
import {
  CAPTURED_PERCENT,
  CAPTIVE_RECRUIT_COST_PERCENT,
  CAPTIVE_TTL_HOURS,
  DESERTER_RECALL_COST_PERCENT,
  DESERTER_TTL_HOURS,
  HEAL_COST_PERCENT,
  WOUNDED_PERCENT,
  WOUNDED_TTL_HOURS,
  capturedOf,
  restoreCost,
  restorePopulationCost,
  splitBattleCasualties,
  woundedOf,
} from '../common/src/battle-casualties';
import { DISBAND_REFUND_PERCENT, TROOP_INFO, disbandRefund } from '../common/src/troops';
import { ensureSchema } from '../common/src/db';
import {
  cleanupExpiredTroopPools,
  clearCityTroopPools,
  consumePoolTroops,
  loadCityTroopPools,
  poolCountOf,
  recordPoolTroops,
} from '../common/src/troop-pools-db';
import { createTempDatabase, type TempDatabase } from './season-test-db';

setTimeScaleCache(1);

function counts(overrides: Partial<ArmyCounts> = {}): ArmyCounts {
  return { ...EMPTY_ARMY, ...overrides } as ArmyCounts;
}

/** 造一个只有 losses 有值的 BattleSideSummary 形状（splitBattleCasualties 只读 losses） */
function sideWithLosses(losses: Partial<ArmyCounts>) {
  return { troops: counts(), losses: counts(losses), survivors: counts(), damage: 0 };
}

function battleOf(
  attackerLosses: Partial<ArmyCounts>,
  defenderLosses: Partial<ArmyCounts>,
  attackerWon: boolean,
  endReason: 'defender_wiped' | 'attacker_wiped' | 'round_limit',
) {
  return { attackerWon, endReason, attacker: sideWithLosses(attackerLosses), defender: sideWithLosses(defenderLosses) };
}

describe('splitBattleCasualties 拆分规则（无需数据库）', () => {
  test('评审定稿数值不得漂移（20% / 10% / 50% / 60% / 50% / 72h / 72h / 24h）', () => {
    assert.equal(WOUNDED_PERCENT, 20);
    assert.equal(CAPTURED_PERCENT, 10);
    assert.equal(HEAL_COST_PERCENT, 50);
    assert.equal(CAPTIVE_RECRUIT_COST_PERCENT, 60);
    assert.equal(DESERTER_RECALL_COST_PERCENT, 50);
    assert.equal(WOUNDED_TTL_HOURS, 72);
    assert.equal(CAPTIVE_TTL_HOURS, 72);
    assert.equal(DESERTER_TTL_HOURS, 24);
  });

  test('防套利约束：治疗不低于遣散返还；招降不低于治疗（改数值先过评审）', () => {
    assert.ok(HEAL_COST_PERCENT >= DISBAND_REFUND_PERCENT, '治疗低于遣散返还 = 治好再遣散净赚资源');
    assert.ok(CAPTIVE_RECRUIT_COST_PERCENT >= HEAL_COST_PERCENT, '招降比治疗贵一档（俘虏要额外扣人口）');
  });

  test('验收 1：玩家攻野地损失 100 长枪兵——伤兵 20；胜后从守军损失抓 10%（基础兵种）', () => {
    const split = splitBattleCasualties(battleOf({ pikeman: 100 }, { militia: 18, archer: 1 }, true, 'defender_wiped'), false, true);
    assert.equal(split.winner, 'attacker');
    // 攻方（玩家）：伤兵 20、没有被俘、阵亡 80
    assert.deepEqual(split.attacker.wounded, counts({ pikeman: 20 }));
    assert.deepEqual(split.attacker.captured, counts());
    assert.deepEqual(split.attacker.dead, counts({ pikeman: 80 }));
    // 胜方（玩家）从守军（NPC）损失抓 10%：militia 18 → 1、archer 1 → 0
    assert.deepEqual(split.captives, counts({ militia: 1 }));
    // NPC 一方无伤兵；captured 展示被抓走的部分；阵亡 = 损失 − 伤兵 − 被俘
    assert.deepEqual(split.defender.wounded, counts());
    assert.deepEqual(split.defender.captured, counts({ militia: 1 }));
    assert.deepEqual(split.defender.dead, counts({ militia: 17, archer: 1 }));
  });

  test('验收 2：玩家 A 攻玩家 B 的城并获胜——B 基础兵种 20% 伤兵 + 10% 被俘 + 70% 阵亡；二期 / 专属兵不抓', () => {
    const split = splitBattleCasualties(
      battleOf({ swordsman: 10 }, { swordsman: 100, iron_cavalry: 100, yulin_guard: 100 }, true, 'defender_wiped'),
      false,
      false,
    );
    assert.deepEqual(split.captives, counts({ swordsman: 10 }));
    // 败方 B：刀盾兵 100 = 20 伤兵 + 10 被俘 + 70 阵亡；铁骑兵 / 羽林卫 = 20 伤兵 + 80 阵亡、不被抓
    assert.deepEqual(split.defender.wounded, counts({ swordsman: 20, iron_cavalry: 20, yulin_guard: 20 }));
    assert.deepEqual(split.defender.captured, counts({ swordsman: 10 }));
    assert.deepEqual(split.defender.dead, counts({ swordsman: 70, iron_cavalry: 80, yulin_guard: 80 }));
    // 胜方 A（玩家）自己损失的 10% 也是伤兵；胜方不丢伤兵到被俘（被俘只属于败方）
    assert.deepEqual(split.attacker.wounded, counts({ swordsman: 2 }));
    assert.deepEqual(split.attacker.captured, counts());
    assert.deepEqual(split.attacker.dead, counts({ swordsman: 8 }));
  });

  test('验收 3a：平局（回合耗尽）不抓俘虏；双方各自的伤兵照常 20%', () => {
    const split = splitBattleCasualties(battleOf({ pikeman: 9 }, { militia: 19 }, false, 'round_limit'), false, false);
    assert.equal(split.winner, null);
    assert.deepEqual(split.captives, counts());
    // 9 × 20% = 1.8 → 1；19 × 20% = 3.8 → 3（按兵种分别向下取整）
    assert.deepEqual(split.attacker.wounded, counts({ pikeman: 1 }));
    assert.deepEqual(split.defender.wounded, counts({ militia: 3 }));
    assert.deepEqual(split.attacker.captured, counts());
    assert.deepEqual(split.defender.captured, counts());
  });

  test('验收 3b：NPC 打赢玩家——玩家照常有 20% 伤兵，NPC 不抓俘虏', () => {
    const split = splitBattleCasualties(battleOf({ archer: 25 }, { militia: 100 }, false, 'attacker_wiped'), false, true);
    assert.equal(split.winner, 'defender');
    assert.deepEqual(split.captives, counts());
    assert.deepEqual(split.attacker.wounded, counts({ archer: 5 }));
    assert.deepEqual(split.attacker.captured, counts());
    assert.deepEqual(split.attacker.dead, counts({ archer: 20 }));
    // NPC 守方自己的损失无伤兵
    assert.deepEqual(split.defender.wounded, counts());
  });

  test('守方（玩家）守住 NPC 袭击——守方从 NPC 损失抓俘虏（败方是 NPC 也抓）', () => {
    const split = splitBattleCasualties(battleOf({ militia: 50 }, { militia: 33, cavalry: 7 }, false, 'attacker_wiped'), true, false);
    assert.equal(split.winner, 'defender');
    // 败方是 NPC 攻方：50 民兵 → 抓 5，全归守方（玩家）的城
    assert.deepEqual(split.captives, counts({ militia: 5 }));
    // 守方（玩家）自己的损失照常有 20% 伤兵；胜方不被抓
    assert.deepEqual(split.defender.wounded, counts({ militia: 6, cavalry: 1 }));
    assert.deepEqual(split.defender.captured, counts());
    assert.deepEqual(split.defender.dead, counts({ militia: 27, cavalry: 6 }));
    // NPC 攻方无伤兵；被抓的 5 从阵亡里扣（50 = 0 伤兵 + 5 被俘 + 45 阵亡）
    assert.deepEqual(split.attacker.wounded, counts());
    assert.deepEqual(split.attacker.captured, counts({ militia: 5 }));
    assert.deepEqual(split.attacker.dead, counts({ militia: 45 }));
  });

  test('基础七兵种可抓，二期四种与名城专属八种不抓（woundedOf / capturedOf 直接断言）', () => {
    const basicLosses = counts({
      porter: 15,
      militia: 15,
      scout: 15,
      pikeman: 15,
      swordsman: 15,
      archer: 15,
      cavalry: 15,
    });
    assert.deepEqual(
      capturedOf(basicLosses),
      counts({ porter: 1, militia: 1, scout: 1, pikeman: 1, swordsman: 1, archer: 1, cavalry: 1 }),
    );
    const phase2AndElite = counts({ iron_cavalry: 100, supply_wagon: 100, ballista: 100, siege_ram: 100, yulin_guard: 100, danyang_soldier: 100 });
    assert.deepEqual(capturedOf(phase2AndElite), counts());
    // 伤兵不挑兵种：二期 / 专属损失同样 20% 进伤兵营
    assert.deepEqual(woundedOf(phase2AndElite), counts({ iron_cavalry: 20, supply_wagon: 20, ballista: 20, siege_ram: 20, yulin_guard: 20, danyang_soldier: 20 }));
    // 不足 5 个不成整（5 × 20% = 1）
    assert.deepEqual(woundedOf(counts({ militia: 4 })), counts());
    assert.deepEqual(woundedOf(counts({ militia: 5 })), counts({ militia: 1 }));
  });
});

describe('治疗 / 招降 / 劝回的费用公式（无需数据库）', () => {
  test('治疗 50%：与遣散返还同口径，多兵种先累加再取整一次', () => {
    // porter 1（金 50 / 木 30 / 粮 30）+ militia 1（金 80 / 木 20 / 粮 50）→ 50%：金 65 / 木 25 / 粮 40
    assert.deepEqual(restoreCost({ porter: 1, militia: 1 }, HEAL_COST_PERCENT), { gold: 65, wood: 25, food: 40, stone: 0, iron: 0 });
    // 验收 5：长枪兵（金 150 / 木 80 / 粮 100 / 铁 50）× 20 人 × 50%
    assert.deepEqual(restoreCost({ pikeman: 20 }, HEAL_COST_PERCENT), { gold: 1500, wood: 800, food: 1000, stone: 0, iron: 500 });
    // 冲车带石成本：× 60% 招降两辆（金 400 / 木 400 / 粮 80 / 石 100 / 铁 100 → 60%）
    assert.deepEqual(restoreCost({ siege_ram: 2 }, CAPTIVE_RECRUIT_COST_PERCENT), { gold: 480, wood: 480, food: 96, stone: 120, iron: 120 });
    // 空编队 / 0 / 负数不计
    assert.deepEqual(restoreCost({ pikeman: 0, militia: -3 } as never, HEAL_COST_PERCENT), { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 });
  });

  test('验收 10：治好立即遣散，资源净变化为 0（任何编队都不赚不亏）', () => {
    for (const kind of TROOP_KINDS) {
      const troops = { [kind]: 3 } as Partial<Record<(typeof TROOP_KINDS)[number], number>>;
      assert.deepEqual(disbandRefund(troops), restoreCost(troops, HEAL_COST_PERCENT), kind);
    }
    assert.deepEqual(disbandRefund({ porter: 2, militia: 3, cavalry: 1 }), restoreCost({ porter: 2, militia: 3, cavalry: 1 }, HEAL_COST_PERCENT));
  });

  test('招降扣人口 = Σ 单兵人口 × 数量（与征兵同口径）；治疗 / 劝回不扣（handler 层恒 0）', () => {
    // 全体兵种 population 均为 1（当前数值）；带量断言口径而非写死 1
    const expected = (['pikeman', 'swordsman', 'siege_ram'] as const).reduce((sum, kind) => sum + TROOP_INFO[kind].population * 10, 0);
    assert.equal(restorePopulationCost({ pikeman: 10, swordsman: 10, siege_ram: 10 }), expected);
    assert.equal(restorePopulationCost({}), 0);
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('城池部队池的 FIFO 扣减、过期过滤与清空（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let cityId: string;

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'trooppool');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    const accountId = (
      await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `trooppool-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      ])
    ).rows[0].id as string;
    cityId = (
      await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城', 1000, 1000, 1000, 610, 610) RETURNING id`, [
        accountId,
      ])
    ).rows[0].id as string;
  });

  after(async () => {
    await pool.end();
    await tmp?.drop();
  });

  test('入账聚合 + FIFO 扣减：先消耗最早的一批；扣空后批次行删除', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await recordPoolTroops(client, cityId, 'wounded', { pikeman: 10 });
      // 第二批更晚到期（手动改 expires_at 模拟时间推进，避免真实 sleep）
      await recordPoolTroops(client, cityId, 'wounded', { pikeman: 10 });
      await client.query(`UPDATE city_troop_pools SET expires_at = now() + interval '10 hours' WHERE id = (SELECT id FROM city_troop_pools WHERE city_id = $1 ORDER BY expires_at, created_at, id DESC LIMIT 1)`, [cityId]);
      await client.query('COMMIT');

      let view = await loadCityTroopPools(client, cityId);
      assert.equal(poolCountOf(view.wounded, 'pikeman'), 20);
      assert.ok(view.wounded.earliestExpireAt !== null);

      // 扣 15：先扣光最早一批（10），再从晚批扣 5
      await client.query('BEGIN');
      await consumePoolTroops(client, cityId, 'wounded', { pikeman: 15 });
      await client.query('COMMIT');
      view = await loadCityTroopPools(client, cityId);
      assert.equal(poolCountOf(view.wounded, 'pikeman'), 5);

      // 只剩晚批：最早过期时间应晚于「立刻过期」
      const rows = await client.query<{ id: string; troops: Partial<ArmyCounts> }>(
        `SELECT id, troops FROM city_troop_pools WHERE city_id = $1 AND pool = 'wounded'`,
        [cityId],
      );
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].troops.pikeman, 5);
    } finally {
      client.release();
    }
  });

  test('过期行读取时过滤、Worker 清理删行', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await recordPoolTroops(client, cityId, 'captive', { militia: 4 });
      await client.query(`UPDATE city_troop_pools SET expires_at = now() - interval '1 minute' WHERE city_id = $1 AND pool = 'captive'`, [cityId]);
      await client.query('COMMIT');
      // 读取侧：过期即视为没有
      const view = await loadCityTroopPools(client, cityId);
      assert.equal(poolCountOf(view.captive, 'militia'), 0);
      assert.equal(view.captive.earliestExpireAt, null);
      // Worker 周期清理删行
      const deleted = await cleanupExpiredTroopPools(pool);
      assert.ok(deleted >= 1);
      const left = await pool.query(`SELECT count(*)::int AS n FROM city_troop_pools WHERE city_id = $1 AND pool = 'captive'`, [cityId]);
      assert.equal(left.rows[0].n, 0);
    } finally {
      client.release();
    }
  });

  test('城池易主 / 消失：clearCityTroopPools 三池一起清空；删城行 CASCADE 兜底', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await recordPoolTroops(client, cityId, 'wounded', { pikeman: 3 });
      await recordPoolTroops(client, cityId, 'captive', { militia: 3 });
      await recordPoolTroops(client, cityId, 'deserter', { porter: 3 });
      await client.query('COMMIT');
      await clearCityTroopPools(client, cityId);
      const view = await loadCityTroopPools(client, cityId);
      assert.equal(view.wounded.earliestExpireAt, null);
      assert.equal(view.captive.earliestExpireAt, null);
      assert.equal(view.deserter.earliestExpireAt, null);
      // 再入账一批，靠 DELETE cities 的 CASCADE 清掉（放弃分城 / 账号重置走这条）
      await client.query('BEGIN');
      await recordPoolTroops(client, cityId, 'deserter', { porter: 2 });
      await client.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
      await client.query('COMMIT');
      const left = await pool.query(`SELECT count(*)::int AS n FROM city_troop_pools WHERE city_id = $1`, [cityId]);
      assert.equal(left.rows[0].n, 0);
    } finally {
      client.release();
    }
  });
});
