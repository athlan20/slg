// 势力灭亡（AISLG-241，v101）：老巢 20 营全部被清空时，这家本季灭亡。需求第三节逐条：
// - 全服播报（带最后一击的玩家名），本季不再吞城（faction-tick 跳过已灭亡的势力）、
//   正在进行的围攻作废（faction_sieges 未结算行置 cancelled）；
// - 势力持有的城全部变回普通 NPC 城：普通的势力城守军与库存从 1.5 倍除回 1 倍，
//   被吞的玩家分城保留建筑与库存（快照上的 fromPlayer 标记），只去掉归属；
// - 原范围内的 NPC 袭击恢复成无旗号（未结算的 npc_attacks 清掉 faction / from_x / from_y）；
// - 老巢地块变成废墟：world_tiles.faction_lair 保留（地图上显示废墟），
//   faction_lairs.destroyed_at 记下灭亡 → 不能再出征 / 侦察 / 占领（FACTION_LAIR_TARGET）；
// - 其他势力的范围不因此扩大：factionAt / factionOwnsTileSql 按坐标判定，灭亡势力仍占着原来那块地的判定，
//   最近的是灭亡势力时返回「无主」（见 faction.ts）；
// - 贡献榜按歼灭战力排名，灭亡时按需求表再发一次（黄巾之乱同名次的 3 倍）；
// - 最后一击的玩家获得该势力首领名将（全服唯一，全服播报）。
// 调用方（faction-lair-battle.ts）持有事务并已锁住 faction_lairs 行。

import type pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { insertServerBroadcast, type ServerBroadcastCreated } from '../../common/src/server-broadcast';
import { factionBannerOf, factionDefOf, factionNameOf, undoFactionSnapshot } from '../../common/src/faction';
import { factionLairDestroyReward, FACTION_LAIR_CAMPS } from '../../common/src/faction-lair';
import { loadFactionContributions } from '../../common/src/faction-lair-db';
import { famousHeroForFaction } from '../../common/src/hero';
import { grantFamousHeroWithBroadcast } from './hero-grant';
import { creditLoot, type TileNotify } from './tick-shared';
import type { NpcCitySnapshot } from '../../common/src/world';
import type { FactionKey } from '../../common/src/protocol-faction';

export interface FactionLairDestroyResult {
  /** 变回普通 NPC 城的座数（含被吞的玩家分城） */
  convertedCities: number;
  /** 作废的在途围攻数 */
  cancelledSieges: number;
  /** 去掉旗号的未结算 NPC 袭击数 */
  clearedAttacks: number;
  /** 拿到灭亡奖励的人数 */
  rewardedPlayers: number;
}

