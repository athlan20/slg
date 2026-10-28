// 盟友协防的数据库存取（v74，AISLG-194）：驻扎列表、上限计数、入驻 / 伤亡回写、召回 / 遣返与自动遣返。
// 规则见 city-assist.ts；API（DISMISS_ASSIST / 城池视图 / 发起校验）、Worker（到达入驻、守城战、退盟）共用。

import pg from 'pg';
import { EventType, TROOP_KINDS, type ArmyCounts, type InitiatorRole, type TroopKind } from './protocol';
import { insertEvent } from './events';
import { assistCap, fullArmy, hasTroops, type AssistParty } from './city-assist';
import type { AssistOutView, AssistView } from './protocol-assist';
import { marchTravelSeconds } from './world';
import { marchingPercent } from './tech';
import { loadTechLevels } from './tech-db';

type Q = pg.Pool | pg.PoolClient;

export interface AssistRow {
  id: string;
  city_id: string;
  account_id: string;
  from_city_id: string;
  troops: Partial<Record<TroopKind, number>>;
  initiator: string;
  arrive_at: Date;
}

interface AssistViewRow extends AssistRow {
  username: string;
  from_city_name: string;
}

interface AssistOutRow extends AssistRow {
  host_city_name: string;
  host_username: string;
}

/** 驻扎在某座城的协防部队（城主 / 盟友视图；按入驻时间排序） */
export async function loadCityAssists(q: Q, cityId: string): Promise<AssistView[]> {
  const res = await q.query(
    `SELECT ca.*, a.username, fc.name AS from_city_name
     FROM city_assist ca
     JOIN accounts a ON a.id = ca.account_id
     JOIN cities fc ON fc.id = ca.from_city_id
     WHERE ca.city_id = $1
     ORDER BY ca.arrive_at, ca.id`,
    [cityId],
  );
  return (res.rows as AssistViewRow[]).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    username: row.username,
    fromCityId: row.from_city_id,
    fromCityName: row.from_city_name,
    troops: fullArmy(row.troops),
    arrivedAt: row.arrive_at.toISOString(),
    initiator: (row.initiator === 'agent' ? 'agent' : 'player') as InitiatorRole,
  }));
}

/** 本城派出、正在盟友城里驻扎的协防部队（派出方视图） */
export async function loadAssistsFromCity(q: Q, fromCityId: string): Promise<AssistOutView[]> {
  const res = await q.query(
    `SELECT ca.*, hc.name AS host_city_name, ha.username AS host_username
     FROM city_assist ca
     JOIN cities hc ON hc.id = ca.city_id
     JOIN accounts ha ON ha.id = hc.account_id
     WHERE ca.from_city_id = $1
     ORDER BY ca.arrive_at, ca.id`,
    [fromCityId],
  );
  return (res.rows as AssistOutRow[]).map((row) => ({
    id: row.id,
    hostCityId: row.city_id,
    hostCityName: row.host_city_name,
    hostUsername: row.host_username,
    troops: fullArmy(row.troops),
    arrivedAt: row.arrive_at.toISOString(),
  }));
}

/** 守城战用的协防方编成（只给合并与拆分需要的字段） */
export async function loadAssistParties(q: Q, cityId: string): Promise<AssistParty[]> {
  const res = await q.query(`SELECT id, account_id, from_city_id, troops FROM city_assist WHERE city_id = $1`, [cityId]);
  return (res.rows as Array<{ id: string; account_id: string; from_city_id: string; troops: Partial<Record<TroopKind, number>> }>).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    fromCityId: row.from_city_id,
    troops: row.troops ?? {},
  }));
}

/** 驻扎在某城的协防部队数（上限判定） */
export async function countAssistsAtCity(q: Q, cityId: string): Promise<number> {
  const res = await q.query(`SELECT count(*)::int AS n FROM city_assist WHERE city_id = $1`, [cityId]);
  return Number((res.rows[0] as { n: number }).n ?? 0);
}

/** 同一账号是否已在该城协防（同账号最多 1 支） */
export async function hasAssistAtCity(q: Q, cityId: string, accountId: string): Promise<boolean> {
  const res = await q.query(`SELECT 1 FROM city_assist WHERE city_id = $1 AND account_id = $2`, [cityId, accountId]);
  return (res.rowCount ?? 0) > 0;
}

