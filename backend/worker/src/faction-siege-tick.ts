// 势力围攻分城的定时器（AISLG-240，v100）：
// - 发起：每家势力在本季满 7 天后、同一时间最多围 1 座城，选范围内离老巢最近的玩家分城
//   （主城 / 名城 / 保护中 / 免战中的不入池），每次提前 60 分钟（× 烽火台加成）发预警；
// - 每周上限：第 8、15、22 天起算的一周里，每家最多吞下 2 座玩家分城；
// - 到达结算不在这里：见 faction-siege-battle.ts（守城战 + 城防值 + 吞城）。
// 参照 faction-tick / npc-raid-timer 的链式 setTimeout + season-busy：换季进行中不发起（世界即将清空）。
// faction_enabled 关闭时整个模块不动作，行为与上线前完全一致。

import pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { beaconLeadMultiplier, warningIntel } from '../../common/src/building-effects';
import { factionBannerOf, factionDayAt, factionRadiusAt, factionDefOf, type FactionDef } from '../../common/src/faction';
import { getFactionEnabled } from '../../common/src/faction-config';
import { loadFactionRows } from '../../common/src/faction-db';
import { destroyedFactionKeys } from '../../common/src/faction-lair-db';
import {
  FACTION_SIEGE_WEEKLY_CAP,
  factionSiegeArmy,
  factionSiegeArrival,
  factionSiegeIntervalMs,
  factionSiegeLossCooldownMs,
  factionSiegeMaxLeadMs,
  factionSiegeMultiplierForDay,
  factionSiegePower,
  factionSiegeWarningMs,
  factionSiegeWeekOf,
} from '../../common/src/faction-siege';
import {
  countWeekSwallows,
  hasActiveSiege,
  insertSiege,
  pickSiegeTarget,
} from '../../common/src/faction-siege-db';
import { insertEvent } from '../../common/src/events';
import { loadBuildingLevels } from '../../common/src/production';
import { repairPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { settleDurability } from '../../common/src/protection';
import { getCurrentSeason } from '../../common/src/season-db';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { isSeasonResetting, trackWorkerJob } from './season-busy';
import { resolveDueFactionSieges } from './faction-siege-battle';

export interface FactionSiegeTickResult {
  /** 本次发起的围攻数 */
  started: number;
  /** 本次结算（含作废）的围攻数 */
  resolved: number;
}

/** 一家当前的围攻决策（导出便于测试直接断言，不发起了就返回 null） */
export interface SiegeStartPlan {
  def: FactionDef;
  radius: number;
  multiplier: number;
  weekIndex: number;
  swallows: number;
}

/** 是否现在该给这家发起围攻（不含目标是否存在）：满 7 天、没在围、本周没吞满 */
export async function planSiegeStart(
  q: pg.Pool | pg.PoolClient,
  args: { def: FactionDef; day: number; radius: number; weekIndex: number | null },
): Promise<SiegeStartPlan | null> {
  if (args.weekIndex === null) {
    return null;
  }
  const multiplier = factionSiegeMultiplierForDay(args.day);
  if (multiplier <= 0) {
    return null;
  }
  if (await hasActiveSiege(q, args.def.key)) {
    return null;
  }
  const swallows = await countWeekSwallows(q, args.def.key, args.weekIndex);
  if (swallows >= FACTION_SIEGE_WEEKLY_CAP) {
    return null;
  }
  return { def: args.def, radius: args.radius, multiplier, weekIndex: args.weekIndex, swallows };
}

/**
 * 一次完整的围攻 tick：先结算到期的，再给每家到点的势力发起一次（每条路线各自事务）。
 * now 可注入（测试直接调，不必等真实钟点）。
 */
export async function runFactionSiegeTick(pool: pg.Pool, now: Date = new Date()): Promise<FactionSiegeTickResult> {
  const result: FactionSiegeTickResult = { started: 0, resolved: 0 };
  // 开关关闭时与上线前完全一致：不围城、不结算、不读任何势力数据
  if (!getFactionEnabled()) {
    return result;
  }
  const season = await getCurrentSeason(pool);
  if (!season) {
    return result;
  }
  const day = factionDayAt(season.startAt, now);
  const radius = factionRadiusAt(season.startAt, now);
  const week = factionSiegeWeekOf(season.startAt, now);

  result.resolved = await resolveDueFactionSieges(pool, { now, seasonStart: season.startAt });
  if (!week) {
    return result;
  }
  const rows = await loadFactionRows(pool);
  // v101（AISLG-241）：本季已灭亡的势力不再发起围攻（在途的已在灭亡时作废）
  const destroyed = await destroyedFactionKeys(pool);
  for (const row of rows) {
    if (destroyed.has(row.key)) {
      continue;
    }
    const def = factionDefOf(row.key);
    if (!def) {
      // 数据库里的脏势力标识按「没有这家」处理：不当旗号、不围攻（AISLG-241 的灭亡逻辑另说）
      continue;
    }
    const plan = await planSiegeStart(pool, { def, day, radius, weekIndex: week.index });
    if (!plan) {
      continue;
    }
    const started = await startOneSiege(pool, plan, now);
    if (started) {
      result.started += 1;
    }
  }
  return result;
}

/** 给一家发起一次围攻（选目标 → 落库 → 预警事件与推送）；没目标返回 false */
async function startOneSiege(pool: pg.Pool, plan: SiegeStartPlan, now: Date): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await pickSiegeTarget(client, {
      faction: plan.def.key,
      lair: plan.def.lair,
      radius: plan.radius,
      // 同城两次到达至少隔 6 小时；守方守住（势力打输）后 24 小时内不再打这座城
      intervalMs: factionSiegeIntervalMs(),
      maxLeadMs: factionSiegeMaxLeadMs(),
      lossCooldownMs: factionSiegeLossCooldownMs(),
      now,
    });
    if (!target) {
      await client.query('COMMIT');
      return false;
    }
    const power = factionSiegePower(target.governmentLevel, plan.multiplier);
    const army = factionSiegeArmy(power);
    // 预警提前量 = 60 分钟（随缩放）× 烽火台加成；敌情详细度也按烽火台等级分档（与来袭预警同一套）
    const beacon = (await loadBuildingLevels(client, target.cityId)).beacon;
    const leadMs = Math.max(1000, Math.round(factionSiegeWarningMs() * beaconLeadMultiplier(beacon)));
    const arriveAt = factionSiegeArrival({
      now,
      leadMs,
      intervalMs: factionSiegeIntervalMs(),
      lastArriveAt: target.lastArriveAt,
    });
    // 还没到这座城的发起时刻，或到达时还在被动免战：这一轮先不发起，下个 tick 再看
    if (!arriveAt || (target.truceUntil && target.truceUntil.getTime() > arriveAt.getTime())) {
      await client.query('COMMIT');
      return false;
    }
    // 预警里给「当前城防值」：按惰性回涨口径算到预警时刻（免战期内不回涨、维修科技加成照吃）
    const techs = await loadTechLevels(client, target.accountId);
    const durability = settleDurability(
      target.durability,
      target.durabilitySettledAt,
      target.truceUntil,
      now,
      repairPercent(techs),
    );
    const siegeId = await insertSiege(client, {
      faction: plan.def.key,
      cityId: target.cityId,
      accountId: target.accountId,
      x: target.x,
      y: target.y,
      level: target.governmentLevel,
      army,
      power,
      warnAt: now,
      arriveAt,
      weekIndex: plan.weekIndex,
    });
    const cityRes = await client.query(`SELECT name FROM cities WHERE id = $1`, [target.cityId]);
    const cityName = (cityRes.rows[0] as { name: string } | undefined)?.name ?? null;
    const detail = {
      siegeId,
      faction: factionBannerOf(plan.def.key),
      cityId: target.cityId,
      cityName,
      x: target.x,
      y: target.y,
      level: target.governmentLevel,
      power,
      durability,
      beaconLevel: beacon,
      ...warningIntel(army, beacon),
      arriveAt: arriveAt.toISOString(),
    };
    const recipients = await insertWarningEvents(client, target.cityId, target.accountId, detail);
    await client.query('COMMIT');
    for (const accountId of recipients) {
      const payload = { reason: 'faction_siege', accountId, data: { reason: 'warning', ...detail } };
      await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(payload)]);
    }
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 预警事件：被围城的主人 + 城里驻扎的协防方（v74 口径：协防方同样收到来袭预警）。
 * 返回全部收件账号（推送按它逐个发）。
 */
