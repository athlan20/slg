// 出征目标判定的保护 / 免战子判定（v111，AISLG-259 从 march-target.ts 拆出以控制单文件行数）：
// 目标城的主人关系、守方新手保护 / 免战、攻方主动免战、抢占野地的换主保护。
// resolveMarchTarget 与 handleMarch 共用，Worker 到达时另有同口径复核。

import type pg from 'pg';
import { activeAt, inNewbieProtection } from '../../common/src/protection';
import { cannotAttack } from '../../common/src/alliance-db';
import type { TileRow } from '../../common/src/world-db';
import type { MarchTargetVerdict } from './march-target';

/** 目标城（占领野地的城）的主人是否与请求账号同一联盟（v67，AISLG-182）；城不存在返回 false */
export async function isAllyOfCity(client: pg.PoolClient, accountId: string, cityId: string): Promise<boolean> {
  const res = await client.query(`SELECT account_id FROM cities WHERE id = $1`, [cityId]);
  if (!res.rowCount) {
    return false;
  }
  return cannotAttack(client, accountId, (res.rows[0] as { account_id: string }).account_id);
}

/** 目标方（city 行含守方账号的保护列）与进攻方账号的保护 / 免战判定（v38，AISLG-122）；
 *  发起时初核，Worker 到达在锁内复核。通过返回 null */
export async function pvpTargetDenial(
  client: pg.PoolClient,
  accountId: string,
  city: { account_id: string; truce_until: Date | null; newbie_until: Date | null; self_truce_until: Date | null },
  dbNow: Date,
  /** v79：洛阳窗口内跳过城级被动免战 */
  skipTruce = false,
): Promise<MarchTargetVerdict | null> {
  // 守方新手保护：别人不能侦察、攻击他
  if (inNewbieProtection(city.newbie_until, dbNow)) {
    return { purpose: null, reason: 'NEWBIE_PROTECTED', protectedUntil: activeAt(city.newbie_until, dbNow) ?? undefined };
  }
  // 守方免战：被动（被打后，城级）与主动（账号级）任一生效，取更晚者
  const truceAt = laterOf(skipTruce ? null : activeAt(city.truce_until, dbNow), activeAt(city.self_truce_until, dbNow));
  if (truceAt) {
    return { purpose: null, reason: 'TARGET_IN_TRUCE', protectedUntil: truceAt };
  }
  return attackerShieldDenial(client, accountId, dbNow);
}

/** 抢占他人野地的保护判定（v39，AISLG-123）：地块换主保护 + 守方账号级保护（新手 / 主动免战）+
 *  攻方主动免战。守方某座城的被动免战（cities.truce_until）**不**保护野地。通过返回 null */
export async function wildernessDenial(
  client: pg.PoolClient,
  accountId: string,
  tile: TileRow,
  dbNow: Date,
): Promise<MarchTargetVerdict | null> {
  // 刚换主人的野地有一小段保护，谁都不能抢（防拉锯）
  const capturedAt = activeAt(tile.owner_changed_until ?? null, dbNow);
  if (capturedAt) {
    return { purpose: null, reason: 'TILE_PROTECTED', protectedUntil: capturedAt };
  }
  const ownerRes = await client.query(
    `SELECT a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1`,
    [tile.owner_city_id],
  );
  const owner = ownerRes.rows[0] as { newbie_until: Date | null; self_truce_until: Date | null } | undefined;
  if (owner) {
    if (inNewbieProtection(owner.newbie_until, dbNow)) {
      return { purpose: null, reason: 'NEWBIE_PROTECTED', protectedUntil: activeAt(owner.newbie_until, dbNow) ?? undefined };
    }
    const shieldAt = activeAt(owner.self_truce_until, dbNow);
    if (shieldAt) {
      return { purpose: null, reason: 'TARGET_IN_TRUCE', protectedUntil: shieldAt };
    }
  }
  return attackerShieldDenial(client, accountId, dbNow);
}

/** 攻方自己的主动免战：生效中不能出兵打玩家（含抢野地；打野地 / NPC 不受限） */
async function attackerShieldDenial(
  client: pg.PoolClient,
  accountId: string,
  dbNow: Date,
): Promise<MarchTargetVerdict | null> {
  const selfRes = await client.query(`SELECT self_truce_until FROM accounts WHERE id = $1`, [accountId]);
  const selfTruce = (selfRes.rows[0] as { self_truce_until: Date | null } | undefined)?.self_truce_until ?? null;
  const selfAt = activeAt(selfTruce, dbNow);
  if (selfAt) {
    return { purpose: null, reason: 'SELF_TRUCE_ACTIVE', protectedUntil: selfAt };
  }
  return null;
}

/** 两个截止时刻取更晚者（空值穿透） */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a.getTime() >= b.getTime() ? a : b;
}