/** 正在路上、开往该城的协防行军数（发起与到达的上限复核都算在途） */
export async function countIncomingAssists(q: Q, hostCityId: string): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM marches m
     JOIN cities c ON c.id = $1
     WHERE m.purpose = 'assist' AND m.status = 'marching' AND m.x = c.x AND m.y = c.y`,
    [hostCityId],
  );
  return Number((res.rows[0] as { n: number }).n ?? 0);
}

/** 本账号是否已经有一支开往该城的协防在途（同账号同城最多 1 支，在途也算） */
export async function hasIncomingAssistFromAccount(q: Q, hostCityId: string, accountId: string): Promise<boolean> {
  const res = await q.query(
    `SELECT 1 FROM marches m JOIN cities c ON c.id = $1
     WHERE m.purpose = 'assist' AND m.status = 'marching' AND m.account_id = $2
       AND m.x = c.x AND m.y = c.y
     LIMIT 1`,
    [hostCityId, accountId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 发起协防的上限判定：城已驻满 / 本账号在该城已有一支（含在途）；通过返回 null */
export async function assistLimitDenial(
  q: Q,
  hostCityId: string,
  accountId: string,
  hostFamousName?: string | null,
): Promise<'ASSIST_LIMIT' | null> {
  if (await hasAssistAtCity(q, hostCityId, accountId)) {
    return 'ASSIST_LIMIT';
  }
  if (await hasIncomingAssistFromAccount(q, hostCityId, accountId)) {
    return 'ASSIST_LIMIT';
  }
  const [atCity, incoming] = await Promise.all([countAssistsAtCity(q, hostCityId), countIncomingAssists(q, hostCityId)]);
  return atCity + incoming >= assistCap(hostFamousName) ? 'ASSIST_LIMIT' : null;
}

/** 按 id 读取（含派出账号与两座城的归属信息，召回 / 遣返鉴权用） */
export async function loadAssistForAction(
  q: Q,
  assistId: string,
): Promise<
  | (AssistRow & {
      provider_account_id: string;
      host_account_id: string;
      host_username: string;
      host_city_name: string;
      host_x: number | null;
      host_y: number | null;
      from_x: number | null;
      from_y: number | null;
    })
  | null
> {
  const res = await q.query(
    `SELECT ca.*, ca.account_id AS provider_account_id, hc.account_id AS host_account_id,
            ha.username AS host_username, hc.name AS host_city_name, hc.x AS host_x, hc.y AS host_y,
            fc.x AS from_x, fc.y AS from_y
     FROM city_assist ca
     JOIN cities hc ON hc.id = ca.city_id
     JOIN accounts ha ON ha.id = hc.account_id
     JOIN cities fc ON fc.id = ca.from_city_id
     WHERE ca.id = $1
     FOR UPDATE OF ca`,
    [assistId],
  );
  return res.rowCount ? (res.rows[0] as never) : null;
}

/** 入驻（到达结算调用；同一账号同城唯一约束兜底） */
export async function insertAssist(
  client: pg.PoolClient,
  input: { cityId: string; accountId: string; fromCityId: string; troops: Partial<Record<TroopKind, number>>; initiator: string },
): Promise<AssistRow> {
  const res = await client.query(
    `INSERT INTO city_assist (city_id, account_id, from_city_id, troops, initiator)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *`,
    [input.cityId, input.accountId, input.fromCityId, JSON.stringify(input.troops), input.initiator],
  );
  return res.rows[0] as AssistRow;
}

export interface AssistReturnResult {
  assistId: string;
  /** 返程行军 id；部队已不在（城 / 账号被重置）为 null */
  marchId: string | null;
  providerAccountId: string;
  hostAccountId: string | null;
  hostCityId: string;
  fromCityId: string;
  cause: string;
}

/**
 * 让一支协防部队回出发城（召回 / 遣返 / 退盟 / 易主共用）：生成返程行军并从 city_assist 删除，
 * 写 ASSIST_RETURNED 事件（派出方视角）。城或账号已不存在时只删行。
 * 调用方须在事务内（锁序：协防行 → 城池行）。
 */
export async function sendAssistHome(
  client: pg.PoolClient,
  assist: Pick<AssistRow, 'id' | 'city_id' | 'account_id' | 'from_city_id' | 'troops' | 'initiator'> & {
    host_account_id?: string | null;
    host_x?: number | null;
    host_y?: number | null;
    from_x?: number | null;
    from_y?: number | null;
  },
  cause: string,
): Promise<AssistReturnResult> {
  const details =
    assist.host_x !== undefined && assist.from_x !== undefined
      ? assist
      : ((await loadAssistForAction(client, assist.id)) ?? assist);
  const row = details as typeof assist & {
    host_account_id?: string | null;
    host_x?: number | null;
    host_y?: number | null;
    from_x?: number | null;
    from_y?: number | null;
  };
  let marchId: string | null = null;
  const hostX = row.host_x ?? null;
  const hostY = row.host_y ?? null;
  const fromX = row.from_x ?? null;
  const fromY = row.from_y ?? null;
  if (hostX !== null && hostY !== null && fromX !== null && fromY !== null && hasTroops(row.troops)) {
    const techs = await loadTechLevels(client, row.account_id);
    // 驿站的「自己城池之间」加速不适用于协防返程（与去程同口径）
    const travel = marchTravelSeconds(hostX, hostY, fromX, fromY, row.troops, marchingPercent(techs));
    const ins = await client.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'return', 'marching', $6, now() + make_interval(secs => $7))
       RETURNING id`,
      [row.account_id, row.from_city_id, hostX, hostY, JSON.stringify(row.troops), row.initiator, travel],
    );
    marchId = ins.rows[0].id as string;
  }
  await client.query(`DELETE FROM city_assist WHERE id = $1`, [row.id]);
  await insertEvent(client, {
    accountId: row.account_id,
    cityId: row.from_city_id,
    buildId: row.id,
    type: EventType.ASSIST_RETURNED,
    initiator: row.initiator as InitiatorRole,
    detail: {
      assistId: row.id,
      hostCityId: row.city_id,
      hostCityName: (row as { host_city_name?: string }).host_city_name ?? null,
      hostUsername: (row as { host_username?: string }).host_username ?? null,
      cause,
      troops: row.troops,
      returning: marchId,
    },
  });
  return {
    assistId: row.id,
    marchId,
    providerAccountId: row.account_id,
    hostAccountId: row.host_account_id ?? null,
    hostCityId: row.city_id,
    fromCityId: row.from_city_id,
    cause,
  };
}

