// NPC 袭击发起定时器（v23 AISLG-57）：低频随机选目标发起袭击（间隔占位决策，环境变量 NPC_RAID_INTERVAL_MS 可调）。
// 两阶段：本定时器只负责「发起」（选目标、固定编成、发预警），到达结算由 index.ts 的 tick 中
// processDueNpcAttacks 按预警提前量（间隔的 1/8）执行；间隔受全局时间缩放、运行时可变（time_scale 切换），
// 维持「触发后按当前值重设」的链式 setTimeout。

import pg from 'pg';
import { createNpcAttack } from './npc-attack';
import { npcRaidIntervalMs } from './world-tick';
import { isSeasonResetting, trackWorkerJob } from './season-busy';

/** 启动袭击发起的链式定时器；返回停止函数（进程退出时调用） */
export function startNpcRaidTimer(pool: pg.Pool): () => void {
  let raidTimer: NodeJS.Timeout | null = null;
  const scheduleRaid = (): void => {
    raidTimer = setTimeout(() => {
      // 换季进行中不发起新袭击（世界即将清空），顺延到下一个间隔再看
      if (isSeasonResetting()) {
        scheduleRaid();
        return;
      }
      void trackWorkerJob(
        createNpcAttack(pool)
          .catch((err) => {
            console.error('worker npc attack failed:', err instanceof Error ? err.message : err);
          })
          .finally(scheduleRaid),
      );
    }, npcRaidIntervalMs());
  };
  scheduleRaid();
  return () => {
    if (raidTimer !== null) {
      clearTimeout(raidTimer);
    }
  };
}
