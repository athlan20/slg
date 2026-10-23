// Worker 进程入口：领取到期建造、征兵、行军任务，推进状态并保存，供 API 通知；两类队列的
// 队首激活也在完成事务内一并完成（征兵完成时把兵力累加进城内驻军 city_army）；
// 世界到期任务（行军结算与 NPC 袭击，v12）在 worker/src/world-tick.ts；队列完成在 queue-tick.ts；
// 换季（预告与到点重置，AISLG-134）在 season-tick.ts，换季期间本进程其余步骤暂停（见 season-busy.ts）。
// 设计（docs/phase-1-mvp.md「农场建造流程」）：
// - 纯 Node 进程，只用 pg，不引入 Web 框架；
// - 领取与完成在同一条 UPDATE 上做条件守卫（status 仍是 building 才写入 completed），
//   重启或重复领取不会重复完成；
// - 完成事件与状态在同一个事务内落库，pg_notify 在提交之后发出；
//   通知丢失由 API 的兜底轮询覆盖；
// - 完成时按完成前的建筑水平把城池生产结算到到期时刻（产量切分），再翻转状态；
// - FOR UPDATE SKIP LOCKED，为将来多 Worker 实例预留。

import { createPool, ensureSchema, readDbConfig } from '../../common/src/db';
import { ensureWorld } from '../../common/src/world-db';
import { getTimeScale, refreshTimeScale, timeScaleStale } from '../../common/src/time-scale';
import { processDueBuilds, processDueRecruits } from './queue-tick';
import { processDueMarches } from './world-tick';
import { processDueNpcAttacks } from './npc-attack';
import { startNpcRaidTimer } from './npc-raid-timer';
import { processDueResearch } from './tech-tick';
import { processMovingTargets } from './moving-tick';
import { processYellowTurban } from './yt-tick';
import { processStarvation } from './starvation-tick';
import { processDueReserves } from './reserve-tick';
import { processHeroSalaries } from './hero-salary-tick';
import { processHeroTraining } from './hero-training-tick';
import { processArenaRewards } from './arena-tick';
import { LEADERBOARD_REFRESH_MS, refreshLeaderboards } from './leaderboard-tick';
import { processSeasonTick } from './season-tick';
import { isSeasonResetting, trackWorkerJob } from './season-busy';

const TICK_MS = Number(process.env.WORKER_TICK_MS || 1000);

async function main(): Promise<void> {
  const { host, port, database } = readDbConfig();
  console.log(`slg-worker connecting to PostgreSQL ${host}:${port}/${database} ...`);
  const pool = createPool('slg-worker', 2);
  // 启动迁移、世界生成与换季（整图重灌）跑长语句，走维护池（超时放宽）；其余 tick 仍用 pool
  const maintenancePool = createPool('slg-worker-maint', 2, { maintenance: true });
  await ensureSchema(maintenancePool);
  // v12：世界生成幂等（与 API 并发由咨询锁串行化），Worker 只依赖已存在的表
  await ensureWorld(maintenancePool);
  // v20：全局时间缩放从 settings 预热（AISLG-38），此后定期刷新（切换无需重启）
  await refreshTimeScale(pool).catch(() => undefined);
  console.log(`slg-worker started, tick=${TICK_MS}ms, time_scale=${getTimeScale()}`);

  const tick = async (): Promise<void> => {
    // 全局时间缩放缓存过期则后台刷新（失败保旧值，下个 tick 再试）
    if (timeScaleStale()) {
      void refreshTimeScale(pool).catch(() => undefined);
    }
    try {
      // AISLG-134：换季（到点重置 / 预告）。换季在本 tick 内串行执行；换季完成则结束本 tick
      if ((await processSeasonTick(pool, Date.now(), maintenancePool)) === 'reset') {
        return;
      }
    } catch (err) {
      console.error('worker season tick failed:', err instanceof Error ? err.message : err);
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
      // v61（AISLG-165）：野地储量到点采空——按预计采空时刻结算归属方城池（采空事件与推送在结算中产生）
      await processDueReserves(pool);
    } catch (err) {
      console.error('worker reserve tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v36（AISLG-114）：武将俸禄——每小时（随缩放）从主城扣，金币不足记欠饷
      await processHeroSalaries(pool);
    } catch (err) {
      console.error('worker hero salary tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v54（AISLG-144）：武将历练到点结算——经验到账（离线也结算），升级得自由点数
      await processHeroTraining(pool);
    } catch (err) {
      console.error('worker hero training tick failed:', err instanceof Error ? err.message : err);
    }
    try {
      // v53（AISLG-145）：竞技场每日奖励——每个竞技日按当时名次给主城发金币
      await processArenaRewards(pool);
    } catch (err) {
      console.error('worker arena reward tick failed:', err instanceof Error ? err.message : err);
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

  // 不重叠：上一轮未结束（如换季进行中）时跳过本轮，各步骤与换季永远串行
  let ticking = false;
  const runTick = (): Promise<void> => {
    ticking = true;
    return tick().finally(() => {
      ticking = false;
    });
  };
  const timer = setInterval(() => {
    if (!ticking) {
      void runTick();
    }
  }, TICK_MS);

  // NPC 袭击发起定时器（v23 AISLG-57）：见 npc-raid-timer.ts
  const stopRaidTimer = startNpcRaidTimer(pool);

  // 排行榜快照（v23 AISLG-61）：每 10 分钟整榜重算（数值与玩家页面同源，
  // 查询读快照，不做实时全表统计）；启动时先算一次，榜很快可用
  void refreshLeaderboards(pool).catch((err) => {
    console.error('leaderboard refresh failed:', err instanceof Error ? err.message : err);
  });
  const leaderboardTimer = setInterval(() => {
    if (isSeasonResetting()) {
      return;
    }
    void trackWorkerJob(refreshLeaderboards(pool)).catch((err) => {
      console.error('leaderboard refresh failed:', err instanceof Error ? err.message : err);
    });
  }, LEADERBOARD_REFRESH_MS);

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(leaderboardTimer);
    console.log(`received ${signal}, worker shutting down`);
    clearInterval(timer);
    stopRaidTimer();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await runTick();
}

main().catch((err) => {
  console.error('slg-worker failed to start:', err);
  process.exit(1);
});
