// NPC 袭击玩家主城的结算（v21，AISLG-32 方案 A）。从 battle-tick.ts 拆出以控制
// 单文件行数；袭击目标选择与野地袭击路径在 battle-tick.ts 的 processNpcRaid。
// 设计（云效 AISLG-32 设计方案，方案 A 拍板）：
// - 袭击主城走守城战（引擎 siege 模式）：守方贴墙布阵，城墙 defenseBonus 生效，
//   城墙与仓库两个「占位建筑」自此有真实消费方；
// - NPC 攻破（驻军全灭）后按被掠城仓库等级结算可掠量（plunder.ts 的 cityPlunderPool：
//   四资源扣仓库保护、金币不受保护但单次最多抢存量 5%，v41 AISLG-125），按幸存 NPC
//   部队负重装填（金→粮→木→石→铁）后扣减城池资源；
// - 袭击编成 = npcRaidArmy(官府等级)，压力与该城成长同步；官府 Lv1（新号）不在
//   目标池（battle-tick 的选择过滤），构成新号缓冲；
// - 主城被掠不改归属、无占领变化；事件 npc_raid（target='city'，含 loot）+
//   守方视角战报（kind='city_raid'）。玩家互掠仍随玩家对抗阶段接入。

import { defenseExtraPercent } from '../../common/src/tech';
import { towerStats } from '../../common/src/building-effects';
import { loadTechLevels } from '../../common/src/tech-db';
import pg from 'pg';
import { DEFAULT_NPC_RAID_INTERVAL_MS } from './world-tick';
import { scaledMs } from '../../common/src/time-scale';
import { EventType, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, cityRaidLevel, npcRaidArmy, resolveBattle, wallDefensePercent } from '../../common/src/battle';
import { TROOP_INFO } from '../../common/src/troops';
import { cityPlunderPool, loadByCarry } from '../../common/src/plunder';
import { insertServerBroadcast, recordWinStreak } from '../../common/src/server-broadcast';
import { loadBuildingLevels } from '../../common/src/production';
import { loadCityNaming, saveBattleReport, settleOwnerCity, heroBattleView, type TileNotify } from './tick-shared';
import { battleBonusOf, grantHeroExp, loadCityGuard } from '../../common/src/hero-db';

export interface NpcCityRaidTarget {
  cityId: string;
  accountId: string;
  x: number;
  y: number;
  govLevel: number;
}

/** 发起时固定的袭击编成与强度（v23 AISLG-57 两阶段：预警先行，到达按固定编成结算） */
export interface NpcCityRaidArmy {
  army: Partial<Record<TroopKind, number>>;
  raidLevel: number;
}

/** 免战时长 = 2 × NPC 袭击基准间隔（随 timeScale 缩放；v22 AISLG-40 方案 A） */
const CITY_TRUCE_RAID_MULTIPLE = 2;

/** 主城被攻破后的免战截止时刻：每次 garrison_lost 重置（连续攻破不消耗免战，重新计满）。
 *  环境变量 NPC_RAID_INTERVAL_MS 覆盖间隔时免战同步跟随且不再缩放（显式覆盖优先于缩放，
 *  与 npcRaidIntervalMs 一致；此前覆盖值又被 ÷ scale 一次，AISLG-38 复核修复） */
function truceUntil(): Date {
  const raw = Number(process.env.NPC_RAID_INTERVAL_MS);
  const ms = Number.isFinite(raw) && raw >= 1000
    ? CITY_TRUCE_RAID_MULTIPLE * Math.floor(raw)
    : scaledMs(CITY_TRUCE_RAID_MULTIPLE * DEFAULT_NPC_RAID_INTERVAL_MS);
  return new Date(Date.now() + ms);
}

/** 结算一次 NPC 对玩家主城的袭击（调用方已 BEGIN、锁序 cities → world_tiles）。
 *  precomputed（v23 AISLG-57）提供发起时固定的编成与强度（预警流程）；缺省按
 *  调用时刻的守军战力现推导（兼容旧的一步式调用）。返回 1 = 已结算 */
