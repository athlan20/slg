// NPC 袭击的两阶段流程（v23，AISLG-57）：预警 → 行军 → 到达结算。
// 此前袭击由定时器直接结算（突然挨打，没有应对空间）；现在按袭击间隔发起：
// 选定目标并**固定编成**写入 npc_attacks，同时给被袭击账号发预警事件 + 推送；
// 预警提前量 = 袭击基准间隔的 1/8（随 timeScale 缩放），玩家可增援 / 撤回驻军 /
// 不管，到达时刻按**当时**的驻军结算（增援的部队参与防守）。
// 目标失效（召回 / 易主 / 免战期）不战斗，袭击作废。战斗结算复用 battle-tick
// （野地袭击）与 city-raid（主城袭击）的既有路径，锁序与全栈一致。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, cityRaidLevel, npcRaidArmy } from '../../common/src/battle';
import { loadTileArmy, type TileRow } from '../../common/src/world-db';
import { loadBuildingLevels } from '../../common/src/production';
import { beaconLeadMultiplier, warningIntel } from '../../common/src/building-effects';
import { inNewbieProtection, inTruce } from '../../common/src/protection';
import { npcRaidIntervalMs } from './world-tick';
import { loadCityNaming, settleOwnerCity, type TileNotify } from './tick-shared';
import { resolveNpcWildernessRaid, type NpcWildernessRaidTarget } from './battle-tick';
import { resolveNpcCityRaid } from './city-raid';

/** 主城袭击目标池门槛（与既有口径一致：官府 ≥ 2） */
const NPC_RAID_CITY_MIN_GOVERNMENT = 2;
/** 主城袭击抽取份额（同上：20%） */
const NPC_RAID_CITY_SHARE = 0.2;

/** 预警提前量 = NPC 袭击基准间隔的 1/8（基准 120 分钟 → 15 分钟，占位值随需求「已定」）；
 *  显式覆盖 NPC_RAID_INTERVAL_MS 时同样按 1/8 且不再缩放（与间隔覆盖口径一致） */
export function npcWarningLeadMs(): number {
  return Math.max(1000, Math.floor(npcRaidIntervalMs() / 8));
}

/** 兵力估算区间（编成总单位数 ±20% 取整；预警只给大概，不给精确编成） */
export function armyEstimateRange(army: Partial<Record<TroopKind, number>>): { min: number; max: number } {
  let units = 0;
  for (const count of Object.values(army)) {
    units += Math.max(0, Math.floor(count ?? 0));
  }
  return { min: Math.floor(units * 0.8), max: Math.ceil(units * 1.2) };
}

interface PendingAttack {
  accountId: string;
  targetCityId: string;
  x: number;
  y: number;
  target: 'wilderness' | 'city';
  terrain: string | null;
  level: number;
  army: Partial<Record<TroopKind, number>>;
}

/** 落库一条袭击 + 预警事件（事务内）；预警推送经返回值由提交方发出 */
async function insertAttack(client: pg.PoolClient, attack: PendingAttack): Promise<{ attackId: string; detail: Record<string, unknown> }> {
  // v31（AISLG-81）：被袭击城（占领野地算其所属城）的烽火台等级决定预警提前量（每级 +10%）与敌情详细度
  const beacon = (await loadBuildingLevels(client, attack.targetCityId)).beacon;
  const leadMs = npcWarningLeadMs() * beaconLeadMultiplier(beacon);
  const ins = await client.query(
    `INSERT INTO npc_attacks (account_id, target_city_id, x, y, target, level, army, arrive_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now() + make_interval(secs => $8))
     RETURNING id, arrive_at`,
    [
      attack.accountId,
      attack.targetCityId,
      attack.x,
      attack.y,
      attack.target,
      attack.level,
      JSON.stringify(attack.army),
      leadMs / 1000,
    ],
  );
  const row = ins.rows[0] as { id: string; arrive_at: Date };
  const intel = warningIntel(attack.army, beacon);
  const detail: Record<string, unknown> = {
    x: attack.x,
    y: attack.y,
    target: attack.target,
    terrain: attack.terrain,
    level: attack.level,
    // 敌情随烽火台等级：range 只给总兵力范围 / kinds 另给各兵种范围 / exact 另给精确编成（总范围恒有）
    beaconLevel: beacon,
    ...intel,
    arriveAt: row.arrive_at.toISOString(),
    attackId: row.id,
  };
  await insertEvent(client, {
    accountId: attack.accountId,
    cityId: attack.targetCityId,
    type: EventType.NPC_ATTACK_WARNING,
    initiator: null,
    detail,
  });
  return { attackId: row.id, detail };
}

/**
 * 按袭击间隔发起一次 NPC 袭击（目标选择与既有口径一致）：
 * 20% 主城（官府 ≥ 2，免战期外）+ 80% / 回落已占领野地。发起即固定编成并写入
 * npc_attacks，记录预警事件（事件流）并在提交后经 pg_notify → API 广播预警推送。
 * 返回 1 = 发起一次袭击，0 = 无可袭击目标。
 */
