// 遗迹领取（AISLG-227，v93）：部队到达遗迹格即领取（掠夺 / 占领 / 增援 / 侦察），在 world-tick 的 resolveArrival
// 里、fog_denied 判断之后、各分支之前调用，不看战斗结果。盲打被拒（fog_denied）的行军不走到这里。
// 并发：同一账号的领取用事务级咨询锁串行（每日上限的计数与登记同一把锁下）；登记用 UPDATE ... WHERE claimed_by IS NULL，
// 只有真正改到一行的一方发奖。领取失败（已被领走 / 今日已达上限）只写事件，部队照原有规则结算。
import type pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { getFogEnabled } from '../../common/src/fog-config';
import { notifyFogReward } from '../../common/src/fog-first';
import { relicsClaimedToday } from '../../common/src/fog-relic-db';
import { relicDef, RELIC_DAILY_LIMIT } from '../../common/src/relic';
import { grantRewards } from '../../common/src/quest';
import { grantItem } from '../../common/src/items-db';
import type { ItemId } from '../../common/src/items';
import { insertServerBroadcast } from '../../common/src/server-broadcast';

/** 会领取遗迹的行军用途（需求第二节）：掠夺、占领、增援、侦察 */
const CLAIM_PURPOSES: ReadonlyArray<string> = ['plunder', 'occupy', 'reinforce', 'scout'];

export interface RelicMarch {
  id: string;
  account_id: string;
  from_city_id: string;
  x: number;
  y: number;
  purpose: string;
}

export type RelicClaimOutcome = 'none' | 'claimed' | 'taken' | 'limit';

/** 到达时的遗迹领取；返回结果（none = 没有遗迹 / 不适用 / 迷雾关闭）。调用方须在结算事务内。 */
export async function claimRelicOnArrival(client: pg.PoolClient, march: RelicMarch): Promise<RelicClaimOutcome> {
  if (!getFogEnabled() || !CLAIM_PURPOSES.includes(march.purpose)) {
    return 'none';
  }
  const found = await client.query(`SELECT id, tier, kind, claimed_by FROM fog_relics WHERE x = $1 AND y = $2`, [march.x, march.y]);
  const relic = found.rows[0] as { id: string; tier: string; kind: string; claimed_by: string | null } | undefined;
  if (!relic) {
    return 'none';
  }
  const base = { outcome: '', x: march.x, y: march.y };
  if (relic.claimed_by !== null) {
    await reportClaim(client, march, { ...base, outcome: 'taken' });
    return 'taken';
  }
  // 同一账号的领取串行：今日计数与登记在同一把锁下，并发到达不会超过上限
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fog_relic:${march.account_id}`]);
  if ((await relicsClaimedToday(client, march.account_id)) >= RELIC_DAILY_LIMIT) {
    await reportClaim(client, march, { ...base, outcome: 'limit' });
    return 'limit';
  }
  const won = await client.query(
    `UPDATE fog_relics SET claimed_by = $2, claimed_at = now() WHERE id = $1 AND claimed_by IS NULL RETURNING id`,
    [relic.id, march.account_id],
  );
  if (!won.rowCount) {
    await reportClaim(client, march, { ...base, outcome: 'taken' });
    return 'taken';
  }
  const def = relicDef(relic.kind);
  if (!def) {
    throw new Error(`fog relic: 未知种类 ${relic.kind}`);
  }
  await grantRewards(client, march.account_id, def.reward);
  for (const [itemId, count] of Object.entries(def.items)) {
    await grantItem(client, march.account_id, itemId as ItemId, count ?? 1, 'relic');
  }
  await reportClaim(client, march, {
    ...base,
    outcome: 'claimed',
    tier: relic.tier,
    kind: relic.kind,
    reward: def.reward,
    items: def.items,
  });
  if (relic.tier === 'legendary') {
    // 传说遗迹全服播报（必达，不带坐标）
    const who = await client.query(`SELECT username FROM accounts WHERE id = $1`, [march.account_id]);
    const username = (who.rows[0] as { username: string } | undefined)?.username ?? '';
    const created = await insertServerBroadcast(client, 'legendary_relic_claimed', { username, kind: relic.kind }, { force: true });
    if (created) {
      await client.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: created })]);
    }
  }
  // 所有人的地图立刻去掉这处遗迹（API 收到后按每个在线账号的探索状态重新裁剪推送）
  await client.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify({ reason: 'relic_claimed', accountId: '', x: march.x, y: march.y })]);
  await notifyFogReward(client, march.account_id);
  return 'claimed';
}

/** 写领取事件（claimed / taken / limit 三种结果都记在出发城下，便于玩家在事件里看到提示） */
async function reportClaim(client: pg.PoolClient, march: RelicMarch, detail: Record<string, unknown> & { outcome: string }): Promise<void> {
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: march.from_city_id,
    buildId: march.id,
    type: EventType.RELIC_CLAIMED,
    initiator: null,
    detail,
  });
}
