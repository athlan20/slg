// 名将授予（v36，AISLG-115）：只从 PvE 获得——名城首占 / 黄巾老巢首杀 / 贡献榜前二。
// 全服唯一靠 famous_heroes.name 主键（grantFamousHero 内 ON CONFLICT 守卫）；获得时
// 全服播报（force 必达）+ 账号事件 + hero_state 推送。Worker 各结算点共用。

import pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { insertServerBroadcast, type ServerBroadcastCreated } from '../../common/src/server-broadcast';
import { famousSourceLabel, type FamousHeroDef } from '../../common/src/hero';
import { grantFamousHero } from '../../common/src/hero-db';
import type { AccountHeroRow } from '../../common/src/hero-db';
import type { TileNotify } from './tick-shared';

/** 授予结果：未被占用才创建（已被他人获得 / 本账号名将满 3 名返回 null） */
export interface GrantOutcome {
  hero: AccountHeroRow;
  broadcast: ServerBroadcastCreated | null;
  username: string | null;
}

/**
 * 授予一名名将并广播（调用方事务内；notifies 收集 hero_state 推送、broadcasts 收集
 * 全服播报，提交后由调用方发 pg_notify）。全服唯一：名将已被他人获得时静默跳过。
 */
export async function grantFamousHeroWithBroadcast(
  client: pg.PoolClient,
  accountId: string,
  def: FamousHeroDef,
  notifies: TileNotify[],
  broadcasts: ServerBroadcastCreated[],
): Promise<GrantOutcome | null> {
  const hero = await grantFamousHero(client, accountId, def);
  if (!hero) {
    return null;
  }
  const userRes = await client.query(`SELECT username FROM accounts WHERE id = $1`, [accountId]);
  const username = userRes.rowCount ? (userRes.rows[0] as { username: string }).username : null;
  await insertEvent(client, {
    accountId,
    buildId: hero.id,
    type: EventType.HERO_GRANTED,
    initiator: null,
    detail: { heroId: hero.id, heroName: def.name, source: famousSourceLabel(def.source) },
  });
  const broadcast = await insertServerBroadcast(
    client,
    'hero_granted',
    { username, heroName: def.name, source: famousSourceLabel(def.source) },
    { force: true },
  );
  if (broadcast) {
    broadcasts.push(broadcast);
  }
  notifies.push({ reason: 'hero_state', accountId, data: { reason: 'granted', heroId: hero.id } as Record<string, unknown> });
  return { hero, broadcast, username };
}