export async function createNpcAttack(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  let warning: { accountId: string; data: Record<string, unknown> } | null = null;
  try {
    await client.query('BEGIN');
    // 主城目标（20%）：主城 = 账号最早创建的城；官府 ≥ 2 过滤新号；免战期不入池；
    // v38（AISLG-122）：新手保护与主动免战中的账号同样不入池（保护是硬规则，NPC 也不打）
    if (Math.random() < NPC_RAID_CITY_SHARE) {
      const cityRes = await client.query(
        `SELECT c.id, c.account_id, c.x, c.y, g.level AS gov_level
         FROM cities c
         JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government' AND g.level >= $1
         JOIN accounts a ON a.id = c.account_id
         JOIN (
           SELECT account_id, MIN(created_at) AS first_created
           FROM cities GROUP BY account_id
         ) m ON m.account_id = c.account_id AND m.first_created = c.created_at
         WHERE c.x IS NOT NULL
           AND (c.truce_until IS NULL OR c.truce_until <= now())
           AND (a.newbie_until IS NULL OR a.newbie_until <= now())
           AND (a.self_truce_until IS NULL OR a.self_truce_until <= now())
         ORDER BY random() LIMIT 1`,
        [NPC_RAID_CITY_MIN_GOVERNMENT],
      );
      const city = cityRes.rows[0] as { id: string; account_id: string; x: number; y: number; gov_level: number } | undefined;
      if (city) {
        // 袭击强度按发起时刻的守军战力推导（到达时用固定编成结算）
        const armyRes = await client.query(`SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`, [city.id]);
        const garrison: Partial<Record<TroopKind, number>> = {};
        for (const armyRow of armyRes.rows as { troop: TroopKind; count: number }[]) {
          garrison[armyRow.troop] = armyRow.count;
        }
        const raidLevel = cityRaidLevel(armyPower(garrison), city.gov_level);
        const attack: PendingAttack = {
          accountId: city.account_id,
          targetCityId: city.id,
          x: city.x,
          y: city.y,
          target: 'city',
          terrain: null,
          level: raidLevel,
          army: npcRaidArmy(raidLevel),
        };
        const created = await insertAttack(client, attack);
        warning = { accountId: attack.accountId, data: created.detail };
      }
    }
    // 野地目标（80% 或主城池为空）
    if (!warning) {
      const candidate = await client.query(
        `SELECT wt.x, wt.y, wt.terrain, wt.level, wt.owner_city_id, c.account_id
         FROM world_tiles wt
         JOIN cities c ON c.id = wt.owner_city_id
         WHERE wt.kind = 'wilderness' AND wt.owner_city_id IS NOT NULL
           AND (wt.owner_changed_until IS NULL OR wt.owner_changed_until <= now())
         ORDER BY random() LIMIT 1`,
      );
      if (candidate.rowCount) {
        const tile = candidate.rows[0] as {
          x: number;
          y: number;
          terrain: string;
          level: number;
          owner_city_id: string;
          account_id: string;
        };
        const attack: PendingAttack = {
          accountId: tile.account_id,
          targetCityId: tile.owner_city_id,
          x: tile.x,
          y: tile.y,
          target: 'wilderness',
          terrain: tile.terrain,
          level: tile.level,
          army: npcRaidArmy(tile.level),
        };
        const created = await insertAttack(client, attack);
        warning = { accountId: attack.accountId, data: created.detail };
      }
    }
    await client.query('COMMIT');
    if (warning) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'npc_warning', accountId: warning.accountId, data: warning.data }),
      ]);
    }
    return warning ? 1 : 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 以指定坐标为出发点发起一次「就近」NPC 袭击（v29 黄巾之乱：大营向附近玩家发兵）：在 Chebyshev
 * 半径内按距离由近到远，目标池 = 玩家占领的野地 + 官府 ≥ 2 且不在免战期的主城（不攻击分城，与
 * 既有口径一致）；沿用既有的预警 → 到达结算流程（固定编成、预警事件与推送、预警期间可增援）。
 * 调用方负责事务；返回预警载荷（提交后经 pg_notify 'npc_warning' 推送），半径内无目标返回 null。
 */
