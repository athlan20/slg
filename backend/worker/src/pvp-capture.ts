// 玩家打玩家的名将被俘判定（v93，AISLG-228）。只在 pvp-raid（攻城）/ pvp-conquer（攻占分城）/ pvp-tile（抢野地）
// 的战斗结算之后调用，NPC、黄巾、竞技场、将星塔、战场都不走这里（settleMarchHero 本身不判定被俘）：
// - 攻方战败 → 随队名将（march.hero_id）可能被俘，胜方为守方账号；被俘后 march.hero_id 清空，返程不再携带；
// - 攻方胜、守城失守 → 城守名将（guardHeroId）可能被俘，胜方为攻方账号。
// 每场战斗至多判定一名（攻守结果互斥）。规则与随机数注入见 common/src/hero-capture-db.ts。

import pg from 'pg';
import { tryCaptureHero } from '../../common/src/hero-capture-db';
import type { MarchRow, TileNotify } from './tick-shared';

export async function captureAfterPvpBattle(
  client: pg.PoolClient,
  opts: {
    march: MarchRow;
    attackerWon: boolean;
    defenderAccountId: string;
    /** 守方城（野地战无城，为 null） */
    cityId: string | null;
    /** 守城的城守名将（攻方胜时才可能被俘；无城守为 null） */
    guardHeroId: string | null;
    notifies: TileNotify[];
    /** 测试注入随机数；缺省 Math.random */
    rng?: () => number;
  },
): Promise<void> {
  const { march } = opts;
  let outcome = null;
  if (!opts.attackerWon && march.hero_id) {
    outcome = await tryCaptureHero(client, {
      heroId: march.hero_id,
      captorAccountId: opts.defenderAccountId,
      cityId: opts.cityId,
      rng: opts.rng,
    });
    if (outcome) {
      // 随队名将已被俘：残部返程不再携带该武将
      march.hero_id = null;
    }
  } else if (opts.attackerWon && opts.guardHeroId) {
    outcome = await tryCaptureHero(client, {
      heroId: opts.guardHeroId,
      captorAccountId: march.account_id,
      cityId: opts.cityId,
      rng: opts.rng,
    });
  }
  if (!outcome) {
    return;
  }
  const data = { reason: 'captured', heroId: outcome.heroId, heroName: outcome.heroName };
  opts.notifies.push({ reason: 'hero_state', accountId: outcome.ownerAccountId, data });
  opts.notifies.push({ reason: 'hero_state', accountId: outcome.captorAccountId, data });
  if (outcome.broadcast) {
    opts.notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: outcome.broadcast });
  }
}
