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
import { territoryDisplayRates } from '../../common/src/wilderness-reserve';
import {
  applyMutiny,
  mutinyIntervalMs,
  nextStarvationCheckMs,
  projectStarvation,
  starveWarningLeadMs,
} from '../../common/src/starvation';
import { recordPoolTroops } from '../../common/src/troop-pools-db';
import { settleOwnerCity } from './tick-shared';

/** 扫描最小间隔（毫秒，真实时间）与单次扫描城池上限 */
export const STARVATION_TICK_MS = 10_000;
const SWEEP_LIMIT = 500;
/** Worker 停机后一次最多补发的哗变次数 */
const MUTINY_CATCHUP_MAX = 24;

let lastRunMs = 0;
/** 城池 → 下次复查时刻（真实毫秒，仅本进程内存；重启后全部城重新评估一遍） */
const nextCheckAt = new Map<string, number>();

interface Notice {
  accountId: string;
  data: Record<string, unknown>;
}

interface Evaluation {
  notices: Notice[];
  /** 下次复查时刻（毫秒时间戳）；null = 城池已不存在，不再排期 */
  nextCheckMs: number | null;
}

/** 单城评估（调用方持有事务）；返回需要在提交后推送的通知与下次复查时刻 */
async function evaluateCity(client: pg.PoolClient, cityId: string): Promise<Evaluation> {
  const settled = await settleOwnerCity(client, cityId);
  if (!settled.row) {
    return { notices: [], nextCheckMs: null };
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
    levels, territoryDisplayRates(territory), await loadProductionBonusPercent(client, cityId), techs,
    guard ? guardProductionPercent(guard.wit) : 0,
  );
  // 结算刚算过的耗粮直接沿用（同一事务、同一把城池行锁，编成不变），不再重复跑一遍 tile_army 联表
  const armyUse = settled.armyFoodUsePerHour ?? await loadArmyFoodUsePerHour(client, cityId);
  const net = rates.food - armyUse;
  const projection = projectStarvation(city.food, net, nowMs);
  const notices: Notice[] = [];
  const lead = starveWarningLeadMs();
  const done = (mutinyNextMs: number | null): Evaluation => ({
    notices,
    nextCheckMs: nextStarvationCheckMs(nowMs, projection.starveAtMs, projection.starving, mutinyNextMs, lead),
  });

  // 恢复 / 不会断粮：清空计时与预警标记
  if (projection.starveAtMs === null) {
    if (city.mutiny_next_at || city.starve_warned_at) {
      await client.query(`UPDATE cities SET mutiny_next_at = NULL, starve_warned_at = NULL WHERE id = $1`, [cityId]);
    }
    return done(null);
  }

  // 预警：距断粮不足 1 小时（含已断粮）且本轮未预警
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
    return done(null);
  }

  // 已断粮：起算 / 结算哗变
  const interval = mutinyIntervalMs();
  let next = city.mutiny_next_at ? city.mutiny_next_at.getTime() : nowMs + interval;
  if (!city.mutiny_next_at) {
    await client.query(`UPDATE cities SET mutiny_next_at = $2 WHERE id = $1`, [cityId, new Date(next)]);
    return done(next);
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
      // v85（AISLG-212）：兵变减少的兵不再直接损失，进这座城的逃兵营（断粮结束后可花征兵
      // 资源 50% 劝回，24 小时不处理就没了）；同一事务、同一把城池行锁内入账
      await recordPoolTroops(client, cityId, 'deserter', result.losses);
    }
    // v74（AISLG-194）：出发城断粮时，协防部队与出发城驻军一起按断粮规则减员
    const assistLosses: Partial<Record<TroopKind, number>> = {};
    const assistRes = await client.query(`SELECT id, troops FROM city_assist WHERE from_city_id = $1`, [cityId]);
    for (const assist of assistRes.rows as Array<{ id: string; troops: Partial<Record<TroopKind, number>> }>) {
      const cut = applyMutiny(assist.troops ?? {});
      if (cut.total <= 0) {
        continue;
      }
      for (const kind of TROOP_KINDS) {
        if (cut.losses[kind]) {
          assistLosses[kind] = (assistLosses[kind] ?? 0) + (cut.losses[kind] ?? 0);
        }
      }
      if (Object.keys(cut.remaining).length === 0) {
        await client.query(`DELETE FROM city_assist WHERE id = $1`, [assist.id]);
      } else {
        await client.query(`UPDATE city_assist SET troops = $2::jsonb WHERE id = $1`, [assist.id, JSON.stringify(cut.remaining)]);
      }
      // v85（AISLG-212）：协防部队哗变减员同样进逃兵营——协防从这座城派出，逃兵也归这座城
      // （累计后一次入账，与伤兵「协防进派出城」同口径）
      await recordPoolTroops(client, cityId, 'deserter', cut.losses);
    }
    const detail = {
      cityId,
      cityName: city.name,
      losses: result.losses,
      total: result.total,
      ...(Object.keys(assistLosses).length > 0 ? { assistLosses } : {}),
      nextAt: new Date(next).toISOString(),
    };
    await insertEvent(client, { accountId: city.account_id, cityId, type: EventType.MUTINY, initiator: null, detail });
    notices.push({ accountId: city.account_id, data: { reason: 'mutiny', ...detail } });
  }
  await client.query(`UPDATE cities SET mutiny_next_at = $2 WHERE id = $1`, [cityId, new Date(next)]);
  return done(next);
}

/** 单 tick 入口：节流到 STARVATION_TICK_MS；返回本次发出的通知数 */
export async function processStarvation(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < STARVATION_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  // 候选只取 id（廉价）；是否到复查时刻在内存里判，没到点的城整城跳过，不开事务、不锁城、不结算。
  // 不再 LIMIT：以前按 id 截 500 会让靠后的城永远扫不到；改为每轮最多评估 SWEEP_LIMIT 座到点的城。
  const candidates = await pool.query(
    `SELECT c.id FROM cities c
     WHERE c.mutiny_next_at IS NOT NULL OR c.starve_warned_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM city_army a WHERE a.city_id = c.id AND a.count > 0)
        OR EXISTS (SELECT 1 FROM marches m WHERE m.from_city_id = c.id AND m.status = 'marching')
        OR EXISTS (SELECT 1 FROM world_tiles t WHERE t.owner_city_id = c.id AND t.kind = 'wilderness')
        OR EXISTS (SELECT 1 FROM city_assist ca WHERE ca.from_city_id = c.id)
     ORDER BY c.id`,
  );
  const live = new Set<string>();
  let sent = 0;
  let evaluated = 0;
  for (const row of candidates.rows as Array<{ id: string }>) {
    live.add(row.id);
    if (evaluated >= SWEEP_LIMIT || (nextCheckAt.get(row.id) ?? 0) > nowMs) {
      continue;
    }
    evaluated += 1;
    const client = await pool.connect();
    let notices: Notice[] = [];
    try {
      await client.query('BEGIN');
      const evaluation = await evaluateCity(client, row.id);
      notices = evaluation.notices;
      await client.query('COMMIT');
      if (evaluation.nextCheckMs === null) {
        nextCheckAt.delete(row.id);
      } else {
        nextCheckAt.set(row.id, evaluation.nextCheckMs);
      }
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
  for (const id of nextCheckAt.keys()) {
    if (!live.has(id)) {
      nextCheckAt.delete(id);
    }
  }
  return sent;
}
