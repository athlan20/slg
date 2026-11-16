// 名城任期轮换的 Worker 侧（v111，AISLG-259）：到期前提醒 + 到期处置。
// 规则与数值在 common/src/famous-tenure.ts（API 与 Worker 共用），本文件只做定时落地：
// - 提醒：扫有任期且 famous_warn_stage < 2 的名城，按「还能撑多久」算出应当阶段
//   （≤ 1 小时 = 2，≤ 24 小时 = 1），比已发阶段高就发一条 famous_expiring 事件并置位；
//   跳过某个点时只补一条（不补发两条）；
// - 到期：famous_expires_at <= now() 的名城逐个在事务内处置（先锁 cities 再锁 world_tiles，与现有锁序一致）：
//   该城脱离原主人（与换主共用的 city-detach.ts）、协防遣返、城内驻军回主城、
//   地块恢复为无主 NPC 名城（外围满编 + 城守守军）、删城行、给原主人写 48 小时封禁、
//   事件 famous_expired + 全服播报 famous_expired。
// 与主动放弃分城（handlers-discard.ts）的区别：不能因行军在途 / 野地驻军 / 部队在外而拒绝——
// 到期就掉，行军改从主城返程、驻军回主城。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { insertServerBroadcast } from '../../common/src/server-broadcast';
import { FAMOUS_CITY_LEVEL, famousGarrisons, newFamousState } from '../../common/src/famous-city';
import { famousBanUntilFrom, famousWarnTargetStage } from '../../common/src/famous-tenure';
import { insertFamousExpiryBan } from '../../common/src/famous-tenure-db';
import { returnAssistsForCity } from '../../common/src/city-assist-db';
import { refreshLuoyangHolder } from '../../common/src/luoyang-db';
import { npcSnapshot, type NpcCitySnapshot } from '../../common/src/world';
import { troopsEnterCity, type TileNotify } from './tick-shared';
import { detachCityFromOwner } from './city-detach';

/** 检查间隔（毫秒，真实时间）：提醒 / 到期晚 5 秒无感，与洛阳窗口同口径 */
export const FAMOUS_TENURE_TICK_MS = 5_000;
/** 单轮最多处置的到期名城数（防一次积压把 tick 拖住；剩下的下轮继续） */
const EXPIRE_BATCH = 20;

let lastRunMs = 0;

/** 有任期、还没提醒完的名城（只读候选） */
interface WarnCandidate {
  id: string;
  account_id: string;
  name: string;
  x: number | null;
  y: number | null;
  famous_expires_at: Date;
  famous_warn_stage: number;
}

/**
 * 到期前提醒：把 famous_expires_at - now 跨过 24 小时 / 1 小时的名城提醒一次（事件 + PUSH_CITY_STATE）。
 * 返回本轮发出的提醒条数。
 */
