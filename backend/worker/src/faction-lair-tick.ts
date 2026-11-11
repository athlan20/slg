// 老巢的定时任务（AISLG-241，v101；AISLG-247 起刷新的是 20 营的两个战力锚点）：每天刷新一次
// 第 1 / 第 20 营的战力锚点（由全服战力第 10 名 / 第 3 名算出，各自只升不降），以及「连续 24 小时没人进攻恢复 1 营」。
// 两者都放在 Worker 的独立定时器里、单独一个事务，不进战斗结算的事务
// （需求「全服战力前 10 名每天算一次，放 Worker，不要放进战斗结算的事务里」）。
// 参照 faction-tick / faction-siege-tick 的链式 setTimeout + season-busy：换季进行中不做（世界即将清空）。
// faction_enabled 关闭时整个模块不动作，行为与上线前完全一致。

import pg from 'pg';
import { getFactionEnabled } from '../../common/src/faction-config';
import { factionBannerOf } from '../../common/src/faction';
import { FACTION_LAIR_CAMPS, factionLairCurrentCampPower, factionLairRemainingPercent } from '../../common/src/faction-lair';
import { loadFactionLairs, recoverFactionLairs, refreshFactionLairPower } from '../../common/src/faction-lair-db';
import type { ServerBroadcastCreated } from '../../common/src/server-broadcast';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { isSeasonResetting, trackWorkerJob } from './season-busy';
import { notifySuppressionChange } from './faction-suppression-notify';

export interface FactionLairTickResult {
  /** 本次刷新了战力锚点的老巢数 */
  refreshed: number;
  /** 本轮算出的第 1 营战力（没有刷新时为 0） */
  g1: number;
  /** 本轮算出的第 20 营战力（没有刷新时为 0） */
  g20: number;
  /** 本次恢复的营数合计 */
  recovered: number;
}

/**
 * 一次老巢 tick：先刷新每营战力（到点才刷），再恢复营（24 小时没人进攻）。
 * now 可注入（测试直接调，不必等真实钟点；数据库里的比较也都用这个 now）。
 */
export async function runFactionLairTick(pool: pg.Pool, now: Date = new Date()): Promise<FactionLairTickResult> {
  const result: FactionLairTickResult = { refreshed: 0, g1: 0, g20: 0, recovered: 0 };
  if (!getFactionEnabled()) {
    return result;
  }
  const client = await pool.connect();
  const pushes: Array<{ key: string; data: Record<string, unknown> }> = [];
  /** v107（AISLG-249）：恢复导致压制档降档时的全服播报（提交后统一 pg_notify） */
  const broadcasts: ServerBroadcastCreated[] = [];
  try {
    await client.query('BEGIN');
    const refreshed = await refreshFactionLairPower(client, now);
    result.refreshed = refreshed.refreshed;
    result.g1 = refreshed.g1;
    result.g20 = refreshed.g20;
    const recoveries = await recoverFactionLairs(client, now);
    result.recovered = recoveries.reduce((sum, row) => sum + (row.campsAfter - row.campsBefore), 0);
    for (const recovery of recoveries) {
      // 营恢复后压制档可能降（例：已打掉 15 营的 3 档，一天没人打回到 14 营 → 2 档）：降档也播一次
      const change = await notifySuppressionChange(client, {
        key: recovery.key,
        campsTotal: recovery.campsTotal,
        campsBefore: recovery.campsBefore,
        campsAfter: recovery.campsAfter,
      });
      if (change) {
        broadcasts.push(change.broadcast);
      }
    }
    if (result.recovered > 0) {
      // 恢复 1 营后各营数变了：把变化告诉全服（面板 / 地图不等到下一次轮询）
      for (const row of await loadFactionLairs(client)) {
        const banner = factionBannerOf(row.key);
        if (!banner || row.destroyed_at) {
          continue;
        }
        pushes.push({
          key: row.key,
          data: {
            reason: 'recovered',
            faction: banner,
            campsTotal: row.camps_total || FACTION_LAIR_CAMPS,
            campsRemaining: row.camps_remaining,
            campRemainingPercent: factionLairRemainingPercent(row.remaining, factionLairCurrentCampPower(row)),
            destroyed: false,
          },
        });
      }
    }
    await client.query('COMMIT');
    for (const broadcast of broadcasts) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast }),
      ]);
    }
    for (const push of pushes) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'faction_lair', accountId: '', data: push.data }),
      ]);
    }
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 两次检查之间的最长间隔（真实时间毫秒）：营数是小时级的，盯太紧没意义 */
const MAX_CHECK_MS = 60_000;
const MIN_CHECK_MS = 5_000;

/** 启动老巢定时器；返回停止函数（进程退出时调用） */
export function startFactionLairTimer(pool: pg.Pool): () => void {
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    timer = setTimeout(() => {
      // 换季进行中不刷新 / 不恢复（世界即将清空），顺延再试
      if (isSeasonResetting()) {
        schedule();
        return;
      }
      void trackWorkerJob(
        runFactionLairTick(pool)
          .then((tick) => {
            if (tick.refreshed > 0 || tick.recovered > 0) {
              console.log(`faction lair: power refreshed ${tick.refreshed} (G1 ${tick.g1}, G20 ${tick.g20}), recovered camps ${tick.recovered}`);
            }
          })
          .catch((err) => {
            console.error('worker faction lair tick failed:', err instanceof Error ? err.message : err);
          })
          .finally(schedule),
      );
    }, Math.min(MAX_CHECK_MS, Math.max(MIN_CHECK_MS, 15_000)));
  };
  schedule();
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