async function insertWarningEvents(
  client: pg.PoolClient,
  cityId: string,
  accountId: string,
  detail: Record<string, unknown>,
): Promise<string[]> {
  await insertEvent(client, {
    accountId,
    cityId,
    type: EventType.FACTION_SIEGE_WARNING,
    initiator: null,
    detail,
  });
  const assistRes = await client.query(
    `SELECT account_id FROM city_assist WHERE city_id = $1 AND account_id <> $2`,
    [cityId, accountId],
  );
  const recipients = [accountId];
  for (const assist of assistRes.rows as Array<{ account_id: string }>) {
    recipients.push(assist.account_id);
    await insertEvent(client, {
      accountId: assist.account_id,
      cityId,
      type: EventType.FACTION_SIEGE_WARNING,
      initiator: null,
      detail,
    });
  }
  return recipients;
}

/** 两次检查之间的最长间隔（真实时间毫秒）：围攻节奏是小时级，盯太紧没意义 */
const MAX_CHECK_MS = 60_000;
const MIN_CHECK_MS = 5_000;

/** 下一次该检查的时刻隔多久（毫秒）：按同城最小间隔的四分之一估，钳到 5 秒 ~ 60 秒 */
function checkDelayMs(): number {
  return Math.min(MAX_CHECK_MS, Math.max(MIN_CHECK_MS, Math.floor(factionSiegeIntervalMs() / 4)));
}

/** 启动围攻定时器；返回停止函数（进程退出时调用） */
export function startFactionSiegeTimer(pool: pg.Pool): () => void {
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    timer = setTimeout(() => {
      // 换季进行中不发起围攻（世界即将清空），顺延再试
      if (isSeasonResetting()) {
        schedule();
        return;
      }
      void trackWorkerJob(
        runFactionSiegeTick(pool)
          .then((tick) => {
            if (tick.started > 0 || tick.resolved > 0) {
              console.log(`faction siege: started ${tick.started}, resolved ${tick.resolved}`);
            }
          })
          .catch((err) => {
            console.error('worker faction siege tick failed:', err instanceof Error ? err.message : err);
          })
          .finally(schedule),
      );
    }, checkDelayMs());
  };
  schedule();
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
