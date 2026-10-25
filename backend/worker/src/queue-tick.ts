// 队列完成的 Worker 步骤（从 index.ts 拆出，控制单文件行数）：到期建造 / 征兵的完成与队首激活。
// 设计见 index.ts 文件头：条件守卫（status 仍为 building / recruiting 才写入 completed）、
// 完成事件与状态同事务落库，pg_notify 在提交之后发出；FOR UPDATE SKIP LOCKED。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { completeBuild, upgradeSeconds } from '../../common/src/rules';
import { loadTerritory } from '../../common/src/world-db';
import { activateQueuedBuilds, activateQueuedRecruits } from '../../common/src/queue-activate';
import { NEWBIE_GOVERNMENT_LEVEL } from '../../common/src/protection';
import {
  loadArmyFoodUsePerHour,
  loadBuildingLevels,
  settleCityProduction,
  type CityProductionRow,
} from '../../common/src/production';

const BATCH_LIMIT = 50;

export interface BuildRow {
  id: string;
  account_id: string;
  city_id: string;
  kind: string;
  status: string;
  level: number;
  /** 连续升级目标（v22 AISLG-43）：整链终点等级；单级与建造为 null */
  to_level?: number | null;
  initiator: string;
  due_at: Date | null;
  /** v7 起的成本快照（入队时写入）；激活事件随 detail 透出，保持与文档字段表一致 */
  cost: Record<string, unknown> | null;
}

export interface RecruitRow {
  id: string;
  account_id: string;
  city_id: string;
  troop: string;
  count: number;
  status: string;
  initiator: string;
  /** v11 起的成本快照（入队时写入）；激活事件随 detail 透出，保持与文档字段表一致 */
  cost: Record<string, unknown> | null;
  population: number;
  unit_seconds: number;
  due_at: Date | null;
}

