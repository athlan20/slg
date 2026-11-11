// 打老巢的到达结算（AISLG-241，v101）：一次只打当前一营，走守城战（城墙减伤 50%）。
// 需求第一节 / 第二节逐条：
// - 当前营的守军打掉多少算多少，打输也保留残血（写法与 yt_camps 的 remaining / remaining_at 一致）；
// - 这一营清空才进入下一营，已打掉的营不会回来（faction_lairs.camps_remaining 只减不增，24 小时无人进攻才恢复）；
// - 歼灭奖励：每歼灭 1 点守军战力金币 2、四种资源各 10，直接入账到出征城、不占负重（打输也发，幸存为 0 也发）；
// - 声望按歼灭战力的 1%（不走世界地图 1:1 的规则，因此先自己入账再把数值写进战报）；
// - 最后一营打掉 = 这家本季灭亡（worker/src/faction-lair-destroy.ts），最后一击的玩家拿首领名将。
// 锁序沿用全栈：出发城 → 目标地块（调用方已锁）→ faction_lairs 行。
// faction_enabled 关闭时整模块不动作（调用方按开关决定是否走这里）。

import type pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { armyPower, resolveBattle } from '../../common/src/battle';
import { splitBattleCasualties } from '../../common/src/battle-casualties';
import { recordPoolTroops } from '../../common/src/troop-pools-db';
import { combatTechBonus } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { factionBannerOf, factionNameOf } from '../../common/src/faction';
import {
  FACTION_LAIR_CAMPS,
  FACTION_LAIR_WALL_PERCENT,
  factionLairCampLabel,
  factionLairCampNo,
  factionLairCurrentCampPower,
  factionLairGarrison,
  factionLairKillReward,
  factionLairPrestige,
  factionLairRemainingPercent,
} from '../../common/src/faction-lair';
import { addFactionContribution, lockFactionLairRow, recoverLairRow } from '../../common/src/faction-lair-db';
import { addPrestige } from '../../common/src/nobility-db';
import { insertEvent } from '../../common/src/events';
import {
  completeMarchEvent,
  createReturnMarch,
  creditLoot,
  loadCityNaming,
  loadMarchHeroBonus,
  markMarchArrived,
  saveBattleReport,
  settleMarchHero,
  type MarchRow,
  type TileNotify,
} from './tick-shared';
import { destroyFactionLair } from './faction-lair-destroy';
import { notifySuppressionChange } from './faction-suppression-notify';
import type { TroopKind } from '../../common/src/protocol';
import type { FactionKey } from '../../common/src/protocol-faction';

/** 一次进攻的结果（测试与日志用；gone = 老巢已灭亡 / 战况行缺失，部队原路返回） */
export type FactionLairBattleOutcome = 'won' | 'lost' | 'destroyed' | 'gone';

export interface FactionLairBattleResult {
  outcome: FactionLairBattleOutcome;
  /** 本场歼灭的守军战力（贡献榜与奖励的计量口径） */
  killedPower: number;
  /** 本场发放的歼灭奖励（打输也有） */
  reward: { gold: number; wood: number; food: number; stone: number; iron: number } | null;
  /** 结算后剩余营数（gone 时为 null） */
  campsRemaining: number | null;
  reportId: number | null;
}

/**
 * 一场打老巢的战斗（调用方持有事务，并已按锁序锁住出发城与目标地块）。
 * now 由调用方决定：Worker 用数据库时钟，测试可注入固定时刻（同一 now 驱动恢复与残血记录）。
 */