async function processWarnings(pool: pg.Pool, now: Date): Promise<number> {
  const client = await pool.connect();
  const notifies: TileNotify[] = [];
  let warned = 0;
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT c.id, c.account_id, c.name, c.famous_expires_at, c.famous_warn_stage, wt.x, wt.y
       FROM cities c JOIN world_tiles wt ON wt.owner_city_id = c.id AND wt.kind = 'city'
       WHERE c.famous_name IS NOT NULL AND c.famous_expires_at IS NOT NULL
         AND c.famous_expires_at > now() AND c.famous_warn_stage < 2
       FOR UPDATE OF c`,
    );
    for (const row of res.rows as WarnCandidate[]) {
      const expiresAt = row.famous_expires_at;
      const target = famousWarnTargetStage(expiresAt, now);
      if (target <= row.famous_warn_stage) {
        continue;
      }
      // 条件守卫：仍是这个阶段才推进（与到期处置 / 换主重算并发时以行锁串开）
      const upd = await client.query(
        `UPDATE cities SET famous_warn_stage = $2 WHERE id = $1 AND famous_warn_stage < $2`,
        [row.id, target],
      );
      if (!upd.rowCount) {
        continue;
      }
      warned += 1;
      const detail = {
        name: row.name,
        cityId: row.id,
        x: row.x,
        y: row.y,
        stage: target,
        expiresAt: expiresAt.toISOString(),
      };
      await insertEvent(client, {
        accountId: row.account_id,
        cityId: row.id,
        type: EventType.FAMOUS_EXPIRING,
        initiator: null,
        detail,
      });
      notifies.push({
        reason: 'famous_tenure',
        accountId: row.account_id,
        data: { reason: 'famous_expiring', cityId: row.id, stage: target, expiresAt: expiresAt.toISOString() },
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await sendNotifies(pool, notifies);
  return warned;
}

/** 到期处置的候选城 id（不加锁，真正的判定在事务内带 FOR UPDATE 重做） */
async function loadExpiredCityIds(pool: pg.Pool): Promise<string[]> {
  const res = await pool.query(
    `SELECT id FROM cities
     WHERE famous_name IS NOT NULL AND famous_expires_at IS NOT NULL AND famous_expires_at <= now()
     ORDER BY famous_expires_at LIMIT $1`,
    [EXPIRE_BATCH],
  );
  return (res.rows as Array<{ id: string }>).map((row) => row.id);
}

/**
 * 到期处置：逐个名城在独立事务里掉城（单城失败不影响其它城，下轮重试）。
 * 返回本轮掉城的数量。
 */
async function processExpiries(pool: pg.Pool): Promise<number> {
  const ids = await loadExpiredCityIds(pool);
  let expired = 0;
  for (const cityId of ids) {
    const notifies: TileNotify[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (await expireFamousCity(client, cityId, notifies)) {
        expired += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('famous expire failed:', cityId, err instanceof Error ? err.message : err);
      notifies.length = 0;
    } finally {
      client.release();
    }
    await sendNotifies(pool, notifies);
  }
  return expired;
}

/** 单座名城的到期处置（调用方事务内）：返回 false 表示已不需要处置（城已换主 / 已被别的进程处理） */
async function expireFamousCity(client: pg.PoolClient, cityId: string, notifies: TileNotify[]): Promise<boolean> {
  // 锁序：cities → world_tiles（与出征 / 换主一致）
  const cityRes = await client.query(
    `SELECT c.id, c.account_id, c.name, c.famous_name, c.famous_expires_at, a.username, now() AS now
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1 AND c.famous_name IS NOT NULL AND c.famous_expires_at IS NOT NULL AND c.famous_expires_at <= now()
     FOR UPDATE OF c`,
    [cityId],
  );
  if (!cityRes.rowCount) {
    return false;
  }
  const city = cityRes.rows[0] as {
    id: string; account_id: string; name: string; famous_name: string; famous_expires_at: Date;
    username: string; now: Date;
  };
  const tileRes = await client.query(
    `SELECT x, y, level FROM world_tiles WHERE kind = 'city' AND owner_city_id = $1 FOR UPDATE`,
    [cityId],
  );
  if (!tileRes.rowCount) {
    return false;
  }
  const tile = tileRes.rows[0] as { x: number; y: number; level: number };
  const now = city.now;
  const mainRes = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [city.account_id]);
  const mainCityId = (mainRes.rows[0] as { id: string } | undefined)?.id;
  if (!mainCityId) {
    return false;
  }

  // 1) 该城脱离原主人（名下野地变无主、驻军回主城、在外部队改从主城返程、队列 / 围攻作废）
  await detachCityFromOwner(client, {
    cityId,
    mainCityId,
    prevOwnerAccountId: city.account_id,
    cityName: city.name,
    x: tile.x,
    y: tile.y,
    cause: 'famous_expired',
    attackerUsername: null,
    keepMarchId: null,
    notifies,
  });
  // 2) 协防友军按现有规则返回派出城（与放弃分城同口径）
  const returned = await returnAssistsForCity(client, cityId, 'city_discarded');
  for (const provider of returned) {
    notifies.push({
      reason: 'famous_tenure',
      accountId: provider.providerAccountId,
      data: { reason: 'assist_changed', cityId },
    });
  }
  // 3) 城内驻军全部回原主人主城（建筑 / 库存 / 队列随城作废，与放弃分城一致）
  const armyRes = await client.query(`SELECT troop, count FROM city_army WHERE city_id = $1`, [cityId]);
  const garrison: Partial<Record<TroopKind, number>> = {};
  for (const row of armyRes.rows as Array<{ troop: TroopKind; count: number }>) {
    if ((TROOP_KINDS as readonly string[]).includes(row.troop)) {
      garrison[row.troop] = Number(row.count ?? 0);
    }
  }
  await troopsEnterCity(client, mainCityId, garrison);
  await client.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
  // 4) 地块恢复为无主的名城 NPC（外围满编 + 城守守军，与放弃分城后一致）
  const level = FAMOUS_CITY_LEVEL;
  const base = npcSnapshot(level);
  const npc: NpcCitySnapshot = {
    ...base,
    garrison: famousGarrisons(level).keeper,
    famous: newFamousState(city.famous_name, level),
  };
  await client.query(
    `UPDATE world_tiles SET kind = 'npc_city', level = $3, owner_city_id = NULL, npc = $4::jsonb WHERE x = $1 AND y = $2`,
    [tile.x, tile.y, level, JSON.stringify(npc)],
  );
  // 5) 到期失去这座城的原主人 48 小时内不能再占回它（只对这个人、这个名号）
  const bannedUntil = famousBanUntilFrom(now);
  await insertFamousExpiryBan(client, city.famous_name, city.account_id, bannedUntil);
  // 6) 洛阳之主随持有者消失（联盟加成同步失效）
  await refreshLuoyangHolder(client);
  // 7) 事件 + 全服播报（播报走普通限频，周度事件不占必达额度）
  await insertEvent(client, {
    accountId: city.account_id,
    cityId: null,
    type: EventType.FAMOUS_EXPIRED,
    initiator: null,
    detail: {
      name: city.famous_name,
      cityId,
      x: tile.x,
      y: tile.y,
      expiredAt: now.toISOString(),
      bannedUntil: bannedUntil.toISOString(),
    },
  });
  const broadcast = await insertServerBroadcast(client, 'famous_expired', {
    name: city.famous_name,
    username: city.username,
    cityName: city.name,
    x: tile.x,
    y: tile.y,
  });
  if (broadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast });
  }
  notifies.push({
    reason: 'famous_tenure',
    accountId: city.account_id,
    data: { reason: 'famous_expired', cityId },
  });
  notifies.push({
    reason: 'tile_changed',
    accountId: city.account_id,
    x: tile.x,
    y: tile.y,
    tileReason: 'famous_expired',
  });
  return true;
}

/** 提交后发推送（通知丢失由客户端按需查询兜底，与其它 tick 同口径） */
async function sendNotifies(pool: pg.Pool, notifies: TileNotify[]): Promise<void> {
  for (const notify of notifies) {
    await pool
      .query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, JSON.stringify(notify)])
      .catch(() => undefined);
  }
}

/**
 * 每个 tick 调一次（内部节流到 FAMOUS_TENURE_TICK_MS）：先发提醒，再处置到期。
 * 返回本轮发出提醒与掉城的数量（供日志）。
 */
export async function processFamousTenure(
  pool: pg.Pool,
  nowMs: number = Date.now(),
): Promise<{ warned: number; expired: number }> {
  if (nowMs - lastRunMs < FAMOUS_TENURE_TICK_MS) {
    return { warned: 0, expired: 0 };
  }
  lastRunMs = nowMs;
  const nowRes = await pool.query(`SELECT now() AS now`);
  const now = (nowRes.rows[0] as { now: Date }).now;
  // 先掉城再提醒：提醒只处理「还没到期」的城，两步互不影响；
  // 这样即使提醒那一步出错（例如某行数据异常），到期的城也一定会被处置。
  const expired = await processExpiries(pool);
  const warned = await processWarnings(pool, now);
  return { warned, expired };
}