/** 处理一批到期建造并激活各城队首；返回完成数量。单条失败抛出，整批事务回滚，下个周期重试。 */
export async function processDueBuilds(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT * FROM builds
       WHERE status = 'building' AND due_at <= now()
       ORDER BY due_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_LIMIT],
    );
    const done: BuildRow[] = [];
    // v22：连续升级的中间级完成（仍占在建位，只通知不激活排队）
    const advanced: BuildRow[] = [];
    for (const row of due.rows as BuildRow[]) {
      const next = completeBuild(row);
      // 产量切分：翻转状态前，按完成前的建筑水平把城池生产结算到到期时刻
      // （到期即完工，不用 Worker 实际处理时刻）；之后的懒结算从到期时刻起按新速率走。
      // 锁序：本循环先锁 builds（上面的 SKIP LOCKED）再锁 cities；API 侧先锁 cities
      // 且不锁已有 builds 行，两侧不构成死锁环。
      const cityRes = await client.query(
        `SELECT id, gold, wood, food, stone, iron, settled_at,
                gold_rem, food_rem, wood_rem, stone_rem, iron_rem, population, population_rem
         FROM cities WHERE id = $1 FOR UPDATE`,
        [row.city_id],
      );
      const cityRow = cityRes.rows[0] as CityProductionRow | undefined;
      if (cityRow && row.due_at) {
        const levels = await loadBuildingLevels(client, row.city_id);
        // 野地加成随占领状态变化；完工结算与读取路径一致计入（v12）
        const territory = await loadTerritory(client, row.city_id);
        // v14：耗粮同样在切分点现查（编成可能自上次结算后已变化）
        const armyFoodUsePerHour = await loadArmyFoodUsePerHour(client, row.city_id);
        // 锚点不倒退：到期到被处理之间的空档里，读取路径可能已按旧速率把
        // settled_at 推过 due_at；该空档不再回头重结（时长 ≤ tick 周期，量级可忽略）
        const target = row.due_at > cityRow.settled_at ? row.due_at : cityRow.settled_at;
        await settleCityProduction(client, cityRow, levels, target, territory, armyFoodUsePerHour);
      }
      // v22（AISLG-43）连续升级：整链占一个在建位，到一级推进一级（row.level 为
      // 当前推进中的目标等级）；链未走完时保持 building、按新等级重算下一级 due_at，
      // 只有走完（或单级条目）才置 completed 让出在建位、触发排队激活
      const chainTarget = row.to_level ?? null;
      const chainFinished = chainTarget === null || row.level >= chainTarget;
      const upd = await client.query(
        chainFinished
          ? `UPDATE builds SET status = $2, completed_at = clock_timestamp()
             WHERE id = $1 AND status = 'building'
             RETURNING *`
          : `UPDATE builds SET level = level + 1,
                   due_at = clock_timestamp() + make_interval(secs => $2)
             WHERE id = $1 AND status = 'building'
             RETURNING *`,
        chainFinished ? [row.id, next.status] : [row.id, upgradeSeconds(row.level)],
      );
      if (upd.rowCount === 1) {
        // v5：完成时把目标等级写入城内建筑权威表（GREATEST 防乱序完成回退等级）。
        // 注意必须在上面的产量结算之后：结算用的是完成前的旧等级。
        await client.query(
          `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, $2, $3)
           ON CONFLICT (city_id, kind)
           DO UPDATE SET level = GREATEST(city_buildings.level, EXCLUDED.level), updated_at = now()`,
          [row.city_id, row.kind, next.level],
        );
        // v38（AISLG-122）：任一城官府升到 5 级 → 新手保护提前结束（注册 3 天先到为准的另一头）
        if (row.kind === 'government' && next.level >= NEWBIE_GOVERNMENT_LEVEL) {
          const ended = await client.query(
            `UPDATE accounts SET newbie_until = NULL WHERE id = $1 AND newbie_until IS NOT NULL`,
            [row.account_id],
          );
          if (ended.rowCount) {
            await insertEvent(client, {
              accountId: row.account_id,
              cityId: row.city_id,
              type: EventType.NEWBIE_PROTECTION_ENDED,
              initiator: row.initiator as InitiatorRole,
              detail: { cause: 'government', level: next.level },
            });
          }
        }
        await insertEvent(client, {
          accountId: row.account_id,
          cityId: row.city_id,
          buildId: row.id,
          type: EventType.BUILD_COMPLETED,
          initiator: row.initiator as InitiatorRole,
          detail: { kind: row.kind, level: next.level, ...(chainTarget !== null ? { toLevel: chainTarget } : {}) },
        });
        // 链中间级也通知（API 推 build_completed、视图带下一级 level）；只有整链
        // 走完才进 done（done 触发排队激活——中间级不让出在建位）
        if (chainFinished) {
          done.push(upd.rows[0] as BuildRow);
        } else {
          advanced.push(upd.rows[0] as BuildRow);
        }
      }
    }

    // 队列激活：完成让出在建位后（也兜底覆盖异常遗留的空位），把各城最早的排队建造转入在建
    // （共用写法见 common/src/queue-activate.ts，API 取消在建条目时同样调用）。
    const activated: BuildRow[] = [];
    if (done.length > 0) {
      const act = await activateQueuedBuilds<BuildRow>(client, null);
      for (const row of act) {
        await insertEvent(client, {
          accountId: row.account_id,
          cityId: row.city_id,
          buildId: row.id,
          type: EventType.BUILD_STARTED,
          initiator: row.initiator as InitiatorRole,
          // 与文档字段表对齐：激活事件同样带 { kind, cost, level }（另含 fromQueue）
          detail: { kind: row.kind, cost: row.cost ?? {}, level: row.level, ...(row.to_level ? { toLevel: row.to_level } : {}), fromQueue: true },
        });
        activated.push(row);
      }
    }

    await client.query('COMMIT');
    // 提交成功后才通知；漏发由 API 兜底轮询覆盖
    for (const row of [...done, ...advanced]) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'build_completed', buildId: row.id, accountId: row.account_id }),
      ]);
    }
    // 激活通知单独发送：API 收到后直接推送 build_started；漏发时客户端也会在
    // 完成推送触发的按需查询里拿到最新队列，不依赖本通知
    for (const row of activated) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'build_started', buildId: row.id, accountId: row.account_id }),
      ]);
    }
    return done.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 处理一批到期征兵并激活各城队首；兵力累加进城内驻军。锁序与建造一致（recruits → cities）。 */
