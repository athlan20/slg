// Worker 进程入口：领取到期建造、征兵、行军任务，推进状态并保存，供 API 通知；两类队列的
// 队首激活也在完成事务内一并完成（征兵完成时把兵力累加进城内驻军 city_army）；
// 世界到期任务（行军结算与 NPC 袭击，v12）在 worker/src/world-tick.ts。
// 设计（docs/phase-1-mvp.md「农场建造流程」）：
// - 纯 Node 进程，只用 pg，不引入 Web 框架；
// - 领取与完成在同一条 UPDATE 上做条件守卫（status 仍是 building 才写入 completed），
//   重启或重复领取不会重复完成；
// - 完成事件与状态在同一个事务内落库，pg_notify 在提交之后发出；
//   通知丢失由 API 的兜底轮询覆盖；
// - 完成时按完成前的建筑水平把城池生产结算到到期时刻（产量切分），再翻转状态；
// - FOR UPDATE SKIP LOCKED，为将来多 Worker 实例预留。

import pg from 'pg';
import { NOTIFY_CHANNEL, createPool, ensureSchema, readDbConfig } from '../../common/src/db';
import { EventType, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { MAX_ACTIVE_BUILDS, buildTimeBasis, completeBuild, upgradeSeconds } from '../../common/src/rules';
import { MAX_ACTIVE_RECRUITS } from '../../common/src/troops';
import { territoryRates } from '../../common/src/world';
import { ensureWorld, loadTerritory } from '../../common/src/world-db';
import { getTimeScale, refreshTimeScale, timeScaleStale } from '../../common/src/time-scale';
import { NEWBIE_GOVERNMENT_LEVEL } from '../../common/src/protection';
import { npcRaidIntervalMs, processDueMarches } from './world-tick';
import { createNpcAttack, processDueNpcAttacks } from './npc-attack';
import { processDueResearch } from './tech-tick';
import { processMovingTargets } from './moving-tick';
import { processYellowTurban } from './yt-tick';
import { processStarvation } from './starvation-tick';
import { processHeroSalaries } from './hero-salary-tick';
import { LEADERBOARD_REFRESH_MS, refreshLeaderboards } from './leaderboard-tick';
import {
  loadArmyFoodUsePerHour,
  loadBuildingLevels,
  settleCityProduction,
  type CityProductionRow,
} from '../../common/src/production';

const TICK_MS = Number(process.env.WORKER_TICK_MS || 1000);
const BATCH_LIMIT = 50;

interface BuildRow {
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

interface RecruitRow {
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
async function processDueBuilds(pool: pg.Pool): Promise<number> {
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
        await settleCityProduction(client, cityRow, levels, target, territoryRates(territory), armyFoodUsePerHour);
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

    // 队列激活：完成让出在建位后（也兜底覆盖异常遗留的空位），把各城最早的排队建造
    // 转入在建并重算时间；每城最多激活到 MAX_ACTIVE_BUILDS 条。
    // 时长按条目区分：建造（level=1）用建造时长，升级（level>1）= 建造时长 × 当前等级；
    // 全局缩放与 1 秒下限作用于总时长（与 rules.upgradeSeconds 同口径，AISLG-38 复核修复）。
    const activated: BuildRow[] = [];
    if (done.length > 0) {
      const buildBasis = buildTimeBasis();
      const act = await client.query(
        `UPDATE builds b SET status = 'building',
            started_at = clock_timestamp(),
            due_at = clock_timestamp() + make_interval(secs => GREATEST(1, FLOOR(
              $1::float8 * (CASE
                WHEN b.level <= 10 THEN (CASE WHEN b.level > 1 THEN b.level - 1 ELSE 1 END)
                ELSE 9 * power(1.3::float8, b.level - 10) END) / $3::float8)))
         WHERE b.id IN (
           SELECT id FROM (
             SELECT q.id, row_number() OVER (PARTITION BY q.city_id ORDER BY q.started_at, q.id) AS rn
             FROM builds q
             WHERE q.status = 'queued'
               AND NOT EXISTS (
                 SELECT 1 FROM builds a WHERE a.city_id = q.city_id AND a.status = 'building'
               )
           ) ranked WHERE ranked.rn <= $2
         )
         RETURNING *`,
        [buildBasis.seconds, MAX_ACTIVE_BUILDS, buildBasis.scale],
      );
      for (const row of act.rows as BuildRow[]) {
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
async function processDueRecruits(pool: pg.Pool): Promise<number> {
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
        await settleCityProduction(client, cityRow, levels, target, territoryRates(territory), armyFoodUsePerHour);
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

    // 队首激活：把各城最早的排队征兵转入征募中，时长按条目的单兵时长快照 × 数量重算
    const activated: RecruitRow[] = [];
    if (done.length > 0) {
      // v22（AISLG-39）：征募时长 = max(1, 基准单兵 × 数量 ÷ time_scale)——下限作用于
      // 总时长（unit_seconds 快照为未缩放基准）；显式 RECRUIT_UNIT_SECONDS 覆盖时不缩放
      const recruitScale = Number.isFinite(Number(process.env.RECRUIT_UNIT_SECONDS)) ? 1 : getTimeScale();
      const act = await client.query(
        `UPDATE recruits r SET status = 'recruiting',
            started_at = clock_timestamp(),
            due_at = clock_timestamp() + make_interval(secs => GREATEST(1, FLOOR(r.unit_seconds * r.count / $1::float8)))
         WHERE r.id IN (
           SELECT id FROM (
             SELECT q.id, row_number() OVER (PARTITION BY q.city_id ORDER BY q.started_at, q.id) AS rn
             FROM recruits q
             WHERE q.status = 'queued'
               AND NOT EXISTS (
                 SELECT 1 FROM recruits a WHERE a.city_id = q.city_id AND a.status = 'recruiting'
               )
           ) ranked WHERE ranked.rn <= $2
         )
         RETURNING *`,
        [recruitScale, MAX_ACTIVE_RECRUITS],
      );
      for (const row of act.rows as RecruitRow[]) {
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

async function main(): Promise<void> {
  const { host, port, database } = readDbConfig();
  console.log(`slg-worker connecting to PostgreSQL ${host}:${port}/${database} ...`);
  const pool = createPool('slg-worker', 2);
  await ensureSchema(pool);
  // v12：世界生成幂等（与 API 并发由咨询锁串行化），Worker 只依赖已存在的表
  await ensureWorld(pool);
  // v20：全局时间缩放从 settings 预热（AISLG-38），此后定期刷新（切换无需重启）
  await refreshTimeScale(pool).catch(() => undefined);
  console.log(`slg-worker started, tick=${TICK_MS}ms, time_scale=${getTimeScale()}`);

  const tick = async (): Promise<void> => {
    // 全局时间缩放缓存过期则后台刷新（失败保旧值，下个 tick 再试）
    if (timeScaleStale()) {
      void refreshTimeScale(pool).catch(() => undefined);
    }
    try {
      const done = await processDueBuilds(pool);
      if (done > 0) {
        console.log(`completed ${done} build(s)`);
      }
    } catch (err) {
      console.error('worker tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      const recruitsDone = await processDueRecruits(pool);
      if (recruitsDone > 0) {
        console.log(`completed ${recruitsDone} recruit(s)`);
      }
    } catch (err) {
      console.error('worker recruit tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v34（AISLG-107）：断粮预警 / 哗变（粮食为 0 且净产量为负时城内驻军逐小时减员）
      await processStarvation(pool);
    } catch (err) {
      console.error('worker starvation tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v36（AISLG-114）：武将俸禄——每小时（随缩放）从主城扣，金币不足记欠饷
      await processHeroSalaries(pool);
    } catch (err) {
      console.error('worker hero salary tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v29（AISLG-76）：黄巾之乱——起事 / 坐大 / 大营发兵 / 到时限收场
      await processYellowTurban(pool);
    } catch (err) {
      console.error('worker yellow turban tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v28（AISLG-78）：移动目标——过期清理、流寇路过玩家野地的掠夺、按活跃玩家数补刷
      await processMovingTargets(pool);
    } catch (err) {
      console.error('worker moving target tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v27（AISLG-77）：到期的科技研究结算（等级账号共享，生效前按旧等级切分各城产量）
      const researchDone = await processDueResearch(pool);
      if (researchDone > 0) {
        console.log(`completed ${researchDone} research(es)`);
      }
    } catch (err) {
      console.error('worker research tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      const marchesDone = await processDueMarches(pool);
      if (marchesDone > 0) {
        console.log(`resolved ${marchesDone} march(es)`);
      }
    } catch (err) {
      console.error('worker march tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v23（AISLG-57）：到期的 NPC 袭击到达结算（预警期间增援的部队一并参战）
      const attacksDone = await processDueNpcAttacks(pool);
      if (attacksDone > 0) {
        console.log(`resolved ${attacksDone} npc attack(s)`);
      }
    } catch (err) {
      console.error('worker npc attack tick failed:', err instanceof Error ? err.message : err);
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);

  // NPC 袭击发起：低频随机目标（间隔占位决策，环境变量 NPC_RAID_INTERVAL_MS 可调）。
  // v23（AISLG-57）起改为两阶段：本定时器只负责「发起」（选目标、固定编成、发预警），
  // 到达结算由上方 tick 的 processDueNpcAttacks 按预警提前量（间隔的 1/8）执行；
  // 间隔受全局时间缩放、运行时可变（time_scale 切换），维持「触发后按当前值重设」
  // 的链式 setTimeout
  let raidTimer: NodeJS.Timeout | null = null;
  const scheduleRaid = (): void => {
    raidTimer = setTimeout(() => {
      void createNpcAttack(pool)
        .catch((err) => {
          console.error('worker npc attack failed:', err instanceof Error ? err.message : err);
        })
        .finally(scheduleRaid);
    }, npcRaidIntervalMs());
  };
  scheduleRaid();

  // 排行榜快照（v23 AISLG-61）：每 10 分钟整榜重算（数值与玩家页面同源，
  // 查询读快照，不做实时全表统计）；启动时先算一次，榜很快可用
  void refreshLeaderboards(pool).catch((err) => {
    console.error('leaderboard refresh failed:', err instanceof Error ? err.message : err);
  });
  const leaderboardTimer = setInterval(() => {
    void refreshLeaderboards(pool).catch((err) => {
      console.error('leaderboard refresh failed:', err instanceof Error ? err.message : err);
    });
  }, LEADERBOARD_REFRESH_MS);

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(leaderboardTimer);
    console.log(`received ${signal}, worker shutting down`);
    clearInterval(timer);
    if (raidTimer !== null) {
      clearTimeout(raidTimer);
    }
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await tick();
}

main().catch((err) => {
  console.error('slg-worker failed to start:', err);
  process.exit(1);
});