/** 老巢战况收尾（调用方已锁 faction_lairs 行）：标记灭亡 + 逐条联动 */
export async function destroyFactionLair(
  client: pg.PoolClient,
  args: { key: FactionKey; accountId: string; now: Date; notifies: TileNotify[] },
): Promise<FactionLairDestroyResult> {
  const banner = factionBannerOf(args.key);
  const def = factionDefOf(args.key);
  await client.query(
    `UPDATE faction_lairs SET destroyed_at = $2, destroyed_by = $3, camps_remaining = 0, remaining = NULL, remaining_at = NULL
     WHERE key = $1`,
    [args.key, args.now, args.accountId],
  );

  // 1) 势力城变回普通 NPC 城（普通的从 1.5 倍除回；被吞的玩家分城只去掉归属，建筑与库存留着）
  const cities = await client.query(`SELECT x, y, npc FROM world_tiles WHERE kind = 'npc_city' AND npc->>'faction' = $1`, [
    args.key,
  ]);
  let converted = 0;
  for (const row of cities.rows as Array<{ x: number; y: number; npc: NpcCitySnapshot }>) {
    await client.query(`UPDATE world_tiles SET npc = $3::jsonb WHERE x = $1 AND y = $2 AND npc->>'faction' = $4`, [
      row.x,
      row.y,
      JSON.stringify(undoFactionSnapshot(row.npc)),
      args.key,
    ]);
    converted += 1;
  }

  // 2) 在途围攻作废（不再发起由 faction-siege-tick 跳过已灭亡的势力保证）
  const sieges = await client.query(
    `UPDATE faction_sieges SET resolved_at = $2, outcome = 'cancelled'
     WHERE faction = $1 AND resolved_at IS NULL`,
    [args.key, args.now],
  );

  // 3) 未结算的 NPC 袭击恢复成无旗号（全服袭击频率不变，只去掉归属）
  const attacks = await client.query(
    `UPDATE npc_attacks SET faction = NULL, from_x = NULL, from_y = NULL
     WHERE faction = $1 AND resolved_at IS NULL`,
    [args.key],
  );

  // 4) 贡献榜：按歼灭战力排名，灭亡时按需求表再发一次（发到各自的主城）
  const contributions = await loadFactionContributions(client, args.key);
  let rewarded = 0;
  let rank = 0;
  for (const row of contributions) {
    rank += 1;
    const tier = factionLairDestroyReward(rank);
    const city = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [row.accountId]);
    if (!city.rowCount) {
      continue;
    }
    const cityId = (city.rows[0] as { id: string }).id;
    await creditLoot(client, cityId, tier.reward);
    await insertEvent(client, {
      accountId: row.accountId,
      cityId,
      type: EventType.FACTION_LAIR_REWARD,
      initiator: null,
      detail: { faction: banner, rank, power: row.power, tier: tier.label, reward: tier.reward },
    });
    rewarded += 1;
  }

  // 5) 最后一击的玩家：该势力首领名将（全服唯一；已被他人获得则静默跳过）
  const heroDef = famousHeroForFaction(args.key);
  if (heroDef) {
    const heroBroadcasts: ServerBroadcastCreated[] = [];
    await grantFamousHeroWithBroadcast(client, args.accountId, heroDef, args.notifies, heroBroadcasts);
    for (const created of heroBroadcasts) {
      args.notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: created });
    }
  }

  const userRes = await client.query(`SELECT username FROM accounts WHERE id = $1`, [args.accountId]);
  const username = userRes.rowCount ? (userRes.rows[0] as { username: string }).username : null;
  await insertEvent(client, {
    accountId: args.accountId,
    type: EventType.FACTION_LAIR_DESTROYED,
    initiator: null,
    detail: {
      faction: banner,
      factionName: factionNameOf(args.key),
      leader: def?.leader ?? null,
      heroName: heroDef?.name ?? null,
      convertedCities: converted,
      rewardedPlayers: rewarded,
    },
  });

  // 6) 全服播报（必达）：带最后一击的玩家名与势力名
  const broadcast = await insertServerBroadcast(
    client,
    'faction_lair_destroyed',
    {
      username,
      faction: banner,
      factionName: factionNameOf(args.key),
      leader: def?.leader ?? null,
      leaderEn: def?.leaderEn ?? null,
    },
    { force: true },
  );
  if (broadcast) {
    args.notifies.push({ reason: 'server_broadcast', accountId: '', broadcast });
  }
  // 7) 势力面板 / 地图范围：全服在线连接收到「已灭亡」，立刻不再画这家范围
  if (banner) {
    args.notifies.push({
      reason: 'faction_lair',
      accountId: '',
      data: {
        reason: 'destroyed',
        faction: banner,
        campsTotal: FACTION_LAIR_CAMPS,
        campsRemaining: 0,
        campRemainingPercent: 0,
        destroyed: true,
      },
    });
  }
  return {
    convertedCities: converted,
    cancelledSieges: sieges.rowCount ?? 0,
    clearedAttacks: attacks.rowCount ?? 0,
    rewardedPlayers: rewarded,
  };
}