export async function resolveNpcCityRaid(
  client: pg.PoolClient,
  target: NpcCityRaidTarget,
  notifies: TileNotify[],
  precomputed?: NpcCityRaidArmy,
): Promise<number> {
  const settled = await settleOwnerCity(client, target.cityId);
  if (!settled.row) {
    return 0;
  }
  const levels = await loadBuildingLevels(client, target.cityId);
  const armyRes = await client.query(
    `SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`,
    [target.cityId],
  );
  const garrison: Partial<Record<TroopKind, number>> = {};
  for (const row of armyRes.rows as { troop: TroopKind; count: number }[]) {
    garrison[row.troop] = row.count;
  }

  // v27（AISLG-77）：玩家主城守城再加城防科技的额外减伤（NPC 城墙不吃）
  const wall = wallDefensePercent(levels.wall ?? 0, defenseExtraPercent(await loadTechLevels(client, target.accountId)));
  // v22 AISLG-40 方案 B：袭击强度按守军战力推导（下限官府一半、上限官府等级），
  // 不再用官府建筑等级——升官府（经济行为）不再自动放大挨打规模；
  // v23 两阶段流程下编成在发起时固定，到达不重算（预警期间征兵提高的是守方战力）
  const garrisonPower = armyPower(garrison);
  const raidLevel = precomputed ? precomputed.raidLevel : cityRaidLevel(garrisonPower, target.govLevel);
  const attacker = precomputed ? precomputed.army : npcRaidArmy(raidLevel);
  // v30（AISLG-82）：箭塔只在守城战（NPC 袭击主城）生效，等级取被袭击城自己的箭塔
  // v36（AISLG-115）：城守加成（守军攻击 / 减伤同出征口径，按守军规模折算统率摊薄）
  const guard = await loadCityGuard(client, target.cityId);
  const garrisonTotal = Object.values(garrison).reduce((sum, n) => sum + (n ?? 0), 0);
  const guardBonus = battleBonusOf(guard, garrisonTotal);
  const result = resolveBattle(attacker, garrison, {
    wallDefensePercent: wall, siege: true, tower: towerStats(levels.arrow_tower ?? 0),
    defenderHero: guardBonus,
  });
  const npcPower = armyPower(attacker);
  const naming = await loadCityNaming(client, target.cityId);
  const defenderName = naming
    ? `${naming.username} 的主城守军（${naming.cityName}${guard ? ` · 城守 ${guard.name}` : ''}）`
    : '主城守军';
  const reportId = await saveBattleReport(
    client, target.accountId, 'defender', !result.attackerWon, 'city_raid',
    target.x, target.y, result, 'NPC 袭击部队', defenderName, wall, notifies,
    null, guard ? heroBattleView(guard, garrisonTotal) : null,
  );
  // v36（AISLG-116）：城守守城同样获得经验 = 歼灭敌军参考战力（守不住减半）
  if (guard) {
    const gained = Math.floor(armyPower(result.attacker.losses) * (result.attackerWon ? 0.5 : 1));
    const exp = await grantHeroExp(client, guard.id, gained);
    if (exp?.leveledTo) {
      await insertEvent(client, {
        accountId: target.accountId, cityId: target.cityId, buildId: guard.id,
        type: EventType.HERO_LEVEL_UP, initiator: null,
        detail: { heroId: guard.id, heroName: guard.name, level: exp.leveledTo },
      });
    }
    notifies.push({
      reason: 'hero_state', accountId: target.accountId,
      data: { reason: 'exp_gained', heroId: guard.id, exp: { gained, level: exp?.level ?? guard.level, leveledTo: exp?.leveledTo ?? null } },
    });
  }

  // 驻军按战斗结果回写（全灭即清空；守住按幸存数）
  await client.query(`DELETE FROM city_army WHERE city_id = $1`, [target.cityId]);
  const survivors = result.defender.survivors;
  for (const kind of Object.keys(survivors) as TroopKind[]) {
    const count = survivors[kind] ?? 0;
    if (count > 0) {
      await client.query(
        `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`,
        [target.cityId, kind, count],
      );
    }
  }

  if (!result.attackerWon) {
    // 守城成功计入连胜（v23 AISLG-60）
    const streak = await recordWinStreak(client, target.accountId, true, {
      username: naming?.username ?? null,
      cityName: naming?.cityName ?? null,
    });
    if (streak) {
      notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streak });
    }
    await insertEvent(client, {
      accountId: target.accountId,
      cityId: target.cityId,
      type: EventType.NPC_RAID,
      initiator: null,
      detail: {
        x: target.x, y: target.y, target: 'city', level: raidLevel,
        outcome: 'repelled',
        npcPower, garrisonPower, rounds: result.rounds,
        losses: result.defender.losses, reportId,
      },
    });
    return 1;
  }

  // 守城失败清零连胜 + 全服播报「主城被攻破」（v23 AISLG-60）
  await recordWinStreak(client, target.accountId, false, {});
  const brokenBroadcast = await insertServerBroadcast(client, 'city_broken', {
    username: naming?.username ?? null,
    cityName: naming?.cityName ?? null,
    x: target.x,
    y: target.y,
  });
  if (brokenBroadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: brokenBroadcast });
  }

  // 攻破：按仓库保护算可掠池，按幸存 NPC 部队负重装填，扣减城池资源（不改归属）
  const pool = cityPlunderPool(
    {
      gold: settled.row.gold,
      wood: settled.row.wood,
      food: settled.row.food,
      stone: settled.row.stone,
      iron: settled.row.iron,
    },
    levels.warehouse ?? 0,
  );
  let carry = 0;
  for (const kind of Object.keys(result.attacker.survivors) as TroopKind[]) {
    carry += (result.attacker.survivors[kind] ?? 0) * TROOP_INFO[kind].carry;
  }
  const loot = loadByCarry(carry, pool);
  await client.query(
    `UPDATE cities SET gold = gold - $2, wood = wood - $3, food = food - $4,
            stone = stone - $5, iron = iron - $6, truce_until = $7 WHERE id = $1`,
    [target.cityId, loot.gold, loot.wood, loot.food, loot.stone, loot.iron, truceUntil()],
  );
  await insertEvent(client, {
    accountId: target.accountId,
    cityId: target.cityId,
    type: EventType.NPC_RAID,
    initiator: null,
    detail: {
      x: target.x, y: target.y, target: 'city', level: raidLevel,
      outcome: 'garrison_lost', loot, truceUntil: truceUntil().toISOString(),
      npcPower, garrisonPower, rounds: result.rounds,
      losses: result.defender.losses, reportId,
    },
  });
  return 1;
}