/** 账号退盟 / 被踢 / 解散：其派出的协防（作为派出方）与被协防（作为城主）全部自动遣返 */
export async function returnAssistsForAccount(client: pg.PoolClient, accountId: string, cause: string): Promise<AssistReturnResult[]> {
  const res = await client.query(
    `SELECT id FROM city_assist
     WHERE account_id = $1
        OR city_id IN (SELECT id FROM cities WHERE account_id = $1)
     ORDER BY id`,
    [accountId],
  );
  const results: AssistReturnResult[] = [];
  for (const row of res.rows as Array<{ id: string }>) {
    results.push(await sendAssistHome(client, { id: row.id, city_id: '', account_id: '', from_city_id: '', troops: {}, initiator: 'player' }, cause));
  }
  return results;
}

/** 城池易主等场景：驻扎在该城的协防部队全部自动遣返 */
export async function returnAssistsForCity(client: pg.PoolClient, cityId: string, cause: string): Promise<AssistReturnResult[]> {
  const res = await client.query(`SELECT id FROM city_assist WHERE city_id = $1 ORDER BY id`, [cityId]);
  const results: AssistReturnResult[] = [];
  for (const row of res.rows as Array<{ id: string }>) {
    results.push(await sendAssistHome(client, { id: row.id, city_id: cityId, account_id: '', from_city_id: '', troops: {}, initiator: 'player' }, cause));
  }
  return results;
}

/** 守城战后回写：城主驻军与各协防部队的剩余兵力（全灭的协防行删除） */
export async function saveDefenseSurvivors(
  client: pg.PoolClient,
  cityId: string,
  hostSurvivors: ArmyCounts,
  partySurvivors: Map<string, ArmyCounts>,
): Promise<void> {
  await client.query(`DELETE FROM city_army WHERE city_id = $1`, [cityId]);
  for (const kind of TROOP_KINDS) {
    if (hostSurvivors[kind] > 0) {
      await client.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`, [cityId, kind, hostSurvivors[kind]]);
    }
  }
  for (const [assistId, survivors] of partySurvivors) {
    if (hasTroops(survivors)) {
      await client.query(`UPDATE city_assist SET troops = $2::jsonb WHERE id = $1`, [assistId, JSON.stringify(survivors)]);
    } else {
      await client.query(`DELETE FROM city_assist WHERE id = $1`, [assistId]);
    }
  }
}