export async function createNearbyNpcAttack(
  client: pg.PoolClient,
  fromX: number,
  fromY: number,
  radius: number,
  level: number,
): Promise<{ accountId: string; data: Record<string, unknown> } | null> {
  const res = await client.query(
    `SELECT target, x, y, terrain, level, city_id, account_id FROM (
       SELECT 'wilderness' AS target, wt.x, wt.y, wt.terrain, wt.level, wt.owner_city_id AS city_id, c.account_id,
              GREATEST(ABS(wt.x - $1), ABS(wt.y - $2)) AS dist
       FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
       WHERE wt.kind = 'wilderness' AND wt.owner_city_id IS NOT NULL
         AND (wt.owner_changed_until IS NULL OR wt.owner_changed_until <= now())
       UNION ALL
       SELECT 'city', c.x, c.y, NULL, 0, c.id, c.account_id, GREATEST(ABS(c.x - $1), ABS(c.y - $2))
       FROM cities c
       JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government' AND g.level >= $4
       JOIN accounts a ON a.id = c.account_id
       JOIN (SELECT account_id, MIN(created_at) AS first_created FROM cities GROUP BY account_id) m
         ON m.account_id = c.account_id AND m.first_created = c.created_at
       WHERE c.x IS NOT NULL AND (c.truce_until IS NULL OR c.truce_until <= now())
         AND (a.newbie_until IS NULL OR a.newbie_until <= now())
         AND (a.self_truce_until IS NULL OR a.self_truce_until <= now())
     ) targets
     WHERE dist <= $3
     ORDER BY dist, random()
     LIMIT 1`,
    [fromX, fromY, radius, NPC_RAID_CITY_MIN_GOVERNMENT],
  );
  const hit = res.rows[0] as
    | { target: 'wilderness' | 'city'; x: number; y: number; terrain: string | null; level: number; city_id: string; account_id: string }
    | undefined;
  if (!hit) {
    return null;
  }
  const attack: PendingAttack = {
    accountId: hit.account_id,
    targetCityId: hit.city_id,
    x: hit.x,
    y: hit.y,
    target: hit.target,
    terrain: hit.terrain,
    level,
    army: npcRaidArmy(level),
  };
  const created = await insertAttack(client, attack);
  return { accountId: attack.accountId, data: created.detail };
}

/** npc_attacks 表行形态 */
export interface NpcAttackRow {
  id: string;
  account_id: string;
  target_city_id: string;
  x: number;
  y: number;
  target: string;
  level: number;
  army: Partial<Record<TroopKind, number>>;
  arrive_at: Date;
}

/** 处理一批到期的 NPC 袭击（Worker tick 调用）；返回结算 / 作废数量 */
export async function processDueNpcAttacks(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  const notifies: TileNotify[] = [];
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT * FROM npc_attacks
       WHERE resolved_at IS NULL AND arrive_at <= now()
       ORDER BY arrive_at
       LIMIT 20
       FOR UPDATE SKIP LOCKED`,
    );
    let resolved = 0;
    for (const row of due.rows as NpcAttackRow[]) {
      if (row.target === 'city') {
        await settleCityAttack(client, row, notifies);
      } else {
        await settleWildernessAttack(client, row, notifies);
      }
      await client.query(`UPDATE npc_attacks SET resolved_at = clock_timestamp() WHERE id = $1`, [row.id]);
      resolved += 1;
    }
    await client.query('COMMIT');
    for (const payload of notifies) {
      await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(payload)]);
    }
    return resolved;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 到达：主城袭击。城市已删（重置）、免战期或保护期内（v38：发起后才进入新手保护 / 主动免战）→ 作废不战斗 */
async function settleCityAttack(
  client: pg.PoolClient,
  attack: NpcAttackRow,
  notifies: TileNotify[],
): Promise<void> {
  const cityRes = await client.query(
    `SELECT c.truce_until, a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [attack.target_city_id],
  );
  if (!cityRes.rowCount) {
    return;
  }
  const now = new Date();
  const { truce_until, newbie_until, self_truce_until } = cityRes.rows[0] as {
    truce_until: Date | null; newbie_until: Date | null; self_truce_until: Date | null;
  };
  if (inTruce(truce_until, self_truce_until, now) || inNewbieProtection(newbie_until, now)) {
    return;
  }
  await resolveNpcCityRaid(
    client,
    { cityId: attack.target_city_id, accountId: attack.account_id, x: attack.x, y: attack.y, govLevel: 0 },
    notifies,
    { army: attack.army, raidLevel: attack.level },
  );
}

/** 到达：野地袭击。归属复核（预警期间召回 / 易主）不过 → 作废不战斗 */
async function settleWildernessAttack(
  client: pg.PoolClient,
  attack: NpcAttackRow,
  notifies: TileNotify[],
): Promise<void> {
  const settled = await settleOwnerCity(client, attack.target_city_id);
  if (!settled.row) {
    return;
  }
  const tileRes = await client.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [attack.x, attack.y]);
  const tile = (tileRes.rowCount ? tileRes.rows[0] : null) as TileRow | null;
  if (!tile || tile.kind !== 'wilderness' || tile.owner_city_id !== attack.target_city_id) {
    return;
  }
  // v39（AISLG-123）：发起后地块刚被玩家抢占、仍在换主保护期 → 作废不战斗
  const capturedUntil = tile.owner_changed_until ?? null;
  if (capturedUntil && capturedUntil.getTime() > Date.now()) {
    return;
  }
  const garrison = await loadTileArmy(client, attack.x, attack.y);
  const naming = await loadCityNaming(client, attack.target_city_id);
  const target: NpcWildernessRaidTarget = {
    accountId: attack.account_id,
    cityId: attack.target_city_id,
    tile,
    level: attack.level,
    garrison,
    defenderName: naming ? `${naming.username} 的驻军（${naming.cityName}）` : '玩家驻军',
    notifies,
  };
  await resolveNpcWildernessRaid(client, target);
}