export async function processDueRecruits(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT * FROM recruits
       WHERE status = 'recruiting' AND due_at <= now()
       ORDER BY due_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_LIMIT],
    );
    const done: RecruitRow[] = [];
    for (const row of due.rows as RecruitRow[]) {
      // 生产与人口懒结算推进到到期时刻（征兵不改变生产速率，仅对齐锚点）
      const cityRes = await client.query(
        `SELECT id, gold, wood, food, stone, iron, settled_at,
                gold_rem, food_rem, wood_rem, stone_rem, iron_rem, population, population_rem
         FROM cities WHERE id = $1 FOR UPDATE`,
        [row.city_id],
      );
      const cityRow = cityRes.rows[0] as CityProductionRow | undefined;
      if (cityRow && row.due_at) {
        const levels = await loadBuildingLevels(client, row.city_id);
        const territory = await loadTerritory(client, row.city_id);
        // v14：新兵入城前的耗粮按旧编成结算（入城在下方 guarded upsert，随后读取自然重算）
        const armyFoodUsePerHour = await loadArmyFoodUsePerHour(client, row.city_id);
        const target = row.due_at > cityRow.settled_at ? row.due_at : cityRow.settled_at;
        await settleCityProduction(client, cityRow, levels, target, territory, armyFoodUsePerHour);
      }
      const upd = await client.query(
        `UPDATE recruits SET status = 'completed', completed_at = clock_timestamp()
         WHERE id = $1 AND status = 'recruiting'
         RETURNING *`,
        [row.id],
      );
      if (upd.rowCount === 1) {
        // 兵力入城：按兵种累加（并发完成由条件守卫保证只入账一次）
        await client.query(
          `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
           ON CONFLICT (city_id, troop)
           DO UPDATE SET count = city_army.count + EXCLUDED.count, updated_at = now()`,
          [row.city_id, row.troop, row.count],
        );
        await insertEvent(client, {
          accountId: row.account_id,
          cityId: row.city_id,
          buildId: row.id,
          type: EventType.RECRUIT_COMPLETED,
          initiator: row.initiator as InitiatorRole,
          detail: { troop: row.troop, count: row.count },
        });
        done.push(upd.rows[0] as RecruitRow);
      }
    }

    // 队首激活：把各城最早的排队征兵转入征募中（共用写法见 common/src/queue-activate.ts）
    const activated: RecruitRow[] = [];
    if (done.length > 0) {
      const act = await activateQueuedRecruits<RecruitRow>(client, null);
      for (const row of act) {
        await insertEvent(client, {
          accountId: row.account_id,
          cityId: row.city_id,
          buildId: row.id,
          type: EventType.RECRUIT_STARTED,
          initiator: row.initiator as InitiatorRole,
          // 与文档字段表对齐：激活事件同样带 { troop, count, cost, population }（另含 fromQueue）
          detail: { troop: row.troop, count: row.count, cost: row.cost ?? {}, population: row.population, fromQueue: true },
        });
        activated.push(row);
      }
    }

    await client.query('COMMIT');
    for (const row of done) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'recruit_completed', recruitId: row.id, accountId: row.account_id }),
      ]);
    }
    for (const row of activated) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'recruit_started', recruitId: row.id, accountId: row.account_id }),
      ]);
    }
    return done.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
