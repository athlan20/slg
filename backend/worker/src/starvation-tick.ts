// Worker 的断粮预警与哗变（v34，AISLG-107）。规则与数值见 common/src/starvation.ts。
// 粮食是懒结算的——离线城池的粮食不会自己变成 0——所以由本 tick 周期性扫描「可能断粮」的城池
// （有部队 / 在外部队 / 野地驻军，或已在预警 / 哗变计时中），逐城在事务内：
// 1) 锁城并把生产结算到现在（粮食扣到 0 为止）；
// 2) 按净产量（粮毛产量 − 全军耗粮，同 CityView 口径）推算断粮：
//    - 距断粮不足 1 小时（缩放后）且本轮未预警 → 写 starvation_warning 事件并推送；
//    - 已断粮（粮食 0 且净产量为负）→ 起算下一次哗变时刻（断粮起算 + 1 小时）；到点城内驻军每个兵种减 10%，
//      写 mutiny 事件并推送，之后每小时重复（Worker 停机后补发，单次最多补 24 次）；
//    - 恢复（粮食 > 0 或净产量转正）→ 清空计时与预警标记，停止哗变。
// 在外部队不强制召回；它们的耗粮已在 loadArmyFoodUsePerHour 里按 ×2 计入。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadArmyFoodUsePerHour, loadBuildingLevels, loadProductionBonusPercent, productionPerHour } from '../../common/src/production';
import { loadCityGuard } from '../../common/src/hero-db';
import { guardProductionPercent } from '../../common/src/hero';
import { loadTechLevels } from '../../common/src/tech-db';
import { loadTerritory } from '../../common/src/world-db';
import { territoryRates } from '../../common/src/world';
import {
  applyMutiny,
  mutinyIntervalMs,
  projectStarvation,
  starveWarningLeadMs,
} from '../../common/src/starvation';
import { settleOwnerCity } from './tick-shared';

/** 扫描最小间隔（毫秒，真实时间）与单次扫描城池上限 */
export const STARVATION_TICK_MS = 10_000;
const SWEEP_LIMIT = 500;
/** Worker 停机后一次最多补发的哗变次数 */
const MUTINY_CATCHUP_MAX = 24;

let lastRunMs = 0;

interface Notice {
  accountId: string;
  data: Record<string, unknown>;
}