export async function resolveFactionLairBattle(
  client: pg.PoolClient,
  args: {
    march: MarchRow;
    troops: Partial<Record<TroopKind, number>>;
    key: FactionKey;
    now: Date;
    notifies: TileNotify[];
    settled: { row: { x: number | null; y: number | null } | null };
  },
): Promise<FactionLairBattleResult> {
  const { march, troops, notifies } = args;
  const banner = factionBannerOf(args.key);
  // 1) 锁战况行；已灭亡 / 缺失 = 废墟，部队原路返回（不战斗、不奖励）
  let lair = await lockFactionLairRow(client, args.key);
  if (!lair || lair.destroyed_at) {
    return { outcome: 'gone', killedPower: 0, reward: null, campsRemaining: null, reportId: null };
  }
  // 2) 开打前先补一次「24 小时没人进攻恢复 1 营」（与定时器同口径）
  lair = await recoverLairRow(client, lair, args.now);
  const campsTotal = lair.camps_total || FACTION_LAIR_CAMPS;
  const campNo = factionLairCampNo(campsTotal, lair.camps_remaining);
  // v106（AISLG-247）：守军按「当前营序号」取 Gk（20 营由弱到强），没有单一的每营战力了
  const campPower = factionLairCurrentCampPower(lair);
  const defender = lair.remaining ?? factionLairGarrison(campPower);

  // 3) 守城战（城墙减伤 50%，攻方随队武将与科技生效；守方是 NPC，无武将 / 科技 / 城防器械）
  const hero = await loadMarchHeroBonus(client, march, Object.values(troops).reduce((sum, n) => sum + Math.max(0, n ?? 0), 0));
  const techs = await loadTechLevels(client, march.account_id);
  const result = resolveBattle(troops, defender, {
    siege: true,
    wallDefensePercent: FACTION_LAIR_WALL_PERCENT,
    attackerHero: hero?.engine ?? null,
    attackerTech: combatTechBonus(techs),
  });

  // 4) 伤兵 / 俘虏：守军是 NPC，攻方按玩家口径拆（与黄巾营地同一套）
  const casualties = splitBattleCasualties(result, false, true);
  await recordPoolTroops(client, march.from_city_id, 'wounded', casualties.attacker.wounded);
  if (casualties.winner === 'attacker') {
    await recordPoolTroops(client, march.from_city_id, 'captive', casualties.captives);
  }

  // 5) 歼灭奖励（按守方实际损失算战力；打输也发，幸存为 0 也发；不占负重）与贡献
  const killedPower = Math.floor(armyPower(result.defender.losses));
  const reward = factionLairKillReward(killedPower);
  let credited: FactionLairBattleResult['reward'] = null;
  if (killedPower > 0) {
    const cityExists = await client.query(`SELECT 1 FROM cities WHERE id = $1`, [march.from_city_id]);
    if (cityExists.rowCount) {
      await creditLoot(client, march.from_city_id, reward);
      credited = reward;
    }
    await addFactionContribution(client, args.key, march.account_id, killedPower);
  }

  // 6) 声望：歼灭战力的 1%（不走 saveBattleReport 的 1:1 默认值，这里自己入账再把数值写进战报）
  const prestigeGained = factionLairPrestige(killedPower);
  if (prestigeGained > 0) {
    const prestige = await addPrestige(client, march.account_id, prestigeGained, 'faction_lair');
    if (prestige.broadcast) {
      notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: prestige.broadcast });
    }
  }

  // 7) 战报
  const naming = await loadCityNaming(client, march.from_city_id);
  const attackerName = naming ? `${naming.username} · ${naming.cityName}` : '出征部队';
  const defenderName = factionLairCampLabel(factionNameOf(args.key), campNo);
  const reportId = await saveBattleReport(
    client,
    march.account_id,
    'attacker',
    result.attackerWon,
    'faction_lair',
    march.x,
    march.y,
    result,
    attackerName,
    defenderName,
    FACTION_LAIR_WALL_PERCENT,
    notifies,
    hero?.report ?? null,
    null,
    null,
    prestigeGained,
    casualties,
  );
  const heroSettle = await settleMarchHero(client, march, result, notifies);

  // 8) 写回老巢战况：打掉的营不会回来；打输保留残血；last_battle_at 供 24 小时恢复计时
  let destroyed = false;
  let campsRemaining = lair.camps_remaining;
  if (result.attackerWon) {
    campsRemaining = Math.max(0, lair.camps_remaining - 1);
    destroyed = campsRemaining <= 0;
    await client.query(
      `UPDATE faction_lairs SET camps_remaining = $2, remaining = NULL, remaining_at = NULL, last_battle_at = $3
       WHERE key = $1`,
      [args.key, campsRemaining, args.now],
    );
  } else {
    await client.query(
      `UPDATE faction_lairs SET remaining = $2::jsonb, remaining_at = $3, last_battle_at = $3 WHERE key = $1`,
      [args.key, JSON.stringify(result.defender.survivors), args.now],
    );
  }

  // 8.5) v107（AISLG-249）：打掉一营跨过档位（第 5 / 10 / 15 营）时全服播报一句；
  // 最后一击的灭亡另有 faction_lair_destroyed，不在这里重复播
  if (!destroyed) {
    const suppression = await notifySuppressionChange(client, {
      key: args.key,
      campsTotal,
      campsBefore: lair.camps_remaining,
      campsAfter: campsRemaining,
    });
    if (suppression) {
      notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: suppression.broadcast });
    }
  }

  // 9) 行军收尾：幸存部队（可能为 0）返程；战败也保留残血与奖励
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, result.attacker.survivors, args.settled, march.initiator);
  await completeMarchEvent(client, march, result.attackerWon ? 'lair_won' : 'lair_lost', {
    troops,
    survivors: result.attacker.survivors,
    losses: result.attacker.losses,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(defender),
    reportId,
    faction: banner,
    campNo,
    campsTotal,
    campsRemaining,
    killedPower,
    reward: credited,
    returning,
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  });
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: march.from_city_id,
    type: EventType.FACTION_LAIR_BATTLE,
    initiator: null,
    detail: {
      x: march.x,
      y: march.y,
      faction: banner,
      campNo,
      campsTotal,
      campsRemaining,
      killedPower,
      reward: credited,
      reportId,
      outcome: result.attackerWon ? 'won' : 'lost',
      destroyed,
    },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  if (banner) {
    notifies.push({
      reason: 'faction_lair',
      accountId: '',
      data: {
        reason: 'attacked',
        faction: banner,
        campsTotal,
        campsRemaining,
        campRemainingPercent: destroyed
          ? 0
          : result.attackerWon
            ? 100
            : factionLairRemainingPercent(result.defender.survivors, campPower),
        destroyed,
      },
    });
  }

  // 10) 最后一营清空：势力本季灭亡（播报 / 势力城变回 NPC 城 / 围攻作废 / 名将 / 灭亡奖励）
  if (destroyed) {
    await destroyFactionLair(client, { key: args.key, accountId: march.account_id, now: args.now, notifies });
  }
  return {
    outcome: destroyed ? 'destroyed' : result.attackerWon ? 'won' : 'lost',
    killedPower,
    reward: credited,
    campsRemaining,
    reportId,
  };
}