/** 单城评估（调用方持有事务）；返回需要在提交后推送的通知 */
async function evaluateCity(client: pg.PoolClient, cityId: string): Promise<Notice[]> {
  const settled = await settleOwnerCity(client, cityId);
  if (!settled.row) {
    return [];
  }
  const res = await client.query(
    `SELECT account_id, name, food, mutiny_next_at, starve_warned_at, now() AS db_now FROM cities WHERE id = $1`,
    [cityId],
  );
  const city = res.rows[0] as {
    account_id: string;
    name: string;
    food: number;
    mutiny_next_at: Date | null;
    starve_warned_at: Date | null;
    db_now: Date;
  };
  const nowMs = city.db_now.getTime();
  const levels = await loadBuildingLevels(client, cityId);
  const territory = await loadTerritory(client, cityId);
  const techs = await loadTechLevels(client, city.account_id);
  const guard = await loadCityGuard(client, cityId);
  const rates = productionPerHour(
    levels, territoryRates(territory), await loadProductionBonusPercent(client, cityId), techs,
    guard ? guardProductionPercent(guard.wit) : 0,
  );
  const armyUse = await loadArmyFoodUsePerHour(client, cityId);
  const net = rates.food - armyUse;
  const projection = projectStarvation(city.food, net, nowMs);
  const notices: Notice[] = [];

  // 恢复 / 不会断粮：清空计时与预警标记
  if (projection.starveAtMs === null) {
    if (city.mutiny_next_at || city.starve_warned_at) {
      await client.query(`UPDATE cities SET mutiny_next_at = NULL, starve_warned_at = NULL WHERE id = $1`, [cityId]);
    }
    return notices;
  }

  // 预警：距断粮不足 1 小时（含已断粮）且本轮未预警
  const lead = starveWarningLeadMs();
  if (projection.starveAtMs - nowMs <= lead) {
    if (!city.starve_warned_at) {
      const data = {
        reason: 'warning',
        cityId,
        cityName: city.name,
        starveAt: new Date(projection.starveAtMs).toISOString(),
        foodNetPerHour: Math.round(net),
      };
      await client.query(`UPDATE cities SET starve_warned_at = now() WHERE id = $1`, [cityId]);
      await insertEvent(client, {
        accountId: city.account_id,
        cityId,
        type: EventType.STARVATION_WARNING,
        initiator: null,
        detail: { cityId, cityName: city.name, starveAt: data.starveAt, foodNetPerHour: data.foodNetPerHour },
      });
      notices.push({ accountId: city.account_id, data });
    }
  } else if (city.starve_warned_at) {
    // 离断粮又远了（如卖粮 / 减员后）：清标记，下次再逼近时重新预警
    await client.query(`UPDATE cities SET starve_warned_at = NULL WHERE id = $1`, [cityId]);
  }

  if (!projection.starving) {
    if (city.mutiny_next_at) {
      await client.query(`UPDATE cities SET mutiny_next_at = NULL WHERE id = $1`, [cityId]);
    }
    return notices;
  }

  // 已断粮：起算 / 结算哗变
  const interval = mutinyIntervalMs();
  let next = city.mutiny_next_at ? city.mutiny_next_at.getTime() : nowMs + interval;
  if (!city.mutiny_next_at) {
    await client.query(`UPDATE cities SET mutiny_next_at = $2 WHERE id = $1`, [cityId, new Date(next)]);
    return notices;
  }
  let rounds = 0;
  while (next <= nowMs && rounds < MUTINY_CATCHUP_MAX) {
    const armyRes = await client.query(`SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`, [cityId]);
    const army: Partial<Record<TroopKind, number>> = {};
    for (const row of armyRes.rows as Array<{ troop: TroopKind; count: number }>) {
      army[row.troop] = row.count;
    }
    const result = applyMutiny(army);
    next += interval;
    rounds += 1;
    if (result.total > 0) {
      for (const kind of TROOP_KINDS) {
        const left = result.remaining[kind] ?? 0;
        if (army[kind] !== undefined) {
          if (left > 0) {
            await client.query(`UPDATE city_army SET count = $3, updated_at = now() WHERE city_id = $1 AND troop = $2`, [cityId, kind, left]);
          } else {
            await client.query(`DELETE FROM city_army WHERE city_id = $1 AND troop = $2`, [cityId, kind]);
          }
        }
      }
    }
    const detail = {
      cityId,
      cityName: city.name,
      losses: result.losses,
      total: result.total,
      nextAt: new Date(next).toISOString(),
    };
    await insertEvent(client, { accountId: city.account_id, cityId, type: EventType.MUTINY, initiator: null, detail });
    notices.push({ accountId: city.account_id, data: { reason: 'mutiny', ...detail } });
  }
  await client.query(`UPDATE cities SET mutiny_next_at = $2 WHERE id = $1`, [cityId, new Date(next)]);
  return notices;
}

/** 单 tick 入口：节流到 STARVATION_TICK_MS；返回本次发出的通知数 */
export async function processStarvation(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < STARVATION_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  const candidates = await pool.query(
    `SELECT c.id FROM cities c
     WHERE c.mutiny_next_at IS NOT NULL OR c.starve_warned_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM city_army a WHERE a.city_id = c.id AND a.count > 0)
        OR EXISTS (SELECT 1 FROM marches m WHERE m.from_city_id = c.id AND m.status = 'marching')
        OR EXISTS (SELECT 1 FROM world_tiles t WHERE t.owner_city_id = c.id AND t.kind = 'wilderness')
     ORDER BY c.id LIMIT $1`,
    [SWEEP_LIMIT],
  );
  let sent = 0;
  for (const row of candidates.rows as Array<{ id: string }>) {
    const client = await pool.connect();
    let notices: Notice[] = [];
    try {
      await client.query('BEGIN');
      notices = await evaluateCity(client, row.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    for (const notice of notices) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'starvation', accountId: notice.accountId, data: notice.data }),
      ]);
      sent += 1;
    }
  }
  return sent;
}
